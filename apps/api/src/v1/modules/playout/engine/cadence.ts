// How often the station ID, bumpers, the thank-you credit and spots air in breaks (added
// 2026-09-29; spots later that day). Each is set on the break rule (`BreakRule.cadence`): every
// break (the default, as before), the break after every program, the break after every N
// programs, once an hour (the first break after the top of the hour, in the station's time), or
// never (not the station ID).
//
// What airs in a break is worked out from the log and the as-run log, never from counters kept in
// memory, so a replan (or a worker that restarts) decides the same: breaks that are over are
// history (the as-run log says what aired in them), and the rest are decided in order from the
// last time each part aired. A break is "after a program" when it closes its program's slot.
//
// Spots decide how long a break is: a break without them is only as long as the parts that do air
// need (`needMs`), so it's decided while the log's breaks are laid out (log service,
// `generateBreaks`), break by break in order (`CadenceDecider`), and every break carries what airs
// in it (`BreakSlotView.parts`). A break that was filled with spots (its `filledAt`: the filler
// only marks breaks spots air in) keeps them, whatever the rule says since: they're held.

import { and, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../../context.js";
import { SEGMENT_MS } from "../../../lib/segments.js";
import { tzOffsetMinutes } from "../../../lib/time.js";

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
  /** The station's spots (added later on 2026-09-29). The maker's barter time isn't the station's: it stays. */
  spots: Cadence;
}
/**
 * What's decided per break. A243 (2026-10-02): the bumpers are two parts, the sequence opening the
 * break and the one closing it, each with its own cadence (the break rule's `bumperSequences`;
 * both `cadence.bumpers` by default, so they air together, as before).
 */
export type CadencePart = "stationId" | "bumpersOpen" | "bumpersClose" | "underwriting" | "spots";
/** `bumpers`: either bumper sequence airs (for readers from before A243). */
export type BreakParts = Record<CadencePart, boolean> & { bumpers: boolean };

export const CADENCE_PARTS: CadencePart[] = ["stationId", "bumpersOpen", "bumpersClose", "underwriting", "spots"];
/** Today's breaks: the station ID, bumpers, the credit and spots in every one. */
export const DEFAULT_CADENCE: BreakCadence = { stationId: { every: "break" }, bumpers: { every: "break" }, underwriting: { every: "break" }, spots: { every: "break" } };
export const EVERY_PART: BreakParts = { stationId: true, bumpersOpen: true, bumpersClose: true, bumpers: true, underwriting: true, spots: true };

/** The opening and closing bumper sequences' cadences (A243). Left out: both `cadence.bumpers`. */
export interface SequenceCadences {
  open: Cadence;
  close: Cadence;
}

/** Each part's cadence: the stored cadence, the bumpers split into the two sequences. */
export function partCadences(cadence: BreakCadence, sequences?: SequenceCadences): Record<CadencePart, Cadence> {
  return {
    stationId: cadence.stationId,
    bumpersOpen: sequences?.open ?? cadence.bumpers,
    bumpersClose: sequences?.close ?? cadence.bumpers,
    underwriting: cadence.underwriting,
    spots: cadence.spots
  };
}

/** Whether the bumpers opening (`open`) or closing (`close`) a break air in it (parts from before A243 carry only `bumpers`). */
export function bumpersIn(parts: Partial<BreakParts>, where: "open" | "close"): boolean {
  const own = where === "open" ? parts.bumpersOpen : parts.bumpersClose;
  return own ?? parts.bumpers ?? true;
}
/** "After every N programs" without an N. */
const DEFAULT_N = 2;
const HOUR = 3_600_000;
/** A break over this long ago is history: the as-run log has what aired in it. */
const SETTLED_MS = 60_000;
/** How far back "after every N programs" counts programs. */
const PROGRAMS_BACK_MS = 48 * HOUR;
const CODE: Record<CadencePart, "SID" | "BMP" | "UND" | "SPT"> = { stationId: "SID", bumpersOpen: "BMP", bumpersClose: "BMP", underwriting: "UND", spots: "SPT" };
/** Kept free for the credit in a break it airs in (fill.ts has the same). */
const CREDIT_MS = 15_000;

