// Pay-as-you-go (follow-up Phase 2): the Station account, as the API answers it
// (billingApi.getStationAccount), in three states the screens are built against:
//
// - `free`: inside the free allowance (Inland Sound Lab, the studio): nothing to pay.
// - `earnings`: paid from earnings (BEAT): usage taken before each weekly payout; a card on file
//   that's never needed.
// - `grace`: in the grace period (HALL): August's usage couldn't be charged (the card was
//   declined); relays and live shows keep going until the grace period ends, the channel always.
// - `paused` (a fourth, for the paused screens): the grace period is over; relays and live shows
//   are paused until it's paid, the channel still on air.
//
// Prices are the starting price sheet (docs/pricing.md, migration 0033), shown as in effect: the
// registry has them from October 1, 2026, and the mock's clock is in September. Any station can be
// put in any state with `setAccountState` (e.g. from the browser console, or a test).

import { USAGE_TYPE_ORDER, USAGE_TYPES, type StationAccount, type Statement, type UsageBill, type UsageLine, type UsageType } from "@opencast/contracts";
import { now } from "../../../lib/clock";
import { BEAT, HALL, LAB } from "./stations";

export type AccountState = "free" | "earnings" | "grace" | "paused";

/** The starting price sheet (per GB-month; per hour). */
export const PRICES: Record<UsageType, number | null> = {
  storage: 40_000,
  relay_everything: 200_000,
  live_hours: 750_000,
  radio_live: 0,
  relay_live_only: 0
};
export const ALLOWANCE = { storageGb: 10, liveHours: 5 };
export const GRACE_DAYS = 14;

/** What each state used this month, as of the mock's now: GB kept today, and hours so far. */
interface Usage {
  storageGb: number;
  relayHoursPerDay: number;
  liveHours: number;
  radioLiveHours: number;
}

const USAGE: Record<AccountState, Usage> = {
  free: { storageGb: 6.2, relayHoursPerDay: 0, liveHours: 1.5, radioLiveHours: 0 },
  earnings: { storageGb: 42, relayHoursPerDay: 6, liveHours: 8, radioLiveHours: 0 },
  grace: { storageGb: 18, relayHoursPerDay: 24, liveHours: 0, radioLiveHours: 6 },
  paused: { storageGb: 18, relayHoursPerDay: 24, liveHours: 0, radioLiveHours: 6 }
};

export interface MockAccount {
  /** What the station uses this month (and how the account was seeded). */
  profile: AccountState;
  /** Past the grace period: relays and live shows paused until it's paid. */
  paused: boolean;
  caps: Partial<Record<UsageType, number>>;
  card: { ref: string; label: string; expiresOn: string; declines: boolean } | null;
  /** The owners' choice; null: Clear with full access, else the card. */
  chosen: "clear" | "card" | null;
  /** Last month's bill: what's still due, and how it was paid. */
  lastMonth: { amountMicros: number; fromEarningsMicros: number; fromCardMicros: number; fromClearMicros: number; dueMicros: number; failure: string | null; paidAt: string | null };
  /** When the grace period started (grace and paused). */
  graceStartedAt: string | null;
}

const KEY = "oc.mock.stationAccount.v1";
let accounts: Record<string, MockAccount> | null = null;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthStart = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
const daysIn = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();

function seedAccount(state: AccountState): MockAccount {
  const t = now();
  const card = { ref: "pm_mock_4242", label: "Visa ending 4242", expiresOn: "2029-08-31", declines: false };
  switch (state) {
    case "free":
      return { profile: state, paused: false, caps: {}, card: null, chosen: null, lastMonth: { amountMicros: 0, fromEarningsMicros: 0, fromCardMicros: 0, fromClearMicros: 0, dueMicros: 0, failure: null, paidAt: `${iso(monthStart(t))}T00:00:00.000Z` }, graceStartedAt: null };
    case "earnings":
      return { profile: state, paused: false, caps: { relay_everything: 60_000_000 }, card, chosen: null, lastMonth: { amountMicros: 38_940_000, fromEarningsMicros: 38_940_000, fromCardMicros: 0, fromClearMicros: 0, dueMicros: 0, failure: null, paidAt: `${iso(monthStart(t))}T00:00:00.000Z` }, graceStartedAt: null };
    case "grace":
    case "paused": {
      // Grace started a week ago (still in it), or more than the grace period ago (paused).
      const started = new Date(t.getTime() - (state === "grace" ? 7 : GRACE_DAYS + 2) * 86_400_000);
      return {
        profile: state,
        paused: state === "paused",
        caps: {},
        card: { ref: "pm_mock_0002", label: "Visa ending 0002", expiresOn: "2027-03-31", declines: true },
        chosen: null,
        lastMonth: { amountMicros: 96_400_000, fromEarningsMicros: 0, fromCardMicros: 0, fromClearMicros: 0, dueMicros: 96_400_000, failure: "Your card was declined.", paidAt: null },
        graceStartedAt: started.toISOString()
      };
    }
  }
}

