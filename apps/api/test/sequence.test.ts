// Bumper roles and chained sequences (A243), worked out with no database: when an item may air,
// where each role's bumper comes from, taking turns, fitting a short break, up next once a break,
// and the between sequence at program boundaries.
import { describe, expect, it } from "vitest";
import {
  blockPositionAirs,
  BoundaryDecider,
  chainOf,
  defaultSequences,
  eligible,
  fitElements,
  pickElements,
  rolesFor,
  SequenceDecider,
  sequenceProblems,
  sequencesOf,
  type BumperRole,
  type PoolItem
} from "../src/v1/modules/playout/engine/sequence.js";
import { hourStartIn } from "../src/v1/modules/playout/engine/cadence.js";

const LA = "America/Los_Angeles";
const at = (iso: string) => Date.parse(iso);
const bumper = (id: string, role: BumperRole | null = null, airs: PoolItem["airs"] = null, durationMs = 5_000): PoolItem => ({ id, title: id, durationMs, bumperRole: role, airs });

describe("when an item may air", () => {
  it("between dates, either end open, by broadcast date (2:00 am is the day before's)", () => {
    const december = { from: "2026-12-01", until: "2026-12-31", dailyFrom: null, dailyUntil: null };
    // 2:00 am on Jan 1 in Los Angeles is still Dec 31's broadcast day.
    expect(eligible({ airs: december }, at("2027-01-01T10:00:00Z"), LA)).toBe(true);
    // 7:00 am on Jan 1 isn't.
    expect(eligible({ airs: december }, at("2027-01-01T15:00:00Z"), LA)).toBe(false);
    // 5:00 am on Dec 1 is Nov 30's broadcast day.
    expect(eligible({ airs: december }, at("2026-12-01T13:00:00Z"), LA)).toBe(false);
    expect(eligible({ airs: { ...december, until: null } }, at("2027-06-01T20:00:00Z"), LA)).toBe(true);
    expect(eligible({ airs: { ...december, from: null } }, at("2026-01-01T20:00:00Z"), LA)).toBe(true);
    expect(eligible({ airs: null }, at("2026-01-01T20:00:00Z"), LA)).toBe(true);
  });

  it("at times of day, past midnight too, on the wall clock across daylight saving", () => {
    const night = { from: null, until: null, dailyFrom: "18:00", dailyUntil: "02:00" };
    // 7:00 pm and 1:30 am in, 2:00 am and noon out (Los Angeles, PDT then PST).
    expect(eligible({ airs: night }, at("2026-10-03T02:00:00Z"), LA)).toBe(true);
    expect(eligible({ airs: night }, at("2026-10-03T08:30:00Z"), LA)).toBe(true);
    expect(eligible({ airs: night }, at("2026-10-03T09:00:00Z"), LA)).toBe(false);
    expect(eligible({ airs: night }, at("2026-10-03T19:00:00Z"), LA)).toBe(false);
    // After the clocks go back (Nov 1), 6:30 pm local is 02:30Z, still in.
    expect(eligible({ airs: night }, at("2026-11-03T02:30:00Z"), LA)).toBe(true);
    expect(eligible({ airs: night }, at("2026-11-03T01:30:00Z"), LA)).toBe(false);
    const day = { from: null, until: null, dailyFrom: "09:00", dailyUntil: "17:00" };
    expect(eligible({ airs: day }, at("2026-10-03T16:00:00Z"), LA)).toBe(true);
    expect(eligible({ airs: day }, at("2026-10-04T00:00:00Z"), LA)).toBe(false);
  });
});

