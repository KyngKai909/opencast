// A TV station's live block and its audio-only rendition: Livepeer makes no audio-only rendition,
// so the channel's `a128` takes the sound of Livepeer's smallest rendition, stream-copied (no
// re-encode, its timestamps kept) into segments of its own, stored with the platform's objects.
// Before, audio-only listeners were sent Livepeer's 360p pictures during live blocks. Since
// 2026-09-30 the pictures are copied into storage too (livecopy.ts), and the sound is taken from
// the smallest rendition's bytes already pulled: each of Livepeer's segments is fetched once.
// Against a local fake of Livepeer's output serving real TS (no Livepeer stream is created,
// nothing paid is called), on a frozen clock; FFmpeg takes the sound.
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@opencast/db";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { createHarness, dummyFile, fakeTranscoder, itemFixture, market, prepareQueued, stationFixture, type Harness } from "./harness.js";

let h: Harness;
let engine: Engine;
let stationId: string;
let sourceId: string;
let server: http.Server;
let origin: string;
let dir: string;
/** Livepeer's segments: pictures and sound, two seconds each, as a real TS file per rendition. */
const segments: Record<string, Buffer> = {};
const on = { from: Date.parse("2026-10-01T20:00:44.000Z"), to: Date.parse("2026-10-01T20:01:30.000Z") };
const fetched = new Map<string, number>();

function probe(file: string) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,codec_type,start_time", "-of", "json", file], { encoding: "utf8" });
  const json = JSON.parse(r.stdout || "{}") as { streams?: Array<{ codec_name: string; codec_type: string; start_time?: string }> };
  const sound = json.streams?.find((s) => s.codec_type === "audio");
  return { codecs: (json.streams ?? []).map((s) => s.codec_name).sort(), start: Number(sound?.start_time ?? NaN) };
}

