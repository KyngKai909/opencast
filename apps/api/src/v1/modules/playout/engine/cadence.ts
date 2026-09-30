// How often the station ID, bumpers and the thank-you credit air in breaks (added 2026-09-29).
// Each is set on the break rule (`BreakRule.cadence`): every break (the default, as before), the
// break after every program, the break after every N programs, once an hour (the first break after
// the top of the hour, in the station's time), or never (bumpers and the credit only).
//
// What airs in a break is worked out from the log and the as-run log, never from counters kept in
// memory, so a replan (or a worker that restarts) decides the same: breaks that are over are
// history (the as-run log says what aired in them), and the rest are decided in order from the
// last time each part aired. A break is "after a program" when it closes its program's slot.

import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../../context.js";
import { tzOffsetMinutes } from "../../../lib/time.js";
import type { BreakSlotView } from "../../log/service.js";

export type CadenceEvery = "break" | "program" | "n_programs" | "hour" | "never";
export interface Cadence {
  every: CadenceEvery;
  /** With `n_programs`. */
  n?: number;
}
export interface BreakCadence {
  /** The station ID can't be `never`. */
  stationId: Cadence & { every: Exclude<CadenceEvery, "never"> };
  bumpers: Cadence;
  underwriting: Cadence;
}
export type CadencePart = keyof BreakCadence;
export type BreakParts = Record<CadencePart, boolean>;

export const CADENCE_PARTS: CadencePart[] = ["stationId", "bumpers", "underwriting"];
/** Today's breaks: the station ID, bumpers and the credit in every one. */
export const DEFAULT_CADENCE: BreakCadence = { stationId: { every: "break" }, bumpers: { every: "break" }, underwriting: { every: "break" } };
export const EVERY_PART: BreakParts = { stationId: true, bumpers: true, underwriting: true };
/** "After every N programs" without an N. */
const DEFAULT_N = 2;
const HOUR = 3_600_000;
/** A break over this long ago is history: the as-run log has what aired in it. */
const SETTLED_MS = 60_000;
/** How far back "after every N programs" counts programs. */
const PROGRAMS_BACK_MS = 48 * HOUR;
const CODE: Record<CadencePart, "SID" | "BMP" | "UND"> = { stationId: "SID", bumpers: "BMP", underwriting: "UND" };

/** A stored cadence (or none) with the defaults filled in. The station ID is never `never`. */
export function cadenceOf(stored: Partial<Record<CadencePart, Partial<Cadence> | undefined>> | null | undefined): BreakCadence {
  const one = (c: Partial<Cadence> | undefined): Cadence => {
    const every = c?.every ?? "break";
    return every === "n_programs" ? { every, n: c?.n ?? DEFAULT_N } : { every };
  };
  const stationId = one(stored?.stationId);
  return {
    stationId: stationId.every === "never" ? { every: "break" } : (stationId as BreakCadence["stationId"]),
    bumpers: one(stored?.bumpers),
    underwriting: one(stored?.underwriting)
  };
}

/** Every part in every break: nothing to work out. */
export function isEveryBreak(cadence: BreakCadence): boolean {
  return CADENCE_PARTS.every((p) => cadence[p].every === "break");
}

export interface CadenceBreak {
  key: string;
  startsAt: number;
  endsAt: number;
  /** It closes its program's slot. */
  afterProgram: boolean;
}

export interface CadenceInput {
  cadence: BreakCadence;
  /** In order. */
  breaks: CadenceBreak[];
  /** Programs on the log (their slots), for "after every N programs". */
  programs: Array<{ startsAt: number; endsAt: number }>;
  /** From the as-run log: when each part aired in a break, and the last time before those. */
  aired: Record<CadencePart, { last: number | null; times: number[] }>;
  /** Breaks that ended before this are history. */
  settledBefore: number;
  /** The top of the station's hour a time is in. */
  hourStart(t: number): number;
}

/** Whether each part airs in each break (by the break's key). */
export function planCadence(input: CadenceInput): Map<string, BreakParts> {
  const out = new Map<string, BreakParts>();
  const breaks = [...input.breaks].sort((a, b) => a.startsAt - b.startsAt);
  for (const b of breaks) out.set(b.key, { ...EVERY_PART });
  for (const part of CADENCE_PARTS) {
    const c = input.cadence[part];
    const times = [...input.aired[part].times].sort((a, b) => a - b);
    let last = input.aired[part].last;
    let i = 0;
    for (const b of breaks) {
      // What aired before this break.
      while (i < times.length && times[i] < b.startsAt) last = Math.max(last ?? -Infinity, times[i++]);
      let airs: boolean;
      const recorded = times.find((t) => t >= b.startsAt && t < b.endsAt);
      if (recorded !== undefined) airs = true;
      else if (b.endsAt < input.settledBefore) airs = false;
      else airs = decide(c, b, last, input);
      if (airs) last = Math.max(last ?? -Infinity, recorded ?? b.startsAt);
      out.get(b.key)![part] = airs;
    }
  }
  return out;
}

