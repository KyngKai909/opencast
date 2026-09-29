// How the Results pages say things: periods and their dates, counts, per-customer costs, airing
// times with seconds (and tenths, as the as-run log has them), and the airings CSV. Amounts stay in
// micros; the pages write them with money().

import { clock, duration, money } from "@opencast/ui";
import { MARKET_TZ } from "../../lib/clock";

export type Period = "week" | "month" | "all";

/** "1 airing", "118 airings", "1 customer". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** "Fall menu", "Fall menu and Pumpkin latte", "A, B and C". */
export function andList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];

/** "September" for "2026-09". */
export function monthName(month: string): string {
  return MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
}

/** The market's date of a moment: "2026-09-26". */
export function marketDay(t: string | number | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: MARKET_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}

/** "2026-09" for the market's month now. */
export function monthOf(t: Date): string {
  return marketDay(t).slice(0, 7);
}

/**
 * Dates as the frames write them: "September 1 to 26", "August 1 to September 26"; short on the
 * phone, "Sept 20 to 26". One day reads "September 26".
 */
export function rangeWords(from: string, to: string, short = false): string {
  const names = short ? SHORT : MONTHS;
  const [, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [, tm, td] = to.split("-").map(Number) as [number, number, number];
  const a = `${names[fm - 1]} ${fd}`;
  if (from === to) return a;
  return fm === tm ? `${a} to ${td}` : `${a} to ${names[tm - 1]} ${td}`;
}

/** "September 12", from a market date. */
export function dayWords(date: string, short = false): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${(short ? SHORT : MONTHS)[m - 1]} ${d}`;
}

/** What each part of the day is called. */
export const DAYPART_LABEL: Record<string, string> = { mornings: "Mornings", afternoons: "Afternoons", evenings: "Evenings", late_night: "Late nights" };

/** Cost per customer, or null with no customers (the column shows a dash). */
export function perCustomer(spentMicros: number, customers: number): number | null {
  return customers > 0 ? Math.round(spentMicros / customers) : null;
}

/** "Evenings brought 30 of the 37 customers.": the part of the day most customers came from. */
export function daypartSentence(parts: Array<{ daypart: string; customers: number }>): string | null {
  const total = parts.reduce((s, p) => s + p.customers, 0);
  if (total === 0 || parts.length < 2) return null;
  const top = [...parts].sort((a, b) => b.customers - a.customers)[0]!;
  return `${DAYPART_LABEL[top.daypart] ?? top.daypart} brought ${top.customers} of the ${plural(total, "customer")}.`;
}

/** ":30 of :30", ":12 of :30". */
export function airedWords(airedMs: number, lengthSec: number): string {
  return `${duration(airedMs)} of ${duration(lengthSec * 1000)}`;
}

const weekdayShort = (iso: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: MARKET_TZ }).format(new Date(iso));
const weekdayLong = (iso: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: MARKET_TZ }).format(new Date(iso));
const within6Days = (iso: string, now: Date) => {
  const days = (Date.parse(`${marketDay(now)}T12:00:00Z`) - Date.parse(`${marketDay(iso)}T12:00:00Z`)) / 86_400_000;
  return days >= 0 && days < 7;
};

/** The airings table's time: "Sat 8:28:30 pm" this week, "Sept 12 8:28:30 pm" before. */
export function rowTime(iso: string, now: Date): string {
  const day = within6Days(iso, now) ? weekdayShort(iso) : dayWords(marketDay(iso), true);
  return `${day} ${clock(iso, { timeZone: MARKET_TZ, seconds: true })}`;
}

/** The proof panel's heading: "Saturday, 8:28:30 pm, BEAT", or "September 12, 8:28:30 pm, BEAT". */
export function proofHeading(iso: string, callSign: string, now: Date): string {
  const day = within6Days(iso, now) ? weekdayLong(iso) : dayWords(marketDay(iso));
  return `${day}, ${clock(iso, { timeZone: MARKET_TZ, seconds: true })}, ${callSign}`;
}

/** "8:28:30.0 pm": the as-run log's time, to the tenth of a second. */
export function tenths(iso: string): string {
  const t = clock(iso, { timeZone: MARKET_TZ, seconds: true });
  const tenth = Math.floor((new Date(iso).getUTCMilliseconds() % 1000) / 100);
  return t.replace(/ (am|pm)$/, `.${tenth} $1`);
}

/** One airing's row in the CSV. */
export interface CsvAiring {
  asRunId: string;
  startedAt: string;
  endedAt: string;
  station: { callSign: string | null; channel: string | null };
  spot: { title: string; lengthSec: number };
  programContext: string | null;
  airedMs: number;
  tunedIn: number;
  costMicros: number;
  working: string;
}

/** The airings as a CSV, one per line, with the as-run entry for each. */
export function airingsCsv(list: CsvAiring[]): string {
  const q = (v: string | number) => (typeof v === "number" ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows: Array<Array<string | number>> = [["Aired at", "Ended at", "Station", "Spot", "In", "Aired", "Tuned in", "Cost", "Working", "As-run entry"]];
  for (const a of list) {
    rows.push([
      a.startedAt,
      a.endedAt,
      `${a.station.callSign ?? ""} ${a.station.channel ?? ""}`.trim(),
      a.spot.title,
      a.programContext ?? "",
      airedWords(a.airedMs, a.spot.lengthSec),
      a.tunedIn,
      money(a.costMicros).replace("−", "-"),
      a.working,
      a.asRunId
    ]);
  }
  return rows.map((r) => r.map(q).join(",")).join("\n") + "\n";
}

/** Saves text as a file in the browser (a CSV). */
export function saveText(filename: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "orange-street-coffee". */
export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
