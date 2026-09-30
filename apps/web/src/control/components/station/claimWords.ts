// Every word the rights pages say about a claim, in one place (open question #12: the wording of
// claims and answers is for a lawyer to review, and their edit should be one file). The frames'
// words are final; lines no frame has are listed as new copy.

import type { TimelineItem } from "@opencast/ui";
import { clock } from "@opencast/ui";
import type { ClaimX, TakedownX } from "../../api/ext/station";
import { airingWhen, dayWord, longDate, shortDate, shortName } from "./format";

export type Basis = "made_it" | "owner_permission" | "public_domain";

/** The three answers, in the library's rights question's order (rights 03.1). */
export const BASIS_WORDS: Record<Basis, { title: string; helper: (callSign: string, noun: string) => string }> = {
  made_it: { title: "We made it", helper: (cs, noun) => `${cs} owns the ${noun} outright` },
  owner_permission: { title: "The owner gave permission", helper: () => "Attach the permission or licence" },
  public_domain: { title: "It's in the public domain", helper: () => "Say where it came from" }
};

export function basisTitle(basis: string): string {
  return (BASIS_WORDS as Record<string, { title: string }>)[basis]?.title ?? basis;
}

/** The claimed thing as a noun, when the API says it ("recording"), or "work". */
export function nounOf(c: ClaimX): string {
  return c.workNoun ?? "work";
}

/** The state, as the rights list's tag says it (rights 01.1). The frame's words, not states.ts's (T3). */
export function stateWords(c: ClaimX, callSign: string): { text: string; tone: "standby" | "plain" } {
  switch (c.state) {
    case "open":
      // A privacy complaint has no answer window: Opencast reviews it (added 2026-09-29).
      if (c.kind === "privacy") return { text: "Off air, privacy complaint", tone: "standby" };
      return { text: `Off air, ${c.daysToAnswer ?? 0} ${c.daysToAnswer === 1 ? "day" : "days"} to answer`, tone: "standby" };
    case "answered":
      return { text: "Answered, back on air", tone: "plain" };
    case "restored":
      return { text: c.answer ? "Answered, back on air" : "Back on air", tone: "plain" };
    case "withdrawn":
      return { text: "Back on air", tone: "plain" };
    case "removed":
      return { text: `Removed by ${callSign}`, tone: "plain" };
    case "expired":
      return { text: "Removed", tone: "plain" };
    case "upheld":
      return { text: "Upheld", tone: "plain" };
  }
}

/** The item line in the list: "Imported from a link. Claim: the recording is theirs", or what's claimed. */
export function itemLine(c: ClaimX, imported: boolean): string | null {
  if (imported) return `Imported from a link. Claim: the ${nounOf(c)} is theirs`;
  return c.workKind;
}

/** "12:40 to 31:05, a master recording". */
export function claimedLine(c: ClaimX, range: string | null): string | null {
  const kind = c.workKind ? c.workKind.charAt(0).toLowerCase() + c.workKind.slice(1) : null;
  if (range && kind) return `${range}, ${kind}`;
  return range ?? c.workKind;
}

/** "Westside Tapes LLC says they own this recording." */
export function headline(c: ClaimX, short = false): string {
  return `${short ? shortName(c.claimantName) : c.claimantName} says they own this ${nounOf(c)}${short ? "" : "."}`;
}

/** The days left, in the timeline's words. */
export function daysLeftWords(n: number): string {
  if (n <= 0) return "Due today";
  return `${n} ${n === 1 ? "day" : "days"} left`;
}

/** What happens: the open claim's timeline (rights 02.1), or an answered one's. */
export function openTimeline(c: ClaimX, callSign: string, now: Date, timeZone: string): TimelineItem[] {
  const who = shortName(c.claimantName);
  const received: TimelineItem = {
    state: "done",
    when: `${dayWord(c.receivedAt, now, timeZone)}, ${clock(c.receivedAt, { timeZone })}`,
    title: "Claim received, item off air",
    detail: "Everywhere it was scheduled"
  };
  if (c.state === "answered" && c.answer) {
    return [
      received,
      { state: "done", when: `${dayWord(c.answer.answeredAt, now, timeZone)}, ${clock(c.answer.answeredAt, { timeZone })}`, title: `${callSign} answered`, detail: basisTitle(c.answer.basis) },
      { state: "current", when: `By ${longDate(c.answer.claimantReplyDueAt, timeZone)}`, title: `${who} has 10 business days to take it further`, detail: "Back on air in the meantime" }
    ];
  }
  const due = longDate(c.answerDueAt, timeZone);
  return [
    received,
    { state: "current", when: `By ${due}`, title: `${callSign} removes it or answers`, detail: daysLeftWords(c.daysToAnswer ?? 0) },
    { state: "future", when: "If answered", title: `${who} has 10 business days to take it further`, detail: "If they don't, it can air again" },
    { state: "future", when: "If no answer", title: `Removed from the library on ${due}`, detail: "Counts as removed, not upheld" }
  ];
}

