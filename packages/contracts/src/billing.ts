// Pay-as-you-go for stations (added 2026-09-29, follow-up Phase 2). One channel per station, and
// being on air is free: a station pays only for what costs Opencast the most, measured each day
// and paid at month end, from its earnings first, then its funding source (the owner's linked
// Clear wallet with full access, or a card saved through Stripe). Prices are rules in the registry
// with effective dates (`prices.*`, rules.ts), like Opencast's share; the free allowance too.
// Master control's "Station account" pane (Station settings) reads and changes it here.

import { z } from "zod";
import { endpoint } from "./core.js";
import { DateOnly, Id, Micros, Timestamp } from "./common.js";

/**
 * What's metered. `relay_live_only` (relays in "Live shows only" mode, Phase 3) is always free and
 * listed so the pane can say so; `radio_live` is radio live through the worker's own ingest (not
 * Livepeer), its own type so it can be priced apart (free by default, Open).
 */
export const UsageType = z.enum(["storage", "relay_everything", "live_hours", "radio_live", "relay_live_only"]);
export type UsageType = z.infer<typeof UsageType>;

/** GB a month (storage: each day's GB, averaged over the month) or hours. */
export const UsageUnit = z.enum(["gb_month", "hour"]);
export type UsageUnit = z.infer<typeof UsageUnit>;

export interface UsageTypeDef {
  label: string;
  unit: UsageUnit;
  /** The price rule in the registry (`prices.*`) and its field; null: always free. */
  priceRule: "prices.storage" | "prices.relay_everything" | "prices.live_hours" | "prices.radio_live" | null;
  priceField: "perGbMonthMicros" | "perHourMicros" | null;
  /** The free allowance's field (`prices.free_allowance`), when the type has one. */
  allowanceField: "storageGb" | "liveHours" | null;
  /** A station can cap it for the month. */
  cappable: boolean;
  /** What reaching the cap (or an unpaid bill, for relays and live hours) pauses. Never the channel. */
  pauses: string | null;
  /** Paused when a bill goes unpaid past the grace period. */
  pausedWhenUnpaid: boolean;
}

/**
 * The pricing table: every usage type, its rule and unit. A new type (number and call-sign
 * licenses, say) is an entry here and a rule in rules.ts.
 */
export const USAGE_TYPES: Record<UsageType, UsageTypeDef> = {
  storage: {
    label: "Storage",
    unit: "gb_month",
    priceRule: "prices.storage",
    priceField: "perGbMonthMicros",
    allowanceField: "storageGb",
    cappable: true,
    pauses: "New uploads and imports",
    pausedWhenUnpaid: false
  },
  relay_everything: {
    label: "Relays, everything you air",
    unit: "hour",
    priceRule: "prices.relay_everything",
    priceField: "perHourMicros",
    allowanceField: null,
    cappable: true,
    pauses: "Relays of everything you air",
    pausedWhenUnpaid: true
  },
  live_hours: {
    label: "Live hours",
    unit: "hour",
    priceRule: "prices.live_hours",
    priceField: "perHourMicros",
    allowanceField: "liveHours",
    cappable: true,
    pauses: "Live shows (station ID and bumpers air instead)",
    pausedWhenUnpaid: true
  },
  radio_live: {
    label: "Radio live",
    unit: "hour",
    priceRule: "prices.radio_live",
    priceField: "perHourMicros",
    allowanceField: null,
    cappable: true,
    pauses: "Live shows (station ID and bumpers air instead)",
    pausedWhenUnpaid: false
  },
  relay_live_only: {
    label: "Relays, live shows only",
    unit: "hour",
    priceRule: null,
    priceField: null,
    allowanceField: null,
    cappable: false,
    pauses: null,
    pausedWhenUnpaid: false
  }
};

export const USAGE_TYPE_ORDER: UsageType[] = ["storage", "relay_everything", "live_hours", "radio_live", "relay_live_only"];

/** Reserved in the same pricing table, not built: yearly renewals of a number and a call sign (Open). */
export const RESERVED_USAGE_TYPES = [{ type: "licenses", label: "Number and call sign licenses", unit: "year", note: "Yearly renewals. Open: not built." }] as const;

/** Stripe won't charge a card less than this: smaller amounts wait for the next month's bill. */
export const CARD_MINIMUM_MICROS = 500_000;

