// How the market writes an offer: its format line, its terms in two lines, each deal in a
// sentence, when a carrier airs it. One place, so the market row, the program page, the maker's
// preview ("word for word what a carrying station sees") and the carriers page say the same thing.

import type { CarriageTerm, CashPlusBarter, Offer, Slot, StationIdent } from "@opencast/contracts";
import { duration, money } from "@opencast/ui";
import type { ProgramFormat } from "../../api/types";
import { stationLabel } from "../../station/slug";

const HOUR = 3_600_000;
const MIN = 60_000;

const TERM_WORD: Record<CarriageTerm, string> = { barter: "barter", cash: "cash", cash_plus_barter: "cash plus barter", free: "free" };

export function capitalise(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** "Barter or cash", "Cash, barter or cash plus barter", "Free". */
export function termNames(terms: readonly CarriageTerm[]): string {
  const words = terms.map((t) => TERM_WORD[t]);
  if (words.length <= 1) return capitalise(words[0] ?? "");
  return capitalise(`${words.slice(0, -1).join(", ")} or ${words.at(-1)}`);
}

/** An episode's length in the market's words: "30 min", "60 min", "2 hr", "2 hr 20 min". */
export function lengthText(ms: number): string {
  const mins = Math.round(ms / MIN);
  if (mins < 90) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** The long form for a page's description: "60 minutes", "2 hours 20 minutes". */
export function lengthLong(ms: number): string {
  const mins = Math.round(ms / MIN);
  if (mins < 90) return `${mins} minutes`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} ${h === 1 ? "hour" : "hours"}${m ? ` ${m} minutes` : ""}`;
}

const CADENCE: Record<NonNullable<ProgramFormat["cadence"]>, string> = { weekly: "Weekly", nightly: "Nightly", weeknights: "Weeknights" };

/**
 * The program's format line: "Series, 22 episodes of 2 hr 20 min", "Weekly, live, 60 min",
 * "Weekly, live, 60 min, radio band", "One-off, 2 hr 15 min". Without the L1 format it falls back
 * to what the contract has ("Series, 15 episodes").
 */
export function formatLine(p: { episodeCount: number; live: boolean; format?: ProgramFormat }, opts: { band?: boolean; long?: boolean } = {}): string {
  const f = p.format;
  const len = f?.episodeLengthMs ? (opts.long ? lengthLong(f.episodeLengthMs) : lengthText(f.episodeLengthMs)) : null;
  const parts: string[] = [];
  if (f?.cadence) {
    parts.push(CADENCE[f.cadence]);
    if (p.live) parts.push("live");
    if (len) parts.push(len);
  } else if (f?.kind === "one_off") {
    parts.push("One-off");
    if (p.live) parts.push("live");
    if (len) parts.push(len);
  } else {
    const eps = `${p.episodeCount} ${p.episodeCount === 1 ? "episode" : "episodes"}`;
    parts.push("Series", len ? `${eps} of ${len}` : eps);
  }
  if (opts.band !== false && f && f.bands.length === 1 && f.bands[0] === "radio") parts.push("radio band");
  return parts.join(", ");
}

/** "HALL 90.8", "Inland Sound Lab", "Opencast catalog". */
export function makerName(maker: StationIdent): string {
  if (maker.kind === "catalog") return "Opencast catalog";
  if (maker.callSign) return maker.channel ? `${maker.callSign} ${maker.channel}` : maker.callSign;
  return maker.name;
}

/** The maker's kind tag: Station, Studio, Catalog. */
export function makerKindWord(kind: Offer["makerKind"]): string {
  return kind === "station" ? "Station" : kind === "studio" ? "Studio" : "Catalog";
}

/** Who fills the barter share, from where the reader stands: "You", "HALL", "The studio". */
export function whoFills(offer: Pick<Offer, "maker" | "makerKind">, viewerId: string | null): string {
  if (viewerId && offer.maker.id === viewerId) return "You";
  if (offer.makerKind === "studio") return "The studio";
  if (offer.makerKind === "catalog") return "Opencast";
  return stationLabel(offer.maker);
}

function fills(who: string): string {
  return who === "You" ? "You fill" : `${who} fills`;
}

/** Half-hour programs count their barter share per half hour ("1:00 a half hour"). */
function shareText(msPerHour: number, episodeLengthMs: number | null | undefined): string {
  if (episodeLengthMs && episodeLengthMs <= 30 * MIN) return `${duration(msPerHour / 2)} a half hour`;
  return `${duration(msPerHour)} an hour`;
}

export function priceText(micros: number, unit: "per_airing" | "per_hour" | null | undefined): string {
  return `${money(micros)} ${unit === "per_hour" ? "an hour" : "an airing"}`;
}

/** One deal's detail for the market row: "HALL fills 2:00 an hour", "$2.50 an airing". */
export function termDetail(offer: Offer, term: CarriageTerm, viewerId: string | null): string | null {
  const who = whoFills(offer, viewerId);
  const len = offer.program.format?.episodeLengthMs;
  switch (term) {
    case "free":
      return offer.underwriter !== undefined ? "One sponsor credit an hour" : null;
    case "barter":
      if (offer.barterFill === "credit_only") return "Underwriting credit only";
      return offer.barterMakerMsPerHour != null ? `${fills(who)} ${shareText(offer.barterMakerMsPerHour, len)}` : null;
    case "cash":
      return offer.cashPriceMicros != null ? `${priceText(offer.cashPriceMicros, offer.cashPriceUnit)}${offer.liveOnly ? ", live only" : ""}` : null;
    case "cash_plus_barter": {
      const c = offer.cashPlusBarter;
      return c ? `${priceText(c.priceMicros, c.unit)}, ${who} ${who === "You" ? "fill" : "fills"} ${duration(c.makerMsPerHour)}` : null;
    }
  }
}

/** The terms in two lines, as the market row and the maker's list draw them. */
export function termsTwoLines(offer: Offer, viewerId: string | null): { names: string; detail: string } {
  const details = offer.termsOffered
    .map((t) => termDetail(offer, t, viewerId))
    .filter((d): d is string => !!d)
    .slice(0, 2);
  return { names: termNames(offer.termsOffered), detail: details.join(", or ") };
}

export interface DealLine {
  term: CarriageTerm;
  title: string;
  helper: string;
  /** The price, always shown, including $0.00. */
  price: string;
}

/**
 * Each deal in a sentence, with its price. `short` is the program page's Deals (market 02.1);
 * `long` is Choose terms (master-control B.2).
 */
export function dealLines(offer: Offer, style: "short" | "long"): DealLine[] {
  const perHour = offer.breakMsPerHour ?? 4 * MIN;
  const who = whoFills(offer, null);
  const all = duration(perHour);
  const order: CarriageTerm[] = ["barter", "cash", "cash_plus_barter", "free"];
  return [...offer.termsOffered].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((term): DealLine => {
    const title = capitalise(TERM_WORD[term]);
    if (term === "barter") {
      const maker = offer.barterMakerMsPerHour ?? 0;
      const rest = duration(Math.max(0, perHour - maker));
      if (offer.barterFill === "credit_only")
        return { term, title, helper: style === "short" ? `${who} fills its underwriting credit only` : `No fee. ${who} fills its underwriting credit; you sell the rest.`, price: money(0) };
      return {
        term,
        title,
        helper: style === "short" ? `${who} fills ${duration(maker)} an hour; you sell ${rest}` : `No fee. ${who} fills ${duration(maker)} with its spots; you sell the other ${rest}.`,
        price: money(0)
      };
    }
    if (term === "cash")
      return {
        term,
        title,
        helper: style === "short" ? `All ${all} an hour is yours` : `You pay per ${offer.cashPriceUnit === "per_hour" ? "hour" : "airing"} and sell all ${all} of breaks.`,
        price: offer.cashPriceMicros != null ? priceText(offer.cashPriceMicros, offer.cashPriceUnit) : money(0)
      };
    if (term === "cash_plus_barter") {
      const c: CashPlusBarter | null | undefined = offer.cashPlusBarter;
      const maker = c?.makerMsPerHour ?? 0;
      const rest = duration(Math.max(0, perHour - maker));
      return {
        term,
        title,
        helper: style === "short" ? `${who} fills ${duration(maker)} an hour; you sell ${rest}` : `A lower fee. ${who} fills ${duration(maker)}; you sell ${rest}.`,
        price: c ? priceText(c.priceMicros, c.unit) : money(0)
      };
    }
    return { term, title, helper: style === "short" ? "One sponsor credit an hour; the rest is yours" : "No fee. One sponsor credit an hour; you sell the rest.", price: money(0) };
  });
}

/** "Any, within 30 days", "Up to 3, within 7 days", "Once, within 7 days". */
export function airingsText(t: { airingsPerEpisode: number | null; windowDays: number }): string {
  const n = t.airingsPerEpisode;
  return `${n == null ? "Any" : n === 1 ? "Once" : `Up to ${n}`}, within ${t.windowDays} days`;
}

/** "7 days' notice", or with `either`: "Either side, with 7 days' notice". */
export function noticeText(days: number, either = false): string {
  const d = `${days} ${days === 1 ? "day's" : "days'"} notice`;
  return either ? `Either side, with ${d}` : d;
}

/** "Any station", or "Approved by BEAT" / "You approve each". */
export function approvalText(offer: Pick<Offer, "approval" | "maker">, viewerId: string | null, style: "carrier" | "maker-list" = "carrier"): string {
  if (offer.approval === "any_station") return "Any station";
  if (style === "maker-list" && viewerId === offer.maker.id) return "You approve each";
  return `Approved by ${stationLabel(offer.maker)}`;
}

// ---- when a carrier airs it ----

const DAY_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** "23:40" to "11:40 pm". Slots are local times, so no time zone applies. */
export function slotClock(time: string): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

function daysWord(days: number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b);
  const key = set.join(",");
  if (set.length === 7) return "Nightly";
  if (key === "1,2,3,4,5") return "Weeknights";
  if (key === "0,6") return "Weekends";
  if (set.length === 1) return DAY_PLURAL[set[0]!]!;
  const names = set.map((d) => DAY_PLURAL[d]!);
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * When a carrier airs it: "Nightly at 11:00 pm", "Weeknights at 1:00 am" (`at`), or the carriers
 * table's "Nightly, 3:00 am" (`comma`). Slots at different times join with a semicolon.
 */
export function slotText(slots: readonly Slot[], style: "at" | "comma" = "at"): string {
  const byTime = new Map<string, number[]>();
  for (const s of slots) byTime.set(s.time, [...(byTime.get(s.time) ?? []), s.weekday]);
  return [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, days]) => `${daysWord(days)}${style === "at" ? " at " : ", "}${slotClock(time)}`)
    .join("; ");
}

/** A station's name in a list: "BEAT 12.1", "HALL, Study Hall" (`named`), "DUST 96.2, High Desert". */
export function stationWords(s: StationIdent, style: "channel" | "named" = "channel"): string {
  if (style === "named") return `${stationLabel(s)}, ${s.name}`;
  return s.callSign ? `${s.callSign}${s.channel ? ` ${s.channel}` : ""}` : s.name;
}

export const HOUR_MS = HOUR;

/** "high-desert" to "High Desert". */
export function marketName(slug: string | null): string {
  return (slug ?? "")
    .split("-")
    .filter(Boolean)
    .map((w) => capitalise(w))
    .join(" ");
}

export interface CarrierRow {
  key: string;
  title: string;
  detail: string | null;
  you: boolean;
}

/**
 * "Also carried by" (market 02.1): the viewing station first ("You"), then stations in its market
 * by name, then other markets: a lone station by name with its market ("DUST 96.2, High Desert"),
 * several as a count ("3 stations in Los Angeles"). Viewers only ever see the count.
 */
export function carrierRows(carriedBy: readonly { station: StationIdent; since: string; slots?: Slot[] }[], viewer: Pick<StationIdent, "id" | "marketSlug">, since: (iso: string) => string): CarrierRow[] {
  const you = carriedBy.filter((c) => c.station.id === viewer.id);
  const home = carriedBy.filter((c) => c.station.id !== viewer.id && c.station.marketSlug === viewer.marketSlug);
  const away = new Map<string, typeof carriedBy[number][]>();
  for (const c of carriedBy) if (c.station.id !== viewer.id && c.station.marketSlug !== viewer.marketSlug) away.set(c.station.marketSlug ?? "", [...(away.get(c.station.marketSlug ?? "") ?? []), c]);
  const slots = (c: { slots?: Slot[] }) => (c.slots?.length ? slotText(c.slots) : null);
  return [
    ...you.map((c) => ({ key: c.station.id, title: stationWords(c.station), detail: [slots(c), `since ${since(c.since)}`].filter(Boolean).join(", "), you: true })),
    ...home.map((c) => ({ key: c.station.id, title: stationWords(c.station), detail: slots(c), you: false })),
    ...[...away.entries()].map(([slug, list]) =>
      list.length === 1
        ? { key: list[0]!.station.id, title: `${stationWords(list[0]!.station)}${slug ? `, ${marketName(slug)}` : ""}`, detail: slots(list[0]!), you: false }
        : { key: `m-${slug}`, title: `${list.length} stations in ${marketName(slug) || "other markets"}`, detail: null, you: false }
    )
  ];
}

/** "4, every 30 minutes, marked in amber" (market 03.1). */
export function breakPointsText(points: readonly number[]): string {
  if (!points.length) return "None";
  const gaps = points.map((p, i) => p - (i ? points[i - 1]! : 0));
  const even = gaps.every((g) => Math.abs(g - gaps[0]!) < 60_000);
  const mins = Math.round(gaps[0]! / 60_000);
  return `${points.length}${even ? `, every ${mins} minutes` : ""}, marked in amber`;
}

/** "None, no speech", "Generated", "From the maker". */
export function captionsText(captions: "none" | "generated" | "uploaded" | undefined, speech: boolean | undefined): string | null {
  if (!captions) return null;
  if (captions === "none") return speech === false ? "None, no speech" : "None";
  return captions === "generated" ? "Generated" : "From the maker";
}

export const ADVISORY_WORDS = { none: "None", language: "Language", mature: "Mature" } as const;

/**
 * A program's format from its library, until the library returns one (contract request L1): a
 * series; live programs run weekly (the live block's cadence); the length is the longest episode
 * rounded up to a 30-minute block ("29:10" airs in a 30 min slot, "44:20" in 60 min).
 */
export function formatFromLibrary(program: { live: boolean; episodeCount: number }, durationsMs: readonly (number | null)[]): ProgramFormat {
  const longest = Math.max(0, ...durationsMs.map((d) => d ?? 0));
  const block = 30 * MIN;
  return { kind: program.episodeCount > 1 || program.live ? "series" : "one_off", cadence: program.live ? "weekly" : null, episodeLengthMs: longest ? Math.ceil(longest / block) * block : null, bands: ["tv", "radio"] };
}

/** "2:00" or ":30" or "90" (seconds) to milliseconds; null when it can't be read. */
export function readDuration(text: string): number | null {
  const t = text.trim();
  const m = /^(?:(\d{1,2}))?:(\d{2})$/.exec(t);
  if (m) {
    const secs = Number(m[1] ?? 0) * 60 + Number(m[2]);
    return Number(m[2]) < 60 ? secs * 1000 : null;
  }
  return /^\d+$/.test(t) ? Number(t) * 60_000 : null;
}

/** "$3.00" or "3" to micros; null when it can't be read. */
export function readMoney(text: string): number | null {
  const t = text.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100) * 10_000;
}
