// Relays for real (follow-up Phase 3; this was the worker translators' test): the relay runner
// reads each station's channel and sends one continuous stream per station to its Livepeer relay
// stream, against a local fake of Livepeer's API (no stream is created) whose ingest is a local
// RTMP sink per station (FFmpeg listening; never a real destination). Live blocks come from a
// local fake of Livepeer's HLS output.
//
//   - PLAIN (bug off on relays): stream-copied, one push across its live block (prerecorded, live,
//     prerecorded again): one session, one connection, timestamps running on;
//   - SWAP: the station ID slate in place of its break;
//   - BUGS (the bug on, the default): re-encoded with the bug composited.
//
// Real FFmpeg and real time, about 90 s.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { PlatformsSeam, RelayDestination } from "@opencast/contracts";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import type { Fanout } from "../src/v1/modules/playout/engine/fanout.js";
import { scaledLadder } from "../src/v1/modules/playout/engine/ladder.js";
import type { StationSender } from "../src/v1/modules/playout/engine/sender.js";
import { createRelayRunner, type RelayRunner } from "../src/v1/modules/relays/runner.js";
import { fakeLivepeerApi, type FakeLivepeer } from "./fake-livepeer-api.js";
import { createHarness, itemFixture, market, prepareQueued, stationFixture, testClip, type Harness } from "./harness.js";

let h: Harness;
let engine: Engine;
let runner: RelayRunner;
let lp: FakeLivepeer;
let dir: string;
let t0: number;
let hls: http.Server;
let origin: string;
let sourceId: string;
const ids: Record<"PLAIN" | "SWAP" | "BUGS", string> = { PLAIN: "", SWAP: "", BUGS: "" };
const ports: Record<string, number> = { PLAIN: 19381, SWAP: 19382, BUGS: 19383 };
const sinks: Array<{ name: string; file: string; child: ChildProcess; done: Promise<void> }> = [];
const destinations = new Map<string, RelayDestination[]>();
const platforms: PlatformsSeam = {
  destinationsFor: async (stationId) => destinations.get(stationId) ?? [],
  prepareNextBroadcast: async () => null,
  endBroadcast: async () => undefined,
  setPaidPromotion: async () => ({ applied: false })
};
const LIVE_SEGMENTS = 15;

function sink(name: string) {
  const file = path.join(dir, `${name}.flv`);
  const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-listen", "1", "-i", `rtmp://127.0.0.1:${ports[name]}/live/relay`, "-c", "copy", "-f", "flv", file], { stdio: "ignore" });
  const done = new Promise<void>((resolve) => child.on("close", () => resolve()));
  sinks.push({ name, file, child, done });
}

function probe(file: string) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name", "-of", "json", file], { encoding: "utf8" });
  const json = JSON.parse(r.stdout || "{}") as { format?: { duration?: string }; streams?: Array<{ codec_name: string }> };
  return { duration: Number(json.format?.duration ?? 0), codecs: (json.streams ?? []).map((s) => s.codec_name).sort() };
}

/** The picture's timestamps as the platform receives them, in order. */
function videoTimes(file: string): number[] {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=dts_time", "-of", "csv=p=0", file], { encoding: "utf8", maxBuffer: 1 << 24 });
  return r.stdout
    .split("\n")
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Livepeer's output for the live block, 2-second segments on the real clock (at the relay's size). */
function fakeLivepeerHls(from: number) {
  return http.createServer((req, res) => {
    const url = req.url ?? "";
    const v720 = scaledLadder(0.1).v720;
    if (url === "/hls/fake/index.m3u8") {
      res.end(["#EXTM3U", `#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=${v720.width}x${v720.height},CODECS="avc1.64001f,mp4a.40.2"`, "720p0/index.m3u8", ""].join("\n"));
      return;
    }
    if (url === "/hls/fake/720p0/index.m3u8" && Date.now() >= from) {
      const newest = Math.min(LIVE_SEGMENTS - 1, Math.floor((Date.now() - from) / 2_000));
      const first = Math.max(0, newest - 4);
      const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:2", `#EXT-X-MEDIA-SEQUENCE:${first}`];
      for (let i = first; i <= newest; i++) lines.push("#EXTINF:2.000,", `seg${i}.ts`);
      res.end(lines.join("\n") + "\n");
      return;
    }
    const seg = /^\/hls\/fake\/720p0\/(seg\d+\.ts)$/.exec(url);
    if (seg) {
      void fs.readFile(path.join(dir, "live", seg[1])).then(
        (b) => res.writeHead(200, { "content-type": "video/mp2t" }).end(b),
        () => res.writeHead(404).end()
      );
      return;
    }
    res.writeHead(404).end();
  });
}

