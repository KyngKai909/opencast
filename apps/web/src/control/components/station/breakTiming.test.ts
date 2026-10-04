// A247: when breaks come. The five choices and what each keeps, the clock's times and how far
// apart they must be, inside long programs (not with every N minutes), and the words the Log uses.

import { describe, expect, it } from "vitest";
import type { BreakRule } from "@opencast/contracts";
import { defaultBreakRule } from "../../mocks/fixtures/station";
import { whyLine } from "../onair/LogPane";
import { clockGapMinutes, clockProblem, clockWords, longApplies, longWords, ordinal, sameRule, timingOf, timingWords, withClock, withTiming } from "./breakRule";

const rule = (o: Partial<BreakRule> = {}): BreakRule => defaultBreakRule(o);

describe("when breaks come", () => {
  it("reads each choice from the rule", () => {
    expect(timingOf(rule())).toBe("program");
    expect(timingOf(rule({ everyPrograms: 3 }))).toBe("programs");
    expect(timingOf(rule({ mode: "every_n_minutes", everyMinutes: 15 }))).toBe("minutes");
    expect(timingOf(rule({ mode: "every_n_minutes", everyMinutes: 30, clockMinutes: [15, 45] }))).toBe("clock");
    expect(timingOf(rule({ mode: "none" }))).toBe("none");
    // A rule from an API before A247 (no fields at all).
    const { everyPrograms: _a, clockMinutes: _b, longPrograms: _c, ...old } = rule({ mode: "every_n_minutes", everyMinutes: 30 });
    expect(timingOf(old)).toBe("minutes");
  });

  it("each choice sets the fields that go with it, and clears the rest", () => {
    const long = { overMs: 45 * 60_000, everyMs: 30 * 60_000 };
    const r = rule({ longPrograms: long });
    expect(withTiming(r, "programs")).toMatchObject({ mode: "after_every_program", everyPrograms: 2, everyMinutes: null, clockMinutes: null, longPrograms: long });
    expect(withTiming(rule({ everyPrograms: 4 }), "programs").everyPrograms).toBe(4);
    // Every N minutes breaks inside every program: inside long programs goes.
    expect(withTiming(r, "minutes")).toMatchObject({ mode: "every_n_minutes", everyMinutes: 30, everyPrograms: null, clockMinutes: null, longPrograms: null });
    expect(withTiming(r, "clock")).toMatchObject({ mode: "every_n_minutes", clockMinutes: [0, 30], everyMinutes: 30, longPrograms: long });
    expect(withTiming(rule({ mode: "every_n_minutes", everyMinutes: 20, clockMinutes: [10, 30, 50] }), "clock").clockMinutes).toEqual([10, 30, 50]);
    expect(withTiming(r, "none")).toMatchObject({ mode: "none", everyMinutes: null, everyPrograms: null, clockMinutes: null, longPrograms: long });
    expect(withTiming(withTiming(r, "programs"), "program")).toMatchObject({ mode: "after_every_program", everyPrograms: null });
    expect(longApplies(withTiming(r, "minutes"))).toBe(false);
    expect(longApplies(withTiming(r, "clock"))).toBe(true);
  });

  it("the clock's times: sorted, at least one, and far enough apart", () => {
    const clock = withTiming(rule(), "clock");
    expect(withClock(clock, [45, 15])).toMatchObject({ clockMinutes: [15, 45], everyMinutes: 30 });
    expect(withClock(clock, [0, 20, 40]).everyMinutes).toBe(20);
    // None chosen: as it was.
    expect(withClock(clock, [])).toBe(clock);
    expect(clockProblem({ lengthMs: 120_000, clockMinutes: [15, 45] })).toBeNull();
    expect(clockProblem({ lengthMs: 120_000, clockMinutes: [15, 20] })).toBe("Leave at least 10 minutes between break times.");
    // Around the hour: :55 and :00.
    expect(clockProblem({ lengthMs: 120_000, clockMinutes: [0, 30, 55] })).toBe("Leave at least 10 minutes between break times.");
    expect(clockGapMinutes(4 * 60_000)).toBe(10);
    expect(clockGapMinutes(7 * 60_000)).toBe(12);
    expect(clockProblem({ lengthMs: 120_000, clockMinutes: [0, 10, 20, 30, 40, 50, 55] })).toBe("Choose 6 times an hour at most.");
  });

  it("says it in words", () => {
    expect(clockWords([15])).toBe(":15");
    expect(clockWords([15, 45])).toBe(":15 and :45");
    expect(clockWords([0, 20, 40])).toBe(":00, :20 and :40");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
    expect(timingWords(rule())).toBe("after every program");
    expect(timingWords(rule({ everyPrograms: 2 }))).toBe("after every 2 programs");
    expect(timingWords(rule({ mode: "every_n_minutes", everyMinutes: 45 }))).toBe("every 45 minutes");
    expect(timingWords(rule({ mode: "every_n_minutes", everyMinutes: 30, clockMinutes: [15, 45] }))).toBe("at :15 and :45 each hour");
    expect(longWords(rule({ longPrograms: { overMs: 45 * 60_000, everyMs: 30 * 60_000 } }))).toBe("Programs over 45 minutes also break every 30 minutes inside.");
    expect(longWords(rule({ mode: "every_n_minutes", everyMinutes: 30, longPrograms: { overMs: 45 * 60_000, everyMs: 30 * 60_000 } }))).toBeNull();
    expect(longWords(rule())).toBeNull();
  });

  it("a rule without the fields is the same as one with them not set", () => {
    const { everyPrograms: _a, clockMinutes: _b, longPrograms: _c, ...old } = rule();
    expect(sameRule(old, rule())).toBe(true);
    expect(sameRule(old, rule({ everyPrograms: 2 }))).toBe(false);
  });
});

describe("the Log's why line", () => {
  const slot = (origin: "rule" | "cued_live" | "carried_barter") => ({ startsAt: "2026-09-27T05:15:00.000Z", lengthMs: 120_000, context: "During Slow Hours", origin, producerShareMs: 0 }) as unknown as Parameters<typeof whyLine>[0];
  const opts = { owner: null, block: null };
  it("says how the break came", () => {
    expect(whyLine(slot("rule"), rule({ mode: "every_n_minutes", everyMinutes: 30, clockMinutes: [15, 45] }), opts)).toMatch(/^Breaks come at :15 and :45 each hour\. /);
    expect(whyLine(slot("rule"), rule({ everyPrograms: 2, longPrograms: { overMs: 45 * 60_000, everyMs: 30 * 60_000 } }), opts)).toMatch(/^Breaks come after every 2 programs\. Programs over 45 minutes also break every 30 minutes inside\. /);
    expect(whyLine(slot("rule"), rule({ mode: "every_n_minutes", everyMinutes: 45 }), opts)).toMatch(/^Breaks come every 45 minutes\. /);
    expect(whyLine(slot("rule"), rule({ mode: "none" }), opts)).toMatch(/^Breaks are cued from the booth\. /);
    expect(whyLine(slot("cued_live"), rule({ longPrograms: { overMs: 45 * 60_000, everyMs: 30 * 60_000 } }), opts)).not.toMatch(/Programs over/);
  });
});
