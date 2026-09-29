// How the Station area's pages write days, dates and short counts: "Now", "Today, 4:10 pm",
// "Last Saturday", "Invited Thursday", "Expires in 4 days", "Dead air in 40 min". Calendar days
// are counted in the station's time zone.

import { clock, duration } from "@opencast/ui";

type T = string | number | Date;
const ms = (t: T) => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t));
const DAY = 86_400_000;

/** The calendar day in a zone, as a day number, so two moments can be compared by date. */
export function dayNumber(t: T, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(ms(t)));
  const get = (k: string) => Number(p.find((x) => x.type === k)?.value);
  return Math.round(Date.UTC(get("year"), get("month") - 1, get("day")) / DAY);
}

/** Calendar days from `now` to `t`: 0 today, -1 yesterday, 2 the day after tomorrow. */
export function daysFrom(t: T, now: T, timeZone: string): number {
  return dayNumber(t, timeZone) - dayNumber(now, timeZone);
}

export function weekday(t: T, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(new Date(ms(t)));
}

/** "October 5". */
export function longDate(t: T, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "long", day: "numeric" }).format(new Date(ms(t)));
}

/** "Aug 19". */
export function shortDate(t: T, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(new Date(ms(t)));
}

/** A day, as the team and rights pages say it: "Today", "Yesterday", "Thursday", "Last Saturday", "August 19". */
export function dayWord(t: T, now: T, timeZone: string): string {
  const d = daysFrom(t, now, timeZone);
  if (d === 0) return "Today";
  if (d === -1) return "Yesterday";
  if (d === 1) return "Tomorrow";
  if (d < 0 && d >= -6) return weekday(t, timeZone);
  if (d < 0 && d >= -13) return `Last ${weekday(t, timeZone)}`;
  if (d > 1 && d <= 6) return weekday(t, timeZone);
  return longDate(t, timeZone);
}

/** When someone was last in master control (station-settings 03.1): "Now", "Today, 4:10 pm", "Last Saturday". */
export function lastIn(t: T | null, now: T, timeZone: string): string {
  if (t === null) return "Not yet";
  if (ms(now) - ms(t) < 5 * 60_000) return "Now";
  const d = daysFrom(t, now, timeZone);
  if (d === 0 || d === -1) return `${dayWord(t, now, timeZone)}, ${clock(ms(t), { timeZone })}`;
  return dayWord(t, now, timeZone);
}

/** "Invited Thursday, not accepted yet". */
export function invitedLine(createdAt: T, now: T, timeZone: string): string {
  const w = dayWord(createdAt, now, timeZone);
  return `Invited ${w === "Today" || w === "Yesterday" ? w.toLowerCase() : w}, not accepted yet`;
}

/** "Expires in 4 days", "Expires tomorrow", "Expires today", "Expired". Whole days, rounded down. */
export function expiresIn(expiresAt: T, now: T): string {
  const left = ms(expiresAt) - ms(now);
  if (left <= 0) return "Expired";
  const days = Math.floor(left / DAY);
  if (days >= 2) return `Expires in ${days} days`;
  if (days === 1) return "Expires tomorrow";
  return "Expires today";
}

/** Minutes until dead air, when it's close enough to say in the switcher (an hour or less); otherwise null. */
export function deadAirMinutes(deadAirAt: T | null, now: T, within = 60): number | null {
  if (deadAirAt === null) return null;
  const min = Math.ceil((ms(deadAirAt) - ms(now)) / 60_000);
  return min > 0 && min <= within ? min : null;
}

/** "12:40 to 31:05", the claimed part of an item. */
export function rangeText(startMs: number | null, endMs: number | null): string | null {
  if (startMs === null || endMs === null) return null;
  const at = (x: number) => (x < 60_000 ? `0${duration(x)}` : duration(x));
  return `${at(startMs)} to ${at(endMs)}`;
}

/** An airing, as the claim lists it: "Monday, 8:00 pm", "Today, 3:12 pm". */
export function airingWhen(t: T, now: T, timeZone: string): string {
  const d = daysFrom(t, now, timeZone);
  const day = d === 0 || d === -1 || d === 1 ? dayWord(t, now, timeZone) : d > 1 && d <= 6 ? weekday(t, timeZone) : longDate(t, timeZone);
  return `${day}, ${clock(ms(t), { timeZone })}`;
}

/** A business's everyday name, as the claim's heading and timeline use it: "Westside Tapes" for "Westside Tapes LLC". */
export function shortName(name: string): string {
  return name.replace(/,?\s+(LLC|L\.L\.C\.|Inc\.?|Ltd\.?|Co\.|Corp\.?|Limited)$/i, "").trim();
}

/** "0x5ee2…a41d". */
export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** "3 an hour", "Once an hour", "2 an hour". */
export function perHour(n: number): string {
  return n === 1 ? "Once an hour" : `${n} an hour`;
}

/** "No more than twice an hour". */
export function noMoreThan(n: number): string {
  const times = n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;
  return `No more than ${times} an hour`;
}

/** A market's name from its slug, when nothing better is at hand: "inland-empire" is "Inland Empire". */
export function marketName(slug: string | null, known?: { slug: string; name: string } | null): string {
  if (!slug) return "";
  if (known && known.slug === slug) return known.name;
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