beforeAll(async () => {
  h = await createHarness({ realTime: true });
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-relay-"));
  // The live source's output, as Livepeer segments it: 2 s each, timestamps running on.
  const v720 = scaledLadder(0.1).v720;
  await fs.mkdir(path.join(dir, "live"));
  const made = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc=size=${v720.width}x${v720.height}:rate=30:duration=${LIVE_SEGMENTS * 2}`, "-f", "lavfi", "-i", `sine=frequency=500:sample_rate=48000:duration=${LIVE_SEGMENTS * 2}`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-c:a", "aac", "-b:a", "96k", "-f", "hls", "-hls_time", "2", "-hls_list_size", "0", "-hls_segment_filename", path.join(dir, "live", "seg%d.ts"), path.join(dir, "live", "index.m3u8")]);
  if (made.status !== 0) throw new Error(String(made.stderr));

  const [program, ident, bumper] = await Promise.all([testClip(12), testClip(4), testClip(8)]);
  const m = await market(h);
  const kai = await h.signIn("Kai");
  t0 = Math.ceil((Date.now() + 15_000) / 4_000) * 4_000;
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  hls = fakeLivepeerHls(t0 + 24_000);
  await new Promise<void>((resolve) => hls.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(hls.address() as AddressInfo).port}`;
  let tenths = 171;
  for (const name of ["PLAIN", "SWAP", "BUGS"] as const) {
    const station = await stationFixture(h, { callSign: name, name, ownerId: kai.id, marketId: m.id, tenths: tenths++, signedOn: true });
    ids[name] = station.id;
    await kai.put(`/v1/stations/${station.id}/break-rule`, { mode: "after_every_program", everyMinutes: null, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "station_id_and_bumpers", blockedCategories: [] }).expect(200);
    await itemFixture(h, station.id, { title: "Ident", code: "SID", durationMs: 4_000, location: ident });
    await itemFixture(h, station.id, { title: "Bumper", code: "BMP", durationMs: 8_000, location: bumper });
    const show = await itemFixture(h, station.id, { title: "Show", durationMs: 12_000, location: program });
    // 12 s of program in a 24-second slot: a 12-second break after it.
    await kai.post(`/v1/stations/${station.id}/log`, { kind: "program", startsAt: at(0), endsAt: at(24), itemId: show.id }).expect(201);
    if (name === "PLAIN") {
      // A live block between two programs: the relay carries on through it.
      const [source] = await h.db.insert(schema.liveSources).values({ stationId: station.id, kind: "encoder", name: "Studio A", livepeerPlaybackId: "fake" }).returning();
      sourceId = source.id;
      const [live] = await h.db.insert(schema.programs).values({ stationId: station.id, title: "Town Hall", isLive: true }).returning();
      await kai.post(`/v1/stations/${station.id}/log`, { kind: "live", startsAt: at(24), endsAt: at(44), liveSourceId: source.id, programId: live.id }).expect(201);
      await kai.post(`/v1/stations/${station.id}/log`, { kind: "program", startsAt: at(44), endsAt: at(68), itemId: show.id }).expect(201);
    } else {
      await kai.post(`/v1/stations/${station.id}/log`, { kind: "program", startsAt: at(24), endsAt: at(48), itemId: show.id }).expect(201);
    }
    await kai.patch(`/v1/stations/${station.id}/relay`, { mode: "everything", bugOnRelays: name !== "PLAIN" && name !== "SWAP", breakHandling: name === "SWAP" ? "station_id_slate" : "air_spots" }).expect(200);
    destinations.set(station.id, [{ platformId: `${name}-yt`, kind: "youtube", rtmpUrl: "rtmp://a.rtmp.youtube.com/live2", streamKey: `yt-${name}`, connected: false }, { platformId: `${name}-tw`, kind: "twitch", rtmpUrl: "rtmp://live.twitch.tv/app", streamKey: `tw-${name}`, connected: false }]);
    await h.db.insert(schema.playoutState).values({ stationId: station.id, onAir: true });
    sink(name);
  }
  lp = await fakeLivepeerApi();
  // Each station's relay stream's ingest: its own local sink.
  const api = {
    ...lp.api,
    ingestUrl: (key: string) => {
      const stream = [...lp.streams.values()].find((s) => s.streamKey === key)!;
      return `rtmp://127.0.0.1:${ports[stream.name.split(" ")[0]]}/live/${key}`;
    }
  };
  engine = createEngine({ deps: h.deps, services: h.services }, { ladderScale: 0.1, preset: "ultrafast", log: () => undefined, liveUrl: async (id) => (id === sourceId ? `${origin}/hls/fake/index.m3u8` : null) });
  runner = createRelayRunner({ deps: h.deps, services: h.services }, { platforms, livepeer: api, fanOut: "livepeer", ladderScale: 0.1, preset: "ultrafast", log: () => undefined });
  // Everything prepared before the stations go on air.
  await engine.sweep();
  await prepareQueued(h, engine.preparer);
}, 120_000);

