// How sponsorships and orders are written on the business side: titles and lines, state tags
// (the shared labels from states.ts, with whose turn it is), the order's steps, the credit flags'
// words, and dates. Pure, so the rules are tested (format.test.ts).

import { ORDER_STATE_LABELS, SPONSORSHIP_DECLINE_LABELS, SPONSORSHIP_STATE_LABELS, type OrderState, type StationIdent } from "@opencast/contracts";
import { duration, money, type StepState } from "@opencast/ui";
import type { CreditFlag, OrderX, SponsorshipX } from "../../api/ext/deals";
import { MARKET_TZ } from "../../lib/clock";

// ---- Dates ----

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: MARKET_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** The market's date for a moment ("2026-09-26"). */
export function marketDate(t: Date | string | number): string {
  return ymd.format(new Date(t));
}

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** "October 1" for a date ("2026-10-01") or a moment (in the market's zone). */
export function dayText(date: string): string {
  const d = date.length > 10 ? parts(marketDate(date)) : parts(date);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

/** "Oct 2", for a tag. */
export function shortDay(date: string): string {
  const d = date.length > 10 ? parts(marketDate(date)) : parts(date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "August", for "since August". */
export function monthText(date: string): string {
  return parts(date.slice(0, 10)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}

/** "Saturday, October 3". */
export function weekdayText(date: string): string {
  return parts(date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

/** The 1st of the month after `today` ("2026-10-01"): when a new sponsorship starts. */
export function nextFirst(today: string): string {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Whole days from one market date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parts(to).getTime() - parts(from).getTime()) / 86_400_000);
}

// ---- Stations ----

/** "BEAT 12.1", or a studio's name ("Opencast Studio"). */
export function stationLabel(s: StationIdent): string {
  return s.callSign && s.channel ? `${s.callSign} ${s.channel}` : s.name;
}

/** "BEAT", or a studio's name. */
export function callSign(s: StationIdent): string {
  return s.callSign ?? s.name;
}

// ---- Sponsorships ----

const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** "Beat Tape Live on BEAT 12.1", "All of BEAT 12.1"; `short` drops the channel (the phone). */
export function sponsorshipTitle(x: Pick<SponsorshipX, "station" | "program">, short = false): string {
  const where = short ? callSign(x.station) : stationLabel(x.station);
  return x.program ? `${x.program.title} on ${where}` : `All of ${where}`;
}

/** "One program, weekly, live" (L1); "Credited in every break" for a whole station. */
export function sponsorshipLine(x: Pick<SponsorshipX, "program" | "programFormat">): string {
  if (!x.program) return "Credited in every break";
  return x.programFormat ? `One program, ${lower(x.programFormat)}` : "One program";
}

export type TagTone = "you" | "wait" | "on" | "plain";

/** The business's words for the state, and its tone: amber while it waits on the station, solid once it's on. */
export function sponsorshipTag(x: Pick<SponsorshipX, "state" | "station">, short = false): { text: string; tone: TagTone } {
  const text = SPONSORSHIP_STATE_LABELS[x.state].business.replace("{station}", callSign(x.station));
  switch (x.state) {
    case "requested":
      return { text, tone: "wait" };
    case "approved":
      return { text, tone: "on" };
    case "credited":
      // The phone frame (06.2) shortens "Credited on air" to "Credited".
      return { text: short ? "Credited" : text, tone: "on" };
    default:
      return { text, tone: "plain" };
  }
}

/** "BEAT's reason: We're full." for a declined request. */
export function declineLine(x: Pick<SponsorshipX, "state" | "declineReason" | "station">): string | null {
  if (x.state !== "declined" || !x.declineReason) return null;
  return `${callSign(x.station)}'s reason: ${SPONSORSHIP_DECLINE_LABELS[x.declineReason]}.`;
}

/** The Since column: "August 1" once started, "From October 1" before. */
export function sinceText(x: Pick<SponsorshipX, "startsOn">, today: string): string {
  return x.startsOn > today ? `From ${dayText(x.startsOn)}` : dayText(x.startsOn);
}

/** The phone's line: "$75.00 a month, from October 1", "$50.00 a month, since August". */
export function phoneLine(x: Pick<SponsorshipX, "startsOn" | "monthlyMicros">, today: string): string {
  const when = x.startsOn > today ? `from ${dayText(x.startsOn)}` : `since ${monthText(x.startsOn)}`;
  return `${money(x.monthlyMicros)} a month, ${when}`;
}

/** A running sponsorship that won't renew ends with its paid month: the last day of this month. */
export function endsOn(x: Pick<SponsorshipX, "state" | "renewsOn" | "startsOn">, today: string): string | null {
  if (x.renewsOn !== null || (x.state !== "credited" && x.state !== "approved")) return null;
  const first = nextFirst(x.startsOn > today ? x.startsOn : today);
  const [y, m] = first.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m - 1, 0));
  return last.toISOString().slice(0, 10);
}

/** "What's committed next month" (06.2): every approved or credited sponsorship that renews on the next 1st. */
export function nextMonthHold(list: Pick<SponsorshipX, "state" | "monthlyMicros" | "renewsOn">[], today: string): { on: string; micros: number } {
  const on = nextFirst(today);
  const micros = list.filter((x) => (x.state === "approved" || x.state === "credited") && x.renewsOn === on).reduce((sum, x) => sum + x.monthlyMicros, 0);
  return { on, micros };
}

/** Is it still something the business supports (or asked for)? */
export function isLive(x: Pick<SponsorshipX, "state">): boolean {
  return x.state === "requested" || x.state === "approved" || x.state === "credited";
}

// ---- The credit rules ----

export interface FlagWords {
  title: string;
  detail: string;
  action: "Use that" | "Remove it";
}

/** A flag's words (sponsorships 02.1); the price-or-offer ones aren't drawn (new copy). */
export function flagWords(f: CreditFlag): FlagWords {
  const quote = f.quote ?? f.text.trim();
  if (f.kind === "comparison") {
    return f.suggestion
      ? { title: `"${cap(quote)}" is a comparison`, detail: `Say what you make instead, like "${f.suggestion}"`, action: "Use that" }
      : { title: `"${cap(quote)}" is a comparison`, detail: "Say what you make instead", action: "Remove it" };
  }
  if (f.kind === "call_to_action") return { title: `"${quote}" asks people to act`, detail: "Credits thank; they don't invite. That belongs in a spot", action: "Remove it" };
  return { title: `"${quote}" is a price or an offer`, detail: "Credits don't carry prices or offers. That belongs in a spot", action: "Remove it" };
}

/** "Fix the 2 flagged phrases to send." */
export function fixLine(n: number): string {
  return n === 1 ? "Fix the flagged phrase to send." : `Fix the ${n} flagged phrases to send.`;
}

/** The credit as it airs: capitalised, one line. */
export function creditLine(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return cap(t);
}

// ---- Production orders ----

/** Whose move it is (01 note): blue the business's, amber the maker's (or Opencast's), solid finished. */
export function orderTurn(state: OrderState): TagTone {
  switch (state) {
    case "quoted":
    case "delivered":
    case "passed":
      return "you";
    case "asked":
    case "accepted":
    case "changes_requested":
    case "disputed":
      return "wait";
    case "approved":
      return "on";
    default:
      return "plain";
  }
}

/** The state tag: "Delivered, review by Oct 2". */
export function orderTag(o: Pick<OrderX, "state" | "autoApproveAt">): { text: string; tone: TagTone } {
  const text = ORDER_STATE_LABELS[o.state].business.replace("{date}", o.autoApproveAt ? shortDay(o.autoApproveAt) : "");
  return { text: text.replace(/, review by $/, ""), tone: orderTurn(o.state) };
}

/** ":30, asked September 24", ":15, delivered September 25", ":30, approved September 22". */
export function orderLine(o: Pick<OrderX, "state" | "lengthSec" | "createdAt" | "deliveredAt" | "approvedAt">): string {
  const len = duration(o.lengthSec * 1000);
  if (o.state === "approved") return `${len}, approved ${dayText(o.approvedAt ?? o.deliveredAt ?? o.createdAt)}`;
  if (o.state === "delivered" && o.deliveredAt) return `${len}, delivered ${dayText(o.deliveredAt)}`;
  return `${len}, asked ${dayText(o.createdAt)}`;
}

/** The row's action: Review a delivery, open the Spot it became, or Open the order. */
export function orderAction(o: Pick<OrderX, "state" | "spotId">): "Review" | "Spot" | "Open" {
  if (o.state === "delivered") return "Review";
  if (o.state === "approved" && o.spotId) return "Spot";
  return "Open";
}

export const ORDER_STEPS = ["Asked", "Quoted", "Paid, in the making", "Delivered", "Approved"] as const;

/** The order's five steps (04.1, 05.1): the steps before the current one read done; an approved order sits on Approved. */
export function orderSteps(state: OrderState): { label: string; state: StepState }[] {
  const at: Record<OrderState, number> = { asked: 0, passed: 0, quoted: 1, accepted: 2, changes_requested: 2, disputed: 3, delivered: 3, approved: 4, cancelled: -1 };
  const cur = at[state];
  return ORDER_STEPS.map((label, i) => ({ label, state: cur < 0 ? "todo" : i < cur ? "done" : i === cur ? "current" : "todo" }));
}

/** "1 round of changes included". */
export function roundsIncluded(n: number): string {
  if (n === 0) return "No rounds of changes included";
  return n === 1 ? "1 round of changes included" : `${n} rounds of changes included`;
}

/** The quote's Changes line: "1 round included". */
export function roundsShort(n: number): string {
  if (n === 0) return "None included";
  return n === 1 ? "1 round included" : `${n} rounds included`;
}

/** The first name part of "Jen Park, host of Beat Tape Live". */
export function voiceName(voicedBy: string | null): string | null {
  return voicedBy ? voicedBy.split(",")[0]!.trim() : null;
}

/** "From BEAT 12.1, voiced by Jen Park. Delivered today, a day early." (06.1). */
export function deliveredLine(o: Pick<OrderX, "maker" | "quote" | "deliveredAt">, today: string): string {
  const voice = voiceName(o.quote?.voicedBy ?? null);
  const from = `From ${stationLabel(o.maker)}${voice ? `, voiced by ${voice}` : ""}.`;
  if (!o.deliveredAt) return from;
  const day = marketDate(o.deliveredAt);
  const when = day === today ? "today" : dayText(o.deliveredAt);
  const early = o.quote ? daysBetween(day, o.quote.deliverBy) : 0;
  const lead = early === 1 ? ", a day early" : early > 1 ? `, ${early} days early` : "";
  return `${from} Delivered ${when}${lead}.`;
}

/** "A :15 from Opencast Studio, delivered September 25." (05.1). */
export function orderSubtitle(o: Pick<OrderX, "lengthSec" | "maker" | "deliveredAt">): string | null {
  if (!o.deliveredAt) return null;
  return `A ${duration(o.lengthSec * 1000)} from ${stationLabel(o.maker)}, delivered ${dayText(o.deliveredAt)}.`;
}

/** When a note was written, next to its author: "just now", "8:40 pm", "September 24". */
export function noteWhen(createdAt: string, nowMs: number, clockText: (t: string) => string): string {
  const age = nowMs - Date.parse(createdAt);
  if (age < 10 * 60_000) return "just now";
  if (marketDate(createdAt) === marketDate(nowMs)) return clockText(createdAt);
  return dayText(createdAt);
}

/** The ask-for-changes button: a round used, a fix that isn't, or Opencast's review when none are left. */
export function changesButton(o: Pick<OrderX, "quote" | "roundsUsed" | "notes">, usesARound: boolean): { label: string; decision: "request_changes" | "dispute" } {
  const left = (o.quote?.roundsIncluded ?? 0) - o.roundsUsed;
  if (!usesARound) return { label: "Ask for the fixes", decision: "request_changes" };
  if (left <= 0) return { label: "Ask Opencast to review it", decision: "dispute" };
  if (left === 1) return { label: o.roundsUsed === 0 ? "Ask for changes, using your 1 round" : "Ask for changes, using your last round", decision: "request_changes" };
  return { label: `Ask for changes, using 1 of your ${left} rounds`, decision: "request_changes" };
}

/** The text with each flag's fix applied, last first so earlier offsets hold (the preview). */
export function applyFixes(text: string, flags: Pick<CreditFlag, "start" | "end" | "suggestion">[]): string {
  return [...flags].sort((a, b) => b.start - a.start).reduce((t, f) => t.slice(0, f.start) + f.suggestion + t.slice(f.end), text);
}

// ---- What to sponsor (P16) ----

/** "Beat Tape Live, on BEAT 12.1", "All of BEAT 12.1". */
export function targetTitle(t: { station: StationIdent; program: { title: string } | null }): string {
  return t.program ? `${t.program.title}, on ${stationLabel(t.station)}` : `All of ${stationLabel(t.station)}`;
}

/** "Saturdays at 9:00 pm, live. No sponsors yet, room for 2"; "Weekly. No sponsors yet" when the station sets no limit. */
export function roomLine(t: { schedule: string; sponsors: number; maxSponsors: number | null }): string {
  const who = t.sponsors === 0 ? "No sponsors yet" : t.sponsors === 1 ? "1 sponsor" : `${t.sponsors} sponsors`;
  const room = t.maxSponsors === null ? "" : t.maxSponsors - t.sponsors > 0 ? `, room for ${t.maxSponsors - t.sponsors}` : ", full";
  return `${t.schedule}. ${who}${room}`;
}

/** Is there room for one more sponsor? */
export function hasRoom(t: { sponsors: number; maxSponsors: number | null }): boolean {
  return t.maxSponsors === null || t.sponsors < t.maxSponsors;
}

/** Reads a typed amount ("$75", "75.00", "1,200") as micros, or null. */
export function parseAmount(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100) * 10_000;
}
