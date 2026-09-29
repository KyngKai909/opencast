// Times on the log, in the station's zone: which day a moment belongs to (a broadcast day runs
// 6:00 am to 6:00 am), the windows the log's views draw, and the ways the frames write times
// ("11:40 pm to 2:00 am", "6:00 pm Sunday", "Sun 8:42 pm"). Every clock string comes from
// @opencast/ui's clock(); this only chooses the form.

import { clock, type TimeInput } from "@opencast/ui";
import { STATION_TZ } from "../../../lib/clock";

export interface Ymd {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
}

export interface LocalParts extends Ymd {
  /** 0 is Sunday. */
  weekday: number;
  hour: number;
  minute: number;
  second: number;
}

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DAY_WORDS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const HOUR = 3_600_000;
/** The broadcast day starts at 6:00 am. */
const DAY_STARTS = 6;

function ms(t: TimeInput): number {
  return t instanceof Date ? t.getTime() : new Date(t).getTime();
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });
    formatters.set(tz, f);
  }
  return f;
}

/** The wall clock in the station's zone. */
export function localParts(t: TimeInput, tz = STATION_TZ): LocalParts {
  const parts = formatter(tz).formatToParts(new Date(ms(t)));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "0";
  const wd = DAY_SHORT.indexOf(get("weekday") as (typeof DAY_SHORT)[number]);
  return { year: +get("year"), month: +get("month"), day: +get("day"), weekday: wd < 0 ? 0 : wd, hour: +get("hour") % 24, minute: +get("minute"), second: +get("second") };
}

function offsetAt(utc: number, tz: string): number {
  const p = localParts(utc, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utc / 1000) * 1000;
}

/** A local wall-clock time as an instant (hours past 23 run into the next day: 26 is 2:00 am). */
export function localTime(d: Ymd, hour: number, minute = 0, tz = STATION_TZ): string {
  const guess = Date.UTC(d.year, d.month - 1, d.day, hour, minute);
  let t = guess - offsetAt(guess, tz);
  const again = guess - offsetAt(t, tz);
  if (again !== t) t = again;
  return new Date(t).toISOString();
}

export function addDays(d: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export function weekdayOf(d: Ymd): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

/** "2026-09-26". */
export function isoDate(d: Ymd): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** The broadcast day a moment belongs to: 2:00 am Sunday is still Saturday night. */
export function broadcastDay(t: TimeInput, tz = STATION_TZ): Ymd {
  const p = localParts(ms(t) - DAY_STARTS * HOUR, tz);
  return { year: p.year, month: p.month, day: p.day };
}

/** Monday to Sunday of the week a day is in. */
export function weekOf(d: Ymd): Ymd[] {
  const monday = addDays(d, -((weekdayOf(d) + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export type LogView = "day" | "evening" | "week";

/** What each view of the log draws: the evening (6 pm to 2 am, as the frame's hours), the whole day, or the week. */
export function viewWindow(view: LogView, d: Ymd, tz = STATION_TZ): { from: string; to: string } {
  if (view === "evening") return { from: localTime(d, 18, 0, tz), to: localTime(d, 26, 0, tz) };
  if (view === "day") return { from: localTime(d, DAY_STARTS, 0, tz), to: localTime(d, 24 + DAY_STARTS, 0, tz) };
  const week = weekOf(d);
  return { from: localTime(week[0], DAY_STARTS, 0, tz), to: localTime(addDays(week[0], 7), DAY_STARTS, 0, tz) };
}

function sameDay(a: Ymd, b: Ymd) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** "11:40 pm", or "6:00 pm Sunday" when it falls on another broadcast day than `from`. */
export function timeOn(t: TimeInput, from: TimeInput, tz = STATION_TZ): string {
  const c = clock(t, { timeZone: tz });
  return sameDay(broadcastDay(t, tz), broadcastDay(from, tz)) ? c : `${c} ${DAY_WORDS[weekdayOf(broadcastDay(t, tz))]}`;
}

/** "11:40 pm to 2:00 am"; "8:45 pm to 8:45 pm Sunday" when the end is another day. */
export function spanText(start: TimeInput, end: TimeInput, tz = STATION_TZ): string {
  return `${clock(start, { timeZone: tz })} to ${timeOn(end, start, tz)}`;
}

/** "Sun 8:42 pm": the Monitor's "Log runs until". */
export function dayClock(t: TimeInput, tz = STATION_TZ): string {
  return `${DAY_SHORT[localParts(t, tz).weekday]} ${clock(t, { timeZone: tz })}`;
}

/** "September 12": a date in words, for "On air since August 12." */
export function monthDay(t: TimeInput, tz = STATION_TZ): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long", day: "numeric" }).format(new Date(ms(t)));
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** "Five", "four": small counts in words, as the sign-on line writes them. */
export function countWord(n: number, capital = false): string {
  const w = WORDS[n] ?? String(n);
  return capital ? w : w.toLowerCase();
}

/** Round a length up to whole minutes: programs are placed in whole minutes. */
export function wholeMinutes(lengthMs: number): number {
  return Math.ceil(lengthMs / 60_000) * 60_000;
}
