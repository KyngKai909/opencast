// Prepare once, then assemble, without FFmpeg: items are "prepared" by a fake transcoder (a few
// bytes per 4-second segment), and the channel is assembled on a frozen clock stepped forward.
// Checks the playlists' text (segments in log order, discontinuities, program date-times, the
// DATERANGE tags), the as-run log written as segments are published, dead-air auto-fill, the
// readiness check, and the log snapping to segment boundaries.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { HLS_ATTRIBUTES, HLS_CLASS, parseDateRanges } from "@opencast/contracts";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { renderMedia, type ChannelRow } from "../src/v1/modules/playout/engine/playlist.js";
import { decodeSpliceInsert } from "../src/v1/modules/playout/engine/scte35.js";
import { createHarness, dummyFile, fakeTranscoder, itemFixture, market, prepareQueued, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let beat: { id: string };
let engine: Engine;
let spotId: string;
let programCid: string;
let brokenId: string;
let brokenEntryId: string;
const fake = fakeTranscoder();
const logs: string[] = [];
const $ = (d: number) => Math.round(d * 1_000_000);

/** Steps the frozen clock to `iso`, ticking the engine every `stepMs`. */
async function runUntil(iso: string, stepMs = 2_000) {
  const end = Date.parse(iso);
  while (h.clock.now().getTime() < end) {
    h.clock.advance(Math.min(stepMs, end - h.clock.now().getTime()));
    await engine.tick();
    await prepareQueued(h, engine.preparer);
  }
  await h.deps.bus.settle();
}

const playlistAt = async (rendition = "v720") => (await h.services.playout.playlist(beat.id, `${rendition}.m3u8`))!.body;
const asRun = async () => h.db.select().from(schema.asRun).where(eq(schema.asRun.stationId, beat.id)).orderBy(asc(schema.asRun.startedAt));

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-02T02:59:10.000Z");
  const m = await market(h);
  kai = await h.signIn("Kai");
  const jess = await h.signIn("Jess");
  beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true, colour: "#8C3B7A" });
  await kai
    .put(`/v1/stations/${beat.id}/break-rule`, { mode: "after_every_program", everyMinutes: null, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 4, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "spot_market", blockedCategories: [] })
    .expect(200);
  await itemFixture(h, beat.id, { title: "BEAT ident", code: "SID", durationMs: 4_000, location: await dummyFile() });
  // A 4-second bumper: one opens the break and one closes it (since 2026-09-29), with room for the spot between.
  await itemFixture(h, beat.id, { title: "Back to the reel", code: "BMP", durationMs: 4_000, location: await dummyFile() });
  const show = await itemFixture(h, beat.id, { title: "Late Crate", durationMs: 36_000, location: await dummyFile() });
  programCid = (await h.services.library.currentContent([show.id])).get(show.id)!;
  // An 80-second slot: 36 s of program, then a 44-second break. Then a 40-second slot (a 4-second break).
  await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-02T03:00:00.000Z", endsAt: "2026-10-02T03:01:20.000Z", itemId: show.id }).expect(201);
  await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-02T03:01:20.000Z", endsAt: "2026-10-02T03:02:00.000Z", itemId: show.id }).expect(201);

  const b = await jess.post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online", marketIds: [m.id] }).expect(201);
  const card = await jess.post(`/v1/businesses/${b.body.id}/funding-sources`, { kind: "card", token: "tok_4417" }).expect(201);
  await jess.post(`/v1/businesses/${b.body.id}/deposits`, { amountMicros: $(100), fundingSourceId: card.body[0].id }).expect(201);
  const s = await jess
    .post(`/v1/businesses/${b.body.id}/spots`, { title: "Fall menu", lengthSec: 15, category: "Food", rate: { kind: "per_airing", micros: $(4) }, budget: { totalMicros: $(40), dailyCapMicros: $(12) }, code: { code: "ORANGE10", offer: "10% off", windowDays: 7 } })
    .expect(201);
  spotId = s.body.id;
  const { cid } = await h.services.library.content.store(await dummyFile(), { storageClass: "standard" });
  await h.db.insert(schema.spotFiles).values({ spotId, version: 1, contentId: cid, durationMs: 15_000 });
  await h.db.update(schema.spotsTable).set({ status: "listed" }).where(eq(schema.spotsTable.id, spotId));
  await kai.put(`/v1/stations/${beat.id}/rotations/main`, { spotIds: [spotId] }).expect(200);
  const sponsorship = await jess.post(`/v1/businesses/${b.body.id}/sponsorships`, { stationId: beat.id, monthlyMicros: $(25), creditText: "Orange Street Coffee, roasting in Redlands.", startsOn: "2026-10-01" }).expect(201);
  await kai.post(`/v1/sponsorships/${sponsorship.body.id}/decision`, { decision: "approve" }).expect(200);
  // An item whose file won't prepare (the readiness check).
  const broken = await itemFixture(h, beat.id, { title: "Borrowed Tape", durationMs: 20_000, location: await dummyFile() });
  brokenId = broken.id;
  fake.fail.add((await h.services.library.currentContent([broken.id])).get(broken.id)!);
  brokenEntryId = (await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-02T03:40:00.000Z", endsAt: "2026-10-02T03:41:00.000Z", itemId: broken.id }).expect(201)).body.id;
  await h.db.insert(schema.playoutState).values({ stationId: beat.id, onAir: true });

  engine = createEngine({ deps: h.deps, services: h.services }, { transcoder: fake, log: (l) => logs.push(l) });
}, 60_000);

