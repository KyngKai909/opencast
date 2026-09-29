// Found running the Phase 5 evening (docs/phase-5-demo.md), without FFmpeg, on a frozen clock:
//
//   - a station that goes on air after the worker's hourly readiness check had its station ID,
//     bumpers and spots queued for preparation only at the next check, so the spots placed in its
//     breaks (money held) weren't prepared at air time and the station ID slate aired in their
//     place. A station going on air is now checked on the next tick, and spots are queued as
//     they're placed;
//   - taking an entry off the log failed once its break was stored, and an edit near air wasn't
//     read by playout until its plan ran out;
//   - an as-run row whose entry or break had gone since it was written was never recorded, and
//     held up every row after it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { createHarness, dummyFile, fakeTranscoder, itemFixture, market, prepareQueued, stationFixture, type Harness } from "./harness.js";

let h: Harness;
let engine: Engine;
let beatId: string;
let spotCid: string;
let bumperCid: string;
let kaiUser: import("./harness.js").User;
let showId: string;
const fake = fakeTranscoder();
const logs: string[] = [];
const $ = (d: number) => Math.round(d * 1_000_000);

async function runUntil(iso: string, stepMs = 2_000) {
  const end = Date.parse(iso);
  while (h.clock.now().getTime() < end) {
    h.clock.advance(Math.min(stepMs, end - h.clock.now().getTime()));
    await engine.tick();
    await prepareQueued(h, engine.preparer);
  }
  await h.deps.bus.settle();
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-02T02:58:00.000Z");
  // The worker is already running (its readiness check done) before the station exists.
  engine = createEngine({ deps: h.deps, services: h.services }, { transcoder: fake, translators: false, log: (line) => logs.push(line) });
  await engine.tick();

  const m = await market(h);
  const kai = await h.signIn("Kai");
  kaiUser = kai;
  const jess = await h.signIn("Jess");
  const beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true });
  beatId = beat.id;
  await kai
    .put(`/v1/stations/${beat.id}/break-rule`, { mode: "after_every_program", everyMinutes: null, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 4, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "spot_market", blockedCategories: [] })
    .expect(200);
  await itemFixture(h, beat.id, { title: "BEAT ident", code: "SID", durationMs: 4_000, location: await dummyFile() });
  const bumper = await itemFixture(h, beat.id, { title: "Back to the reel", code: "BMP", durationMs: 8_000, location: await dummyFile() });
  bumperCid = (await h.services.library.currentContent([bumper.id])).get(bumper.id)!;
  const show = await itemFixture(h, beat.id, { title: "Late Crate", durationMs: 36_000, location: await dummyFile() });
  showId = show.id;
  // 36 s of program, then a 44-second break.
  await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-02T03:00:00.000Z", endsAt: "2026-10-02T03:01:20.000Z", itemId: show.id }).expect(201);
  await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-02T03:01:20.000Z", endsAt: "2026-10-02T03:02:00.000Z", itemId: show.id }).expect(201);

  const b = await jess.post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online", marketIds: [m.id] }).expect(201);
  const card = await jess.post(`/v1/businesses/${b.body.id}/funding-sources`, { kind: "card", token: "tok_4417" }).expect(201);
  await jess.post(`/v1/businesses/${b.body.id}/deposits`, { amountMicros: $(100), fundingSourceId: card.body[0].id }).expect(201);
  const s = await jess.post(`/v1/businesses/${b.body.id}/spots`, { title: "Fall menu", lengthSec: 15, category: "Food", rate: { kind: "per_airing", micros: $(4) }, budget: { totalMicros: $(40), dailyCapMicros: $(12) } }).expect(201);
  const { cid } = await h.services.library.content.store(await dummyFile(), { storageClass: "standard" });
  spotCid = cid;
  await h.db.insert(schema.spotFiles).values({ spotId: s.body.id, version: 1, contentId: cid, durationMs: 15_000 });
  await h.db.update(schema.spotsTable).set({ status: "listed" }).where(eq(schema.spotsTable.id, s.body.id));
  await kai.put(`/v1/stations/${beat.id}/rotations/main`, { spotIds: [s.body.id] }).expect(200);
  // On air now, well inside the hour after the worker's last readiness check.
  await h.db.insert(schema.playoutState).values({ stationId: beat.id, onAir: true });
}, 60_000);

afterAll(async () => {
  await engine?.stopAll();
  await h.close();
});

