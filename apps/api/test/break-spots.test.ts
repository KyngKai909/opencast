// How often spots air in breaks, and bumpers into and out of the break (the user's decisions of
// 2026-09-29): the rule's new `cadence.spots`; a break without spots airing only the parts that do,
// as long as they need; no placements (and no holds) where spots don't air; the hourly cap, the
// same-spot limit and daily caps in the breaks spots do air in; the spot market and the avails
// promising only those breaks; and a bumper opening and closing each break (the same one twice, or
// none), with the station ID last.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createPlanner, type Segment } from "../src/v1/modules/playout/engine/plan.js";
import { createFiller } from "../src/v1/modules/playout/engine/fill.js";
import { CadenceDecider, DEFAULT_CADENCE, EVERY_PART, hourStartIn, needMs, planCadence, type BreakCadence, type CadenceBreak } from "../src/v1/modules/playout/engine/cadence.js";
import { createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

const MIN = 60_000;
const $ = (d: number) => Math.round(d * 1_000_000);
const at = (hhmm: string) => Date.parse(`2026-10-02T${hhmm}:00.000Z`);

// ---- Worked out (no database) ---------------------------------------------------------------

describe("the spots cadence, worked out", () => {
  // Four half-hour programs from 3:00, each closing with a two-minute break, and one break inside each.
  const programs = [0, 1, 2, 3].map((i) => ({ startsAt: at("03:00") + i * 30 * MIN, endsAt: at("03:30") + i * 30 * MIN }));
  const breaks: CadenceBreak[] = programs.flatMap((p) => [
    { key: `during ${new Date(p.startsAt + 14 * MIN).toISOString().slice(11, 16)}`, startsAt: p.startsAt + 14 * MIN, endsAt: p.startsAt + 16 * MIN, afterProgram: false },
    { key: `after ${new Date(p.endsAt - 2 * MIN).toISOString().slice(11, 16)}`, startsAt: p.endsAt - 2 * MIN, endsAt: p.endsAt, afterProgram: true }
  ]);
  const run = (spots: BreakCadence["spots"], aired?: { last: number | null; times: number[] }, settledBefore = 0) => {
    const plan = planCadence({ cadence: { ...DEFAULT_CADENCE, spots }, breaks, programs, aired: aired ? { spots: aired } : {}, settledBefore, hourStart: hourStartIn("America/Los_Angeles") });
    return breaks.filter((b) => plan.get(b.key)!.spots).map((b) => b.key);
  };

  it("every choice: every break, after every program, after every N programs, once an hour, never", () => {
    expect(run({ every: "break" })).toHaveLength(8);
    expect(run({ every: "program" })).toEqual(["after 03:28", "after 03:58", "after 04:28", "after 04:58"]);
    expect(run({ every: "n_programs", n: 2 })).toEqual(["after 03:28", "after 04:28"]);
    expect(run({ every: "n_programs", n: 3 }, { last: at("02:58"), times: [] })).toEqual(["after 04:28"]);
    expect(run({ every: "hour" })).toEqual(["during 03:14", "during 04:14"]);
    expect(run({ every: "hour" }, { last: at("03:05"), times: [] })).toEqual(["during 04:14"]);
    expect(run({ every: "never" })).toEqual([]);
  });

  it("decides the same across a replan: breaks that are over go by what aired, or were filled, in them", () => {
    const before = run({ every: "hour" });
    // Later: spots aired in the 3:14 break (the as-run log) and everything to 3:40 is over.
    expect(run({ every: "hour" }, { last: null, times: [at("03:15")] }, at("03:40"))).toEqual(before);
    // A break filled with spots keeps them whatever the rule says since (they're held).
    const decider = new CadenceDecider({ cadence: { ...DEFAULT_CADENCE, spots: { every: "never" } }, programs, aired: {}, settledBefore: 0, hourStart: hourStartIn("UTC") });
    expect(decider.next(breaks[0], { spots: true }).spots).toBe(true);
    expect(decider.next(breaks[1]).spots).toBe(false);
  });

  it("a break without spots is only as long as what airs in it, to whole segments", () => {
    const needs = { stationIdMs: 5_000, bumpersMs: 20_000, credit: (programId: string | null) => programId === "sponsored" };
    const context = { programId: "sponsored", producerShareMs: 0 };
    expect(needMs(needs, { ...EVERY_PART, spots: false }, context)).toBe(40_000);
    expect(needMs(needs, { ...EVERY_PART, spots: false }, { ...context, programId: null })).toBe(28_000);
    expect(needMs(needs, { stationId: true, bumpers: false, underwriting: false, spots: false }, context)).toBe(8_000);
    expect(needMs(needs, { stationId: false, bumpers: false, underwriting: false, spots: false }, context)).toBe(0);
    // The maker's barter time stays.
    expect(needMs(needs, { stationId: true, bumpers: false, underwriting: false, spots: false }, { programId: null, producerShareMs: 60_000 })).toBe(68_000);
  });
});

// ---- Against the database ------------------------------------------------------------------

let h: Harness;
let kai: User;
let jess: User;
let marketId: string;
let businessId: string;
let planner: ReturnType<typeof createPlanner>;
let filler: ReturnType<typeof createFiller>;
let tenths = 111;
const shape = (segments: Segment[]) => segments.map((s) => `${s.startsAt.toISOString().slice(11, 19)} ${s.code} ${Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 1000)}s`);
const rule = (o: Record<string, unknown> = {}) => ({ mode: "every_n_minutes", everyMinutes: 30, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "spot_market", blockedCategories: [], ...o });
const cadence = (spots: Record<string, unknown>, o: Record<string, unknown> = {}) => ({ stationId: { every: "break" }, bumpers: { every: "break" }, underwriting: { every: "break" }, spots, ...o });

async function station(callSign: string, options: { bumpers?: Array<[string, number]> } = {}) {
  const s = await stationFixture(h, { callSign, name: `${callSign} TV`, ownerId: kai.id, marketId, tenths: (tenths += 10), signedOn: true, colour: "#8C3B7A" });
  await itemFixture(h, s.id, { title: `${callSign} ident`, code: "SID", durationMs: 5_000 });
  for (const [title, ms] of options.bumpers ?? [["Back to it", 10_000]]) await itemFixture(h, s.id, { title, code: "BMP", durationMs: ms });
  return s.id;
}

async function programs(stationId: string, from: string, count: number, slotMin: number, itemMin: number) {
  const item = await itemFixture(h, stationId, { title: "Crate", durationMs: itemMin * MIN });
  for (let i = 0; i < count; i++) {
    const startsAt = new Date(Date.parse(from) + i * slotMin * MIN).toISOString();
    await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt, endsAt: new Date(Date.parse(startsAt) + slotMin * MIN).toISOString(), itemId: item.id }).expect(201);
  }
}

