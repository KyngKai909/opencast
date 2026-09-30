// How often the station ID, bumpers and credit air in breaks (the break rule's cadence), and the
// generated station ID (added 2026-09-29): the rule's new field, the planner applying it (and
// deciding the same across a replan, from the log and the as-run log), the hourly check's warning,
// and a station with no station ID of its own airing, previewing and signing on with a generated one.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { HLS_CLASS, parseDateRanges } from "@opencast/contracts";
import { createPlanner, type Segment } from "../src/v1/modules/playout/engine/plan.js";
import { cadenceOf, DEFAULT_CADENCE, hourStartIn, planCadence, type BreakCadence, type CadenceBreak } from "../src/v1/modules/playout/engine/cadence.js";
import { generatedStationIdKey } from "../src/v1/modules/playout/engine/stationId.js";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { createHarness, dummyFile, fakeTranscoder, itemFixture, market, prepareQueued, stationFixture, type Harness, type User } from "./harness.js";

const MIN = 60_000;
const at = (hhmm: string) => Date.parse(`2026-10-02T${hhmm}:00.000Z`);

// ---- The rule, worked out (no database) -----------------------------------------------------

describe("the cadence, worked out", () => {
  // Four half-hour programs from 3:00, each closing with a two-minute break, and one break inside each.
  const programs = [0, 1, 2, 3].map((i) => ({ startsAt: at("03:00") + i * 30 * MIN, endsAt: at("03:30") + i * 30 * MIN }));
  const breaks: CadenceBreak[] = programs.flatMap((p) => [
    { key: `during ${new Date(p.startsAt + 14 * MIN).toISOString().slice(11, 16)}`, startsAt: p.startsAt + 14 * MIN, endsAt: p.startsAt + 16 * MIN, afterProgram: false },
    { key: `after ${new Date(p.endsAt - 2 * MIN).toISOString().slice(11, 16)}`, startsAt: p.endsAt - 2 * MIN, endsAt: p.endsAt, afterProgram: true }
  ]);
  const none = { last: null, times: [] as number[] };
  const run = (stationId: BreakCadence["stationId"], opts: { settledBefore?: number; sid?: { last: number | null; times: number[] } } = {}) => {
    const plan = planCadence({
      cadence: { ...DEFAULT_CADENCE, stationId },
      breaks,
      programs,
      aired: { stationId: opts.sid ?? none, bumpers: none, underwriting: none },
      settledBefore: opts.settledBefore ?? 0,
      hourStart: hourStartIn("America/Los_Angeles")
    });
    return breaks.filter((b) => plan.get(b.key)!.stationId).map((b) => b.key);
  };

  it("every break (the default), and a stored rule without one reads as the default", () => {
    expect(run({ every: "break" })).toHaveLength(8);
    expect(cadenceOf(null)).toEqual(DEFAULT_CADENCE);
    expect(cadenceOf({ stationId: { every: "never" }, bumpers: { every: "n_programs" } })).toEqual({ stationId: { every: "break" }, bumpers: { every: "n_programs", n: 2 }, underwriting: { every: "break" }, spots: { every: "break" } });
  });

  it("after every program: only the breaks that close a program", () => {
    expect(run({ every: "program" })).toEqual(["after 03:28", "after 03:58", "after 04:28", "after 04:58"]);
  });

  it("after every N programs: from the last time it aired", () => {
    // Nothing aired yet: the first break after a program, then every second.
    expect(run({ every: "n_programs", n: 2 })).toEqual(["after 03:28", "after 04:28"]);
    // It aired in the 2:58 break (before these): after the second program from then.
    expect(run({ every: "n_programs", n: 2 }, { sid: { last: at("02:58"), times: [] } })).toEqual(["after 03:58", "after 04:58"]);
    expect(run({ every: "n_programs", n: 3 }, { sid: { last: at("02:58"), times: [] } })).toEqual(["after 04:28"]);
  });

  it("once an hour: the first break after the top of the hour", () => {
    expect(run({ every: "hour" })).toEqual(["during 03:14", "during 04:14"]);
    // It already aired this hour (2:58 is last hour; 3:05 is this one).
    expect(run({ every: "hour" }, { sid: { last: at("02:58"), times: [] } })).toEqual(["during 03:14", "during 04:14"]);
    expect(run({ every: "hour" }, { sid: { last: at("03:05"), times: [] } })).toEqual(["during 04:14"]);
  });

  it("decides the same across a replan: breaks that are over go by the as-run log", () => {
    const before = run({ every: "n_programs", n: 2 });
    // Later: the 3:28 break aired it (the as-run log says so) and everything to 4:00 is over.
    const after = run({ every: "n_programs", n: 2 }, { settledBefore: at("04:00"), sid: { last: null, times: [at("03:29")] } });
    expect(after).toEqual(before);
    // Had it not aired at 3:28 (the station wasn't on), the next break after a program takes it.
    expect(run({ every: "n_programs", n: 2 }, { settledBefore: at("04:01"), sid: { last: null, times: [] } })).toEqual(["after 04:28"]);
    const hourly = run({ every: "hour" });
    expect(run({ every: "hour" }, { settledBefore: at("03:40"), sid: { last: null, times: [at("03:15")] } })).toEqual(hourly);
  });

  it("never (bumpers and the credit)", () => {
    const plan = planCadence({ cadence: { ...DEFAULT_CADENCE, bumpers: { every: "never" }, underwriting: { every: "never" } }, breaks, programs, aired: { stationId: none, bumpers: none, underwriting: none }, settledBefore: 0, hourStart: hourStartIn("UTC") });
    expect([...plan.values()].every((p) => p.stationId && !p.bumpers && !p.underwriting)).toBe(true);
  });
});

