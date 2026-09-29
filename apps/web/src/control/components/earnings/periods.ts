// Dates for Audience and Earnings, in the station's time zone: the windows each period asks the
// API for, and the words for them ("September 1 to 26", "Tonight's peak, at 8:36 pm").

import { clock } from "@opencast/ui";

export type AudiencePeriod = "tonight" | "week" | "month";
export type EarningsPeriod = "week" | "month" | "year";

const HOUR = 3_600_000;

export interface Zoned {
  y: number;
  /** 0 to 11. */
  m: number;
  d: number;
  h: number;
  min: number;
  /** 0 Sunday to 6 Saturday. */
  weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A moment's calendar parts in a time zone. */
export function zoned(t: Date | number, timeZone: string): Zoned {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" }).formatToParts(new Date(t));
  const get = (k: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === k)?.value ?? "";
  return { y: Number(get("year")), m: Number(get("month")) - 1, d: Number(get("day")), h: Number(get("hour")) % 24, min: Number(get("minute")), weekday: WEEKDAYS.indexOf(get("weekday")) };
}

/** The moment a wall-clock time happens in a time zone. Days and hours may overflow (d: 32, h: 26). */
export function wallTime(y: number, m: number, d: number, h: number, min: number, timeZone: string): Date {
  const guess = Date.UTC(y, m, d, h, min);
  // The zone's offset at that moment, measured by reading the guess back as wall time.
  const offsetAt = (t: number) => {
    const z = zoned(t, timeZone);
    return Date.UTC(z.y, z.m, z.d, z.h, z.min) - Math.floor(t / 60_000) * 60_000;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}

/** The Monday a week starts on (weeks run Monday to Sunday, as statements do). */
export function weekStart(now: Date, timeZone: string): Date {
  const z = zoned(now, timeZone);
  const back = (z.weekday + 6) % 7;
  return wallTime(z.y, z.m, z.d - back, 0, 0, timeZone);
}

/**
 * The window the Audience page asks for. Tonight runs from 6:00 pm to 11:00 pm, or on to the hour
 * after now when it's later, until 6:00 am (after midnight it's still last night). A week runs
 * from Monday, a month from the 1st, each to now.
 */
export function audienceWindow(period: AudiencePeriod, now: Date, timeZone: string): { from: Date; to: Date } {
  const z = zoned(now, timeZone);
  if (period === "week") return { from: weekStart(now, timeZone), to: now };
  if (period === "month") return { from: wallTime(z.y, z.m, 1, 0, 0, timeZone), to: now };
  const evening = wallTime(z.y, z.m, z.h < 12 ? z.d - 1 : z.d, 18, 0, timeZone);
  const eleven = evening.getTime() + 5 * HOUR;
  const sixAm = evening.getTime() + 12 * HOUR;
  const nextHour = Math.ceil((now.getTime() + 1) / HOUR) * HOUR;
  return { from: evening, to: new Date(Math.min(sixAm, Math.max(eleven, nextHour))) };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthName(now: Date, timeZone: string): string {
  return MONTHS[zoned(now, timeZone).m];
}

/** "September 14" for a date-only value ("2026-09-14"), read as the calendar day it names. */
export function dayOf(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Monday, September 21" for a date-only value. */
export function weekdayOf(date: string, long = true): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const name = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][wd];
  return long ? `${name}, ${MONTHS[m - 1]} ${d}` : name;
}

/** "September 1 to 26", "August 31 to September 5", "January 1 to September 26": an earnings period so far. */
export function earningsRange(period: EarningsPeriod, now: Date, timeZone: string): string {
  const z = zoned(now, timeZone);
  let start: Zoned;
  if (period === "week") start = zoned(weekStart(now, timeZone), timeZone);
  else if (period === "month") start = { ...z, d: 1 };
  else start = { ...z, m: 0, d: 1 };
  if (start.m === z.m && start.d === z.d) return `${MONTHS[z.m]} ${z.d}`;
  if (start.m === z.m) return `${MONTHS[z.m]} ${start.d} to ${z.d}`;
  return `${MONTHS[start.m]} ${start.d} to ${MONTHS[z.m]} ${z.d}`;
}

/** The segmented control's words for each period. */
export function audiencePeriodLabel(period: AudiencePeriod, now: Date, timeZone: string): string {
  return period === "tonight" ? "Tonight" : period === "week" ? "This week" : monthName(now, timeZone);
}

export function earningsPeriodLabel(period: EarningsPeriod, now: Date, timeZone: string): string {
  return period === "week" ? "This week" : period === "month" ? monthName(now, timeZone) : "Year";
}

/** The total row: "September so far", "This week so far", "2026 so far". */
export function earningsTotalLabel(period: EarningsPeriod, now: Date, timeZone: string): string {
  const z = zoned(now, timeZone);
  return `${period === "week" ? "This week" : period === "month" ? MONTHS[z.m] : String(z.y)} so far`;
}

/** The phone's total row and period word: "September", "This week", "2026". */
export function earningsShortLabel(period: EarningsPeriod, now: Date, timeZone: string): string {
  const z = zoned(now, timeZone);
  return period === "week" ? "This week" : period === "month" ? MONTHS[z.m] : String(z.y);
}

/** The peak's caption: "Tonight's peak, at 8:36 pm", "This week's peak, Saturday at 8:36 pm", "September's peak, September 19 at 9:12 pm". */
export function peakCaption(period: AudiencePeriod, at: string | null, now: Date, timeZone: string): string {
  const head = period === "tonight" ? "Tonight's peak" : period === "week" ? "This week's peak" : `${monthName(now, timeZone)}'s peak`;
  if (!at) return head;
  const time = clock(at, { timeZone });
  if (period === "tonight") return `${head}, at ${time}`;
  const z = zoned(new Date(at), timeZone);
  const day = period === "week" ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][z.weekday] : `${MONTHS[z.m]} ${z.d}`;
  return `${head}, ${day} at ${time}`;
}

/** "Hours watched tonight", "Hours watched this week", "Hours watched in September". Radio is listened to. */
export function hoursCaption(period: AudiencePeriod, radio: boolean, now: Date, timeZone: string): string {
  const verb = radio ? "Hours listened" : "Hours watched";
  return period === "tonight" ? `${verb} tonight` : period === "week" ? `${verb} this week` : `${verb} in ${monthName(now, timeZone)}`;
}

/** The comparison line's name: the same night last week ("Last Saturday"). */
export function lastWeekLabel(from: Date, timeZone: string): string {
  const wd = zoned(from, timeZone).weekday;
  return `Last ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][wd]}`;
}

export function isAudiencePeriod(v: string | null): v is AudiencePeriod {
  return v === "tonight" || v === "week" || v === "month";
}

export function isEarningsPeriod(v: string | null): v is EarningsPeriod {
  return v === "week" || v === "month" || v === "year";
}

/** The phone's line under the count: "Tuned in now. Peak tonight 318 at 8:36 pm" (04.1), or with the day for a week or a month. */
export function phoneNowLine(period: AudiencePeriod, peak: { tunedIn: number; at: string } | null, timeZone: string): string {
  if (!peak) return "Tuned in now.";
  const n = peak.tunedIn.toLocaleString("en-US");
  const time = clock(peak.at, { timeZone });
  if (period === "tonight") return `Tuned in now. Peak tonight ${n} at ${time}`;
  const z = zoned(new Date(peak.at), timeZone);
  const day = period === "week" ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][z.weekday] : `${MONTHS[z.m]} ${z.d}`;
  return `Tuned in now. Peak this ${period === "week" ? "week" : "month"} ${n}, ${day} at ${time}`;
}
