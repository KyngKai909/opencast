// Prepare once, with FFmpeg (the ladder shrunk tenfold and the fastest preset, to keep it small):
// the fixed ladder with 4-second segments and aligned keyframes, levelled loudness, faded edges,
// stored under the content ID, recorded in the database. Prepared once however many stations air it.
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { scaledLadder } from "../src/v1/modules/playout/engine/ladder.js";
import { createPreparer, ffmpegTranscoder, type Preparer, type TranscodeJob } from "../src/v1/modules/playout/engine/prepare.js";
import { Slates } from "../src/v1/modules/playout/engine/slates.js";
import { createHarness, itemFixture, prepareQueued, stationFixture, testClip, type Harness } from "./harness.js";

let h: Harness;
let preparer: Preparer;
let cid: string;
const jobs: Array<{ key: string; renditions: string[] }> = [];
const objectPath = (key: string) => path.join(h.deps.config.storageRoot, "objects", ...key.split("/"));

function run(args: string[], command = "ffmpeg"): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    const out: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", () => resolve({ stdout: Buffer.concat(out), stderr }));
  });
}

beforeAll(async () => {
  h = await createHarness();
  const station = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat" });
  const item = await itemFixture(h, station.id, { title: "Late Crate", durationMs: 9_000, location: await testClip(9) });
  cid = (await h.services.library.currentContent([item.id])).get(item.id)!;
  const ffmpeg = ffmpegTranscoder({ preset: "ultrafast" });
  preparer = createPreparer({ deps: h.deps, services: h.services }, {
    ladder: scaledLadder(0.1),
    scratchDir: await fs.mkdtemp(path.join(os.tmpdir(), "opencast-prep-")),
    transcoder: async (job: TranscodeJob) => {
      jobs.push({ key: job.key, renditions: job.renditions.map((r) => r.name) });
      return ffmpeg(job);
    }
  });
  await preparer.init();
}, 60_000);
afterAll(() => h.close());

