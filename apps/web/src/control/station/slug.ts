// A station's part of master control's addresses (`/control/beat/monitor`), and how a station is
// named where only its call sign would show. Stations on one channel's subchannels can share a call
// sign (A229): 12.1 BEAT Inland Beat and 12.2 BEAT Beat Tapes. X.1 keeps `/control/beat`, 12.2 is
// `/control/beat-12-2`, and where only "BEAT" would show, a family member reads "BEAT 12.2".
//
// The parsing and the label mirror @opencast/domain's parseStationSlug and callSignLabel (the API
// uses those); apps/web doesn't depend on the domain package, so they're repeated here.

import type { StationIdent } from "@opencast/contracts";
import { controlPath } from "../../areas";

/** What an address needs to know about a station. `slug` and `sharesCallSign` are absent from an older API. */
export type StationRefParts = Pick<StationIdent, "id" | "callSign" | "handle"> & Partial<Pick<StationIdent, "channel" | "slug" | "sharesCallSign">>;

/** The route's segment for a station: its slug ("beat", "beat-12-2"), else its call sign, a studio's handle or its id, in lower case. */
export function controlSlug(s: StationRefParts): string {
  return s.slug ?? (s.callSign ?? s.handle ?? s.id).toLowerCase();
}

/** A path under a station in master control: stationPath(beatTapes, "/monitor") is "/control/beat-12-2/monitor". */
export function stationPath(s: StationRefParts, rest = ""): string {
  return controlPath(`/${controlSlug(s)}${rest}`);
}

/** An address's station part: "beat", or a call sign with its channel ("beat-12-2"). Null for anything else. */
export function parseStationSlug(ref: string): { callSign: string; tenths: number | null } | null {
  const m = /^([a-z]{3,5})(?:-(\d{1,2})-([1-9]))?$/i.exec(ref.trim());
  if (!m) return null;
  return { callSign: m[1]!.toUpperCase(), tenths: m[2] ? Number(m[2]) * 10 + Number(m[3]) : null };
}

/** A TV channel's tenths ("12.2" is 122); null for anything else. */
function tenthsOf(channel: string | null | undefined): number | null {
  const m = channel ? /^(\d{1,2})\.([1-9])$/.exec(channel) : null;
  return m ? Number(m[1]) * 10 + Number(m[2]) : null;
}

/** On X.1, or not sharing: the station a bare call sign names. */
function namedByCallSign(s: StationRefParts): boolean {
  if (!s.sharesCallSign) return true;
  const t = tenthsOf(s.channel);
  return t === null || t % 10 === 1;
}

/**
 * The station an address names, from a list: by slug first, then the older forms, so every link
 * that worked keeps working. A bare call sign is the station on X.1 (or the one that shares
 * nothing), "beat-12-1" names the call sign on that channel, then a handle, then an id.
 */
export function findByStationRef<T>(list: readonly T[], ref: string, identOf: (t: T) => StationRefParts): T | undefined {
  const r = ref.trim().toLowerCase();
  if (!r) return undefined;
  const pick = (f: (s: StationRefParts) => boolean) => list.find((t) => f(identOf(t)));
  const parsed = parseStationSlug(r);
  return (
    pick((s) => controlSlug(s) === r) ??
    pick((s) => s.callSign?.toLowerCase() === r && namedByCallSign(s)) ??
    (parsed?.tenths != null ? pick((s) => s.callSign?.toUpperCase() === parsed.callSign && tenthsOf(s.channel) === parsed.tenths) : undefined) ??
    pick((s) => s.handle?.toLowerCase() === r) ??
    pick((s) => s.id.toLowerCase() === r)
  );
}

/**
 * How a station is named where only its call sign would show: the call sign, with the channel
 * when it shares it ("BEAT 12.2"), so a family's stations are told apart. A station without a
 * call sign (a studio, one being set up) by its name.
 */
export function stationLabel(s: { callSign: string | null; channel?: string | null; sharesCallSign?: boolean; name?: string }): string {
  if (!s.callSign) return s.name ?? "";
  return s.sharesCallSign && s.channel ? `${s.callSign} ${s.channel}` : s.callSign;
}
