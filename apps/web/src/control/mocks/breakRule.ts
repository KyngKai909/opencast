// The break rule in the mock (A246, Schedule phase 3): saving it (as the API merges what's left
// out), previewing it, and what saving does to breaks not yet filled. The API rebuilds breaks
// from the rule every time it reads the log; the mock keeps tonight's breaks in its db, so it
// works the rule out here (`ruleBreaks`) for the preview and writes the same breaks back when the
// rule is saved. Either way the preview is what the log shows after saving.
//
// What the mock decides, as the API does for breaks nothing has aired in yet: a break after each
// program (the gap before the next program, under five minutes, or the time its item leaves of
// its slot), or every N minutes inside a program; each part (the station ID, the credit, spots,
// each bumper sequence, and S20's Up next) as often as its cadence says, in order. A break keeps
// what it has (`keeps`) once spots are placed in it or it's within 20 minutes of air.
//
// A247 (2026-10-04), as the API does it (apps/api log/timing.ts), simplified as the rest is (a
// program doesn't move later for the breaks inside it): after every N programs (the count starting
// again each broadcast day and after off air; live isn't counted), clock times inside programs, and
// breaks inside long programs; one within five minutes of another break, or of its program's
// start or end, is skipped, and one that doesn't fit in the time the program leaves isn't placed.

import type { BreakCadence, BreakRule, BreakSlot, BumperRole, LogEntry } from "@opencast/contracts";
import { getDb, stationBreaks, stationLog } from "./db";
import { breakSlot, type DbBreak, type DbFill, type DbLogEntry } from "./fixtures/evening";
import { rowsOfBreak } from "./fixtures/onair";
import { breakRuleOf, defaultSequences } from "./fixtures/station";
import { STATION_TZ } from "../../lib/clock";
import { GENERATED_SID_MS, GENERATED_SID_TITLE } from "./handlers/library";

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Spots go into a break about 20 minutes before it airs; from then it keeps what it has. */
export const KEEP_AHEAD_MS = 20 * MIN;
/** How far ahead saving the rule rebuilds the mock's breaks. */
const APPLY_AHEAD_MS = 36 * HOUR;
const CREDIT_MS = 15_000;

/** What went wrong with a body, in the API's words. */
export class RuleError extends Error {}

/**
 * A rule as `setBreakRule` would save it: the station ID last, what's left out kept as set (the
 * cadence, spots alone, S20's Up next alone; the sequences, unless an older body changes how
 * often bumpers air), the bumpers' cadence following the opening sequence. Throws `RuleError`.
 */
export function resolveRule(stationId: string, body: BreakRule): BreakRule {
  const before = breakRuleOf(stationId);
  const was = before.cadence;
  if (body.mode === "every_n_minutes" && !body.everyMinutes) throw new RuleError("Say how often.");
  if (body.cadence && (body.cadence.stationId.every as string) === "never") throw new RuleError("The station ID can't be turned off. Choose how often it airs.");
  if (body.cadence && Object.values(body.cadence).some((c) => c && c.every === "n_programs" && !c.n)) throw new RuleError("Say after how many programs.");
  let cadence = body.cadence
    ? (() => {
        const upNext = body.cadence.upNext === undefined ? was?.upNext : body.cadence.upNext;
        const { upNext: _drop, ...rest } = body.cadence;
        return { ...rest, spots: body.cadence.spots ?? was?.spots, ...(upNext ? { upNext } : {}) };
      })()
    : was;
  let bumperSequences = body.bumperSequences ?? before.bumperSequences;
  if (body.bumperSequences) {
    const seq = body.bumperSequences;
    if ((["open", "close", "between"] as const).some((p) => new Set(seq[p].roles).size !== seq[p].roles.length)) throw new RuleError("Each bumper role can be in a position once, four at most. Say after how many programs.");
    if ((["open", "close", "between"] as const).some((p) => seq[p].every === "n_programs" && !seq[p].n)) throw new RuleError("Each bumper role can be in a position once, four at most. Say after how many programs.");
    const open = seq.open;
    if (cadence) cadence = { ...cadence, bumpers: open.every === "n_programs" ? { every: open.every, n: open.n } : { every: open.every } };
  } else if (body.cadence && bumperSequences && JSON.stringify(body.cadence.bumpers) !== JSON.stringify(was?.bumpers)) {
    const every = body.cadence.bumpers;
    bumperSequences = { ...bumperSequences, open: { ...bumperSequences.open, ...every }, close: { ...bumperSequences.close, ...every } };
  }
  const fillOrder = [...body.fillOrder.filter((c, i) => c !== "SID" && c !== "PGM" && c !== "OPEN" && body.fillOrder.indexOf(c) === i), "SID" as const];
  const timing = resolveTiming(body, before);
  const blockedCategories = [...new Set(body.blockedCategories.map((c) => c.trim()).filter(Boolean))].sort();
  return {
    ...before,
    ...body,
    ...timing,
    fillOrder,
    blockedCategories,
    cadence,
    bumperSequences: bumperSequences ?? defaultSequences(cadence?.bumpers),
    adsFromPartners: body.adsFromPartners ?? before.adsFromPartners,
    stationIdAfterOpener: body.stationIdAfterOpener ?? before.stationIdAfterOpener,
    dailyOpener: body.dailyOpener ?? before.dailyOpener
  };
}