export const UsageLine = z.object({
  type: UsageType,
  label: z.string(),
  unit: UsageUnit,
  /** So far this month. Storage: GB-months (each day's GB ÷ the days in the month, added up); hours otherwise. */
  quantity: z.number(),
  /** Storage: what's stored today, in GB (originals and prepared segments together). Null for hours. */
  currentGb: z.number().nullable(),
  /** The month's free allowance for this type, and what's left of it. Null: no allowance. */
  allowance: z.object({ quantity: z.number(), left: z.number() }).nullable(),
  /** The price per unit now. Null: not set yet (nothing is charged). 0 for a free type. */
  priceMicros: Micros.nullable(),
  /** Never charged (relays in "Live shows only" mode; a type priced at $0). */
  free: z.boolean(),
  /** Charged so far this month (after the allowance, at each day's price, never past the cap). */
  soFarMicros: Micros,
  /** The month at this pace: storage as it stands today, hours at the month's pace so far. */
  estimate: z.object({ quantity: z.number(), micros: Micros }),
  cap: z.object({
    /** Null: no cap. */
    micros: Micros.nullable(),
    reached: z.boolean(),
    /** False for free types, which can't be capped. */
    cappable: z.boolean()
  }),
  /** Why it's paused now: its cap reached this month, or a bill unpaid past the grace period. Null: running. */
  paused: z.enum(["cap", "unpaid"]).nullable(),
  /** What pausing it stops. Never the channel. */
  pauses: z.string().nullable()
});
export type UsageLine = z.infer<typeof UsageLine>;

export const UsageBill = z.object({
  id: Id,
  /** `2026-10`. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  /** `open`: the month is still going. `due`: closed with something left to pay. `paid`. */
  status: z.enum(["open", "due", "paid"]),
  amountMicros: Micros,
  fromEarningsMicros: Micros,
  fromClearMicros: Micros,
  fromCardMicros: Micros,
  dueMicros: Micros,
  /** The last try to charge what earnings didn't cover. */
  lastAttempt: z
    .object({ at: Timestamp, method: z.enum(["card", "clear"]), result: z.enum(["failed", "pending", "waiting_for_approval"]), reason: z.string().nullable() })
    .nullable(),
  paidAt: Timestamp.nullable(),
  /** Per type, once the month is closed. */
  lines: z
    .array(z.object({ type: UsageType, quantity: z.number(), freeQuantity: z.number(), billableQuantity: z.number(), priceMicros: Micros.nullable(), micros: Micros }))
    .nullable()
});
export type UsageBill = z.infer<typeof UsageBill>;

export const StationAccount = z.object({
  stationId: Id,
  /** The month so far (UTC): `2026-10`, its first and last days, and when this was worked out. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  monthStart: DateOnly,
  monthEnd: DateOnly,
  asOf: Timestamp,
  usage: z.array(UsageLine),
  totals: z.object({ soFarMicros: Micros, estimateMicros: Micros }),
  /** The free allowance each month (Open), and what's left this month. */
  allowance: z.object({ storageGb: z.number(), liveHours: z.number(), storageGbLeft: z.number(), liveHoursLeft: z.number() }),
  /**
   * `ok`; `grace` (a bill went unpaid: relays and live hours keep going until `grace.pausesOn`);
   * `paused` (relays and live hours are paused until it's paid). The channel is never paused.
   */
  standing: z.enum(["ok", "grace", "paused"]),
  grace: z.object({ startedOn: DateOnly, pausesOn: DateOnly, daysLeft: z.number().int(), dueMicros: Micros }).nullable(),
  /** Owed and not yet paid, from closed months (what "Pay now" charges). */
  dueMicros: Micros,
  funding: z.object({
    /** Usage is taken from earnings first, always. */
    earningsFirst: z.literal(true),
    earningsAvailableMicros: Micros,
    /**
     * What pays what earnings don't cover now: the owners' choice (`chosen`), or when they haven't
     * chosen, an owner's linked Clear wallet with full access, otherwise the card. Null: nothing can.
     */
    source: z.enum(["clear", "card"]).nullable(),
    /** What the owners chose (`setFundingSource`); null: the order above. */
    chosen: z.enum(["clear", "card"]).nullable(),
    clear: z.object({
      /** The owner's linked Clear wallet can pay (Clear gave Opencast full access, and the server has Clear). */
      available: z.boolean(),
      access: z.enum(["read_only", "full"]).nullable(),
      /** The linked wallet paying, when Clear is the source. */
      address: z.string().nullable(),
      /** Why it can't, in plain words ("Clear lets Opencast only read your wallet"). */
      why: z.string().nullable()
    }),
    card: z.object({ label: z.string(), expiresOn: DateOnly.nullable(), expired: z.boolean() }).nullable(),
    /** Cards can be saved on this server (Stripe, or the local fake). */
    cardsAvailable: z.boolean()
  }),
  /** This month's bill and the ones before it, newest first (at most 6). */
  bills: z.array(UsageBill),
  /** The caller may change caps and the funding source, and pay (owners). Operators see only. */
  canManage: z.boolean()
});
export type StationAccount = z.infer<typeof StationAccount>;