async function listedSpot(title: string, lengthSec: 15 | 30, dailyCapMicros = $(40)) {
  const s = await jess.post(`/v1/businesses/${businessId}/spots`, { title, lengthSec, category: "Food", rate: { kind: "per_airing", micros: $(4) }, budget: { totalMicros: $(100), dailyCapMicros } }).expect(201);
  await h.db.insert(schema.spotFiles).values({ spotId: s.body.id, version: 1, location: `/fixtures/${title}.mp4`, durationMs: lengthSec * 1000 });
  await h.db.update(schema.spotsTable).set({ status: "listed" }).where(eq(schema.spotsTable.id, s.body.id));
  return s.body.id as string;
}

type BreakView = { id: string | null; startsAt: string; lengthMs: number; openMs: number; filledAt: string | null; rows: Array<{ code: string; title: string; lengthMs: number; note: string | null }> };
const logBreaks = async (id: string, from: string, to: string) => (await kai.get(`/v1/stations/${id}/log?from=${from}&to=${to}`).expect(200)).body.breaks as BreakView[];
const hhmmss = (iso: string) => iso.slice(11, 19);
const held = async (stationId: string) => h.db.select().from(schema.airings).where(eq(schema.airings.stationId, stationId));

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-02T02:59:00.000Z");
  planner = createPlanner({ deps: h.deps, services: h.services });
  filler = createFiller({ deps: h.deps, services: h.services });
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
  jess = await h.signIn("Jess");
  const b = await jess.post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online", marketIds: [marketId] }).expect(201);
  businessId = b.body.id;
  const card = await jess.post(`/v1/businesses/${businessId}/funding-sources`, { kind: "card", token: "tok_4417" }).expect(201);
  await jess.post(`/v1/businesses/${businessId}/deposits`, { amountMicros: $(500), fundingSourceId: card.body[0].id }).expect(201);
}, 60_000);
afterAll(() => h.close());

