// A247 (2026-10-04, the user's decision): more ways to set when breaks come. After every N
// programs, any number of minutes, clock breaks at minutes past the hour, and breaks inside long
// programs too, each an optional field on the break rule (log/timing.ts has the rules). A station
// that sets none of them airs exactly as before; the preview answers what getLog does after saving;
// older apps (bodies without the fields) keep what's set unless they change the mode it goes with.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { programRuns, resolveTiming, type RunEntry } from "../src/v1/modules/log/timing.js";
import { createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let marketId: string;
let tenths = 140;
/** A channel number not yet taken (never X.0). */
const nextTenths = () => (++tenths % 10 ? tenths : ++tenths);
const MIN = 60_000;
const DAY = "2026-10-02";
/** 3:00 UTC is 8:00 pm in Los Angeles (whole hours apart, so minutes past the hour read the same). */
const T = (hhmm: string) => `${DAY}T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}.000Z`;
const FROM = T("03:00");
const TO = T("06:00");

const RULE = { mode: "after_every_program", everyMinutes: null, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "spot_market", blockedCategories: [] };

async function station(callSign: string) {
  const s = await stationFixture(h, { callSign, name: `${callSign} TV`, ownerId: kai.id, marketId, tenths: nextTenths(), signedOn: true });
  await itemFixture(h, s.id, { title: `${callSign} ident`, code: "SID", durationMs: 5_000 });
  await itemFixture(h, s.id, { title: "Right back", code: "BMP", bumperRole: "into_break", durationMs: 5_000 });
  await itemFixture(h, s.id, { title: "Back to it", code: "BMP", bumperRole: "out_of_break", durationMs: 5_000 });
  return s.id;
}

/** A program with one episode of `minutes`, on the log from `from` to `to`. */
async function program(stationId: string, title: string, from: string, to: string, minutes: number) {
  const p = await kai.post(`/v1/stations/${stationId}/programs`, { title, description: `${title}.` }).expect(201);
  const item = await itemFixture(h, stationId, { title, programId: p.body.id, durationMs: minutes * MIN });
  const entry = await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: T(from), endsAt: T(to), itemId: item.id }).expect(201);
  return { programId: p.body.id as string, itemId: item.id, entryId: entry.body.id as string };
}

/** Four half-hour programs from 8:00 pm, each 28 minutes long (a two-minute break after each). */
async function evening(stationId: string) {
  const out = [];
  for (const [i, title] of ["Late Crate", "Saturday Reel", "Crate Talk", "Slow Hours"].entries()) {
    const at = (m: number) => new Date(Date.parse(FROM) + m * MIN).toISOString().slice(11, 16);
    out.push(await program(stationId, title, at(i * 30), at(i * 30 + 30), 28));
  }
  return out;
}

type Slot = { startsAt: string; lengthMs: number; context: string; origin: string; producerShareMs: number; logEntryId: string | null };
const getLog = async (id: string, from = FROM, to = TO) => (await kai.get(`/v1/stations/${id}/log?from=${from}&to=${to}`).expect(200)).body as { breaks: Slot[]; entries: unknown[] };
const getRule = async (id: string) => (await kai.get(`/v1/stations/${id}/break-rule`).expect(200)).body;
const save = (id: string, rule: object) => kai.put(`/v1/stations/${id}/break-rule`, rule);
const preview = (id: string, rule: object, from = FROM, to = T("06:00")) => kai.post(`/v1/stations/${id}/break-rule/preview`, { rule, from, to });
/** "03:28:00 2:00 After Late Crate". */
const said = (breaks: Slot[]) => breaks.map((b) => `${b.startsAt.slice(11, 19)} ${Math.floor(b.lengthMs / MIN)}:${String((b.lengthMs % MIN) / 1000).padStart(2, "0")} ${b.context}`);

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-02T02:59:00.000Z");
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
}, 60_000);
afterAll(() => h.close());

// ---- Worked out (no database) ---------------------------------------------------------------

