// Off air hours (G9): a station's standing rule for signing off ("Every night, 2:00 am to 6:00 am",
// in the market's time zone) and one-off sign-off entries on the log, as the API reads them
// (apps/api log/offair.ts): the hours cover what's otherwise empty (a program inside them still
// airs), and each span's `backAt` is the end of the unbroken stretch it's part of. Planned off air
// isn't dead air: the mock's gaps leave it out, and nothing warns about it or fills it.

import type { OffAirSpan } from "@opencast/contracts";
import { clock } from "@opencast/ui";
import { STATION_TZ } from "../../../lib/clock";
import { addDays, localParts, localTime, weekdayOf, type Ymd } from "../../components/onair/time";
import { BEAT, uid } from "./stations";

export interface DbOffAirRule {
  id: string;
  stationId: string;
  /** The weekdays the sign-off falls on, 0 = Sunday. */
  days: number[];
  /** "HH:MM", the market's time. */
  signOffAt: string;
  /** At or before `signOffAt`: the next day. */
  backAt: string;
}

/** BEAT signs off every night from 2:00 to 6:00 am (master-control A3's pane). */
export function seedOffAirRules(): DbOffAirRule[] {
  return [{ id: uid(432001), stationId: BEAT.id, days: [0, 1, 2, 3, 4, 5, 6], signOffAt: "02:00", backAt: "06:00" }];
}

const DAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** "Every night, 2:00 am to 6:00 am", "Weeknights, 11:00 pm to 6:00 am", as the API writes a rule. */
export function ruleLabel(rule: Pick<DbOffAirRule, "days" | "signOffAt" | "backAt">): string {
  const days = [...new Set(rule.days)].sort();
  const key = days.join("");
  const when =
    key === "0123456" ? "Every night" : key === "12345" ? "Weeknights" : key === "1234" ? "Monday to Thursday nights" : key === "06" ? "Weekends" : days.map((d) => DAY_NAMES[d]).join(", ");
  const time = (t: string) => clock(`2000-01-01T${t}:00Z`, { timeZone: "UTC" });
  return `${when}, ${time(rule.signOffAt)} to ${time(rule.backAt)}`;
}

const hm = (t: string) => t.split(":").map(Number) as [number, number];

/** The rules' spans touching `[from, to)`, merged where they overlap. */
export function ruleSpans(rules: Pick<DbOffAirRule, "days" | "signOffAt" | "backAt">[], from: number, to: number, tz = STATION_TZ): Array<{ s: number; e: number }> {
  if (!rules.length) return [];
  const out: Array<{ s: number; e: number }> = [];
  const p = localParts(from - 86_400_000, tz);
  const last = localParts(to, tz);
  const lastKey = `${last.year}-${last.month}-${last.day}`;
  for (let d: Ymd = { year: p.year, month: p.month, day: p.day }, n = 0; n < 400; d = addDays(d, 1), n++) {
    for (const rule of rules) {
      if (!rule.days.includes(weekdayOf(d))) continue;
      const [oh, om] = hm(rule.signOffAt);
      const [bh, bm] = hm(rule.backAt);
      const s = Date.parse(localTime(d, oh, om, tz));
      const e = Date.parse(localTime(rule.backAt <= rule.signOffAt ? addDays(d, 1) : d, bh, bm, tz));
      if (e > s && e > from && s < to) out.push({ s, e });
    }
    if (`${d.year}-${d.month}-${d.day}` === lastKey) break;
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

export interface Occupied {
  id: string;
  kind: "program" | "live" | "off_air";
  startsAt: string;
  endsAt: string;
}

/**
 * Off air in `[from, to)`: the hours less anything on the log, and sign-off entries, each with the
 * end of its stretch. The stretch is read over a wider range, so one that runs past the window
 * still knows when the station is back.
 */
export function offAirSpans(entries: Occupied[], rules: Pick<DbOffAirRule, "days" | "signOffAt" | "backAt">[], from: string, to: string, tz = STATION_TZ): OffAirSpan[] {
  const a = Date.parse(from);
  const z = Date.parse(to);
  const lo = a - 86_400_000;
  const hi = z + 2 * 86_400_000;
  const pieces: Array<{ s: number; e: number; source: "hours" | "sign_off"; logEntryId: string | null }> = [];
  const occupied = entries.map((r) => ({ s: Date.parse(r.startsAt), e: Date.parse(r.endsAt) })).sort((x, y) => x.s - y.s);
  for (const span of ruleSpans(rules, lo, hi, tz)) {
    let cursor = span.s;
    for (const o of occupied) {
      if (o.e <= cursor || o.s >= span.e) continue;
      if (o.s > cursor) pieces.push({ s: cursor, e: o.s, source: "hours", logEntryId: null });
      cursor = Math.max(cursor, o.e);
      if (cursor >= span.e) break;
    }
    if (cursor < span.e) pieces.push({ s: cursor, e: span.e, source: "hours", logEntryId: null });
  }
  for (const r of entries) if (r.kind === "off_air") pieces.push({ s: Date.parse(r.startsAt), e: Date.parse(r.endsAt), source: "sign_off", logEntryId: r.id });
  pieces.sort((x, y) => x.s - y.s);
  const result: OffAirSpan[] = [];
  for (let i = 0; i < pieces.length; ) {
    let j = i;
    let end = pieces[i].e;
    while (j + 1 < pieces.length && pieces[j + 1].s <= end) end = Math.max(end, pieces[++j].e);
    for (let k = i; k <= j; k++) {
      const p = pieces[k];
      result.push({ startsAt: new Date(p.s).toISOString(), endsAt: new Date(p.e).toISOString(), backAt: new Date(end).toISOString(), source: p.source, logEntryId: p.logEntryId });
    }
    i = j + 1;
  }
  return result.filter((x) => Date.parse(x.endsAt) > a && Date.parse(x.startsAt) < z);
}