describe("the break rule's spots", () => {
  it("default to every break; an app that leaves them out keeps what's set", async () => {
    const id = await station("SPTS");
    expect((await kai.get(`/v1/stations/${id}/break-rule`).expect(200)).body.cadence.spots).toEqual({ every: "break" });
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ cadence: cadence({ every: "n_programs", n: 3 }) })).expect(200);
    // An app from before spots had a choice sends the other three.
    const older = await kai.put(`/v1/stations/${id}/break-rule`, rule({ cadence: { stationId: { every: "hour" }, bumpers: { every: "break" }, underwriting: { every: "break" } } })).expect(200);
    expect(older.body.cadence).toEqual(cadence({ every: "n_programs", n: 3 }, { stationId: { every: "hour" } }));
    const noN = await kai.put(`/v1/stations/${id}/break-rule`, rule({ cadence: cadence({ every: "n_programs" }) })).expect(400);
    expect(noN.body.error.message).toBe("Say after how many programs.");
  });
});

describe("a break without spots", () => {
  it("airs only what does, as long as it needs, and the program goes on sooner; the break that closes the slot keeps its time", async () => {
    const id = await station("PRGM");
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ cadence: cadence({ every: "program" }) })).expect(200);
    await programs(id, "2026-10-02T03:00:00.000Z", 1, 60, 56);
    const segments = await planner.plan(id, new Date("2026-10-02T03:00:00Z"), new Date("2026-10-02T04:00:00Z"));
    // Inside the program: a bumper in, a bumper out, the station ID (25 s, to 28 s on segments).
    expect(shape(segments)).toEqual([
      "03:00:00 PGM 1800s",
      "03:30:00 BMP 10s",
      "03:30:10 BMP 10s",
      "03:30:20 OPEN 3s",
      "03:30:23 SID 5s",
      "03:30:28 PGM 1560s",
      "03:56:28 BMP 10s",
      "03:56:38 BMP 10s",
      "03:56:48 OPEN 187s",
      "03:59:55 SID 5s"
    ]);
    const breaks = await logBreaks(id, "2026-10-02T03:00:00.000Z", "2026-10-02T04:00:00.000Z");
    expect(breaks.map((b) => [hhmmss(b.startsAt), b.lengthMs, b.openMs])).toEqual([
      ["03:30:00", 28_000, 0],
      ["03:56:28", 212_000, 212_000]
    ]);
    // The log's rows say what airs: no spot time in the first.
    expect(breaks[0].rows.map((r) => `${r.code} ${r.title}`)).toEqual(["BMP Back to it", "BMP Back to it", "OPEN Station ID slate", "SID Station ID"]);
    expect(breaks[1].rows.map((r) => `${r.code} ${r.title}`)).toEqual(["BMP Back to it", "OPEN Open", "BMP Back to it", "SID Station ID"]);
  });

  it("never: the rule's breaks shrink to what airs, and a break with nothing to air isn't one", async () => {
    const id = await station("NEVR", { bumpers: [] });
    // Breaks every 20 minutes of the program; the station ID once an hour, no bumpers in the library, no sponsors.
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ everyMinutes: 20, cadence: cadence({ every: "never" }, { stationId: { every: "hour" } }) })).expect(200);
    await programs(id, "2026-10-02T03:00:00.000Z", 1, 60, 50);
    const breaks = await logBreaks(id, "2026-10-02T03:00:00.000Z", "2026-10-02T04:00:00.000Z");
    // 3:20: the station ID (the hour's first), 5 s to 8 s on segments. 3:40: nothing airs, so no
    // break. The break closing the slot keeps the rest of it, on the station ID slate.
    expect(breaks.map((b) => [hhmmss(b.startsAt), b.lengthMs, b.openMs])).toEqual([
      ["03:20:00", 8_000, 0],
      ["03:50:08", 592_000, 0]
    ]);
    expect(breaks[1].rows.map((r) => `${r.code} ${r.title}`)).toEqual(["OPEN Station ID slate"]);
    const avails = await kai.get(`/v1/stations/${id}/avails?hours=2`).expect(200);
    expect(avails.body.totalOpenMs).toBe(0);
  });
});