describe("the rules, worked out", () => {
  const entry = (id: string, kind: string, startsAt: number, o: Partial<RunEntry> = {}): RunEntry => ({ id, kind, startsAt, endsAt: startsAt + 30, day: "d1", span: null, ...o });

  it("every N programs counts again at each broadcast day, after off air, and at a block's edge; live isn't counted", () => {
    const n = (list: RunEntry[], k = 2, off: (a: number, b: number) => boolean = () => false) => [...programRuns(list, k, off)];
    expect(n([entry("a", "program", 0), entry("b", "program", 30), entry("c", "program", 60), entry("d", "program", 90)])).toEqual(["b", "d"]);
    expect(n([entry("a", "program", 0), entry("b", "program", 30), entry("c", "program", 60), entry("d", "program", 90)], 3)).toEqual(["c"]);
    // Live in between: not counted, and the count goes on.
    expect(n([entry("a", "program", 0), entry("l", "live", 30), entry("b", "program", 60)])).toEqual(["b"]);
    // A new broadcast day starts again.
    expect(n([entry("a", "program", 0), entry("b", "program", 30, { day: "d2" }), entry("c", "program", 60, { day: "d2" })])).toEqual(["c"]);
    // Off air (an entry, or off air hours between two programs) starts again.
    expect(n([entry("a", "program", 0), entry("x", "off_air", 30), entry("b", "program", 60), entry("c", "program", 90)])).toEqual(["c"]);
    expect(n([entry("a", "program", 0), entry("b", "program", 60), entry("c", "program", 90)], 2, (a: number, b: number) => a === 30 && b === 60)).toEqual(["c"]);
    // Entering, leaving and between blocks starts again.
    expect(n([entry("a", "program", 0), entry("b", "program", 30, { span: "s1" }), entry("c", "program", 60, { span: "s1" }), entry("d", "program", 90), entry("e", "program", 120)])).toEqual(["c", "e"]);
  });

  it("checks and keeps what an older body leaves out", () => {
    const base = { mode: "every_n_minutes" as const, everyMinutes: 30, lengthMs: 120_000 };
    expect(resolveTiming({ ...base, clockMinutes: [45, 15, 15] }, undefined)).toEqual({ everyPrograms: null, clockMinutes: [15, 45], everyMinutes: 30, longPrograms: null });
    expect(resolveTiming({ ...base, clockMinutes: [0, 10, 20, 30, 40, 50] }, undefined).everyMinutes).toBe(10);
    // Around the hour too: :55 and :00 are five minutes apart.
    expect(() => resolveTiming({ ...base, clockMinutes: [0, 30, 55] }, undefined)).toThrow("Leave at least 10 minutes between break times.");
    // A four-minute break needs ten minutes; a seven-minute one twelve.
    expect(() => resolveTiming({ ...base, lengthMs: 7 * MIN, clockMinutes: [0, 10] }, undefined)).toThrow("Leave at least 12 minutes between break times.");
  });
});

// ---- Against the database ------------------------------------------------------------------

describe("nothing set: exactly as before", () => {
  let id: string;
  beforeAll(async () => {
    id = await station("SAME");
    await evening(id);
  }, 60_000);

  it("getBreakRule answers the new fields as not set", async () => {
    const rule = await getRule(id);
    expect(rule).toMatchObject({ mode: "after_every_program", everyPrograms: null, clockMinutes: null, longPrograms: null });
  });

  it("after every program and every N minutes lay out the breaks they did", async () => {
    await save(id, RULE).expect(200);
    expect(said((await getLog(id)).breaks)).toEqual(["03:28:00 2:00 After Late Crate", "03:58:00 2:00 After Saturday Reel", "04:28:00 2:00 After Crate Talk", "04:58:00 2:00 After Slow Hours"]);
    // Any number of minutes (15): one inside each 28-minute program, which then fills its slot.
    await save(id, { ...RULE, mode: "every_n_minutes", everyMinutes: 15 }).expect(200);
    expect(said((await getLog(id)).breaks)).toEqual(["03:15:00 2:00 During Late Crate", "03:45:00 2:00 During Saturday Reel", "04:15:00 2:00 During Crate Talk", "04:45:00 2:00 During Slow Hours"]);
  });

  it("setting the new fields and clearing them again leaves the log as it was", async () => {
    await save(id, RULE).expect(200);
    const before = await getLog(id);
    await save(id, { ...RULE, everyPrograms: 2, longPrograms: { overMs: 45 * MIN, everyMs: 20 * MIN } }).expect(200);
    expect((await getLog(id)).breaks).not.toEqual(before.breaks);
    await save(id, { ...RULE, everyPrograms: null, longPrograms: null }).expect(200);
    expect(await getLog(id)).toEqual(before);
    expect(await getRule(id)).toMatchObject({ everyPrograms: null, clockMinutes: null, longPrograms: null });
  });
});

