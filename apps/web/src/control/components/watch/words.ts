// Watch data's words (follow-up Phase 1, 2026-09-29): no frame draws them (docs/apps/new-copy.md,
// "Watch data"). The Audience page's rows (a station's own airings) and Offering your programs (a
// maker's programs, every station's airings added up) both use them.

import { clock, sparkPeak } from "@opencast/ui";
import type { AiringWatch, WatchTimeLabel } from "@opencast/contracts";

/** The column's name: TV counts watch time, the radio band listening time. */
export function timeLabelWord(label: WatchTimeLabel): string {
  return label === "listening_time" ? "Listening time" : "Watch time";
}

const trim = (n: number) => n.toFixed(1).replace(/\.0$/, "");

/** "48 min", "1 hour", "20.7 hours", "1,204 hours". */
export function watchTimeText(minutes: number): string {
  if (minutes < 59.5) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 9.95) return trim(hours) === "1" ? "1 hour" : `${trim(hours)} hours`;
  return `${Math.round(hours).toLocaleString("en-US")} hours`;
}

/** The minute most people left in: the first with the most, or null when nobody left. */
export const busiestMinute = sparkPeak;

/**
 * The tune-away line's sentence, its text alternative. One airing: "Most left around 9:24 pm".
 * Airings added up (no one clock time): "Most left 14 minutes in". Nobody: "Nobody left before the end".
 */
export function mostLeftText(tuneAways: number[], o: { startsAt?: string | null; timeZone?: string } = {}): string {
  const at = busiestMinute(tuneAways);
  if (at === null) return "Nobody left before the end";
  if (o.startsAt) return `Most left around ${clock(Date.parse(o.startsAt) + at * 60_000, { timeZone: o.timeZone })}`;
  return at === 1 ? "Most left a minute in" : `Most left ${at} minutes in`;
}

/** "4 said “Not for me”"; nothing at 0. */
export function notForMeText(n: number | null | undefined): string | null {
  return n ? `${n.toLocaleString("en-US")} said “Not for me”` : null;
}

/** A row's words when it has no numbers: "Counting…", "Not enough viewers yet". */
export function watchStateText(w: Pick<AiringWatch, "status" | "note">): string | null {
  if (w.status === "counting") return "Counting…";
  if (w.status === "not_enough_viewers") return w.note ?? "Not enough viewers yet";
  return null;
}

/** The phone's one line: "20.7 hours watched", "3 hours listened", or the state. */
export function watchPhoneText(w: AiringWatch): string | null {
  const state = watchStateText(w);
  if (state) return state;
  if (w.watchMinutes === null) return null;
  return `${watchTimeText(w.watchMinutes)} ${w.timeLabel === "listening_time" ? "listened" : "watched"}`;
}

/** "{n} airings not counted yet": other stations' airings left out of a maker's totals. */
export function notCountedText(airings: number): string | null {
  if (airings <= 0) return null;
  return airings === 1 ? "1 airing not counted yet" : `${airings.toLocaleString("en-US")} airings not counted yet`;
}
