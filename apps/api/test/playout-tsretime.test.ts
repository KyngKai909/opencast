// The translator's TS joiner, found running the Phase 5 evening through a real Livepeer stream
// (docs/phase-5-demo.md): Livepeer's segments carry the sound on the PID our prepared segments use
// for the picture, so a relay joining them froze on the last prepared frame at the switch into a
// live block. Every segment now leaves in one layout (picture 0x100, sound 0x101).
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OUT_PID, readLayout, TsRetimer } from "../src/v1/modules/playout/engine/tsretime.js";

let dir: string;

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Two seconds of TS: ours (picture first, 0x100) or a Livepeer-like one (sound first, so on 0x100). */
async function segment(name: string, size: string, soundFirst: boolean) {
  const file = path.join(dir, `${name}.ts`);
  const maps = soundFirst ? ["-map", "1:a", "-map", "0:v"] : ["-map", "0:v", "-map", "1:a"];
  const result = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc=duration=2:size=${size}:rate=30`, "-f", "lavfi", "-i", "sine=frequency=440:duration=2", ...maps, "-c:v", "libx264", "-preset", "ultrafast", "-g", "60", "-pix_fmt", "yuv420p", "-c:a", "aac", "-f", "mpegts", file]);
  if (result.code !== 0) throw new Error(result.stderr);
  return fs.readFile(file);
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-tsretime-"));
});

describe("joining segments from prepared items and a live source", () => {
  it("reads each segment's layout from its program table", async () => {
    const ours = readLayout(await segment("ours", "320x180", false))!;
    const theirs = readLayout(await segment("theirs", "480x270", true))!;
    expect([...ours.map]).toEqual([[0x100, OUT_PID.video], [0x101, OUT_PID.audio]]);
    // Sound first: sound on 0x100, the picture on 0x101.
    expect([...theirs.map]).toEqual([[0x100, OUT_PID.audio], [0x101, OUT_PID.video]]);
    expect([ours.videoType, ours.audioType]).toEqual([0x1b, 0x0f]);
  });

  it("gives every segment one layout, so the joined stream decodes straight through the switch", async () => {
    const retimer = new TsRetimer();
    const parts = [
      retimer.retime(await segment("a", "320x180", false), "prepared-1", 2_000),
      retimer.retime(await segment("b", "480x270", true), "live-1", 2_000),
      retimer.retime(await segment("c", "320x180", false), "prepared-2", 2_000)
    ];
    const joined = path.join(dir, "joined.ts");
    await fs.writeFile(joined, Buffer.concat(parts));
    const streams = JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "stream=id,codec_type", "-of", "json", joined])).stdout).streams.map((s: { id: string; codec_type: string }) => ({ id: s.id, codec_type: s.codec_type }));
    expect(streams).toEqual([
      { id: "0x100", codec_type: "video" },
      { id: "0x101", codec_type: "audio" }
    ]);
    // Every picture decodes (two seconds at 30 fps from each part), with nothing read as the wrong kind.
    const decoded = await run("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", joined]);
    expect(Number(decoded.stdout.trim().split("\n")[0])).toBe(180);
    expect(decoded.stderr).not.toMatch(/bitstream error|corrupt/i);
    // Time runs on: each part after the last.
    const times = (await run("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "packet=pts_time", "-of", "csv=p=0", joined])).stdout.trim().split("\n").filter(Boolean).map((l) => parseFloat(l));
    const sorted = [...times].sort((x, y) => x - y);
    expect(sorted[sorted.length - 1] - sorted[0]).toBeGreaterThan(5.9);
    expect(sorted[sorted.length - 1] - sorted[0]).toBeLessThan(6.5);
  });
});
