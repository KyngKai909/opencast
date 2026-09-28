// Local dates and slots in the station's zone. Carriage speaks in local days and `HH:MM` slots
// (contract `Slot`, `DateOnly`); the log speaks in timestamps.

import type { Slot } from "@opencast/contracts";
import { STATION_TZ } from "../../lib/clock";

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function parts(t: Date | string, timeZone = STATION_TZ) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const get = (type: Intl.DateTimeFormatPartTypes) => f.formatToParts(new Date(t)).find((p) => p.type === type)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day"), weekday: WEEKDAY[get("weekday")] ?? 0, hh: get("hour"), mm: get("minute") };
}

/** "2026-09-26": the local day of a moment. */
export function localDate(t: Date | string, timeZone = STATION_TZ): string {
  const p = parts(t, timeZone);
  return `${p.y}-${p.m}-${p.d}`;
}

/** The weekly slot a moment falls in: Saturday 11:40 pm is `{ weekday: 6, time: "23:40" }`. */
export function localSlot(t: Date | string, timeZone = STATION_TZ): Slot {
  const p = parts(t, timeZone);
  return { weekday: p.weekday, time: `${p.hh}:${p.mm}` };
}

/** A local day plus n days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * A local day and time as a moment. Works out the zone's offset on that day, so it holds across
 * daylight saving.
 */
export function atLocal(date: string, time: string, timeZone = STATION_TZ): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const p = parts(new Date(guess), timeZone);
  const shown = Date.UTC(Number(p.y), Number(p.m) - 1, Number(p.d), Number(p.hh), Number(p.mm));
  return new Date(guess + (guess - shown));
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "September 27" */
export function monthDay(date: string): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Monday, September 28" */
export function dayMonthDay(date: string): string {
  return `${DAY_NAMES[weekdayOf(date)]}, ${monthDay(date)}`;
}

/** "Sun 27", as the week grid heads its days. */
export function shortDay(date: string): string {
  return `${DAY_NAMES[weekdayOf(date)]!.slice(0, 3)} ${Number(date.slice(8))}`;
}

export function dayName(weekday: number): string {
  return DAY_NAMES[weekday]!;
}

/** "August": the month of a moment, in the station's zone. */
export function monthName(t: Date | string, timeZone = STATION_TZ): string {
  return MONTHS[Number(parts(t, timeZone).m) - 1]!;
}

/** "Tomorrow, September 27" / "Today, September 26" / "Monday, September 28". */
export function whenWords(date: string, today: string): string {
  if (date === today) return `Today, ${monthDay(date)}`;
  if (date === addDays(today, 1)) return `Tomorrow, ${monthDay(date)}`;
  return dayMonthDay(date);
}

/** "2 hours ago", "an hour ago", "12 minutes ago", "3 days ago". */
export function agoWords(iso: string, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return mins === 1 ? "a minute ago" : `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "a day ago" : `${days} days ago`;
}