/**
 * A247: what `setBreakRule` keeps of every N programs, the clock times and inside long programs,
 * in the API's words (apps/api log/timing.ts `resolveTiming`). Left out (an older body), each stays
 * while the mode it goes with does.
 */
function resolveTiming(body: BreakRule, before: BreakRule): Pick<BreakRule, "everyMinutes" | "everyPrograms" | "clockMinutes" | "longPrograms"> {
  const MIN_MS = 60_000;
  const everyPrograms = body.everyPrograms === undefined ? (body.mode === "after_every_program" && before.mode === "after_every_program" ? (before.everyPrograms ?? null) : null) : body.everyPrograms;
  if (everyPrograms !== null && body.mode !== "after_every_program") throw new RuleError("Breaks after every N programs go with breaks after every program.");
  const kept = before.mode === "every_n_minutes" && before.clockMinutes?.length && body.mode === "every_n_minutes" && body.everyMinutes === before.everyMinutes ? before.clockMinutes : null;
  const sent = body.clockMinutes === undefined ? kept : body.clockMinutes;
  let clockMinutes: number[] | null = null;
  if (sent) {
    if (body.mode !== "every_n_minutes") throw new RuleError("Breaks at set times each hour go with mode every_n_minutes.");
    clockMinutes = [...new Set(sent)].sort((a, b) => a - b);
    const need = Math.max(10, Math.ceil(body.lengthMs / MIN_MS + 5));
    if (clockMinutes.length > 1 && clockMinutes.some((m, i) => ((clockMinutes![(i + 1) % clockMinutes!.length]! - m + 60) % 60 || 60) < need)) throw new RuleError(`Leave at least ${need} minutes between break times.`);
  }
  const everyMinutes = clockMinutes ? 60 / clockMinutes.length : body.mode === "every_n_minutes" ? body.everyMinutes : null;
  const minutes = body.mode === "every_n_minutes" && !clockMinutes;
  if (minutes && body.longPrograms) throw new RuleError("Every N minutes already breaks inside every program.");
  const longPrograms = minutes ? null : body.longPrograms === undefined ? (before.longPrograms ?? null) : body.longPrograms;
  if (longPrograms && (longPrograms.everyMs < 10 * MIN_MS || longPrograms.everyMs > 60 * MIN_MS)) throw new RuleError("Breaks inside long programs come every 10 to 60 minutes.");
  if (longPrograms && longPrograms.overMs <= longPrograms.everyMs) throw new RuleError("A long program is longer than how often it breaks, and 24 hours at most.");
  return { everyMinutes, everyPrograms, clockMinutes, longPrograms };
}

/** A break as the rule lays it out, before what airs in it is decided. */
interface Slot {
  b: DbBreak;
  afterProgram: boolean;
  /** The program after it (for up next). */
  next: DbLogEntry | null;
  keeps: boolean;
}

const t = (s: string) => Date.parse(s);
const iso = (n: number) => new Date(n).toISOString();
const hasSpots = (b: DbBreak) => b.fills.some((f) => f.kind === "spot" || (f.kind === "sponsor" && !!f.spotId));

/**
 * Which of a run of breaks (in order) a cadence airs in: every break; after a program; the first
 * after a program, then every Nth; the first in each hour; never.
 */
function airing(slots: Slot[], c: BreakCadence | undefined): Set<Slot> {
  const every = c?.every ?? "break";
  if (every === "break") return new Set(slots);
  if (every === "never") return new Set();
  const after = slots.filter((s) => s.afterProgram);
  if (every === "program") return new Set(after);
  if (every === "n_programs") return new Set(after.filter((_, i) => i % (c?.n ?? 2) === 0));
  const hours = new Set<number>();
  return new Set(
    slots.filter((s) => {
      const h = Math.floor(t(s.b.startsAt) / HOUR);
      if (hours.has(h)) return false;
      hours.add(h);
      return true;
    })
  );
}

