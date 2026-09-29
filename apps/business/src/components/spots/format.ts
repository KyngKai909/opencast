// How the Spots pages write a spot: its state in the business's words (states.ts), its rate, its
// budget, the estimates that turn a rate into dollars and a budget into days, and the pause story
// as a timeline. Pure functions, tested in format.test.ts.

import { SPOT_RESUMED_LABELS, SPOT_STATE_LABELS, type SpotState, type TargetMatch } from "@opencast/contracts";
import { clock, money, type TagVariant, type TimelineItem } from "@opencast/ui";
import type { FilledWith, PauseStory, SpotX } from "../../api/ext/spots";

const TZ = "America/Los_Angeles";

// ---- Words ----

/** "BEAT", "BEAT and CIVC", "BEAT, CIVC and SAZN". */
export function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** ":30", ":15", "1:00". */
export function lengthWords(sec: number): string {
  return sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : `:${String(sec).padStart(2, "0")}`;
}

/** "August 31", in the market's zone. A date-only string is read as that day. */
export function dayWords(date: string | Date): string {
  const dateOnly = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const d = dateOnly ? new Date(`${date}T12:00:00Z`) : new Date(date);
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: dateOnly ? "UTC" : TZ }).format(d);
}

/** "Oct 12, 3:10 pm": a timeline's when, in the market's zone. */
export function whenWords(at: string | Date): string {
  const d = new Date(at);
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: TZ }).format(d);
  return `${day}, ${clock(d, { timeZone: TZ })}`;
}

// ---- State ----

/** The state in the business's words (states.ts), with the number of stations filled in. */
export function stateLabel(s: Pick<SpotX, "state" | "inRotationOn" | "back">): string {
  if (s.state === "listed" && s.back) return SPOT_RESUMED_LABELS.business;
  const label = SPOT_STATE_LABELS[s.state].business;
  if (s.state === "in_rotation") return s.inRotationOn === 1 ? "In rotation on 1 station" : label.replace("{n}", String(s.inRotationOn));
  return label;
}

/**
 * The list's words for a state (biz-spots 01.1): in review adds how long it usually takes, as drawn.
 * The phone's short tags are `shortStateLabel`.
 */
export function listStateLabel(s: Pick<SpotX, "state" | "inRotationOn" | "back">): string {
  if (s.state === "in_review") return `${SPOT_STATE_LABELS.in_review.business}, usually a few hours`;
  return stateLabel(s);
}

/** The phone list's short tags (biz-spots 06.1). New short forms are marked in new-copy.md. */
export function shortStateLabel(s: Pick<SpotX, "state" | "back">): string {
  switch (s.state) {
    case "in_rotation":
      return "In rotation";
    case "paused_daily_cap":
      return "Until midnight";
    case "paused_budget":
      return "Budget spent";
    case "paused_balance":
      return "Balance";
    case "listed":
      return s.back ? "Back" : SPOT_STATE_LABELS.listed.business;
    default:
      return SPOT_STATE_LABELS[s.state].business;
  }
}

/** The tag's look, by what the state asks of the business: running (solid), needs attention (standby), being checked (dashed). */
export function stateTag(state: SpotState): TagVariant {
  switch (state) {
    case "in_rotation":
      return "solid";
    case "paused_daily_cap":
    case "paused_budget":
    case "paused_balance":
    case "waiting_for_you":
      return "standby";
    case "in_review":
    case "draft":
      return "listed";
    default:
      return "plain";
  }
}

export const PAUSED_STATES: readonly SpotState[] = ["paused_budget", "paused_balance", "waiting_for_you"];
export const isPaused = (state: SpotState) => PAUSED_STATES.includes(state);

/** Where a spot opens: a draft carries on where it stopped; an ended one opens its results. */
export function spotHref(base: string, s: SpotX): string {
  if (s.state === "draft") return s.file ? `${base}/spots/${s.id}/setup/rate` : `${base}/spots/${s.id}/setup`;
  if (s.state === "ended") return `${base}/results?spot=${s.id}`;
  return `${base}/spots/${s.id}`;
}

/** Ended spots go last; the rest keep the order they were made in. */
export function listOrder(spots: SpotX[]): SpotX[] {
  return [...spots.filter((s) => s.state !== "ended"), ...spots.filter((s) => s.state === "ended")];
}

// ---- Money ----

/** "$8.00" and "per 1,000", or "$4.00" and "an airing". */
export function rateParts(rate: SpotX["rate"]): { amount: string; unit: string } {
  return { amount: money(rate.micros), unit: rate.kind === "per_thousand" ? "per 1,000" : "an airing" };
}

/**
 * The budget column (biz-spots 01.1): "$176.40 of $300", "$0 of $200", "$240.00 of $240"; a spot
 * paused for the day shows the day: "$4.00 of $4.00 today".
 */
