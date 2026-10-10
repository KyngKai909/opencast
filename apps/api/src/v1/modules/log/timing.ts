// A247 (2026-10-04, the user's decision): more ways to set when breaks come, beside after every
// program, every N minutes and none. On the break rule, each an optional field (no new mode, so
// apps from before read every rule):
//
// - After every N programs (`everyPrograms`, with `after_every_program`): the break after a
//   program comes only after every Nth, counted again from the start of the broadcast day (6:00
//   am), after off air time and at a programming block's edge (entering, leaving or between two).
//   Live programs cue their own and aren't counted (nor do they start the count again).
//   Between the others there's no break: the time a program leaves of its slot airs as open time
//   (the station ID and bumpers, and the between sequence), as a program that fills its slot does.
// - Clock breaks (`clockMinutes`, with `every_n_minutes`): breaks at minutes past the hour, in the
//   station's time. A program airing at one of them pauses there; a long one gets several. A time
//   that falls on a program boundary, or in the break after a program, is that break.
// - Inside long programs too (`longPrograms`): a program longer than `overMs` gets a break every
//   `everyMs` of program, counted from the last break inside it (a clock break included) or its
//   start. With every N minutes it doesn't apply (every program already breaks inside).
//
// For all three, the rules every N minutes doesn't have (it airs exactly as before):
// - A break inside a program comes out of the time the program leaves in its slot. One that
//   doesn't fit isn't placed (nor any after it), so a program is never cut for a break.
// - Too close: a break inside a program with less than `MIN_RUN_MS` of air since the break before
//   it ended (the last program's break after it included), or less than that before its program
//   ends (where the break after it, or the next program, comes), is skipped.
// - A program with its maker's break points breaks at those (as every N minutes does), each one
//   still under the two rules above. A program carried live only gets none inside it: it airs at
//   the same time as the maker airs it, so it can't pause.
// - Under barter, a break inside a carried program carries the maker's share for the program time
//   since the break before it (every N minutes' share, at an N-minute spacing), and the break after
//   it what's left of the maker's time for the slot (as after every program), never more in all.
// - What airs in each break (the cadence) is decided as before: inside a program is never "after
//   a program", and "after every N programs" counts the programs on the log, whatever the timing.

import { badRequest } from "../../errors.js";

const MIN = 60_000;
const HOUR = 60 * MIN;

/** A247: less program than this between two breaks (or before a program ends) and the later break is skipped. */
export const MIN_RUN_MS = 5 * MIN;
/** A247: clock times at least this far apart (and at least the break's length plus `MIN_RUN_MS`). */
export const CLOCK_GAP_MS = 10 * MIN;
/** A247: how often inside long programs, at the least and the most. */
export const LONG_EVERY_MIN_MS = 10 * MIN;
export const LONG_EVERY_MAX_MS = 60 * MIN;
/** A247: at most this many clock times an hour. */
export const MAX_CLOCK_TIMES = 6;

export interface TimingInput {
  mode: "after_every_program" | "every_n_minutes" | "none";
  everyMinutes: number | null;
  lengthMs: number;
  everyPrograms?: number | null;
  clockMinutes?: number[] | null;
  longPrograms?: { overMs: number; everyMs: number } | null;
}

export interface TimingStored {
  mode: "after_every_program" | "every_n_minutes" | "none";
  everyMinutes: number | null;
  everyPrograms: number | null;
  clockMinutes: number[] | null;
  longPrograms: { overMs: number; everyMs: number } | null;
}

/**
 * What `setBreakRule` stores for A247's fields, from a body and what's stored: the 400s, and what a
 * body from before them (each left out) keeps. Every N programs stays while the mode is after every
 * program; clock times stay while the body keeps the mode and minutes it read (every N minutes at 60
 * over how many); long programs stay, except with every N minutes (cleared). Clock times set the
 * minutes (`everyMinutes`) apps from before show.
 */
