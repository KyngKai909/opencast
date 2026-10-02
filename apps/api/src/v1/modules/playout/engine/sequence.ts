// Bumper roles and chained sequences (A243, 2026-10-02; Build A of design-bumpers-blocks). A bumper
// has a role: into the break, out of the break, up next, or Any (a brand sting; every bumper without
// a role). The break rule has three sequences of roles: one opening each break (before the spots),
// one closing it (after the credit, before the station ID), and one between programs (after the
// closing break's station ID, just before the next program starts, outside the break's SCTE-35
// span). Each position airs as often as its own cadence says. The defaults are today's run sheet:
// one into the break, one out of it, as often as `cadence.bumpers`; nothing between programs.
//
// Which bumper fills a role: the role's pool, else (into and out of the break) the Any pool; up
// next never falls back to Any (a sting doesn't say "up next"). An item outside its window (its
// dates, its time of day) never airs, not even as a last resort; a pool with nothing in its window
// passes to the next in the chain.
//
// Rotation (the user's answer, A243): a pool of three or more takes turns, least recently aired
// first (ties by library order), decided break by break in order with the cadence, from the as-run
// log, so every reader (the log page, the Monitor, the filler, the planner) sees the same picks. A
// pool of one or two airs in library order, the first not already in this break: two untagged
// bumpers are A into the break and B out of it, every time, as before.
//
// Up next names the next program as the guide has it (the same airing the dial and the banner's
// "Next at" show); with nothing on next (off air comes first) it's left out. The title is drawn by
// the player over the clip (an `org.useopencast.up-next` DATERANGE), never burned in. It airs at
// most once per break and the boundary after it: the first position that has it.
//
// Not enough room: each bumper airs whole or not at all, in this order of priority (held spots,
// the station ID and the credit come first, as before): into the break, out of the break, up next,
// Any. The rest keep their sequence order; time left holds on the station ID slate.

