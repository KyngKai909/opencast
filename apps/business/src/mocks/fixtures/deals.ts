// Sponsorships and production orders for the mock (sponsorships 01, 02, 06.2; production orders
// 01, 02, 04, 05, 06.1), with the rules both frames describe:
//   - the credit rules check (who you are and where; no prices or offers, comparisons or calls to act),
//   - a sponsorship held on the 1st of each month and paid to the station at the end, lapsing when
//     the balance can't cover a month,
//   - an order's price held when its quote is accepted, paid to the maker on approval (or 7 days
//     after delivery), and returned if the delivery date passes and the business cancels.
//
// The story is master control's mock seen from Orange Street Coffee: Council Watch on CIVC is
// credited on air since August 1. Beat Tape Live on BEAT isn't asked for yet: sending it from the
// New page is the step the Sponsorships frame (01.1) draws right after. The orders are as the Made
// for you frame (01.1) draws them: Holiday gift cards quoted by BEAT at $140.00 for October 9,
// Weekend brunch delivered by Opencast Studio, and two approved orders that became spots.
//
// Master control answers in the other app. Here its answers come from the mock-only control
// (components/deals/MockStation), which calls the station's own endpoints (decideSponsorship,
// quoteOrder, deliverOrder, markOwnMistake) and Opencast's (resolveOrderDispute), all answered below.
//
// Books: the shared seed's held $14.20 is airings only, so the months and orders already under
// way when the mock starts (Council Watch's September, Weekend brunch's $150.00) are outside the
// mock's books (inventory "worth raising" 10). Money only moves for what happens in the mock.

import type { CreditCheck, ProductionOrder, Sponsorship, SponsorTarget, Spot, StationIdent } from "@opencast/contracts";
import type { CreditFlag, Maker } from "../../api/types";
import { MARKET_TZ, now } from "../../lib/clock";
import { balanceOf, dbBusiness, getDb, move, returnHeld as dbReturnHeld, saveDb, spendHeld as dbSpendHeld } from "../db";
import { OSC_ID } from "./businesses";
import { uid } from "./people";
import { STATIONS } from "./stations";
import { at } from "./time";

const $ = (dollars: number) => Math.round(dollars * 1_000_000);
const DAY = 86_400_000;

const station = (callSign: string) => STATIONS.find((s) => s.callSign === callSign)!;
export const BEAT = station("BEAT");
export const CIVC = station("CIVC");
export const SAZN = station("SAZN");
/** Opencast's own studio: a maker with no channel. */
export const STUDIO: StationIdent = { id: uid(5100), kind: "studio", callSign: null, handle: "opencast-studio", name: "Opencast Studio", colour: null, band: null, channel: null, marketSlug: null, homeCity: null };

export const PROGRAM_IDS = { beatTapeLive: uid(280004), councilWatch: uid(280701), tamales: uid(280801) };
export const SPONSORSHIP_IDS = { councilWatch: uid(66001) };
export const ORDER_IDS = { giftCards: uid(67001), brunch: uid(67002), colton: uid(67003), fallMenu: uid(67004) };
/** The seed's spots that approved orders became (fixtures/businesses.ts). */
const SPOT_IDS = { fallMenu: uid(64001), colton: uid(64003) };