function fakeLivepeer() {
  return http.createServer((req, res) => {
    const now = h.clock.now().getTime();
    const url = req.url ?? "";
    if (url === "/hls/fake/index.m3u8") {
      res.end(["#EXTM3U", '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"', "720p0/index.m3u8", '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"', "360p0/index.m3u8", ""].join("\n"));
      return;
    }
    const media = /^\/hls\/fake\/(720p0|360p0)\/index\.m3u8$/.exec(url);
    if (media && now >= on.from && now < on.to) {
      const newest = Math.floor((now - on.from) / 2_000);
      const first = Math.max(0, newest - 4);
      const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:2", `#EXT-X-MEDIA-SEQUENCE:${first}`];
      for (let i = first; i <= newest; i++) lines.push("#EXTINF:2.000,", `${i}.ts`);
      res.end(lines.join("\n") + "\n");
      return;
    }
    const seg = /^\/hls\/fake\/(720p0|360p0)\/\d+\.ts$/.exec(url);
    if (seg) {
      fetched.set(url, (fetched.get(url) ?? 0) + 1);
      res.setHeader("content-type", "video/mp2t");
      res.end(segments[seg[1]]);
      return;
    }
    res.statusCode = 404;
    res.end();
  });
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-live-audio-"));
  // As Livepeer lays them out: pictures and sound in one TS per rendition.
  for (const [name, size] of [["720p0", "320x180"], ["360p0", "160x90"]] as const) {
    const file = path.join(dir, `${name}.ts`);
    const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc=size=${size}:rate=30:duration=2`, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-output_ts_offset", "10", "-f", "mpegts", file]);
    if (r.status !== 0) throw new Error(String(r.stderr));
    segments[name] = await fs.readFile(file);
  }
  h = await createHarness();
  h.clock.set("2026-10-01T19:59:40.000Z");
  server = fakeLivepeer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const m = await market(h);
  const kai = await h.signIn("Kai");
  stationId = (await stationFixture(h, { callSign: "TUBE", name: "Tube", ownerId: kai.id, marketId: m.id, tenths: 141, signedOn: true })).id;
  await itemFixture(h, stationId, { title: "TUBE ident", code: "SID", durationMs: 4_000, location: await dummyFile() });
  const show = await itemFixture(h, stationId, { title: "Before and after", durationMs: 40_000, location: await dummyFile() });
  const [source] = await h.db.insert(schema.liveSources).values({ stationId, kind: "encoder", name: "Studio A", livepeerPlaybackId: "fake" }).returning();
  sourceId = source.id;
  const [program] = await h.db.insert(schema.programs).values({ stationId, title: "Town Hall", isLive: true }).returning();
  await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-01T20:00:00.000Z", endsAt: "2026-10-01T20:00:40.000Z", itemId: show.id }).expect(201);
  await kai.post(`/v1/stations/${stationId}/log`, { kind: "live", startsAt: "2026-10-01T20:00:40.000Z", endsAt: "2026-10-01T20:01:40.000Z", liveSourceId: sourceId, programId: program.id }).expect(201);
  await h.db.insert(schema.playoutState).values({ stationId, onAir: true });
  engine = createEngine({ deps: h.deps, services: h.services }, { transcoder: fakeTranscoder(), scratchDir: dir, liveUrl: async (id) => (id === sourceId ? `${origin}/hls/fake/index.m3u8` : null) });
}, 60_000);

afterAll(async () => {
  await engine?.stopAll();
  server?.close();
  await h.close();
});

describe("a TV live block's audio-only rendition", () => {
  it("is the sound of Livepeer's smallest rendition, stream-copied into segments of its own", async () => {
    let audio = "";
    let v720 = "";
    const end = Date.parse("2026-10-01T20:01:10.000Z");
    while (h.clock.now().getTime() < end) {
      h.clock.advance(1_000);
      await engine.tick();
      await prepareQueued(h, engine.preparer);
    }
    audio = (await h.services.playout.playlist(stationId, "a128.m3u8"))!.body;
    v720 = (await h.services.playout.playlist(stationId, "v720.m3u8"))!.body;

    // Pictures and sound from the platform's own objects, never Livepeer's.
    expect(v720).not.toContain(origin);
    expect(audio).not.toContain(origin);
    const own = audio.split("\n").filter((l) => /\/prepared\/live-[\w-]+\/a128\/seg_\d{5}\.ts$/.test(l));
    expect(own.length).toBeGreaterThanOrEqual(5);
    // Segment for segment with the pictures (the same count in the live stretch).
    const live720 = v720.split("\n").filter((l) => /\/prepared\/live-[\w-]+\/v\d+\/seg_\d{5}\.ts$/.test(l));
    expect(own.length).toBe(live720.length);
    // Each of Livepeer's segments fetched once: the 360p's pictures and the sound from one fetch.
    expect([...fetched.values()].every((n) => n === 1)).toBe(true);
    // (a few more than the playlist shows: the copies run a segment or two ahead of what's
    // published, and the one copied when the block first asked may be passed for a newer edge)
    const small = [...fetched.keys()].filter((u) => u.includes("/360p0/")).length;
    expect(small).toBeGreaterThanOrEqual(own.length);
    expect(small).toBeLessThanOrEqual(own.length + 4);

    // Sound only, AAC as Livepeer sent it, with Livepeer's timestamps (nothing re-encoded).
    const key = /(prepared\/live-[\w-]+\/a128\/seg_\d{5}\.ts)$/.exec(own[0])![1];
    const chunks: Buffer[] = [];
    for await (const c of await h.deps.storage.objects.open!(key)) chunks.push(c as Buffer);
    const file = path.join(dir, "got.ts");
    await fs.writeFile(file, Buffer.concat(chunks));
    const got = probe(file);
    const source = probe(path.join(dir, "360p0.ts"));
    expect(got.codecs).toEqual(["aac"]);
    expect(source.codecs).toEqual(["aac", "h264"]);
    expect(Math.abs(got.start - source.start)).toBeLessThan(0.05);
  }, 60_000);
});
