// A243 (2026-10-02): bumper roles and when an item airs, in master control's words. A bumper's role
// (Any, Into a break, Out of a break, Up next; none reads as Any), and its window: dates (broadcast
// days, 6:00 am to 6:00 am) and a time of day in the market's time zone, either or both. The same
// rule as the API's (sequence.ts `eligible`), for "Not airing now: from Dec 1" and the Breaks
// settings' counts.

import type { AirWindow, BumperRole, LibraryItem } from "@opencast/contracts";
import { clock } from "@opencast/ui";
import { STATION_TZ } from "../../../lib/clock";

export const BUMPER_ROLES: BumperRole[] = ["any", "into_break", "out_of_break", "up_next"];

/** A role as the library says it. */
export const ROLE_WORDS: Record<BumperRole, string> = { any: "Any", into_break: "Into a break", out_of_break: "Out of a break", up_next: "Up next" };

/** The line under each role's choice. */
export const ROLE_HELP: Record<BumperRole, string> = {
  any: "A brand sting. Airs wherever a bumper is wanted.",
  into_break: "We'll be right back.",
  out_of_break: "Now back to…",
  up_next: "We draw the next program's title over it, from your log. Leave room in the lower third."
};

/** On the radio band no title is drawn. */
export const RADIO_UP_NEXT = "On the radio band, choose up next sounds that make sense without a title.";

/** A bumper's role (none reads as Any). */
export const roleOf = (i: Pick<LibraryItem, "code" | "bumperRole">): BumperRole => (i.bumperRole ?? "any") as BumperRole;

const month = (date: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${date}T00:00:00Z`));
/** "6:00 pm" from "18:00". */
export const wallClock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return clock(new Date(Date.UTC(2026, 0, 1, h, m)), { timeZone: "UTC" });
};

/** "Dec 1 to Dec 31, 6:00 pm to 2:00 am"; "From Dec 1"; "Any time". */
export function airsSummary(w: AirWindow | null | undefined): string {
  if (!w || (!w.from && !w.until && !w.dailyFrom)) return "Any time";
  const dates = w.from && w.until ? `${month(w.from)} to ${month(w.until)}` : w.from ? `From ${month(w.from)}` : w.until ? `Until ${month(w.until)}` : null;
  const times = w.dailyFrom && w.dailyUntil ? `${wallClock(w.dailyFrom)} to ${wallClock(w.dailyUntil)}` : null;
  const text = [dates, times].filter(Boolean).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function parts(at: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Whether an item may air at `at`: its broadcast date in its dates, the wall clock in its time of day. */
export function inWindow(w: AirWindow | null | undefined, at: Date, tz = STATION_TZ): boolean {
  if (!w) return true;
  const { date, minute } = parts(at, tz);
  const broadcast = minute < 360 ? dayBefore(date) : date;
  if (w.from && broadcast < w.from) return false;
  if (w.until && broadcast > w.until) return false;
  if (w.dailyFrom && w.dailyUntil) {
    const [a, b] = [w.dailyFrom, w.dailyUntil].map((x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5)));
    if (a < b ? minute < a || minute >= b : minute < a && minute >= b) return false;
  }
  return true;
}

/** "Not airing now: from Dec 1" (or "from 6:00 pm"); null while it can air. */
export function notAiringLine(w: AirWindow | null | undefined, at: Date, tz = STATION_TZ): string | null {
  if (!w || inWindow(w, at, tz)) return null;
  const { date } = parts(at, tz);
  if (w.from && date < w.from) return `Not airing now: from ${month(w.from)}`;
  if (w.until && date > w.until) return `Not airing now: ended ${month(w.until)}`;
  if (w.dailyFrom) return `Not airing now: from ${wallClock(w.dailyFrom)}`;
  return "Not airing now";
}

/** Where a role's bumpers come from: its own, then Any (into and out of a break). Up next never falls back. */
export const chainOf = (role: BumperRole): BumperRole[] => (role === "into_break" || role === "out_of_break" ? [role, "any"] : [role]);