afterAll(async () => {
  await engine?.stopAll();
  await h.close();
});

describe("preparing what's on the log", () => {
  it("queues everything in the next 48 hours, earliest first, and prepares each content ID once", async () => {
    await engine.tick();
    const queued = await h.db.select().from(schema.preparedItems);
    expect(queued.map((q) => q.key)).toContain(programCid);
    // The program is on the log twice: one item to prepare.
    expect(queued.filter((q) => q.key === programCid)).toHaveLength(1);
    expect(queued.find((q) => q.key === programCid)!.renditions).toEqual(["a128", "v1080", "v360", "v480", "v720"]);
    await prepareQueued(h, engine.preparer);
    expect(fake.jobs.filter((k) => k === programCid)).toHaveLength(1);
    const renditions = await h.db.select().from(schema.preparedRenditions).where(eq(schema.preparedRenditions.key, programCid));
    expect(renditions.map((r) => [r.rendition, r.segmentMs])).toContainEqual(["v720", [4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000]]);
    // Stored under the content ID.
    expect(await h.deps.storage.objects.has(`prepared/${programCid}/v720/seg_00008.ts`)).toBe(true);
  });

  it("counts items for the Monitor, not log entries (G13): the program on twice counts once", async () => {
    const now = h.clock.now();
    const entries = (await h.services.log.entries(beat.id, now, new Date(now.getTime() + 48 * 3_600_000))).filter((e) => e.kind === "program" && e.assetId);
    const items = new Set(entries.map((e) => e.assetId));
    expect(entries.length).toBeGreaterThan(items.size);
    const status = await kai.get(`/v1/stations/${beat.id}/playout`).expect(200);
    expect(status.body.readiness.items).toBe(items.size);
    expect(status.body.readiness.ready + status.body.readiness.failed + status.body.readiness.preparing).toBe(items.size);
  });
});

