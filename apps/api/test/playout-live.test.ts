// A live block through Livepeer, against a local fake of Livepeer's HLS output (no Livepeer
// stream is created and nothing paid is called): the channel's playlists point at the source's
// segments while it's connected, air the prepared stand-by slate while it isn't, and come back to
// prepared segments when the block ends. On a frozen clock, so it doesn't depend on how fast
// anything runs: it checks the order of what aired, not exact counts.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { HLS_CLASS, parseDateRanges } from "@opencast/contracts";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { createHarness, dummyFile, fakeTranscoder, itemFixture, market, prepareQueued, stationFixture, type Harness } from "./harness.js";

let h: Harness;
let engine: Engine;
let stationId: string;
let sourceId: string;
let liveEntryId: string;
let server: http.Server;
let origin: string;
/** When the fake source is sending. */
const on = { from: Date.parse("2026-10-01T20:00:52.000Z"), to: Date.parse("2026-10-01T20:01:20.000Z") };

/** Livepeer's output as a player sees it: a master playlist, two renditions, 2-second segments on the clock. */
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
    res.statusCode = 404;
    res.end();
  });
}

async function runUntil(iso: string, each?: () => Promise<void>) {
  const end = Date.parse(iso);
  while (h.clock.now().getTime() < end) {
    h.clock.advance(1_000);
    await engine.tick();
    await prepareQueued(h, engine.preparer);
    await each?.();
  }
  await h.deps.bus.settle();
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-01T19:59:40.000Z");
  server = fakeLivepeer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const m = await market(h);
  const kai = await h.signIn("Kai");
  const station = await stationFixture(h, { callSign: "LIVE", name: "Live Test", ownerId: kai.id, marketId: m.id, tenths: 131, signedOn: true });
  stationId = station.id;
  await itemFixture(h, stationId, { title: "LIVE ident", code: "SID", durationMs: 4_000, location: await dummyFile() });
  const show = await itemFixture(h, stationId, { title: "Before and after", durationMs: 40_000, location: await dummyFile() });
  const [source] = await h.db.insert(schema.liveSources).values({ stationId, kind: "encoder", name: "Studio A", livepeerPlaybackId: "fake" }).returning();
  sourceId = source.id;
  const [program] = await h.db.insert(schema.programs).values({ stationId, title: "Town Hall", isLive: true }).returning();
  await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-01T20:00:00.000Z", endsAt: "2026-10-01T20:00:40.000Z", itemId: show.id }).expect(201);
  const live = await kai.post(`/v1/stations/${stationId}/log`, { kind: "live", startsAt: "2026-10-01T20:00:40.000Z", endsAt: "2026-10-01T20:01:40.000Z", liveSourceId: sourceId, programId: program.id }).expect(201);
  liveEntryId = live.body.id;
  await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-01T20:01:40.000Z", endsAt: "2026-10-01T20:02:20.000Z", itemId: show.id }).expect(201);
  await h.services.stations.setLowerThird(stationId, liveEntryId, program.id, kai.id, { hidden: false, speakerId: null, name: "Dana Whitfield", title: "Chair, Planning Commission" });
  await h.db.insert(schema.playoutState).values({ stationId, onAir: true });
  // Livepeer's playback address for the source, pointed at the fake.
  engine = createEngine({ deps: h.deps, services: h.services }, { transcoder: fakeTranscoder(), translators: false, liveUrl: async (id) => (id === sourceId ? `${origin}/hls/fake/index.m3u8` : null) });
}, 60_000);

afterAll(async () => {
  await engine?.stopAll();
  server?.close();
  await h.close();
});

const collapse = <T,>(xs: T[]) => xs.filter((x, i) => i === 0 || x !== xs[i - 1]);

describe("a live block", () => {
  let during = "";

  it("stands by without a signal, airs the source while it's there, stands by again, and hands back to the log", async () => {
    const standingBy: boolean[] = [];
    await runUntil("2026-10-01T20:02:30.000Z", async () => {
      const now = h.clock.now().getTime();
      if (now > Date.parse("2026-10-01T20:00:44Z") && now < Date.parse("2026-10-01T20:01:36Z")) {
        const [state] = await h.db.select().from(schema.playoutState).where(eq(schema.playoutState.stationId, stationId));
        standingBy.push(state.standingBy);
      }
      if (now === Date.parse("2026-10-01T20:01:12Z")) during = (await h.services.playout.playlist(stationId, "v720.m3u8"))!.body;
    });
    expect(collapse(standingBy)).toEqual([true, false, true]);

    const rows = await h.db.select().from(schema.asRun).where(eq(schema.asRun.stationId, stationId)).orderBy(asc(schema.asRun.startedAt));
    const fromEight = rows.filter((r) => r.startedAt >= new Date("2026-10-01T20:00:00Z"));
    expect(collapse(fromEight.map((r) => r.reason))).toEqual(["planned", "slate", "live", "slate", "planned"]);
    const live = fromEight.find((r) => r.reason === "live")!;
    expect(live).toMatchObject({ liveSourceId: sourceId, logEntryId: liveEntryId, code: "PGM" });
    // On air from the source within a few seconds of it connecting, until it dropped.
    expect(live.startedAt.getTime() - on.from).toBeGreaterThanOrEqual(0);
    expect(live.startedAt.getTime() - on.from).toBeLessThan(6_000);
    expect(Math.abs(live.endedAt.getTime() - on.to)).toBeLessThan(10_000);
    // Never silent: each thing starts where the last ended.
    for (let i = 1; i < fromEight.length; i++) expect(fromEight[i].startedAt.getTime()).toBe(fromEight[i - 1].endedAt.getTime());
    // Back to prepared segments after the block, from its end.
    const after = fromEight.filter((r) => r.startedAt >= new Date("2026-10-01T20:01:40Z"));
    expect(after[0]).toMatchObject({ code: "PGM", reason: "planned" });

    const notices = await h.db.select().from(schema.notices);
    expect(notices.some((n) => n.kind === "signal_lost")).toBe(true);
  }, 60_000);

  it("points the playlists at the source's segments during the block, in the same ladder", async () => {
    expect(during).toContain(`${origin}/hls/fake/720p0/`);
    const lines = during.split("\n");
    const firstLive = lines.findIndex((l) => l.startsWith(`${origin}/hls/fake/`));
    // A discontinuity into it, with its date-time and its tags.
    const before = lines.slice(0, firstLive).reverse();
    expect(before.findIndex((l) => l === "#EXT-X-DISCONTINUITY")).toBeGreaterThan(-1);
    expect(before.findIndex((l) => l === "#EXT-X-DISCONTINUITY")).toBeLessThan(before.findIndex((l) => l.endsWith(".ts")));
    expect(before.findIndex((l) => l.startsWith("#EXT-X-PROGRAM-DATE-TIME"))).toBeLessThan(before.findIndex((l) => l === "#EXT-X-DISCONTINUITY"));
    const ranges = parseDateRanges(during);
    expect(ranges.find((r) => r.class === HLS_CLASS.live)?.attributes).toMatchObject({ logEntryId: liveEntryId, sourceId });
    expect(ranges.find((r) => r.class === HLS_CLASS.lowerThird)?.attributes).toMatchObject({ name: "Dana Whitfield", title: "Chair, Planning Commission" });
    // The smaller renditions read the source's smaller one.
    const v360 = (await h.services.playout.playlist(stationId, "v360.m3u8"))!.body;
    expect(v360).toContain(`${origin}/hls/fake/360p0/`);
  });
});