const StationParams = z.object({ stationId: Id });

export const billingApi = {
  getStationAccount: endpoint({
    method: "GET",
    path: "/stations/:stationId/account",
    auth: "user",
    summary:
      "The Station account (owners and operators; operators see only): usage so far this month and the month's estimate per type, the free allowance left, caps, the funding source, standing (ok, grace, paused) and recent bills",
    params: StationParams,
    response: StationAccount
  }),
  setUsageCaps: endpoint({
    method: "PUT",
    path: "/stations/:stationId/account/caps",
    auth: "user",
    summary:
      "Monthly caps in dollars per usage type (owner only). Null removes a cap. Reaching one pauses that usage until the month ends (relays, live shows, new uploads), never the channel, and tells the owner. 422 `not_cappable` for a free type.",
    params: StationParams,
    body: z.object({ caps: z.partialRecord(UsageType, Micros.min(0).nullable()) }),
    response: StationAccount
  }),
  startCardSetup: endpoint({
    method: "POST",
    path: "/stations/:stationId/account/card-setup",
    auth: "user",
    summary:
      "Start saving a card (owner only): a Stripe SetupIntent for the station, to confirm with Stripe's own card form (`clientSecret`, with `publishableKey`), then `saveCard`. 409 `cards_unavailable` when this server has no card provider.",
    params: StationParams,
    response: z.object({ setupIntentId: z.string(), clientSecret: z.string(), publishableKey: z.string().nullable() }),
    status: 201
  }),
  saveCard: endpoint({
    method: "POST",
    path: "/stations/:stationId/account/card",
    auth: "user",
    summary:
      "The card's SetupIntent succeeded: save it as the station's card (owner only), replacing any other. When the card is what pays (chosen, or no Clear wallet with full access), anything due is charged to it at once; paid, relays and live hours resume. 422 `card_not_saved` when the SetupIntent isn't the station's or didn't succeed.",
    params: StationParams,
    body: z.object({ setupIntentId: z.string().min(1) }),
    response: StationAccount
  }),
  removeCard: endpoint({
    method: "DELETE",
    path: "/stations/:stationId/account/card",
    auth: "user",
    summary: "Remove the station's card (owner only). If it was the funding source, none is chosen until another is.",
    params: StationParams,
    response: StationAccount
  }),
  setFundingSource: endpoint({
    method: "PUT",
    path: "/stations/:stationId/account/funding",
    auth: "user",
    summary:
      "Choose what pays what earnings don't cover (owner only), instead of the default order (an owner's Clear wallet with full access, then the card): `clear` (the caller's linked Clear wallet; 409 `clear_not_linked`, `clear_read_only` or `clear_unavailable`) or `card` (409 `no_card` until one is saved)",
    params: StationParams,
    body: z.object({ source: z.enum(["clear", "card"]) }),
    response: StationAccount
  }),
  payUsageNow: endpoint({
    method: "POST",
    path: "/stations/:stationId/account/pay",
    auth: "user",
    summary:
      "Pay what's due now (owner only): from earnings first, then the card. Paid, relays and live hours resume. 409 `nothing_due`; 409 `pay_from_clear` when the source is Clear (use the Clear payment); 422 `card_declined` with the card's reason.",
    params: StationParams,
    response: StationAccount
  }),
  quoteClearUsagePayment: endpoint({
    method: "POST",
    path: "/stations/:stationId/account/clear-payment/quote",
    auth: "user",
    summary:
      "Paying what's due from the owner's linked Clear wallet (owner only, full access): where to send it. The app asks Clear to send it (the person confirms on Clear's page), then confirms with the transaction hash. 409 `nothing_due`, `clear_read_only`, `clear_not_linked`, `clear_unavailable`.",
    params: StationParams,
    response: z.object({
      /** Opencast's account to send to. */
      to: z.string(),
      token: z.object({ address: z.string(), symbol: z.literal("USDC"), decimals: z.literal(6) }),
      chainId: z.number().int(),
      amountMicros: Micros,
      /** The amount in the token's units (USDC has 6 decimals, so the same as micros). */
      amountUnits: z.string(),
      from: z.string()
    })
  }),
  confirmClearUsagePayment: endpoint({
    method: "POST",
    path: "/stations/:stationId/account/clear-payment",
    auth: "user",
    summary:
      "The transfer from Clear was sent (owner only): checked on chain (from the owner's linked wallet, to Opencast's account, at least what's due), then what's due is paid and relays and live hours resume. Waits while it isn't mined yet. 422 `transfer_not_valid`; 409 `transfer_already_used`.",
    params: StationParams,
    body: z.object({ amountMicros: Micros.positive(), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
    response: StationAccount
  })
};