// ---- Against the database ------------------------------------------------------------------

let h: Harness;
let kai: User;
let marketId: string;
let planner: ReturnType<typeof createPlanner>;
const wanted: string[] = [];
const shape = (segments: Segment[]) => segments.map((s) => `${s.startsAt.toISOString().slice(11, 19)} ${s.code} ${Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 1000)}s`);
const rule = (o: Record<string, unknown> = {}) => ({ mode: "every_n_minutes", everyMinutes: 30, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "spot_market", blockedCategories: [], ...o });

async function station(callSign: string, tenths: number, options: { sid?: boolean; bumper?: boolean } = {}) {
  const s = await stationFixture(h, { callSign, name: `${callSign} Radio`, ownerId: kai.id, marketId, tenths, signedOn: true, colour: "#8C3B7A" });
  if (options.sid !== false) await itemFixture(h, s.id, { title: `${callSign} ident`, code: "SID", durationMs: 5_000 });
  if (options.bumper !== false) await itemFixture(h, s.id, { title: "Back to it", code: "BMP", durationMs: 10_000 });
  return s.id;
}

async function programs(stationId: string, from: string, count: number, slotMin: number, itemMin: number) {
  const item = await itemFixture(h, stationId, { title: "Crate", durationMs: itemMin * MIN });
  for (let i = 0; i < count; i++) {
    const startsAt = new Date(Date.parse(from) + i * slotMin * MIN).toISOString();
    await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt, endsAt: new Date(Date.parse(startsAt) + slotMin * MIN).toISOString(), itemId: item.id }).expect(201);
  }
}

/** Which breaks (by start) air a code. */
const breaksWith = (segments: Segment[], code: string) => [...new Set(segments.filter((s) => s.inBreak && s.code === code).map((s) => s.breakSpan!.startsAt.toISOString().slice(11, 16)))];

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-02T02:59:00.000Z");
  planner = createPlanner({ deps: h.deps, services: h.services }, { wantGenerated: async (spec) => void wanted.push(spec.key) });
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
}, 60_000);
afterAll(() => h.close());

