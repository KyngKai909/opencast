// External stations (follow-up Phase 6): a channel whose picture is the source's own stream (an
// official embed, or a stream link played in Opencast's player), with no Opencast playout, spots or
// breaks. It's on while its stream is up, whatever its schedule says; with nothing scheduled it's
// its name, "Live" and the source, never a made-up title. Down 5 minutes, it leaves the dial (the
// player keeps it on Stand by for whoever's watching) and comes back by itself.

import type { DialRowX, StationPageX } from "../../api/ext";

export type External = NonNullable<DialRowX["external"]> & { down: boolean };

/** An external station: the dial's `kind: "listed"`. */
export function isExternalStation(s: { kind: string } | null | undefined): boolean {
  return s?.kind === "listed";
}

/**
 * What's known about an external station: the station page's word (with `down`) first, then the
 * dial row's. Down, too, when the row the player kept says it isn't playable. Null for any other
 * station, or before either has answered.
 */
export function externalOf(
  row: Pick<DialRowX, "station" | "onAir" | "playback" | "external"> | null | undefined,
  page?: Pick<StationPageX, "station" | "external"> | null
): External | null {
  const station = page?.station ?? row?.station;
  if (!isExternalStation(station)) return null;
  const info = page?.external ?? row?.external;
  if (!info) return null;
  const rowDown = !!row && (!row.onAir || !row.playback);
  return { source: info.source, plays: info.plays, schedule: info.schedule, down: !!page?.external?.down || rowDown };
}

/** The station page's line: whose stream it is, and what Opencast doesn't add. */
export function externalStreamLine(e: Pick<External, "source">): string {
  return `${e.source}'s own stream. No Opencast playout, spots or breaks.`;
}

/** The station page's line while its stream is down (5 minutes and more: off the dial). */
export function externalDownLine(e: Pick<External, "source">): string {
  return `${e.source}'s stream is down. It's off the dial until it's back.`;
}

/** Stand by over the picture, for an external station whose stream went down while it was on. */
export function externalStandbyLine(e: Pick<External, "source">): string {
  return `${e.source}'s stream is down. Stand by.`;
}
