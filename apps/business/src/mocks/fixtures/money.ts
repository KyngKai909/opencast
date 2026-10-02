// The Money area's mock state and rules: deposits on their way (which source each came from), the
// fee and the airings estimate a quote gives, when a bank transfer arrives, what each linked
// source is called, and the pretend geocoder and category reach for getting started. Money itself
// only moves through db.ts's move(), so the shell's "Available", the Balance page and the runway
// always agree.
//
// How deposits settle in mock mode: a card or a Clear business account arrives at once. A bank
// transfer through Clear is pending until its expected time (two business days on, 9:00 am in the
// market, so a Saturday evening transfer arrives Tuesday), and settles on the first read after the
// mock clock passes it (`?clock=2026-09-29T17:00:00Z` opens the app on Tuesday).

import type { FundingSource, Spot } from "@opencast/contracts";
import { MARKET, STATIONS } from "./stations";
import { OFFSET_HOURS } from "./time";

const KEY = "oc-mock-spots-money";
const VERSION = 2;
const fresh = (): MoneyState => ({ version: VERSION, deposits: {}, clearTransfers: {} });

export interface MoneyState {
  version: number;
  /** Each deposit's source, by deposit id: the pending list only carries the method. */
  deposits: Record<string, { businessId: string; sourceId: string; amountMicros: number; status: "pending" | "arrived" | "cancelled" }>;
  /** Transfers from Clear already credited, by transaction hash (confirming is idempotent). */
  clearTransfers: Record<string, { businessId: string; depositId: string; amountMicros: number }>;
}

let state: MoneyState | null = null;

export function moneyState(): MoneyState {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as MoneyState) : null;
    state = saved && saved.version === VERSION ? saved : fresh();
  } catch {
    state = fresh();
  }
  return state;
}

export function saveMoneyState() {
  try {
    localStorage.setItem(KEY, JSON.stringify(moneyState()));
  } catch {
    // Private windows: kept for this visit only.
  }
}

/** Tests start clean. */
export function resetMoneyState() {
  state = fresh();
}

const $ = (dollars: number) => Math.round(dollars * 1_000_000);
const HOUR = 3600e3;

/** Stripe's card fee at cost, 2.9% plus 30 cents, to the cent: $250 is $7.55. Bank and Clear: none. */
export function depositFee(amountMicros: number, kind: FundingSource["kind"]): number {
  if (kind !== "card") return 0;
  const cents = Math.round((amountMicros * 0.029 + 300_000) / 10_000);
  return cents * 10_000;
}

/**
 * When a bank transfer arrives: two business days on (weekends skipped), at 9:00 am in the
 * market. Saturday or Sunday gives Tuesday; Monday gives Wednesday.
 */
export function bankArrival(from: Date): Date {
  const local = new Date(from.getTime() - OFFSET_HOURS * HOUR);
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  let left = 2;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return new Date(d.getTime() + (9 + OFFSET_HOURS) * HOUR);
}

/** The average tuned in the airings estimate works from: a station like BEAT 12.1 on a weeknight. */
export const REFERENCE_TUNED_IN = 260;
export const REFERENCE_STATION = STATIONS.find((s) => s.callSign === "BEAT")!;

/** The rate the estimate uses: the business's live spot's, or $8.00 per 1,000 before it has one. */
export function estimateBasis(spots: Spot[]): { rateKind: "per_thousand" | "per_airing"; rateMicros: number } {
  const live = spots.find((s) => s.state !== "ended" && s.state !== "draft");
  return live ? { rateKind: live.rate.kind, rateMicros: live.rate.micros } : { rateKind: "per_thousand", rateMicros: $(8) };
}

/** Roughly how many airings an amount buys at that rate: $250 at $8.00 per 1,000 is 120. */
export function roughAirings(amountMicros: number, basis: { rateKind: "per_thousand" | "per_airing"; rateMicros: number }): number | null {
  const perAiring = basis.rateKind === "per_thousand" ? (basis.rateMicros * REFERENCE_TUNED_IN) / 1000 : basis.rateMicros;
  if (perAiring <= 0) return null;
  return Math.floor(amountMicros / perAiring);
}