describe("the sequences", () => {
  it("default to one into the break and one out of it, as often as the bumpers' cadence, none between", () => {
    expect(defaultSequences()).toEqual({ open: { roles: ["into_break"], every: "break" }, close: { roles: ["out_of_break"], every: "break" }, between: { roles: [], every: "program" } });
    expect(sequencesOf(null, { every: "n_programs" })).toMatchObject({ open: { every: "n_programs", n: 2 }, close: { every: "n_programs", n: 2 } });
    // Between programs is per boundary: "every break" reads as every program.
    expect(sequencesOf({ between: { roles: ["up_next"], every: "break" } }).between).toEqual({ roles: ["up_next"], every: "program" });
  });

  it("refuse a role twice in a position, more than four, and N programs without an N", () => {
    expect(sequenceProblems({ open: { roles: ["any", "any"], every: "break" } })).toEqual({ "bumperSequences.open.roles": "Each role once" });
    expect(sequenceProblems({ close: { roles: ["into_break", "out_of_break", "up_next", "any", "any"], every: "break" } })).toMatchObject({ "bumperSequences.close.roles": expect.any(String) });
    expect(sequenceProblems({ between: { roles: ["up_next"], every: "n_programs" } })).toEqual({ "bumperSequences.between.n": "Required" });
    expect(sequenceProblems({ open: { roles: ["into_break", "up_next"], every: "break" } })).toBeNull();
  });

  it("air up next once a break: the first position that has it", () => {
    const seq = sequencesOf({ open: { roles: ["into_break", "up_next"], every: "break" }, close: { roles: ["up_next", "out_of_break"], every: "break" }, between: { roles: ["up_next"], every: "program" } });
    expect(rolesFor(seq, { open: true, close: true, between: true })).toEqual({ open: ["into_break", "up_next"], close: ["out_of_break"], between: [] });
    // The opening sequence doesn't air in this break: the closing one has it.
    expect(rolesFor(seq, { open: false, close: true, between: true })).toEqual({ open: [], close: ["up_next", "out_of_break"], between: [] });
    expect(rolesFor(seq, { open: false, close: false, between: true })).toEqual({ open: [], close: [], between: ["up_next"] });
  });
});

describe("picks", () => {
  const t = at("2026-10-03T03:00:00Z");

  it("fall back to Any for into and out of the break, never for up next", () => {
    expect(chainOf("into_break")).toEqual(["into_break", "any"]);
    expect(chainOf("out_of_break")).toEqual(["out_of_break", "any"]);
    expect(chainOf("up_next")).toEqual(["up_next"]);
    expect(chainOf("any")).toEqual(["any"]);
    const d = new SequenceDecider([bumper("A"), bumper("B")], LA);
    expect(d.pick("into_break", t, new Set())?.item.id).toBe("A");
    expect(d.pick("up_next", t, new Set())).toBeNull();
    // A role's own pool comes first; outside its window it passes to the next pool, never airs.
    const seasonal = bumper("Snow", "into_break", { from: "2026-12-01", until: "2026-12-31", dailyFrom: null, dailyUntil: null });
    const d2 = new SequenceDecider([bumper("A"), seasonal], LA);
    expect(d2.pick("into_break", t, new Set())?.item.id).toBe("A");
    expect(d2.pick("into_break", at("2026-12-10T03:00:00Z"), new Set())?.item.id).toBe("Snow");
    const onlyOut = new SequenceDecider([seasonal], LA);
    expect(onlyOut.pick("into_break", t, new Set())).toBeNull();
  });

  it("one or two in a pool: library order, the first not already in the break (A in, B out; one bumper twice)", () => {
    const two = new SequenceDecider([bumper("A"), bumper("B")], LA);
    for (let i = 0; i < 3; i++) {
      const used = new Set<string>();
      const open = pickElements(two, "open", ["into_break"], t + i * 1_800_000, used, () => null);
      const close = pickElements(two, "close", ["out_of_break"], t + i * 1_800_000, used, () => null);
      expect([open[0].itemId, close[0].itemId]).toEqual(["A", "B"]);
    }
    const one = new SequenceDecider([bumper("A")], LA);
    const used = new Set<string>();
    expect([...pickElements(one, "open", ["into_break"], t, used, () => null), ...pickElements(one, "close", ["out_of_break"], t, used, () => null)].map((e) => e.itemId)).toEqual(["A", "A"]);
  });

  it("three or more take turns, least recently aired first, ties by library order", () => {
    const pool = [bumper("A"), bumper("B"), bumper("C")];
    const d = new SequenceDecider(pool, LA);
    const picks: string[] = [];
    for (let i = 0; i < 3; i++) {
      const used = new Set<string>();
      const b = t + i * 1_800_000;
      picks.push(...pickElements(d, "open", ["into_break"], b, used, () => null).map((e) => e.itemId), ...pickElements(d, "close", ["out_of_break"], b, used, () => null).map((e) => e.itemId));
    }
    expect(picks).toEqual(["A", "B", "C", "A", "B", "C"]);
    // Seeded from the as-run log: B aired longest ago, then C; A never.
    const seeded = new SequenceDecider(pool, LA, { last: new Map([["B", t - 7_200_000], ["C", t - 3_600_000]]), aired: [{ id: "A", at: t - 600_000 }] });
    expect(seeded.pick("any", t, new Set())?.item.id).toBe("B");
    expect(seeded.pick("any", t, new Set())?.alternates.map((a) => a.id)).toEqual(["C", "A"]);
  });

  it("decide the same from any start: a walk from earlier, fed what aired, agrees with one seeded later", () => {
    const pool = [bumper("A"), bumper("B"), bumper("C"), bumper("D")];
    const breaks = [0, 1, 2, 3, 4, 5].map((i) => t + i * 1_800_000);
    // The early walk decides all six; what it decided for the first three is what aired.
    const early = new SequenceDecider(pool, LA);
    const decided = breaks.map((b) => pickElements(early, "open", ["any"], b, new Set(), () => null)[0].itemId);
    const aired = breaks.slice(0, 3).map((b, i) => ({ id: decided[i], at: b }));
    // A later walk starts after the third, seeded with when each last aired.
    const last = new Map<string, number>();
    for (const a of aired) last.set(a.id, a.at);
    const late = new SequenceDecider(pool, LA, { last });
    expect(breaks.slice(3).map((b) => pickElements(late, "open", ["any"], b, new Set(), () => null)[0].itemId)).toEqual(decided.slice(3));
  });

  it("leave up next out when nothing's on next", () => {
    const d = new SequenceDecider([bumper("Next", "up_next")], LA);
    expect(pickElements(d, "close", ["up_next"], t, new Set(), () => null)).toEqual([]);
    const next = { entryId: "e1", title: "Saturday Reel", episodeTitle: null, startsAt: "2026-10-03T04:00:00.000Z", carriedFrom: "REEL" };
    expect(pickElements(d, "close", ["up_next"], t, new Set(), () => next)).toEqual([expect.objectContaining({ role: "up_next", itemId: "Next", announces: next })]);
  });
});