/** A247: the first clock time after `at` (minutes past the station's hour). */
function nextClock(at: number, minutes: readonly number[]): number {
  // The top of the station's hour `at` is in: its minutes past the hour, in the station's time.
  const past = Number(new Intl.DateTimeFormat("en-US", { timeZone: STATION_TZ, minute: "numeric" }).format(at));
  const top = at - (at % MIN) - past * MIN;
  for (let h = top; ; h += HOUR) {
    const found = minutes.map((m) => h + m * MIN).find((x) => x > at);
    if (found !== undefined) return found;
  }
}

/** A247: the programs whose break comes after every N, counted from `from`: again each broadcast day (6:00 am) and after off air; live isn't counted. */
function programRuns(stationId: string, from: number, to: number, n: number): Set<string> {
  const day = (ms: number) => new Date(ms - 6 * HOUR).toLocaleDateString("en-CA", { timeZone: STATION_TZ });
  const out = new Set<string>();
  let count = 0;
  let last: string | null = null;
  for (const e of stationLog(stationId, iso(from), iso(to))) {
    if (e.kind === "off_air") count = 0;
    if (e.kind !== "program") continue;
    if (last !== null && last !== day(t(e.startsAt))) count = 0;
    last = day(t(e.startsAt));
    if (++count % n === 0) out.add(e.id);
  }
  return out;
}

/** The breaks the rule lays out from `from` to `to`: stored ones (cued live, kept, or still the rule's) and new ones where the rule wants them. */
function layOut(stationId: string, rule: BreakRule, from: number, to: number, now: number): Slot[] {
  const entries = stationLog(stationId, iso(from - 6 * HOUR), iso(to + 6 * HOUR));
  const stored = stationBreaks(stationId, iso(from), iso(to));
  const items = new Map(getDb().library.items.map((i) => [i.id, i]));
  // What up next names: the next thing on the log, unless it's off air.
  const nextAfter = (at: number) => {
    const next = entries.find((e) => t(e.startsAt) >= at);
    return next && next.kind !== "off_air" ? next : null;
  };
  const out: Slot[] = [];
  const keeps = (b: DbBreak) => hasSpots(b) || t(b.startsAt) < now + KEEP_AHEAD_MS;
  // Stored: kept as they are, cued live (the booth's), or the rule's (unless the rule has none).
  for (const b of stored) {
    if (!keeps(b) && b.origin !== "cued_live" && rule.mode === "none") continue;
    out.push({ b, afterProgram: b.context.startsWith("After"), next: nextAfter(t(b.startsAt) + b.lengthMs), keeps: keeps(b) });
  }
  // A247: clock times, inside long programs (not with every N minutes) and after every N programs.
  const clock = rule.mode === "every_n_minutes" && rule.clockMinutes?.length ? rule.clockMinutes : null;
  const long = rule.longPrograms && !(rule.mode === "every_n_minutes" && !clock) ? rule.longPrograms : null;
  const nth = rule.mode === "after_every_program" && rule.everyPrograms ? programRuns(stationId, from - 30 * HOUR, to, rule.everyPrograms) : null;
  if (rule.mode !== "none" || long) {
    const taken = (s: number, e: number) => stored.some((b) => t(b.startsAt) < e && s < t(b.startsAt) + b.lengthMs);
    let lastEnd = -Infinity;
    const add = (startsAt: number, lengthMs: number, context: string, afterProgram: boolean, entry: DbLogEntry) => {
      lastEnd = Math.max(lastEnd, startsAt + lengthMs);
      if (startsAt < from || startsAt >= to || lengthMs < 4_000 || taken(startsAt, startsAt + lengthMs)) return;
      const b: DbBreak = { id: crypto.randomUUID(), stationId, startsAt: iso(startsAt), lengthMs, context, origin: entry.carriageAgreementId ? "carried_barter" : "rule", producerShareMs: 0, fills: [] };
      out.push({ b, afterProgram, next: nextAfter(startsAt + lengthMs), keeps: false });
    };
    for (const b of stored) lastEnd = Math.max(lastEnd, t(b.startsAt) < from ? t(b.startsAt) + b.lengthMs : -Infinity);
    for (const [i, e] of entries.entries()) {
      if (e.kind !== "program") continue;
      const title = `${e.title}${e.episodeTitle?.startsWith("ep.") ? `, ${e.episodeTitle}` : ""}`;
      const s = t(e.startsAt);
      const end = t(e.endsAt);
      const itemMs = e.itemId ? (items.get(e.itemId)?.durationMs ?? null) : null;
      // Inside the program, every N minutes.
      if (rule.mode === "every_n_minutes" && rule.everyMinutes && !clock) for (let at = s + rule.everyMinutes * MIN; at < end - 2 * MIN; at += rule.everyMinutes * MIN) add(at, rule.lengthMs, `During ${title}`, false, e);
      // A247: at the clock's times, and every so often in a long program, while they fit.
      const programEnd = s + (itemMs ?? end - s);
      const longHere = long && programEnd - s > long.overMs ? long : null;
      if (clock || longHere) {
        let room = itemMs ? end - s - itemMs : Infinity;
        let placed = s;
        let at = s;
        for (;;) {
          const c = clock ? nextClock(at, clock) : Infinity;
          const next = Math.min(c, longHere ? placed + longHere.everyMs : Infinity);
          if (!(next > at) || next >= programEnd || programEnd - next < 5 * MIN) break;
          at = next;
          if (next - s < 5 * MIN || next - lastEnd < 5 * MIN) continue;
          if (room < rule.lengthMs) break;
          add(next, rule.lengthMs, `During ${title}`, false, e);
          room -= rule.lengthMs;
          placed = next;
        }
      }
      // After every N programs: only after every Nth.
      if (nth && !nth.has(e.id)) continue;
      // After it: the time its item leaves of its slot, else the gap before the next program.
      const next = entries[i + 1];
      if (itemMs && itemMs < end - s - 4_000) add(s + itemMs, end - s - itemMs, `After ${title}`, true, e);
      else if (next && t(next.startsAt) > end && t(next.startsAt) - end < 5 * MIN) add(end, t(next.startsAt) - end, `After ${title}`, true, e);
    }
  }
  return out.sort((a, z) => a.b.startsAt.localeCompare(z.b.startsAt));
}

