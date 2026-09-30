// A live block through Livepeer, against a local fake of Livepeer's HLS output (no Livepeer
// stream is created and nothing paid is called): the channel's playlists point at the worker's
// copies of the source's segments in storage while it's connected (since 2026-09-30: never at
// Livepeer's), air the prepared stand-by slate while it isn't, and come back to prepared segments
// when the block ends. Each of Livepeer's segments is fetched once however many viewers watch; the
// copies stay for the pause window after Livepeer's are gone, relays read them from storage, and
// they're pruned with their channel rows after two days. On a frozen clock, so it doesn't depend
// on how fast anything runs: it checks the order of what aired, not exact counts.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { HLS_CLASS, parseDateRanges } from "@opencast/contracts";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { pruneChannelItems } from "../src/v1/modules/playout/engine/assemble.js";
import { storedSegmentKey } from "../src/v1/modules/playout/engine/sender.js";
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
/** How many times each of the fake's segments was fetched. */
const fetched = new Map<string, number>();
/** A segment's bytes, as the fake serves them (so a copy can be checked against them). */
const bytesOf = (variant: string, i: number) => Buffer.from(`${variant} segment ${i} `.repeat(200));

/**
 * Livepeer's output as a player sees it: a master playlist, two picture renditions and an
 * audio-only one (so no FFmpeg here; the sound taken from pictures is playout-live-audio's), 2-second
 * segments on the clock, and each segment only while it's in the source's playlist.
 */
function fakeLivepeer() {
  return http.createServer((req, res) => {
    const now = h.clock.now().getTime();
    const url = req.url ?? "";
    const live = now >= on.from && now < on.to;
    const newest = Math.floor((now - on.from) / 2_000);
    if (url === "/hls/fake/index.m3u8") {
      res.end(["#EXTM3U", '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"', "720p0/index.m3u8", '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"', "360p0/index.m3u8", '#EXT-X-STREAM-INF:BANDWIDTH=130000,CODECS="mp4a.40.2"', "audio/index.m3u8", ""].join("\n"));
      return;
    }
    const seg = /^\/hls\/fake\/(720p0|360p0|audio)\/(\d+)\.ts$/.exec(url);
    if (seg && live && Number(seg[2]) <= newest && Number(seg[2]) >= newest - 4) {
      fetched.set(url, (fetched.get(url) ?? 0) + 1);
      res.setHeader("content-type", "video/mp2t");
      res.end(bytesOf(seg[1], Number(seg[2])));
      return;
    }
    const media = /^\/hls\/fake\/(720p0|360p0|audio)\/index\.m3u8$/.exec(url);
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
  engine = createEngine({ deps: h.deps, services: h.services }, { transcoder: fakeTranscoder(), liveUrl: async (id) => (id === sourceId ? `${origin}/hls/fake/index.m3u8` : null) });
}, 60_000);

afterAll(async () => {
  await engine?.stopAll();
  server?.close();
  await h.close();
});

const collapse = <T,>(xs: T[]) => xs.filter((x, i) => i === 0 || x !== xs[i - 1]);
/** Our copies: the worker's own live segments in storage. */
const OWN = /\/prepared\/live-[0-9a-f]{12}-[a-z0-9]+\/(v1080|v720|v480|v360|a128)\/seg_\d{5}\.ts$/;

async function stored(key: string): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  try {
    for await (const c of await h.deps.storage.objects.open!(key)) chunks.push(c as Buffer);
  } catch {
    return null;
  }
  return Buffer.concat(chunks);
}

async function liveRows() {
  return h.db.select().from(schema.channelItems).where(eq(schema.channelItems.stationId, stationId)).orderBy(asc(schema.channelItems.seq));
}

