// The Analytics page's spans and numbers (A251, Ref. 12d). Every span is compared with one of the
// same length: "7 days" (the 7 days to yesterday) with the 7 before, "Today" with the same weekday
// last week to the same minute. Days are the market's (Pacific).

export type SpanKey = "today" | "7d" | "30d" | "90d" | "custom";

export const SPANS: ReadonlyArray<{ key: SpanKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "custom", label: "Custom" }
];

export const TZ = "America/Los_Angeles";
const DAY = 86_400_000;

/** "2026-10-06": the Pacific date of an instant. */
export function dateOf(at: Date, timeZone = TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);
}

/** Midnight in the market at the start of a date ("2026-10-06"), as an instant. */
export function midnight(date: string, timeZone = TZ): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  const offsetAt = (t: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t));
    const get = (k: string) => Number(p.find((x) => x.type === k)!.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - t;
  };
  return new Date(guess - offsetAt(guess - offsetAt(guess)));
}

/** The date `n` days after (before, negative) a date. */
export function addDays(date: string, n: number): string {
  return dateOf(new Date(midnight(date).getTime() + n * DAY + 12 * 3_600_000));
}

export interface Span {
  key: SpanKey;
  from: Date;
  to: Date;
  /** Where the span compared against starts (it's as long as this one). */
  previousFrom: Date;
  /** "Sept 29 to Oct 5, vs Sept 22 to 28". */
  label: string;
}

/** "Sept 29", the reference's month words. */
export function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"][m - 1]!;
  void y;
  return `${month} ${d}`;
}

/** "Sept 29 to Oct 5" (or "Oct 1 to 5" within a month). */
export function rangeText(first: string, last: string): string {
  if (first === last) return shortDate(first);
  const [fm, lm] = [first.slice(0, 7), last.slice(0, 7)];
  return fm === lm ? `${shortDate(first)} to ${Number(last.slice(8))}` : `${shortDate(first)} to ${shortDate(last)}`;
}

/** The span a key stands for, at `now`. Custom takes its dates (first and last, inclusive). */
export function spanFor(key: SpanKey, now: Date, custom?: { first: string; last: string }): Span {
  const today = dateOf(now);
  if (key === "today") {
    const from = midnight(today);
    const weekAgo = addDays(today, -7);
    return { key, from, to: now, previousFrom: midnight(weekAgo), label: `Today to ${clockText(now)}, vs ${weekdayOf(weekAgo)} ${shortDate(weekAgo)}` };
  }
  let first: string;
  let last: string;
  if (key === "custom" && custom && custom.first <= custom.last) [first, last] = [custom.first, custom.last];
  else {
    const n = key === "30d" ? 30 : key === "90d" ? 90 : 7;
    last = addDays(today, -1);
    first = addDays(today, -n);
  }
  const from = midnight(first);
  const to = midnight(addDays(last, 1));
  const days = Math.round((to.getTime() - from.getTime()) / DAY);
  const prevFirst = addDays(first, -days);
  const prevLast = addDays(first, -1);
  return { key: key === "custom" && !custom ? "7d" : key, from, to, previousFrom: midnight(prevFirst), label: `${rangeText(first, last)}, vs ${rangeText(prevFirst, prevLast)}` };
}

function weekdayOf(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long" }).format(new Date(midnight(date).getTime() + 12 * 3_600_000));
}

/** "8:24 pm". */
export function clockText(at: Date, timeZone = TZ): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(at).replace(" AM", " am").replace(" PM", " pm");
}

/** A change against the span before: "↑ 14%", "↓ 6%", "Flat" (under half a percent), or null with nothing to compare. */
export function change(value: number | null, previous: number | null): { dir: "up" | "dn" | "fl"; text: string; pct: number } | null {
  if (value == null || previous == null) return null;
  if (previous === 0) return value === 0 ? { dir: "fl", text: "Flat", pct: 0 } : null;
  const pct = ((value - previous) / previous) * 100;
  if (Math.abs(pct) < 0.5) return { dir: "fl", text: "Flat", pct: 0 };
  const n = Math.abs(pct) >= 10 ? Math.round(Math.abs(pct)) : Math.round(Math.abs(pct) * 10) / 10;
  return { dir: pct > 0 ? "up" : "dn", text: `${pct > 0 ? "↑" : "↓"} ${n}%`, pct };
}

/** "76,783", "457", "4.5": whole numbers grouped, small ones to a tenth. */
export function num(n: number | null | undefined, opts: { tenths?: boolean } = {}): string {
  if (n == null) return "—";
  // Asked for tenths (a rate): always one place, "5.0". Otherwise small numbers get one if they have it.
  if (opts.tenths) return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(n);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.abs(n) < 10 ? 1 : 0, minimumFractionDigits: 0 }).format(n);
}

/** "9 min", "1 h 20 min". */
export function minutesText(n: number | null | undefined): string {
  if (n == null) return "—";
  const m = Math.round(n);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** A CSV file's text: a header row and rows, quoted where needed (the same columns and filters as the page). */
export function csv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

/** Downloads a CSV file. */
export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The surfaces' names and colours, in the reference's order. */
export const PLATFORMS: Record<string, { label: string; colour: string }> = {
  phone: { label: "Phone", colour: "var(--c1)" },
  web: { label: "Web", colour: "var(--c2)" },
  tv_app: { label: "TV app", colour: "var(--c3)" },
  cast: { label: "Cast", colour: "var(--c4)" },
  mirror: { label: "iPhone mirror", colour: "var(--c5)" }
};
