// Dates and lengths as the desk's frames write them: "September 22" in sentences, "Sept 24" in the
// pipeline's short lines, "Monday" for the week ahead, "4 hr 10 min" for a pile of works.

import { clock } from "@opencast/ui";

const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parts(ts: string | Date, timeZone: string) {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  const f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "long" }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday: get("weekday") };
}

/** "September 22"; with `short`, "Sept 22" (the pipeline's Next lines and held statuses shorten September only, as drawn). */
export function dayMonth(ts: string | Date, timeZone: string, opts: { short?: boolean } = {}): string {
  const p = parts(ts, timeZone);
  const name = LONG[p.month - 1]!;
  return `${opts.short && name === "September" ? "Sept" : name} ${p.day}`;
}

/** The market's calendar date, `YYYY-MM-DD`. */
export function localDate(ts: string | Date, timeZone: string): string {
  const p = parts(ts, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Whole days from `from`'s date to `to`'s, in the market's calendar. */
export function daysBetween(from: string | Date, to: string | Date, timeZone: string): number {
  const a = Date.parse(`${localDate(from, timeZone)}T00:00:00Z`);
  const b = Date.parse(`${localDate(to, timeZone)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** "Monday" for a day in the week ahead, "today", otherwise "October 5". */
export function dayWord(ts: string | Date, timeZone: string, now: Date): string {
  const d = daysBetween(now, ts, timeZone);
  if (d === 0) return "today";
  if (d > 0 && d < 7) return parts(ts, timeZone).weekday;
  return dayMonth(ts, timeZone);
}

/** "Monday, 6:00 am" (the setup's Signs on). */
export function dayAndTime(ts: string | Date, timeZone: string, now: Date): string {
  const day = dayWord(ts, timeZone, now);
  return `${day === "today" ? "Today" : day}, ${clock(ts, { timeZone })}`;
}

/** "September 27 at 10:15 am". */
export function dateAtTime(ts: string | Date, timeZone: string): string {
  return `${dayMonth(ts, timeZone)} at ${clock(ts, { timeZone })}`;
}

/** A pile of works' length: "4 hr 10 min", "58 min", "31 hr". Rounded to the minute. */
export function hoursMinutes(ms: number): string {
  const total = Math.round(ms / 60_000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h} hr ${m} min`;
  if (h) return `${h} hr`;
  return `${m} min`;
}

/** Hours, rounded: "31 hr" (the setup's "48 videos, 31 hr in total"). */
export function roundHours(ms: number): string {
  return `${Math.round(ms / 3_600_000)} hr`;
}
