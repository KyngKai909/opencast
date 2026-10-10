// A246 (Schedule, Phase 3): the break rule's preview, and S20, Up next with its own cadence. The
// preview (`POST /stations/:id/break-rule/preview`) answers what `getLog` would after saving the
// same rule, writes nothing, and refuses what `setBreakRule` refuses. `cadence.upNext` left out
// airs as before; set, it decides Up next on its own, whatever its bumper position says.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createPlanner } from "../src/v1/modules/playout/engine/plan.js";
import { UpNextDecider, upNextHome, withUpNext } from "../src/v1/modules/playout/engine/sequence.js";
import { createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let jess: User;
let marketId: string;
let planner: ReturnType<typeof createPlanner>;
const MIN = 60_000;
const FROM = "2026-10-02T03:00:00.000Z";
const TO = "2026-10-02T05:00:00.000Z";

const RULE = { mode: "after_every_program", everyMinutes: null, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "spot_market", blockedCategories: [] };
const CADENCE = { stationId: { every: "break" }, bumpers: { every: "break" }, underwriting: { every: "break" }, spots: { every: "break" } };
/** Up next between programs, beside a sting (Any): one `between.every` governs both until S20. */
const BETWEEN = { open: { roles: ["into_break"], every: "break" }, close: { roles: ["out_of_break"], every: "break" }, between: { roles: ["up_next", "any"], every: "program" } };

async function station(callSign: string, tenths: number) {
  const s = await stationFixture(h, { callSign, name: `${callSign} TV`, ownerId: kai.id, marketId, tenths, signedOn: true, colour: "#8C3B7A" });
  await itemFixture(h, s.id, { title: `${callSign} ident`, code: "SID", durationMs: 5_000 });
  await itemFixture(h, s.id, { title: "Right back", code: "BMP", bumperRole: "into_break", durationMs: 5_000 });
  await itemFixture(h, s.id, { title: "Up next", code: "BMP", bumperRole: "up_next", durationMs: 8_000 });
  await itemFixture(h, s.id, { title: "Back to it", code: "BMP", bumperRole: "out_of_break", durationMs: 5_000 });
  await itemFixture(h, s.id, { title: "Sting", code: "BMP", durationMs: 3_000 });
  return s.id;
}

/** Four half-hour programs from 3:00 (8:00 pm in Los Angeles), each leaving a two-minute break. */
async function evening(stationId: string) {
  for (const [i, title] of ["Late Crate", "Saturday Reel", "Crate Talk", "Slow Hours"].entries()) {
    const p = await kai.post(`/v1/stations/${stationId}/programs`, { title, description: `${title}.` }).expect(201);
    const item = await itemFixture(h, stationId, { title: `${title}, ep. 1`, programId: p.body.id, durationMs: 28 * MIN });
    const start = Date.parse(FROM) + i * 30 * MIN;
    await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: new Date(start).toISOString(), endsAt: new Date(start + 30 * MIN).toISOString(), itemId: item.id }).expect(201);
  }
}

const preview = (stationId: string, rule: object, from = FROM, to = TO) => kai.post(`/v1/stations/${stationId}/break-rule/preview`, { rule, from, to });
const getLog = async (stationId: string) => (await kai.get(`/v1/stations/${stationId}/log?from=${FROM}&to=${TO}`).expect(200)).body;
const getRule = async (stationId: string) => (await kai.get(`/v1/stations/${stationId}/break-rule`).expect(200)).body;

type Row = { code: string; title: string; element?: { position: string; role: string } };
type Break = { startsAt: string; rows: Row[] };
/** Each break's bumpers as "position role" (between programs last). */
const bumpers = (breaks: Break[]) => breaks.map((b) => b.rows.filter((r) => r.code === "BMP").map((r) => `${r.element!.position} ${r.element!.role}`));
const upNexts = (breaks: Break[]) => breaks.filter((b) => b.rows.some((r) => r.element?.role === "up_next")).map((b) => b.startsAt.slice(11, 16));

