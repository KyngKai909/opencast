// The creator pipeline's rules, on the client: the stage strip's counts, each row's tag, its Next
// line and action, and the order ("Overdue follow-ups and new yeses first, finished rows last").
// The API sorts by nextActionDue then newest (inventory: can't be built as drawn, 6), which sinks
// new yeses, so the desk sorts here.

import { CREATOR_STAGE_LABELS, type CreatorStage } from "@opencast/contracts";
import type { CreatorX } from "../../api/ext";
import { dayMonth, dayWord, localDate } from "../../lib/dates";
import { clock } from "@opencast/ui";

/** The strip, in the frame's order. Declined and No answer aren't counted there (they're kept, not worked). */
export const STRIP: ReadonlyArray<{ stage: CreatorStage; label: string }> = [
  { stage: "found", label: CREATOR_STAGE_LABELS.found.desk },
  { stage: "already_licensed", label: CREATOR_STAGE_LABELS.already_licensed.desk },
  { stage: "asked", label: CREATOR_STAGE_LABELS.asked.desk },
  { stage: "said_yes", label: CREATOR_STAGE_LABELS.said_yes.desk },
  { stage: "setting_up", label: CREATOR_STAGE_LABELS.setting_up.desk },
  // The frame's words for the strip; the row's tag says "On air".
  { stage: "on_air", label: "On air, not claimed" },
  { stage: "claimed", label: CREATOR_STAGE_LABELS.claimed.desk }
];

export function stageCounts(creators: ReadonlyArray<Pick<CreatorX, "stage">>): Record<CreatorStage, number> {
  const counts = { found: 0, already_licensed: 0, asked: 0, said_yes: 0, setting_up: 0, on_air: 0, claimed: 0, declined: 0, no_answer: 0 } as Record<CreatorStage, number>;
  for (const c of creators) counts[c.stage] += 1;
  return counts;
}

/** The stage tag's look (.stg): plain, .yes signal, .lic ink on raised, .wait standby, .air ink fill, .no dashed. */
export type StageLook = "plain" | "yes" | "lic" | "wait" | "air" | "no";

export const STAGE_LOOK: Record<CreatorStage, StageLook> = {
  found: "plain",
  already_licensed: "lic",
  asked: "wait",
  said_yes: "yes",
  // Not drawn. Standby: committed, not on air yet (rules.md).
  setting_up: "wait",
  on_air: "air",
  claimed: "plain",
  declined: "no",
  // Not drawn. Like Declined: kept, and not asked again.
  no_answer: "no"
};

export const PLATFORM_LABELS: Record<CreatorX["sourcePlatform"], string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  internet_archive: "Internet Archive",
  instagram: "Instagram",
  facebook: "Facebook",
  soundcloud: "SoundCloud",
  bandcamp: "Bandcamp",
  other: "Their own site"
};

export interface Ctx {
  now: Date;
  timeZone: string;
  /** Channels the waitlist holds in this market ("95.5" → "GOSP"). */
  held: ReadonlyMap<string, string>;
}

/** A reminder is due (or overdue): asked, not reminded yet, due today or earlier. */
export function reminderDue(c: CreatorX, ctx: Pick<Ctx, "now" | "timeZone">): boolean {
  return c.stage === "asked" && !!c.nextActionDue && c.nextActionDue <= localDate(ctx.now, ctx.timeZone);
}

/** A new yes: said yes (or already licensed) with no station yet. */
export function waitingForSetup(c: CreatorX): boolean {
  return (c.stage === "said_yes" || c.stage === "already_licensed") && !c.station;
}

/** The proposed channel the waitlist holds, if any ("95.5"). */
export function heldProposal(c: CreatorX, held: ReadonlyMap<string, string>): string | null {
  if (c.station) return null;
  const options = c.proposedOptions?.channels ?? (c.proposed ? [c.proposed.channel] : []);
  return options.find((ch) => held.has(ch)) ?? null;
}

/** The Station column: "33.1 LUPE", "38.1 or 45.1", "Radio band", "95.5, held", or nothing. */
export function stationCell(c: CreatorX, held: ReadonlyMap<string, string>): string {
  if (c.station?.channel) return `${c.station.channel}${c.station.callSign ? ` ${c.station.callSign}` : ""}`;
  if (c.stage === "declined" || c.stage === "no_answer") return "";
  const heldCh = heldProposal(c, held);
  if (heldCh) return `${heldCh}, held`;
  const options = c.proposedOptions ?? (c.proposed ? { band: c.proposed.band, channels: [c.proposed.channel] } : null);
  if (!options) return "";
  if (!options.channels.length) return options.band === "radio" ? "Radio band" : "TV band";
  return options.channels.join(" or ");
}