const DEFAULT_STATES: Record<string, AccountState> = { [LAB.id]: "free", [BEAT.id]: "earnings", [HALL.id]: "grace" };

function load(): Record<string, MockAccount> {
  if (accounts) return accounts;
  try {
    const raw = localStorage.getItem(KEY);
    accounts = raw ? (JSON.parse(raw) as Record<string, MockAccount>) : {};
  } catch {
    accounts = {};
  }
  return accounts;
}

export function saveAccounts() {
  try {
    localStorage.setItem(KEY, JSON.stringify(load()));
  } catch {
    // Private windows: this visit only.
  }
}

export function resetAccounts() {
  accounts = {};
  saveAccounts();
}

/** The station's mock account (its default state the first time). */
export function mockAccount(stationId: string): MockAccount {
  const all = load();
  if (!all[stationId]) all[stationId] = seedAccount(DEFAULT_STATES[stationId] ?? "free");
  return all[stationId];
}

/** Puts a station's account in a state (fresh): `free`, `earnings`, `grace` or `paused`. */
export function setAccountState(stationId: string, state: AccountState) {
  load()[stationId] = seedAccount(state);
  saveAccounts();
}

/** Builds what `getStationAccount` answers. */
export function stationAccount(stationId: string, options: { owner: boolean; clear: { address: string; access: "read_only" | "full" } | null; earningsAvailableMicros: number }): StationAccount {
  const a = mockAccount(stationId);
  const t = now();
  const start = monthStart(t);
  const D = daysIn(t);
  const elapsed = (t.getTime() - start.getTime()) / 86_400_000;
  const u = USAGE[a.profile];
  const paused = a.paused && a.lastMonth.dueMicros > 0;
  const hours: Record<UsageType, number> = {
    storage: (u.storageGb * Math.ceil(elapsed)) / D,
    relay_everything: paused ? u.relayHoursPerDay * (elapsed - 2) : u.relayHoursPerDay * elapsed,
    live_hours: u.liveHours,
    radio_live: u.radioLiveHours,
    relay_live_only: 0
  };
  const usage: UsageLine[] = USAGE_TYPE_ORDER.map((type) => {
    const def = USAGE_TYPES[type];
    const quantity = Math.round(hours[type] * 1e6) / 1e6;
    const allowance = def.allowanceField ? ALLOWANCE[def.allowanceField] : 0;
    const price = PRICES[type] ?? 0;
    const cap = a.caps[type] ?? null;
    const raw = Math.max(0, quantity - allowance) * price;
    const soFar = Math.round(cap === null ? raw : Math.min(raw, cap));
    const estimateQuantity = type === "storage" ? u.storageGb : type === "relay_everything" && paused ? quantity : elapsed > 0 ? (quantity / elapsed) * D : 0;
    const estimateRaw = Math.max(0, estimateQuantity - allowance) * price;
    const capReached = cap !== null && raw >= cap && (cap > 0 || raw > 0);
    return {
      type,
      label: def.label,
      unit: def.unit,
      quantity,
      currentGb: type === "storage" ? u.storageGb : null,
      allowance: def.allowanceField ? { quantity: allowance, left: Math.round(Math.max(0, allowance - quantity) * 1e6) / 1e6 } : null,
      priceMicros: def.priceRule ? price : 0,
      free: !def.priceRule || price === 0,
      soFarMicros: soFar,
      estimate: { quantity: Math.round(estimateQuantity * 1e6) / 1e6, micros: Math.max(soFar, Math.round(cap === null ? estimateRaw : Math.min(estimateRaw, cap))) },
      cap: { micros: def.cappable ? cap : null, reached: capReached, cappable: def.cappable },
      paused: capReached ? "cap" : paused && def.pausedWhenUnpaid ? "unpaid" : null,
      pauses: def.pauses
    };
  });
  const soFar = usage.reduce((s, l) => s + l.soFarMicros, 0);
  const lastMonthStart = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
  const clearFull = options.clear?.access === "full";
  const source = a.chosen === "clear" ? (clearFull ? "clear" : null) : a.chosen === "card" ? (a.card ? "card" : null) : clearFull ? "clear" : a.card ? "card" : null;
  const bills: UsageBill[] = [
    {
      id: `${stationId.slice(0, 24)}${stationId.slice(-6)}${String(start.getUTCMonth() + 1).padStart(6, "0")}`,
      month: iso(start).slice(0, 7),
      status: "open",
      amountMicros: Math.round(soFar * 0.9),
      fromEarningsMicros: a.profile === "earnings" ? Math.round(soFar * 0.75) : 0,
      fromClearMicros: 0,
      fromCardMicros: 0,
      dueMicros: a.profile === "earnings" ? Math.round(soFar * 0.15) : Math.round(soFar * 0.9),
      lastAttempt: null,
      paidAt: null,
      lines: null
    },
    {
      id: `${stationId.slice(0, 24)}${stationId.slice(-6)}${String(lastMonthStart.getUTCMonth() + 1).padStart(6, "0")}`,
      month: iso(lastMonthStart).slice(0, 7),
      status: a.lastMonth.dueMicros > 0 ? "due" : "paid",
      amountMicros: a.lastMonth.amountMicros,
      fromEarningsMicros: a.lastMonth.fromEarningsMicros,
      fromClearMicros: a.lastMonth.fromClearMicros,
      fromCardMicros: a.lastMonth.fromCardMicros,
      dueMicros: a.lastMonth.dueMicros,
      lastAttempt: a.lastMonth.dueMicros > 0 && a.lastMonth.failure ? { at: a.graceStartedAt ?? t.toISOString(), method: "card", result: "failed", reason: a.lastMonth.failure } : null,
      paidAt: a.lastMonth.paidAt,
      lines:
        a.lastMonth.amountMicros > 0
          ? a.profile === "earnings"
            ? [
                { type: "storage", quantity: 38.5, freeQuantity: 10, billableQuantity: 28.5, priceMicros: 40_000, micros: 1_140_000 },
                { type: "relay_everything", quantity: 168, freeQuantity: 0, billableQuantity: 168, priceMicros: 200_000, micros: 33_600_000 },
                { type: "live_hours", quantity: 10.6, freeQuantity: 5, billableQuantity: 5.6, priceMicros: 750_000, micros: 4_200_000 }
              ]
            : [
                { type: "storage", quantity: 17.5, freeQuantity: 10, billableQuantity: 7.5, priceMicros: 40_000, micros: 300_000 },
                { type: "relay_everything", quantity: 480.5, freeQuantity: 0, billableQuantity: 480.5, priceMicros: 200_000, micros: 96_100_000 },
                { type: "radio_live", quantity: 9, freeQuantity: 0, billableQuantity: 9, priceMicros: 0, micros: 0 }
              ]
          : [{ type: "storage", quantity: 5.8, freeQuantity: 5.8, billableQuantity: 0, priceMicros: 40_000, micros: 0 }]
    }
  ];
  const grace =
    a.graceStartedAt && a.lastMonth.dueMicros > 0
      ? (() => {
          const pausesAt = new Date(Date.parse(a.graceStartedAt) + GRACE_DAYS * 86_400_000);
          return { startedOn: a.graceStartedAt.slice(0, 10), pausesOn: iso(pausesAt), daysLeft: Math.max(0, Math.ceil((pausesAt.getTime() - t.getTime()) / 86_400_000)), dueMicros: a.lastMonth.dueMicros };
        })()
      : null;
  return {
    stationId,
    month: iso(start).slice(0, 7),
    monthStart: iso(start),
    monthEnd: iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0))),
    asOf: t.toISOString(),
    usage,
    totals: { soFarMicros: soFar, estimateMicros: usage.reduce((s, l) => s + l.estimate.micros, 0) },
    allowance: {
      storageGb: ALLOWANCE.storageGb,
      liveHours: ALLOWANCE.liveHours,
      storageGbLeft: usage.find((l) => l.type === "storage")!.allowance!.left,
      liveHoursLeft: usage.find((l) => l.type === "live_hours")!.allowance!.left
    },
    standing: grace ? (paused ? "paused" : "grace") : "ok",
    grace,
    dueMicros: a.lastMonth.dueMicros,
    funding: {
      earningsFirst: true,
      earningsAvailableMicros: options.earningsAvailableMicros,
      source,
      chosen: a.chosen,
      clear: {
        available: clearFull,
        access: options.clear?.access ?? null,
        address: options.clear?.address ?? null,
        why: !options.clear ? "Connect Clear first." : clearFull ? null : "Clear lets Opencast only read your Clear wallet, so it can't pay from it."
      },
      card: a.card ? { label: a.card.label, expiresOn: a.card.expiresOn, expired: a.card.expiresOn < iso(t) } : null,
      cardsAvailable: true
    },
    bills,
    canManage: options.owner
  };
}

