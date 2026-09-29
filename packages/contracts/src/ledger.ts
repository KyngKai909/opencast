import { z } from "zod";
import { endpoint } from "./core.js";
import { DateOnly, Id, Micros, StationIdent, Timestamp } from "./common.js";

/** A value that isn't decided yet: shown as "Not set yet" at $0.00. */
export const Undecided = z.object({ micros: Micros, notSetYet: z.boolean() });

export const FundingSource = z.object({
  id: Id,
  kind: z.enum(["clear_bank", "card", "clear_account"]),
  label: z.string(),
  isDefault: z.boolean()
});

export const Balance = z.object({
  availableMicros: Micros,
  heldMicros: Micros,
  heldAirings: z.number().int(),
  spentThisMonthMicros: Micros,
  spentThisMonthAirings: z.number().int(),
  /** "At this month's pace, about $9.20 a day… covers about 44 days". */
  pacePerDayMicros: Micros,
  runwayDays: z.number().int().nullable(),
  pendingDeposits: z.array(z.object({ id: Id, amountMicros: Micros, expectedAt: Timestamp.nullable(), method: z.string() })),
  fundingSources: z.array(FundingSource),
  /**
   * E7 (added 2026-09-29): the business's balance account, to send USDC to from inside Clear (when
   * Clear shares the person's account read-only). Null where Clear funding isn't available.
   */
  depositAddress: z.string().nullable().optional()
});

export const Movement = z.object({
  id: Id,
  at: Timestamp,
  kind: z.enum(["aired", "held", "returned", "added", "withdrawn", "fee", "order", "sponsorship", "refund"]),
  /** "Aired on BEAT 12.1", "Held for 9 airings tonight", "Returned: airing cut short", "Added by bank transfer". */
  label: z.string(),
  amountMicros: Micros,
  detail: z.string().nullable()
});

export const Statement = z.object({
  id: Id,
  period: z.enum(["week", "month"]),
  periodStart: DateOnly,
  periodEnd: DateOnly,
  openingMicros: Micros,
  closingMicros: Micros,
  lines: z.array(
    z.object({
      label: z.string(),
      detail: z.string().nullable(),
      amountMicros: Micros,
      notSetYet: z.boolean().default(false),
      // ---- E3 (added 2026-09-29) ----
      /** Station statements use the first seven; business statements (2026-09-29) use `balance` and `spent`. */
      group: z.enum(["spots", "sponsors_pledges", "carriage", "shared", "card_fees", "production", "other", "balance", "spent"]).optional(),
      /** Business statements (added 2026-09-29): what the line is. `spot_station` lines are one spot on one station. */
      kind: z.enum(["added", "aired", "returned", "fees", "sponsorship", "order", "withdrawn", "refund", "spot_station"]).optional(),
      /** Shown, not added in (money returned from holds, fees paid on top). */
      includedAbove: z.boolean().optional(),
      /** How many airings the line is for (spot lines). */
      airings: z.number().int().optional(),
      /** The rate, when every airing on the line had the same one. Not sent yet. */
      rate: z.object({ kind: z.enum(["per_thousand", "per_airing"]), micros: Micros }).optional(),
      /** Per-thousand lines: the average tuned in across the airings. Not sent yet. */
      averageTunedIn: z.number().int().optional()
    })
  ),
  issuedAt: Timestamp,
  csvUrl: z.string(),
  pdfUrl: z.string().nullable(),
  // ---- E3 (added 2026-09-29) ----
  /** When the payout for the period was sent, and where ("Chase ending 2231"); null until it is. */
  paidOn: DateOnly.nullable().optional(),
  destination: z.string().nullable().optional(),
  // ---- E3, business statements (added 2026-09-29) ----
  /** This month, so far; the final statement is issued after the month ends (`finalOn`). */
  inProgress: z.boolean().optional(),
  /** The last day it covers so far. */
  asOf: DateOnly.optional(),
  finalOn: DateOnly.nullable().optional(),
  /** The closing figure, split. Business statements count the balance and what's held together. */
  closingAvailableMicros: Micros.optional(),
  closingHeldMicros: Micros.optional()
});

/** E4 (added 2026-09-29): a receipt for the books. Money added is a prepayment; sponsorships and orders are expenses; the monthly statement covers airings. */
export const Receipt = z.object({
  id: Id,
  kind: z.enum(["prepayment", "expense", "statement"]),
  /** "Money added", "Sponsorship", "Production order", "September statement". */
  title: z.string(),
  detail: z.string().nullable(),
  amountMicros: Micros,
  at: Timestamp,
  /** A PDF, at a link that works without signing in (it's signed for this business). */
  pdfUrl: z.string()
});