function decide(c: Cadence, b: CadenceBreak, last: number | null, input: CadenceInput): boolean {
  switch (c.every) {
    case "break":
      return true;
    case "never":
      return false;
    case "program":
      return b.afterProgram;
    case "hour":
      return last === null || last < input.hourStart(b.startsAt);
    case "n_programs": {
      if (!b.afterProgram) return false;
      if (last === null) return true;
      // Programs that started after it last aired, up to the one this break closes.
      const n = input.programs.filter((p) => p.startsAt >= last && p.endsAt <= b.endsAt).length;
      return n >= (c.n ?? DEFAULT_N);
    }
  }
}

/** The top of the hour in a timezone. */
export function hourStartIn(tz: string): (t: number) => number {
  return (t) => {
    const offset = tzOffsetMinutes(new Date(t), tz) * 60_000;
    return Math.floor((t + offset) / HOUR) * HOUR - offset;
  };
}

interface EntryLike {
  id: string;
  kind: string;
  code: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * What airs in each of a station's breaks: a lookup by the break's start. With every part in every
 * break (the default) it reads nothing. `breaks` and `entries` (with the window they were read
 * for) are what the caller already has (the planner's window); breaks from an hour before now to
 * the first of them are read too, so the answer is the same whatever window asks.
 */
export async function breakPartsFor(
  { deps, services }: ModuleContext,
  stationId: string,
  input: { breaks: BreakSlotView[]; entries?: { rows: EntryLike[]; from: Date; to: Date }; cadence?: BreakCadence }
): Promise<(slot: { startsAt: string }) => BreakParts> {
  const cadence = input.cadence ?? (await services.stations.breakRule(stationId)).cadence;
  if (isEveryBreak(cadence) || !input.breaks.length) return () => EVERY_PART;
  const now = deps.clock.now().getTime();
  const starts = input.breaks.map((b) => Date.parse(b.startsAt));
  const first = Math.min(...starts);
  const lastEnd = Math.max(...input.breaks.map((b) => Date.parse(b.startsAt) + b.lengthMs));
  // From an hour before now (or the first break asked about, if earlier): breaks in between are decided too.
  const from = Math.min(first, now - HOUR);
  let breaks = input.breaks;
  if (from < first) {
    const earlier = await services.log.breaks(stationId, new Date(from), new Date(first));
    const have = new Set(breaks.map((b) => b.startsAt));
    breaks = [...earlier.filter((b) => !have.has(b.startsAt)), ...breaks];
  }
  const stateful = CADENCE_PARTS.some((p) => ["hour", "n_programs"].includes(cadence[p].every));
  const aired = { stationId: { last: null, times: [] }, bumpers: { last: null, times: [] }, underwriting: { last: null, times: [] } } as CadenceInput["aired"];
  if (stateful) {
    const A = schema.asRun;
    const codes = CADENCE_PARTS.map((p) => CODE[p]);
    const [before, within] = await Promise.all([
      deps.db
        .select({ code: A.code, at: sql<Date>`max(${A.startedAt})` })
        .from(A)
        .where(and(eq(A.stationId, stationId), isNotNull(A.breakId), inArray(A.code, codes), lt(A.startedAt, new Date(from))))
        .groupBy(A.code),
      deps.db
        .select({ code: A.code, at: A.startedAt })
        .from(A)
        .where(and(eq(A.stationId, stationId), isNotNull(A.breakId), inArray(A.code, codes), gte(A.startedAt, new Date(from)), lt(A.startedAt, new Date(lastEnd))))
    ]);
    for (const part of CADENCE_PARTS) {
      const b = before.find((r) => r.code === CODE[part]);
      aired[part].last = b?.at ? new Date(b.at).getTime() : null;
      aired[part].times = within.filter((r) => r.code === CODE[part]).map((r) => r.at.getTime());
    }
  }
  // The log: the breaks' programs, and for "after every N programs" those since it last aired (at most two days back).
  const counted = CADENCE_PARTS.filter((p) => cadence[p].every === "n_programs");
  const lastAired = Math.min(from, ...counted.map((p) => Math.max(aired[p].last ?? from, now - PROGRAMS_BACK_MS)));
  let entries = input.entries?.rows ?? [];
  if (!input.entries || lastAired < input.entries.from.getTime() || lastEnd > input.entries.to.getTime()) {
    entries = await services.log.entries(stationId, new Date(lastAired), new Date(lastEnd));
  }
  const byId = new Map(entries.map((e) => [e.id, e]));
  const programs = entries.filter((e) => e.kind !== "off_air" && e.code === "PGM").map((e) => ({ startsAt: e.startsAt.getTime(), endsAt: e.endsAt.getTime() }));
  const tz = await services.stations.timezoneOf(stationId);
  const plan = planCadence({
    cadence,
    breaks: breaks.map((b) => {
      const startsAt = Date.parse(b.startsAt);
      const endsAt = startsAt + b.lengthMs;
      const entry = b.logEntryId ? byId.get(b.logEntryId) : undefined;
      // It closes its program's slot (a live block's cued breaks never do).
      const afterProgram = Boolean(entry && entry.kind === "program" && b.origin !== "cued_live" && endsAt >= entry.endsAt.getTime() - 1_000);
      return { key: b.startsAt, startsAt, endsAt, afterProgram };
    }),
    programs,
    aired,
    settledBefore: now - SETTLED_MS,
    hourStart: hourStartIn(tz)
  });
  return (slot) => plan.get(slot.startsAt) ?? EVERY_PART;
}
