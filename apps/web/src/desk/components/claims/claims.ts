// Every word the desk's Rights claims page (desk-pages 01) says about a claim, in one place: the
// wording of claims is for a lawyer to review before launch, and their edit should be one file.
// The frame's words where it draws them; the rest is listed in docs/apps/new-copy.md.

import { CLAIM_ANSWER_SOON_DAYS, type DeskClaim, type DeskClaims, type DeskClaimStation, type DeskClaimStep, type StationIdent } from "@opencast/contracts";
import { clock, type Stat, type TagVariant, type TimelineItem } from "@opencast/ui";
import { daysBetween } from "../../lib/dates";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];

/** "Sept 12", "Oct 14": the frame's short dates. */
export function shortDay(ts: string, timeZone: string): string {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, month: "numeric", day: "numeric" }).formatToParts(new Date(ts));
  const get = (t: string) => Number(f.find((p) => p.type === t)?.value ?? 0);
  return `${MONTHS[get("month") - 1]} ${get("day")}`;
}

/** "Sept 12, 2:04 pm". */
export function shortDayTime(ts: string, timeZone: string): string {
  return `${shortDay(ts, timeZone)}, ${clock(ts, { timeZone })}`;
}

/** "BEAT", or the station's name when it has no call sign. */
export function callSignOf(s: StationIdent): string {
  return s.callSign ?? s.name;
}

/** "BEAT 12.1". */
export function stationLabel(s: StationIdent): string {
  return s.channel ? `${callSignOf(s)} ${s.channel}` : callSignOf(s);
}

