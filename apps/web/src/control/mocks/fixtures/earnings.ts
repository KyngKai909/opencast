// Earnings, statements and audience for the mock evening (earnings 01 to 04; market 04.1).
//
// BEAT's September is the frame's: spots from the spot market (Orange Street Coffee, Inland Tire
// and Wheel, Cypress Dental, Juniper Barber Co., Citrus Valley Farmers Market) at the market's
// rates (master-control C.2), Redlands Hardware and Clear as sponsors, 214 members' pledges,
// carriage both ways (Late Crate on HALL and SAZN, Beat Tape Live on CRAT; Newsreel hour carried
// from REEL for cash; Saturday Reel is barter, which pays nothing either way). The weeks add up:
// three weekly payouts ($1,472.78) plus what's available now ($640.12) is September so far
// ($2,112.90). Per-thousand spot lines are worked out from their rate, airings and average.
//
// Held money is live: a spot put into one of tonight's breaks still to air (the Spots area fills
// db.breaks) is held at its market rate, and when its break airs it moves into Spots and the
// account. Moving money to the bank is kept in this file's own saved state.
//
// The audience is BEAT's tonight, minute by minute from 6:00 pm, drawn to the frame's numbers
// (312 now, a peak of 318 at 8:36 pm, programs averaging 184, 262 and 305), against last
// Saturday's line; after 8:42 pm it follows last week's shape, and dead air counts nobody.

import type { AudienceProgram, AudienceReportX, StatementGroup, StatementX, StationEarningsX } from "../../api/ext/earnings";
import { STATION_TZ, now } from "../../../lib/clock";
import { weekStart, zoned } from "../../components/earnings/periods";
import { dbStation, stationBreaks, stationLog } from "../db";
import { getSpots, spotById } from "./spots";
import { BEAT, CRAT, HALL, LAB, stationByRef, uid } from "./stations";
import { MIN, at } from "./time";

const $ = (dollars: number) => Math.round(dollars * 1_000_000);
const CENT = 10_000;
const toCents = (micros: number) => Math.round(micros / CENT) * CENT;

// ---------------------------------------------------------------- the spot market's rates (C.2)

export interface Rate {
  kind: "per_thousand" | "per_airing";
  micros: number;
}

export const RATES: Record<string, Rate> = {
  "Orange Street Coffee": { kind: "per_thousand", micros: $(8) },
  "Inland Tire and Wheel": { kind: "per_airing", micros: $(4) },
  "Cypress Dental": { kind: "per_thousand", micros: $(10) },
  "Redlands Hardware": { kind: "per_airing", micros: $(3) },
  "Citrus Valley Farmers Market": { kind: "per_airing", micros: $(2) },
  "Juniper Barber Co.": { kind: "per_thousand", micros: $(6) }
};

/** A per-thousand spot's cost: airings × average tuned in × rate ÷ 1,000, to the cent (18 × 262 × $8.00 ÷ 1,000 = $37.73). */
export function spotCost(rate: Rate, airings: number, averageTunedIn = 0): number {
  return rate.kind === "per_airing" ? rate.micros * airings : toCents((rate.micros * airings * averageTunedIn) / 1000);
}

/**
 * What one airing in a break still to come is held at: per airing, or per thousand at the tuned-in
 * the station expects. The spot's own rate from the spot market (the Spots area's fixtures), or
 * the business's from C.2.
 */
export function heldPerAiring(business: string | null | undefined, expectedTunedIn = 300, spotId?: string | null): number {
  let rate: Rate | undefined;
  try {
    rate = spotId ? spotById(spotId)?.rate : undefined;
  } catch {
    rate = undefined;
  }
  rate ??= business ? RATES[business] : undefined;
  if (!rate) return $(2.4);
  return rate.kind === "per_airing" ? rate.micros : toCents((rate.micros * expectedTunedIn) / 1000);
}

// ---------------------------------------------------------------- ledgers

type Period = "week" | "month" | "year";

interface PeriodLines {
  spots: { micros: number; airings: number; businesses: number };
  sponsors: { micros: number; sponsors: number };
  pledges: { micros: number; members: number; newMembers: number };
  carriageIn: { micros: number; detail: string };
  carriageOut: { micros: number; detail: string };
  production: { micros: number; orders: number };
}

interface SeedLine {
  group: StatementGroup;
  label: string;
  detail?: string | null;
  amountMicros: number;
  notSetYet?: boolean;
  airings?: number;
  rate?: Rate;
  averageTunedIn?: number;
}

interface SeedStatement {
  id: string;
  /** Monday. */
  periodStart: string;
  periodEnd: string;
  paidOn: string | null;
  destination: string | null;
  lines: SeedLine[];
}

/** Airings held for breaks still to come. */
export interface HeldEntry {
  at: string;
  airings: number;
  micros: number;
  /** Which break they sit in. */
  breakKey: string;
}

interface Ledger {
  /** As of the frames' moment, 8:42:12 pm (airings after it are added as they air). */
  periods: Record<Period, PeriodLines>;
  sponsors: Array<{ name: string; monthlyMicros: number }>;
  held: HeldEntry[];
  account: { availableMicros: number; paidOutThisMonthMicros: number };
  payout: { status: "active" | "needs_onboarding"; url: string | null; schedule: "weekly" | "monthly"; destination: string | null };
  statements: SeedStatement[];
}

