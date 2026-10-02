// The guide's rules: its three-hour windows (Earlier and Later, never more than 24 hours from
// now, the most the API gives in one call), the heading for the day on screen, the grid's rows,
// and which button a listing leads with.

import { createElement, Fragment } from "react";
import { LiveText, type GuideProgram, type GuideStation } from "@opencast/ui";
import type { AiringX, GuideX } from "../../api/ext";
import { BackAt } from "../watch/lines";
import { isOffAir, zoned } from "../watch/logic";

const HOUR = 3600e3;
/** Earlier and Later move by this much; the web shows this much at once. */
export const GUIDE_STEP_MS = 3 * HOUR;
/** The phone scrolls sideways, so it shows the evening from the hour on. */
export const GUIDE_PHONE_SPAN_MS = 6 * HOUR;
/** How far from now the guide reaches, either way. */
export const GUIDE_REACH_MS = 24 * HOUR;

/** The hour now is in: where the guide opens. */
export function guideBase(now: Date): number {
  return Math.floor(now.getTime() / HOUR) * HOUR;
}

/** The earliest and latest window starts: within 24 hours of now, on the hour. */
export function windowBounds(now: Date, span = GUIDE_STEP_MS): { min: number; max: number } {
  const base = guideBase(now);
  const min = base - GUIDE_REACH_MS;
  const max = Math.floor((now.getTime() + GUIDE_REACH_MS - span) / HOUR) * HOUR;
  return { min, max: Math.max(base, max) };
}

/** The window for a `?from=` value (or none: the hour now is in), snapped to the hour and kept within reach. */
export function guideWindow(now: Date, fromParam: string | null, span = GUIDE_STEP_MS): { from: Date; to: Date } {
  const { min, max } = windowBounds(now, span);
  const asked = fromParam ? Date.parse(fromParam) : NaN;
  const start = Number.isNaN(asked) ? guideBase(now) : Math.floor(asked / HOUR) * HOUR;
  const from = Math.min(max, Math.max(min, start));
  return { from: new Date(from), to: new Date(from + span) };
}

/** The window Earlier or Later moves to, or null at the edge of the guide's reach. */
export function stepWindow(now: Date, from: Date, dir: "earlier" | "later", span = GUIDE_STEP_MS): Date | null {
  const { min, max } = windowBounds(now, span);
  const next = from.getTime() + (dir === "later" ? GUIDE_STEP_MS : -GUIDE_STEP_MS);
  const clamped = Math.min(max, Math.max(min, next));
  return clamped === from.getTime() ? null : new Date(clamped);
}

/** "Tonight", or the day the window is on: Today, Tomorrow, Yesterday. */
export function guideHeading(from: Date, now: Date, timeZone: string): string {
  const a = zoned(from, timeZone);
  const n = zoned(now, timeZone);
  const days = Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(n.y, n.m - 1, n.d)) / (24 * HOUR));
  if (days === 0) return a.h >= 17 ? "Tonight" : "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(from);
}

/** "Saturday, September 26". */
export function guideDate(from: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(from);
}

/** An airing's id in the URL (`?listing=`): its log entry, or a listed stream's own id. */
export function airingKey(a: Pick<AiringX, "logEntryId" | "listedAiringId" | "startsAt">, stationId: string): string {
  return a.logEntryId ?? a.listedAiringId ?? `${stationId}@${a.startsAt}`;
}

/** The shortest gap an external station's row fills with "Live, nothing listed". */
const NOTHING_LISTED_MIN_MS = 15 * 60_000;

/** An external station's airings with its gaps in the window filled: its own stream, nothing listed. */
export function withNothingListed(airings: AiringX[], name: string, from: string, to: string): Array<AiringX | { title: string; startsAt: string; endsAt: string; nothingListed: true }> {
  const out: Array<AiringX | { title: string; startsAt: string; endsAt: string; nothingListed: true }> = [];
  let at = Date.parse(from);
  const gap = (end: number) => {
    if (end - at >= NOTHING_LISTED_MIN_MS) out.push({ title: name, startsAt: new Date(at).toISOString(), endsAt: new Date(end).toISOString(), nothingListed: true });
  };
  for (const a of [...airings].sort((x, y) => x.startsAt.localeCompare(y.startsAt))) {
    gap(Date.parse(a.startsAt));
    out.push(a);
    at = Math.max(at, Date.parse(a.endsAt));
  }
  gap(Date.parse(to));
  return out;
}

/** The guide's rows as the grid draws them, optionally only the given stations (the Presets filter). */
export function gridRows(guide: GuideX | undefined, only?: ReadonlySet<string> | null, timeZone?: string): GuideStation[] {
  return (guide?.rows ?? [])
    .filter((r) => !only || only.has(r.station.id))
    .map((r) => ({
      id: r.station.id,
      channel: r.station.channel ?? "",
      callSign: r.station.callSign ?? r.station.handle ?? "",
      external: r.station.kind === "listed",
      // A229: a shared call sign's streams carry their own names too.
      ...(r.station.sharesCallSign ? { name: r.station.name } : {}),
      // An external station is on between what its source lists (follow-up Phase 6): its name,
      // "Live, nothing listed", never a made-up title.
      programs: (r.station.kind === "listed" && guide ? withNothingListed(r.airings, r.station.name, guide.from, guide.to) : r.airings).map((a): GuideProgram => {
        if ("nothingListed" in a) return { id: `${r.station.id}@live@${a.startsAt}`, title: a.title, start: a.startsAt, end: a.endsAt, listed: true, detail: createElement(Fragment, null, createElement(LiveText), ", nothing listed") };
        const id = airingKey(a, r.station.id);
        // Planned off air (G9): one block from sign-off to sign-on, "Off air, Signs on at 6:00 am".
        if (isOffAir(a)) return { id, title: a.title, start: a.startsAt, end: a.endsAt, detail: createElement(BackAt, { at: a.backAt ?? a.endsAt, timeZone }) };
        return { id, title: a.title, start: a.startsAt, end: a.endsAt, live: a.live, listed: a.kind === "listed", carriedFrom: a.carriedFrom?.callSign ?? undefined };
      })
    }));
}

/** Finds a listing's airing and station in the guide. */
export function findListing(guide: GuideX | undefined, key: string | null) {
  if (!guide || !key) return null;
  for (const r of guide.rows) {
    const a = r.airings.find((x) => airingKey(x, r.station.id) === key);
    if (a) return { airing: a, station: r.station };
  }
  return null;
}

export type ListingWhen = "later" | "on" | "over";

export interface ListingActions {
  when: ListingWhen;
  /** The button in signal: Remind me for anything not yet on, Tune in for what's on now. */
  primary: "remind" | "tune" | null;
  /** Remind me is offered only for what hasn't started. */
  remind: boolean;
  /** "Switch me over at 9:00" belongs to a reminder. */
  switchMeOver: boolean;
}

export function listingActions(a: Pick<AiringX, "startsAt" | "endsAt">, now: Date): ListingActions {
  const t = now.getTime();
  if (Date.parse(a.endsAt) <= t) return { when: "over", primary: null, remind: false, switchMeOver: false };
  if (Date.parse(a.startsAt) <= t) return { when: "on", primary: "tune", remind: false, switchMeOver: false };
  return { when: "later", primary: "remind", remind: true, switchMeOver: true };
}
