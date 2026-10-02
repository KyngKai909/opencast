// Shared call signs (A229) in setup and settings: an owner's own subchannel beside their own
// station on X.1 (12.2 beside 12.1 BEAT) can share X.1's call sign, as real TV does. The channel
// tells the stations apart ("BEAT 12.2"). Full stations' call signs are fixed after first sign-on:
// a family's call sign doesn't change once X.1 is on air, and a member keeps it once it is.
// The words and choices here are pure, so they're tested without the form.

import type { StationIdent, StationSetup } from "@opencast/contracts";

export interface OwnSubchannel {
  /** "12.2" */
  channel: string;
  /** The owner's station on X.1 it sits beside. */
  beside: StationIdent;
}

type Family = Pick<StationSetup, "sharesCallSignWith" | "callSignFamily" | "fixed"> & { station: Pick<StationIdent, "callSign" | "channel"> };

/** "12.1 BEAT": a station on X.1, as the share option names it. */
export function headWords(s: Pick<StationIdent, "callSign" | "channel" | "name">): string {
  return [s.channel, s.callSign ?? s.name].filter(Boolean).join(" ");
}

/** "12.2 Beat Tapes": a family member, by channel and name (they share the call sign). */
function memberWords(s: Pick<StationIdent, "channel" | "name">): string {
  return [s.channel, s.name].filter(Boolean).join(" ");
}

function list(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Whether a TV channel is a subchannel (X.n, n ≥ 2). */
export function isSubchannel(channel: string | null | undefined, band: "tv" | "radio" | null | undefined): boolean {
  return band === "tv" && !!channel && /^\d{1,2}\.[2-9]$/.test(channel);
}

/**
 * The subchannels to offer beside the owner's own stations: the API's next free X.n beside each
 * X.1 they own, with the one this station already has in place of the next one beside the same
 * X.1 (the API's list skips it: it's taken, by this station). None on the radio band, and none
 * beside the station itself.
 */
export function ownSubchannelOptions(offered: OwnSubchannel[] | undefined, current: { self: string | null; band: "tv" | "radio"; channel: string | null; sharesWith: StationIdent | null }): OwnSubchannel[] {
  if (current.band !== "tv") return [];
  // Never beside itself (the station on X.1 being edited).
  const out = (offered ?? []).filter((o) => o.beside.id !== current.self);
  const channel = current.channel;
  if (!channel || !isSubchannel(channel, "tv") || out.some((o) => o.channel === channel)) return out;
  const major = channel.split(".")[0];
  const at = out.findIndex((o) => (current.sharesWith ? o.beside.id === current.sharesWith.id : o.channel.split(".")[0] === major));
  const beside = current.sharesWith ?? (at >= 0 ? out[at]!.beside : null);
  if (!beside) return out;
  if (at >= 0) out.splice(at, 1, { channel, beside });
  else out.unshift({ channel, beside });
  return out;
}

/** The owner's station on X.1 that a chosen channel sits beside, when it's one of their own subchannels. */
export function besideFor(channel: string | null, options: OwnSubchannel[]): StationIdent | null {
  return (channel && options.find((o) => o.channel === channel)?.beside) || null;
}

/** `chooseChannel`'s body: on an own subchannel it says whether to share X.1's call sign. */
export function chooseChannelBody(marketId: string, band: "tv" | "radio", channel: string, beside: StationIdent | null, share: boolean): { marketId: string; band: "tv" | "radio"; channel: string; shareCallSign?: boolean } {
  return beside ? { marketId, band, channel, shareCallSign: share } : { marketId, band, channel };
}

/** What the call sign field shows: X.1's when sharing (locked), else what's typed. */
export function shownCallSign(typed: string, beside: StationIdent | null, share: boolean): string {
  return beside && share ? (beside.callSign ?? typed) : typed;
}

/** Whether the channel needs saving: another channel or band, or sharing turned on or off. */
export function channelChanged(saved: { channel: string | null; band: "tv" | "radio" | null; sharing: boolean }, chosen: { channel: string | null; band: "tv" | "radio"; beside: StationIdent | null; share: boolean }): boolean {
  if (!chosen.channel) return false;
  if (chosen.channel !== saved.channel || chosen.band !== saved.band) return true;
  return !!chosen.beside && chosen.share !== saved.sharing;
}

/** "Share 12.1 BEAT's call sign" */
export function shareLabel(beside: StationIdent): string {
  return `Share ${headWords(beside)}'s call sign`;
}

/** Under the share option: what viewers see, and when it's fixed. */
export function shareHelper(beside: StationIdent, channel: string, share: boolean, letGo: string | null): string {
  if (!share) return "It picks a call sign of its own.";
  return `Viewers see ${beside.callSign} ${channel}: the channel tells your stations apart. Once it signs on, it keeps this call sign.${letGo ? ` ${letGo} is let go.` : ""}`;
}

/** "12.2 next to 12.1 BEAT" */
export function ownSubchannelWords(o: OwnSubchannel): string {
  return `${o.channel} next to ${headWords(o.beside)}`;
}

/**
 * The family line, for setup's call sign and Settings' Identity: "Shares 12.1 BEAT's call sign"
 * on a member, "12.2 Beat Tapes shares this call sign" on X.1. Null when it shares nothing.
 */
export function familyLine(setup: Pick<StationSetup, "sharesCallSignWith" | "callSignFamily">): string | null {
  if (setup.sharesCallSignWith) return `Shares ${headWords(setup.sharesCallSignWith)}'s call sign`;
  const family = setup.callSignFamily ?? [];
  if (!family.length) return null;
  return `${list(family.map(memberWords))} ${family.length === 1 ? "shares" : "share"} this call sign`;
}

/** The call sign field's help on a station that shares: the family line, and what's fixed. */
export function familyHelp(setup: Family): string | null {
  const line = familyLine(setup);
  if (!line) return null;
  if (setup.fixed) return `${line}. Fixed since the first sign-on.`;
  if (setup.sharesCallSignWith) return `${line}. The channel tells them apart.`;
  return `${line}. A change here changes theirs too, until one of them signs on.`;
}

/** X.1 with stations sharing its call sign stays on its channel. */
export function familyChannelNote(setup: Pick<StationSetup, "callSignFamily"> & { station: Pick<StationIdent, "channel"> }): string | null {
  const family = setup.callSignFamily ?? [];
  if (!family.length || !setup.station.channel) return null;
  return `${list(family.map(memberWords))} ${family.length === 1 ? "shares" : "share"} this call sign, so ${setup.station.channel} stays while ${family.length === 1 ? "it does" : "they do"}.`;
}

/** Beside the Sign on button: signing on fixes the shared call sign. Null when it shares nothing. */
export function signOnFamilyNote(setup: Pick<StationSetup, "sharesCallSignWith" | "callSignFamily">): string | null {
  if (setup.sharesCallSignWith) return `It keeps ${headWords(setup.sharesCallSignWith)}'s call sign once it's on air.`;
  if (setup.callSignFamily?.length) return `Once it's on air, the call sign it shares with ${list(setup.callSignFamily.map(memberWords))} is fixed.`;
  return null;
}