/** The Next column: what happens next, and whether it's due now (standby, bold). */
export function nextLine(c: CreatorX, ctx: Ctx): { text: string; due: boolean } {
  const short = (ts: string) => dayMonth(ts, ctx.timeZone, { short: true });
  const signOn = c.setup?.signOnAt ?? null;
  switch (c.stage) {
    case "found":
      return c.doNotAsk ? { text: "Don't ask again", due: false } : { text: "Ask, with a preview of their station", due: false };
    case "asked": {
      if (!c.nextActionDue) return { text: "Waiting for an answer", due: false };
      const days = dueIn(c.nextActionDue, ctx);
      if (c.remindedAt) return days <= 0 ? { text: "No answer after the reminder", due: true } : { text: `Reminded ${short(c.remindedAt)}. No more after this`, due: false };
      if (days === 0) return { text: "Reminder due today", due: true };
      if (days < 0) return { text: `Reminder overdue since ${short(`${c.nextActionDue}T12:00:00Z`)}`, due: true };
      return { text: `Reminder due ${short(`${c.nextActionDue}T12:00:00Z`)}`, due: false };
    }
    case "said_yes":
    case "already_licensed": {
      if (c.stage === "already_licensed" && c.station) {
        return c.claimInviteSentAt ? { text: `On air with credit. Claim invite sent ${short(c.claimInviteSentAt)}`, due: false } : { text: "On air with credit", due: false };
      }
      const heldCh = heldProposal(c, ctx.held);
      if (heldCh) return { text: `Waitlist holds ${heldCh}; pick another`, due: false };
      if (c.stage === "already_licensed") return { text: "Set up with credit, then invite them to claim", due: false };
      return { text: "Set it up from a recipe", due: false };
    }
    case "setting_up":
      return signOn ? { text: `Signs on ${capital(dayWord(signOn, ctx.timeZone, ctx.now))}, ${clock(signOn, { timeZone: ctx.timeZone })}`, due: false } : { text: "Setting up", due: false };
    case "on_air":
      if (c.claimLinkSentAt) return { text: `Claim link sent ${short(c.claimLinkSentAt)}`, due: false };
      if (c.claimInviteSentAt) return { text: `Claim invite sent ${short(c.claimInviteSentAt)}`, due: false };
      return { text: "On air. Waiting to be claimed", due: false };
    case "claimed":
      return { text: c.claimedAt ? `Claimed ${dayMonth(c.claimedAt, ctx.timeZone)}. Running it themselves` : "Claimed. Running it themselves", due: false };
    case "declined":
      return { text: c.answeredAt ? `Said no ${short(c.answeredAt)}. Don’t ask again` : "Said no. Don’t ask again", due: false };
    case "no_answer":
      return { text: "No answer after the reminder. Don’t ask again", due: false };
  }
}

/** Days from the market's today to a `YYYY-MM-DD` date (negative: overdue). */
export function dueIn(date: string, ctx: Pick<Ctx, "now" | "timeZone">): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${localDate(ctx.now, ctx.timeZone)}T00:00:00Z`)) / 86_400_000);
}

function capital(s: string) {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

export type ActionKind = "ask" | "remind" | "no-answer" | "set-up" | "open-setup" | "open-station";

/** The row's button, or null when there's nothing to do (claimed, declined, no answer). */
export function actionFor(c: CreatorX, ctx: Pick<Ctx, "now" | "timeZone">): { kind: ActionKind; label: string } | null {
  switch (c.stage) {
    case "found":
      return c.doNotAsk ? null : { kind: "ask", label: "Ask" };
    case "asked":
      if (!reminderDue(c, ctx)) return null;
      return c.remindedAt ? { kind: "no-answer", label: "No answer" } : { kind: "remind", label: "Remind" };
    case "said_yes":
      return { kind: "set-up", label: "Set up" };
    case "already_licensed":
      return c.station ? { kind: "open-station", label: "Open" } : { kind: "set-up", label: "Set up" };
    case "setting_up":
      return { kind: "open-setup", label: "Open" };
    case "on_air":
      return { kind: "open-station", label: "Open" };
    default:
      return null;
  }
}

/** Rows that need someone today: an ask to send, a reminder due, a yes to set up. The rail's count. */
export function needsAction(c: CreatorX, ctx: Pick<Ctx, "now" | "timeZone">): boolean {
  const a = actionFor(c, ctx);
  return !!a && (a.kind === "ask" || a.kind === "remind" || a.kind === "no-answer" || a.kind === "set-up");
}

const FINISHED: ReadonlySet<CreatorStage> = new Set(["claimed", "declined", "no_answer"]);

function rank(c: CreatorX, ctx: Pick<Ctx, "now" | "timeZone">): number {
  if (FINISHED.has(c.stage)) return 3;
  if (reminderDue(c, ctx)) return 0;
  if (waitingForSetup(c)) return 1;
  return 2;
}

/**
 * The pipeline's order: overdue and due follow-ups first (oldest due first), then new yeses (newest
 * yes first), then everything else by the next action's date, then finished rows (latest first).
 */
export function pipelineOrder<C extends CreatorX>(creators: readonly C[], ctx: Pick<Ctx, "now" | "timeZone">): C[] {
  const when = (c: CreatorX) => c.claimedAt ?? c.answeredAt ?? c.askedAt ?? "";
  return creators
    .map((c, i) => ({ c, i, r: rank(c, ctx) }))
    .sort((a, b) => {
      if (a.r !== b.r) return a.r - b.r;
      if (a.r === 0) return (a.c.nextActionDue ?? "").localeCompare(b.c.nextActionDue ?? "") || a.i - b.i;
      if (a.r === 1 || a.r === 3) return when(b.c).localeCompare(when(a.c)) || a.i - b.i;
      const ad = a.c.nextActionDue ?? "9999";
      const bd = b.c.nextActionDue ?? "9999";
      return ad.localeCompare(bd) || a.i - b.i;
    })
    .map((x) => x.c);
}
