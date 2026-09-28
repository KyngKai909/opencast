// The rules behind You's lines: which day a reminder says, what a pledge row says, the monthly
// total, when a TV was last used. Kept apart from the components so they can be tested.

import { money } from "@opencast/ui";
import type { StationIdent } from "@opencast/contracts";

/** Year, month and day in a time zone, as a day number (days since 1970 in that zone). */
function dayNumber(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Math.round(Date.UTC(get("year"), get("month") - 1, get("day")) / 86400e3);
}

function hourIn(d: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(d));
}

function weekday(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(d);
}

/** "September 26". */
export function dateLabel(d: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "long", day: "numeric" }).format(new Date(d));
}

/** "June". */
export function monthLabel(d: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "long" }).format(new Date(d));
}

/**
 * The day a reminder is on, as You's reminders say it: "Tonight" (today from 5 pm), "Today",
 * "Tomorrow", the weekday within the week ("Monday"), then the date ("October 3").
 */
export function dayLabel(at: Date | string, now: Date, timeZone: string): string {
  const d = new Date(at);
  const diff = dayNumber(d, timeZone) - dayNumber(now, timeZone);
  if (diff === 0) return hourIn(d, timeZone) >= 17 ? "Tonight" : "Today";
  if (diff === 1) return "Tomorrow";
  if (diff > 1 && diff < 7) return weekday(d, timeZone);
  return dateLabel(d, timeZone);
}

/** When a TV was last used, after "Last used": "tonight", "today", "yesterday", "Tuesday", "September 3". */
export function lastUsedLabel(at: Date | string, now: Date, timeZone: string): string {
  const d = new Date(at);
  const diff = dayNumber(now, timeZone) - dayNumber(d, timeZone);
  if (diff <= 0) return hourIn(d, timeZone) >= 17 ? "tonight" : "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return weekday(d, timeZone);
  return dateLabel(d, timeZone);
}

export interface PledgeLike {
  cadence: "monthly" | "once";
  amountMicros: number;
  endsAfter: string | null;
  creditOnAir: boolean;
  startedAt: string;
}

/** Whether a monthly pledge will be charged again (not stopped). */
export function isActiveMonthly(p: PledgeLike): boolean {
  return p.cadence === "monthly" && !p.endsAfter;
}

/** The Supporting header's total: every monthly pledge that will be charged again. */
export function monthlyTotal(pledges: ReadonlyArray<PledgeLike>): number {
  return pledges.filter(isActiveMonthly).reduce((sum, p) => sum + p.amountMicros, 0);
}

/** The line under a pledge's station name on You (web). */
export function pledgeLine(p: PledgeLike, displayName: string | null, timeZone: string): string {
  if (p.cadence === "once") return dateLabel(p.startedAt, timeZone);
  if (p.endsAfter) return `Ends after ${monthLabel(`${p.endsAfter}T12:00:00Z`, timeZone)}`;
  if (p.creditOnAir && displayName) return `Credited on air as ${displayName}`;
  return `Since ${monthLabel(p.startedAt, timeZone)}`;
}

/** "$10.00" and "a month" or "once". */
export function pledgeAmount(p: Pick<PledgeLike, "cadence" | "amountMicros">): { amount: string; per: string } {
  return { amount: money(p.amountMicros), per: p.cadence === "monthly" ? "a month" : "once" };
}

/** "BEAT 12.1", the way a station is named in a line. */
export function identText(s: Pick<StationIdent, "callSign" | "channel" | "name">): string {
  return [s.callSign, s.channel].filter(Boolean).join(" ") || s.name;
}

/** "12 channels are open on the Inland Empire TV band, and 30 on the radio band." */
export function openChannelsLine(market: string, tv: number, radio: number): string {
  const n = (count: number) => (count === 1 ? "1 channel is" : `${count} channels are`);
  return `${n(tv)} open on the ${market} TV band, and ${radio} on the radio band. Setting up takes about 20 minutes.`;
}