afterAll(async () => {
  await runner?.stopAll();
  await engine?.stopAll();
  for (const s of sinks) s.child.kill("SIGKILL");
  hls?.close();
  await lp?.close();
  await h.close();
});

describe("relays", () => {
  it("send one continuous stream per station to its Livepeer relay stream, live blocks included", async () => {
    const counts = { live: 0, slate: 0 };
    let outputs: Record<string, ReturnType<Fanout["status"]>> = {};
    while (Date.now() < t0 + 70_000) {
      await engine.tick();
      await runner.tick();
      const plain = runner.sender(ids.PLAIN) as StationSender | null;
      const swap = runner.sender(ids.SWAP) as StationSender | null;
      counts.live = Math.max(counts.live, plain?.liveSegments ?? 0);
      counts.slate = Math.max(counts.slate, swap?.slateSegments ?? 0);
      outputs = Object.fromEntries((["PLAIN", "SWAP", "BUGS"] as const).map((n) => [n, (runner.output(ids[n]) as Fanout | null)?.status() ?? []]));
      await new Promise((r) => setTimeout(r, 1_000 - (Date.now() % 1_000)));
    }
    await runner.stopAll();
    await engine.stopAll();
    await Promise.race([Promise.all(sinks.map((s) => s.done)), new Promise((r) => setTimeout(r, 10_000))]);

    // Livepeer: one relay stream per station, no transcoding, each platform a `source` target.
    for (const name of ["PLAIN", "SWAP", "BUGS"]) {
      const stream = [...lp.streams.values()].find((s) => s.name === `${name} relay`)!;
      expect(stream.profiles).toEqual([]);
      expect(stream.multistream.targets.map((t) => t.profile)).toEqual(["source", "source"]);
    }

    const sessions = await h.db.select().from(schema.translatorSessions);
    const by = (name: keyof typeof ids) => sessions.filter((s) => s.translatorId === ids[name]);
    // PLAIN: stream-copied, across its live block, in one session and one connection.
    expect(by("PLAIN")).toHaveLength(1);
    expect(by("PLAIN")[0]).toMatchObject({ mode: "copy", relayMode: "everything", platforms: 2, swapsBreaks: false });
    expect(counts.live).toBeGreaterThanOrEqual(5);
    expect(outputs.PLAIN).toEqual([expect.objectContaining({ id: "livepeer", starts: 1, errors: 0 })]);
    const plain = sinks.find((s) => s.name === "PLAIN")!.file;
    expect(probe(plain).duration).toBeGreaterThan(50);
    const times = videoTimes(plain);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...gaps)).toBeLessThan(1.5);
    // SWAP: the station ID slate in its break.
    expect(by("SWAP")[0]).toMatchObject({ mode: "copy", swapsBreaks: true });
    expect(counts.slate).toBeGreaterThan(0);
    // BUGS: the bug composited.
    expect(by("BUGS")[0]).toMatchObject({ mode: "composite" });
    for (const name of ["PLAIN", "SWAP", "BUGS"] as const) {
      // Egress (the one push), per station.
      expect(by(name).reduce((a, s) => a + s.bytesSent, 0)).toBeGreaterThan(10_000);
      expect(by(name).every((s) => s.endedAt !== null)).toBe(true);
      const { duration, codecs } = probe(sinks.find((s) => s.name === name)!.file);
      expect(codecs).toEqual(["aac", "h264"]);
      expect(duration).toBeGreaterThan(20);
    }
    const [state] = await h.db.select().from(schema.stationRelays).where(eq(schema.stationRelays.stationId, ids.PLAIN));
    expect(state.livepeerStreamId).toBeTruthy();
  }, 150_000);
});