describe("after every N programs", () => {
  let id: string;
  beforeAll(async () => {
    id = await station("NPRG");
    await evening(id);
  }, 60_000);

  it("a break after every 2nd program; between the others, no break", async () => {
    const saved = (await save(id, { ...RULE, everyPrograms: 2 }).expect(200)).body;
    expect(saved).toMatchObject({ mode: "after_every_program", everyPrograms: 2 });
    expect(said((await getLog(id)).breaks)).toEqual(["03:58:00 2:00 After Saturday Reel", "04:58:00 2:00 After Slow Hours"]);
    await save(id, { ...RULE, everyPrograms: 3 }).expect(200);
    expect(said((await getLog(id)).breaks)).toEqual(["04:28:00 2:00 After Crate Talk"]);
  });

  it("decides the same whatever window is read", async () => {
    await save(id, { ...RULE, everyPrograms: 2 }).expect(200);
    expect(said((await getLog(id, T("04:00"), T("05:00"))).breaks)).toEqual(["04:58:00 2:00 After Slow Hours"]);
  });

  it("live programs cue their own and aren't counted", async () => {
    const live = await station("NLIV");
    const source = (await kai.post(`/v1/stations/${live}/live-sources`, { kind: "encoder", name: "Studio A" }).expect(201)).body.source.id;
    await program(live, "First", "03:00", "03:30", 28);
    const liveEntry = (await kai.post(`/v1/stations/${live}/log`, { kind: "live", startsAt: T("03:30"), endsAt: T("04:30"), liveSourceId: source }).expect(201)).body.id;
    await program(live, "Second", "04:30", "05:00", 28);
    await save(live, { ...RULE, everyPrograms: 2 }).expect(200);
    const breaks = (await getLog(live)).breaks;
    expect(said(breaks)).toEqual(["04:58:00 2:00 After Second"]);
    expect(breaks.some((b) => b.logEntryId === liveEntry)).toBe(false);
  });
});