const spot = (name: string, airings: number, averageTunedIn?: number): SeedLine => {
  const rate = RATES[name];
  return { group: "spots", label: name, airings, rate, averageTunedIn: rate.kind === "per_thousand" ? averageTunedIn : undefined, amountMicros: spotCost(rate, airings, averageTunedIn) };
};
const shared = (): SeedLine[] => [
  { group: "shared", label: "Opencast's share", amountMicros: 0, notSetYet: true },
  { group: "shared", label: "The pool", amountMicros: 0, notSetYet: true }
];
const cardFees = (micros: number): SeedLine => ({ group: "card_fees", label: "Pledges paid by card", detail: "Stripe's fee, passed through at cost", amountMicros: -micros });

const BEAT_BANK = "Chase ending 2231";
const HALL_BANK = "Wells Fargo ending 0917";

function beatLedger(): Ledger {
  return {
    periods: {
      week: {
        spots: { micros: $(135.09), airings: 62, businesses: 5 },
        sponsors: { micros: $(46.15), sponsors: 2 },
        pledges: { micros: $(446.58), members: 214, newMembers: 3 },
        carriageIn: { micros: $(12.3), detail: "Barter share and cash fees, Late Crate and Beat Tape Live" },
        carriageOut: { micros: 0, detail: "Saturday Reel from REEL, barter, nothing to pay" },
        production: { micros: 0, orders: 0 }
      },
      month: {
        spots: { micros: $(486.2), airings: 212, businesses: 5 },
        sponsors: { micros: $(200), sponsors: 2 },
        pledges: { micros: $(1386), members: 214, newMembers: 11 },
        carriageIn: { micros: $(43.2), detail: "Barter share and cash fees, Late Crate and Beat Tape Live" },
        carriageOut: { micros: -$(2.5), detail: "Newsreel hour from REEL, cash, 1 airing" },
        production: { micros: 0, orders: 0 }
      },
      year: {
        spots: { micros: $(1604.72), airings: 690, businesses: 6 },
        sponsors: { micros: $(800), sponsors: 2 },
        pledges: { micros: $(4120.4), members: 214, newMembers: 148 },
        carriageIn: { micros: $(131.9), detail: "Barter share and cash fees, Late Crate and Beat Tape Live" },
        carriageOut: { micros: -$(12.5), detail: "Newsreel hour from REEL, cash, 5 airings" },
        production: { micros: 0, orders: 0 }
      }
    },
    sponsors: [
      { name: "Redlands Hardware", monthlyMicros: $(100) },
      { name: "Clear", monthlyMicros: $(100) }
    ],
    // Tonight: 9 airings in 4 breaks, $21.60. The rest of the week: 41 airings on Sunday, $16.80.
    held: [
      { at: at("21:58"), airings: 2, micros: $(4.8), breakKey: "21:58" },
      { at: at("22:28:30"), airings: 3, micros: $(7.2), breakKey: "22:28:30" },
      { at: at("23:04"), airings: 2, micros: $(4.8), breakKey: "23:04" },
      { at: at("23:38"), airings: 2, micros: $(4.8), breakKey: "23:38" },
      { at: at("+1 18:00"), airings: 41, micros: $(16.8), breakKey: "sunday" }
    ],
    account: { availableMicros: $(640.12), paidOutThisMonthMicros: $(1472.78) },
    payout: { status: "active", url: null, schedule: "weekly", destination: BEAT_BANK },
    statements: [
      {
        // The frame (03.1): paid Monday, September 21.
        id: uid(630003),
        periodStart: day(-12),
        periodEnd: day(-6),
        paidOn: day(-5),
        destination: BEAT_BANK,
        lines: [
          spot("Orange Street Coffee", 18, 262),
          spot("Inland Tire and Wheel", 14),
          spot("Cypress Dental", 12, 240),
          spot("Juniper Barber Co.", 10, 205),
          { group: "sponsors_pledges", label: "Sponsors", detail: "A week of Redlands Hardware and Clear", amountMicros: $(46.15) },
          { group: "sponsors_pledges", label: "Pledges", detail: "61 members charged this week", amountMicros: $(374) },
          { group: "carriage", label: "Late Crate on HALL and SAZN", detail: "Your barter share, 8 airings", amountMicros: $(8.1) },
          { group: "carriage", label: "Beat Tape Live on CRAT", detail: "Cash, 1 airing", amountMicros: $(3) },
          ...shared(),
          cardFees($(12.66))
        ]
      },
      {
        id: uid(630002),
        periodStart: day(-19),
        periodEnd: day(-13),
        paidOn: day(-12),
        destination: BEAT_BANK,
        lines: [
          spot("Orange Street Coffee", 16, 240),
          spot("Inland Tire and Wheel", 12),
          spot("Cypress Dental", 12, 228),
          spot("Juniper Barber Co.", 10, 190),
          { group: "sponsors_pledges", label: "Sponsors", detail: "A week of Redlands Hardware and Clear", amountMicros: $(46.15) },
          { group: "sponsors_pledges", label: "Pledges", detail: "52 members charged this week", amountMicros: $(326) },
          { group: "carriage", label: "Late Crate on HALL and SAZN", detail: "Your barter share, 8 airings", amountMicros: $(7.2) },
          { group: "carriage", label: "Beat Tape Live on CRAT", detail: "Cash, 1 airing", amountMicros: $(3) },
          { group: "carriage", label: "Newsreel hour from REEL", detail: "Cash, 1 airing", amountMicros: -$(2.5) },
          ...shared(),
          cardFees($(11.22))
        ]
      },
      {
        id: uid(630001),
        periodStart: day(-26),
        periodEnd: day(-20),
        paidOn: day(-19),
        destination: BEAT_BANK,
        lines: [
          spot("Orange Street Coffee", 16, 225),
          spot("Inland Tire and Wheel", 10),
          spot("Cypress Dental", 10, 210),
          spot("Juniper Barber Co.", 10, 150),
          { group: "sponsors_pledges", label: "Sponsors", detail: "Redlands Hardware and Clear, from September 1", amountMicros: $(61.55) },
          { group: "sponsors_pledges", label: "Pledges", detail: "44 members charged this week", amountMicros: $(272.6) },
          { group: "carriage", label: "Late Crate on HALL and SAZN", detail: "Your barter share, 7 airings", amountMicros: $(6.6) },
          { group: "carriage", label: "Beat Tape Live on CRAT", detail: "Cash, 1 airing", amountMicros: $(3) },
          ...shared(),
          cardFees($(9.3))
        ]
      },
      {
        id: uid(630000),
        periodStart: day(-33),
        periodEnd: day(-27),
        paidOn: day(-26),
        destination: BEAT_BANK,
        lines: [
          spot("Orange Street Coffee", 12, 210),
          spot("Inland Tire and Wheel", 8),
          spot("Cypress Dental", 8, 200),
          { group: "sponsors_pledges", label: "Sponsors", detail: "A week of Redlands Hardware and Clear", amountMicros: $(46.15) },
          { group: "sponsors_pledges", label: "Pledges", detail: "40 members charged this week", amountMicros: $(248) },
          { group: "carriage", label: "Late Crate on HALL", detail: "Your barter share, 6 airings", amountMicros: $(5.4) },
          ...shared(),
          cardFees($(8.54))
        ]
      }
    ]
  };
}

