// How the Money area says things: the day on a movement ("Tonight", "Friday", "Sept 1"), which way
// a movement goes, typed dollar amounts, the runway in days, when money on its way arrives and how
// long what's available lasts until then, and a funding source split for its row.

import type { Balance, FundingSource, Movement, Spot } from "@opencast/contracts";
import { money } from "@opencast/ui";

const DAY = 86_400_000;

function parts(d: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hourCycle: "h23", weekday: "long" }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? "";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), hour: Number(get("hour")) % 24, weekday: get("weekday") };
}

/** Whole calendar days from `a` to `b` in the market (positive when b is later). */
export function daysBetween(a: Date, b: Date, timeZone: string): number {
  const pa = parts(a, timeZone);
  const pb = parts(b, timeZone);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / DAY);
}

/** The house's short months: "Sept 1", "Oct 12", "March 3". */
const SHORT_MONTHS = ["Jan", "Feb", "March", "April", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function shortDate(d: Date, timeZone: string): string {
  const p = parts(d, timeZone);
  return `${SHORT_MONTHS[p.m - 1]} ${p.d}`;
}

export function longDate(d: Date, timeZone: string): string {
  const p = parts(d, timeZone);
  return `${LONG_MONTHS[p.m - 1]} ${p.d}`;
}

/** "September": the month the "Spent in …" figure counts. */
export function monthName(d: Date, timeZone: string): string {
  return LONG_MONTHS[parts(d, timeZone).m - 1]!;
}

/**
 * The day on a movement line (biz-funding 03.1): today is "Tonight" from 5:00 pm and "Today"
 * before; the past week by weekday ("Friday"); older by date ("Sept 1"), and those lines leave the
 * time off, as the frame's month-old bank transfer does.
 */
export function movementDay(at: string, now: Date, timeZone: string): { day: string; showTime: boolean } {
  const d = new Date(at);
  const ago = daysBetween(d, now, timeZone);
  if (ago <= 0) return { day: parts(d, timeZone).hour >= 17 ? "Tonight" : "Today", showTime: true };
  if (ago < 7) return { day: parts(d, timeZone).weekday, showTime: true };
  return { day: shortDate(d, timeZone), showTime: false };
}

/** Which way a movement reads: held money in standby, money in with a plus, money out quieter. */
export function movementDirection(m: Pick<Movement, "kind" | "amountMicros">): "hold" | "in" | "out" {
  if (m.kind === "held" || (m.kind === "order" && m.amountMicros > 0)) return "hold";
  return m.amountMicros >= 0 ? "in" : "out";
}

/** "$300.00", "300", "1,250.5" → micros; null when it isn't an amount. */
export function parseDollars(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100) * 10_000;
}

/** Whole days of airings an amount covers at a pace; null with no pace yet. */
export function daysCovered(availableMicros: number, pacePerDayMicros: number): number | null {
  if (pacePerDayMicros <= 0) return null;
  return Math.max(0, Math.floor(availableMicros / pacePerDayMicros));
}

/** "about 12 days", "about 1 day", "less than a day". */
export function aboutDays(days: number): string {
  if (days < 1) return "less than a day";
  return `about ${days} ${days === 1 ? "day" : "days"}`;
}