describe("preparing an item", () => {
  it("transcodes it once to the TV ladder: 4-second segments, keyframes at every boundary, stored under its content ID", async () => {
    await preparer.want([{ contentId: cid, mediaKind: "video", band: "tv", durationMs: 9_000, neededAt: h.clock.now() }]);
    await prepareQueued(h, preparer);
    const [row] = await h.db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, cid));
    expect(row).toMatchObject({ status: "ready", contentId: cid, durationMs: 9_000, renditions: ["a128", "v1080", "v360", "v480", "v720"] });
    expect(row.prepMs).toBeGreaterThan(0);
    const renditions = await h.db.select().from(schema.preparedRenditions).where(eq(schema.preparedRenditions.key, cid));
    const by = new Map(renditions.map((r) => [r.rendition, r.segmentMs]));
    for (const v of ["v1080", "v720", "v480", "v360"]) expect(by.get(v)).toEqual([4000, 4000, 1000]);
    // The audio-only rendition splits on its own frames, a few milliseconds either way.
    expect(by.get("a128")!.length).toBe(3);
    expect(Math.abs(by.get("a128")!.reduce((a, b) => a + b, 0) - 9_000)).toBeLessThan(60);
    expect(preparer.isReady(cid, "tv")).toBe(true);
    expect(preparer.isReady(cid, "radio")).toBe(false);

    const segment = objectPath(`prepared/${cid}/v1080/seg_00001.ts`);
    await fs.access(segment);
    const frames = (await run(["-v", "error", "-select_streams", "v", "-show_frames", "-show_entries", "frame=key_frame,width,height", "-of", "csv=p=0", segment], "ffprobe")).stdout.toString().trim().split("\n");
    expect(frames[0]).toBe("1,192,108");
    expect(frames.length).toBe(120);
    const secondSegment = (await run(["-v", "error", "-select_streams", "v", "-show_frames", "-show_entries", "frame=key_frame", "-of", "csv=p=0", objectPath(`prepared/${cid}/v360/seg_00001.ts`)], "ffprobe")).stdout.toString().trim().split("\n");
    expect(secondSegment[0]).toBe("1");
    expect(secondSegment.slice(1).every((k) => k === "0")).toBe(true);
  }, 60_000);

  it("levels the loudness and fades the edges", async () => {
    const segments = [0, 1, 2].map((i) => objectPath(`prepared/${cid}/a128/seg_${String(i).padStart(5, "0")}.ts`));
    const { stderr } = await run(["-hide_banner", "-nostats", "-i", `concat:${segments.join("|")}`, "-af", "ebur128", "-f", "null", "-"]);
    const lufs = Number([...stderr.matchAll(/I:\s+(-?\d+(?:\.\d+)?) LUFS/g)].pop()![1]);
    expect(lufs).toBeGreaterThan(-27);
    expect(lufs).toBeLessThan(-21);
    // The first milliseconds are quieter than the tone they fade into.
    const pcm = (await run(["-v", "error", "-i", segments[0], "-f", "s16le", "-ac", "1", "-ar", "48000", "-"])).stdout;
    const peak = (from: number, to: number) => {
      let max = 0;
      for (let i = from; i < to && i * 2 + 1 < pcm.length; i++) max = Math.max(max, Math.abs(pcm.readInt16LE(i * 2)));
      return max;
    };
    expect(peak(0, 96)).toBeLessThan(peak(4_800, 9_600) * 0.5);
  }, 30_000);

  it("prepares it once for every station: another TV station adds nothing, the radio band adds its 64k only", async () => {
    const before = jobs.length;
    await preparer.want([{ contentId: cid, mediaKind: "video", band: "tv", durationMs: 9_000 }]);
    await prepareQueued(h, preparer);
    expect(jobs.length).toBe(before);
    const [v1080] = await h.db.select().from(schema.preparedRenditions).where(eq(schema.preparedRenditions.key, cid));
    await preparer.want([{ contentId: cid, mediaKind: "video", band: "radio", durationMs: 9_000 }]);
    await prepareQueued(h, preparer);
    expect(jobs.slice(before)).toEqual([{ key: cid, renditions: ["a64"] }]);
    expect(preparer.isReady(cid, "radio")).toBe(true);
    const again = await h.db.select().from(schema.preparedRenditions).where(eq(schema.preparedRenditions.key, cid));
    expect(again.find((r) => r.rendition === v1080.rendition)!.preparedAt).toEqual(v1080.preparedAt);
    const [row] = await h.db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, cid));
    expect(row.renditions).toEqual(["a128", "a64", "v1080", "v360", "v480", "v720"]);
  }, 30_000);

  it("prepares a generated slate at the length asked, once", async () => {
    const slates = new Slates(path.join(h.deps.config.storageRoot, "slates"));
    const png = await slates.stationId({ callSign: "BEAT", channel: "12.1", name: "Inland Beat", homeCity: "Redlands", colour: "#8C3B7A" });
    const key = await preparer.slate(png, 5, "tv");
    expect(key).toMatch(/^slate-/);
    expect(await preparer.segmentMs(key, "v720")).toEqual([4000, 1000]);
    const before = jobs.length;
    expect(await preparer.slate(png, 5, "tv")).toBe(key);
    expect(jobs.length).toBe(before);
    // Silence on the radio band.
    const radio = await preparer.slate(png, 3, "radio");
    expect(jobs[jobs.length - 1]).toEqual({ key: radio, renditions: ["a128", "a64"] });
  }, 30_000);

  it("prepares files from before content IDs from their old location", async () => {
    const station = await stationFixture(h, { callSign: "OLDE", name: "Old Station" });
    const item = await itemFixture(h, station.id, { title: "Old file", durationMs: 4_000 });
    const clip = await testClip(4);
    await h.db.update(schema.assetFiles).set({ location: clip }).where(eq(schema.assetFiles.assetId, item.id));
    await preparer.want([{ location: clip, mediaKind: "video", band: "tv", durationMs: 4_000 }]);
    await prepareQueued(h, preparer);
    expect(preparer.isReady({ location: clip }, "tv")).toBe(true);
    const stats = await preparer.stats();
    expect(stats).toMatchObject({ waiting: 0, failed: 0 });
    expect(stats.prepared).toBeGreaterThanOrEqual(3);
    expect(stats.lastDay.prepSecondsPerMediaHour).toBeGreaterThanOrEqual(0);
  }, 30_000);
});