/** Pays what's due: the mock's card charge, or a transfer from Clear. */
export function payDue(stationId: string, how: "card" | "clear"): { ok: true } | { ok: false; reason: string } {
  const a = mockAccount(stationId);
  if (how === "card" && a.card?.declines) {
    a.lastMonth.failure = "Your card was declined.";
    saveAccounts();
    return { ok: false, reason: "Your card was declined." };
  }
  const due = a.lastMonth.dueMicros;
  if (how === "card") a.lastMonth.fromCardMicros += due;
  else a.lastMonth.fromClearMicros += due;
  a.lastMonth.dueMicros = 0;
  a.lastMonth.failure = null;
  a.lastMonth.paidAt = now().toISOString();
  a.graceStartedAt = null;
  a.paused = false;
  saveAccounts();
  return { ok: true };
}

/**
 * The usage section on a statement (earnings, weekly and monthly): BEAT's August statement, the
 * month's usage per type with units and prices (shown), and what was taken from earnings before
 * the payouts (added in). Appended to BEAT's statements in the Earnings mock.
 */
export function usageStatement(stationId: string): Statement | null {
  if (stationId !== BEAT.id) return null;
  const shown = (label: string, detail: string, micros: number, usage: NonNullable<Statement["lines"][number]["usage"]>) => ({ label, detail, amountMicros: -micros, notSetYet: false, group: "usage" as const, includedAbove: true, usage });
  return {
    id: "00000000-0000-4000-8000-0000000a0826",
    period: "month",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    openingMicros: 0,
    closingMicros: 0,
    lines: [
      { label: "Earned", detail: "Spots, sponsors, pledges and carriage: the weekly statements", amountMicros: 2_020_400_000, notSetYet: false, group: "other" },
      { label: "Usage, taken from earnings", detail: "4 entries, before each weekly payout and when the month closed", amountMicros: -38_940_000, notSetYet: false, group: "usage" },
      { label: "Paid out", detail: "4 entries", amountMicros: -1_981_460_000, notSetYet: false, group: "other" },
      shown("Storage", "38.50 GB-months, 10.00 free, at $0.04 a GB-month", 1_140_000, { type: "storage", unit: "gb_month", quantity: 38.5, freeQuantity: 10, billableQuantity: 28.5, priceMicros: 40_000 }),
      shown("Relays, everything you air", "168 hours, at $0.20 an hour", 33_600_000, { type: "relay_everything", unit: "hour", quantity: 168, freeQuantity: 0, billableQuantity: 168, priceMicros: 200_000 }),
      shown("Live hours", "10.6 hours, 5 free, at $0.75 an hour", 4_200_000, { type: "live_hours", unit: "hour", quantity: 10.6, freeQuantity: 5, billableQuantity: 5.6, priceMicros: 750_000 })
    ],
    issuedAt: "2026-09-01T15:00:00.000Z",
    csvUrl: "/v1/statements/00000000-0000-4000-8000-0000000a0826/csv",
    pdfUrl: null,
    paidOn: null,
    destination: null
  };
}