export const StationEarnings = z.object({
  period: z.enum(["week", "month", "year"]),
  lines: z.object({
    spots: z.object({ micros: Micros, airings: z.number().int(), businesses: z.number().int() }),
    sponsors: z.object({
    micros: Micros,
    sponsors: z.number().int(),
    /** E2 (added 2026-09-29): the approved sponsors by name, with their monthly amounts. */
    list: z.array(z.object({ name: z.string(), monthlyMicros: Micros })).optional()
  }),
    pledges: z.object({ micros: Micros, members: z.number().int(), newMembers: z.number().int() }),
    carriageIn: z.object({ micros: Micros, detail: z.string() }),
    carriageOut: z.object({ micros: Micros, detail: z.string() }),
    production: z.object({ micros: Micros, orders: z.number().int() }),
    opencastShare: Undecided,
    pool: Undecided,
    /**
     * Ads from partners (programmatic backfill, added 2026-09-28): paid when the partner pays,
     * 30 to 90 days after airing; never held, never escrowed. `on` mirrors the break rule's switch.
     */
    partnerAds: z.object({ on: z.boolean(), micros: Micros, pendingMicros: Micros }).optional()
  }),
  totalMicros: Micros,
  /** "Held for airings… Tonight 9 airings in 4 breaks". Becomes the station's when each airing runs. */
  held: z.object({
    tonightMicros: Micros,
    tonightAirings: z.number().int(),
    restOfWeekMicros: Micros,
    restOfWeekAirings: z.number().int(),
    /** E2 (added 2026-09-29): how many breaks tonight's held airings are in ("9 airings in 4 breaks"). */
    tonightBreaks: z.number().int().optional()
  }),
  account: z.object({ availableMicros: Micros, paidOutThisMonthMicros: Micros }),
  nextPayout: z
    .object({
      on: DateOnly,
      schedule: z.enum(["weekly", "monthly"]),
      destination: z.string().nullable(),
      /** E2 (added 2026-09-29): what it would pay if it went now: the available balance. */
      amountMicros: Micros.optional()
    })
    .nullable()
});

export const Pledge = z.object({
  id: Id,
  station: StationIdent,
  cadence: z.enum(["monthly", "once"]),
  amountMicros: Micros,
  creditOnAir: z.boolean(),
  startedAt: Timestamp,
  nextChargeOn: DateOnly.nullable(),
  endsAfter: DateOnly.nullable(),
  receipts: z.object({
    count: z.number().int(),
    totalMicros: Micros,
    /** E1 (added 2026-09-28): each payment, newest first. `url` is a document when the provider has one. */
    items: z.array(z.object({ id: Id, on: DateOnly, amountMicros: Micros, url: z.string().nullable() })).optional()
  }),
  /** E1 (added 2026-09-28): the card it's charged to ("Visa ending 4242"), once the provider says. Null before. */
  card: z.object({ label: z.string(), expired: z.boolean(), expiresOn: DateOnly.nullable().optional() }).nullable().optional()
});

const BusinessParams = z.object({ businessId: Id });
const StationParams = z.object({ stationId: Id });