describe("the hourly station ID check", () => {
  it("counts the rule's breaks, not the ones the cadence leaves nothing in: a gap from the cadence warns, it doesn't block", async () => {
    const id = await station("GAPS", { bumpers: [] });
    // Hour-long programs with no time after them: only breaks inside, and nothing airs in them but
    // the station ID, which comes only after every second program (never, here: no break closes one).
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ cadence: cadence({ every: "never" }, { stationId: { every: "n_programs", n: 2 }, underwriting: { every: "never" } }) })).expect(200);
    await programs(id, "2026-10-02T02:00:00.000Z", 28, 60, 60);
    expect(await logBreaks(id, "2026-10-02T03:00:00.000Z", "2026-10-02T05:00:00.000Z")).toEqual([]);
    const checks = (await kai.get(`/v1/stations/${id}/sign-on/checks`).expect(200)).body.checks as Array<{ key: string; passed: boolean; blocking: boolean }>;
    expect(checks.find((c) => c.key === "station_id_hourly")).toMatchObject({ passed: false, blocking: false });
  });
});

describe("spots in some breaks", () => {
  it("after every N programs and once an hour decide the same across a replan, from what was filled", async () => {
    const id = await station("NPRG");
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ mode: "after_every_program", everyMinutes: null, cadence: cadence({ every: "n_programs", n: 2 }) })).expect(200);
    await programs(id, "2026-10-02T03:00:00.000Z", 4, 30, 28);
    const spotsIn = async (from: string, to: string) => (await logBreaks(id, from, to)).filter((b) => b.openMs > 0 || b.rows.some((r) => r.code === "SPT")).map((b) => hhmmss(b.startsAt));
    expect(await spotsIn("2026-10-02T03:00:00.000Z", "2026-10-02T05:00:00.000Z")).toEqual(["03:28:00", "04:28:00"]);
    // The 3:28 break is filled (nothing to place: it's marked filled all the same); an hour on, the log from 4:00 says the same.
    const stored = await h.services.log.ensureBreaks(id, new Date("2026-10-02T03:00:00Z"), new Date("2026-10-02T05:00:00Z"));
    await h.services.log.markBreakFilled(stored.find((b) => b.startsAt === "2026-10-02T03:28:00.000Z")!.id!);
    h.clock.set("2026-10-02T04:05:00.000Z");
    expect(await spotsIn("2026-10-02T04:00:00.000Z", "2026-10-02T05:00:00.000Z")).toEqual(["04:28:00"]);
    h.clock.set("2026-10-02T02:59:00.000Z");

    const hourly = await station("HRLY");
    await kai.put(`/v1/stations/${hourly}/break-rule`, rule({ everyMinutes: 20, cadence: cadence({ every: "hour" }) })).expect(200);
    await programs(hourly, "2026-10-02T03:00:00.000Z", 2, 60, 56);
    const plan = (from: string) => planner.plan(hourly, new Date(from), new Date("2026-10-02T05:00:00Z"));
    const first = shape(await plan("2026-10-02T03:00:00Z"));
    // 3:20 and 4:20 (each hour's first break) are two minutes, with spot time; 3:42 and 4:42 are
    // the bumpers and the station ID (28 s); the breaks closing the slots keep what's left of them.
    expect(first.filter((s) => s.includes("OPEN"))).toEqual(["03:20:20 OPEN 95s", "03:42:20 OPEN 3s", "03:58:48 OPEN 67s", "04:20:20 OPEN 95s", "04:42:20 OPEN 3s", "04:58:48 OPEN 67s"]);
    expect(first).toContain("03:42:28 PGM 960s");
    // Filled at 3:20 and replanned at 3:45: the same from there.
    const at320 = (await h.services.log.ensureBreaks(hourly, new Date("2026-10-02T03:00:00Z"), new Date("2026-10-02T05:00:00Z"))).find((b) => b.startsAt === "2026-10-02T03:20:00.000Z")!;
    await h.services.log.markBreakFilled(at320.id!);
    h.clock.set("2026-10-02T03:45:00.000Z");
    expect(shape(await plan("2026-10-02T03:45:00Z"))).toEqual(first.slice(first.indexOf("03:42:28 PGM 960s")));
    h.clock.set("2026-10-02T02:59:00.000Z");
  });
});