describe("clock breaks", () => {
  it("at :15 and :45, inside a long program: it pauses there, then its break after", async () => {
    const id = await station("CLKA");
    // A 100-minute film in a two-hour slot (8:00 to 10:00 pm): 20 minutes left for breaks.
    await program(id, "Saturday Feature", "03:00", "05:00", 100);
    const saved = (await save(id, { ...RULE, mode: "every_n_minutes", everyMinutes: 30, clockMinutes: [45, 15] }).expect(200)).body;
    expect(saved).toMatchObject({ mode: "every_n_minutes", everyMinutes: 30, clockMinutes: [15, 45] });
    // 4:45 has a minute of the film left: too close to its end (the break after it comes then).
    expect(said((await getLog(id)).breaks)).toEqual([
      "03:15:00 2:00 During Saturday Feature",
      "03:45:00 2:00 During Saturday Feature",
      "04:15:00 2:00 During Saturday Feature",
      "04:46:00 14:00 After Saturday Feature"
    ]);
  });

  it("a time on a program boundary is the break after the program; one too close to another is skipped", async () => {
    const id = await station("CLKB");
    // Ends at 8:26: its break runs to 8:30. The next starts at 8:30 and runs 55 minutes.
    await program(id, "Late Crate", "03:00", "03:30", 26);
    await program(id, "Crate Session", "03:30", "04:30", 55);
    // 9:30 to 10:10 pm, 33 minutes: 10:02 would leave one minute of it.
    await program(id, "Crate Talk", "04:30", "05:10", 33);
    await save(id, { ...RULE, mode: "every_n_minutes", everyMinutes: 30, clockMinutes: [2, 32] }).expect(200);
    // 8:02 (two minutes into Late Crate) and 8:32 (two minutes after its break) are too close; 9:02 airs.
    expect(said((await getLog(id)).breaks)).toEqual([
      "03:26:00 4:00 After Late Crate",
      "04:02:00 2:00 During Crate Session",
      "04:27:00 3:00 After Crate Session",
      "05:03:00 7:00 After Crate Talk"
    ]);
    await save(id, { ...RULE, mode: "every_n_minutes", everyMinutes: 30, clockMinutes: [0, 30] }).expect(200);
    // 8:30 and 9:30 are program boundaries; 9:00 is half an hour into Crate Session; 10:00 leaves 3 minutes of Crate Talk.
    expect(said((await getLog(id)).breaks)).toEqual(["03:26:00 4:00 After Late Crate", "04:00:00 2:00 During Crate Session", "04:27:00 3:00 After Crate Session", "05:03:00 7:00 After Crate Talk"]);
  });

  it("a program that fills its slot isn't cut for a break", async () => {
    const id = await station("CLKC");
    await program(id, "Full Hour", "03:00", "04:00", 60);
    await save(id, { ...RULE, mode: "every_n_minutes", everyMinutes: 30, clockMinutes: [15, 45] }).expect(200);
    expect((await getLog(id)).breaks).toEqual([]);
  });

  it("live programs cue their own", async () => {
    const id = await station("CLKD");
    const source = (await kai.post(`/v1/stations/${id}/live-sources`, { kind: "encoder", name: "Studio A" }).expect(201)).body.source.id;
    await kai.post(`/v1/stations/${id}/log`, { kind: "live", startsAt: T("03:00"), endsAt: T("04:00"), liveSourceId: source }).expect(201);
    await save(id, { ...RULE, mode: "every_n_minutes", everyMinutes: 30, clockMinutes: [15, 45] }).expect(200);
    expect((await getLog(id)).breaks).toEqual([]);
  });
});

describe("inside long programs too", () => {
  it("with after every program: every 30 minutes inside a program over 45, its break after as before", async () => {
    const id = await station("LONG");
    await program(id, "Late Crate", "03:00", "03:30", 28);
    await program(id, "Saturday Feature", "03:30", "05:30", 100);
    const saved = (await save(id, { ...RULE, longPrograms: { overMs: 45 * MIN, everyMs: 30 * MIN } }).expect(200)).body;
    expect(saved).toMatchObject({ mode: "after_every_program", longPrograms: { overMs: 45 * MIN, everyMs: 30 * MIN } });
    expect(said((await getLog(id)).breaks)).toEqual([
      "03:28:00 2:00 After Late Crate",
      "04:00:00 2:00 During Saturday Feature",
      "04:32:00 2:00 During Saturday Feature",
      "05:04:00 2:00 During Saturday Feature",
      "05:16:00 14:00 After Saturday Feature"
    ]);
  });

  it("with clock breaks: every 30 minutes counted from the last break inside", async () => {
    const id = await station("LCLK");
    await program(id, "Saturday Feature", "03:00", "05:00", 100);
    await save(id, { ...RULE, mode: "every_n_minutes", everyMinutes: 60, clockMinutes: [0], longPrograms: { overMs: 45 * MIN, everyMs: 30 * MIN } }).expect(200);
    // 8:30 (30 minutes in), 9:00 (the clock, 28 minutes of film after), 9:32 (30 minutes of film after
    // that); 10:00 is past its end.
    expect(said((await getLog(id)).breaks)).toEqual(["03:30:00 2:00 During Saturday Feature", "04:00:00 2:00 During Saturday Feature", "04:32:00 2:00 During Saturday Feature", "04:46:00 14:00 After Saturday Feature"]);
  });
});