export const ledgerApi = {
  getBalance: endpoint({
    method: "GET",
    path: "/businesses/:businessId/balance",
    auth: "user",
    summary: "Available, held and spent, the runway in days, pending deposits",
    params: BusinessParams,
    response: Balance
  }),
  listMovements: endpoint({
    method: "GET",
    path: "/businesses/:businessId/movements",
    auth: "user",
    summary: "Money in and out, and airings",
    params: BusinessParams,
    query: z.object({ filter: z.enum(["all", "money", "airings"]).default("all"), before: Timestamp.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }),
    response: z.array(Movement)
  }),
  addFundingSource: endpoint({
    method: "POST",
    path: "/businesses/:businessId/funding-sources",
    auth: "user",
    summary: "Link a bank through Clear, a card through Stripe, or a Clear business account (owner only). The token comes from the provider's own widget.",
    params: BusinessParams,
    body: z.object({ kind: z.enum(["clear_bank", "card", "clear_account"]), token: z.string().min(1), makeDefault: z.boolean().default(false) }),
    response: z.array(FundingSource),
    status: 201
  }),
  quoteDeposit: endpoint({
    method: "POST",
    path: "/businesses/:businessId/deposits/quote",
    auth: "user",
    summary: "The fee in dollars before paying (card: Stripe's fee at cost; bank and Clear: none), and roughly how many airings",
    params: BusinessParams,
    body: z.object({ amountMicros: Micros.positive(), method: z.enum(["clear_bank", "card", "clear_account"]) }),
    response: z.object({
      amountMicros: Micros,
      feeMicros: Micros,
      arrives: z.string(),
      roughAirings: z.number().int().nullable(),
      /** E6 (added 2026-09-29): what `roughAirings` is worked out on: the rate, and for per-thousand rates the station. Null without a listed or paused spot. */
      basis: z
        .object({ rateKind: z.enum(["per_thousand", "per_airing"]), rateMicros: Micros, station: StationIdent.nullable() })
        .nullable()
        .optional()
    })
  }),
  addMoney: endpoint({
    method: "POST",
    path: "/businesses/:businessId/deposits",
    auth: "user",
    summary: "Add money (owner, manager). Bank transfers arrive in 1 to 2 business days and can be undone until then.",
    params: BusinessParams,
    body: z.object({ amountMicros: Micros.positive(), fundingSourceId: Id }),
    response: z.object({ depositId: Id, status: z.enum(["pending", "arrived"]), balance: Balance }),
    status: 201
  }),
  quoteClearTransfer: endpoint({
    method: "POST",
    path: "/businesses/:businessId/deposits/clear-transfer/quote",
    auth: "user",
    summary: "Funding from a linked Clear wallet with full access (owner, manager): where to send it. The app asks Clear to send it (the person confirms on Clear's page), then confirms with the transaction hash. 409 when the person's Clear link is read-only or missing.",
    params: BusinessParams,
    body: z.object({ amountMicros: Micros.positive() }),
    response: z.object({
      /** The business's balance account to send to. */
      to: z.string(),
      token: z.object({ address: z.string(), symbol: z.literal("USDC"), decimals: z.literal(6) }),
      chainId: z.number().int(),
      /** The amount in the token's units (USDC has 6 decimals, so the same as micros). */
      amountUnits: z.string(),
      from: z.string()
    })
  }),
  confirmClearTransfer: endpoint({
    method: "POST",
    path: "/businesses/:businessId/deposits/clear-transfer",
    auth: "user",
    summary: "The transfer from Clear was sent: the API checks it on chain (from the person's linked Clear wallet, to the business's account, at least the amount) and credits the balance once it confirms",
    params: BusinessParams,
    body: z.object({ amountMicros: Micros.positive(), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
    response: z.object({ depositId: Id, status: z.enum(["pending", "arrived"]), balance: Balance }),
    status: 201
  }),
  cancelDeposit: endpoint({
    method: "POST",
    path: "/businesses/:businessId/deposits/:depositId/cancel",
    auth: "user",
    summary: "Undo a deposit that hasn't arrived",
    params: z.object({ businessId: Id, depositId: Id }),
    response: Balance
  }),
  withdraw: endpoint({
    method: "POST",
    path: "/businesses/:businessId/withdrawals",
    auth: "user",
    summary: "Take out unheld money (owner only)",
    params: BusinessParams,
    body: z.object({ amountMicros: Micros.positive(), fundingSourceId: Id }),
    response: z.object({ payoutId: Id, balance: Balance }),
    status: 201
  }),
  listStatements: endpoint({
    method: "GET",
    path: "/businesses/:businessId/statements",
    auth: "user",
    summary: "Monthly statements with every airing",
    params: BusinessParams,
    response: z.array(Statement)
  }),
  getStationEarnings: endpoint({
    method: "GET",
    path: "/stations/:stationId/earnings",
    auth: "user",
    summary: "Earnings lines, held money, the account and next payout (owner; operators see only)",
    params: StationParams,
    query: z.object({ period: z.enum(["week", "month", "year"]).default("month") }),
    response: StationEarnings
  }),
  listStationStatements: endpoint({
    method: "GET",
    path: "/stations/:stationId/statements",
    auth: "user",
    summary: "Weekly statements; the CSV has the ledger entries behind each line",
    params: StationParams,
    response: z.array(Statement)
  }),
  getStatementCsv: endpoint({
    method: "GET",
    path: "/statements/:statementId/csv",
    auth: "user",
    summary: "A statement's ledger entries as CSV (the business's team, or the station's owners)",
    params: z.object({ statementId: Id }),
    response: z.object({ filename: z.string(), csv: z.string() })
  }),
  getPayoutAccount: endpoint({
    method: "GET",
    path: "/stations/:stationId/payout-account",
    auth: "user",
    summary: "Where the station is paid (its Clear account, or Stripe Connect), and a link if it has to finish setting it up (owner only)",
    params: StationParams,
    response: z.object({
      status: z.enum(["active", "needs_onboarding"]),
      url: z.string().nullable(),
      /** Where payouts go (added 2026-09-28): the station's Clear account, an owner's linked Clear wallet, or Stripe Connect. */
      destination: z
        .object({ kind: z.enum(["clear_account", "clear_wallet", "stripe_connect"]), label: z.string(), address: z.string().nullable() })
        .nullable()
        .optional()
    })
  }),
  setPayoutDestination: endpoint({
    method: "PUT",
    path: "/stations/:stationId/payout-account",
    auth: "user",
    summary: "Pay the station out to the owner's linked Clear wallet (read-only access is enough), or back to its Clear account (owner only)",
    params: StationParams,
    body: z.object({ kind: z.enum(["clear_account", "clear_wallet"]) }),
    response: z.object({ status: z.enum(["active", "needs_onboarding"]), url: z.string().nullable() })
  }),
  moveToBank: endpoint({
    method: "POST",
    path: "/stations/:stationId/payouts",
    auth: "user",
    summary: "Move earnings to the bank now (owner only)",
    params: StationParams,
    body: z.object({ amountMicros: Micros.positive() }),
    response: z.object({ payoutId: Id, scheduledFor: DateOnly }),
    status: 201
  }),

  pledge: endpoint({
    method: "POST",
    path: "/stations/:stationId/pledges",
    auth: "user",
    summary: "Pledge monthly or once, by card. Credit me on air uses the display name.",
    params: StationParams,
    body: z.object({ cadence: z.enum(["monthly", "once"]), amountMicros: Micros.min(1_000_000), creditOnAir: z.boolean().default(false) }),
    response: z.object({ pledge: Pledge, checkoutUrl: z.string().nullable() }),
    status: 201
  }),
  listMyPledges: endpoint({ method: "GET", path: "/me/pledges", auth: "user", tvSession: true, summary: "My pledges", response: z.array(Pledge) }),
  updatePledge: endpoint({
    method: "PATCH",
    path: "/me/pledges/:pledgeId",
    auth: "user",
    summary:
      "Change the amount or on-air credit, or stop (it ends after the current month). `cadence` (added 2026-09-28, E1): a monthly pledge set to `once` isn't charged again (it ends after this month, like stop); set back to `monthly` before then, it carries on. A one-time pledge can't become monthly (422 `new_pledge_needed`: pledge again, monthly).",
    params: z.object({ pledgeId: Id }),
    body: z.object({ amountMicros: Micros.min(1_000_000), creditOnAir: z.boolean(), stop: z.literal(true), cadence: z.enum(["monthly", "once"]) }).partial(),
    response: Pledge
  }),
  /** E1 (added 2026-09-28). */
  // ---- E4, E5 (added 2026-09-29) ----
  listReceipts: endpoint({
    method: "GET",
    path: "/businesses/:businessId/receipts",
    auth: "user",
    summary: "E4: every receipt and monthly statement, newest first, each with a PDF (the business's team)",
    params: BusinessParams,
    response: z.array(Receipt)
  }),
  removeFundingSource: endpoint({
    method: "DELETE",
    path: "/businesses/:businessId/funding-sources/:sourceId",
    auth: "user",
    summary: "E5: remove a funding source (owner only). The default can't be removed (409 `default_source`: make another the default first), nor one with a deposit on its way (409 `deposit_pending`).",
    params: z.object({ businessId: Id, sourceId: Id }),
    response: z.array(FundingSource)
  }),
  makeDefaultFundingSource: endpoint({
    method: "POST",
    path: "/businesses/:businessId/funding-sources/:sourceId/default",
    auth: "user",
    summary: "E5: make a funding source the default (owner only): auto top-up and closing the account use it",
    params: z.object({ businessId: Id, sourceId: Id }),
    response: z.array(FundingSource)
  }),

  pledgeCardSession: endpoint({
    method: "POST",
    path: "/me/pledges/:pledgeId/card-session",
    auth: "user",
    summary:
      "E1: a page to change the card on a monthly pledge (Stripe's), which comes back to `returnTo` (a path in the app; default the pledge's station). 422 `no_card_to_change` for a one-time or ended pledge.",
    params: z.object({ pledgeId: Id }),
    body: z.object({ returnTo: z.string().regex(/^\/[^/]/).optional() }).optional(),
    response: z.object({ url: z.string() })
  })
};

export type Undecided = z.infer<typeof Undecided>;
export type FundingSource = z.infer<typeof FundingSource>;
export type Balance = z.infer<typeof Balance>;
export type Movement = z.infer<typeof Movement>;
export type Statement = z.infer<typeof Statement>;
export type StationEarnings = z.infer<typeof StationEarnings>;
export type Pledge = z.infer<typeof Pledge>;
export type Receipt = z.infer<typeof Receipt>;
