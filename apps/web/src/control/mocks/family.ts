// Shared call signs in the mock (A229), as the API answers them: a station on X.n (n ≥ 2) beside
// its owner's own station on X.1, in the same market and major, may share X.1's call sign
// (12.1 BEAT Inland Beat, 12.2 BEAT Beat Tapes). A family member's address carries its channel
// ("beat-12-2"); X.1 keeps "beat". Call signs are fixed after first sign-on: a family's once X.1 is
// on air, and a member can't leave by taking its own after its own first sign-on.
//
// The db keeps who shares with whom (`DbStation.sharesWith`); refreshFamilies() puts the call
// sign, slug and `sharesCallSign` on every ident from it.

import type { StationIdent, StationSetup } from "@opencast/contracts";
import { valueAt } from "../../desk/mocks/settingsDb";
import { dbStation, getDb, type DbStation } from "./db";

/** Rule `numbering.own_subchannels` (the desk's Settings), on unless the desk turns it off. */
export function ownSubchannelsAllowed(): boolean {
  const v = valueAt("numbering.own_subchannels") as { allowed?: boolean } | undefined;
  return v?.allowed !== false;
}

/** The station on X.1 a family member shares its call sign with. */
export function familyHeadOf(st: DbStation): DbStation | undefined {
  return st.sharesWith ? dbStation(st.sharesWith) : undefined;
}

/** The stations sharing X.1's call sign. */
export function familyOf(headId: string): DbStation[] {
  return getDb().stations.filter((s) => s.sharesWith === headId);
}

/** "12.2" is 122; null for a radio frequency or none. */
export function tvTenths(channel: string | null): number | null {
  const m = channel ? /^(\d{1,2})\.([1-9])$/.exec(channel) : null;
  return m ? Number(m[1]) * 10 + Number(m[2]) : null;
}

const channelOf = (tenths: number) => `${Math.floor(tenths / 10)}.${tenths % 10}`;

/** A station's part of an address, as @opencast/domain's stationSlugOf makes it. */
function slugOf(ident: StationIdent, member: boolean): string {
  if (ident.callSign && member && ident.channel) return `${ident.callSign.toLowerCase()}-${ident.channel.replace(".", "-")}`;
  return (ident.callSign ?? ident.handle ?? ident.id).toLowerCase();
}

/** Puts each family's call sign, slug and `sharesCallSign` on its idents, from `sharesWith`. */
export function refreshFamilies(): void {
  const db = getDb();
  for (const st of db.stations) {
    const head = familyHeadOf(st);
    if (st.sharesWith && !head) st.sharesWith = null;
    const member = !!head;
    const hasFamily = db.stations.some((s) => s.sharesWith === st.ident.id);
    const callSign = head ? head.ident.callSign : st.ident.callSign;
    const { sharesCallSign: _, ...rest } = st.ident;
    const ident: StationIdent = { ...rest, callSign };
    st.ident = { ...ident, slug: slugOf(ident, member), ...(member || hasFamily ? { sharesCallSign: true } : {}) };
  }
}

/** A station's setup, as getSetup, updateSetup and chooseChannel answer it. */
export function setupView(st: DbStation): StationSetup {
  const head = familyHeadOf(st);
  const family = familyOf(st.ident.id).map((s) => s.ident);
  return { station: st.ident, ...st.setup, sharesCallSignWith: head?.ident ?? null, callSignFamily: family };
}

/**
 * `availableChannels`' `ownSubchannels`: the next free X.n beside each station the person owns on
 * X.1 in the market, on the TV band. Empty when the rule is off.
 */
export function ownSubchannelsFor(personId: string, marketSlug: string, band: "tv" | "radio", taken: (channel: string) => boolean): Array<{ channel: string; beside: StationIdent }> {
  if (band !== "tv" || !ownSubchannelsAllowed()) return [];
  const db = getDb();
  const owned = db.stations.filter(
    (s) => s.ident.kind === "station" && s.ident.band === "tv" && s.ident.marketSlug === marketSlug && (tvTenths(s.ident.channel) ?? 0) % 10 === 1 && db.members.some((m) => m.stationId === s.ident.id && m.personId === personId && m.role === "owner")
  );
  return owned.flatMap((s) => {
    const head = tvTenths(s.ident.channel)!;
    for (let t = head + 1; t < head + 9; t++) if (!taken(channelOf(t))) return [{ channel: channelOf(t), beside: s.ident }];
    return [];
  });
}

/** Whether a TV subchannel is taken by any station the dial knows. */
export function subchannelTaken(idents: StationIdent[], marketSlug: string, channel: string, except?: string): boolean {
  return idents.some((s) => s.id !== except && s.marketSlug === marketSlug && s.band === "tv" && s.channel === channel);
}

/** The station on X.1 of a subchannel's major, in the market, from the dial's idents. */
export function headOnMajor(idents: StationIdent[], marketSlug: string, channel: string): StationIdent | undefined {
  const t = tvTenths(channel);
  if (t === null || t % 10 === 1) return undefined;
  const head = channelOf(Math.floor(t / 10) * 10 + 1);
  return idents.find((s) => s.marketSlug === marketSlug && s.band === "tv" && s.channel === head);
}