function hallLedger(): Ledger {
  return {
    periods: {
      week: {
        spots: { micros: $(18.4), airings: 9, businesses: 2 },
        sponsors: { micros: 0, sponsors: 0 },
        pledges: { micros: $(61), members: 38, newMembers: 1 },
        carriageIn: { micros: $(5.2), detail: "Barter share, Slow Hours on BEAT" },
        carriageOut: { micros: 0, detail: "Nothing carried for cash" },
        production: { micros: 0, orders: 0 }
      },
      month: {
        spots: { micros: $(64.2), airings: 31, businesses: 3 },
        sponsors: { micros: 0, sponsors: 0 },
        pledges: { micros: $(212), members: 38, newMembers: 4 },
        carriageIn: { micros: $(18.4), detail: "Barter share, Slow Hours on BEAT" },
        carriageOut: { micros: 0, detail: "Nothing carried for cash" },
        production: { micros: 0, orders: 0 }
      },
      year: {
        spots: { micros: $(402.6), airings: 188, businesses: 4 },
        sponsors: { micros: 0, sponsors: 0 },
        pledges: { micros: $(1310), members: 38, newMembers: 22 },
        carriageIn: { micros: $(96.8), detail: "Barter share, Slow Hours on BEAT" },
        carriageOut: { micros: 0, detail: "Nothing carried for cash" },
        production: { micros: 0, orders: 0 }
      }
    },
    sponsors: [],
    held: [
      { at: at("21:30"), airings: 2, micros: $(2.4), breakKey: "21:30" },
      { at: at("+1 20:00"), airings: 9, micros: $(3.6), breakKey: "sunday" }
    ],
    account: { availableMicros: $(88.2), paidOutThisMonthMicros: $(206.4) },
    payout: { status: "active", url: null, schedule: "weekly", destination: HALL_BANK },
    statements: [
      {
        id: uid(631001),
        periodStart: day(-12),
        periodEnd: day(-6),
        paidOn: day(-5),
        destination: HALL_BANK,
        lines: [
          spot("Inland Tire and Wheel", 6),
          spot("Citrus Valley Farmers Market", 5),
          { group: "sponsors_pledges", label: "Pledges", detail: "14 members charged this week", amountMicros: $(66) },
          { group: "carriage", label: "Slow Hours on BEAT", detail: "Your barter share, 5 airings", amountMicros: $(4.5) },
          ...shared(),
          cardFees($(2.44))
        ]
      }
    ]
  };
}

/** A studio (market 04.1): no breaks or members of its own; its programs earn on the stations that carry them. */
function labLedger(): Ledger {
  const carried = "Barter share and cash fees, Crate Diggers Radio Hour, Studio Notes and Loops for Late Nights";
  const none = { micros: 0, detail: "" };
  const blank = { spots: { micros: 0, airings: 0, businesses: 0 }, sponsors: { micros: 0, sponsors: 0 }, pledges: { micros: 0, members: 0, newMembers: 0 }, carriageOut: none, production: { micros: 0, orders: 0 } };
  return {
    periods: {
      week: { ...blank, carriageIn: { micros: $(52.8), detail: carried } },
      month: { ...blank, carriageIn: { micros: $(186.4), detail: carried } },
      year: { ...blank, carriageIn: { micros: $(512.6), detail: carried } }
    },
    sponsors: [],
    held: [
      { at: at("23:00"), airings: 2, micros: $(1.6), breakKey: "HALL 23:00" },
      { at: at("25:00"), airings: 2, micros: $(1.6), breakKey: "SAZN 25:00" },
      { at: at("+1 19:00"), airings: 31, micros: $(12.8), breakKey: "sunday" }
    ],
    account: { availableMicros: $(186.4), paidOutThisMonthMicros: 0 },
    // Hasn't finished setting up where it's paid: the money waits in its Clear account.
    payout: { status: "needs_onboarding", url: "https://clear.example.com/setup/inland-sound-lab", schedule: "weekly", destination: null },
    statements: []
  };
}