export function budgetWords(s: Pick<SpotX, "state" | "budget">): string {
  const b = s.budget;
  if (s.state === "paused_daily_cap" && b.dailyCapMicros !== null) return `${money(b.usedTodayMicros)} of ${money(b.dailyCapMicros)} today`;
  const used = b.usedMicros === 0 ? money(0, { trimCents: true }) : money(b.usedMicros);
  return `${used} of ${money(b.totalMicros, { trimCents: true })}`;
}

/** How full the budget bar is, 0 to 1 (today's cap when paused for the day). */
export function budgetShare(s: Pick<SpotX, "state" | "budget">): number {
  const b = s.budget;
  const [used, total] = s.state === "paused_daily_cap" && b.dailyCapMicros ? [b.usedTodayMicros, b.dailyCapMicros] : [b.usedMicros, b.totalMicros];
  return total > 0 ? Math.min(1, Math.max(0, used / total)) : 0;
}

/** The phone list's line under the title (biz-spots 06.1). */
export function phoneDetail(s: SpotX): string {
  const b = s.budget;
  switch (s.state) {
    case "in_rotation": {
      const names = (s.inRotationStations ?? []).map((x) => x.callSign ?? x.name);
      return names.length ? `${budgetWords(s)}. On ${names.join(", ")}` : budgetWords(s);
    }
    case "paused_daily_cap":
      return b.dailyCapMicros !== null ? `Today's ${money(b.dailyCapMicros)} is spent` : budgetWords(s);
    case "in_review":
      return "Being checked";
    case "ended":
      return s.endsOn ? `Ended ${dayWords(s.endsOn)}` : SPOT_STATE_LABELS.ended.business;
    case "paused_budget":
      return `Its ${money(b.totalMicros, { trimCents: true })} budget is spent`;
    case "draft":
      return s.file ? "Not listed yet" : "Not uploaded yet";
    default:
      return budgetWords(s);
  }
}

/** The list's line under a title: ":30, code ORANGE10", or ":30. Ended August 31". */
export function spotLine(s: SpotX): string {
  const len = lengthWords(s.lengthSec);
  if (s.state === "ended") return s.endsOn ? `${len}. Ended ${dayWords(s.endsOn)}` : len;
  return s.code ? `${len}, code ${s.code.code}` : len;
}

// ---- Estimates (P7, until the API gives them) ----

export interface MatchSummary {
  included: TargetMatch[];
  excluded: TargetMatch[];
  /** The lowest and highest an airing costs across the stations that will see it. */
  low: number | null;
  high: number | null;
  /** The middle of each station's range, averaged. */
  mid: number | null;
}

export function summarizeMatches(stations: TargetMatch[]): MatchSummary {
  const included = stations.filter((s) => s.included);
  const excluded = stations.filter((s) => !s.included);
  const costs = included.map((s) => s.estimatedCostPerAiringMicros).filter((c): c is { low: number; high: number } => !!c);
  if (!costs.length) return { included, excluded, low: null, high: null, mid: null };
  return {
    included,
    excluded,
    low: Math.min(...costs.map((c) => c.low)),
    high: Math.max(...costs.map((c) => c.high)),
    mid: costs.reduce((t, c) => t + (c.low + c.high) / 2, 0) / costs.length
  };
}

/**
 * The estimates match costs at the saved rate; while a new rate is typed, they scale with it
 * (per 1,000, cost follows the rate) or are the rate itself (per airing).
 */
export function scaleCost(cost: number, savedRate: SpotX["rate"], typed: SpotX["rate"]): number {
  if (typed.kind === "per_airing") return typed.micros;
  if (savedRate.kind !== "per_thousand" || savedRate.micros <= 0) return cost;
  return Math.round((cost * typed.micros) / savedRate.micros / 10_000) * 10_000;
}

/** "About 5 airings a day, for about 25 days" (with a cap), or airings in all (without). */
export function budgetEstimate(totalMicros: number, capMicros: number | null, midCost: number | null): { perDay: number | null; days: number | null; inAll: number | null } {
  if (!midCost || midCost <= 0 || totalMicros <= 0) return { perDay: null, days: null, inAll: null };
  if (capMicros && capMicros > 0) return { perDay: Math.max(1, Math.round(capMicros / midCost)), days: Math.max(1, Math.round(totalMicros / capMicros)), inAll: null };
  return { perDay: null, days: null, inAll: Math.max(1, Math.round(totalMicros / midCost)) };
}

/** "$200 more is about 17 days at the same pace". Null when the spot has no pace yet. */
export function raiseDays(raiseMicros: number, pacePerDayMicros: number | null | undefined): number | null {
  if (!pacePerDayMicros || pacePerDayMicros <= 0) return null;
  return Math.max(1, Math.round(raiseMicros / pacePerDayMicros));
}

