// External stations in words (follow-up Phase 6, network-desk 05.1): how each one plays and why it
// may, where "what's on" comes from, whether it's up right now, and its outages. Words always,
// never colour alone. Listings from before Phase 6 (no `plays`) read as official embeds.

import type { ExternalOutage, ListedSource } from "@opencast/contracts";
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
  if (!o.hiddenAt) return { when, text: `Down ${minutes(n)}, back before it left the dial${detail}` };
  return { when, text: `Down ${t(o.downSince)} to ${t(o.backAt)}, ${minutes(n)}, hidden from the dial at ${t(o.hiddenAt)}${detail}` };
}