/** "0x1234…abcd". */
export const shortHex = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/**
 * What a newly linked source is called (the provider's widget would say). A Clear account given by
 * its linked wallet (the token "linked") reads "Clear, 0x1234…abcd".
 */
export function sourceLabel(kind: FundingSource["kind"], address?: string | null): string {
  if (kind === "clear_account" && address) return `Clear, ${shortHex(address)}`;
  return { clear_bank: "Clear, Chase ending 8810", card: "Visa ending 4417", clear_account: "Clear business account" }[kind];
}

/** The business's balance account on chain, where USDC from Clear is sent (a stand-in address per business). */
export function depositAddressOf(businessId: string): string {
  return `0x0c1ea5${businessId.replace(/-/g, "")}00`.slice(0, 42);
}

/** USDC on Base, where Clear's wallets live. */
export const USDC = { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC" as const, decimals: 6 as const, chainId: 8453 };

/** The movement a deposit writes when it arrives. */
export function depositMovement(source: FundingSource): { label: string; detail: string } {
  if (source.kind === "clear_bank") {
    const bank = source.label.replace(/^Clear,\s*/, "");
    return { label: "Added by bank transfer", detail: `Through Clear, from ${bank}` };
  }
  if (source.kind === "card") return { label: "Added by card", detail: source.label };
  return { label: "Added from your Clear business account", detail: source.label };
}

// ---- Getting started: the pretend geocoder and category reach ----

/** Towns of the Inland Empire the mock can find (P10). */
export const PLACES: Record<string, { latitude: number; longitude: number }> = {
  redlands: { latitude: 34.0556, longitude: -117.1825 },
  colton: { latitude: 34.0739, longitude: -117.3137 },
  "loma linda": { latitude: 34.0483, longitude: -117.2611 },
  "san bernardino": { latitude: 34.1083, longitude: -117.2898 },
  riverside: { latitude: 33.9806, longitude: -117.3755 },
  fontana: { latitude: 34.0922, longitude: -117.435 },
  rialto: { latitude: 34.1064, longitude: -117.3703 },
  ontario: { latitude: 34.0633, longitude: -117.6509 },
  "rancho cucamonga": { latitude: 34.1064, longitude: -117.5931 },
  yucaipa: { latitude: 34.0336, longitude: -117.0431 },
  highland: { latitude: 34.1283, longitude: -117.2086 },
  corona: { latitude: 33.8753, longitude: -117.5664 },
  "moreno valley": { latitude: 33.9425, longitude: -117.2297 }
};

const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * "204 Orange St, Redlands, CA 92373" → the street and Redlands; "Colton" → Colton, no street.
 * Null when no part names a town the mock knows.
 */
export function findPlace(q: string): { streetAddress: string | null; city: string; latitude: number; longitude: number; marketId: string } | null {
  const parts = q
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i]!.toLowerCase().replace(/\s+(ca|california)?\s*\d{5}$/, "").replace(/\s+ca$/, "").trim();
    const hit = PLACES[key];
    if (hit) return { streetAddress: i > 0 ? parts.slice(0, i).join(", ") : null, city: title(key), ...hit, marketId: MARKET.id };
  }
  return null;
}

/** Which stations don't carry which categories (each station's break rule, in master control). */
export const BLOCKED_CATEGORIES: Record<string, string[]> = {
  HALL: ["Alcohol", "Gambling"],
  PREP: ["Alcohol", "Gambling"],
  CIVC: ["Gambling"]
};

export function categoryReach(category: string) {
  const total = STATIONS.length;
  const blockedBy = STATIONS.filter((s) => (BLOCKED_CATEGORIES[s.callSign ?? ""] ?? []).some((c) => c.toLowerCase() === category.toLowerCase())).map((s) => s.callSign!);
  const sometimes = [...new Set(Object.values(BLOCKED_CATEGORIES).flat())].map((c) => c.toLowerCase());
  return { category, marketName: MARKET.name, reached: total - blockedBy.length, total, blockedBy, sometimesBlocked: sometimes };
}