export function resolveTiming(rule: TimingInput, stored: TimingStored | undefined) {
  const everyPrograms = rule.everyPrograms === undefined ? (rule.mode === "after_every_program" && stored?.mode === "after_every_program" ? stored.everyPrograms : null) : rule.everyPrograms;
  if (everyPrograms !== null && rule.mode !== "after_every_program") throw badRequest("Breaks after every N programs go with breaks after every program.", { everyPrograms: "Only with after_every_program" });
  if (everyPrograms !== null && (!Number.isInteger(everyPrograms) || everyPrograms < 2 || everyPrograms > 12)) throw badRequest("Say after how many programs: 2 to 12.", { everyPrograms: "2 to 12" });

  const kept = stored?.mode === "every_n_minutes" && stored.clockMinutes?.length && rule.mode === "every_n_minutes" && rule.everyMinutes === stored.everyMinutes ? stored.clockMinutes : null;
  const sent = rule.clockMinutes === undefined ? kept : rule.clockMinutes;
  let clockMinutes: number[] | null = null;
  if (sent) {
    if (rule.mode !== "every_n_minutes") throw badRequest("Breaks at set times each hour go with mode every_n_minutes.", { clockMinutes: "Only with every_n_minutes" });
    if (!sent.length || sent.some((m) => !Number.isInteger(m) || m < 0 || m > 59)) throw badRequest("Choose the minutes past the hour: 0 to 59.", { clockMinutes: "0 to 59" });
    clockMinutes = [...new Set(sent)].sort((a, b) => a - b);
    if (clockMinutes.length > MAX_CLOCK_TIMES) throw badRequest(`Choose ${MAX_CLOCK_TIMES} times an hour at most.`, { clockMinutes: `${MAX_CLOCK_TIMES} at most` });
    const need = clockGapMs(rule.lengthMs);
    if (clockMinutes.length > 1 && clockMinutes.some((m, i) => ((clockMinutes![(i + 1) % clockMinutes!.length] - m + 60) % 60 || 60) * MIN < need)) {
      throw badRequest(`Leave at least ${need / MIN} minutes between break times.`, { clockMinutes: `${need / MIN} minutes apart` });
    }
  }
  const everyMinutes = clockMinutes ? 60 / clockMinutes.length : rule.mode === "every_n_minutes" ? rule.everyMinutes : null;

  // Every N minutes (not clock times) already breaks inside every program.
  const minutes = rule.mode === "every_n_minutes" && !clockMinutes;
  if (minutes && rule.longPrograms) throw badRequest("Every N minutes already breaks inside every program.", { longPrograms: "Not with every_n_minutes" });
  const longPrograms = minutes ? null : rule.longPrograms === undefined ? (stored?.longPrograms ?? null) : rule.longPrograms;
  if (longPrograms) {
    const { overMs, everyMs } = longPrograms;
    if (everyMs % MIN || everyMs < LONG_EVERY_MIN_MS || everyMs > LONG_EVERY_MAX_MS) throw badRequest("Breaks inside long programs come every 10 to 60 minutes.", { "longPrograms.everyMs": "10 to 60 minutes" });
    if (overMs % MIN || overMs <= everyMs || overMs > 24 * HOUR) throw badRequest("A long program is longer than how often it breaks, and 24 hours at most.", { "longPrograms.overMs": "Longer than everyMs" });
  }
  return { everyPrograms, clockMinutes, everyMinutes, longPrograms: longPrograms ? { overMs: longPrograms.overMs, everyMs: longPrograms.everyMs } : null };
}

/** How far apart clock times must be: 10 minutes, or the break's length and 5 minutes of program. */
export function clockGapMs(lengthMs: number): number {
  return Math.max(CLOCK_GAP_MS, Math.ceil((lengthMs + MIN_RUN_MS) / MIN) * MIN);
}

/** The first clock time after `t` (the station's minutes past the hour; `hourStart` gives the top of the hour `t` is in). */
export function nextClockTime(t: number, minutes: readonly number[], hourStart: (t: number) => number): number {
  for (let h = hourStart(t); ; h = hourStart(h + HOUR + MIN)) {
    const at = minutes.map((m) => h + m * MIN).find((x) => x > t);
    if (at !== undefined) return at;
  }
}

/** A program on the log, as `programRuns` counts it. */
export interface RunEntry {
  id: string;
  kind: string;
  startsAt: number;
  endsAt: number;
  /** Its broadcast day ("2026-10-03"). */
  day: string;
  /** The programming block span it's a member of, or null. */
  span: string | null;
}

/**
 * A247, after every N programs: the programs (not live, not off air) whose break comes, in a run of
 * entries in order: every Nth, the count starting again at each broadcast day, after off air time
 * (an entry, or off air hours: `offAirBetween`) and at a programming block's edge. Live programs
 * aren't counted. Each program's answer depends only on the entries before it, so any window
 * that starts at the broadcast day's start decides the same.
 */
export function programRuns(entries: RunEntry[], n: number, offAirBetween: (a: number, b: number) => boolean): Set<string> {
  const out = new Set<string>();
  let count = 0;
  let prev: RunEntry | null = null;
  let offSince = false;
  for (const e of entries) {
    if (e.kind === "off_air") {
      offSince = true;
      continue;
    }
    if (e.kind !== "program") continue;
    if (prev && (offSince || prev.day !== e.day || prev.span !== e.span || offAirBetween(prev.endsAt, e.startsAt))) count = 0;
    offSince = false;
    count++;
    if (count % n === 0) out.add(e.id);
    prev = e;
  }
  return out;
}