describe("the break rule's cadence", () => {
  it("defaults to every break, keeps what's set when left out, and refuses a station ID that never airs", async () => {
    const id = await station("BEAT", 121);
    const got = await kai.get(`/v1/stations/${id}/break-rule`).expect(200);
    expect(got.body.cadence).toEqual({ stationId: { every: "break" }, bumpers: { every: "break" }, underwriting: { every: "break" }, spots: { every: "break" } });
    const cadence = { stationId: { every: "hour" }, bumpers: { every: "n_programs", n: 3 }, underwriting: { every: "never" }, spots: { every: "break" } };
    const set = await kai.put(`/v1/stations/${id}/break-rule`, rule({ cadence })).expect(200);
    expect(set.body.cadence).toEqual(cadence);
    // An app that doesn't know the field leaves it alone.
    const again = await kai.put(`/v1/stations/${id}/break-rule`, rule({ lengthMs: 90_000 })).expect(200);
    expect(again.body).toMatchObject({ lengthMs: 90_000, cadence });
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ cadence: { ...cadence, stationId: { every: "never" } } })).expect(400);
    const noN = await kai.put(`/v1/stations/${id}/break-rule`, rule({ cadence: { ...cadence, bumpers: { every: "n_programs" } } })).expect(400);
    expect(noN.body.error.message).toBe("Say after how many programs.");
  });

  it("airs today's break when every part is every break", async () => {
    const id = await station("DFLT", 131);
    await kai.put(`/v1/stations/${id}/break-rule`, rule()).expect(200);
    await programs(id, "2026-10-02T03:00:00.000Z", 1, 60, 56);
    const segments = await planner.plan(id, new Date("2026-10-02T03:00:00Z"), new Date("2026-10-02T04:00:00Z"));
    expect(shape(segments).slice(0, 2)).toEqual(["03:00:00 PGM 1800s", "03:30:00 BMP 10s"]);
    expect(breaksWith(segments, "SID")).toEqual(["03:30", "03:58"]);
    expect(breaksWith(segments, "BMP")).toEqual(["03:30", "03:58"]);
    // Station ID last, every time.
    for (const at of ["03:32:00", "04:00:00"]) expect(segments.find((s) => s.endsAt.toISOString().slice(11, 19) === at && s.inBreak)!.code).toBe("SID");
  });

  it("after every program: the break inside a program has no station ID, and holds on the slate instead", async () => {
    const id = await station("PGMS", 141, { bumper: false });
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ cadence: { stationId: { every: "program" }, bumpers: { every: "break" }, underwriting: { every: "break" } } })).expect(200);
    await programs(id, "2026-10-02T03:00:00.000Z", 1, 60, 56);
    const segments = await planner.plan(id, new Date("2026-10-02T03:00:00Z"), new Date("2026-10-02T04:00:00Z"));
    expect(shape(segments)).toEqual(["03:00:00 PGM 1800s", "03:30:00 OPEN 120s", "03:32:00 PGM 1560s", "03:58:00 OPEN 115s", "03:59:55 SID 5s"]);
  });

  it("never: no bumpers or credit in breaks (open time still airs bumpers)", async () => {
    const id = await station("NOBM", 151);
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ mode: "after_every_program", everyMinutes: null, cadence: { stationId: { every: "break" }, bumpers: { every: "never" }, underwriting: { every: "never" } } })).expect(200);
    await programs(id, "2026-10-02T03:00:00.000Z", 1, 30, 28);
    const segments = await planner.plan(id, new Date("2026-10-02T03:00:00Z"), new Date("2026-10-02T03:31:00Z"));
    expect(shape(segments)).toEqual(["03:00:00 PGM 1680s", "03:28:00 OPEN 115s", "03:29:55 SID 5s", "03:30:00 BMP 10s", "03:30:10 BMP 10s", "03:30:20 BMP 10s", "03:30:30 BMP 10s", "03:30:40 BMP 10s", "03:30:50 OPEN 5s", "03:30:55 SID 5s"]);
  });

  it("once an hour and after every N programs, the same across a replan", async () => {
    const id = await station("HOUR", 161);
    await kai
      .put(`/v1/stations/${id}/break-rule`, rule({ mode: "after_every_program", everyMinutes: null, cadence: { stationId: { every: "hour" }, bumpers: { every: "n_programs", n: 2 }, underwriting: { every: "break" } } }))
      .expect(200);
    // Four half-hour programs from 3:00, each with a two-minute break at its end.
    await programs(id, "2026-10-02T03:00:00.000Z", 4, 30, 28);
    const plan = () => planner.plan(id, new Date("2026-10-02T03:00:00Z"), new Date("2026-10-02T05:00:00Z"));
    const first = await plan();
    expect(breaksWith(first, "SID")).toEqual(["03:28", "04:28"]);
    expect(breaksWith(first, "BMP")).toEqual(["03:28", "04:28"]);

    // An hour on: the 3:28 break aired both (the as-run log), and the 3:58 one aired neither.
    const stored = await h.services.log.ensureBreaks(id, new Date("2026-10-02T03:00:00Z"), new Date("2026-10-02T05:00:00Z"));
    const b328 = stored.find((b) => b.startsAt === "2026-10-02T03:28:00.000Z")!;
    await h.db.insert(schema.asRun).values([
      { stationId: id, code: "BMP", startedAt: new Date("2026-10-02T03:28:00Z"), endedAt: new Date("2026-10-02T03:28:10Z"), breakId: b328.id, reason: "planned" },
      { stationId: id, code: "SID", startedAt: new Date("2026-10-02T03:29:55Z"), endedAt: new Date("2026-10-02T03:30:00Z"), breakId: b328.id, reason: "planned" }
    ]);
    h.clock.set("2026-10-02T04:05:00.000Z");
    const later = await planner.plan(id, new Date("2026-10-02T04:05:00Z"), new Date("2026-10-02T05:00:00Z"));
    expect(breaksWith(later, "SID")).toEqual(["04:28"]);
    expect(breaksWith(later, "BMP")).toEqual(["04:28"]);
    // The log's view of the breaks says the same.
    const log = await kai.get(`/v1/stations/${id}/log?from=2026-10-02T04:00:00.000Z&to=2026-10-02T05:00:00.000Z`).expect(200);
    const rows = (startsAt: string) => (log.body.breaks as Array<{ startsAt: string; rows: Array<{ code: string; title: string }> }>).find((b) => b.startsAt === startsAt)!.rows;
    expect(rows("2026-10-02T04:28:00.000Z").map((r) => r.code).at(-1)).toBe("SID");
    expect(rows("2026-10-02T04:58:00.000Z").map((r) => `${r.code} ${r.title}`)).toEqual(["OPEN Station ID slate"]);
    h.clock.set("2026-10-02T02:59:00.000Z");
  });

  it("warns, without holding up sign-on, when the cadence leaves more than an hour without a station ID", async () => {
    const id = await station("WARN", 171);
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ mode: "after_every_program", everyMinutes: null, cadence: { stationId: { every: "n_programs", n: 4 }, bumpers: { every: "break" }, underwriting: { every: "break" } } })).expect(200);
    await programs(id, "2026-10-02T02:30:00.000Z", 50, 30, 28);
    const check = async () => ((await kai.get(`/v1/stations/${id}/sign-on/checks`).expect(200)).body as { ready: boolean; checks: Array<{ key: string; passed: boolean; blocking: boolean; detail: string }> });
    const warned = await check();
    const hourly = warned.checks.find((c) => c.key === "station_id_hourly")!;
    expect(hourly).toMatchObject({ passed: false, blocking: false });
    expect(hourly.detail).toMatch(/^Up to 2 hr without one, from how often it airs in breaks\. \d+ times a day$/);
    expect(warned.ready).toBe(true);
    // Once an hour is fine.
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ mode: "after_every_program", everyMinutes: null, cadence: { stationId: { every: "hour" }, bumpers: { every: "break" }, underwriting: { every: "break" } } })).expect(200);
    expect((await check()).checks.find((c) => c.key === "station_id_hourly")).toMatchObject({ passed: true, blocking: true });
  });
});