/** What a break airs, by its parts. A slot without them (a break the rule doesn't decide) airs everything. */
export function partsOf(slot: { parts?: BreakParts }): BreakParts {
  return slot.parts ?? EVERY_PART;
}

/** A stored cadence (or none) with the defaults filled in. The station ID is never `never`. */
export function cadenceOf(stored: Partial<Record<keyof BreakCadence, Partial<Cadence> | undefined>> | null | undefined): BreakCadence {
  const one = (c: Partial<Cadence> | undefined): Cadence => {
    const every = c?.every ?? "break";
    return every === "n_programs" ? { every, n: c?.n ?? DEFAULT_N } : { every };
  };
  const stationId = one(stored?.stationId);
  return {
    stationId: stationId.every === "never" ? { every: "break" } : (stationId as BreakCadence["stationId"]),
    bumpers: one(stored?.bumpers),
    underwriting: one(stored?.underwriting),
    spots: one(stored?.spots)
  };
}

/** Every part in every break: nothing to work out. */
export function isEveryBreak(cadence: BreakCadence, sequences?: SequenceCadences): boolean {
  const c = partCadences(cadence, sequences);
  return CADENCE_PARTS.every((p) => c[p].every === "break");
}

/** Parts whose choice depends on when they last aired (once an hour, after every N programs). */
export function statefulParts(cadence: BreakCadence, sequences?: SequenceCadences): CadencePart[] {
  const c = partCadences(cadence, sequences);
  return CADENCE_PARTS.filter((p) => c[p].every === "hour" || c[p].every === "n_programs");
}

export interface CadenceBreak {
  key: string;
  startsAt: number;
  /** Where the break ends at the rule's length (a break without spots may end sooner). */
  endsAt: number;
  /** It closes its program's slot. */
  afterProgram: boolean;
}

type Aired = { last: number | null; times: number[] };

export interface CadenceInput {
  cadence: BreakCadence;
  /** A243: the opening and closing bumper sequences' cadences (left out: both `cadence.bumpers`). */
  sequences?: SequenceCadences;
  /** In order. */
  breaks: CadenceBreak[];
  /** Programs on the log (their slots), for "after every N programs". */
  programs: Array<{ startsAt: number; endsAt: number }>;
  /**
   * From the as-run log: when each part aired in a break, and the last time before those. A part
   * left out: nothing. `bumpers` (before A243) stands for both bumper sequences.
   */
  aired: Partial<Record<CadencePart | "bumpers", Aired>>;
  /** Breaks that ended before this are history. */
  settledBefore: number;
  /**
   * The parts whose history was read: a break that's over goes by what aired in it. The others
   * are decided by the rule alone, over or not. Every part unless said.
   */
  recorded?: CadencePart[];
  /** The top of the station's hour a time is in. */
  hourStart(t: number): number;
}

/**
 * Decides break by break, in order (each part from the last time it aired). What the log lays out
 * as it goes: a break without spots is shorter, so the next break's time depends on this one.
 */
export class CadenceDecider {
  private readonly state: Record<CadencePart, { last: number | null; times: number[]; i: number }>;
  private readonly recorded: Set<CadencePart>;
  private readonly cadences: Record<CadencePart, Cadence>;

  constructor(private readonly input: Omit<CadenceInput, "breaks">) {
    const none: Aired = { last: null, times: [] };
    this.cadences = partCadences(input.cadence, input.sequences);
    const bumpers = (p: CadencePart) => (p === "bumpersOpen" || p === "bumpersClose" ? input.aired.bumpers : undefined);
    this.state = Object.fromEntries(
      CADENCE_PARTS.map((p) => {
        const a = input.aired[p] ?? bumpers(p) ?? none;
        return [p, { last: a.last, times: [...a.times].sort((x, y) => x - y), i: 0 }];
      })
    ) as CadenceDecider["state"];
    const recorded = (input.recorded ?? CADENCE_PARTS) as Array<CadencePart | "bumpers">;
    this.recorded = new Set(recorded.flatMap((p): CadencePart[] => (p === "bumpers" ? ["bumpersOpen", "bumpersClose"] : [p])));
  }