describe("holds and caps", () => {
  it("places nothing, and holds nothing, in a break spots don't air in; those breaks aren't marked filled", async () => {
    const id = await station("HOLD");
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ cadence: cadence({ every: "program" }) })).expect(200);
    await programs(id, "2026-10-02T03:00:00.000Z", 1, 60, 56);
    await kai.put(`/v1/stations/${id}/rotations/main`, { spotIds: [await listedSpot("Hold menu", 30)] }).expect(200);
    const results = await filler.fillAhead(id, h.clock.now(), 90 * MIN);
    // Only the break that closes the program was filled.
    expect(results).toHaveLength(1);
    expect(results[0].placed).toHaveLength(1);
    const airings = await held(id);
    expect(airings).toHaveLength(1);
    const breaks = await h.db.select().from(schema.breaks).where(eq(schema.breaks.stationId, id));
    const inside = breaks.find((b) => b.startsAt.toISOString() === "2026-10-02T03:30:00.000Z")!;
    expect(inside.filledAt).toBeNull();
    expect(airings[0].breakId).not.toBe(inside.id);
    // Asked again: nothing more.
    expect(await filler.fillAhead(id, h.clock.now(), 90 * MIN)).toEqual([]);
    // And playout airs it after the bumper into the break.
    const segments = await planner.plan(id, new Date("2026-10-02T03:56:00Z"), new Date("2026-10-02T04:00:00Z"));
    expect(shape(segments).slice(1, 4)).toEqual(["03:56:28 BMP 10s", "03:56:38 SPT 30s", "03:57:08 BMP 10s"]);
  });

  it("keeps the hourly cap, the same-spot limit and daily caps in the breaks spots do air in", async () => {
    const id = await station("CAPS");
    // Spots after every third program: 3:25 and 4:55 (an hour and a half apart), each break five minutes.
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ mode: "after_every_program", everyMinutes: null, spotMsPerHour: 60_000, cadence: cadence({ every: "n_programs", n: 3 }) })).expect(200);
    // A day before the database's own clock: holds are dated by it, and a daily cap counts today's.
    h.clock.set("2026-09-01T02:59:00.000Z");
    await programs(id, "2026-09-01T03:00:00.000Z", 4, 30, 25);
    const once = await listedSpot("Once a day", 30, $(4));
    const second = await listedSpot("Second", 30);
    const third = await listedSpot("Third", 30);
    await kai.put(`/v1/stations/${id}/rotations/main`, { spotIds: [once, second, third] }).expect(200);
    const results = await filler.fillAhead(id, h.clock.now(), 150 * MIN);
    h.clock.set("2026-10-02T02:59:00.000Z");
    const byBreak = await Promise.all(
      results.map(async (r) => {
        const [b] = await h.db.select().from(schema.breaks).where(eq(schema.breaks.id, r.breakId));
        return { at: hhmmss(b.startsAt.toISOString()), placed: r.placed.map((p) => p.spotId), skipped: r.skipped };
      })
    );
    expect(byBreak.map((b) => b.at)).toEqual(["03:25:00", "04:55:00"]);
    // 3:25: a minute an hour, so the third waits.
    expect(byBreak[0].placed).toEqual([once, second]);
    expect(byBreak[0].skipped).toEqual([{ spotId: third, reason: "hourly cap" }]);
    // 4:55: the first reached its daily cap.
    expect(byBreak[1].placed).toEqual([second, third]);
    expect(byBreak[1].skipped).toEqual([{ spotId: once, reason: "daily_cap" }]);
    expect(await held(id)).toHaveLength(4);
    const filled = await h.db.select().from(schema.breaks).where(and(eq(schema.breaks.stationId, id), isNotNull(schema.breaks.filledAt)));
    expect(filled).toHaveLength(2);
  });
});