/** "Northside Records" → "Northside"; "Westside Tapes LLC" → "Westside Tapes". The claimant's short name in sentences. */
export function shortClaimant(name: string): string {
  const plain = name.replace(/,?\s+(LLC|L\.L\.C\.|Inc\.?|Ltd\.?|Co\.|Corp\.?|Limited)$/i, "").trim();
  const words = plain.split(/\s+/);
  return words.length > 1 && /^(Records|Films|Pictures|Music|Media|Studios?|Photography|Productions)$/i.test(words[words.length - 1]!) ? words.slice(0, -1).join(" ") : plain;
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** "Late Crate, ep. 9, on BEAT 12.1". */
export function programLine(c: DeskClaim): string {
  return `${c.item.title}, on ${stationLabel(c.station)}`;
}

/** "Northside Records: two tracks in the second half". */
export function claimLine(c: DeskClaim): string {
  const what = c.workKind ?? c.claimText;
  return `${c.claimantName}: ${lowerFirst(what.length > 90 ? `${what.slice(0, 89).trimEnd()}…` : what)}`;
}

/** The State column: the frame's "Off air" and "Counter-notice sent", then the outcomes. */
export function stateTag(c: DeskClaim): { text: string; variant: TagVariant } {
  const cs = callSignOf(c.station);
  switch (c.state) {
    case "open":
      return { text: "Off air", variant: "off" };
    case "answered":
      return { text: "Counter-notice sent", variant: "standby" };
    case "upheld":
      return { text: "Upheld", variant: "solid" };
    case "removed":
      return { text: `Removed by ${cs}`, variant: "plain" };
    case "expired":
      return { text: "Removed, no answer", variant: "plain" };
    case "withdrawn":
      return { text: "Withdrawn", variant: "plain" };
    case "restored":
      return { text: "Back on air", variant: "plain" };
  }
}

/** The day a claim closed: its outcome's step. */
export function closedAt(c: DeskClaim): string | null {
  return [...c.timeline].reverse().find((s) => s.at && !["back_on_air"].includes(s.step))?.at ?? null;
}

/** The Next column: "SAZN answers by Oct 1", "Northside has until Oct 14", "Privacy, not copyright". */
export function nextText(c: DeskClaim, timeZone: string): string {
  if (!c.next) {
    const at = closedAt(c);
    return at ? `Closed ${shortDay(at, timeZone)}` : "Closed";
  }
  if (c.next.kind === "review") return "Privacy, not copyright";
  if (c.next.kind === "reply") return `${shortClaimant(c.claimantName)} has until ${shortDay(c.next.at!, timeZone)}`;
  return `${callSignOf(c.station)} answers by ${shortDay(c.next.at!, timeZone)}`;
}

/** "3 carriers", "1 carrier". */
export function carriersWords(n: number): string {
  return `${n} ${n === 1 ? "carrier" : "carriers"}`;
}

/** The three answers, in the words master control's answer form uses. */
const BASIS: Record<string, string> = { made_it: "We made it", owner_permission: "The owner gave permission", public_domain: "It's in the public domain" };
export function basisWords(basis: string): string {
  return BASIS[basis] ?? basis;
}

/** "today", "tomorrow", "in 2 days". */
export function inDays(n: number): string {
  if (n <= 0) return "today";
  if (n === 1) return "tomorrow";
  return `in ${n} days`;
}

/** One step, in words. */
function stepItem(c: DeskClaim, s: DeskClaimStep, timeZone: string, now: Date): TimelineItem {
  const cs = callSignOf(c.station);
  const who = shortClaimant(c.claimantName);
  const n = c.carriers.length;
  const privacy = c.kind === "privacy";
  const day = (at: string | null) => (at ? shortDay(at, timeZone) : "");
  const base = { state: s.state };
  switch (s.step) {
    case "received":
      return { ...base, when: shortDayTime(s.at!, timeZone), title: privacy ? "Privacy complaint received" : "Claim received", detail: c.workKind ? `${c.claimantName}: ${lowerFirst(c.workKind)}` : c.claimantName };
    case "off_air":
      return { ...base, when: shortDayTime(s.at!, timeZone), title: n ? `Off air on ${cs} and ${carriersWords(n)}` : `Off air on ${cs}`, detail: "Pulled from every log at once" };
    case "answer_due": {
      const left = daysBetween(now, s.at!, timeZone);
      return { ...base, when: `By ${day(s.at)}`, title: `${cs} answers or removes it`, detail: `${left <= 0 ? "Due today" : `${left} ${left === 1 ? "day" : "days"} left`}. With no answer, it's removed from the library` };
    }
    case "answered": {
      const attached = !!c.answer?.attachmentUrl || c.attachments.length > 0;
      return { ...base, when: day(s.at), title: `${cs} answered`, detail: attached ? `"${basisWords(c.answer?.basis ?? "")}," with the licence attached` : `"${basisWords(c.answer?.basis ?? "")}"` };
    }
    case "counter_notice":
      return { ...base, when: day(s.at), title: "Counter-notice sent to the claimant", detail: `With ${cs}'s legal name and contact. They were told it stays on air unless they take legal action` };
    case "back_on_air":
      return { ...base, when: day(s.at), title: n ? `Back on air on ${cs} and ${carriersWords(n)}` : `Back on air on ${cs}`, detail: "In every log that had it, from the next scheduled airing" };
    case "reply_due":
      return { ...base, when: day(s.at), title: `${who}'s time to take legal action ends`, detail: `If ${who} hasn't filed suit, Opencast closes the claim and it stays on air` };
    case "review":
      return { ...base, when: "Now", title: "Opencast reviews it", detail: "A privacy complaint follows its own path: no answer window, and it stays off air until it's decided" };
    case "removed":
      return { ...base, when: day(s.at), title: `Removed by ${cs}`, detail: "Removing isn't counted against a station" };
    case "expired":
      return { ...base, when: day(s.at), title: "Removed from the library", detail: "No answer by the date. Counts as removed, not upheld" };
    case "upheld":
      return { ...base, when: day(s.at), title: "Upheld", detail: privacy ? "It stays off every log. Privacy complaints don't count toward the repeat limit" : `It stays off every log, and counts toward ${cs}'s repeat limit for a year` };
    case "withdrawn":
      return { ...base, when: day(s.at), title: `${who} withdrew it`, detail: null };
    case "restored":
      return { ...base, when: day(s.at), title: privacy ? "Restored after review" : "No further action from the claimant", detail: null };
  }
}

/** A claim's timeline, as the pane draws it. */
export function timelineItems(c: DeskClaim, timeZone: string, now: Date): TimelineItem[] {
  return c.timeline.map((s) => stepItem(c, s, timeZone, now));
}

/** The pane's closing line. */
export function paneNote(c: DeskClaim): string {
  return c.kind === "privacy"
    ? "Not every claim is copyright. A privacy complaint follows its own path: Opencast reviews it, and it doesn't count toward the repeat limit."
    : "Opencast doesn't decide who's right. It follows the process, keeps the record, and restores or removes on the dates.";
}

/** A carrier's line in the pane: "2 airings pulled", "Carries it, nothing scheduled", "Back on air". */
export function carrierLine(k: DeskClaim["carriers"][number]): string {
  if (k.restoredAt) return "Back on air";
  if (!k.airingsPulled) return "Carries it, nothing scheduled";
  return `${k.airingsPulled} ${k.airingsPulled === 1 ? "airing" : "airings"} pulled`;
}

/** The four figures over the list. */
export function claimStats(d: DeskClaims): Stat[] {
  const s = d.stats;
  const open = s.open === 0 ? "Open claims" : s.offAir === s.open ? "Open claims, all off air" : s.offAir === 0 ? "Open claims, none off air" : `Open claims, ${s.offAir} off air`;
  const due =
    s.answersDue === 0 || s.soonestAnswerDays === null
      ? `Station answers due in the next ${CLAIM_ANSWER_SOON_DAYS} days`
      : s.answersDue === 1
        ? `Station answer due ${inDays(s.soonestAnswerDays)}`
        : `Station answers due, the first ${inDays(s.soonestAnswerDays)}`;
  return [
    { value: String(s.open), caption: open },
    { value: String(s.answersDue), caption: due },
    { value: String(s.carryingStations), caption: "Stations carrying something that was claimed" },
    { value: String(s.nearRepeatLimit), caption: "Stations near the repeat limit" }
  ];
}

/** The By station tab's standing. */
export function standingTag(s: DeskClaimStation): { text: string; variant: TagVariant } {
  if (s.standing === "offers_paused") return { text: "At the limit, offers paused", variant: "solid" };
  if (s.standing === "near_limit") return { text: "Near the limit", variant: "standby" };
  return { text: "Good", variant: "plain" };
}

/** The outcomes a rights reviewer can record, with what each does. */
export function outcomeChoices(c: DeskClaim): Array<{ value: "upheld" | "withdrawn" | "restored"; title: string; helper: string }> {
  const cs = callSignOf(c.station);
  const n = c.carriers.length;
  const everywhere = n ? `on ${cs} and ${carriersWords(n)}` : `on ${cs}`;
  return [
    {
      value: "upheld",
      title: "Upheld",
      helper: c.kind === "privacy" ? "It's removed from the library and every log. Privacy complaints don't count toward the repeat limit" : `It's removed from the library and every log, and counts toward ${cs}'s repeat limit for a year`
    },
    { value: "withdrawn", title: "Withdrawn", helper: `The claimant took it back. It's back on air ${everywhere}` },
    { value: "restored", title: "Restored", helper: c.kind === "privacy" ? `Reviewed and not upheld. It's back on air ${everywhere}` : `No legal action by the date. It's back on air ${everywhere}` }
  ];
}

/** The toast after an outcome is recorded. */
export function outcomeToast(c: DeskClaim, outcome: "upheld" | "withdrawn" | "restored"): string {
  const cs = callSignOf(c.station);
  if (outcome === "upheld") return `Upheld. ${c.item.title} is removed from ${cs}'s library.`;
  return `${outcome === "withdrawn" ? "Withdrawn" : "Restored"}. ${c.item.title} is back on air.`;
}

/** "mailto:" for Message BEAT, with the claim in the subject. */
export function messageHref(c: DeskClaim): string | null {
  if (!c.stationEmail) return null;
  return `mailto:${c.stationEmail}?subject=${encodeURIComponent(`The ${c.kind === "privacy" ? "privacy complaint" : "claim"} on ${c.item.title}`)}`;
}
