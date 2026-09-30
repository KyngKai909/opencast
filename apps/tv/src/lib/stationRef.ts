// Shared call signs (A229): one brand's streams on one channel's subchannels can share a call sign,
// as real TV does (15.1 RIVC, 15.2 RIVC, 15.3 RIVC). The channel tells them apart, so an address
// can't be the call sign alone: X.1 keeps "rivc", a family member is "rivc-15-2" (the ident's
// `slug`). These are the TV's own copies of @opencast/domain's stationSlugOf, parseStationSlug and
// callSignLabel (the TV app doesn't depend on the domain package), for idents from any API: an
// older one sends no `slug` or `sharesCallSign`, and every address that worked keeps working.

import type { StationIdent } from "@opencast/contracts";

/** What naming or finding a station needs from its ident. */
export type RefIdent = Pick<StationIdent, "id" | "callSign" | "handle"> & Partial<Pick<StationIdent, "channel" | "slug" | "sharesCallSign" | "band">>;

/** A family member's address from its call sign and channel: "rivc-15-2". */
function familySlug(callSign: string, channel: string): string {
  return `${callSign.toLowerCase()}-${channel.replace(".", "-")}`;
}

/**
 * How a station is named in addresses (the About and Pledge routes, the pledge QR): its slug
 * ("rivc", "rivc-15-2"); from an API without slugs, a family member's call sign and channel, else
 * its handle, else its call sign in lower case, else its id.
 */
export function stationAddress(s: RefIdent): string {
  if (s.slug) return s.slug;
  if (s.sharesCallSign && s.callSign && s.channel && !s.channel.endsWith(".1")) return familySlug(s.callSign, s.channel);
  return s.handle || s.callSign?.toLowerCase() || s.id;
}

/**
 * An address's station part: a call sign ("rivc", "RIVC"), or a call sign with its channel
 * ("rivc-15-2"; "beat-12-1" names a station that shares nothing too). Null for anything else.
 */
export function parseStationSlug(ref: string): { callSign: string; channel: string | null } | null {
  const m = /^([a-z]{3,5})(?:-(\d{1,2})-([1-9]))?$/i.exec(ref.trim());
  if (!m) return null;
  return { callSign: m[1]!.toUpperCase(), channel: m[2] ? `${Number(m[2])}.${m[3]}` : null };
}

/**
 * The station a ref names, from a list: by id, by slug, by call sign and channel ("rivc-15-2"), by
 * call sign (any case; a shared one is X.1's, the station whose slug is the call sign), or by
 * handle. Null when none is on the list (a caller may then ask the API, which also knows call
 * signs a station has changed from).
 */
export function findByRef<T>(items: readonly T[], ref: string, identOf: (t: T) => RefIdent): T | null {
  const raw = ref.trim();
  if (!raw) return null;
  const r = raw.toLowerCase();
  const all = items.map((t) => ({ t, s: identOf(t) }));
  const hit = (x: { t: T } | undefined) => (x ? x.t : null);

  const byId = all.find((x) => x.s.id === raw);
  if (byId) return byId.t;
  const bySlug = all.find((x) => x.s.slug?.toLowerCase() === r);
  if (bySlug) return bySlug.t;

  const parsed = parseStationSlug(raw);
  if (parsed?.channel) {
    const found = all.find((x) => x.s.callSign === parsed.callSign && x.s.channel === parsed.channel && x.s.band !== "radio");
    if (found) return found.t;
  }

  const same = all.filter((x) => x.s.callSign?.toLowerCase() === r);
  if (same.length) {
    // The bare call sign is the family's X.1 (or the one station that has it). With slugs, X.1's is
    // the call sign and was found above; without them, the one on X.1, else one that doesn't share it.
    if (same.length === 1) return same[0]!.t;
    return hit(same.find((x) => !!x.s.channel?.endsWith(".1")) ?? same.find((x) => !x.s.sharesCallSign) ?? same[0]);
  }
  return hit(all.find((x) => x.s.handle?.toLowerCase() === r));
}

/**
 * How a station is named where only its call sign would show ("Tune to BEAT now"): the call sign,
 * with its channel when the call sign is shared ("RIVC 15.2"), so a family's streams are told apart.
 * Its name when it has no call sign.
 */
export function callSignLabel(s: Pick<StationIdent, "callSign" | "name"> & Partial<Pick<StationIdent, "channel" | "sharesCallSign">>): string {
  if (!s.callSign) return s.name;
  return s.sharesCallSign && s.channel ? `${s.callSign} ${s.channel}` : s.callSign;
}

/**
 * Whether a ref names this station, judged on its ident alone (a switch in an address, a list of
 * call signs): its id, slug, call sign and channel, handle, or its call sign when that isn't shared
 * or the station is the family's X.1 ("BEAT" names 12.1, never 12.2).
 */
export function refersTo(ref: string, s: RefIdent): boolean {
  const raw = ref.trim();
  if (!raw) return false;
  const r = raw.toLowerCase();
  if (s.id === raw || s.slug?.toLowerCase() === r || s.handle?.toLowerCase() === r) return true;
  const parsed = parseStationSlug(raw);
  if (!parsed || parsed.callSign !== s.callSign) return false;
  if (parsed.channel) return parsed.channel === s.channel && s.band !== "radio";
  return !s.sharesCallSign || !!s.channel?.endsWith(".1");
}
