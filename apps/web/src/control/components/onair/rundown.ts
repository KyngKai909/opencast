// The Monitor's rundown, to the second (master-control A.7 RD, P.1): programs split around the
// breaks inside them ("Saturday Reel, part 1"), each break's rows in the order they air, planned
// off air (G9: off air hours and sign-offs, with when the station is back), and time with nothing
// on the log. A243: each bumper's note says where it airs ("Into the break", "Between programs",
// "Up next: Saturday Reel, 9:00 pm"); one that didn't fit is listed quieter, with no length.
// Shared with the mock, which answers "what's on now" from it.

import type { BreakRow, BreakSlot, LogCode, LogEntry, OffAirSpan } from "@opencast/contracts";
import { clock } from "@opencast/ui";
import { STATION_TZ } from "../../../lib/clock";

export interface RundownRow {
  id: string;
  /** When it airs. */
  at: string;
  code: LogCode;
  title: string;
  /** The line under the title: "Carried from REEL 24.1", "REEL's break time, barter". */
  source: string | null;
  lengthMs: number;
  /** `off_air`: the off air hours (a sign-off is its own entry, a program row). */
  kind: "program" | "break" | "gap" | "off_air";
  /** The break a row belongs to. */
  breakId?: string;
  /** The log entry a program row belongs to. */
  entryId?: string;
  /** A243: a bumper that didn't fit its break: listed ("Didn't fit: Up next (:08)"), not airing. */
  dropped?: boolean;
}

/** What each code reads as under a break row, when the row has no note of its own. */
export const CODE_SOURCE: Record<LogCode, string> = {
  PGM: "Program",
  SPT: "Spot",
  UND: "Underwriting",
  BMP: "Bumper",
  SID: "Station ID",
  OPEN: "Holds on the station ID slate"
};

/** Shorter than this, time between two things is a break, not dead air. */
export const GAP_MIN_MS = 5 * 60_000;

const t = (s: string) => Date.parse(s);
const iso = (n: number) => new Date(n).toISOString();

/** Where a log entry comes from, in the log's words. */
export function entrySource(e: Pick<LogEntry, "kind" | "carriedFrom" | "itemId" | "localNote">): string {
  if (e.kind === "off_air") return "Off air";
  if (e.carriedFrom) return `Carried from ${[e.carriedFrom.callSign, e.carriedFrom.channel].filter(Boolean).join(" ")}`;
  if (e.kind === "live") return "Live source";
  return "From your library";
}

/** A break's rows. Without break contents (G1), the break is one row of its length. */
export function breakRows(b: BreakSlot): RundownRow[] {
  const start = t(b.startsAt);
  const id = b.id ?? `brk:${b.startsAt}`;
  const rows: BreakRow[] = b.rows ?? [{ code: "OPEN", title: "Break", lengthMs: b.lengthMs, whose: "station", note: b.context }];
  const out: RundownRow[] = [];
  let at = start;
  rows.forEach((r, i) => {
    out.push({ id: `${id}:r${i}`, at: iso(at), code: r.code, title: r.title, source: r.note ?? CODE_SOURCE[r.code], lengthMs: r.lengthMs, kind: "break", breakId: id, ...(r.element && !r.element.fits ? { dropped: true } : {}) });
    at += r.lengthMs;
  });
  const rest = start + b.lengthMs - at;
  if (rest >= 1000) out.push({ id: `${id}:open`, at: iso(at), code: "OPEN", title: "Open", source: CODE_SOURCE.OPEN, lengthMs: rest, kind: "break", breakId: id });
  return out;
}

/** "Back at 6:00 am". */
export function backAtText(backAt: string, tz = STATION_TZ): string {
  return `Back at ${clock(backAt, { timeZone: tz })}`;
}