/** The amounts a raise offers (biz-spots 04.1), and the first one to choose: $200, or the most the balance covers. */
export const RAISE_AMOUNTS = [100_000_000, 200_000_000, 300_000_000] as const;

export function defaultRaise(availableMicros: number): number {
  if (availableMicros >= RAISE_AMOUNTS[1]) return RAISE_AMOUNTS[1];
  return [...RAISE_AMOUNTS].reverse().find((a) => a <= availableMicros) ?? RAISE_AMOUNTS[0];
}

// ---- Targeting words ----

const DAYPART_WORDS: Record<string, string> = { mornings: "mornings", afternoons: "afternoons", evenings: "evenings", late_night: "late night" };

/** "Within 10 mi, these kinds, afternoons and evenings". */
export function targetingWords(t: { withinMiles: number | null; stationCategories: string[]; dayparts: string[] }, allKinds: number, allDayparts: number): string {
  const parts: string[] = [];
  if (t.withinMiles !== null) parts.push(`Within ${t.withinMiles} mi`);
  parts.push(t.stationCategories.length === 0 || t.stationCategories.length >= allKinds ? "every kind" : "these kinds");
  parts.push(t.dayparts.length === 0 || t.dayparts.length >= allDayparts ? "any time of day" : listWords(t.dayparts.map((d) => DAYPART_WORDS[d] ?? d)));
  const s = parts.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A matched station's line: "Public affairs, 0.8 mi", "Food, 8.9 mi. From Monday", "Sports, not chosen". */
export function matchLine(m: TargetMatch): string {
  const kind = m.category ?? "";
  if (!m.included) return [kind, m.reason].filter(Boolean).join(", ");
  const where = m.miles !== null ? `${kind}, ${m.miles} mi` : kind;
  return m.reason ? `${where}. ${m.reason}` : where;
}

// ---- The pause story ----

export const FILLED_WORDS: Record<FilledWith, string> = {
  backup_rotation: "Filled from its backup rotation",
  another_spot: "Added another spot from the market",
  station_id: "Station ID and bumpers filled the time"
};

function daypartOf(at: string): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(new Date(at)));
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

/**
 * What happened, as the paused page tells it (biz-spots 04.1): the budget reached, out of the
 * market with the stations told, the held airings that still air, and where it stands now.
 */
export function pauseTimeline(title: string, p: PauseStory): TimelineItem[] {
  const names = p.stations.map((s) => s.station.callSign ?? s.station.name);
  const at = whenWords(p.pausedAt);
  const items: TimelineItem[] = [];
  if (p.reason === "budget_spent")
    items.push({ state: "done", when: at, title: "Budget reached", detail: p.lastHold ? `The last ${money(p.lastHold.amountMicros)} was held for an airing on ${p.lastHold.station.callSign ?? p.lastHold.station.name}` : undefined });
  else if (p.reason === "balance") items.push({ state: "done", when: at, title: "Balance under a day of airings" });
  else items.push({ state: "done", when: at, title: `You paused ${title}` });
  items.push({ state: "done", when: at, title: "Out of the market, stations told", detail: names.length ? `${listWords(names)} had it in rotation` : "No station had it in rotation" });
  const n = p.held.airings;
  if (n > 0 && p.held.airedAt) {
    const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: TZ }).format(new Date(p.held.airedAt));
    items.push({ state: "done", when: `${day}, ${daypartOf(p.held.airedAt)}`, title: `${plural(n, "airing", "airings")} already held still aired`, detail: n === 1 ? "It was paid for before the pause" : "They were paid for before the pause" });
  }
  const told = p.stations.length;
  const back = told === 0 ? "" : told === 1 ? ", and the station is told" : `, and the ${told} stations are told`;
  const how = p.reason === "balance" ? "Add money and it's back in the market by itself" : p.reason === "by_you" ? "Bring it back and it's back in the market" : "Raise the budget and it's back in the market";
  items.push({ state: "current", when: "Now", title: SPOT_STATE_LABELS.waiting_for_you.business, detail: `${how}${back}` });
  if (n > 0 && !p.held.airedAt) items.push({ state: "future", when: "Still to air", title: n === 1 ? "1 airing already held still airs" : `${n} airings already held still air`, detail: n === 1 ? "It was paid for before the pause" : "They were paid for before the pause" });
  return items;
}

// ---- Typed amounts ----

/** "$8.00", "8", "1,200.5" to micros; null when it isn't an amount. */
export function parseDollars(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100) * 10_000;
}

/** An amount as a field shows it: "$8.00". */
export const dollarsText = (micros: number) => money(micros);