describe("carried programs", () => {
  let id: string;
  let reel: { id: string };
  let reelOwner: User;
  beforeAll(async () => {
    id = await station("CARY");
    reelOwner = await h.signIn("Reel");
    reel = await stationFixture(h, { callSign: "REEL", ownerId: reelOwner.id, marketId, tenths: nextTenths(), signedOn: true });
  }, 60_000);

  async function carry(title: string, terms: { term: "barter" | "cash"; liveOnly: boolean }) {
    const programId = (await reelOwner.post(`/v1/stations/${reel.id}/programs`, { title, description: "Films." }).expect(201)).body.id as string;
    const offer = await reelOwner
      .post(`/v1/programs/${programId}/offer`, { termsOffered: [terms.term], cashPriceMicros: terms.term === "cash" ? 1_000_000 : null, cashPriceUnit: terms.term === "cash" ? "per_airing" : null, barterMakerMsPerHour: terms.term === "barter" ? 60_000 : null, airingsPerEpisode: null, windowDays: 7, liveOnly: terms.liveOnly, noticeDays: 7, approval: "any_station", radioBandAllowed: true })
      .expect(201);
    await kai.post(`/v1/catalog/offers/${offer.body.id}/requests`, { carrierStationId: id, term: terms.term, slots: [{ weekday: 5, time: "20:00" }], startsOn: "2026-10-01" }).expect(201);
    const agreements = (await kai.get(`/v1/stations/${id}/carriage/agreements`).expect(200)).body.carrying as Array<{ id: string; term: string }>;
    return { agreement: agreements[agreements.length - 1].id, programId };
  }

  it("under barter: breaks inside it as every N minutes places them, the maker's time shared out, never more in all", async () => {
    const { agreement, programId } = await carry("Saturday Reel", { term: "barter", liveOnly: false });
    const film = await itemFixture(h, reel.id, { programId, title: "Reel 1", durationMs: 100 * MIN });
    await kai.post(`/v1/stations/${id}/log`, { kind: "program", startsAt: T("03:00"), endsAt: T("05:00"), itemId: film.id, carriageAgreementId: agreement }).expect(201);
    await save(id, { ...RULE, mode: "every_n_minutes", everyMinutes: 30, clockMinutes: [15, 45] }).expect(200);
    const breaks = (await getLog(id)).breaks;
    expect(breaks.map((b) => [b.startsAt.slice(11, 19), b.origin, b.producerShareMs])).toEqual([
      // The maker's minute an hour: 15, then 28, then 28 minutes of film since the last break.
      ["03:15:00", "carried_barter", 15_000],
      ["03:45:00", "carried_barter", 28_000],
      ["04:15:00", "carried_barter", 28_000],
      // Its two minutes for the two-hour slot, less what's in the breaks inside.
      ["04:46:00", "carried_barter", 49_000]
    ]);
    expect(breaks.reduce((s, b) => s + b.producerShareMs, 0)).toBe(2 * MIN);
  });

  it("carried live only: nothing inside it (it airs as the maker airs it), its break after as before", async () => {
    const { agreement, programId } = await carry("Sunday Simulcast", { term: "cash", liveOnly: true });
    const film = await itemFixture(h, reel.id, { programId, title: "Reel 2", durationMs: 100 * MIN });
    await reelOwner.post(`/v1/stations/${reel.id}/log`, { kind: "program", startsAt: T("06:00"), endsAt: T("08:00"), itemId: film.id }).expect(201);
    await kai.post(`/v1/stations/${id}/log`, { kind: "program", startsAt: T("06:00"), endsAt: T("08:00"), itemId: film.id, carriageAgreementId: agreement }).expect(201);
    await save(id, { ...RULE, longPrograms: { overMs: 45 * MIN, everyMs: 30 * MIN } }).expect(200);
    expect(said((await getLog(id, T("06:00"), T("08:00"))).breaks)).toEqual(["07:40:00 20:00 After Sunday Simulcast"]);
  });
});