  /** `known`: parts known to air in it whatever the rule says (spots already placed and held). */
  next(b: CadenceBreak, known: Partial<BreakParts> = {}): BreakParts {
    const out = { ...EVERY_PART };
    for (const part of CADENCE_PARTS) {
      const s = this.state[part];
      // What aired before this break.
      while (s.i < s.times.length && s.times[s.i] < b.startsAt) s.last = Math.max(s.last ?? -Infinity, s.times[s.i++]);
      let airs: boolean;
      let at: number | undefined = s.times.slice(s.i).find((t) => t >= b.startsAt && t < b.endsAt);
      if (known[part]) {
        airs = true;
        at ??= b.startsAt;
      } else if (at !== undefined) airs = true;
      else if (b.endsAt < this.input.settledBefore && this.recorded.has(part)) airs = false;
      else airs = this.decide(this.cadences[part], b, s.last);
      if (airs) s.last = Math.max(s.last ?? -Infinity, at ?? b.startsAt);
      out[part] = airs;
    }
    out.bumpers = out.bumpersOpen || out.bumpersClose;
    return out;
  }

  private decide(c: Cadence, b: CadenceBreak, last: number | null): boolean {
    switch (c.every) {
      case "break":
        return true;
      case "never":
        return false;
      case "program":
        return b.afterProgram;
      case "hour":
        return last === null || last < this.input.hourStart(b.startsAt);
      case "n_programs": {
        if (!b.afterProgram) return false;
        if (last === null) return true;
        // Programs that started after it last aired, up to the one this break closes.
        const n = this.input.programs.filter((p) => p.startsAt >= last && p.endsAt <= b.endsAt).length;
        return n >= (c.n ?? DEFAULT_N);
      }
    }
  }
}

/** Whether each part airs in each break (by the break's key). */
export function planCadence(input: CadenceInput): Map<string, BreakParts> {
  const decider = new CadenceDecider(input);
  const out = new Map<string, BreakParts>();
  for (const b of [...input.breaks].sort((a, z) => a.startsAt - z.startsAt)) out.set(b.key, decider.next(b));
  return out;
}

/** The top of the hour in a timezone. */
export function hourStartIn(tz: string): (t: number) => number {
  return (t) => {
    const offset = tzOffsetMinutes(new Date(t), tz) * 60_000;
    return Math.floor((t + offset) / HOUR) * HOUR - offset;
  };
}

/** How long a break without spots runs: the maker's barter time and the parts that air, to whole segments. */
export interface BreakNeeds {
  /** The station ID's length (its own, or the generated one's ten seconds once prepared). */
  stationIdMs: number;
  /** Whether a credit would air in a program's breaks (sponsors of it or of the station, or members to thank). */
  credit(programId: string | null): boolean;
  /** The bumper into the break and the one out of it (the same one twice when there's one). Before A243; `elementsMs` wins. */
  bumpersMs?: number;
}

/** `elementsMs` (A243): the break's chosen bumper sequences (sequence.ts `elementsMs`), where the cadence has them. */
export function needMs(needs: BreakNeeds, parts: BreakParts, context: { programId: string | null; producerShareMs: number; elementsMs?: number }): number {
  let ms = context.producerShareMs;
  if (parts.stationId) ms += needs.stationIdMs;
  if (parts.underwriting && needs.credit(context.programId)) ms += CREDIT_MS;
  if (context.elementsMs !== undefined) ms += context.elementsMs;
  else if (parts.bumpers) ms += needs.bumpersMs ?? 0;
  return ms > 0 ? Math.ceil(ms / SEGMENT_MS) * SEGMENT_MS : 0;
}

interface EntryLike {
  kind: string;
  code: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * What the log needs to decide a station's breaks from `from` (the first program whose breaks are
 * laid out) to `to`: the history of the parts whose choice depends on it, the programs for "after
 * every N programs", and (when spots don't air in every break) how long a break without them is.
 * `rows` are the log entries the caller already has from `from`; entries further back are read
 * for counting programs. (The log service knows which of its stored breaks were filled.)
 */
