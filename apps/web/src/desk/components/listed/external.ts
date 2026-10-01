// External stations in words (follow-up Phase 6, network-desk 05.1): how each one plays and why it
// may, where "what's on" comes from, whether it's up right now, and its outages. Words always,
// never colour alone. Listings from before Phase 6 (no `plays`) read as official embeds.

import type { ExternalOutage, ListedChange, ListedSource } from "@opencast/contracts";
import { clock } from "@opencast/ui";
import { dayMonth } from "../../lib/dates";

export const PLAYS_LABELS = { embed: "Official embed", stream_link: "Stream link" } as const;

export type Plays = keyof typeof PLAYS_LABELS;

export const playsOf = (s: ListedSource): Plays => s.plays ?? "embed";

/** "Sept 21" for a `YYYY-MM-DD` date. */
export function shortDate(date: string, timeZone: string): string {
  return dayMonth(`${date}T12:00:00Z`, timeZone, { short: true });
}

const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** Waiting for its evidence (not just down, and not held by a rule in Settings). */
export function needsEvidence(s: ListedSource): boolean {
  return s.waiting === "terms_unclear" || s.waiting === "needs_terms" || s.waiting === "needs_permission";
}

/** Off the dial for something other than its stream being down. */
export const waitingOffDial = (s: ListedSource) => !!s.waiting && s.waiting !== "down";

// ---- A229: one brand's streams sharing a call sign on one channel's subchannels ----

type Ident = { channel: string | null; callSign: string | null; name?: string };
const idText = (i: Ident) => [i.channel, i.callSign].filter(Boolean).join(" ");