/** A hash of every table's rows: anything written anywhere changes it. */
async function everything() {
  const rows = <T>(r: unknown) => ((r as { rows?: T[] }).rows ?? (r as T[]));
  const tables = rows<{ s: string; t: string }>(await h.db.execute(sql`select table_schema as s, table_name as t from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema') order by 1, 2`));
  expect(tables.length).toBeGreaterThan(20);
  const out: Record<string, string> = {};
  for (const { s, t } of tables) {
    const [row] = rows<{ h: string }>(await h.db.execute(sql.raw(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from "${s}"."${t}" x`)));
    out[`${s}.${t}`] = row.h;
  }
  return out;
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-02T02:59:00.000Z"); // 7:59 pm in Los Angeles.
  planner = createPlanner({ deps: h.deps, services: h.services });
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
  jess = await h.signIn("Jess");
}, 60_000);
afterAll(() => h.close());

describe("previewing a break rule", () => {
  let id: string;
  beforeAll(async () => {
    id = await station("PREV", 131);
    await evening(id);
    await kai.put(`/v1/stations/${id}/break-rule`, { ...RULE, cadence: CADENCE }).expect(200);
  }, 60_000);

  it("answers what getLog shows after saving the same rule", async () => {
    const before = await getRule(id);
    const next = { ...before, cadence: { ...before.cadence, stationId: { every: "hour" }, bumpers: { every: "program" } }, bumperSequences: { ...BETWEEN, open: { roles: ["into_break", "up_next"], every: "program" } }, blockedCategories: [" Alcohol", "Alcohol", "Gambling"] };
    const seen = (await preview(id, next).expect(200)).body;
    // The rule as it would be saved: merged, checked and read back the way getBreakRule reads it.
    const saved = (await kai.put(`/v1/stations/${id}/break-rule`, next).expect(200)).body;
    expect(seen.rule).toEqual(saved);
    const log = await getLog(id);
    expect(seen.entries).toEqual(log.entries);
    expect(seen.breaks.map(({ keeps: _k, ...b }: { keeps: boolean }) => b)).toEqual(log.breaks);
    expect(seen.blocks).toEqual(log.blocks);
    expect(seen.breaks).toHaveLength(4);
    // The rule changed something: the station ID once an hour.
    expect(seen.breaks.map((b: Break) => b.rows.some((r) => r.code === "SID"))).toEqual([true, false, true, false]);
    await kai.put(`/v1/stations/${id}/break-rule`, before).expect(200);
  });

  it("rebuilds the breaks before saving: the same window reads differently with another rule", async () => {
    const rule = await getRule(id);
    const now = (await preview(id, rule).expect(200)).body;
    const hourly = (await preview(id, { ...rule, cadence: { ...rule.cadence, stationId: { every: "hour" } } }).expect(200)).body;
    expect(now.breaks.map((b: Break) => b.rows.some((r) => r.code === "SID"))).toEqual([true, true, true, true]);
    expect(hourly.breaks.map((b: Break) => b.rows.some((r) => r.code === "SID"))).toEqual([true, false, true, false]);
    // Saved? No: the rule and the log are as they were.
    expect(await getRule(id)).toEqual(rule);
    expect(bumpers((await getLog(id)).breaks)).toEqual(bumpers(now.breaks));
  });

  it("writes nothing: no rule, no breaks stored, no spots placed, nothing sent", async () => {
    const rule = await getRule(id);
    const sent = h.sent.length;
    const before = await everything();
    await preview(id, { ...rule, mode: "every_n_minutes", everyMinutes: 15, cadence: { ...rule.cadence, upNext: { every: "hour" }, spots: { every: "never" } }, adsFromPartners: true, dailyOpener: true, blockedCategories: ["Cannabis"] }).expect(200);
    await preview(id, rule).expect(200);
    expect(await everything()).toEqual(before);
    expect(h.sent.length).toBe(sent);
  });

  it("says which breaks keep what they have: one that's started", async () => {
    h.clock.set("2026-10-02T03:28:30.000Z");
    const seen = (await preview(id, await getRule(id)).expect(200)).body;
    expect(seen.breaks.map((b: { keeps: boolean }) => b.keeps)).toEqual([true, false, false, false]);
    h.clock.set("2026-10-02T02:59:00.000Z");
  });

  it("refuses what setBreakRule refuses, in the same words", async () => {
    const rule = await getRule(id);
    const bodies = [
      { ...rule, mode: "every_n_minutes", everyMinutes: null },
      { ...rule, cadence: { ...rule.cadence, stationId: { every: "never" } } },
      { ...rule, cadence: { ...rule.cadence, underwriting: { every: "n_programs" } } },
      { ...rule, cadence: { ...rule.cadence, upNext: { every: "n_programs" } } },
      { ...rule, bumperSequences: { ...BETWEEN, close: { roles: ["any", "any"], every: "break" } } },
      { ...rule, bumperSequences: { ...BETWEEN, between: { roles: ["any"], every: "n_programs" } } },
      { ...rule, lengthMs: "two minutes" }
    ];
    for (const body of bodies) {
      const set = await kai.put(`/v1/stations/${id}/break-rule`, body);
      const seen = await preview(id, body);
      expect(set.status).toBe(400);
      expect(seen.status).toBe(400);
      // The contract's own checks name the body's field; the preview's body has it under `rule`.
      const fields = Object.fromEntries(Object.entries(seen.body.error.fields ?? {}).map(([k, v]) => [k.replace(/^rule\./, ""), v]));
      expect({ ...seen.body.error, fields }).toEqual({ ...set.body.error, fields: set.body.error.fields ?? {} });
    }
    // Nothing was saved by any of them.
    expect(await getRule(id)).toEqual(rule);
  });

  it("covers a window of three hours at most, and the same people as setBreakRule", async () => {
    const rule = await getRule(id);
    await preview(id, rule, FROM, "2026-10-02T06:00:01.000Z").expect(400);
    await preview(id, rule, TO, FROM).expect(400);
    await preview(id, rule, FROM, "2026-10-02T06:00:00.000Z").expect(200);
    const set = await jess.put(`/v1/stations/${id}/break-rule`, rule);
    const seen = await jess.post(`/v1/stations/${id}/break-rule/preview`).send({ rule, from: FROM, to: TO });
    expect(seen.status).toBe(set.status);
    expect(seen.status).toBeGreaterThanOrEqual(403);
  });
});

describe("the station ID can't be never", () => {
  it("in the rule, saved or previewed; Up next can", async () => {
    const id = await station("NSID", 141);
    const rule = await getRule(id);
    const never = { ...rule, cadence: { ...rule.cadence, stationId: { every: "never" } } };
    await kai.put(`/v1/stations/${id}/break-rule`, never).expect(400);
    await preview(id, never).expect(400);
    const upNext = { ...rule, cadence: { ...rule.cadence, upNext: { every: "never" } } };
    expect((await preview(id, upNext).expect(200)).body.rule.cadence.upNext).toEqual({ every: "never" });
    expect((await kai.put(`/v1/stations/${id}/break-rule`, upNext).expect(200)).body.cadence.upNext).toEqual({ every: "never" });
  });
});

describe("S20: Up next with its own cadence", () => {
  let id: string;
  let asBefore: Break[];
  beforeAll(async () => {
    id = await station("UPNX", 151);
    await evening(id);
    await kai.put(`/v1/stations/${id}/break-rule`, { ...RULE, cadence: CADENCE, bumperSequences: BETWEEN }).expect(200);
    asBefore = (await getLog(id)).breaks;
  }, 60_000);

  it("left out, Up next airs as its position says, as before (and getBreakRule doesn't add it)", async () => {
    const rule = await getRule(id);
    expect(rule.cadence).not.toHaveProperty("upNext");
    // Between programs, after each closing break's station ID: Up next, then the sting.
    expect(bumpers(asBefore)).toEqual(Array(4).fill(["open into_break", "close out_of_break", "between up_next", "between any"]).slice(0, 3).concat([["open into_break", "close out_of_break"]]));
  });

  it("set, it changes Up next alone: the bumper sequences, and the sting beside it, stay", async () => {
    const rule = await getRule(id);
    const hourly = (await kai.put(`/v1/stations/${id}/break-rule`, { ...rule, cadence: { ...rule.cadence, upNext: { every: "hour" } } }).expect(200)).body;
    expect(hourly.cadence.upNext).toEqual({ every: "hour" });
    expect(hourly.bumperSequences).toEqual(rule.bumperSequences);
    const breaks = (await getLog(id)).breaks;
    // Once an hour: the boundary at 8:30 pm (local) is the hour's first; 9:00 pm the next hour's.
    expect(upNexts(breaks)).toEqual(["03:28", "03:58"]);
    expect(bumpers(breaks).map((b) => b.filter((x) => x === "between any").length)).toEqual([1, 1, 1, 0]);
    // The planner (playout) airs the same.
    const segments = await planner.plan(id, new Date("2026-10-02T03:28:00Z"), new Date("2026-10-02T04:30:00Z"));
    expect(segments.filter((s) => s.bumperRole === "up_next").map((s) => s.startsAt.toISOString().slice(11, 19))).toEqual(["03:29:49", "03:59:49"]);
  });

  it("never takes Up next off; the position's sting still airs", async () => {
    const rule = await getRule(id);
    await kai.put(`/v1/stations/${id}/break-rule`, { ...rule, cadence: { ...rule.cadence, upNext: { every: "never" } } }).expect(200);
    const breaks = (await getLog(id)).breaks;
    expect(upNexts(breaks)).toEqual([]);
    expect(bumpers(breaks)[0]).toEqual(["open into_break", "close out_of_break", "between any"]);
  });

  it("airs even where its position says never, and between programs when no position has it", async () => {
    const rule = await getRule(id);
    // Between programs never airs, but Up next goes by its own cadence.
    const quiet = { ...rule, cadence: { ...rule.cadence, upNext: { every: "program" } }, bumperSequences: { ...BETWEEN, between: { roles: ["up_next", "any"], every: "never" } } };
    expect(bumpers((await preview(id, quiet).expect(200)).body.breaks)[0]).toEqual(["open into_break", "close out_of_break", "between up_next"]);
    // No position has its role: between programs, last.
    const nowhere = { ...rule, cadence: { ...rule.cadence, upNext: { every: "program" } }, bumperSequences: { ...BETWEEN, between: { roles: ["any"], every: "program" } } };
    expect(bumpers((await preview(id, nowhere).expect(200)).body.breaks)[0]).toEqual(["open into_break", "close out_of_break", "between any", "between up_next"]);
    // In the opening sequence, every two programs: in that break.
    const open = { ...rule, cadence: { ...rule.cadence, upNext: { every: "n_programs", n: 2 } }, bumperSequences: { ...BETWEEN, open: { roles: ["into_break", "up_next"], every: "break" }, between: { roles: ["any"], every: "program" } } };
    const opened = (await preview(id, open).expect(200)).body.breaks;
    expect(upNexts(opened)).toEqual(["03:28", "04:28"]);
    expect(opened[0].rows.find((r: Row) => r.element?.role === "up_next").element.position).toBe("open");
  });

  it("left out of a later body it stays; null clears it, back to exactly as before", async () => {
    const rule = await getRule(id);
    const { upNext: _drop, ...older } = { ...rule.cadence, upNext: undefined };
    await kai.put(`/v1/stations/${id}/break-rule`, { ...rule, cadence: { ...rule.cadence, upNext: { every: "hour" } } }).expect(200);
    expect((await kai.put(`/v1/stations/${id}/break-rule`, { ...rule, cadence: older }).expect(200)).body.cadence.upNext).toEqual({ every: "hour" });
    const cleared = (await kai.put(`/v1/stations/${id}/break-rule`, { ...rule, bumperSequences: BETWEEN, cadence: { ...older, upNext: null } }).expect(200)).body;
    expect(cleared.cadence).not.toHaveProperty("upNext");
    expect((await getLog(id)).breaks).toEqual(asBefore);
  });
});

describe("Up next's decider, worked out", () => {
  const starts = [0, 30, 60, 90].map((m) => Date.parse(FROM) + m * MIN);
  const run = (cadence: { every: "break" | "program" | "n_programs" | "hour" | "never"; n?: number }) => {
    const d = new UpNextDecider({ cadence, last: null, times: [], settledBefore: 0, hourStart: (t) => Math.floor(t / 3_600_000) * 3_600_000, starts });
    return starts.slice(1).map((at) => d.next({ at, afterProgram: true }));
  };

  it("every program, every N, once an hour, never; a break and its boundary are one chance", () => {
    expect(run({ every: "program" })).toEqual([true, true, true]);
    expect(run({ every: "n_programs", n: 2 })).toEqual([true, false, true]);
    expect(run({ every: "hour" })).toEqual([true, true, false]);
    expect(run({ every: "never" })).toEqual([false, false, false]);
    const d = new UpNextDecider({ cadence: { every: "n_programs", n: 2 }, last: null, times: [], settledBefore: 0, hourStart: () => 0, starts });
    expect([d.next({ at: starts[1], from: starts[1] - 2 * MIN, afterProgram: true }), d.next({ at: starts[1], afterProgram: true })]).toEqual([true, true]);
  });

  it("its place: the first position with its role, else between programs, last", () => {
    expect(upNextHome({ open: { roles: ["into_break"], every: "break" }, close: { roles: ["up_next"], every: "break" }, between: { roles: ["up_next"], every: "program" } })).toBe("close");
    expect(upNextHome({ open: { roles: [], every: "break" }, close: { roles: [], every: "break" }, between: { roles: ["any"], every: "program" } })).toBe("between");
    const seq = { open: { roles: [], every: "break" as const }, close: { roles: [], every: "break" as const }, between: { roles: ["any" as const, "up_next" as const, "into_break" as const], every: "program" as const } };
    expect(withUpNext(seq, "between", ["any", "into_break"])).toEqual(["any", "up_next", "into_break"]);
    expect(withUpNext(seq, "between", [])).toEqual(["up_next"]);
  });
});