export async function cadenceContext(
  { deps, services }: ModuleContext,
  stationId: string,
  input: { cadence: BreakCadence; sequences?: SequenceCadences; from: Date; to: Date; rows: EntryLike[]; readEntries(from: Date, to: Date): Promise<EntryLike[]> }
): Promise<{ decider: CadenceDecider; needs: BreakNeeds | null }> {
  const { cadence, sequences, from, to } = input;
  const cadences = partCadences(cadence, sequences);
  const now = deps.clock.now().getTime();
  const stateful = statefulParts(cadence, sequences);
  const A = schema.asRun;
  const codes = [...new Set(stateful.map((p) => CODE[p]))];
  // The station's own spots count; the maker's barter time isn't the station's.
  const own = or(sql`${A.code} <> 'SPT'`, isNull(A.carriageAgreementId));
  const [before, within, tz] = await Promise.all([
    codes.length
      ? deps.db
          .select({ code: A.code, position: A.position, at: sql<Date>`max(${A.startedAt})` })
          .from(A)
          .where(and(eq(A.stationId, stationId), isNotNull(A.breakId), inArray(A.code, codes), own, lt(A.startedAt, from)))
          .groupBy(A.code, A.position)
      : Promise.resolve([] as Array<{ code: string; position: string | null; at: Date }>),
    codes.length
      ? deps.db
          .select({ code: A.code, position: A.position, at: A.startedAt })
          .from(A)
          .where(and(eq(A.stationId, stationId), isNotNull(A.breakId), inArray(A.code, codes), own, gte(A.startedAt, from), lt(A.startedAt, to)))
      : Promise.resolve([] as Array<{ code: string; position: string | null; at: Date }>),
    services.stations.timezoneOf(stationId)
  ]);
  // A243: a bumper opening the break is `open`, one closing it `close`; rows from before (no position) count for both.
  const counts = (part: CadencePart, r: { code: string; position: string | null }) =>
    r.code === CODE[part] && (part === "bumpersOpen" ? r.position === "open" || r.position === null : part === "bumpersClose" ? r.position === "close" || r.position === null : true);
  const aired: CadenceInput["aired"] = {};
  for (const part of stateful) {
    const last = before.filter((r) => counts(part, r)).reduce<number | null>((m, r) => (r.at ? Math.max(m ?? -Infinity, new Date(r.at).getTime()) : m), null);
    aired[part] = { last, times: within.filter((r) => counts(part, r)).map((r) => new Date(r.at).getTime()) };
  }
  // For "after every N programs": the programs since it last aired (at most two days back).
  let entries = input.rows;
  const counted = CADENCE_PARTS.filter((p) => cadences[p].every === "n_programs");
  if (counted.length) {
    const back = Math.min(...counted.map((p) => Math.max(aired[p]?.last ?? from.getTime(), now - PROGRAMS_BACK_MS)));
    if (back < from.getTime()) entries = [...(await input.readEntries(new Date(back), from)), ...entries];
  }
  const programs = entries.filter((e) => e.kind !== "off_air" && e.code === "PGM").map((e) => ({ startsAt: e.startsAt.getTime(), endsAt: e.endsAt.getTime() }));
  const decider = new CadenceDecider({ cadence, sequences, programs, aired, settledBefore: now - SETTLED_MS, recorded: stateful, hourStart: hourStartIn(tz) });

  // How long a break without spots runs (only asked when spots don't air in every break).
  let needs: BreakNeeds | null = null;
  if (cadence.spots.every !== "break") {
    const [fillers, credits, members, sidMs, catalog] = await Promise.all([
      services.library.fillers(stationId),
      services.spots.creditsFor(stationId),
      services.ledger.memberCredits(stationId),
      services.playout.stationIdMs(stationId),
      services.shelf.catalogSeries()
    ]);
    // A catalog program always has a credit to air (its series' sponsor, or Clear): once an hour, but
    // a break's length is decided alone, so each of its breaks keeps the room. The bumpers' room is
    // the break's own chosen sequences (A243: `needMs`'s `elementsMs`).
    const catalogPrograms = new Set(catalog.map((c) => c.programId));
    needs = {
      stationIdMs: fillers.stationIds[0]?.durationMs ?? sidMs,
      credit: (programId) => members.named.length > 0 || (programId !== null && catalogPrograms.has(programId)) || credits.some((c) => c.programId === null || c.programId === programId)
    };
  }
  return { decider, needs };
}