/** "15.2 RIVC", "15.2 RIVC and 15.3 RIVC", "15.2 RIVC, 15.3 RIVC and 15.4 RIVC". */
export function andList(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The family line: "Same brand as 15.1 RIVC" on a member; "Its call sign is shared by 15.2 and 15.3" on X.1. */
export function familyLine(s: ListedSource): string | null {
  const f = s.family;
  if (!f) return null;
  if (f.role === "member") return `Same brand as ${idText(f.head)}`;
  return f.members.length ? `Its call sign is shared by ${andList(f.members.map((m) => m.channel ?? m.name))}` : null;
}

/**
 * The external station on X.1 a new listing on `channel` could share a call sign with: X.n (n ≥ 2)
 * beside an external station on the list at X.1 of the same major (the API's rule, A229).
 */
export function familyHeadFor(listings: readonly ListedSource[], band: "tv" | "radio", channel: string): ListedSource | null {
  const m = /^(\d{1,3})\.(\d)$/.exec(channel.trim());
  if (band !== "tv" || !m || m[2] === "1" || m[2] === "0") return null;
  return listings.find((l) => l.listingState === "listed" && l.station.band === "tv" && l.station.channel === `${Number(m[1])}.1` && l.family?.role !== "member") ?? null;
}

/** The "Same brand" checkbox's words: "Same brand as 15.1 RIVC (share its call sign)". */
export function sameBrandLabel(head: ListedSource): string {
  return `Same brand as ${idText(head.station)} (share its call sign)`;
}

/**
 * Changing X.1's call sign changes its family's (A229): the confirmation names them. Null when it
 * has no family or the call sign isn't changing.
 */
export function familyCallSignChange(s: ListedSource, next: string): { text: string; button: string } | null {
  const f = s.family;
  if (!f || f.role !== "head" || !f.members.length || !next || next === s.station.callSign) return null;
  const all = [s.station, ...f.members];
  const n = all.length;
  const all3 = n === 2 ? "both" : `all ${n}`;
  return {
    text: `This changes the call sign of ${all3} streams: ${andList(all.map(idText))} become ${next}. ${s.station.callSign} is held a year for them, so their old addresses still work and nobody else takes it.`,
    button: `Change ${all3} to ${next}`
  };
}

/** Taking X.1 off the dial for good takes its family (A231): the confirmation names them. */
export function familyRemoval(s: ListedSource): { members: string[]; text: string } | null {
  const f = s.family;
  if (!f || f.role !== "head" || !f.members.length) return null;
  const names = f.members.map((m) => `${idText(m)}, ${m.name}`);
  return { members: names, text: `${andList(f.members.map(idText))} ${f.members.length === 1 ? "shares" : "share"} its call sign and ${f.members.length === 1 ? "goes" : "go"} off the dial with it. Put back on the list, they come back together.` };
}

/** The Source column's second line. A lead-born listing says where it was found. */
export function sourceDetail(s: ListedSource): string | null {
  if (!s.creatorId) return s.description;
  return s.description ? `From an IPTV list. ${s.description}` : "From an IPTV list";
}

/** How it plays, the small line: why it may play this way, or what it's waiting for. */
export function playsDetail(s: ListedSource, timeZone: string): string {
  const note = s.evidence?.note ?? null;
  switch (s.waiting) {
    case "terms_unclear":
      return note ? `Terms unclear, ${lowerFirst(note)}` : "Terms unclear";
    case "needs_terms":
      return note ? `Terms page not recorded. ${note}` : "Terms page not recorded";
    case "needs_permission":
      return ["Needs their permission", s.creatorId ? "In the creator pipeline" : null, note].filter(Boolean).join(". ");
    case "dash_not_played":
      return "DASH stream, not played yet";
    case "needs_https":
      return "Needs an https address";
    case "other_market":
      return "Outside this market";
  }
  const e = s.evidence;
  if (e?.basis === "written_permission" && e.permission) return `Their written permission, ${shortDate(e.permission.grantedOn, timeZone)}`;
  if (e?.basis === "public_source" && e.publicBasis) return e.publicBasis;
  if (e?.termsCheckedOn) return `Their own player, embedding allowed (checked ${shortDate(e.termsCheckedOn, timeZone)})`;
  return playsOf(s) === "embed" ? "Their own player, embedding allowed" : "";
}

export type Tone = "ok" | "warn" | "quiet";

/** What's on: the source's feed, guide data, or nothing (the banner says Live). */
export function scheduleWords(s: ListedSource): { text: string; detail?: string; tone: Tone } {
  if (waitingOffDial(s)) return { text: "Waiting", tone: "quiet" };
  const source = s.schedule?.source ?? (s.calendarUrl ? "feed" : "none");
  if (source === "none") return { text: "No schedule found", detail: "Banner shows name and Live", tone: "warn" };
  if (s.calendarSync === "calendar_not_found") return { text: source === "guide_data" ? "Guide data not found" : "Calendar not found", detail: "Banner shows name and Live", tone: "warn" };
  if (source === "guide_data") return { text: "Guide data", detail: "Checked, from their published schedule", tone: "ok" };
  const format = s.schedule?.format ?? null;
  return { text: format === null || format === "ical" ? "Their agenda calendar" : "Their schedule feed", tone: "ok" };
}

/** "14 min", "1 hr 12 min": how long it's been down. At least a minute. */
export function downFor(since: string, now: Date): string {
  const total = Math.max(1, Math.floor((now.getTime() - Date.parse(since)) / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export type NowTone = "up" | "warn" | "down" | "quiet";

/** Right now: up, down (still on the dial for its first 5 minutes), hidden, or not checked yet. */
export function nowWords(s: ListedSource, now: Date): { text: string; detail?: string; tone: NowTone } {
  if (waitingOffDial(s)) return { text: "Not on the dial", tone: "quiet" };
  const h = s.health;
  if (!h || h.state === "unchecked") return { text: "Not checked yet", tone: "quiet" };
  if (h.state === "up") return { text: "Up", tone: "up" };
  const down = h.since ? `Down ${downFor(h.since, now)}` : "Down";
  return h.state === "hidden" ? { text: down, detail: "Hidden from the dial", tone: "down" } : { text: down, detail: "Still on the dial", tone: "warn" };
}

/**
 * A237: how a stream link listed as http:// reaches viewers, when it isn't as listed: over https from
 * the source, or through Opencast's secure relay. Null otherwise (and "Needs an https address" is the
 * How it plays line itself while it waits for one).
 */
export function transportLine(s: ListedSource): string | null {
  if (s.playsOver === "https") return "Plays over https (its listed address is http)";
  if (s.playsOver === "relay") return "Plays through Opencast's secure relay (its address is http)";
  return null;
}

/** What it goes on the dial once: the end of "Saved. It goes on the dial once …". */
export function onceWords(s: ListedSource): string {
  switch (s.waiting) {
    case "terms_unclear":
      return "their terms allow embedding";
    case "needs_terms":
      return "the terms page and the day it was checked are recorded";
    case "needs_permission":
      return "they say yes in writing, or it's confirmed public";
    case "dash_not_played":
      return "Settings allows DASH stream links";
    case "needs_https":
      return "its source answers over https, or Opencast's secure relay is set up";
    case "other_market":
      return "Settings allows other markets' streams";
    case "down":
      return "its stream is back";
    default:
      return "its evidence is recorded";
  }
}

const minutes = (n: number) => `${n} ${n === 1 ? "minute" : "minutes"}`;

/**
 * One outage in the history: "Down 8:43 pm to 9:02 pm, 19 minutes, hidden from the dial at 8:48 pm.
 * HTTP 503"; a blip, "Down 2 minutes, back before it left the dial"; still down, "Down since 8:28 pm".
 */
export function outageWords(o: ExternalOutage, timeZone: string): { when: string; text: string } {
  const t = (ts: string) => clock(ts, { timeZone });
  const detail = o.detail ? `. ${o.detail}` : "";
  const when = dayMonth(o.downSince, timeZone, { short: true });
  if (!o.backAt) return { when, text: `Down since ${t(o.downSince)}${o.hiddenAt ? `, hidden from the dial at ${t(o.hiddenAt)}` : ", still on the dial"}${detail}` };
  const n = Math.max(1, Math.round((Date.parse(o.backAt) - Date.parse(o.downSince)) / 60_000));
  // A215: it ended because the address changed (checks started afresh) or it was taken off the dial.
  const why = o.ended === "address_changed" ? ", when the address was changed" : o.ended === "removed" ? ", when it was taken off the dial" : "";
  if (o.ended && o.ended !== "back") {
    return { when, text: `Down ${t(o.downSince)} to ${t(o.backAt)}${why}${o.hiddenAt ? `, hidden from the dial at ${t(o.hiddenAt)}` : ""}${detail}` };
  }
  if (!o.hiddenAt) return { when, text: `Down ${minutes(n)}, back before it left the dial${detail}` };
  return { when, text: `Down ${t(o.downSince)} to ${t(o.backAt)}, ${minutes(n)}, hidden from the dial at ${t(o.hiddenAt)}${detail}` };
}

// ---- A215 (2026-09-30): changing a listing, and taking it off the dial for good ----

/** A host, for the words: "colton.example.gov". */
export function hostOf(url: string): string {
  try {
    return new URL(url.trim()).host.toLowerCase();
  } catch {
    return url.trim();
  }
}

/** What a change would do to it, before it's saved: the Change form's warning, or null when it stays as it is. */
export interface ChangeDraft {
  plays: Plays;
  streamUrl: string;
  embedTerms: "allowed" | "unclear";
}

/**
 * Said plainly before saving: when the change takes it off the dial until new evidence is recorded
 * (a written permission covers one exact address; embed terms were checked for one player's host;
 * a new way to play needs its own evidence), or what stays (a public basis is about the source).
 */
export function changeWarning(s: ListedSource, d: ChangeDraft): { waits: boolean; text: string } | null {
  const url = d.streamUrl.trim();
  const who = s.station.callSign ?? s.name;
  const addressChanged = url !== s.streamUrl;
  const e = s.evidence;
  const onEvidence = !!e?.basis;
  if (d.plays !== playsOf(s)) {
    return {
      waits: true,
      text:
        d.plays === "embed"
          ? `An official embed needs its terms page and the day it was checked. Saving takes ${who} off the dial until they're recorded.`
          : `A stream link needs their written permission, or a clearly public basis. Saving takes ${who} off the dial until one is recorded.`
    };
  }
  if (d.plays === "embed") {
    if (d.embedTerms === "unclear" && s.embedTerms === "allowed") return { waits: true, text: `Saving takes ${who} off the dial until their terms allow embedding.` };
    if (addressChanged && onEvidence && hostOf(url) !== hostOf(s.streamUrl)) {
      return { waits: true, text: `Their terms were checked for ${hostOf(s.streamUrl)}. Saving takes ${who} off the dial until the terms for ${hostOf(url)} are checked.` };
    }
    if (addressChanged) return { waits: false, text: `Same host, so their terms stay${e?.termsCheckedOn ? " as checked" : ""}. The new address is checked from the next minute.` };
    return null;
  }
  if (!addressChanged) return null;
  if (e?.basis === "written_permission") {
    const earlier = (s.earlierPermissions ?? []).find((p) => p.streamUrl === url);
    if (earlier) return { waits: false, text: `The written permission recorded before for this address covers it again (${earlier.grantedBy}). It's checked from the next minute.` };
    return { waits: true, text: `Their written permission covers ${s.streamUrl} only. Saving takes ${who} off the dial until new evidence is recorded for the new address. The permission is kept as it was.` };
  }
  if (e?.basis === "public_source") return { waits: false, text: "The public basis stays: it's about the source. The new address is checked from the next minute." };
  return { waits: false, text: "The new address is checked once its evidence is recorded." };
}

const FIELD_LABELS: Record<ListedChange["fields"][number]["field"], string> = {
  name: "Whose stream",
  description: "What it shows",
  streamUrl: "Address",
  plays: "How it plays",
  embedTerms: "Their terms",
  calendarUrl: "Feed address",
  calendarFormat: "Feed format",
  schedule: "What's on",
  guideCheckedAgainst: "Checked against",
  guideCheckedOn: "Date checked",
  channel: "Channel",
  callSign: "Call sign"
};

const VALUE_WORDS: Record<string, string> = {
  embed: "Official embed",
  stream_link: "Stream link",
  allowed: "Allow embedding",
  unclear: "Unclear",
  feed: "Their calendar or schedule feed",
  guide_data: "Guide data",
  none: "None"
};

const EFFECT_WORDS: Record<ListedChange["effects"][number], string> = {
  waits_for_evidence: "It waits for new evidence",
  checks_restart: "Checked afresh",
  schedule_reread: "Its schedule read again"
};

/**
 * One entry in the change history: "Dee A. changed Address from https://… to https://…. It waits
 * for new evidence", "Dee A. took it off the dial for good", "Dee A. put it back on the list".
 */
export function changeWords(c: ListedChange, timeZone: string): { when: string; text: string } {
  const when = dayMonth(c.at, timeZone, { short: true });
  const who = c.by ?? "Opencast";
  const value = (f: ListedChange["fields"][number], v: string | null) => (v === null || v === "" ? "nothing" : f.field === "plays" || f.field === "embedTerms" || f.field === "schedule" ? (VALUE_WORDS[v] ?? v) : v);
  const at = clock(c.at, { timeZone });
  if (c.action === "removed") return { when, text: `${who} took it off the dial for good, ${at}` };
  if (c.action === "restored") {
    const ch = c.fields.find((f) => f.field === "channel");
    return { when, text: `${who} put it back on the list${ch?.to ? ` at ${ch.to}` : ""}, ${at}` };
  }
  const parts = c.fields.map((f) => `${FIELD_LABELS[f.field]} from ${value(f, f.from)} to ${value(f, f.to)}`);
  const effects = c.effects.map((e) => EFFECT_WORDS[e]);
  return { when, text: `${who} changed ${parts.join("; ")}, ${at}${effects.length ? `. ${effects.join(". ")}` : ""}` };
}

/** "Taken off the dial Sept 30 by Dee A." and where its channel stands: held for it until a date, or freed. */
export function removedWords(s: ListedSource, timeZone: string, now: Date): { text: string; detail: string } | null {
  const r = s.removed;
  if (!r) return null;
  const held = Date.parse(r.channelHeldUntil) > now.getTime();
  const on = dayMonth(r.channelHeldUntil, timeZone, { short: true });
  return {
    text: `Taken off the dial ${dayMonth(r.at, timeZone, { short: true })}${r.by ? ` by ${r.by}` : ""}`,
    detail: r.channel ? (held ? `${r.channel} held for it until ${on}` : `${r.channel} freed ${on}`) : "Its channel was freed"
  };
}