describe("a station that goes on air between readiness checks", () => {
  it("has its bumpers and the spots placed in its breaks prepared before they air", async () => {
    await runUntil("2026-10-02T02:58:30.000Z");
    expect(engine.preparer.isReady(bumperCid, "tv")).toBe(true);
    expect(engine.preparer.isReady(spotCid, "tv")).toBe(true);

    await runUntil("2026-10-02T03:01:30.000Z");
    const aired = await h.db.select().from(schema.asRun).where(eq(schema.asRun.stationId, beatId)).orderBy(asc(schema.asRun.startedAt));
    const breakRows = aired.filter((r) => r.startedAt.getTime() >= Date.parse("2026-10-02T03:00:36Z") && r.startedAt.getTime() < Date.parse("2026-10-02T03:01:20Z"));
    // The held airing aired (not the station ID slate in its place), then the bumper and the station ID.
    expect(breakRows.map((r) => r.code)).toEqual(expect.arrayContaining(["SPT", "BMP", "SID"]));
    expect(breakRows.some((r) => r.code === "SPT" && r.airingId)).toBe(true);
  }, 60_000);
});

describe("taking an entry off the log after its break was stored", () => {
  it("takes the empty break with it, and leaves a break with spots held without the entry", async () => {
    // Two programs later on, each with a break after it: the worker stores both, and fills the first
    // (money held); the second's 4 seconds hold no spot.
    const first = await kaiUser.post(`/v1/stations/${beatId}/log`, { kind: "program", startsAt: "2026-10-02T04:10:00.000Z", endsAt: "2026-10-02T04:11:20.000Z", itemId: showId }).expect(201);
    const second = await kaiUser.post(`/v1/stations/${beatId}/log`, { kind: "program", startsAt: "2026-10-02T04:11:20.000Z", endsAt: "2026-10-02T04:12:00.000Z", itemId: showId }).expect(201);
    // (Dead air after 3:02 is filled for an hour, so these come after it.)
    await runUntil("2026-10-02T03:55:00.000Z", 20_000);
    const stored = await h.db.select().from(schema.breaks).where(inArray(schema.breaks.logEntryId, [first.body.id, second.body.id]));
    expect(stored).toHaveLength(2);
    const filled = await h.services.spots.filledMsByBreak(stored.map((b) => b.id));
    const held = stored.find((b) => b.logEntryId === first.body.id)!;
    const empty = stored.find((b) => b.logEntryId === second.body.id)!;
    expect(filled.get(held.id)).toBeGreaterThan(0);
    expect(filled.get(empty.id) ?? 0).toBe(0);
    // Before, the stored break's reference made this fail.
    for (const entry of [first, second]) await kaiUser.delete(`/v1/stations/${beatId}/log/${entry.body.id}`).expect(200);
    const after = await h.db.select().from(schema.breaks).where(inArray(schema.breaks.id, stored.map((b) => b.id)));
    expect(after.map((b) => [b.id, b.logEntryId])).toEqual([[held.id, null]]);
    // The station is on air and the edit is within its plan: playout reads the log again.
    const commands = await h.db.select().from(schema.commands).where(eq(schema.commands.stationId, beatId));
    expect(commands.some((c) => c.action === "replan")).toBe(true);
  }, 60_000);

  it("still writes the as-run for what aired after its entry or break came off the log", async () => {
    // A row written ahead (the channel runs 20 s ahead), whose entry and break then went: as when
    // the break after a program that just ended is taken off with it while the break airs.
    const ahead = () =>
      h.db
        .select()
        .from(schema.channelItems)
        .where(and(eq(schema.channelItems.stationId, beatId), gt(schema.channelItems.startsAt, h.clock.now()), isNull(schema.channelItems.asRunId)))
        .orderBy(asc(schema.channelItems.startsAt))
        .limit(1);
    let [row] = await ahead();
    for (let i = 0; i < 60 && !row; i++) {
      await runUntil(new Date(h.clock.now().getTime() + 1_000).toISOString(), 1_000);
      [row] = await ahead();
    }
    expect(row).toBeDefined();
    await h.db.update(schema.channelItems).set({ logEntryId: randomUUID(), breakId: randomUUID() }).where(eq(schema.channelItems.id, row.id));
    await runUntil(new Date(row.endsAt.getTime() + 4_000).toISOString(), 1_000);
    const [written] = await h.db.select().from(schema.asRun).where(and(eq(schema.asRun.stationId, beatId), eq(schema.asRun.startedAt, row.startsAt)));
    // Recorded: what aired, with the references that are gone left empty.
    expect(written).toMatchObject({ code: row.code, logEntryId: null, breakId: null });
    expect(logs.filter((l) => l.includes("as-run for"))).toEqual([]);  });
});