describe("the maker's barter time", () => {
  it("stays in a break without the station's spots: the break is as long as it and the rest need, and it's placed once", async () => {
    const id = await station("BRTR");
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ cadence: cadence({ every: "never" }) })).expect(200);
    const reelOwner = await h.signIn("Reel");
    const reel = await stationFixture(h, { callSign: "REEL", ownerId: reelOwner.id, signedOn: true });
    const program = await reelOwner.post(`/v1/stations/${reel.id}/programs`, { title: "Saturday Reel", description: "Films." }).expect(201);
    const episode = await itemFixture(h, reel.id, { programId: program.body.id, title: "Reel 1", durationMs: 55 * MIN });
    const offer = await reelOwner
      .post(`/v1/programs/${program.body.id}/offer`, { termsOffered: ["barter"], cashPriceMicros: null, cashPriceUnit: null, barterMakerMsPerHour: 60_000, airingsPerEpisode: null, windowDays: 7, liveOnly: false, noticeDays: 7, approval: "any_station", radioBandAllowed: true })
      .expect(201);
    await kai.post(`/v1/catalog/offers/${offer.body.id}/requests`, { carrierStationId: id, term: "barter", slots: [{ weekday: 5, time: "22:00" }], startsOn: "2026-10-01" }).expect(201);
    const agreement = (await kai.get(`/v1/stations/${id}/carriage/agreements`).expect(200)).body.carrying[0];
    const reelSpot = await listedSpot("Reel sponsor", 30);
    await h.db.insert(schema.rotations).values({ stationId: reel.id, kind: "main" }).onConflictDoNothing();
    const [rotation] = await h.db.select().from(schema.rotations).where(eq(schema.rotations.stationId, reel.id));
    await h.db.insert(schema.rotationSpots).values({ rotationId: rotation.id, spotId: reelSpot, position: 0 });
    await kai.post(`/v1/stations/${id}/log`, { kind: "program", startsAt: "2026-10-02T06:00:00.000Z", endsAt: "2026-10-02T07:00:00.000Z", itemId: episode.id, carriageAgreementId: agreement.id }).expect(201);
    h.clock.set("2026-10-02T05:59:00.000Z");
    // The maker's 30 s, the station ID and two bumpers: 55 s, to 56 s on segments.
    const breaks = await logBreaks(id, "2026-10-02T06:00:00.000Z", "2026-10-02T07:00:00.000Z");
    expect(breaks.map((b) => [hhmmss(b.startsAt), b.lengthMs, b.openMs])).toEqual([
      ["06:30:00", 56_000, 0],
      ["06:55:56", 244_000, 0]
    ]);
    const results = await filler.fillAhead(id, h.clock.now(), 60 * MIN);
    expect(results.flatMap((r) => r.placed)).toEqual([expect.objectContaining({ spotId: reelSpot, producer: true })]);
    expect(await filler.fillAhead(id, h.clock.now(), 60 * MIN)).toEqual([]);
    h.clock.set("2026-10-02T02:59:00.000Z");
  });
});