/** A date-only value, days from the mock's day ("2026-09-14" for -12). */
function day(offset: number): string {
  return at(`${offset >= 0 ? "+" : ""}${offset} 12:00`).slice(0, 10);
}

const LEDGERS: Record<string, () => Ledger> = { [BEAT.id]: beatLedger, [HALL.id]: hallLedger, [LAB.id]: labLedger };
const cache = new Map<string, Ledger>();

export function ledgerOf(stationId: string): Ledger | null {
  if (!LEDGERS[stationId]) return null;
  if (!cache.has(stationId)) cache.set(stationId, LEDGERS[stationId]());
  return cache.get(stationId)!;
}

// ---------------------------------------------------------------- saved state: money moved to the bank

const KEY = "oc-mock-control-earnings";
const VERSION = 1;

interface Saved {
  version: number;
  moves: Array<{ id: string; stationId: string; amountMicros: number; at: string; scheduledFor: string }>;
}

let saved: Saved | null = null;

function state(): Saved {
  if (saved) return saved;
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Saved) : null;
    saved = s && s.version === VERSION ? s : { version: VERSION, moves: [] };
  } catch {
    saved = { version: VERSION, moves: [] };
  }
  return saved;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state()));
  } catch {
    // Private windows: kept for this visit only.
  }
}

export function resetEarnings() {
  saved = { version: VERSION, moves: [] };
  save();
}

// ---------------------------------------------------------------- held and settled

/** The frames' moment: airings after it are counted as they happen. */
const BASE = () => at("20:42:12");

/** Spots the spot market put in breaks still to come tonight (db.breaks), held at their rate. */
export function heldFromBreaks(stationId: string): HeldEntry[] {
  return stationBreaks(stationId, BASE()).flatMap((b) => {
    const spots = b.fills.filter((f) => f.kind === "spot");
    if (!spots.length) return [];
    return [{ at: b.startsAt, airings: spots.length, micros: spots.reduce((a, f) => a + heldPerAiring(f.business, 300, f.spotId), 0), breakKey: b.id }];
  });
}

/** Everything held for a station, and what of it has aired since the frames' moment. */
export function heldSplit(stationId: string, t = now().toISOString()) {
  const l = ledgerOf(stationId);
  const all = [...(l?.held ?? []), ...heldFromBreaks(stationId)];
  const aired = all.filter((h) => h.at <= t);
  const pending = all.filter((h) => h.at > t);
  const endOfTonight = at("30:00");
  const endOfWeek = new Date(weekStart(now(), STATION_TZ).getTime() + 7 * 24 * 3600e3).toISOString();
  const tonight = pending.filter((h) => h.at < endOfTonight);
  const rest = pending.filter((h) => h.at >= endOfTonight && h.at < endOfWeek);
  const sum = (xs: HeldEntry[], k: "airings" | "micros") => xs.reduce((a, h) => a + h[k], 0);
  return {
    tonightMicros: sum(tonight, "micros"),
    tonightAirings: sum(tonight, "airings"),
    tonightBreaks: new Set(tonight.map((h) => h.breakKey)).size,
    restOfWeekMicros: sum(rest, "micros"),
    restOfWeekAirings: sum(rest, "airings"),
    airedMicros: sum(aired, "micros"),
    airedAirings: sum(aired, "airings")
  };
}

// ---------------------------------------------------------------- earnings

export function nextMonday(): string {
  const d = new Date(weekStart(now(), STATION_TZ).getTime() + 7 * 24 * 3600e3 + 12 * 3600e3);
  const z = zoned(d, STATION_TZ);
  return `${z.y}-${String(z.m + 1).padStart(2, "0")}-${String(z.d).padStart(2, "0")}`;
}

export function availableMicros(stationId: string): number {
  const l = ledgerOf(stationId);
  if (!l) return 0;
  const moved = state().moves.filter((m) => m.stationId === stationId).reduce((a, m) => a + m.amountMicros, 0);
  return l.account.availableMicros + heldSplit(stationId).airedMicros - moved;
}

/**
 * The station's sponsors now, by short name and monthly amount ("Redlands Hardware and Clear"): the Spots area's sponsorships (in the
 * credit, or approved and started), or the ledger's own list when those aren't there.
 */
export function sponsorsOf(stationId: string, fallback: Ledger["sponsors"]): Ledger["sponsors"] {
  try {
    const s = getSpots();
    const today = at("12:00").slice(0, 10);
    const list = s.sponsorships
      .filter((x) => x.stationId === stationId && (x.state === "credited" || (x.state === "approved" && x.startsOn <= today)))
      .map((x) => ({ name: s.businesses.find((b) => b.id === x.businessId)?.shortName ?? "", monthlyMicros: x.monthlyMicros }))
      .filter((x) => x.name);
    return list.length || s.sponsorships.some((x) => x.stationId === stationId) ? list : fallback;
  } catch {
    return fallback;
  }
}