describe("the channel's playlists", () => {
  it("point at prepared segments in log order, with discontinuities, program date-times and the tags", async () => {
    await runUntil("2026-10-02T03:02:10.000Z");
    const master = (await h.services.playout.playlist(beat.id, "master.m3u8"))!.body;
    expect(master.split("\n").filter((l) => !l.startsWith("#") && l.trim())).toEqual(["v720.m3u8", "v1080.m3u8", "v480.m3u8", "v360.m3u8", "a128.m3u8"]);
    expect(master).toContain('CODECS="mp4a.40.2"');

    const text = await playlistAt();
    const lines = text.split("\n");
    expect(lines.slice(0, 3)).toEqual(["#EXTM3U", "#EXT-X-VERSION:6", "#EXT-X-TARGETDURATION:4"]);
    expect(lines.find((l) => l.startsWith("#EXT-X-MEDIA-SEQUENCE:"))).toBe("#EXT-X-MEDIA-SEQUENCE:0");
    expect(text).not.toContain("#EXT-X-ENDLIST");
    // Every DATERANGE is one the contract knows, with valid attributes.
    const ranges = parseDateRanges(text);
    for (const r of ranges) expect(HLS_ATTRIBUTES[r.class as keyof typeof HLS_ATTRIBUTES].safeParse(r.attributes).success).toBe(true);

    // The items from 3:00, in log order: program, the break (bumper in, spot, credit, bumper out, station ID), program, station ID.
    const items = ranges.filter((r) => r.class === HLS_CLASS.item && r.start >= Date.parse("2026-10-02T03:00:00Z") && r.start < Date.parse("2026-10-02T03:02:00Z"));
    expect(items.map((r) => `${new Date(r.start).toISOString().slice(11, 19)} ${r.attributes.code} ${(r.end! - r.start) / 1000}`)).toEqual([
      "03:00:00 PGM 36",
      "03:00:36 BMP 4",
      "03:00:40 SPT 15",
      "03:00:55 UND 15",
      "03:01:10 BMP 4",
      "03:01:16 SID 4",
      "03:01:20 PGM 36",
      "03:01:56 SID 4"
    ]);
    expect(items[0].attributes).toMatchObject({ code: "PGM", contentId: programCid, title: "Late Crate" });

    // Each item: a discontinuity before it and a program date-time on its first segment.
    const at = (iso: string) => lines.indexOf(`#EXT-X-PROGRAM-DATE-TIME:${iso}`);
    for (const iso of ["2026-10-02T03:00:00.000Z", "2026-10-02T03:00:36.000Z", "2026-10-02T03:01:20.000Z"]) {
      const i = at(iso);
      expect(i).toBeGreaterThan(0);
      const before = lines.slice(0, i).reverse();
      expect(before.findIndex((l) => l === "#EXT-X-DISCONTINUITY")).toBeLessThan(before.findIndex((l) => l.startsWith("#EXTINF")));
    }
    const program = at("2026-10-02T03:00:00.000Z");
    expect(lines.slice(program + 1, program + 3)).toEqual(["#EXTINF:4.000,", `/objects/prepared/${programCid}/v720/seg_00000.ts`]);
    expect(lines.filter((l) => l === "#EXT-X-DISCONTINUITY").length).toBe(lines.filter((l) => l.startsWith("#EXT-X-PROGRAM-DATE-TIME")).length - 1);

    // The break: SCTE-35 out and in, for its whole length.
    const brk = ranges.find((r) => r.class === HLS_CLASS.break && r.start === Date.parse("2026-10-02T03:00:36Z"))!;
    expect(brk.end! - brk.start).toBe(44_000);
    expect(decodeSpliceInsert(Buffer.from(brk.scte35Out!.slice(2), "hex"))).toMatchObject({ outOfNetwork: true, durationMs: 44_000, crcOk: true });
    expect(decodeSpliceInsert(Buffer.from(brk.scte35In!.slice(2), "hex"))).toMatchObject({ outOfNetwork: false, crcOk: true });
    // The bug over the program (not over the credit or station ID); the spot's code for its last 10 s.
    const bugs = ranges.filter((r) => r.class === HLS_CLASS.bug);
    expect(bugs.some((r) => r.start === Date.parse("2026-10-02T03:00:00Z") && r.attributes.callSign === "BEAT" && r.attributes.channel === "12.1" && r.attributes.position === "bottom_right")).toBe(true);
    expect(bugs.some((r) => r.start === Date.parse("2026-10-02T03:00:55Z"))).toBe(false);
    const code = ranges.find((r) => r.class === HLS_CLASS.code)!;
    expect(new Date(code.start).toISOString()).toBe("2026-10-02T03:00:45.000Z");
    expect(code.attributes).toMatchObject({ spotId, code: "ORANGE10", offer: "10% off", qrUrl: `https://app.opencast.test/c/ORANGE10?s=${beat.id}` });

    // The audio-only rendition points at its own segments, the same way.
    expect(await playlistAt("a128")).toContain(`/objects/prepared/${programCid}/a128/seg_00000.ts`);
  }, 60_000);

  it("writes an as-run entry for every item once its segments are published, with their program date-times", async () => {
    const rows = (await asRun()).filter((r) => r.startedAt >= new Date("2026-10-02T03:00:00Z") && r.startedAt < new Date("2026-10-02T03:02:00Z"));
    expect(rows.map((r) => `${r.startedAt.toISOString().slice(11, 19)}-${r.endedAt.toISOString().slice(11, 19)} ${r.code} ${r.reason}`)).toEqual([
      "03:00:00-03:00:36 PGM planned",
      "03:00:36-03:00:40 BMP planned",
      "03:00:40-03:00:55 SPT rotation",
      "03:00:55-03:01:10 UND planned",
      "03:01:10-03:01:14 BMP planned",
      "03:01:14-03:01:16 OPEN planned",
      "03:01:16-03:01:20 SID planned",
      "03:01:20-03:01:56 PGM planned",
      "03:01:56-03:02:00 SID planned"
    ]);
    // Billing reads it: the spot was paid for from its as-run entry.
    expect(rows[2].airingId).toBeTruthy();
    expect((await h.services.ledger.stationEarnings(beat.id, "month")).account.availableMicros).toBe($(4));
    // Before 3:00 nothing was on the log: station ID and bumpers, never nothing.
    expect((await asRun()).filter((r) => r.startedAt < new Date("2026-10-02T03:00:00Z")).every((r) => r.reason === "station_id_fill")).toBe(true);
  });

  it("fills dead air nobody filled from the library, and airs it", async () => {
    await runUntil("2026-10-02T03:03:10.000Z");
    const rows = (await asRun()).filter((r) => r.startedAt >= new Date("2026-10-02T03:02:00Z"));
    expect(rows[0]).toMatchObject({ code: "PGM", reason: "dead_air_fill", startedAt: new Date("2026-10-02T03:02:00Z") });
    const notices = await h.db.select().from(schema.notices).where(eq(schema.notices.kind, "dead_air_filled"));
    expect(notices.length).toBeGreaterThan(0);
  }, 60_000);

  it("tells the Monitor, the dial and the guide where the channel plays", async () => {
    const status = await kai.get(`/v1/stations/${beat.id}/playout`).expect(200);
    expect(status.body.output.playbackUrl).toBe(`/hls/${beat.id}/master.m3u8`);
    expect(status.body.readiness.items).toBeGreaterThan(0);
    const dial = await h.services.playout.statusFor([beat.id]);
    expect(dial.get(beat.id)).toMatchObject({ onAir: true, playbackUrl: `/hls/${beat.id}/master.m3u8`, standingBy: false });
  });
});