describe("the spot market and the avails", () => {
  let never: string;
  let spot: string;

  beforeAll(async () => {
    never = await station("NOSP");
    await kai.put(`/v1/stations/${never}/break-rule`, rule({ cadence: cadence({ every: "never" }) })).expect(200);
    spot = await listedSpot("Market menu", 30);
  });

  it("doesn't promise a station whose breaks never air spots, and doesn't count it as carrying a category", async () => {
    const matches = await jess.post(`/v1/spots/${spot}/matches`, {}).expect(200);
    const stations = matches.body.stations as Array<{ station: { callSign: string }; included: boolean; reason: string | null }>;
    expect(stations.find((s) => s.station.callSign === "NOSP")).toMatchObject({ included: false, reason: "doesn't air spots" });
    expect(stations.find((s) => s.station.callSign === "SPTS")).toMatchObject({ included: true });
    const reach = await jess.get(`/v1/markets/${marketId}/category-reach?category=Food`).expect(200);
    const others = stations.filter((s) => s.reason !== "doesn't air spots").length;
    expect(others).toBeLessThan(stations.length);
    expect(reach.body).toMatchObject({ reached: others, total: others });
    // The station still sees what's listed for it, so its rotations can stay.
    const market = await kai.get(`/v1/stations/${never}/spot-market`).expect(200);
    expect(market.body.map((m: { spot: { id: string } }) => m.spot.id)).toContain(spot);
    expect((await h.services.stations.adProfile(never)).spotMsPerHour).toBe(0);
  });

  it("the avails count only the breaks spots air in", async () => {
    const id = await station("AVLS");
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ cadence: cadence({ every: "program" }) })).expect(200);
    await programs(id, "2026-10-02T03:00:00.000Z", 1, 60, 56);
    const avails = await kai.get(`/v1/stations/${id}/avails?hours=2`).expect(200);
    const breaks = avails.body.breaks as Array<{ breakStartsAt: string; lengthMs: number; openMs: number; contents: Array<{ kind: string }> }>;
    expect(breaks.map((b) => [hhmmss(b.breakStartsAt), b.lengthMs, b.openMs])).toEqual([
      ["03:30:00", 28_000, 0],
      ["03:56:28", 212_000, 212_000]
    ]);
    expect(avails.body.totalOpenMs).toBe(212_000);
    expect(breaks[0].contents.map((c) => c.kind)).toEqual(["bumper", "bumper", "open", "station_id"]);
  });
});