function latest(dates: (string | null)[]): string | null {
  const ds = dates.filter((d): d is string => !!d).sort();
  return ds.length ? ds[ds.length - 1]! : null;
}

/** "Received August 19 from R. Delgado. Answered August 20. Back on air August 30." */
export function resolvedSummary(c: ClaimX, callSign: string, timeZone: string): string {
  const parts = [`Received ${longDate(c.receivedAt, timeZone)} from ${c.claimantName}.`];
  if (c.answer) parts.push(`Answered ${longDate(c.answer.answeredAt, timeZone)}.`);
  const back = latest(c.takedowns.map((t) => t.restoredAt));
  if ((c.state === "restored" || c.state === "withdrawn") && back) parts.push(`Back on air ${longDate(back, timeZone)}.`);
  if (c.state === "removed") parts.push(`Removed by ${callSign}.`);
  if (c.state === "expired") parts.push(`Removed ${longDate(c.answerDueAt, timeZone)}, with no answer.`);
  if (c.state === "upheld") parts.push("Upheld.");
  return parts.join(" ");
}

/** A closed or answered claim's timeline (rights 04.1). */
export function resolvedTimeline(c: ClaimX, callSign: string, timeZone: string): TimelineItem[] {
  const n = c.takedowns.length;
  const items: TimelineItem[] = [{ state: "done", when: shortDate(c.receivedAt, timeZone), title: n === 1 ? `Claim, pulled from ${c.takedowns[0]!.station.callSign ?? callSign}` : `Claim, pulled from ${n} stations` }];
  if (c.answer) items.push({ state: "done", when: shortDate(c.answer.answeredAt, timeZone), title: `${callSign} answered`, detail: basisTitle(c.answer.basis) });
  const back = latest(c.takedowns.map((t) => t.restoredAt));
  const everywhere = n === 1 ? "Back on air" : `Back on air on all ${n} stations`;
  if (c.state === "restored" && back) items.push({ state: "done", when: shortDate(back, timeZone), title: "No further action from the claimant", detail: everywhere });
  if (c.state === "withdrawn" && back) items.push({ state: "done", when: shortDate(back, timeZone), title: "The claimant withdrew it", detail: everywhere });
  if (c.state === "answered" && c.answer)
    items.push({ state: "current", when: `By ${shortDate(c.answer.claimantReplyDueAt, timeZone)}`, title: `${shortName(c.claimantName)} has 10 business days to take it further`, detail: "Back on air in the meantime" });
  if (c.state === "removed") items.push({ state: "done", when: "Then", title: `Removed by ${callSign}`, detail: "Removing isn't counted against a station" });
  if (c.state === "expired") items.push({ state: "done", when: shortDate(c.answerDueAt, timeZone), title: "Removed from the library", detail: "Counts as removed, not upheld" });
  if (c.state === "upheld") items.push({ state: "done", when: "Then", title: "Upheld", detail: `Counts toward ${callSign}'s record for a year` });
  return items;
}

/** A pulled station's line (rights 04.1): the maker's, or a carrier's with its deal. */
export function takedownLine(t: TakedownX, isMaker: boolean): string {
  const n = `${t.airingsReplaced} ${t.airingsReplaced === 1 ? "airing" : "airings"}`;
  const replaced = t.replacedWith ? ` replaced with ${t.replacedWith}` : " pulled";
  if (isMaker) return `${n},${replaced}`;
  const deal = t.term ? `Carries on ${t.term}. ` : "";
  return `${deal}${n}${replaced}`;
}

export function takedownTag(c: ClaimX, t: TakedownX): string {
  if (t.restoredAt) return "Back on air";
  if (c.state === "removed" || c.state === "expired" || c.state === "upheld") return "Removed";
  return "Pulled";
}

/** "Monday, 8:00 pm on BEAT". */
export function airingLine(startsAt: string, callSign: string, now: Date, timeZone: string): string {
  return `${airingWhen(startsAt, now, timeZone)} on ${callSign}`;
}

/** The answer form's statement (rights 03.1): the bold part, then the rest. */
export function attestation(c: ClaimX, callSign: string): { bold: string; rest: string } {
  return { bold: `I understand this answer goes to ${shortName(c.claimantName)} with ${callSign}'s legal name and contact,`, rest: " and that a false answer has legal consequences." };
}

export const CUT_FOOTNOTE = (range: string) =>
  `Cutting out the claimed part is a third option: replace the file with an edit that leaves out ${range}, and it's treated as a new item.`;

export const IMPORTED_CARRIAGE = "None. Imported items can't be offered to other stations";
export const CARRIERS_TOLD_AGAIN = "Carriers were told again when it returned. Their logs picked it up from the next scheduled airing.";