describe("the generated station ID", () => {
  let id: string;

  it("airs where a station with none of its own needs a station ID, and is asked for when it isn't prepared", async () => {
    id = await station("GENR", 181, { sid: false, bumper: false });
    await kai.put(`/v1/stations/${id}/break-rule`, rule({ mode: "after_every_program", everyMinutes: null })).expect(200);
    await programs(id, "2026-10-02T03:00:00.000Z", 1, 30, 28);
    const segments = await planner.plan(id, new Date("2026-10-02T03:00:00Z"), new Date("2026-10-02T03:31:00Z"));
    const look = (await h.services.stations.look(id))!;
    const key = generatedStationIdKey(look, "tv");
    // In the break and in open time: ten seconds, prepared under its own key.
    expect(shape(segments)).toEqual(["03:00:00 PGM 1680s", "03:28:00 OPEN 110s", "03:29:50 SID 10s", "03:30:00 OPEN 50s", "03:30:50 SID 10s"]);
    const sid = segments.find((s) => s.code === "SID")!;
    expect(sid).toMatchObject({ label: "GENR 18.1", source: { kind: "file", contentId: key, location: `cid:${key}` }, itemId: undefined });

    // Not prepared: the station ID slate airs meanwhile, and the generated one is asked for.
    const notReady = createPlanner({ deps: h.deps, services: h.services }, { isReady: (ref) => !ref.contentId?.startsWith("sid-"), wantGenerated: async (spec) => void wanted.push(spec.key) });
    const meanwhile = await notReady.plan(id, new Date("2026-10-02T03:28:00Z"), new Date("2026-10-02T03:30:00Z"));
    expect(meanwhile.find((s) => s.code === "SID")).toMatchObject({ slate: "station_id", source: { kind: "image" } });
    expect(wanted).toContain(key);
  });

  it("is made again when the station's name or colour changes", async () => {
    const before = generatedStationIdKey((await h.services.stations.look(id))!, "tv");
    await kai.patch(`/v1/stations/${id}/setup`, { name: "Genre Radio" }).expect(200);
    const renamed = generatedStationIdKey((await h.services.stations.look(id))!, "tv");
    await kai.patch(`/v1/stations/${id}/setup`, { colour: "#1F5C99" }).expect(200);
    const recoloured = generatedStationIdKey((await h.services.stations.look(id))!, "tv");
    expect(new Set([before, renamed, recoloured]).size).toBe(3);
    const notReady = createPlanner({ deps: h.deps, services: h.services }, { isReady: (ref) => !ref.contentId?.startsWith("sid-"), wantGenerated: async (spec) => void wanted.push(spec.key) });
    await notReady.plan(id, new Date("2026-10-02T03:28:00Z"), new Date("2026-10-02T03:30:00Z"));
    expect(wanted.at(-1)).toBe(recoloured);
  });

  it("shows in the library, read-only, until a station ID of its own can air; that one wins", async () => {
    const lib = await kai.get(`/v1/stations/${id}/library`).expect(200);
    expect(lib.body.generatedStationId).toEqual({
      code: "SID",
      durationMs: 10_000,
      sound: "bed",
      status: "preparing",
      look: { callSign: "GENR", channel: "18.1", name: "Genre Radio", city: null, colour: "#1F5C99" },
      playbackUrl: null
    });
    expect(lib.body.items.some((i: { code: string }) => i.code === "SID")).toBe(false);

    const own = await itemFixture(h, id, { title: "GENR ident", code: "SID", durationMs: 5_000 });
    expect((await kai.get(`/v1/stations/${id}/library`).expect(200)).body.generatedStationId).toBeNull();
    const segments = await planner.plan(id, new Date("2026-10-02T03:28:00Z"), new Date("2026-10-02T03:30:00Z"));
    expect(segments.find((s) => s.code === "SID")).toMatchObject({ itemId: own.id, label: "GENR ident", source: { kind: "file" } });
  });

  it("lets a station with one program and no station ID of its own sign on", async () => {
    const owner = await h.signIn("Solo");
    const s = await stationFixture(h, { callSign: "SOLO", name: "Solo", ownerId: owner.id, marketId, tenths: 191 });
    const item = await itemFixture(h, s.id, { title: "The one show", durationMs: 57.5 * MIN });
    await owner.post(`/v1/stations/${s.id}/log/fill`, { with: "repeat", startsAt: "2026-10-02T02:59:00.000Z", endsAt: "2026-10-03T04:00:00.000Z", itemIds: [item.id] }).expect(200);
    const checks = await owner.get(`/v1/stations/${s.id}/sign-on/checks`).expect(200);
    expect(checks.body.checks.filter((c: { blocking: boolean; passed: boolean }) => c.blocking && !c.passed)).toEqual([]);
    expect((await owner.get(`/v1/stations/${s.id}/library`).expect(200)).body.generatedStationId).toMatchObject({ status: "preparing" });
    await owner.post(`/v1/stations/${s.id}/sign-on`).expect(202);
  });
});

