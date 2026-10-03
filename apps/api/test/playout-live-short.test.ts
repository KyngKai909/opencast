// A short live block whose source connects a few seconds late (added 2026-10-02): the stand-by
// slate airs first, then the source, then the log after the block. Before, the stand-by slate was
// written to the block's end (all of a block shorter than a minute), the channel moved on to what
// follows, and the source never aired: what the real-time relay test (playout-relay.test.ts) hit
// on GitHub's runners whenever the channel's timeline ran at or just after the block's start. On a
// frozen clock that starts on a whole second, so the timeline runs exactly on the log's times.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { createHarness, dummyFile, fakeTranscoder, itemFixture, market, prepareQueued, stationFixture, type Harness } from "./harness.js";

let h: Harness;
let engine: Engine;
let stationId: string;
let sourceId: string;
let server: http.Server;
/** The block: 20 s. The source sends from 4 s into it until after it. */
const block = { from: Date.parse("2026-10-01T20:00:40.000Z"), to: Date.parse("2026-10-01T20:01:00.000Z") };
const on = { from: block.from + 4_000, to: block.to + 10_000 };

/** Livepeer's output: a picture rendition and an audio-only one, 2-second segments on the clock. */
function fakeLivepeer() {
  return http.createServer((req, res) => {
    const now = h.clock.now().getTime();
    const url = req.url ?? "";
    const live = now >= on.from && now < on.to;
    const newest = Math.floor((now - on.from) / 2_000);
    if (url === "/hls/fake/index.m3u8") {
      res.end(["#EXTM3U", '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"', "720p0/index.m3u8", '#EXT-X-STREAM-INF:BANDWIDTH=130000,CODECS="mp4a.40.2"', "audio/index.m3u8", ""].join("\n"));
      return;
    }
    const seg = /^\/hls\/fake\/(720p0|audio)\/(\d+)\.ts$/.exec(url);
    if (seg && live && Number(seg[2]) <= newest) {
      res.setHeader("content-type", "video/mp2t");
      res.end(Buffer.from(`${seg[1]} segment ${seg[2]} `.repeat(200)));
      return;
    }
    const media = /^\/hls\/fake\/(720p0|audio)\/index\.m3u8$/.exec(url);
    if (media && live) {
      const first = Math.max(0, newest - 4);
      const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:2", `#EXT-X-MEDIA-SEQUENCE:${first}`];
      for (let i = first; i <= newest; i++) lines.push("#EXTINF:2.000,", `${i}.ts`);
      res.end(lines.join("\n") + "\n");
      return;
    }
    res.statusCode = 404;
    res.end();
  });
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-01T19:59:40.000Z");
  server = fakeLivepeer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const m = await market(h);
  const kai = await h.signIn("Kai");
  const station = await stationFixture(h, { callSign: "SHRT", name: "Short Live", ownerId: kai.id, marketId: m.id, tenths: 133, signedOn: true });
  stationId = station.id;
  await itemFixture(h, stationId, { title: "SHRT ident", code: "SID", durationMs: 4_000, location: await dummyFile() });
  const show = await itemFixture(h, stationId, { title: "Before and after", durationMs: 40_000, location: await dummyFile() });
  const [source] = await h.db.insert(schema.liveSources).values({ stationId, kind: "encoder", name: "Studio A", livepeerPlaybackId: "fake" }).returning();
  sourceId = source.id;
  const [program] = await h.db.insert(schema.programs).values({ stationId, title: "Town Hall", isLive: true }).returning();
  await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-01T20:00:00.000Z", endsAt: "2026-10-01T20:00:40.000Z", itemId: show.id }).expect(201);
  await kai.post(`/v1/stations/${stationId}/log`, { kind: "live", startsAt: new Date(block.from).toISOString(), endsAt: new Date(block.to).toISOString(), liveSourceId: sourceId, programId: program.id }).expect(201);
  await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-01T20:01:00.000Z", endsAt: "2026-10-01T20:01:40.000Z", itemId: show.id }).expect(201);
  await h.db.insert(schema.playoutState).values({ stationId, onAir: true });
  engine = createEngine({ deps: h.deps, services: h.services }, { transcoder: fakeTranscoder(), liveUrl: async (id) => (id === sourceId ? `${origin}/hls/fake/index.m3u8` : null) });
}, 60_000);

afterAll(async () => {
  await engine?.stopAll();
  server?.close();
  await h.close();
});

const collapse = <T,>(xs: T[]) => xs.filter((x, i) => i === 0 || x !== xs[i - 1]);

describe("a short live block whose source connects late", () => {
  it("stands by, airs the source for the rest of the block, then hands back to the log", async () => {
    while (h.clock.now().getTime() < Date.parse("2026-10-01T20:01:45.000Z")) {
      h.clock.advance(1_000);
      await engine.tick();
      await prepareQueued(h, engine.preparer);
    }
    await h.deps.bus.settle();

    const rows = await h.db.select().from(schema.channelItems).where(eq(schema.channelItems.stationId, stationId)).orderBy(asc(schema.channelItems.seq));
    const live = rows.filter((r) => r.kind === "live");
    expect(live.length).toBeGreaterThan(0);
    // On air from the source within a few seconds of it connecting, to the block's end.
    expect(live[0].startsAt.getTime() - on.from).toBeGreaterThanOrEqual(0);
    expect(live[0].startsAt.getTime() - on.from).toBeLessThan(6_000);
    expect(live[live.length - 1].endsAt.getTime()).toBe(block.to);
    expect(live.reduce((a, r) => a + r.segments, 0)).toBeGreaterThanOrEqual(5);

    const asRun = await h.db.select().from(schema.asRun).where(eq(schema.asRun.stationId, stationId)).orderBy(asc(schema.asRun.startedAt));
    const fromEight = asRun.filter((r) => r.startedAt >= new Date("2026-10-01T20:00:00Z"));
    expect(collapse(fromEight.map((r) => r.reason))).toEqual(["planned", "slate", "live", "planned"]);
    // Never silent: each thing starts where the last ended, and the log after the block on time.
    for (let i = 1; i < fromEight.length; i++) expect(fromEight[i].startedAt.getTime()).toBe(fromEight[i - 1].endedAt.getTime());
    expect(fromEight.find((r) => r.startedAt.getTime() >= block.to)).toMatchObject({ code: "PGM", reason: "planned", startedAt: new Date(block.to) });
  }, 60_000);
});
