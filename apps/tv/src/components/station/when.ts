// Days and times in words, in the market's zone, for the station page, the program page and
// search: "Sunday", "October 3", "tonight"; and the week's day tabs. Clock times themselves always
// come from clock() in @opencast/ui.

import { clock, type TimeInput } from "@opencast/ui";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** A broadcast day runs from 6:00 am to 6:00 am: a 12:30 am program belongs to the night before. */
export const BROADCAST_DAY_STARTS_HOUR = 6;

function ms(v: TimeInput): number {
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

/** The local calendar date, "2026-09-26". */
export function dayKey(t: TimeInput, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms(t)));
  const get = (k: string) => parts.find((p) => p.type === k)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The broadcast day a time falls in (its date, shifted back by six hours). */
export function broadcastDayKey(t: TimeInput, timeZone: string): string {
  return dayKey(ms(t) - BROADCAST_DAY_STARTS_HOUR * 3600e3, timeZone);
}

function keyToUtc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

export function addDays(key: string, n: number): string {
  return new Date(keyToUtc(key) + n * 86400e3).toISOString().slice(0, 10);
}

/** 0 for Sunday. */
export function weekdayOf(key: string): number {
  return new Date(keyToUtc(key)).getUTCDay();
}

function daysBetween(a: string, b: string): number {
  return Math.round((keyToUtc(b) - keyToUtc(a)) / 86400e3);
}

export interface DayTab {
  /** The broadcast day: "2026-09-27". */
  value: string;
  /** "Sun". */
  label: string;
  /** "Sunday, September 27", for screen readers. */
  long: string;
  today: boolean;
}

/**
 * The week's tabs, Sun to Sat, each the next time that day comes round, today included: on a
 * Saturday, Sat is today and Sun is tomorrow. A schedule, not an archive, so no day is in the past.
 */
export function weekTabs(now: TimeInput, timeZone: string): DayTab[] {
  const today = broadcastDayKey(now, timeZone);
  const wd = weekdayOf(today);
  return WEEKDAYS.map((name, i) => {
    const key = addDays(today, (i - wd + 7) % 7);
    const [, m, d] = key.split("-").map(Number);
    return { value: key, label: name.slice(0, 3), long: `${name}, ${MONTHS[m! - 1]} ${d}`, today: key === today };
  });
}

/** Airings that belong to a broadcast day, in time order. */
export function onDay<T extends { startsAt: string }>(airings: T[], key: string, timeZone: string): T[] {
  return airings.filter((a) => broadcastDayKey(a.startsAt, timeZone) === key).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * The day in words, from now: "tonight" or "today" for later today, the weekday for the next six
 * days ("Sunday" for tomorrow, as the frames write it), then the date ("October 3").
 */
export function dayWord(t: TimeInput, now: TimeInput, timeZone: string): string {
  const a = dayKey(now, timeZone);
  const b = dayKey(t, timeZone);
  const n = daysBetween(a, b);
  if (n === 0) {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date(ms(t))));
    return hour >= 17 ? "tonight" : "today";
  }
  if (n > 0 && n < 7) return WEEKDAYS[weekdayOf(b)]!;
  const [, m, d] = b.split("-").map(Number);
  return `${MONTHS[m! - 1]} ${d}`;
}

export function capital(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** "Sunday 9:00 am", "tonight 10:00 pm", "October 3, 8:00 pm": a date gets a comma, a day word doesn't. */
export function dayAndTime(t: TimeInput, now: TimeInput, timeZone: string): string {
  const word = dayWord(t, now, timeZone);
  return /\d/.test(word) ? `${word}, ${clock(t, { timeZone })}` : `${word} ${clock(t, { timeZone })}`;
}

/** A clock time next to another: "9:00" when it shares am/pm with `after`, "6:00 am" when it doesn't. */
export function clockAfter(t: TimeInput, after: TimeInput, timeZone: string): string {
  const period = (v: TimeInput) => clock(v, { timeZone }).slice(-2);
  return clock(t, { timeZone, suffix: period(t) !== period(after) });
}

/** "September 2026". */
export function monthYear(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${MONTHS[m! - 1]} ${y}`;
}

/** Channel order: 7.1 before 12.1 before 88.4. */
export function channelValue(channel: string | null | undefined): number {
  if (!channel) return Number.MAX_SAFE_INTEGER;
  const [a, b] = channel.split(".").map(Number);
  return (a ?? 0) * 100 + (b ?? 0);
}