describe("fitting a short break", () => {
  it("each whole or not at all, by priority (into, out, up next, Any), the rest in sequence order", () => {
    const els = [
      { role: "into_break" as const, lengthMs: 5_000, name: "in" },
      { role: "up_next" as const, lengthMs: 8_000, name: "next" },
      { role: "any" as const, lengthMs: 3_000, name: "sting" },
      { role: "out_of_break" as const, lengthMs: 5_000, name: "out" }
    ];
    const fit = (room: number) => fitElements(els, room).filter((e) => e.fits).map((e) => e.name);
    expect(fit(21_000)).toEqual(["in", "next", "sting", "out"]);
    expect(fit(18_000)).toEqual(["in", "next", "out"]);
    expect(fit(13_000)).toEqual(["in", "sting", "out"]);
    expect(fit(10_000)).toEqual(["in", "out"]);
    expect(fit(7_000)).toEqual(["in"]);
    expect(fit(4_000)).toEqual(["sting"]);
    expect(fit(0)).toEqual([]);
  });
});

describe("between programs", () => {
  const starts = [0, 1, 2, 3, 4, 5].map((i) => at("2026-10-03T03:00:00Z") + i * 1_800_000);
  const run = (rule: Parameters<typeof sequencesOf>[0], opts: { last?: number | null; times?: number[]; settledBefore?: number } = {}) => {
    const d = new BoundaryDecider({ rule: sequencesOf(rule).between, last: opts.last ?? null, times: opts.times ?? [], settledBefore: opts.settledBefore ?? 0, hourStart: hourStartIn("UTC"), starts });
    return starts.filter((s) => d.next(s)).map((s) => new Date(s).toISOString().slice(11, 16));
  };

  it("every program, every N, at the top of the hour, never", () => {
    expect(run({ between: { roles: ["any"], every: "program" } })).toHaveLength(6);
    expect(run({ between: { roles: ["any"], every: "n_programs", n: 2 } })).toEqual(["03:00", "04:00", "05:00"]);
    expect(run({ between: { roles: ["any"], every: "hour" } })).toEqual(["03:00", "04:00", "05:00"]);
    expect(run({ between: { roles: ["any"], every: "never" } })).toEqual([]);
    expect(run({ between: { roles: [], every: "program" } })).toEqual([]);
  });

  it("boundaries that are over go by the as-run log", () => {
    // Every 2: it aired at 3:30 (the station wasn't on at 3:00), so the next is 4:30.
    expect(run({ between: { roles: ["any"], every: "n_programs", n: 2 } }, { settledBefore: at("2026-10-03T04:00:00Z"), times: [at("2026-10-03T03:29:50Z")] })).toEqual(["03:30", "04:30", "05:30"]);
  });
});