// ---- Dates, in the market's zone ----

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: MARKET_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
/** "2026-09-26": the market's date at that moment. */
export function localDate(t: Date | number | string): string {
  return ymd.format(new Date(t));
}
/** "2026-10-01": the first of the month after the moment. */
export function nextMonthStart(t: Date | number | string): string {
  const [y, m] = localDate(t).split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
/** "2026-10" → "2026-11". */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
/** The day, `days` after a market date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

// ---- The credit rules check ----

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The clause around [start, end): back to the last ", and ", "," or sentence start; on to the next , . ; or the end. */
function clauseAround(text: string, start: number, end: number): { start: number; end: number } {
  let s = 0;
  for (const re of [/, and /g, /, /g, /[.;!?]\s+/g]) {
    for (const m of text.matchAll(re)) if (m.index! + m[0].length <= start) s = Math.max(s, m.index! + m[0].length);
  }
  const rest = text.slice(end).search(/[,.;!?]/);
  return { start: s, end: rest < 0 ? text.length : end + rest };
}

/** The sentence around [start, end), with the space before it: removing it leaves the text whole. */
function sentenceAround(text: string, start: number, end: number): { start: number; end: number } {
  let s = 0;
  for (const m of text.matchAll(/[.;!?]\s+/g)) if (m.index! + 1 <= start) s = m.index! + 1;
  const stop = text.slice(end).search(/[.;!?]/);
  return { start: s, end: stop < 0 ? text.length : end + stop + 1 };
}

const COMPARISON = /\b(the best|best|better than|the only|cheapest|finest|greatest|number one|#1|unbeatable)\b/i;
const CALL_TO_ACTION = /(^|[.;!?]\s+)(come (?:by|in|on down)|stop by|visit us|visit|call us|call|order now|order|try|book now|book|shop|hurry|don't miss|get yours)\b/i;
const PRICE_OR_OFFER = /(\$\s?\d[\d,.]*|\d+\s?% off|\bhalf off\b|\bfree\b|\bdiscounts?\b|\bsale\b|\bcoupons?\b|\bbogo\b|\bdeals?\b)/i;

/**
 * Checks a credit as it's typed: it names who the business is, where, and what it does, and
 * nothing else. Each flag says what to replace (start, end) and with what (`suggestion`, empty
 * to remove), and `quote` is the words its title names.
 */
export function checkCredit(text: string): CreditCheck {
  const flags: CreditFlag[] = [];
  const taken = (s: number, e: number) => flags.some((f) => s < f.end && e > f.start);

  const act = CALL_TO_ACTION.exec(text);
  if (act) {
    const at_ = act.index + act[1]!.length;
    const range = sentenceAround(text, at_, at_ + act[2]!.length);
    const from = range.start > 0 && text[range.start] === " " ? range.start : Math.max(0, range.start);
    const sentence = text.slice(from, range.end).trim();
    flags.push({ kind: "call_to_action", text: text.slice(from, range.end), start: from, end: range.end, suggestion: "", quote: sentence.replace(/[.;!?]$/, "") });
  }
  const offer = PRICE_OR_OFFER.exec(text);
  if (offer && !taken(offer.index, offer.index + offer[0].length)) {
    const c = clauseAround(text, offer.index, offer.index + offer[0].length);
    // Take the comma before the clause too, so removing it leaves the sentence whole.
    const from = c.start >= 2 && text.slice(c.start - 2, c.start) === ", " ? c.start - 2 : c.start;
    flags.push({ kind: "price_or_offer", text: text.slice(from, c.end), start: from, end: c.end, suggestion: "", quote: offer[0] });
  }
  const cmp = COMPARISON.exec(text);
  if (cmp && !taken(cmp.index, cmp.index + cmp[0].length)) {
    const c = clauseAround(text, cmp.index, cmp.index + cmp[0].length);
    const clause = text.slice(c.start, c.end);
    const suggestion = clause
      .replace(COMPARISON, (w) => (w.toLowerCase() === "the best" ? "the" : ""))
      .replace(/\s+in (the )?[A-Z][\w ]*$/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    flags.push({ kind: "comparison", text: clause, start: c.start, end: c.end, suggestion, quote: cmp[0] });
  }
  flags.sort((a, b) => a.start - b.start);
  const clean = applyFlags(text, flags).trim();
  const who = clean ? cap(clean.split(/[,.;]/)[0]!.trim()) : null;
  return { passes: flags.length === 0 && clean.length > 0, flags, who };
}

/** The text with one flag's fix applied. */
export function applyFlag(text: string, f: Pick<CreditFlag, "start" | "end" | "suggestion">): string {
  return text.slice(0, f.start) + f.suggestion + text.slice(f.end);
}

/** The text with every flag's fix applied (the preview "already applies the fix"). */
export function applyFlags(text: string, flags: Pick<CreditFlag, "start" | "end" | "suggestion">[]): string {
  return [...flags].sort((a, b) => b.start - a.start).reduce(applyFlag, text);
}

// ---- What there is to sponsor, and who makes spots (P16, P18) ----

interface FxTarget extends Omit<SponsorTarget, "sponsors"> {
  /** Other businesses already sponsoring it. */
  others: number;
}

export const TARGETS: FxTarget[] = [
  { station: BEAT, program: { id: PROGRAM_IDS.beatTapeLive, title: "Beat Tape Live" }, schedule: "Saturdays at 9:00 pm, live", programFormat: "Weekly, live", minMonthlyMicros: $(75), maxSponsors: 2, others: 0, membersCredit: "members of Inland Beat", where: "In BEAT's breaks during the program" },
  { station: BEAT, program: null, schedule: "Credited in every break, 24 hours", programFormat: null, minMonthlyMicros: $(100), maxSponsors: 3, others: 2, membersCredit: "members of Inland Beat", where: "In every one of BEAT's breaks" },
  { station: SAZN, program: { id: PROGRAM_IDS.tamales, title: "Tamales for forty" }, schedule: "Weekly", programFormat: "Weekly", minMonthlyMicros: $(40), maxSponsors: null, others: 0, membersCredit: "members of Sazón", where: "In SAZN's breaks during the program" },
  { station: CIVC, program: { id: PROGRAM_IDS.councilWatch, title: "Council Watch" }, schedule: "Tuesdays at 7:00 pm", programFormat: "Weekly", minMonthlyMicros: $(50), maxSponsors: 2, others: 0, membersCredit: null, where: "In CIVC's breaks during the program" }
];

export const MAKERS: Maker[] = [
  { station: BEAT, turnaround: "About a week", fromMicros: $(100), samples: 4, history: "Made your Fall menu spot", specialty: null },
  { station: SAZN, turnaround: "About 10 days", fromMicros: $(150), samples: 6, history: null, specialty: "Food and kitchens" },
  { station: STUDIO, turnaround: "About 5 days", fromMicros: $(140), samples: 12, history: null, specialty: "Any category" }
];

/** What each maker quotes in the mock (master control's quote, 03.1: $140.00, October 9, 1 round, Jen Park). */
export const MOCK_QUOTES: Record<string, { priceMicros: number; days: number; roundsIncluded: number; voicedBy: string | null }> = {
  [BEAT.id]: { priceMicros: $(140), days: 13, roundsIncluded: 1, voicedBy: "Jen Park, host of Beat Tape Live" },
  [SAZN.id]: { priceMicros: $(150), days: 10, roundsIncluded: 1, voicedBy: null },
  [STUDIO.id]: { priceMicros: $(140), days: 5, roundsIncluded: 1, voicedBy: null }
};

// ---- State ----

export interface FxSponsorship extends Sponsorship {
  /** Months held in the mock's books and not yet paid to the station ("2026-10"). */
  heldMonths: string[];
  /** The last month the monthly hold has been looked at; earlier months are settled. */
  settledThrough: string;
}

export interface FxOrder extends ProductionOrder {
  /** The price is held in the mock's books (accepted in the mock, not before it started). */
  heldInBooks: boolean;
}

export interface DealsState {
  version: number;
  sponsorships: FxSponsorship[];
  orders: FxOrder[];
}

export const DEALS_VERSION = 1;
const KEY = "oc-mock-spots-deals";

/** A mock "video": the still the frames draw for it, carried in the URL's fragment. */
export function mockMediaUrl(slug: string, card: { title: string; line: string; colour: string }): string {
  const q = new URLSearchParams({ title: card.title, line: card.line, colour: card.colour });
  return `/mock-media/${slug}.mp4#card=${encodeURIComponent(q.toString())}`;
}

const CHECKS_PASSED = ["length", "safe areas", "loudness", "captions"];

export function seedDeals(): DealsState {
  const osc = { id: OSC_ID, name: "Orange Street Coffee" };
  const order = (o: Partial<FxOrder> & Pick<FxOrder, "id" | "maker" | "title" | "lengthSec" | "about" | "neededBy" | "state" | "createdAt">): FxOrder => ({
    business: osc,
    mustSay: null,
    quote: null,
    roundsUsed: 0,
    briefFiles: [],
    deliveries: [],
    notes: [],
    deliveredAt: null,
    autoApproveAt: null,
    spotId: null,
    tellMakerWhenListed: false,
    quotedAt: null,
    approvedAt: null,
    heldInBooks: false,
    ...o
  });
  const file = (n: number, filename: string) => ({ id: uid(67100 + n), url: `/mock-files/${filename}`, filename });
  const delivery = (n: number, slug: string, lengthSec: number, card: { title: string; line: string; colour: string }, createdAt: string) => ({
    id: uid(67200 + n),
    version: 1,
    url: mockMediaUrl(slug, card),
    previewUrl: null,
    createdAt,
    durationMs: lengthSec * 1000,
    checksPassed: CHECKS_PASSED
  });
  return {
    version: DEALS_VERSION,
    sponsorships: [
      {
        id: SPONSORSHIP_IDS.councilWatch,
        business: osc,
        station: CIVC,
        program: { id: PROGRAM_IDS.councilWatch, title: "Council Watch" },
        programFormat: "Weekly",
        monthlyMicros: $(50),
        creditText: "A family coffee house on Orange Street in downtown Redlands, and home of the pumpkin bread.",
        state: "credited",
        declineReason: null,
        startsOn: "2026-08-01",
        renewsOn: "2026-10-01",
        createdAt: at("-60 10:00"),
        heldMonths: [],
        settledThrough: "2026-09"
      }
    ],
    orders: [
      order({
        id: ORDER_IDS.giftCards,
        maker: BEAT,
        title: "Holiday gift cards",
        lengthSec: 30,
        about: "Gift cards for the holidays. Warm, a little funny. Our regulars, the big mugs, the window on Orange Street in the evening.",
        mustSay: "Orange Street Coffee, 204 Orange St, Redlands. Gift cards at the counter.",
        neededBy: "2026-11-20",
        state: "quoted",
        quote: { priceMicros: $(140), deliverBy: "2026-10-09", roundsIncluded: 1, voicedBy: "Jen Park, host of Beat Tape Live" },
        briefFiles: [file(1, "logo.svg"), file(2, "storefront-evening.jpg"), file(3, "mugs.mov")],
        quotedAt: at("-1 16:30"),
        createdAt: at("-2 10:14")
      }),
      order({
        id: ORDER_IDS.brunch,
        maker: STUDIO,
        title: "Weekend brunch",
        lengthSec: 15,
        about: "Weekend brunch at Orange Street, Saturdays and Sundays.",
        mustSay: "Brunch runs 8 to 1. 204 Orange St.",
        neededBy: "2026-10-03",
        state: "delivered",
        quote: { priceMicros: $(150), deliverBy: "2026-09-26", roundsIncluded: 1, voicedBy: null },
        deliveries: [delivery(1, "weekend-brunch-v1", 15, { title: "Weekend brunch at Orange Street", line: "Saturdays and Sundays, 204 Orange St", colour: "#6B4A2B" }, at("-1 11:20"))],
        notes: [
          { id: uid(67301), timecodeMs: 6000, author: "Jess Lin", body: "The logo is small here. Can it be bigger?", makersMistake: false, round: 1, createdAt: at("20:40") },
          { id: uid(67302), timecodeMs: 12000, author: "Jess Lin", body: "Brunch runs 8 to 1, not 8 to 2.", makersMistake: false, round: 1, createdAt: at("20:41") }
        ],
        deliveredAt: at("-1 11:20"),
        autoApproveAt: at("+6 11:20"),
        quotedAt: at("-6 09:00"),
        createdAt: at("-7 15:00")
      }),
      order({
        id: ORDER_IDS.colton,
        maker: STUDIO,
        title: "Now open in Colton",
        lengthSec: 30,
        about: "We're opening in Colton.",
        neededBy: "2026-09-25",
        state: "approved",
        quote: { priceMicros: $(180), deliverBy: "2026-09-21", roundsIncluded: 1, voicedBy: null },
        deliveries: [delivery(2, "now-open-in-colton-v1", 30, { title: "Now open in Colton", line: "1150 E Washington St", colour: "#5A3A22" }, at("-5 10:00"))],
        deliveredAt: at("-5 10:00"),
        spotId: SPOT_IDS.colton,
        quotedAt: at("-10 12:00"),
        approvedAt: at("-4 09:30"),
        createdAt: at("-11 14:00")
      }),
      order({
        id: ORDER_IDS.fallMenu,
        maker: BEAT,
        title: "Fall menu",
        lengthSec: 30,
        about: "The fall menu: pumpkin bread, the big mugs, open till midnight.",
        mustSay: "Orange Street Coffee, Orange St, open till midnight.",
        neededBy: "2026-09-12",
        state: "approved",
        quote: { priceMicros: $(120), deliverBy: "2026-09-09", roundsIncluded: 1, voicedBy: "Jen Park" },
        deliveries: [delivery(3, "fall-menu-v1", 30, { title: "Fall menu", line: "Open till midnight on Orange St.", colour: "#8C3B7A" }, at("-18 16:00"))],
        deliveredAt: at("-18 16:00"),
        spotId: SPOT_IDS.fallMenu,
        quotedAt: at("-23 11:00"),
        approvedAt: at("-16 10:00"),
        createdAt: at("-24 09:30")
      })
    ]
  };
}

let state: DealsState | null = null;

export function getDeals(): DealsState {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as DealsState) : null;
    state = saved && saved.version === DEALS_VERSION ? saved : seedDeals();
  } catch {
    state = seedDeals();
  }
  return state;
}

export function saveDeals() {
  try {
    localStorage.setItem(KEY, JSON.stringify(getDeals()));
  } catch {
    // Private windows: this visit only.
  }
}

export function resetDeals() {
  state = seedDeals();
  saveDeals();
}

let seq = 0;
export function newId(): string {
  return `00000000-0000-4000-a000-${String(Date.now() % 1e9).padStart(9, "0")}${String(++seq % 1000).padStart(3, "0")}`;
}

// ---- Money, through the shared db's move() ----

const makerName = (s: StationIdent) => (s.callSign && s.channel ? `${s.callSign} ${s.channel}` : s.name);

/** Holds money from available (an accepted quote, a month of sponsorship). */
function hold(businessId: string, amount: number, label: string, detail: string, at?: string) {
  move(businessId, { kind: "held", label, amountMicros: amount, detail, hold: true, at });
}

/** Pays held money out: "Held for …" then "Paid to …" (the shared db's spendHeld). */
function spendHeld(businessId: string, amount: number, kind: "order" | "sponsorship", label: string, detail: string, at?: string) {
  dbSpendHeld(businessId, { kind, label, amountMicros: amount, detail, at });
}

/** Returns held money to available (a cancelled order). */
function returnHeld(businessId: string, amount: number, label: string, detail: string) {
  dbReturnHeld(businessId, { label, amountMicros: amount, detail });
}

// ---- Rules over time: monthly holds, credits starting, auto-approval ----

/** The month's key ("2026-10") for a market date. */
const monthOf = (date: string) => date.slice(0, 7);
/** Midnight on the 1st of a month, in the market's zone (Pacific, daylight time or not). */
const hourOf = new Intl.DateTimeFormat("en-US", { timeZone: MARKET_TZ, hour: "numeric", hourCycle: "h23" });
const monthStartAt = (month: string) => {
  for (const off of ["-07:00", "-08:00"]) {
    const d = new Date(`${month}-01T00:00:00${off}`);
    if (Number(hourOf.format(d)) === 0) return d.toISOString();
  }
  return new Date(`${month}-01T08:00:00Z`).toISOString();
};

/**
 * Brings every sponsorship and order up to `t`: an approved sponsorship is credited from its start;
 * on the 1st of each month a live sponsorship's month is held (or it lapses when the balance can't
 * cover it) and last month's hold is paid to the station; a delivered order approves itself 7 days
 * after delivery.
 */
export function settle(t: Date = now()) {
  const s = getDeals();
  const today = localDate(t);
  const month = monthOf(today);
  let changed = false;
  for (const x of s.sponsorships) {
    if (x.state !== "approved" && x.state !== "credited") continue;
    if (x.state === "approved" && today >= x.startsOn) {
      x.state = "credited";
      changed = true;
    }
    let m = nextMonth(x.settledThrough);
    const first = monthOf(x.startsOn);
    if (m < first) m = first;
    for (; m <= month; m = nextMonth(m)) {
      const name = x.program ? `${x.program.title} on ${makerName(x.station)}` : `All of ${makerName(x.station)}`;
      for (const held of x.heldMonths.filter((h) => h < m)) {
        spendHeld(x.business.id, x.monthlyMicros, "sponsorship", `Paid to ${makerName(x.station)}`, `Sponsorship, ${name}`, monthStartAt(m));
        x.heldMonths = x.heldMonths.filter((h) => h !== held);
      }
      if (x.renewsOn === null && m > first) {
        x.state = "ended";
      } else if (balanceOf(x.business.id).availableMicros >= x.monthlyMicros) {
        hold(x.business.id, x.monthlyMicros, `Held for ${name}`, "Sponsorship, paid to the station at the end of the month", monthStartAt(m));
        x.heldMonths.push(m);
        x.renewsOn = `${nextMonth(m)}-01`;
      } else {
        x.state = "lapsed";
        x.renewsOn = null;
      }
      x.settledThrough = m;
      changed = true;
      if (x.state === "ended" || x.state === "lapsed") break;
    }
  }
  for (const o of s.orders) {
    if (o.state === "delivered" && o.autoApproveAt && t.getTime() >= Date.parse(o.autoApproveAt)) {
      approveOrder(o, t);
      changed = true;
    }
  }
  if (changed) saveDeals();
}

// ---- Sponsorships ----

export function targetsFor(businessId: string): { near: string | null; targets: SponsorTarget[] } {
  const b = dbBusiness(businessId);
  const s = getDeals();
  const live = (x: FxSponsorship) => x.state === "requested" || x.state === "approved" || x.state === "credited";
  const mine = s.sponsorships.filter((x) => x.business.id === businessId && live(x));
  const targets = TARGETS.filter((t) => !mine.some((x) => x.station.id === t.station.id && (x.program?.id ?? null) === (t.program?.id ?? null))).map(({ others, ...t }) => ({
    ...t,
    sponsors: others + s.sponsorships.filter((x) => x.business.id !== businessId && (x.state === "approved" || x.state === "credited") && x.station.id === t.station.id && (x.program?.id ?? null) === (t.program?.id ?? null)).length
  }));
  return { near: b?.locations[0]?.city ?? null, targets };
}

export type Fail = { status: number; code: string; message: string };

export function offerSponsorship(
  businessId: string,
  body: { stationId: string; programId: string | null; monthlyMicros: number; creditText: string; startsOn: string },
  t: Date = now()
): FxSponsorship | Fail {
  const target = TARGETS.find((x) => x.station.id === body.stationId && (x.program?.id ?? null) === body.programId);
  if (!target) return { status: 404, code: "not_found", message: "That station or program doesn't take sponsors." };
  const listed = targetsFor(businessId).targets.find((x) => x.station.id === target.station.id && (x.program?.id ?? null) === body.programId);
  if (!listed) return { status: 409, code: "already_asked", message: `You already sponsor this, or asked ${target.station.callSign ?? target.station.name}.` };
  if (listed.maxSponsors !== null && listed.sponsors >= listed.maxSponsors) return { status: 409, code: "full", message: "It has all the sponsors it takes." };
  if (body.monthlyMicros < target.minMonthlyMicros) return { status: 422, code: "under_minimum", message: `${target.station.callSign}'s minimum is ${dollars(target.minMonthlyMicros)} a month.` };
  const check = checkCredit(body.creditText);
  if (!check.passes) return { status: 422, code: "credit_flagged", message: "Fix the flagged phrases to send." };
  const b = dbBusiness(businessId)!;
  const x: FxSponsorship = {
    id: newId(),
    business: { id: b.id, name: b.name },
    station: target.station,
    program: target.program,
    programFormat: target.programFormat,
    monthlyMicros: body.monthlyMicros,
    creditText: body.creditText,
    state: "requested",
    declineReason: null,
    startsOn: body.startsOn,
    renewsOn: null,
    createdAt: t.toISOString(),
    heldMonths: [],
    settledThrough: monthOf(addDays(body.startsOn, -1))
  };
  getDeals().sponsorships.push(x);
  saveDeals();
  return x;
}

/** Master control's answer (the mock's stand-in for the station). */
export function decideSponsorship(x: FxSponsorship, d: { decision: "approve" } | { decision: "decline"; reason: "not_right_fit" | "full" | "amount" }): FxSponsorship | Fail {
  if (x.state !== "requested") return { status: 409, code: "not_requested", message: "It's already been answered." };
  if (d.decision === "approve") {
    x.state = "approved";
    x.renewsOn = x.startsOn;
  } else {
    x.state = "declined";
    x.declineReason = d.reason;
  }
  saveDeals();
  return x;
}

/** Stop renewing: a request or a sponsorship that hasn't started ends now; a running one ends with its paid month. */
export function endSponsorship(x: FxSponsorship, t: Date = now()): FxSponsorship | Fail {
  if (x.state !== "requested" && x.state !== "approved" && x.state !== "credited") return { status: 409, code: "not_running", message: "It isn't running." };
  if (x.state === "requested" || localDate(t) < x.startsOn) x.state = "ended";
  x.renewsOn = null;
  saveDeals();
  return x;
}

// ---- Production orders ----

const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const plainDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

export function orderSpot(
  businessId: string,
  body: { makerStationId: string; title: string; lengthSec: 15 | 30 | 60; about: string; mustSay?: string; neededBy: string },
  t: Date = now()
): FxOrder | Fail {
  const maker = MAKERS.find((m) => m.station.id === body.makerStationId);
  if (!maker) return { status: 404, code: "not_found", message: "That maker doesn't take orders." };
  if (body.neededBy <= localDate(t)) return { status: 422, code: "needed_by_past", message: "Pick a date after today." };
  const b = dbBusiness(businessId)!;
  const o: FxOrder = {
    id: newId(),
    business: { id: b.id, name: b.name },
    maker: maker.station,
    title: body.title,
    lengthSec: body.lengthSec,
    about: body.about,
    mustSay: body.mustSay || null,
    neededBy: body.neededBy,
    state: "asked",
    quote: null,
    roundsUsed: 0,
    briefFiles: [],
    deliveries: [],
    notes: [],
    deliveredAt: null,
    autoApproveAt: null,
    spotId: null,
    tellMakerWhenListed: false,
    quotedAt: null,
    approvedAt: null,
    heldInBooks: false,
    createdAt: t.toISOString()
  };
  getDeals().orders.unshift(o);
  saveDeals();
  return o;
}

export function attachBriefFile(o: FxOrder, filename: string | null): FxOrder | Fail {
  if (o.state === "approved" || o.state === "cancelled") return { status: 409, code: "closed", message: "The order is closed." };
  o.briefFiles.push({ id: newId(), url: `/mock-files/${encodeURIComponent(filename ?? "file")}`, filename });
  saveDeals();
  return o;
}

/** Master control's quote (the mock's stand-in): the maker's usual price, date and rounds. */
export function quoteOrder(o: FxOrder, q: { action: "quote"; priceMicros: number; deliverBy: string; roundsIncluded: number; voicedBy: string | null } | { action: "pass" }, t: Date = now()): FxOrder | Fail {
  if (o.state !== "asked") return { status: 409, code: "not_asked", message: "It's already been quoted." };
  if (q.action === "pass") o.state = "passed";
  else {
    o.state = "quoted";
    o.quote = { priceMicros: q.priceMicros, deliverBy: q.deliverBy, roundsIncluded: q.roundsIncluded, voicedBy: q.voicedBy };
    o.quotedAt = t.toISOString();
  }
  saveDeals();
  return o;
}

/** The mock's quote for an order: what its maker usually charges, delivered in its usual time. */
export function mockQuoteFor(o: FxOrder, t: Date = now()) {
  const q = MOCK_QUOTES[o.maker.id] ?? { priceMicros: $(140), days: 7, roundsIncluded: 1, voicedBy: null };
  return { action: "quote" as const, priceMicros: q.priceMicros, deliverBy: addDays(localDate(t), q.days), roundsIncluded: q.roundsIncluded, voicedBy: q.voicedBy };
}

export function acceptQuote(o: FxOrder): FxOrder | Fail {
  if (o.state !== "quoted" || !o.quote) return { status: 409, code: "not_quoted", message: "There's no quote to accept." };
  const available = balanceOf(o.business.id).availableMicros;
  if (available < o.quote.priceMicros) return { status: 409, code: "not_enough", message: `Your available balance is ${dollars(available)}. Add money to accept.` };
  hold(o.business.id, o.quote.priceMicros, `Held for ${o.title}`, `Production order, from ${makerName(o.maker)}`);
  o.state = "accepted";
  o.heldInBooks = true;
  saveDeals();
  return o;
}

/** The still a mock delivery shows, by title (production orders 06.1 draws Holiday gift cards). */
const STILLS: Record<string, { title: string; line: string; colour: string }> = {
  "Holiday gift cards": { title: "Give Orange Street", line: "Gift cards at the counter", colour: "#6B4A2B" }
};

/** Master control delivers a version (the mock's stand-in for deliverOrder). */
export function deliverOrder(o: FxOrder, t: Date = now()): FxOrder | Fail {
  if (o.state !== "accepted" && o.state !== "changes_requested") return { status: 409, code: "not_in_the_making", message: "It isn't being made." };
  const version = o.deliveries.length + 1;
  const card = STILLS[o.title] ?? { title: o.title, line: o.business.name, colour: "#6B4A2B" };
  const slug = o.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  o.deliveries.push({ id: newId(), version, url: mockMediaUrl(`${slug}-v${version}`, card), previewUrl: null, createdAt: t.toISOString(), durationMs: o.lengthSec * 1000, checksPassed: CHECKS_PASSED });
  o.state = "delivered";
  o.deliveredAt = t.toISOString();
  o.autoApproveAt = new Date(t.getTime() + 7 * DAY).toISOString();
  saveDeals();
  return o;
}

export function addOrderNote(o: FxOrder, author: string | null, body: { timecodeMs: number | null; body: string }, t: Date = now()): FxOrder | Fail {
  if (o.state !== "delivered") return { status: 409, code: "not_delivered", message: "Notes go on a delivered spot." };
  o.notes.push({ id: newId(), timecodeMs: body.timecodeMs, author, body: body.body, makersMistake: false, round: o.roundsUsed + 1, createdAt: t.toISOString() });
  saveDeals();
  return o;
}

export function markOwnMistake(o: FxOrder, noteId: string): FxOrder | Fail {
  const n = o.notes.find((x) => x.id === noteId);
  if (!n) return { status: 404, code: "not_found", message: "That note wasn't found." };
  n.makersMistake = true;
  saveDeals();
  return o;
}

/** The notes on the delivery under review (this round's). */
export function roundNotes(o: Pick<ProductionOrder, "notes" | "roundsUsed">) {
  return o.notes.filter((n) => n.round === o.roundsUsed + 1);
}

/** Asking for changes uses a round unless every note in it is the maker's own mistake. */
export function changesUseARound(o: Pick<ProductionOrder, "notes" | "roundsUsed">): boolean {
  const notes = roundNotes(o);
  return notes.length === 0 || notes.some((n) => !n.makersMistake);
}

/** Approval: the hold goes to the maker, and the order becomes a spot waiting for a rate and budget. */
function approveOrder(o: FxOrder, t: Date) {
  const price = o.quote?.priceMicros ?? 0;
  if (o.heldInBooks && price > 0) spendHeld(o.business.id, price, "order", `Paid to ${makerName(o.maker)}`, `Production order, ${o.title}`);
  o.heldInBooks = false;
  o.state = "approved";
  o.approvedAt = t.toISOString();
  o.spotId = makeSpot(o, t).id;
}

/** B1: an approved order becomes a draft spot with no rate or budget yet (0 stands in until the contract allows null). */
function makeSpot(o: FxOrder, t: Date): Spot {
  const db = getDb();
  const b = dbBusiness(o.business.id);
  const last = o.deliveries[o.deliveries.length - 1];
  const spot: Spot = {
    id: newId(),
    businessId: o.business.id,
    title: o.title,
    lengthSec: o.lengthSec,
    category: b?.category ?? "Food",
    state: "draft",
    inRotationOn: 0,
    rate: { kind: "per_thousand", micros: 0, perAiringMaxMicros: null },
    budget: { totalMicros: 0, dailyCapMicros: null, usedMicros: 0, usedTodayMicros: 0 },
    startsOn: null,
    endsOn: null,
    targeting: { withinMiles: 10, locationIds: b?.locations[0] ? [b.locations[0].id] : [], marketIds: [], stationCategories: [], dayparts: [], excludedStationIds: [] },
    code: null,
    file: last
      ? {
          url: last.url,
          previewUrl: last.previewUrl ?? null,
          durationMs: last.durationMs ?? o.lengthSec * 1000,
          originalFilename: null,
          checks: [
            { check: "length", result: "fine", label: "Length", detail: null },
            { check: "safe_area", result: "fine", label: "Safe areas", detail: null },
            { check: "loudness", result: "fine", label: "Loudness", detail: null },
            { check: "captions", result: "fine", label: "Captions", detail: null }
          ]
        }
      : null,
    productionOrderId: o.id,
    createdAt: t.toISOString()
  };
  db.spots.push(spot);
  saveDb();
  return spot;
}

export function reviewDelivery(o: FxOrder, decision: "approve" | "request_changes" | "dispute", t: Date = now()): FxOrder | Fail {
  if (o.state !== "delivered") return { status: 409, code: "not_delivered", message: "There's no delivery to review." };
  if (decision === "approve") approveOrder(o, t);
  else if (decision === "request_changes") {
    if (roundNotes(o).length === 0) return { status: 422, code: "no_notes", message: "Pin a note to the moment you want changed first." };
    const uses = changesUseARound(o);
    const left = (o.quote?.roundsIncluded ?? 0) - o.roundsUsed;
    if (uses && left <= 0) return { status: 409, code: "no_rounds", message: "You've used the rounds of changes. Ask Opencast to review it instead." };
    if (uses) o.roundsUsed += 1;
    else for (const n of roundNotes(o)) n.round = -1; // Fixes on the maker's account: kept, outside any round.
    o.state = "changes_requested";
    o.autoApproveAt = null;
  } else {
    if (changesUseARound(o) && (o.quote?.roundsIncluded ?? 0) - o.roundsUsed > 0) return { status: 409, code: "rounds_left", message: "Ask for changes first: a round is included." };
    o.state = "disputed";
    o.autoApproveAt = null;
  }
  saveDeals();
  return o;
}

/** Cancel: before a quote is accepted, freely; after, only once the delivery date has passed undelivered, and it all comes back. */
export function cancelOrder(o: FxOrder, t: Date = now()): FxOrder | Fail {
  if (o.state === "asked" || o.state === "quoted" || o.state === "passed") {
    o.state = "cancelled";
  } else if (o.state === "accepted" || o.state === "changes_requested") {
    const by = o.quote?.deliverBy;
    if (!by || localDate(t) <= by) return { status: 409, code: "not_late", message: `You can cancel if ${makerName(o.maker)} hasn't delivered by ${by ? plainDate(by) : "the date it quoted"}.` };
    const price = o.quote?.priceMicros ?? 0;
    if (o.heldInBooks && price > 0) returnHeld(o.business.id, price, `Returned: ${o.title}`, "Production order cancelled after its delivery date");
    o.heldInBooks = false;
    o.refundedMicros = price;
    o.state = "cancelled";
  } else return { status: 409, code: "not_cancellable", message: "It can't be cancelled now." };
  saveDeals();
  return o;
}

/** Opencast's review of a disputed order (admin; the mock's stand-in). */
export function resolveOrderDispute(o: FxOrder, outcome: "pay_maker" | "refund" | "split", makerMicros: number | undefined, t: Date = now()): FxOrder | Fail {
  if (o.state !== "disputed") return { status: 409, code: "not_disputed", message: "It isn't with Opencast for review." };
  const price = o.quote?.priceMicros ?? 0;
  if (outcome === "pay_maker") {
    approveOrder(o, t);
  } else {
    const toMaker = outcome === "split" ? Math.min(price, makerMicros ?? Math.round(price / 2)) : 0;
    if (o.heldInBooks) {
      if (toMaker > 0) spendHeld(o.business.id, toMaker, "order", `Paid to ${makerName(o.maker)}`, `Production order, ${o.title}, after Opencast's review`);
      if (price - toMaker > 0) returnHeld(o.business.id, price - toMaker, `Returned: ${o.title}`, "After Opencast's review");
    }
    o.heldInBooks = false;
    o.refundedMicros = price - toMaker;
    o.state = "cancelled";
  }
  saveDeals();
  return o;
}

/** The order as the API returns it (without the mock's bookkeeping). */
export function publicOrder({ heldInBooks: _, ...o }: FxOrder): ProductionOrder {
  return o;
}

export function publicSponsorship({ heldMonths: _h, settledThrough: _s, ...x }: FxSponsorship): Sponsorship {
  return x;
}