function partOfDay(hour: number): string {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

/** When a moment falls, as a sentence ends: "Tuesday afternoon", "tomorrow morning", "tonight", "November 9". */
export function momentText(t: Date, now: Date, timeZone: string): string {
  const ahead = daysBetween(now, t, timeZone);
  const p = parts(t, timeZone);
  const part = partOfDay(p.hour);
  if (ahead <= 0) return part === "evening" || part === "night" ? "tonight" : `this ${part}`;
  if (ahead === 1) return part === "night" ? "tomorrow night" : `tomorrow ${part}`;
  if (ahead < 7) return `${p.weekday} ${part}`;
  return longDate(t, timeZone);
}

/** The day money on its way arrives: "Tuesday", "tomorrow", "today", "October 5". */
export function arrivalDay(expectedAt: string, now: Date, timeZone: string): string {
  const t = new Date(expectedAt);
  const ahead = daysBetween(now, t, timeZone);
  if (ahead <= 0) return "today";
  if (ahead === 1) return "tomorrow";
  if (ahead < 7) return parts(t, timeZone).weekday;
  return longDate(t, timeZone);
}

/** How a pending deposit's method reads: "By bank transfer through Clear". */
export function methodText(method: string): string {
  if (method === "clear_bank") return "By bank transfer through Clear";
  if (method === "card") return "By card";
  if (method === "clear_account") return "From your Clear business account";
  return method;
}

/**
 * Whether the spots keep running until money on its way arrives (biz-funding 06.2), and the
 * sentence that says so. With no pace yet, nothing is spending, so they do.
 */
export function untilArrival(balance: Pick<Balance, "availableMicros" | "pacePerDayMicros">, expectedAt: string | null, now: Date, timeZone: string): { keepsRunning: boolean; sentence: string } {
  const pace = balance.pacePerDayMicros;
  if (pace <= 0) return { keepsRunning: true, sentence: "Your spots keep running until then." };
  const lasts = new Date(now.getTime() + (Math.max(0, balance.availableMicros) / pace) * DAY);
  const when = momentText(lasts, now, timeZone);
  const keepsRunning = !expectedAt || lasts.getTime() >= Date.parse(expectedAt);
  return keepsRunning
    ? { keepsRunning, sentence: `Your spots keep running until then. At about ${money(pace)} a day, what's available lasts until ${when}.` }
    : { keepsRunning, sentence: `At about ${money(pace)} a day, what's available lasts until ${when}, before this arrives. Your spots pause then, and resume when it does.` };
}

/** A funding source for its row: "Clear, Chase ending 8810" → "Clear" and "Chase ending 8810". */
export function sourceParts(s: Pick<FundingSource, "label" | "kind">): { name: string; account: string | null } {
  const i = s.label.indexOf(", ");
  if (i < 0) return { name: s.label, account: null };
  return { name: s.label.slice(0, i), account: s.label.slice(i + 2) };
}

/** The fee as a row says it: "no fee", or "$7.55 fee, Stripe's at cost". */
export function feeText(feeMicros: number | undefined): string | null {
  if (feeMicros === undefined) return null;
  return feeMicros > 0 ? `${money(feeMicros)} fee, Stripe's at cost` : "no fee";
}

/** The source a deposit uses by default: the preselected one, else the default, else the first. */
export function pickSource(sources: FundingSource[], preferred?: string | null): FundingSource | null {
  return sources.find((s) => s.id === preferred) ?? sources.find((s) => s.isDefault) ?? sources[0] ?? null;
}

/** The amount to offer first (06.1 "the usual amount"): the last money added, else $250. */
export function usualAmount(movements: Pick<Movement, "kind" | "amountMicros">[] | undefined): number {
  const last = movements?.find((m) => m.kind === "added" && m.amountMicros > 0);
  return last?.amountMicros ?? 250_000_000;
}

/**
 * The Balance subtitle: "Orange Street Coffee. 3 spots listed, in rotation on 3 stations." Spots
 * listed are the ones not ended or still drafts; stations are the most any spot is in rotation on,
 * paused until midnight included (the API gives each spot a count, not which stations: P5).
 */
export function spotsLine(name: string, spots: Pick<Spot, "state" | "inRotationOn">[] | undefined): string {
  if (!spots) return `${name}.`;
  const listed = spots.filter((s) => s.state !== "ended" && s.state !== "draft");
  if (!listed.length) return `${name}. No spots listed yet.`;
  const on = Math.max(0, ...listed.filter((s) => s.state === "in_rotation" || s.state === "paused_daily_cap").map((s) => s.inRotationOn));
  const spotsWord = `${listed.length} ${listed.length === 1 ? "spot" : "spots"} listed`;
  return on > 0 ? `${name}. ${spotsWord}, in rotation on ${on} ${on === 1 ? "station" : "stations"}.` : `${name}. ${spotsWord}.`;
}

/** "Held for 41 airings stations have scheduled". */
export function heldCaption(airings: number): string {
  if (airings <= 0) return "Nothing held for scheduled airings";
  return `Held for ${airings} ${airings === 1 ? "airing" : "airings"} stations have scheduled`;
}

/** "Spent in September, on 118 airings". */
export function spentCaption(month: string, airings: number): string {
  return airings > 0 ? `Spent in ${month}, on ${airings} ${airings === 1 ? "airing" : "airings"}` : `Spent in ${month}`;
}

/** "At 3 days and 1 day of airings left". */
export function warnText(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => b - a);
  if (!sorted.length) return "Off";
  const said = sorted.map((d) => `${d} ${d === 1 ? "day" : "days"}`);
  const list = said.length > 1 ? `${said.slice(0, -1).join(", ")} and ${said.at(-1)}` : said[0];
  return `At ${list} of airings left`;
}

/** Auto top-up's line: "Off", or what it does. */
export function autoTopUpText(auto: { on: boolean; amountMicros: number | null; belowDays: number } | undefined): string {
  if (!auto?.on) return "Off";
  const amount = auto.amountMicros ? money(auto.amountMicros, { trimCents: true }) : "money";
  return `Add ${amount} whenever what's available drops below ${auto.belowDays} ${auto.belowDays === 1 ? "day" : "days"} of airings`;
}