/** The roles a position airs, with S20's Up next taken out or put back by its own cadence. */
function positionRoles(rule: BreakRule, position: "open" | "close" | "between", airs: boolean, upNextHere: boolean | null): BumperRole[] {
  const seq = rule.bumperSequences ?? defaultSequences(rule.cadence?.bumpers);
  const roles = airs ? seq[position].roles : [];
  if (upNextHere === null) return roles;
  const rest = roles.filter((r) => r !== "up_next");
  if (!upNextHere) return rest;
  const order = seq[position].roles;
  const i = order.indexOf("up_next");
  const j = i < 0 ? -1 : rest.findIndex((r) => order.slice(i + 1).includes(r));
  return j < 0 ? [...rest, "up_next"] : [...rest.slice(0, j), "up_next", ...rest.slice(j)];
}

/** What a break holds by the rule: the maker's barter and spots placed stay; the station's parts as their cadences say. */
function fillsFor(stationId: string, slot: Slot, rule: BreakRule, parts: { stationId: boolean; underwriting: boolean; spots: boolean; open: boolean; close: boolean; between: boolean }, upNext: { home: "open" | "close" | "between"; airs: boolean } | null): DbBreak {
  const lib = getDb().library.items.filter((i) => i.stationId === stationId && i.status === "ready" && i.rights);
  const fill = (kind: DbFill["kind"], it: { id: string | null; title: string; durationMs: number | null }, o: Partial<DbFill> = {}): DbFill => ({ id: crypto.randomUUID(), kind, title: it.title, lengthMs: it.durationMs ?? 0, itemId: it.id, ...o });
  const bumpers = lib.filter((i) => i.code === "BMP");
  const pool = (role: BumperRole) => {
    const own = bumpers.filter((b) => (b.bumperRole ?? "any") === role);
    return own.length || role === "up_next" ? own : bumpers.filter((b) => (b.bumperRole ?? "any") === "any");
  };
  const used = new Set<string>();
  let upNextAired = false;
  const sequence = (position: "open" | "close" | "between", airs: boolean): DbFill[] => {
    const roles = positionRoles(rule, position, airs, upNext ? upNext.home === position && upNext.airs : null);
    return roles.flatMap((role) => {
      if (role === "up_next" && (upNextAired || !slot.next)) return [];
      const list = pool(role);
      const it = list.find((b) => !used.has(b.id)) ?? list[0];
      if (!it) return [];
      used.add(it.id);
      if (role === "up_next") upNextAired = true;
      const announces = role === "up_next" && slot.next ? { title: slot.next.title, startsAt: slot.next.startsAt } : null;
      return [fill("bumper", it, { element: { position, role, announces }, note: announces ? `Up next: ${announces.title}` : null })];
    });
  };
  const b = slot.b;
  const producer = b.fills.filter((f) => f.kind === "producer");
  const placed = b.fills.filter((f) => f.kind === "spot" || f.kind === "sponsor");
  const credit = lib.find((i) => i.code === "UND");
  // The station ID (not an opener or closer, A242), else the generated one.
  const sid = lib.find((i) => i.code === "SID" && !i.identCode) ?? { id: null, title: GENERATED_SID_TITLE, durationMs: GENERATED_SID_MS };
  const fills = [
    ...sequence("open", parts.open),
    ...producer,
    ...placed,
    ...(parts.underwriting && credit ? [fill("underwriting", { ...credit, durationMs: CREDIT_MS })] : []),
    ...sequence("close", parts.close),
    ...(parts.stationId ? [fill("station_id", sid)] : []),
    // Between programs: after a break that closes a program, before the next.
    ...(slot.afterProgram && slot.next ? sequence("between", parts.between) : [])
  ];
  return { ...b, fills, ...(parts.spots ? { noSpots: undefined } : { noSpots: true }) };
}