describe("the readiness check", () => {
  it("warns an hour ahead about an item that isn't prepared, and airs the usual fill if it still isn't", async () => {
    await engine.sweep();
    await prepareQueued(h, engine.preparer);
    await engine.warnNotReady();
    await h.deps.bus.settle();
    const warned = await h.db.select().from(schema.notices).where(eq(schema.notices.kind, "file_not_ready"));
    expect(warned.some((n) => /Borrowed Tape isn't ready for/.test(n.title))).toBe(true);
    const status = await kai.get(`/v1/stations/${beat.id}/playout`).expect(200);
    // G13: the airing's log entry, to link to; G14: failed told apart from on its way.
    expect(status.body.readiness.firstNotReady).toMatchObject({ itemId: brokenId, title: "Borrowed Tape", status: "failed", entryId: brokenEntryId, airsAt: "2026-10-02T03:40:00.000Z" });
    expect(status.body.readiness.failed).toBe(1);
    const checks = await kai.get(`/v1/stations/${beat.id}/sign-on/checks`).expect(200);
    const prepared = checks.body.checks.find((c: { key: string }) => c.key === "items_prepared");
    expect(prepared).toMatchObject({ passed: false, blocking: false });
    expect(prepared.preparation).toMatchObject({ failed: 1, firstFailed: { itemId: brokenId, title: "Borrowed Tape", entryId: brokenEntryId, airsAt: "2026-10-02T03:40:00.000Z" } });
    expect(prepared.preparation.ready + prepared.preparation.failed + prepared.preparation.preparing).toBe(prepared.preparation.items);
    expect(prepared.detail).toMatch(/1 couldn't be prepared \(its file needs replacing\)/);

    // At air: station ID and bumpers in its place, and the station is told it didn't air.
    h.clock.set("2026-10-02T03:39:30.000Z");
    await runUntil("2026-10-02T03:40:30.000Z");
    const rows = (await asRun()).filter((r) => r.startedAt >= new Date("2026-10-02T03:40:00Z"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.assetId !== brokenId)).toBe(true);
    const missed = await h.db.select().from(schema.notices).where(eq(schema.notices.kind, "file_not_ready"));
    expect(missed.some((n) => /Borrowed Tape didn't air/.test(n.title))).toBe(true);
  }, 60_000);
});

describe("the log's segment boundaries", () => {
  it("rounds times it's sent to the nearest 4-second boundary", async () => {
    const item = await itemFixture(h, beat.id, { title: "Snapped", durationMs: 30_000 });
    const entry = await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-02T05:00:01.500Z", endsAt: "2026-10-02T05:01:03.000Z", itemId: item.id }).expect(201);
    expect(entry.body).toMatchObject({ startsAt: "2026-10-02T05:00:00.000Z", endsAt: "2026-10-02T05:01:04.000Z" });
    const moved = await kai.patch(`/v1/stations/${beat.id}/log/${entry.body.id}`, { startsAt: "2026-10-02T05:10:02.100Z", endsAt: "2026-10-02T05:10:41.900Z" }).expect(200);
    expect(moved.body).toMatchObject({ startsAt: "2026-10-02T05:10:04.000Z", endsAt: "2026-10-02T05:10:40.000Z" });
  });
});

describe("the playlist window", () => {
  const row = (over: Partial<ChannelRow>): ChannelRow => ({ id: "r", run: 1, seq: 0, disc: 0, discontinuity: true, startsAt: new Date(0), endsAt: new Date(0), kind: "prepared", preparedKey: "k", firstSegment: 0, segments: 3, segmentMs: [4000, 4000, 4000], liveUris: null, tags: [], ...over });
  const base = { rendition: "v720" as const, lengths: () => null, uri: (key: string, i: number) => `${key}/${i}.ts` };
  const rows = [
    row({ id: "a", seq: 10, disc: 3, startsAt: new Date(0), preparedKey: "a", tags: ["#EXT-X-DATERANGE:ID=\"a\""] }),
    row({ id: "b", seq: 13, disc: 4, startsAt: new Date(12_000), preparedKey: "b", firstSegment: 5, segments: 2, segmentMs: [4000, 1500], tags: ["#EXT-X-DATERANGE:ID=\"b\""] })
  ];

  it("publishes segments once their time has passed, and counts sequences from the window's start", () => {
    const early = renderMedia({ ...base, rows, now: 9_000 })!;
    expect(early).toContain("#EXT-X-MEDIA-SEQUENCE:10");
    expect(early.match(/#EXTINF/g)).toHaveLength(2);
    // Starting mid-item: its tags and date-time still come first; the discontinuity sequence is that item's.
    const later = renderMedia({ ...base, rows, now: 17_500, windowMs: 13_000 })!;
    expect(later.split("\n").slice(3, 8)).toEqual(["#EXT-X-MEDIA-SEQUENCE:11", "#EXT-X-DISCONTINUITY-SEQUENCE:3", '#EXT-X-DATERANGE:ID="a"', "#EXT-X-PROGRAM-DATE-TIME:1970-01-01T00:00:04.000Z", "#EXTINF:4.000,"]);
    expect(later).toContain('#EXT-X-DISCONTINUITY\n#EXT-X-DATERANGE:ID="b"\n#EXT-X-PROGRAM-DATE-TIME:1970-01-01T00:00:12.000Z\n#EXTINF:4.000,\nb/5.ts\n#EXTINF:1.500,\nb/6.ts');
    // The window starting at an item: no discontinuity tag before the first segment, and the sequence counts it.
    const edge = renderMedia({ ...base, rows, now: 17_500, windowMs: 5_000 })!;
    expect(edge).toContain("#EXT-X-DISCONTINUITY-SEQUENCE:4");
    expect(edge).not.toContain("#EXT-X-DISCONTINUITY\n");
  });
});