describe("checks, older apps and the preview", () => {
  let id: string;
  beforeAll(async () => {
    id = await station("CHKS");
    await evening(id);
    await program(id, "Saturday Feature", "05:00", "07:00", 100);
  }, 60_000);

  it("refuses what doesn't fit, in words (the preview in the same words)", async () => {
    const minutes = { ...RULE, mode: "every_n_minutes", everyMinutes: 30 };
    const bad: Array<[object, string]> = [
      [{ ...RULE, mode: "none", everyPrograms: 2 }, "Breaks after every N programs go with breaks after every program."],
      [{ ...RULE, clockMinutes: [15, 45] }, "Breaks at set times each hour go with mode every_n_minutes."],
      [{ ...minutes, clockMinutes: [15, 20] }, "Leave at least 10 minutes between break times."],
      [{ ...minutes, longPrograms: { overMs: 45 * MIN, everyMs: 30 * MIN } }, "Every N minutes already breaks inside every program."],
      [{ ...RULE, longPrograms: { overMs: 45 * MIN, everyMs: 5 * MIN } }, "Breaks inside long programs come every 10 to 60 minutes."],
      [{ ...RULE, longPrograms: { overMs: 30 * MIN, everyMs: 30 * MIN } }, "A long program is longer than how often it breaks, and 24 hours at most."]
    ];
    for (const [body, words] of bad) {
      expect((await save(id, body).expect(400)).body.error.message).toBe(words);
      expect((await preview(id, body).expect(400)).body.error.message).toBe(words);
    }
    // The contract's own ranges.
    for (const body of [{ ...RULE, everyPrograms: 1 }, { ...minutes, clockMinutes: [] }, { ...minutes, clockMinutes: [60] }, { ...minutes, clockMinutes: [0, 10, 20, 30, 40, 50, 55] }]) await save(id, body).expect(400);
  });

  it("an older app's body keeps what's set until it changes the mode it goes with", async () => {
    const old = ({ everyPrograms: _a, clockMinutes: _b, longPrograms: _c, ...rest }: Record<string, unknown>) => rest;
    await save(id, { ...RULE, mode: "every_n_minutes", everyMinutes: 30, clockMinutes: [15, 45], longPrograms: { overMs: 45 * MIN, everyMs: 30 * MIN } }).expect(200);
    // It read "every 30 minutes" and saved it with a new length: the clock times stay.
    const read = await getRule(id);
    expect((await save(id, { ...old(read), lengthMs: 90_000 }).expect(200)).body).toMatchObject({ clockMinutes: [15, 45], everyMinutes: 30, lengthMs: 90_000, longPrograms: { overMs: 45 * MIN } });
    // It chose every 20 minutes: that's what it gets (and long programs go, every N minutes breaks inside every program).
    expect((await save(id, { ...old(read), everyMinutes: 20 }).expect(200)).body).toMatchObject({ mode: "every_n_minutes", everyMinutes: 20, clockMinutes: null, longPrograms: null });
    await save(id, { ...RULE, everyPrograms: 3, longPrograms: { overMs: 60 * MIN, everyMs: 20 * MIN } }).expect(200);
    expect((await save(id, old(await getRule(id))).expect(200)).body).toMatchObject({ mode: "after_every_program", everyPrograms: 3, longPrograms: { overMs: 60 * MIN, everyMs: 20 * MIN } });
    expect((await save(id, { ...old(await getRule(id)), mode: "none" }).expect(200)).body).toMatchObject({ mode: "none", everyPrograms: null, longPrograms: { overMs: 60 * MIN, everyMs: 20 * MIN } });
  });

  it("the preview shows each setting before saving, and equals getLog after saving it", async () => {
    const rules = [
      { ...RULE, everyPrograms: 2 },
      { ...RULE, mode: "every_n_minutes", everyMinutes: 15 },
      { ...RULE, mode: "every_n_minutes", everyMinutes: 30, clockMinutes: [15, 45] },
      { ...RULE, longPrograms: { overMs: 45 * MIN, everyMs: 30 * MIN } },
      { ...RULE, mode: "none", longPrograms: { overMs: 45 * MIN, everyMs: 20 * MIN } }
    ];
    await save(id, { ...RULE, longPrograms: null }).expect(200);
    const plain = said((await getLog(id, FROM, T("06:00"))).breaks);
    for (const rule of rules) {
      const seen = (await preview(id, rule).expect(200)).body;
      expect(said(seen.breaks)).not.toEqual(plain);
      const saved = (await save(id, rule).expect(200)).body;
      expect(seen.rule).toEqual(saved);
      const log = await getLog(id, FROM, T("06:00"));
      expect(seen.breaks.map(({ keeps: _k, ...b }: { keeps: boolean }) => b)).toEqual(log.breaks);
      expect(seen.entries).toEqual(log.entries);
    }
  });
});