/** Everything on the log in time order, to the second, with the planned off air (`getLog.offAir`). */
export function buildRundown(entries: LogEntry[], breaks: BreakSlot[], gapMinMs = GAP_MIN_MS, offAir: OffAirSpan[] = []): RundownRow[] {
  const sortedBreaks = [...breaks].sort((a, b) => t(a.startsAt) - t(b.startsAt));
  const rows: RundownRow[] = [];
  const used = new Set<BreakSlot>();
  const signOffBack = (id: string) => offAir.find((o) => o.logEntryId === id)?.backAt;

  for (const e of [...entries].sort((a, b) => t(a.startsAt) - t(b.startsAt))) {
    const s = t(e.startsAt);
    const end = t(e.endsAt);
    const inside = sortedBreaks.filter((b) => t(b.startsAt) > s && t(b.startsAt) < end);
    const title = e.kind === "off_air" ? "Off air" : e.title;
    const back = e.kind === "off_air" ? signOffBack(e.id) : undefined;
    const source = e.kind === "off_air" ? (back ? backAtText(back) : "Viewers see \"Off air\" and when you're back") : entrySource(e);
    if (!inside.length) {
      rows.push({ id: e.id, at: e.startsAt, code: e.code, title, source, lengthMs: end - s, kind: "program", entryId: e.id });
      continue;
    }
    let cursor = s;
    inside.forEach((b, i) => {
      used.add(b);
      rows.push({ id: `${e.id}:p${i + 1}`, at: iso(cursor), code: e.code, title: `${title}, part ${i + 1}`, source, lengthMs: t(b.startsAt) - cursor, kind: "program", entryId: e.id });
      rows.push(...breakRows(b));
      cursor = t(b.startsAt) + b.lengthMs;
    });
    if (end > cursor) rows.push({ id: `${e.id}:p${inside.length + 1}`, at: iso(cursor), code: e.code, title: `${title}, part ${inside.length + 1}`, source, lengthMs: end - cursor, kind: "program", entryId: e.id });
  }
  for (const b of sortedBreaks) if (!used.has(b)) rows.push(...breakRows(b));
  // The off air hours: what the log leaves empty inside them.
  for (const o of offAir) {
    if (o.source !== "hours") continue;
    rows.push({ id: `off:${o.startsAt}`, at: o.startsAt, code: "OPEN", title: "Off air", source: backAtText(o.backAt), lengthMs: t(o.endsAt) - t(o.startsAt), kind: "off_air" });
  }
  rows.sort((a, b) => t(a.at) - t(b.at));

  // Time with nothing in it.
  const out: RundownRow[] = [];
  rows.forEach((r, i) => {
    if (i > 0) {
      const prev = rows[i - 1];
      const prevEnd = t(prev.at) + prev.lengthMs;
      if (t(r.at) - prevEnd >= gapMinMs) out.push(gapRow(prevEnd, t(r.at)));
    }
    out.push(r);
  });
  return out;
}

function gapRow(from: number, to: number): RundownRow {
  return { id: `gap:${iso(from)}`, at: iso(from), code: "OPEN", title: "Nothing scheduled", source: "Repeats from your library if no one fills it", lengthMs: to - from, kind: "gap" };
}

/** The row on air at `now`, or -1 when nothing is. */
export function currentIndex(rows: RundownRow[], now: number): number {
  return rows.findIndex((r) => t(r.at) <= now && now < t(r.at) + r.lengthMs);
}

/** The rows from the one on air (or the next one) on, at most `count`. */
export function rundownFrom(rows: RundownRow[], now: number, count: number): RundownRow[] {
  let i = currentIndex(rows, now);
  if (i < 0) i = rows.findIndex((r) => t(r.at) > now);
  if (i < 0) return [];
  return rows.slice(i, i + count);
}

/** The next thing to air after the row on now. */
export function nextRow(rows: RundownRow[], now: number): RundownRow | null {
  return rows.find((r) => t(r.at) > now) ?? null;
}

/** The next break: its first row and how many rows follow it ("Mission Soda, then 6 more"). */
export function nextBreak(rows: RundownRow[], now: number): { at: string; first: RundownRow; more: number } | null {
  const first = rows.find((r) => r.kind === "break" && !r.dropped && t(r.at) > now && !rows.some((x) => x.breakId === r.breakId && t(x.at) <= now));
  if (!first) return null;
  const all = rows.filter((r) => r.breakId === first.breakId);
  // Name the break by the first thing in it with a picture; open time only holds on the slate.
  const lead = all.find((r) => r.code !== "OPEN" && !r.dropped) ?? first;
  return { at: first.at, first: lead, more: Math.max(0, all.length - 1) };
}

/** "Mission Soda, then 6 more". */
export function breakLine(b: { first: RundownRow; more: number }): string {
  return b.more > 0 ? `${b.first.title}, then ${b.more} more` : b.first.title;
}