/** Every break the rule lays out from `from` to `to`, with what it holds (kept breaks as they are). */
export function ruleBreaks(stationId: string, rule: BreakRule, from: string, to: string, now: number): Array<{ b: DbBreak; keeps: boolean }> {
  // Decided in order from an hour back, so any window decides the same.
  const start = Math.min(t(from), now - HOUR);
  const slots = layOut(stationId, rule, start, Math.max(t(to), now + APPLY_AHEAD_MS), now);
  const seq = rule.bumperSequences ?? defaultSequences(rule.cadence?.bumpers);
  const c = rule.cadence;
  const on = {
    stationId: airing(slots, c?.stationId),
    underwriting: airing(slots, c?.underwriting),
    spots: airing(slots, c?.spots),
    open: airing(slots, seq.open),
    close: airing(slots, seq.close),
    between: airing(slots, seq.between.every === "break" ? { every: "program" } : seq.between)
  };
  // S20: Up next by its own cadence, where its role sits (else between programs).
  const own = c?.upNext ?? null;
  const home = (["open", "close", "between"] as const).find((p) => seq[p].roles.includes("up_next")) ?? "between";
  const upNextOn = own ? airing(slots, own.every === "break" && home === "between" ? { every: "program" } : own) : null;
  return slots
    .filter((s) => s.b.startsAt >= from && s.b.startsAt < to)
    .map((s) => {
      if (s.keeps) return { b: s.b, keeps: true };
      const parts = { stationId: on.stationId.has(s), underwriting: on.underwriting.has(s), spots: on.spots.has(s), open: on.open.has(s), close: on.close.has(s), between: on.between.has(s) };
      return { b: fillsFor(stationId, s, rule, parts, upNextOn ? { home, airs: upNextOn.has(s) } : null), keeps: false };
    });
}

/** The log's view of a break (as `getLog` answers it). */
export function slotOf(b: DbBreak): BreakSlot {
  return { ...breakSlot(b), rows: rowsOfBreak(b) };
}

/** `previewBreakRule`: the window's entries and breaks with the rule as it would be saved. Writes nothing. */
export function previewOf(stationId: string, rule: BreakRule, from: string, to: string, now: number): { entries: LogEntry[]; breaks: Array<BreakSlot & { keeps: boolean }> } {
  return {
    entries: stationLog(stationId, from, to),
    breaks: ruleBreaks(stationId, rule, from, to, now).map(({ b, keeps }) => ({ ...slotOf(b), keeps }))
  };
}

/** Saving the rule: breaks not yet filled (from 20 minutes ahead) take it, as the API's next read of the log would. */
export function applyRule(stationId: string, rule: BreakRule, now: number) {
  const db = getDb();
  const from = iso(now + KEEP_AHEAD_MS);
  const to = iso(now + APPLY_AHEAD_MS);
  const next = ruleBreaks(stationId, rule, from, to, now);
  const kept = new Set(next.map((n) => n.b.id));
  // Breaks in the span the rule no longer has (and that keep nothing) go.
  db.breaks = db.breaks.filter((b) => b.stationId !== stationId || b.startsAt < from || b.startsAt >= to || kept.has(b.id) || hasSpots(b) || b.origin === "cued_live");
  for (const { b } of next) {
    const at = db.breaks.findIndex((x) => x.id === b.id);
    if (at >= 0) db.breaks[at] = b;
    else db.breaks.push(b);
  }
}
