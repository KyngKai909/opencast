// What copying a TV live block into storage costs, in real time (test:realtime): a local fake of
// Livepeer's output at the TV ladder's sizes (4-second segments of 1080p, 720p, 480p and 360p, the
// 360p a real TS with sound, so FFmpeg takes the audio-only rendition from it as it would live),
// read once a second as the worker does, with Livepeer's first byte 100 ms away and each store
// taking 200 ms (roughly R2 from Railway; storage here is a local directory). Measures the delay a
// copy adds (against the same source read without copying, as the channel read it before), the
// bytes pulled and CPU per live hour. No Livepeer stream is created and nothing paid is called.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BAND_RENDITIONS, LADDER } from "../src/v1/modules/playout/engine/ladder.js";
import { LiveHlsSource } from "../src/v1/modules/playout/engine/live.js";
import { createLiveCopier, liveCopyCounter } from "../src/v1/modules/playout/engine/livecopy.js";

const SEGMENT_MS = 4_000;
const RUN_MS = 44_000;
/** The ladder's pictures and sound, 4 s each: roughly what Livepeer's renditions weigh. */
const SIZES: Array<[string, number, number, number]> = [
  ["1_0", 1920, 1080, 2_600_000],
  ["1_1", 1280, 720, 1_450_000],
  ["1_2", 854, 480, 750_000]
];

let server: http.Server;
let origin: string;
let dir: string;
let start = 0;
const bytes: Record<string, Buffer> = {};

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-live-copy-rt-"));
  for (const [name, , , size] of SIZES) bytes[name] = Buffer.alloc(size, name);
  // The smallest rendition as Livepeer sends it: pictures and sound in one TS (about 0.45 MB).
  const file = path.join(dir, "360.ts");
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=4", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4", "-c:v", "libx264", "-preset", "ultrafast", "-b:v", "800k", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-f", "mpegts", file]);
  if (r.status !== 0) throw new Error(String(r.stderr));
  bytes["1_3"] = await fs.readFile(file);

  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    const newest = Math.floor((Date.now() - start) / SEGMENT_MS) - 1;
    if (url === "/hls/pb/index.m3u8") {
      const lines = ["#EXTM3U"];
      for (const [name, w, h, size] of [...SIZES, ["1_3", 640, 360, bytes["1_3"].length] as const]) lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${Math.round((size * 8) / 4)},RESOLUTION=${w}x${h},CODECS="avc1.64001f,mp4a.40.2"`, `${name}/index.m3u8`);
      return void res.end(lines.join("\n") + "\n");
    }
    const list = /^\/hls\/pb\/(\d_\d)\/index\.m3u8$/.exec(url);
    if (list) {
      if (newest < 0) return void res.end("#EXTM3U\n#EXT-X-ERROR: Stream open failed\n#EXT-X-ENDLIST\n");
      const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:4", `#EXT-X-MEDIA-SEQUENCE:${Math.max(0, newest - 4)}`];
      for (let i = Math.max(0, newest - 4); i <= newest; i++) lines.push("#EXTINF:4.000,", `${i}.ts`);
      return void res.end(lines.join("\n") + "\n");
    }
    const seg = /^\/hls\/pb\/(\d_\d)\/(\d+)\.ts$/.exec(url);
    if (seg) {
      // Livepeer's first byte is about 100 ms away.
      setTimeout(() => res.end(bytes[seg[1]]), 100);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

describe("copying a TV live block, in real time", () => {
  it("adds at most one segment of delay, and pulls each rendition once", async () => {
    const counter = liveCopyCounter();
    const objects = path.join(dir, "objects");
    let stores = 0;
    const copy = createLiveCopier({
      liveSourceId: "5f0c1d7e-0000-4000-8000-00000000000a",
      scratchDir: path.join(dir, "scratch"),
      counter,
      // As the engine stores one (its SHA-256, then the object), with 200 ms for R2 to answer.
      store: async (key, file) => {
        createHash("sha256").update(await fs.readFile(file)).digest();
        await new Promise((resolve) => setTimeout(resolve, 200));
        await fs.mkdir(path.dirname(path.join(objects, key)), { recursive: true });
        await fs.copyFile(file, path.join(objects, key));
        stores++;
        return `https://storage.test/${key}`;
      }
    });
    const now = () => Date.now();
    start = Date.now();
    const copied = new LiveHlsSource(`${origin}/hls/pb/index.m3u8`, BAND_RENDITIONS.tv, LADDER, now, { copy, onEvent: (e) => counter.event(e) });
    // The same source read as the channel read it before: Livepeer's own URLs.
    const direct = new LiveHlsSource(`${origin}/hls/pb/index.m3u8`, BAND_RENDITIONS.tv, LADDER, now);
    const seenDirect = new Map<number, number>();
    const seenCopied = new Map<number, number>();
    while (Date.now() - start < RUN_MS) {
      const tick = Date.now();
      // The worker's tick: every station's sources read in turn, each once a second.
      await direct.poll();
      for (const s of direct.after(-1)) if (!seenDirect.has(s.seq)) seenDirect.set(s.seq, Date.now());
      await copied.poll();
      for (const s of copied.connected() ? copied.after(-1) : []) if (!seenCopied.has(s.seq)) seenCopied.set(s.seq, Date.now());
      copied.after(null);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1_000 - (Date.now() - tick))));
    }
    await copied.close();

    const stats = counter.stats();
    const added = [...seenCopied].filter(([seq]) => seenDirect.has(seq)).map(([seq, at]) => at - seenDirect.get(seq)!);
    const sorted = [...added].sort((a, b) => a - b);
    const report = {
      segments: stats.segments,
      skipped: stats.skipped,
      caughtUp: stats.caughtUp,
      copyDelayMs: stats.addedLatencyMs,
      playlistDelayVsDirectMs: { average: Math.round(added.reduce((a, b) => a + b, 0) / added.length), max: sorted[sorted.length - 1] },
      gbPulledPerLiveHour: Math.round((stats.bytesPulledPerLiveHour! / 1e9) * 100) / 100,
      gbWrittenPerLiveHour: Math.round(((stats.bytesWritten * 3_600_000) / (stats.liveSeconds * 1000) / 1e9) * 100) / 100,
      objectsPerLiveHour: Math.round((stats.objectsWritten * 3_600_000) / (stats.liveSeconds * 1000)),
      cpuSecondsPerLiveHour: stats.cpuSecondsPerLiveHour
    };
    console.log(`[live copy, real time] ${JSON.stringify(report)}`);

    expect(stats.segments).toBeGreaterThanOrEqual(8);
    expect(stats.skipped).toBe(0);
    // Four pictures and the sound a segment, each stored once.
    expect(stores).toBe(stats.segments * 5);
    expect(added.length).toBeGreaterThanOrEqual(8);
    // At most one segment later than reading Livepeer directly.
    expect(sorted[sorted.length - 1]).toBeLessThanOrEqual(SEGMENT_MS);
    expect(stats.addedLatencyMs!.p95).toBeLessThan(SEGMENT_MS);
  }, 90_000);
});