describe("the generated station ID on air", () => {
  let engine: Engine;
  let stationId: string;
  const transcoder = fakeTranscoder();
  const beds: string[] = [];

  beforeAll(async () => {
    h.clock.set("2026-10-02T05:59:52.000Z");
    stationId = await station("ONAI", 201, { sid: false, bumper: false });
    await kai.put(`/v1/stations/${stationId}/break-rule`, rule({ mode: "after_every_program", everyMinutes: null })).expect(200);
    const show = await itemFixture(h, stationId, { title: "Night Desk", durationMs: 48_000, location: await dummyFile() });
    await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-02T06:00:00.000Z", endsAt: "2026-10-02T06:01:00.000Z", itemId: show.id }).expect(201);
    await h.db.insert(schema.playoutState).values({ stationId, onAir: true });
    engine = createEngine(
      { deps: h.deps, services: h.services },
      {
        transcoder: Object.assign(async (job: Parameters<typeof transcoder>[0]) => {
          if (job.source.kind === "slate" && job.source.bed) beds.push(job.key);
          return transcoder(job);
        }, transcoder),
        translators: false
      }
    );
    await engine.tick();
    await prepareQueued(h, engine.preparer);
  }, 60_000);
  afterAll(async () => {
    await engine?.stopAll();
  });

  it("is prepared once, over the sound bed, before it airs, and the library previews it", async () => {
    const key = generatedStationIdKey((await h.services.stations.look(stationId))!, "tv");
    await engine.queueGeneratedIds();
    await prepareQueued(h, engine.preparer);
    expect(beds.filter((k) => k === key)).toHaveLength(1);
    const [row] = await h.db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, key));
    expect(row).toMatchObject({ kind: "slate", status: "ready", durationMs: 10_000 });
    const lib = await kai.get(`/v1/stations/${stationId}/library`).expect(200);
    expect(lib.body.generatedStationId).toMatchObject({ status: "ready", playbackUrl: expect.stringMatching(new RegExp(`/prepared/${key}/v720/index\\.m3u8$`)) });
  });

  it("airs in the channel as a station ID: its item tag says SID, and the bug stays off it", async () => {
    for (let t = h.clock.now().getTime(); t < Date.parse("2026-10-02T06:01:30Z"); t += 2_000) {
      h.clock.advance(2_000);
      await engine.tick();
      await prepareQueued(h, engine.preparer);
    }
    const key = generatedStationIdKey((await h.services.stations.look(stationId))!, "tv");
    const ranges = parseDateRanges((await h.services.playout.playlist(stationId, "v720.m3u8"))!.body);
    const sid = ranges.find((r) => r.class === HLS_CLASS.item && r.attributes.code === "SID" && r.attributes.contentId === key)!;
    expect(sid).toBeTruthy();
    expect(sid.end! - sid.start).toBe(10_000);
    expect(ranges.some((r) => r.class === HLS_CLASS.bug && r.start === sid.start)).toBe(false);
    const aired = await h.db.select().from(schema.asRun).where(eq(schema.asRun.stationId, stationId));
    expect(aired.some((r) => r.code === "SID" && r.startedAt.getTime() === sid.start && r.assetId === null)).toBe(true);
  }, 60_000);
});