describe("a live block", () => {
  let during = "";
  let leaving = "";

  it("stands by without a signal, airs the source while it's there, stands by again, and hands back to the log", async () => {
    const standingBy: boolean[] = [];
    await runUntil("2026-10-01T20:02:30.000Z", async () => {
      const now = h.clock.now().getTime();
      if (now > Date.parse("2026-10-01T20:00:44Z") && now < Date.parse("2026-10-01T20:01:36Z")) {
        const [state] = await h.db.select().from(schema.playoutState).where(eq(schema.playoutState.stationId, stationId));
        standingBy.push(state.standingBy);
      }
      if (now === Date.parse("2026-10-01T20:01:12Z")) {
        during = (await h.services.playout.playlist(stationId, "v720.m3u8"))!.body;
        // A roomful of viewers reading the channel and its segments: all from storage.
        for (let v = 0; v < 25; v++) {
          const body = (await h.services.playout.playlist(stationId, "v720.m3u8"))!.body;
          for (const uri of body.split("\n").filter((l) => OWN.test(l))) expect(await stored(storedSegmentKey(uri)!)).not.toBeNull();
        }
      }
      if (now === Date.parse("2026-10-01T20:01:45Z")) leaving = (await h.services.playout.playlist(stationId, "v720.m3u8"))!.body;
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

  it("points the playlists at the worker's copies in storage during the block, never at Livepeer", async () => {
    expect(during).not.toContain(origin);
    const lines = during.split("\n");
    const firstLive = lines.findIndex((l) => OWN.test(l));
    expect(firstLive).toBeGreaterThan(-1);
    // A discontinuity into it, with its date-time and its tags.
    const before = lines.slice(0, firstLive).reverse();
    expect(before.findIndex((l) => l === "#EXT-X-DISCONTINUITY")).toBeGreaterThan(-1);
    expect(before.findIndex((l) => l === "#EXT-X-DISCONTINUITY")).toBeLessThan(before.findIndex((l) => l.endsWith(".ts")));
    expect(before.findIndex((l) => l.startsWith("#EXT-X-PROGRAM-DATE-TIME"))).toBeLessThan(before.findIndex((l) => l === "#EXT-X-DISCONTINUITY"));
    const ranges = parseDateRanges(during);
    expect(ranges.find((r) => r.class === HLS_CLASS.live)?.attributes).toMatchObject({ logEntryId: liveEntryId, sourceId });
    expect(ranges.find((r) => r.class === HLS_CLASS.lowerThird)?.attributes).toMatchObject({ name: "Dana Whitfield", title: "Chair, Planning Commission" });
    // Every rendition of the ladder from storage; the smaller ones copied from the source's smaller one.
    for (const r of ["v1080", "v480", "v360", "a128"]) {
      const body = (await h.services.playout.playlist(stationId, `${r}.m3u8`))!.body;
      expect(body).not.toContain(origin);
      expect(body.split("\n").some((l) => OWN.test(l))).toBe(true);
    }
    const rows = (await liveRows()).filter((r) => r.kind === "live");
    const v360 = rows.flatMap((r) => r.liveUris!.v360);
    const a128 = rows.flatMap((r) => r.liveUris!.a128);
    const [one] = rows;
    const seqOf = (uri: string) => Number(/seg_(\d{5})\.ts$/.exec(uri)![1]);
    // Byte for byte what Livepeer sent, for that segment and rendition.
    expect(await stored(storedSegmentKey(one.liveUris!.v720[0])!)).toEqual(bytesOf("720p0", seqOf(one.liveUris!.v720[0])));
    expect(await stored(storedSegmentKey(v360[0])!)).toEqual(bytesOf("360p0", seqOf(v360[0])));
    expect(await stored(storedSegmentKey(a128[0])!)).toEqual(bytesOf("audio", seqOf(a128[0])));
  });

  it("fetches each of Livepeer's segments once per rendition, however many viewers watched", () => {
    expect(fetched.size).toBeGreaterThanOrEqual(3 * 8);
    expect([...fetched.values()].every((n) => n === 1)).toBe(true);
    // Three variants (720p, 360p, audio) for five renditions: 1080p, 720p and 480p read Livepeer's 720p.
    const variants = new Set([...fetched.keys()].map((u) => u.split("/")[3]));
    expect([...variants].sort()).toEqual(["360p0", "720p0", "audio"]);
  });

  it("leaves the live block cleanly: a discontinuity and the next item's date-time after its last segment", () => {
    const lines = leaving.split("\n");
    const lastLive = lines.map((l, i) => (OWN.test(l) ? i : -1)).filter((i) => i >= 0).pop()!;
    expect(lastLive).toBeGreaterThan(-1);
    const next = lines.slice(lastLive + 1);
    const nextSegment = next.findIndex((l) => l.endsWith(".ts"));
    expect(next.slice(0, nextSegment)).toContain("#EXT-X-DISCONTINUITY");
    const pdt = next.slice(0, nextSegment).find((l) => l.startsWith("#EXT-X-PROGRAM-DATE-TIME:"))!;
    // The live stretch's date-time plus its lengths is where the next one starts.
    const before = lines.slice(0, lastLive + 1);
    const livePdt = before.map((l, i) => (l.startsWith("#EXT-X-PROGRAM-DATE-TIME:") ? i : -1)).filter((i) => i >= 0).pop()!;
    const lengths = before.slice(livePdt).filter((l) => l.startsWith("#EXTINF:")).map((l) => Math.round(Number(l.slice(8).split(",")[0]) * 1000));
    expect(Date.parse(pdt.split(":").slice(1).join(":"))).toBe(Date.parse(before[livePdt].split(":").slice(1).join(":")) + lengths.reduce((a, b) => a + b, 0));
  });

  it("can still be played back within the 30-minute window after Livepeer's segments are gone", async () => {
    // Twenty minutes on, paused since the block: Livepeer's session is over, its segments gone.
    h.clock.set("2026-10-01T20:21:00.000Z");
    const back = (await h.services.playout.playlist(stationId, "v720.m3u8"))!.body;
    const own = back.split("\n").filter((l) => OWN.test(l));
    expect(own.length).toBeGreaterThanOrEqual(8);
    for (const uri of own) expect(await stored(storedSegmentKey(uri)!)).not.toBeNull();
    const gone = await fetch(`${origin}/hls/fake/720p0/${/seg_(\d{5})/.exec(own[0])![1].replace(/^0+(?=\d)/, "")}.ts`);
    expect(gone.status).toBe(404);
  });

  it("is read by relays from storage, like prepared segments (the sender never fetches Livepeer)", async () => {
    const rows = (await liveRows()).filter((r) => r.kind === "live");
    for (const r of rows) {
      for (const uri of r.liveUris!.v720) {
        const key = storedSegmentKey(uri);
        expect(key).toMatch(/^prepared\/live-/);
        expect(await stored(key!)).not.toBeNull();
      }
    }
  });

  it("goes with its channel rows after two days", async () => {
    const keys = (await liveRows()).filter((r) => r.kind === "live").flatMap((r) => Object.values(r.liveUris!).flat()).map((u) => storedSegmentKey(u)!);
    expect(keys.length).toBeGreaterThan(0);
    h.clock.set("2026-10-03T19:00:00.000Z");
    await pruneChannelItems({ deps: h.deps, services: h.services });
    expect(await stored(keys[0])).not.toBeNull();
    h.clock.set("2026-10-03T21:00:00.000Z");
    await pruneChannelItems({ deps: h.deps, services: h.services });
    expect((await liveRows()).filter((r) => r.kind === "live")).toEqual([]);
    for (const key of keys) expect(await stored(key)).toBeNull();
  });
});