// A244: programming blocks. Each choice resolves block, then station, then automatic.
describe("a programming block's pools come first", () => {
  const station = [bumper("Right back", "into_break"), bumper("Back to it", "out_of_break"), bumper("Up next", "up_next"), bumper("Sting")];
  const blocks = new Map([["lcn", [bumper("LCN in", "into_break"), bumper("LCN sting")]]]);
  const t = at("2026-10-04T04:56:00Z");

  it("its role pool, then its Any (not for up next), then the station's chain", () => {
    const d = new SequenceDecider(station, LA, {}, blocks);
    expect(d.pick("into_break", t, new Set(), "lcn")).toMatchObject({ item: { id: "LCN in" }, ofBlock: true });
    expect(d.pick("out_of_break", t, new Set(), "lcn")).toMatchObject({ item: { id: "LCN sting" }, ofBlock: true });
    expect(d.pick("any", t, new Set(), "lcn")).toMatchObject({ item: { id: "LCN sting" }, ofBlock: true });
    // Up next never falls to an Any sting: the block has none of its own, so the station's.
    expect(d.pick("up_next", t, new Set(), "lcn")).toMatchObject({ item: { id: "Up next" }, ofBlock: false });
    // Outside the block, the station's alone.
    expect(d.pick("into_break", t, new Set())).toMatchObject({ item: { id: "Right back" }, ofBlock: false });
    expect(d.has("up_next", "lcn")).toBe(true);
  });

  it("a block's own pools count for taking turns", () => {
    const three = new Map([["lcn", [bumper("A"), bumper("B"), bumper("C")]]]);
    expect(new SequenceDecider([bumper("Sting")], LA, {}, three).rotates(["any"])).toBe(true);
    expect(new SequenceDecider([bumper("Sting")], LA).rotates(["any"])).toBe(false);
  });

  it("an element in a block says so; the block's own picks say they're its", () => {
    const d = new SequenceDecider(station, LA, {}, blocks);
    const picked = pickElements(d, "open", ["into_break", "up_next"], t, new Set(), () => ({ entryId: "e", title: "Saturday Reel", episodeTitle: null, startsAt: "2026-10-04T05:00:00.000Z", carriedFrom: null, blockName: "Late Crate Nights" }), "lcn");
    expect(picked).toEqual([
      expect.objectContaining({ itemId: "LCN in", blockId: "lcn", ofBlock: true }),
      expect.objectContaining({ itemId: "Up next", blockId: "lcn", announces: expect.objectContaining({ blockName: "Late Crate Nights" }) })
    ]);
    expect(picked[1].ofBlock).toBeUndefined();
  });

  it("its own order airs where it says plainly; once an hour and every N programs follow the station's cadence", () => {
    expect(blockPositionAirs({ roles: ["any"], every: "break" }, { afterProgram: false }, false)).toBe(true);
    expect(blockPositionAirs({ roles: ["any"], every: "never" }, { afterProgram: true }, true)).toBe(false);
    expect(blockPositionAirs({ roles: ["any"], every: "program" }, { afterProgram: false }, true)).toBe(false);
    expect(blockPositionAirs({ roles: ["any"], every: "hour" }, { afterProgram: false }, true)).toBe(true);
  });

  it("a block's intro, then its outro, get room before any bumper", () => {
    const fitted = fitElements(
      [
        { role: "outro" as const, lengthMs: 5_000 },
        { role: "any" as const, lengthMs: 3_000 },
        { role: "intro" as const, lengthMs: 6_000 }
      ],
      11_000
    );
    expect(fitted.map((e) => `${e.role} ${e.fits}`)).toEqual(["outro true", "any false", "intro true"]);
    expect(fitElements([{ role: "outro" as const, lengthMs: 5_000 }, { role: "intro" as const, lengthMs: 6_000 }], 6_000).map((e) => e.fits)).toEqual([false, true]);
  });
});