export function stationEarnings(stationId: string, period: Period): StationEarningsX | null {
  const l = ledgerOf(stationId);
  if (!l) return null;
  const p = l.periods[period];
  const held = heldSplit(stationId);
  const spots = { micros: p.spots.micros + held.airedMicros, airings: p.spots.airings + held.airedAirings, businesses: p.spots.businesses };
  const opencastShare = { micros: 0, notSetYet: true };
  const pool = { micros: 0, notSetYet: true };
  const totalMicros = spots.micros + p.sponsors.micros + p.pledges.micros + p.carriageIn.micros + p.carriageOut.micros + p.production.micros + opencastShare.micros + pool.micros;
  const moved = state().moves.filter((m) => m.stationId === stationId).reduce((a, m) => a + m.amountMicros, 0);
  const available = availableMicros(stationId);
  return {
    period,
    lines: {
      spots,
      sponsors: { ...p.sponsors, list: sponsorsOf(stationId, l.sponsors) },
      pledges: p.pledges,
      carriageIn: p.carriageIn,
      carriageOut: p.carriageOut,
      production: p.production,
      opencastShare,
      pool
    },
    totalMicros,
    held: { tonightMicros: held.tonightMicros, tonightAirings: held.tonightAirings, tonightBreaks: held.tonightBreaks, restOfWeekMicros: held.restOfWeekMicros, restOfWeekAirings: held.restOfWeekAirings },
    account: { availableMicros: available, paidOutThisMonthMicros: l.account.paidOutThisMonthMicros + moved },
    nextPayout: l.payout.status === "active" ? { on: nextMonday(), schedule: l.payout.schedule, destination: l.payout.destination, amountMicros: Math.max(0, available) } : null
  };
}

/** Where payouts go: the station's Clear account unless the owner chose their linked Clear wallet. */
const payoutTo: Record<string, { kind: "clear_account" | "clear_wallet"; address: string | null }> = {};

export function payoutAccount(stationId: string, name = "The station") {
  const l = ledgerOf(stationId);
  if (!l) return null;
  const to = payoutTo[stationId];
  const destination = to?.kind === "clear_wallet" && to.address ? { kind: "clear_wallet" as const, label: `Clear wallet, ${to.address.slice(0, 6)}…${to.address.slice(-4)}`, address: to.address } : { kind: "clear_account" as const, label: `${name}'s Clear account`, address: null };
  return { status: l.payout.status, url: l.payout.url, destination };
}

export function setPayoutTo(stationId: string, kind: "clear_account" | "clear_wallet", address: string | null) {
  payoutTo[stationId] = { kind, address };
}

export type MoveResult = { ok: true; payoutId: string; scheduledFor: string } | { ok: false; status: number; code: string; message: string };

