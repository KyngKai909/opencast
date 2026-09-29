// The program page's rules: which primary button it shows, how each "Where to watch" row reads
// and what it offers, and how each episode reads. Pure, so they're tested on their own.

import { clock } from "@opencast/ui";
import type { EpisodeX, WhereToWatch } from "../../api/ext/station";
import { capital, channelValue, dayAndTime, dayWord } from "./when";

export type Primary =
  | { kind: "tune"; row: WhereToWatch }
  | { kind: "remind"; row: WhereToWatch }
  | null;

/**
 * The primary action is what's on: if the program is airing on a station in the market now, the
 * button tunes there (the station you're already tuned to if it's one of them, otherwise the first
 * in channel order). If not, it's Remind me for the next airing. Null when nothing is scheduled.
 */
export function primaryAction(rows: WhereToWatch[], tunedStationId: string | null = null): Primary {
  const onNow = rows.filter((r) => r.now).sort((a, b) => channelValue(a.station.channel) - channelValue(b.station.channel));
  if (onNow.length) return { kind: "tune", row: onNow.find((r) => r.station.id === tunedStationId) ?? onNow[0]! };
  const next = rows.filter((r) => r.next).sort((a, b) => a.next!.startsAt.localeCompare(b.next!.startsAt) || channelValue(a.station.channel) - channelValue(b.station.channel));
  return next.length ? { kind: "remind", row: next[0]! } : null;
}

/** "BEAT 12.1". */
export function stationLabel(s: { callSign: string | null; channel: string | null; name: string }): string {
  return [s.callSign ?? s.name, s.channel].filter(Boolean).join(" ");
}

export function primaryLabel(p: Exclude<Primary, null>): string {
  return p.kind === "tune" ? `Tune in to ${stationLabel(p.row.station)}, on now` : "Remind me";
}

/**
 * A Where to watch row's two lines. The maker's own station reads by its slot ("Saturdays, all
 * day" / "Its own station"); a carrier reads by its airing ("Now, until 9:00 pm" or "Sunday at
 * 9:00 am") over its slot.
 */
export function whereLines(row: WhereToWatch, makerId: string, now: Date, timeZone: string): { title: string; sub: string | null } {
  if (row.station.id === makerId) return { title: row.slot ?? airingWhen(row, now, timeZone) ?? "", sub: "Its own station" };
  return { title: airingWhen(row, now, timeZone) ?? row.slot ?? "", sub: row.slot };
}

function airingWhen(row: WhereToWatch, now: Date, timeZone: string): string | null {
  if (row.now) return `Now, until ${clock(row.now.endsAt, { timeZone })}`;
  if (row.next) {
    const word = dayWord(row.next.startsAt, now, timeZone);
    return /\d/.test(word) ? `${word}, ${clock(row.next.startsAt, { timeZone })}` : `${capital(word)} at ${clock(row.next.startsAt, { timeZone })}`;
  }
  return null;
}

/** What a row offers: the "On now" sign where the primary button already tunes, Tune in, Remind me, or nothing. */
export function whereAction(row: WhereToWatch, primary: Primary): "on-now" | "tune" | "remind" | null {
  if (row.now) return primary?.kind === "tune" && primary.row.station.id === row.station.id ? "on-now" : "tune";
  return row.next ? "remind" : null;
}

export type EpisodeState = "aired" | "now" | "next" | "unscheduled";

export function episodeState(ep: EpisodeX): EpisodeState {
  if (ep.onNow) return "now";
  if (ep.nextAiring) return "next";
  if (ep.aired) return "aired";
  return "unscheduled";
}

/**
 * Its line: "Last aired tonight on REEL, 8:00 pm", "On BEAT now", "Next: SAZN, Sunday 9:00 am",
 * "Not scheduled yet". An episode is watched when a station airs it, so each shows its next airing.
 */
export function episodeLine(ep: EpisodeX, now: Date, timeZone: string): string {
  const cs = (s: { callSign: string | null; name: string }) => s.callSign ?? s.name;
  if (ep.onNow) return `On ${cs(ep.onNow.station)} now`;
  if (ep.nextAiring) return `Next: ${cs(ep.nextAiring.station)}, ${dayAndTime(ep.nextAiring.airing.startsAt, now, timeZone)}`;
  if (ep.aired && ep.lastAiring) return `Last aired ${dayWord(ep.lastAiring.airing.startsAt, now, timeZone)} on ${cs(ep.lastAiring.station)}, ${clock(ep.lastAiring.airing.startsAt, { timeZone })}`;
  if (ep.aired) return "Aired";
  return "Not scheduled yet";
}

/**
 * The episodes shown: the last one aired, the one on now, and what's next, as the frame does
 * (13 to 17 of 40). Every episode when there are few.
 */
export function episodeWindow(episodes: EpisodeX[], size = 5): EpisodeX[] {
  if (episodes.length <= size) return episodes;
  const states = episodes.map(episodeState);
  let firstUpcoming = states.findIndex((s) => s === "now" || s === "next");
  if (firstUpcoming < 0) firstUpcoming = states.findIndex((s) => s === "unscheduled");
  if (firstUpcoming < 0) return episodes.slice(-size);
  const start = Math.max(0, Math.min(firstUpcoming - 1, episodes.length - size));
  return episodes.slice(start, start + size);
}

/** "40 episodes of 30 minutes". */
export function episodesMeta(count: number, lengthMs: number | null | undefined): string | null {
  if (!count) return null;
  const n = `${count} episode${count === 1 ? "" : "s"}`;
  if (!lengthMs) return n;
  const min = Math.round(lengthMs / 60000);
  return `${n} of ${min} minute${min === 1 ? "" : "s"}`;
}

export function carriedByText(n: number): string {
  return `Carried by ${n} station${n === 1 ? "" : "s"}`;
}
