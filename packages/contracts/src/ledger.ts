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
  fundingSources: z.array(FundingSource)
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
  lines: z.array(z.object({ label: z.string(), detail: z.string().nullable(), amountMicros: Micros, notSetYet: z.boolean().default(false) })),
  issuedAt: Timestamp,
  csvUrl: z.string(),
  pdfUrl: z.string().nullable()
});

export const StationEarnings = z.object({
  period: z.enum(["week", "month", "year"]),
  lines: z.object({
    spots: z.object({ micros: Micros, airings: z.number().int(), businesses: z.number().int() }),
    sponsors: z.object({ micros: Micros, sponsors: z.number().int() }),
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
  held: z.object({ tonightMicros: Micros, tonightAirings: z.number().int(), restOfWeekMicros: Micros, restOfWeekAirings: z.number().int() }),
  account: z.object({ availableMicros: Micros, paidOutThisMonthMicros: Micros }),
  nextPayout: z.object({ on: DateOnly, schedule: z.enum(["weekly", "monthly"]), destination: z.string().nullable() }).nullable()
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
  receipts: z.object({ count: z.number().int(), totalMicros: Micros })
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
    response: z.object({ amountMicros: Micros, feeMicros: Micros, arrives: z.string(), roughAirings: z.number().int().nullable() })
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
  listMyPledges: endpoint({ method: "GET", path: "/me/pledges", auth: "user", summary: "My pledges", response: z.array(Pledge) }),
  updatePledge: endpoint({
    method: "PATCH",
    path: "/me/pledges/:pledgeId",
    auth: "user",
    summary: "Change the amount or on-air credit, or stop (it ends after the current month)",
    params: z.object({ pledgeId: Id }),
    body: z.object({ amountMicros: Micros.min(1_000_000), creditOnAir: z.boolean(), stop: z.literal(true) }).partial(),
    response: Pledge
  })
};

export type Undecided = z.infer<typeof Undecided>;
export type FundingSource = z.infer<typeof FundingSource>;
export type Balance = z.infer<typeof Balance>;
export type Movement = z.infer<typeof Movement>;
export type Statement = z.infer<typeof Statement>;
export type StationEarnings = z.infer<typeof StationEarnings>;
export type Pledge = z.infer<typeof Pledge>;
