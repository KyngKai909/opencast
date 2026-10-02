// Planned off air time (added 2026-09-29). A station's off air hours are a standing rule ("every
// night 2:00 to 6:00 am", in its market's time zone, possibly across midnight); a sign-off entry
// on the log is a one-off. Both are off air, not dead air: never warned about, never filled.
// Anything on the log inside the hours (a program, a live block) still airs: the hours cover what
// is otherwise empty. Pure functions; the log service loads the rules and entries.

import { addDays, clockTime, localDate, zonedTime } from "../../lib/time.js";

export interface OffAirRuleRow {
  days: number[];
  /** "HH:MM" or "HH:MM:SS" (Postgres `time`). */
  signOffAt: string;
  backAt: string;
}

export interface Occupied {
  id: string;
  kind: "program" | "live" | "off_air";
  startsAt: Date;
  endsAt: Date;
}

export interface OffAirSpanView {
  startsAt: string;
  endsAt: string;
  /** The end of the off air time this span is part of (a sign-off running into the hours is back when they end). */
  backAt: string;
  source: "hours" | "sign_off";
  logEntryId: string | null;
}

export const hhmm = (t: string) => t.slice(0, 5);

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The rules' spans (merged where they overlap) that touch `[from, to)`. */
export function ruleSpans(rules: OffAirRuleRow[], tz: string, from: Date, to: Date): Array<{ s: number; e: number }> {
  if (!rules.length) return [];
  const out: Array<{ s: number; e: number }> = [];
  // The day before, for a sign-off that runs past midnight into the window.
  const last = localDate(to, tz);
  for (let d = addDays(localDate(from, tz), -1); d <= last; d = addDays(d, 1)) {
    const weekday = weekdayOf(d);
    for (const rule of rules) {
      if (!rule.days.includes(weekday)) continue;
      const off = hhmm(rule.signOffAt);
      const back = hhmm(rule.backAt);
      const s = zonedTime(d, off, tz).getTime();
      const e = zonedTime(back <= off ? addDays(d, 1) : d, back, tz).getTime();
      if (e > s && e > from.getTime() && s < to.getTime()) out.push({ s, e });
    }
  }
  out.sort((a, b) => a.s - b.s);
  const merged: Array<{ s: number; e: number }> = [];
  for (const span of out) {
    const prev = merged[merged.length - 1];
    if (prev && span.s <= prev.e) prev.e = Math.max(prev.e, span.e);
    else merged.push({ ...span });
  }
  return merged;
}

/**
 * Off air spans in `[from, to)`: the rules' hours less anything on the log, and sign-off entries.
 * `backAt` runs to the end of each unbroken stretch of off air time. Callers pass a range wider
 * than they show, so a stretch that runs past the window still knows when it ends.
 */
export function offAirSpans(rows: Occupied[], rules: OffAirRuleRow[], tz: string, from: Date, to: Date): OffAirSpanView[] {
  const pieces: Array<{ s: number; e: number; source: "hours" | "sign_off"; logEntryId: string | null }> = [];
  const occupied = rows.map((r) => ({ s: r.startsAt.getTime(), e: r.endsAt.getTime() })).sort((a, b) => a.s - b.s);
  for (const span of ruleSpans(rules, tz, from, to)) {
    let cursor = span.s;
    for (const o of occupied) {
      if (o.e <= cursor || o.s >= span.e) continue;
      if (o.s > cursor) pieces.push({ s: cursor, e: o.s, source: "hours", logEntryId: null });
      cursor = Math.max(cursor, o.e);
      if (cursor >= span.e) break;
    }
    if (cursor < span.e) pieces.push({ s: cursor, e: span.e, source: "hours", logEntryId: null });
  }
  for (const r of rows) {
    if (r.kind === "off_air") pieces.push({ s: r.startsAt.getTime(), e: r.endsAt.getTime(), source: "sign_off", logEntryId: r.id });
  }
  pieces.sort((a, b) => a.s - b.s);
  const result: OffAirSpanView[] = [];
  for (let i = 0; i < pieces.length; ) {
    let j = i;
    let end = pieces[i].e;
    while (j + 1 < pieces.length && pieces[j + 1].s <= end) {
      j++;
      end = Math.max(end, pieces[j].e);
    }
    for (let k = i; k <= j; k++) {
      const p = pieces[k];
      result.push({ startsAt: new Date(p.s).toISOString(), endsAt: new Date(p.e).toISOString(), backAt: new Date(end).toISOString(), source: p.source, logEntryId: p.logEntryId });
    }
    i = j + 1;
  }
  return result;
}

/** Unbroken stretches of off air time: one per `backAt`, from the first span's start. */
export function offAirStretches(spans: OffAirSpanView[]): Array<{ startsAt: string; backAt: string; logEntryId: string | null }> {
  const byBack = new Map<string, { startsAt: string; backAt: string; logEntryId: string | null }>();
  for (const span of [...spans].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const known = byBack.get(span.backAt);
    if (!known) byBack.set(span.backAt, { startsAt: span.startsAt, backAt: span.backAt, logEntryId: span.logEntryId });
    else if (!known.logEntryId && span.logEntryId) known.logEntryId = span.logEntryId;
  }
  return [...byBack.values()];
}

const DAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** "Every night, 2:00 am to 6:00 am", "Weeknights, 11:00 pm to 6:00 am", "Saturdays, 1:00 am to 7:00 am". */
export function ruleLabel(rule: OffAirRuleRow): string {
  const days = [...new Set(rule.days)].sort();
  const key = days.join("");
  const when =
    key === "0123456"
      ? "Every night"
      : key === "12345"
        ? "Weeknights"
        : key === "1234"
          ? "Monday to Thursday nights"
          : key === "06"
            ? "Weekends"
            : days.map((d) => DAY_NAMES[d]).join(", ");
  const time = (t: string) => clockTime(new Date(`2000-01-01T${hhmm(t)}:00Z`), "UTC");
  return `${when}, ${time(rule.signOffAt)} to ${time(rule.backAt)}`;
}