/** Moves earnings to the bank: up to what's available, only once the payout account is set up. */
export function moveToBank(stationId: string, amountMicros: number, money: (m: number) => string): MoveResult {
  const l = ledgerOf(stationId);
  if (!l) return { ok: false, status: 404, code: "not_found", message: "That station wasn't found." };
  if (l.payout.status !== "active") return { ok: false, status: 409, code: "needs_onboarding", message: "Finish setting up where you're paid first." };
  const available = availableMicros(stationId);
  if (!(amountMicros > 0)) return { ok: false, status: 422, code: "invalid", message: "Enter an amount to move." };
  if (amountMicros > available) return { ok: false, status: 422, code: "too_much", message: `Up to ${money(available)} is available.` };
  const id = uid(650000 + state().moves.length + 1);
  // Sent the next business day.
  const t = now();
  const z = zoned(t, STATION_TZ);
  const add = z.weekday === 5 ? 3 : z.weekday === 6 ? 2 : 1;
  const d = zoned(new Date(t.getTime() + add * 24 * 3600e3), STATION_TZ);
  const scheduledFor = `${d.y}-${String(d.m + 1).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  state().moves.push({ id, stationId, amountMicros, at: t.toISOString(), scheduledFor });
  save();
  return { ok: true, payoutId: id, scheduledFor };
}

// ---------------------------------------------------------------- statements

export function stationStatements(stationId: string): StatementX[] {
  const l = ledgerOf(stationId);
  if (!l) return [];
  return l.statements.map((s) => {
    const total = s.lines.reduce((a, x) => a + x.amountMicros, 0);
    return {
      id: s.id,
      period: "week" as const,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      openingMicros: 0,
      closingMicros: total,
      lines: s.lines.map((x) => ({ label: x.label, detail: x.detail ?? null, amountMicros: x.amountMicros, notSetYet: !!x.notSetYet, group: x.group, airings: x.airings, rate: x.rate, averageTunedIn: x.averageTunedIn })),
      issuedAt: `${s.periodEnd}T15:00:00.000Z`,
      csvUrl: `/v1/statements/${s.id}/csv`,
      pdfUrl: null,
      paidOn: s.paidOn,
      destination: s.destination
    };
  });
}

/** Which station a statement belongs to. */
export function statementOwner(statementId: string): { stationId: string; statement: StatementX } | null {
  for (const id of Object.keys(LEDGERS)) {
    const s = stationStatements(id).find((x) => x.id === statementId);
    if (s) return { stationId: id, statement: s };
  }
  return null;
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const dollars = (micros: number) => (micros / 1_000_000).toFixed(2);

/**
 * The statement's ledger entries as CSV: each line, then the entries behind it (each airing of a
 * spot line, with what it was billed on), so the lines add up to the page and the entries to the lines.
 */
export function statementCsv(s: StatementX, callSign: string): { filename: string; csv: string } {
  const rows: Array<Array<string | number>> = [["group", "line", "detail", "entry", "at", "tuned_in", "amount"]];
  const start = Date.parse(`${s.periodStart}T00:00:00-07:00`);
  s.lines.forEach((l, li) => {
    rows.push([l.group ?? "", l.label, l.notSetYet ? "Not set yet" : l.detail ?? "", "line", "", "", dollars(l.amountMicros)]);
    const n = l.airings ?? 0;
    if (!n) return;
    const cents = Math.round(l.amountMicros / CENT);
    for (let i = 0; i < n; i++) {
      const share = Math.floor(cents / n) + (i < cents % n ? 1 : 0);
      const when = new Date(start + (i % 7) * 24 * 3600e3 + (18 * 60 + ((li * 53 + i * 37) % 330)) * MIN);
      rows.push([l.group ?? "", l.label, "", "airing", when.toISOString(), l.averageTunedIn ?? "", (share / 100).toFixed(2)]);
    }
  });
  rows.push(["total", s.paidOn ? "Paid out" : "Total", s.destination ?? "", "", s.paidOn ?? "", "", dollars(s.lines.reduce((a, l) => a + l.amountMicros, 0))]);
  return { filename: `${callSign}-statement-week-of-${s.periodStart}.csv`, csv: rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n" };
}

// ---------------------------------------------------------------- audience

/** Minutes after 6:00 pm, tuned in, as the frame's line is drawn (tonight up to 8:36 pm's peak). */
const TONIGHT: Array<[number, number]> = [
  [0, 120], [10, 150], [20, 170], [30, 176], [45, 190], [60, 200], [75, 210], [90, 205], [100, 212], [110, 226], [118, 241], [120, 228],
  [122, 236], [130, 262], [140, 284], [148, 301], [149, 270]
];
/** Saturday Reel so far, 8:30 to 8:42 pm, minute by minute: average 305, peak 318 at 8:36, 312 now. */
const REEL = [283, 287, 294, 300, 306, 312, 318, 316, 313, 311, 309, 310, 312];
const LAST: Array<[number, number]> = [
  [0, 110], [20, 150], [40, 168], [60, 190], [80, 200], [100, 220], [120, 250], [140, 290], [160, 310], [178, 330], [180, 300], [182, 360], [200, 395], [220, 410], [238, 402], [240, 370],
  [242, 395], [260, 330], [280, 280], [300, 240], [360, 150], [480, 80], [720, 40]
];
/** Programs as the frame gives them: average and peak tonight (fixed before 8:42 pm), stayed to the end. */
const TARGETS: Record<string, { average: number; peak: number }> = { "Crate Session 02": { average: 184, peak: 241 }, "Late Crate, ep. 14": { average: 262, peak: 301 } };
const STAYED: Record<string, number> = { "Crate Session 02": 62, "Late Crate, ep. 14": 81, "Saturday Reel": 77, "Beat Tape Live": 74 };
const BASE_MINUTE = 162;

function interp(points: Array<[number, number]>, m: number): number {
  if (m <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (m <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((y1 - y0) * (m - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

export const lastWeekAt = (m: number) => Math.round(interp(LAST, m));

/** Scales a stretch so its peak and average land on the frame's numbers (v' = a + b·v), keeping its shape. */
export function fitTo(values: number[], average: number, peak: number): number[] {
  const max = Math.max(...values);
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const b = max === mean ? 1 : (peak - average) / (max - mean);
  const a = peak - b * max;
  return values.map((v) => Math.round(a + b * v));
}

interface StationAudience {
  scale: number;
  presetCount: number;
  translators: Array<{ translatorId: string; name: string; viewers: Record<"tonight" | "week" | "month", number> }>;
  /** Weeks and months: per program, and the numbers the fixtures can't add up minute by minute. */
  week: { peak: { tunedIn: number; minutesAgo: number } | null; hoursBefore: number; programs: AudienceProgram[] };
  month: { peak: { tunedIn: number; at: string } | null; hoursBefore: number; programs: AudienceProgram[] };
  /** Tonight's programs for a station whose log isn't in the shared evening. */
  tonightPrograms?: Array<{ title: string; startsAt: string; endsAt: string }>;
  hoursBeforeTonight: number;
}

const REEL_ST = stationByRef("REEL")!;
const agg = (key: string, title: string, source: AudienceProgram["source"], airings: number, averageTunedIn: number, peakTunedIn: number, stayed: number | null, o: Partial<AudienceProgram> = {}): AudienceProgram => ({
  key,
  programId: null,
  title,
  airedAt: null,
  airings,
  source,
  carriedFrom: source === "carried" ? (title === "Slow Hours" ? HALL : REEL_ST) : null,
  averageTunedIn,
  peakTunedIn,
  stayedToTheEnd: stayed,
  onNow: false,
  ...o
});

const AUDIENCE: Record<string, () => StationAudience> = {
  [BEAT.id]: () => ({
    scale: 1,
    presetCount: 142,
    translators: [{ translatorId: uid(640001), name: "YouTube", viewers: { tonight: 88, week: 612, month: 2340 } }],
    hoursBeforeTonight: 596,
    week: {
      peak: null,
      hoursBefore: 2822,
      programs: [
        agg("late-crate", "Late Crate", "library", 9, 238, 301, 79),
        agg("crate-session", "Crate Session 02", "library", 2, 181, 241, 63),
        agg("saturday-reel", "Saturday Reel", "carried", 1, 305, 318, null, { onNow: true }),
        agg("slow-hours", "Slow Hours", "carried", 5, 146, 204, 57)
      ]
    },
    month: {
      peak: { tunedIn: 410, at: at("-7 21:40") },
      hoursBefore: 12310,
      programs: [
        agg("late-crate", "Late Crate", "library", 34, 226, 301, 78),
        agg("beat-tape-live", "Beat Tape Live", "live", 3, 352, 410, 74),
        agg("crate-session", "Crate Session 02", "library", 6, 177, 241, 61),
        agg("saturday-reel", "Saturday Reel", "carried", 4, 298, 318, null, { onNow: true }),
        agg("slow-hours", "Slow Hours", "carried", 19, 139, 204, 56)
      ]
    }
  }),
  [HALL.id]: () => ({
    scale: 0.3,
    presetCount: 57,
    translators: [],
    hoursBeforeTonight: 0,
    tonightPrograms: [
      { title: "Study Beats", startsAt: at("18:00"), endsAt: at("20:00") },
      { title: "Slow Hours", startsAt: at("20:00"), endsAt: at("21:10") }
    ],
    week: { peak: null, hoursBefore: 610, programs: [agg("slow-hours", "Slow Hours", "library", 6, 92, 124, 66, { onNow: true }), agg("study-beats", "Study Beats", "library", 6, 58, 81, 61)] },
    month: { peak: { tunedIn: 131, at: at("-7 21:10") }, hoursBefore: 2480, programs: [agg("slow-hours", "Slow Hours", "library", 26, 88, 131, 64, { onNow: true }), agg("study-beats", "Study Beats", "library", 26, 55, 84, 60)] }
  })
};

export function hasAudience(stationId: string): boolean {
  return !!AUDIENCE[stationId];
}

/** Tonight's line for BEAT's evening, minute by minute from 6:00 pm (before scaling to another station). */
export function tonightCurve(minutes: number, inBreak: (m: number) => boolean, gap: (m: number) => boolean): number[] {
  const out: number[] = [];
  for (let m = 0; m < 120; m++) out.push(interp(TONIGHT, m));
  const crate = fitTo(out.slice(0, 120), TARGETS["Crate Session 02"].average, TARGETS["Crate Session 02"].peak);
  const late: number[] = [];
  for (let m = 120; m <= 148; m++) late.push(interp(TONIGHT, m));
  const lateFit = fitTo(late, TARGETS["Late Crate, ep. 14"].average, TARGETS["Late Crate, ep. 14"].peak);
  const base = [...crate, ...lateFit, Math.round(interp(TONIGHT, 149)), ...REEL];
  const k = REEL[REEL.length - 1] / lastWeekAt(BASE_MINUTE);
  const series: number[] = [];
  for (let m = 0; m <= minutes; m++) {
    if (m <= BASE_MINUTE) {
      series.push(base[m]);
      continue;
    }
    if (gap(m)) {
      series.push(0);
      continue;
    }
    const v = lastWeekAt(m) * k * (inBreak(m) ? 0.92 : 1);
    series.push(Math.round(v));
  }
  return series;
}

function shares(total: number): { phone: number; cast: number; web: number; tv_app: number } {
  const parts = [0.44, 0.24, 0.21, 0.11];
  const raw = parts.map((p) => p * total);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, v) => a + v, 0);
  raw.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((x, y) => y.r - x.r).forEach(({ i }) => {
    if (left > 0) {
      out[i]++;
      left--;
    }
  });
  return { phone: out[0], cast: out[1], web: out[2], tv_app: out[3] };
}

/** The station's own audience between `from` and `to` (to now): tonight minute by minute, a week or a month added up. */
export function audienceReport(stationId: string, fromIso: string, toIso: string): AudienceReportX | null {
  const make = AUDIENCE[stationId];
  if (!make) return null;
  const a = make();
  const t = now();
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const onAir = dbStation(stationId)?.onAir ?? true;
  const evening = Date.parse(at("18:00"));

  // Tonight's line from 6:00 pm (the shared evening), to now.
  const minutesToNow = Math.max(0, Math.floor((t.getTime() - evening) / MIN));
  const breaks = stationBreaks(stationId).map((b) => ({ start: Date.parse(b.startsAt), end: Date.parse(b.startsAt) + b.lengthMs }));
  const log = stationLog(stationId);
  const minuteAt = (m: number) => evening + m * MIN;
  const inBreak = (m: number) => breaks.some((b) => minuteAt(m) >= b.start && minuteAt(m) < b.end);
  const gap = (m: number) => log.length > 0 && !inBreak(m) && !log.some((e) => Date.parse(e.startsAt) <= minuteAt(m) && minuteAt(m) < Date.parse(e.endsAt));
  const curve = tonightCurve(minutesToNow, inBreak, gap).map((v) => Math.round(v * a.scale));
  const tunedInNow = onAir ? curve[curve.length - 1] ?? 0 : 0;
  const afterBase = curve.slice(BASE_MINUTE + 1).reduce((s, v) => s + v, 0) / 60;
  const tonightHours = a.hoursBeforeTonight ? a.hoursBeforeTonight + afterBase : curve.reduce((s, v) => s + v, 0) / 60;
  const byPlatformNow = shares(tunedInNow);

  const isTonight = to - from <= 13 * 3600e3;
  if (!isTonight) {
    const view = to - from <= 8 * 24 * 3600e3 ? "week" : "month";
    const agg = a[view];
    let peakI = 0;
    curve.forEach((v, i) => (v > curve[peakI] ? (peakI = i) : null));
    const tonightPeak = curve.length ? { tunedIn: curve[peakI], at: new Date(minuteAt(peakI)).toISOString() } : null;
    const peak = view === "month" && a.month.peak && (!tonightPeak || a.month.peak.tunedIn >= tonightPeak.tunedIn) ? a.month.peak : tonightPeak;
    return {
      tunedInNow,
      peak,
      hoursWatched: Math.round(agg.hoursBefore + tonightHours),
      presetCount: a.presetCount,
      series: [],
      byPlatform: shares(1000),
      stayedToTheEnd: agg.programs.filter((p) => p.stayedToTheEnd !== null).map((p) => ({ programId: p.programId ?? uid(0), title: p.title, percent: p.stayedToTheEnd! })),
      translators: a.translators.map((x) => ({ translatorId: x.translatorId, name: x.name, viewers: x.viewers[view] })),
      byProgram: agg.programs
    };
  }

  // Tonight: the window's minutes, tonight's line to now, last week's across the whole window.
  const series: AudienceReportX["series"] = [];
  const comparison: NonNullable<AudienceReportX["comparison"]> = [];
  for (let m = Math.ceil((from - evening) / MIN); minuteAt(m) <= to; m++) {
    const iso = new Date(minuteAt(m)).toISOString();
    const lastWeek = Math.round(lastWeekAt(m) * a.scale);
    comparison.push({ minute: iso, tunedIn: lastWeek });
    if (m >= 0 && m < curve.length) series.push({ minute: iso, tunedIn: curve[m], lastWeek, inBreak: inBreak(m) });
  }
  let peakI = -1;
  series.forEach((p, i) => (peakI < 0 || p.tunedIn > series[peakI].tunedIn ? (peakI = i) : null));

  // By program: the shared log's airings so far (or the station's own list), each measured on the line.
  const airings = (log.length ? log.filter((e) => e.kind !== "off_air").map((e) => ({ id: e.id, programId: e.programId, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, live: e.kind === "live", carriedFrom: e.carriedFrom ?? null })) : (a.tonightPrograms ?? []).map((p, i) => ({ id: uid(641000 + i), programId: null, title: p.title, startsAt: p.startsAt, endsAt: p.endsAt, live: false, carriedFrom: null }))).filter(
    (e) => Date.parse(e.startsAt) < Math.min(t.getTime(), to) && Date.parse(e.endsAt) > from
  );
  const byProgram: AudienceProgram[] = airings.map((e) => {
    const s = Math.max(0, Math.round((Date.parse(e.startsAt) - evening) / MIN));
    const endM = Math.round((Date.parse(e.endsAt) - evening) / MIN);
    const vals = curve.slice(s, Math.min(endM, curve.length));
    const onNow = Date.parse(e.startsAt) <= t.getTime() && t.getTime() < Date.parse(e.endsAt);
    return {
      key: e.id,
      programId: e.programId,
      title: e.title,
      airedAt: e.startsAt,
      airings: 1,
      source: e.carriedFrom ? "carried" : e.live ? "live" : "library",
      carriedFrom: e.carriedFrom,
      averageTunedIn: vals.length ? Math.round(vals.reduce((x, v) => x + v, 0) / vals.length) : 0,
      peakTunedIn: vals.length ? Math.max(...vals) : 0,
      stayedToTheEnd: onNow ? null : STAYED[e.title] ?? 70,
      onNow
    };
  });

  return {
    tunedInNow,
    peak: peakI >= 0 ? { tunedIn: series[peakI].tunedIn, at: series[peakI].minute } : null,
    hoursWatched: Math.round(tonightHours),
    presetCount: a.presetCount,
    series,
    byPlatform: byPlatformNow,
    stayedToTheEnd: byProgram.filter((p) => p.stayedToTheEnd !== null).map((p) => ({ programId: p.programId ?? uid(0), title: p.title, percent: p.stayedToTheEnd! })),
    translators: a.translators.map((x) => ({ translatorId: x.translatorId, name: x.name, viewers: x.viewers.tonight })),
    byProgram,
    comparison,
    breaks: stationBreaks(stationId, fromIso, toIso).map((b) => ({ startsAt: b.startsAt, endsAt: new Date(Date.parse(b.startsAt) + b.lengthMs).toISOString() }))
  };
}

// ---------------------------------------------------------------- held for creators (rights 05.x; network desk)

/** CRAT 101.9, run by Opencast for Marcus Reyes since August 12: $214.60 held in escrow for him. */
export const CRAT_ESCROW = {
  contractAddress: "0x5ee2c4d1a0b7e93f6a2d8c15b4e07f39d6a1a41d",
  escrowStationId: 101,
  creator: "Marcus Reyes",
  heldMicros: $(214.6),
  presetCount: 88,
  onAirSince: () => at("-45 18:00")
};

export function heldEarnings() {
  return {
    contractAddress: CRAT_ESCROW.contractAddress,
    stations: [
      {
        station: CRAT,
        creator: CRAT_ESCROW.creator,
        escrowStationId: CRAT_ESCROW.escrowStationId,
        onAirSince: CRAT_ESCROW.onAirSince(),
        rightsBasis: "permission" as const,
        heldMicros: CRAT_ESCROW.heldMicros,
        owedNotYetDepositedMicros: 0,
        status: "on_air" as const
      }
    ],
    totalHeldMicros: CRAT_ESCROW.heldMicros,
    everMovedToOpencastMicros: 0
  };
}