import { and, asc, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../../context.js";
import { broadcastDate } from "../../log/templates.js";
import { tzOffsetMinutes } from "../../../lib/time.js";
import type { Cadence, CadenceEvery } from "./cadence.js";

export type BumperRole = "into_break" | "out_of_break" | "up_next" | "any";
export const BUMPER_ROLES: BumperRole[] = ["into_break", "out_of_break", "up_next", "any"];

export interface PositionRule {
  roles: BumperRole[];
  every: CadenceEvery;
  n?: number;
}
export interface BumperSequences {
  open: PositionRule;
  close: PositionRule;
  between: PositionRule;
}
export type Position = "open" | "close" | "between";

/** "After every N programs" without an N. */
const DEFAULT_N = 2;
/** At most this many bumpers in one position. */
export const MAX_ROLES = 4;

/** Today's breaks: one bumper into the break and one out of it, as often as the bumpers' cadence; none between programs. */
export function defaultSequences(bumpers: Cadence = { every: "break" }): BumperSequences {
  const every = (c: Cadence): Pick<PositionRule, "every" | "n"> => (c.every === "n_programs" ? { every: c.every, n: c.n ?? DEFAULT_N } : { every: c.every });
  return { open: { roles: ["into_break"], ...every(bumpers) }, close: { roles: ["out_of_break"], ...every(bumpers) }, between: { roles: [], every: "program" } };
}

/** A stored sequence (or none: the defaults, from the bumpers' cadence) with everything filled in. */
export function sequencesOf(stored: Partial<Record<Position, Partial<PositionRule> | undefined>> | null | undefined, bumpers: Cadence = { every: "break" }): BumperSequences {
  const defaults = defaultSequences(bumpers);
  if (!stored) return defaults;
  const one = (p: Position): PositionRule => {
    const s = stored[p];
    if (!s) return defaults[p];
    const roles = [...new Set((s.roles ?? []).filter((r): r is BumperRole => BUMPER_ROLES.includes(r as BumperRole)))].slice(0, MAX_ROLES);
    let every: CadenceEvery = s.every ?? defaults[p].every;
    // Between programs is per boundary: "every break" is every boundary.
    if (p === "between" && every === "break") every = "program";
    return every === "n_programs" ? { roles, every, n: s.n ?? DEFAULT_N } : { roles, every };
  };
  return { open: one("open"), close: one("close"), between: one("between") };
}

/** What's wrong with a sequence as sent (field → message), or null. */
export function sequenceProblems(input: Partial<Record<Position, Partial<PositionRule>>>): Record<string, string> | null {
  const problems: Record<string, string> = {};
  for (const p of ["open", "close", "between"] as const) {
    const s = input[p];
    if (!s) continue;
    const roles = s.roles ?? [];
    if (roles.length > MAX_ROLES) problems[`bumperSequences.${p}.roles`] = "At most four";
    if (new Set(roles).size !== roles.length) problems[`bumperSequences.${p}.roles`] = "Each role once";
    if (s.every === "n_programs" && !s.n) problems[`bumperSequences.${p}.n`] = "Required";
  }
  return Object.keys(problems).length ? problems : null;
}

// ---- When an item may air -------------------------------------------------------------------

/** When an item may air (A243): broadcast dates, inclusive, either open; a time of day ("HH:MM", both or neither). */
export interface AirWindowRef {
  from: string | null;
  until: string | null;
  dailyFrom: string | null;
  dailyUntil: string | null;
}

const minuteOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** The market's wall-clock minute of a moment (0 to 1439). */
function localMinute(t: number, tz: string): number {
  const minutes = Math.floor(t / 60_000) + tzOffsetMinutes(new Date(t), tz);
  return ((minutes % 1440) + 1440) % 1440;
}

/**
 * Whether an item may air at `t`: its broadcast date (6:00 am to 6:00 am, so 2:00 am on Jan 1 is
 * Dec 31's) inside its dates, and the market's wall clock inside its time of day (an end before the
 * start runs past midnight; wall clock, so daylight saving changes nothing). No window: always.
 */
export function eligible(item: { airs?: AirWindowRef | null }, t: number, tz: string): boolean {
  const w = item.airs;
  if (!w) return true;
  if (w.from || w.until) {
    const date = broadcastDate(new Date(t), tz);
    if (w.from && date < w.from) return false;
    if (w.until && date > w.until) return false;
  }
  if (w.dailyFrom && w.dailyUntil) {
    const m = localMinute(t, tz);
    const a = minuteOf(w.dailyFrom);
    const b = minuteOf(w.dailyUntil);
    if (a < b ? m < a || m >= b : m < a && m >= b) return false;
  }
  return true;
}

/** A window with nothing set reads as none. */
export function windowOf(row: { airsFrom: string | null; airsUntil: string | null; dailyFrom: string | null; dailyUntil: string | null }): AirWindowRef | null {
  const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
  const w = { from: row.airsFrom, until: row.airsUntil, dailyFrom: hhmm(row.dailyFrom), dailyUntil: hhmm(row.dailyUntil) };
  return w.from || w.until || w.dailyFrom ? w : null;
}

// ---- Pools, chains and picks ----------------------------------------------------------------

export interface PoolItem {
  id: string;
  title: string;
  durationMs: number | null;
  bumperRole?: BumperRole | null;
  airs?: AirWindowRef | null;
}

/** The station's bumpers by role, in library order. Untagged bumpers are Any. */
export function poolsOf<T extends PoolItem>(bumpers: T[]): Record<BumperRole, T[]> {
  const pools: Record<BumperRole, T[]> = { into_break: [], out_of_break: [], up_next: [], any: [] };
  for (const b of bumpers) pools[b.bumperRole ?? "any"].push(b);
  return pools;
}

/** Where each role's bumper comes from, first pool with something in its window first. Up next never falls back to Any. */
export function chainOf(role: BumperRole): BumperRole[] {
  return role === "into_break" || role === "out_of_break" ? [role, "any"] : [role];
}

/** Room goes to these first when a break is short (after held spots, the station ID and the credit). */
export const ROLE_PRIORITY: Record<BumperRole, number> = { into_break: 0, out_of_break: 1, up_next: 2, any: 3 };

/** What up next names: the next program as the guide has it. */
export interface Announce {
  entryId: string | null;
  title: string;
  episodeTitle: string | null;
  /** ISO, the program's start. */
  startsAt: string;
  carriedFrom: string | null;
}

/** One bumper in a sequence. */
export interface Element {
  position: Position;
  role: BumperRole;
  itemId: string;
  title: string;
  lengthMs: number;
  /** The rest of the chain in pick order: a substitute when the pick isn't prepared at air time. */
  alternates: string[];
  /** Up next: what it names. */
  announces?: Announce;
}

/** The between-programs elements before a program (A243): at its start, `ms` long. */
export interface Boundary {
  /** ISO: the next program's start. */
  at: string;
  entryId: string;
  elements: Element[];
  ms: number;
}

/** A pool of this many or more takes turns (least recently aired first); fewer air in library order. */
export const ROTATES_FROM = 3;

/**
 * Picks bumpers for roles, in order (break by break, then each boundary), least recently aired
 * first in a pool of three or more. Seeded with when each item last aired (the as-run log, before
 * the walk), and fed what aired inside the walk as it passes.
 */
export class SequenceDecider<T extends PoolItem> {
  private readonly pools: Record<BumperRole, T[]>;
  private readonly order = new Map<string, number>();
  private readonly last: Map<string, number>;
  private readonly aired: Array<{ id: string; at: number }>;
  private i = 0;

  constructor(
    bumpers: T[],
    private readonly tz: string,
    seed: { last?: Map<string, number>; aired?: Array<{ id: string; at: number }> } = {}
  ) {
    this.pools = poolsOf(bumpers);
    bumpers.forEach((b, i) => this.order.set(b.id, i));
    this.last = new Map(seed.last ?? []);
    this.aired = [...(seed.aired ?? [])].sort((a, b) => a.at - b.at);
  }

  /** Whether any pool these roles use rotates (and so needs history). */
  rotates(roles: Iterable<BumperRole>): boolean {
    for (const role of roles) for (const pool of chainOf(role)) if (this.pools[pool].length >= ROTATES_FROM) return true;
    return false;
  }

  /** Whether a role has anything at all (in or out of its window). */
  has(role: BumperRole): boolean {
    return chainOf(role).some((p) => this.pools[p].length > 0);
  }

  /** What aired (the as-run log) before `t` counts from now on. */
  private fold(t: number) {
    while (this.i < this.aired.length && this.aired[this.i].at < t) {
      const a = this.aired[this.i++];
      this.last.set(a.id, Math.max(this.last.get(a.id) ?? -Infinity, a.at));
    }
  }

  /** The bumper for a role at `t` (and the rest of its pool in pick order), or null. `used`: already in this break. */
  pick(role: BumperRole, t: number, used: Set<string>): { item: T; alternates: T[] } | null {
    this.fold(t);
    for (const pool of chainOf(role)) {
      const ready = this.pools[pool].filter((b) => b.durationMs && eligible(b, t, this.tz));
      if (!ready.length) continue;
      const ordered =
        ready.length >= ROTATES_FROM
          ? [...ready].sort((a, b) => (this.last.get(a.id) ?? -Infinity) - (this.last.get(b.id) ?? -Infinity) || this.order.get(a.id)! - this.order.get(b.id)!)
          : [...ready.filter((b) => !used.has(b.id)), ...ready.filter((b) => used.has(b.id))];
      return { item: ordered[0], alternates: ordered.slice(1) };
    }
    return null;
  }

  /** It airs at `t`. */
  record(id: string, t: number) {
    this.last.set(id, Math.max(this.last.get(id) ?? -Infinity, t));
  }
}

/** The roles each position airs in one break (and its boundary): up next once, in the first that has it. */
export function rolesFor(seq: BumperSequences, airs: { open: boolean; close: boolean; between: boolean }): Record<Position, BumperRole[]> {
  let upNext = false;
  const out = {} as Record<Position, BumperRole[]>;
  for (const p of ["open", "close", "between"] as const) {
    const roles = airs[p] ? seq[p].roles : [];
    out[p] = roles.filter((r) => {
      if (r !== "up_next") return true;
      if (upNext) return false;
      upNext = true;
      return true;
    });
  }
  return out;
}

/**
 * The elements for one position at `t`: a pick per role, in order. Up next is left out with
 * nothing on next (`announce` gives null).
 */
export function pickElements<T extends PoolItem>(
  decider: SequenceDecider<T>,
  position: Position,
  roles: BumperRole[],
  t: number,
  used: Set<string>,
  announce: () => Announce | null
): Element[] {
  const out: Element[] = [];
  for (const role of roles) {
    let announces: Announce | undefined;
    if (role === "up_next") {
      if (!decider.has("up_next")) continue;
      const next = announce();
      if (!next) continue;
      announces = next;
    }
    const picked = decider.pick(role, t, used);
    if (!picked) continue;
    used.add(picked.item.id);
    // In air order: a later bumper in the break counts as aired later (a millisecond a place).
    decider.record(picked.item.id, t + used.size);
    out.push({ position, role, itemId: picked.item.id, title: picked.item.title, lengthMs: picked.item.durationMs!, alternates: picked.alternates.map((a) => a.id), ...(announces ? { announces } : {}) });
  }
  return out;
}

/** How long a break's chosen bumpers run (its sequences and the boundary after it): the room the filler keeps. */
export function elementsMs(slot: { elements?: { open: Element[]; close: Element[] }; boundary?: Boundary | null }): number {
  const sum = (list: Element[] | undefined) => (list ?? []).reduce((s, e) => s + e.lengthMs, 0);
  return sum(slot.elements?.open) + sum(slot.elements?.close) + (slot.boundary?.ms ?? 0);
}

/**
 * Which elements fit `roomMs`: whole or not at all, by priority (into the break, out of it, up
 * next, Any; in sequence order within a role). Returns each element with whether it fits, in
 * sequence order.
 */
export function fitElements<E extends { role: BumperRole; lengthMs: number }>(elements: E[], roomMs: number): Array<E & { fits: boolean }> {
  const order = elements.map((e, i) => ({ e, i })).sort((a, b) => ROLE_PRIORITY[a.e.role] - ROLE_PRIORITY[b.e.role] || a.i - b.i);
  let left = roomMs;
  const fits = new Set<number>();
  for (const { e, i } of order) {
    if (e.lengthMs <= left) {
      fits.add(i);
      left -= e.lengthMs;
    }
  }
  return elements.map((e, i) => ({ ...e, fits: fits.has(i) }));
}

// ---- Between programs -----------------------------------------------------------------------

/** As-run rows this long before a boundary are its between bumpers. */
const BOUNDARY_SPAN_MS = 5 * 60_000;

/**
 * Whether the between sequence airs at each program boundary, in order: every boundary
 * (`program`), every Nth since it last aired, the first at or after the top of the hour, or never.
 * Boundaries that are over go by the as-run log, as the cadence's breaks do.
 */
export class BoundaryDecider {
  private last: number | null;
  private readonly times: number[];
  private i = 0;

  constructor(
    private readonly input: {
      rule: PositionRule;
      /** When it last aired before the walk, and the times it aired inside the walk (as-run, `between`). */
      last: number | null;
      times: number[];
      settledBefore: number;
      hourStart(t: number): number;
      /** Program and live starts on the log, for "every N programs". */
      starts: number[];
    }
  ) {
    this.last = input.last;
    this.times = [...input.times].sort((a, b) => a - b);
  }

  next(at: number): boolean {
    while (this.i < this.times.length && this.times[this.i] < at - BOUNDARY_SPAN_MS) this.last = Math.max(this.last ?? -Infinity, this.times[this.i++]);
    const { rule } = this.input;
    if (!rule.roles.length || rule.every === "never") return false;
    const aired = this.times.some((t) => t >= at - BOUNDARY_SPAN_MS && t <= at);
    let airs: boolean;
    if (aired) airs = true;
    else if (at < this.input.settledBefore && rule.every !== "program" && rule.every !== "break") airs = false;
    else if (rule.every === "program" || rule.every === "break") airs = true;
    else if (rule.every === "hour") airs = this.last === null || this.last < this.input.hourStart(at);
    else {
      const last = this.last;
      airs = last === null || this.input.starts.filter((s) => s > last && s <= at).length >= (rule.n ?? DEFAULT_N);
    }
    if (airs) this.last = Math.max(this.last ?? -Infinity, at);
    return airs;
  }
}

/**
 * A break's bumpers when they weren't picked with it (a slot from elsewhere): the defaults, the
 * library's first Any bumper into the break and its second (or the first again) out of it, where
 * the cadence has them, in their windows at `t`.
 */
export function defaultElements<T extends PoolItem>(bumpers: T[], airs: { open: boolean; close: boolean }, t: number, tz: string): { open: Element[]; close: Element[] } {
  const any = poolsOf(bumpers).any.filter((b) => b.durationMs && eligible(b, t, tz));
  const el = (b: T | undefined, position: "open" | "close"): Element[] =>
    b ? [{ position, role: position === "open" ? "into_break" : "out_of_break", itemId: b.id, title: b.title, lengthMs: b.durationMs!, alternates: [] }] : [];
  return { open: airs.open ? el(any[0], "open") : [], close: airs.close ? el(any[1] ?? any[0], "close") : [] };
}

/**
 * What the as-run log says about a station's bumpers in breaks and between programs (the log's
 * walk reads it here: the as-run log is playout's): when each last aired before `start` (30 days
 * back, for least recently aired first; `seed`), what aired from `start` to `to` (`inWindow`), and
 * when the between sequence last aired before `start` (`between`).
 */
export async function bumperHistory(
  { deps }: Pick<ModuleContext, "deps">,
  stationId: string,
  o: { bumperIds: string[]; start: Date; to: Date; seed: boolean; inWindow: boolean; between: boolean }
): Promise<{
  seedRows: Array<{ id: string | null; at: Date }>;
  airedRows: Array<{ id: string | null; at: Date; endedAt: Date; position: string | null; breakId: string | null }>;
  lastBetween: number | null;
}> {
  const AR = schema.asRun;
  const db = deps.db;
  const placed = or(inArray(AR.position, ["open", "close", "between"]), and(sql`${AR.position} is null`, isNotNull(AR.breakId)));
  const [seedRows, airedRows, lastBetween] = await Promise.all([
    o.seed && o.bumperIds.length
      ? db
          .select({ id: AR.assetId, at: sql<Date>`max(${AR.startedAt})` })
          .from(AR)
          .where(and(eq(AR.stationId, stationId), eq(AR.code, "BMP"), inArray(AR.assetId, o.bumperIds), gte(AR.startedAt, new Date(o.start.getTime() - 30 * 86_400_000)), lt(AR.startedAt, o.start), placed))
          .groupBy(AR.assetId)
      : Promise.resolve([] as Array<{ id: string | null; at: Date }>),
    o.inWindow && o.bumperIds.length
      ? db
          .select({ id: AR.assetId, at: AR.startedAt, endedAt: AR.endedAt, position: AR.position, breakId: AR.breakId })
          .from(AR)
          .where(and(eq(AR.stationId, stationId), eq(AR.code, "BMP"), gte(AR.startedAt, o.start), lt(AR.startedAt, o.to), placed))
          .orderBy(asc(AR.startedAt))
      : Promise.resolve([] as Array<{ id: string | null; at: Date; endedAt: Date; position: string | null; breakId: string | null }>),
    o.between
      ? db
          .select({ at: sql<Date>`max(${AR.startedAt})` })
          .from(AR)
          .where(and(eq(AR.stationId, stationId), eq(AR.position, "between"), lt(AR.startedAt, o.start)))
          .then((r) => (r[0]?.at ? new Date(r[0].at).getTime() : null))
      : Promise.resolve(null)
  ]);
  return { seedRows, airedRows, lastBetween };
}