describe("bumpers into and out of the break", () => {
  const breakOf = (segments: Segment[], hhmm: string) => segments.filter((s) => s.inBreak && s.breakSpan!.startsAt.toISOString().slice(11, 16) === hhmm).map((s) => `${s.code} ${s.label}`);

  it("one opens the break, before the spots, and one closes it, after the credit and before the station ID", async () => {
    const id = await station("BMPS", { bumpers: [["Back to it", 10_000], ["Stay tuned", 8_000]] });
    await kai.put(`/v1/stations/${id}/break-rule`, rule()).expect(200);
    await programs(id, "2026-10-02T03:00:00.000Z", 1, 60, 56);
    await kai.put(`/v1/stations/${id}/rotations/main`, { spotIds: [await listedSpot("Bumper menu", 30)] }).expect(200);
    const sponsorship = await jess.post(`/v1/businesses/${businessId}/sponsorships`, { stationId: id, monthlyMicros: $(25), creditText: "Orange Street Coffee, roasting in Redlands.", startsOn: "2026-10-01" }).expect(201);
    await kai.post(`/v1/sponsorships/${sponsorship.body.id}/decision`, { decision: "approve" }).expect(200);
    await filler.fillAhead(id, h.clock.now(), 90 * MIN);
    const segments = await planner.plan(id, new Date("2026-10-02T03:00:00Z"), new Date("2026-10-02T04:00:00Z"));
    expect(breakOf(segments, "03:30")).toEqual(["BMP Back to it", "SPT Spot", "UND BMPS TV is made possible by", "BMP Stay tuned", "OPEN Station ID slate", "SID BMPS ident"]);
    const rows = (await logBreaks(id, "2026-10-02T03:00:00.000Z", "2026-10-02T04:00:00.000Z"))[0].rows;
    expect(rows.map((r) => `${r.code} ${r.note ?? ""}`.trim())).toEqual(["BMP Into the break", "SPT", "UND Made possible by", "BMP Out of the break", "OPEN", "SID"]);
  });

  it("with one bumper in the library, it airs at both ends", async () => {
    const id = await station("ONEB");
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ mode: "after_every_program", everyMinutes: null })).expect(200);
    await programs(id, "2026-10-02T03:00:00.000Z", 1, 30, 28);
    const segments = await planner.plan(id, new Date("2026-10-02T03:00:00Z"), new Date("2026-10-02T03:30:00Z"));
    expect(shape(segments)).toEqual(["03:00:00 PGM 1680s", "03:28:00 BMP 10s", "03:28:10 BMP 10s", "03:28:20 OPEN 95s", "03:29:55 SID 5s"]);
  });

  it("with none, nothing is added: the break holds on the station ID slate", async () => {
    const id = await station("NONE", { bumpers: [] });
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ mode: "after_every_program", everyMinutes: null })).expect(200);
    await programs(id, "2026-10-02T03:00:00.000Z", 1, 30, 28);
    const segments = await planner.plan(id, new Date("2026-10-02T03:00:00Z"), new Date("2026-10-02T03:30:00Z"));
    expect(shape(segments)).toEqual(["03:00:00 PGM 1680s", "03:28:00 OPEN 115s", "03:29:55 SID 5s"]);
  });

  it("by default, breaks are where they were and as long, the station ID last; spots keep room for both bumpers", async () => {
    const id = await station("DFLT");
    await programs(id, "2026-10-02T03:00:00.000Z", 1, 60, 56);
    await kai.put(`/v1/stations/${id}/break-rule`, rule()).expect(200);
    const breaks = await logBreaks(id, "2026-10-02T03:00:00.000Z", "2026-10-02T04:00:00.000Z");
    expect(breaks.map((b) => [hhmmss(b.startsAt), b.lengthMs, b.openMs])).toEqual([
      ["03:30:00", 120_000, 120_000],
      ["03:58:00", 120_000, 120_000]
    ]);
    const spots = await Promise.all([30, 30, 30].map((len, i) => listedSpot(`Default ${i}`, len as 30)));
    await kai.put(`/v1/stations/${id}/rotations/main`, { spotIds: spots }).expect(200);
    const [first] = await filler.fillAhead(id, h.clock.now(), 40 * MIN);
    // 120 s less the station ID and two bumpers: 95 s, so three 30 s spots.
    expect(first.placed).toHaveLength(3);
    const segments = await planner.plan(id, new Date("2026-10-02T03:30:00Z"), new Date("2026-10-02T03:32:00Z"));
    expect(shape(segments)).toEqual(["03:30:00 BMP 10s", "03:30:10 SPT 30s", "03:30:40 SPT 30s", "03:31:10 SPT 30s", "03:31:40 BMP 10s", "03:31:50 OPEN 5s", "03:31:55 SID 5s"]);
  });

  it("a break cued live follows the rule: no spots where they don't air", async () => {
    const id = await station("CUED");
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ cadence: cadence({ every: "never" }) })).expect(200);
    const slot = await h.services.log.cueBreak(id, h.clock.now(), 120_000, null);
    expect(slot.parts).toMatchObject({ spots: false, stationId: true });
    expect(slot.openMs).toBe(0);
    const filled = await filler.fillOne(id, slot, "America/Los_Angeles", false);
    expect(filled.placed).toEqual([]);
  });
});
