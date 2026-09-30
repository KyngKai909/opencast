import { sql } from "drizzle-orm";
import { type AnyPgColumn, bigint, boolean, check, date, doublePrecision, index, integer, jsonb, primaryKey, smallint, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, createdAt, id, micros } from "./columns.js";
import { ledger } from "./namespaces.js";
import { stations } from "./broadcast.js";
import { clearLinks, users } from "./accounts.js";
import { advertisers, spotsTable, sponsorships, productionOrders } from "./spots.js";

export const accountKind = ledger.enum("account_kind", [
  /** An advertiser's funded balance they can spend or withdraw. */
  "advertiser_available",
  /** All money held against scheduled airings, sponsorship months and orders. */
  "holds",
  /** A station's earnings, settled into its Clear account (or Stripe Connect). */
  "station_earnings",
  /** A claimable station's settled earnings, owed until the weekly escrow deposit confirms. */
  "escrow_owed",
  /** A claimable station's balance in the escrow contract. Only the creator or the fund can receive it. */
  "escrow",
  /** The verified creator of a claimed station. */
  "creator",
  /** Unclaimed escrow after the unclaimed period. */
  "creator_fund",
  "opencast_share",
  "pool",
  /** What Opencast pays when a per-thousand airing costs more than the advertiser has. */
  "opencast_absorbed",
  "card_fees",
  /** Money outside the system: banks, cards, payouts. Its balance is the negative of what's inside. */
  "external",
  // Pay-as-you-go (added 2026-09-29, migration 0033, follow-up Phase 2).
  /** A station's usage, owed to Opencast: negative while it owes. Not money anywhere; a claim. */
  "usage_owed",
  /** Opencast's side of usage accrued and not yet paid (the other side of `usage_owed`). */
  "usage_billed",
  /** Usage paid to Opencast: from a station's earnings, its linked Clear wallet or its card. In the treasury. */
  "opencast_usage"
]);

export const accountsTable = ledger.table(
  "accounts",
  {
    id: id(),
    kind: accountKind("kind").notNull(),
    advertiserId: uuid("advertiser_id").references(() => advertisers.id),
    stationId: uuid("station_id").references(() => stations.id),
    userId: uuid("user_id").references(() => users.id),
    /** For `external`: bank, card, clear, stripe. */
    label: text("label"),
    createdAt: createdAt()
  },
  (t) => [
    // Compared as text (migration 0033): the kinds added in the same migration can't be cast to the enum before it commits.
    check(
      "account_owner_fits_kind",
      sql`case ${t.kind}::text
        when 'advertiser_available' then ${t.advertiserId} is not null and ${t.stationId} is null
        when 'station_earnings' then ${t.stationId} is not null and ${t.advertiserId} is null
        when 'escrow_owed' then ${t.stationId} is not null and ${t.advertiserId} is null
        when 'escrow' then ${t.stationId} is not null and ${t.advertiserId} is null
        when 'creator' then ${t.stationId} is not null and ${t.userId} is not null
        when 'usage_owed' then ${t.stationId} is not null and ${t.advertiserId} is null
        else ${t.advertiserId} is null and ${t.stationId} is null
      end`
    ),
    unique("accounts_owner").on(t.kind, t.advertiserId, t.stationId, t.userId, t.label).nullsNotDistinct()
  ]
);

/**
 * Money held for something not yet paid out: one airing, one sponsorship month,
 * or one production order. Its open amount is the sum of its postings on the
 * `holds` account, so a hold never needs updating.
 */
export const holds = ledger.table(
  "holds",
  {
    id: id(),
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertisers.id),
    purpose: text("purpose", { enum: ["airing", "sponsorship_month", "production_order"] }).notNull(),
    spotId: uuid("spot_id").references(() => spotsTable.id),
    stationId: uuid("station_id").references(() => stations.id),
    sponsorshipId: uuid("sponsorship_id").references(() => sponsorships.id),
    productionOrderId: uuid("production_order_id").references((): AnyPgColumn => productionOrders.id),
    amountMicros: micros("amount_micros").notNull(),
    /** For per-thousand airings the hold is an estimate; the as-run settles the real cost. */
    isEstimate: boolean("is_estimate").notNull().default(false),
    createdAt: createdAt()
  },
  (t) => [
    check("hold_amount_positive", sql`${t.amountMicros} > 0`),
    check(
      "hold_purpose_fits",
      sql`case ${t.purpose}
        when 'airing' then ${t.spotId} is not null and ${t.stationId} is not null
        when 'sponsorship_month' then ${t.sponsorshipId} is not null
        when 'production_order' then ${t.productionOrderId} is not null
      end`
    )
  ]
);

export const entryKind = ledger.enum("entry_kind", [
  "deposit",
  "card_fee",
  "withdrawal",
  "hold",
  "settle",
  "release",
  "absorb_gap",
  "carriage_fee",
  "barter_split",
  "opencast_share",
  "pool",
  "pledge",
  "payout",
  "escrow_deposit",
  "escrow_claim",
  "escrow_stop",
  "escrow_unclaimed",
  "reversal",
  /** Pay-as-you-go (migration 0033): a station's usage for a day, accrued (and the month's rounding to the cent). */
  "usage",
  /** Pay-as-you-go: usage paid, from the station's earnings, its linked Clear wallet or its card. */
  "usage_payment"
]);

/** One balanced movement of money. Never updated or deleted; a reversal is a new entry. */
export const entries = ledger.table(
  "entries",
  {
    id: id(),
    kind: entryKind("kind").notNull(),
    occurredAt: at("occurred_at").notNull().defaultNow(),
    reversesEntryId: uuid("reverses_entry_id").unique(),
    /** What caused it: an as-run row, an airing, a payout, a deposit… */
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    idempotencyKey: text("idempotency_key").unique(),
    memo: text("memo"),
    createdAt: createdAt()
  },
  (t) => [check("reversal_references_entry", sql`(${t.kind} = 'reversal') = (${t.reversesEntryId} is not null)`)]
);

export const postings = ledger.table(
  "postings",
  {
    id: id(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id),
    /** Positive is a debit to the account (money into it), negative a credit. Each entry sums to zero. */
    amountMicros: micros("amount_micros").notNull(),
    holdId: uuid("hold_id").references(() => holds.id),
    createdAt: createdAt()
  },
  (t) => [
    check("posting_nonzero", sql`${t.amountMicros} <> 0`),
    index("postings_account").on(t.accountId),
    index("postings_hold").on(t.holdId)
  ]
);

/** Where an advertiser's money comes from. */
export const fundingSources = ledger.table("funding_sources", {
  id: id(),
  advertiserId: uuid("advertiser_id")
    .notNull()
    .references(() => advertisers.id),
  kind: text("kind", { enum: ["clear_bank", "card", "clear_account"] }).notNull(),
  /** "Chase ending 8810". */
  label: text("label").notNull(),
  providerRef: text("provider_ref"),
  isDefault: boolean("is_default").notNull().default(false),
  /** A business owner's linked Clear wallet (Privy global wallet): withdrawals can go to it while it stays linked. */
  clearLinkId: uuid("clear_link_id").references(() => clearLinks.id),
  removedAt: at("removed_at"),
  createdAt: createdAt()
});

/** A deposit on its way ("Arrives Tuesday", with Undo). Money lands through a `deposit` entry. */
export const deposits = ledger.table(
  "deposits",
  {
    id: id(),
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertisers.id),
    fundingSourceId: uuid("funding_source_id").references(() => fundingSources.id),
    amountMicros: micros("amount_micros").notNull(),
    feeMicros: micros("fee_micros").notNull().default(0),
    providerRef: text("provider_ref"),
    expectedAt: at("expected_at"),
    status: text("status", { enum: ["pending", "arrived", "cancelled", "failed"] }).notNull().default("pending"),
    /** A transfer from a linked Clear wallet: its transaction (lower-case), used once, and the wallet it came from. */
    txHash: text("tx_hash"),
    fromAddress: text("from_address"),
    entryId: uuid("entry_id").references(() => entries.id),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex("deposits_tx_hash").on(t.txHash).where(sql`${t.txHash} is not null`)]
);

/** A payout to a station, producer or advertiser. Money leaves through a `payout` or `withdrawal` entry. */
export const payouts = ledger.table("payouts", {
  id: id(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accountsTable.id),
  amountMicros: micros("amount_micros").notNull(),
  destination: text("destination").notNull(),
  scheduledFor: date("scheduled_for").notNull(),
  status: text("status", { enum: ["scheduled", "sent", "confirmed", "failed"] }).notNull().default("scheduled"),
  providerRef: text("provider_ref"),
  entryId: uuid("entry_id").references(() => entries.id),
  createdAt: createdAt()
});

export const statements = ledger.table(
  "statements",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id),
    period: text("period", { enum: ["week", "month"] }).notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    lines: jsonb("lines").notNull(),
    openingMicros: micros("opening_micros").notNull(),
    closingMicros: micros("closing_micros").notNull(),
    issuedAt: at("issued_at").notNull().defaultNow()
  },
  (t) => [uniqueIndex("statements_period").on(t.accountId, t.period, t.periodStart)]
);

/** A viewer's pledge to a station, paid by card through Stripe. */
export const pledges = ledger.table("pledges", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  stationId: uuid("station_id")
    .notNull()
    .references(() => stations.id),
  cadence: text("cadence", { enum: ["monthly", "once"] }).notNull(),
  amountMicros: micros("amount_micros").notNull(),
  creditOnAir: boolean("credit_on_air").notNull().default(false),
  stripeRef: text("stripe_ref"),
  startedAt: at("started_at").notNull().defaultNow(),
  endsAfter: date("ends_after"),
  /** The card it's charged to, as the provider names it ("Visa ending 4242"), once known (E1). */
  cardLabel: text("card_label"),
  /** The last day the card works (the end of its expiry month). */
  cardExpiresOn: date("card_expires_on")
});

/**
 * Where a station is paid, when it isn't its own Clear account (or Stripe Connect): the owner's
 * linked Clear wallet. Payouts wait if that wallet is unlinked or its owner no longer owns the station.
 */
export const payoutDestinations = ledger.table(
  "payout_destinations",
  {
    stationId: uuid("station_id")
      .primaryKey()
      .references(() => stations.id),
    kind: text("kind", { enum: ["clear_account", "clear_wallet"] }).notNull().default("clear_account"),
    clearLinkId: uuid("clear_link_id").references(() => clearLinks.id),
    setBy: uuid("set_by")
      .notNull()
      .references(() => users.id),
    updatedAt: at("updated_at").notNull().defaultNow()
  },
  (t) => [check("clear_wallet_has_link", sql`${t.kind} <> 'clear_wallet' or ${t.clearLinkId} is not null`)]
);

/** A weekly deposit batch into the escrow contract. */
export const escrowDeposits = ledger.table("escrow_deposits", {
  id: id(),
  chainId: integer("chain_id").notNull(),
  contractAddress: text("contract_address").notNull(),
  /** What was sent, per station: written before the transaction, so a crash never sends it twice. */
  items: jsonb("items").notNull().default([]),
  status: text("status", { enum: ["sending", "sent", "confirmed", "failed"] }).notNull().default("sending"),
  error: text("error"),
  txHash: text("tx_hash"),
  confirmedAt: at("confirmed_at"),
  entryId: uuid("entry_id").references(() => entries.id),
  createdAt: createdAt()
});

/**
 * Shares and schedules that aren't decided yet. Every rate defaults to zero and
 * reads "Not set yet" in the apps. A new row takes effect from its date; old rows
 * are kept so past periods are computed with the rates that applied.
 */
export const revenueConfig = ledger.table("revenue_config", {
  effectiveFrom: date("effective_from").primaryKey(),
  /** Opencast's share of spot revenue, taken from what the station receives. Basis points. */
  opencastSpotShareBps: integer("opencast_spot_share_bps").notNull().default(0),
  opencastPledgeShareBps: integer("opencast_pledge_share_bps").notNull().default(0),
  opencastProductionShareBps: integer("opencast_production_share_bps").notNull().default(0),
  poolShareBps: integer("pool_share_bps").notNull().default(0),
  poolBaseBps: integer("pool_base_bps").notNull().default(0),
  poolWatchTimeBps: integer("pool_watch_time_bps").notNull().default(0),
  poolFundBps: integer("pool_fund_bps").notNull().default(0),
  payoutSchedule: text("payout_schedule", { enum: ["weekly", "monthly"] }).notNull().default("weekly"),
  unclaimedPeriodDays: integer("unclaimed_period_days").notNull().default(1095),
  offerWindowDays: smallint("offer_window_days").notNull().default(7),
  createdAt: createdAt()
});

/**
 * Accounts at a payments provider: an advertiser's or station's Clear business account, a
 * Stripe customer, a station's Stripe Connect Express account, Opencast's own.
 */
export const providerAccounts = ledger.table(
  "provider_accounts",
  {
    id: id(),
    ownerType: text("owner_type", { enum: ["advertiser", "station", "opencast"] }).notNull(),
    /** The advertiser or station; null for Opencast's own accounts. */
    ownerId: uuid("owner_id"),
    /** "settlement" or "treasury" for Opencast's own; null otherwise. */
    ownerLabel: text("owner_label"),
    provider: text("provider", { enum: ["clear", "stripe_customer", "stripe_connect", "fake"] }).notNull(),
    ref: text("ref").notNull(),
    status: text("status", { enum: ["active", "needs_onboarding", "closed"] }).notNull().default("active"),
    onboardingUrl: text("onboarding_url"),
    createdAt: createdAt()
  },
  (t) => [unique("provider_accounts_owner").on(t.ownerType, t.ownerId, t.ownerLabel, t.provider).nullsNotDistinct()]
);

/**
 * What the providers have to do for each ledger entry, written in the same transaction as the
 * entry and sent afterwards by a job (the outbox): so no provider call ever happens inside a
 * database transaction, a failed call is retried, and nothing moves twice (each move has its own
 * idempotency key). A wallet is where money physically sits: "advertiser:<id>", "station:<id>",
 * "opencast:settlement", "opencast:treasury".
 */
export const providerMoves = ledger.table(
  "provider_moves",
  {
    id: id(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id),
    seq: smallint("seq").notNull(),
    kind: text("kind", { enum: ["encumber", "release", "transfer"] }).notNull(),
    fromWallet: text("from_wallet").notNull(),
    toWallet: text("to_wallet"),
    holdId: uuid("hold_id").references(() => holds.id),
    amountMicros: micros("amount_micros").notNull(),
    status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    providerRef: text("provider_ref"),
    lastError: text("last_error"),
    sentAt: at("sent_at"),
    createdAt: createdAt()
  },
  (t) => [
    uniqueIndex("provider_moves_entry_seq").on(t.entryId, t.seq),
    index("provider_moves_pending").on(t.status, t.createdAt),
    check("move_amount_positive", sql`${t.amountMicros} > 0`),
    check("transfer_has_destination", sql`(${t.kind} = 'transfer') = (${t.toWallet} is not null)`)
  ]
);

/** How far the chain has been read (escrow events), so each event is applied once. */
export const chainCursor = ledger.table("chain_cursor", {
  name: text("name").primaryKey(),
  block: bigint("block", { mode: "bigint" }).notNull(),
  updatedAt: at("updated_at").notNull().defaultNow()
});


// ---- Pay-as-you-go for stations (added 2026-09-29, migration 0033, follow-up Phase 2) ----------
// Owned by the ledger module (modules/ledger/billing.ts). Being on air is free; a station pays for
// storage, relays of everything it airs, and live hours through Livepeer. Usage is measured each
// day, accrued as `usage` entries, and paid at month end: from earnings first, then the station's
// linked Clear wallet (full access) or its card. See docs/pricing.md.

/**
 * What a station used on a day (UTC), by usage type: storage in GB (measured that day, originals
 * and prepared segments together), everything else in hours. Today's row is measured again every
 * hour; a day is closed the next day, when its charge (after the free allowance, at that day's
 * price, never past the station's cap) is worked out and accrued in one `usage` entry per station.
 */
export const usageDays = ledger.table(
  "usage_days",
  {
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    /** `storage`, `relay_everything`, `live_hours`, `radio_live`, `relay_live_only` (packages/contracts billing.ts). */
    usageType: text("usage_type").notNull(),
    day: date("day").notNull(),
    /** GB for storage; hours otherwise. */
    quantity: doublePrecision("quantity").notNull().default(0),
    /** Storage only: the bytes behind it (originals, prepared). */
    detail: jsonb("detail"),
    /** Set when the day is closed: what it adds to the month's charge for this type. */
    chargeMicros: micros("charge_micros"),
    closedAt: at("closed_at"),
    /** The `usage` entry the day's charges were accrued in (none when they came to nothing). */
    entryId: uuid("entry_id").references(() => entries.id),
    updatedAt: at("updated_at").notNull().defaultNow()
  },
  (t) => [
    primaryKey({ columns: [t.stationId, t.usageType, t.day] }),
    index("usage_days_day").on(t.day),
    check("usage_type_known", sql`${t.usageType} in ('storage', 'relay_everything', 'live_hours', 'radio_live', 'relay_live_only')`),
    check("usage_quantity_nonnegative", sql`${t.quantity} >= 0`),
    check("usage_charge_nonnegative", sql`${t.chargeMicros} is null or ${t.chargeMicros} >= 0`)
  ]
);

/**
 * A station's pay-as-you-go settings and standing: how it pays what earnings don't cover (its
 * owner's linked Clear wallet, or a card saved through Stripe), its monthly caps per usage type,
 * and whether it's in its grace period or paused for an unpaid bill. `capsReached` is what the
 * metering found this month (a cap reached pauses that usage until the month ends).
 */
export const stationBilling = ledger.table(
  "station_billing",
  {
    stationId: uuid("station_id")
      .primaryKey()
      .references(() => stations.id),
    funding: text("funding", { enum: ["clear", "card"] }),
    /** The owner's Clear link, when the station pays from Clear (full access needed at the time). */
    clearLinkId: uuid("clear_link_id").references(() => clearLinks.id),
    /** The card, as Stripe (or the fake) knows it: its PaymentMethod, "Visa ending 4242", the last day it works. */
    cardRef: text("card_ref"),
    cardLabel: text("card_label"),
    cardExpiresOn: date("card_expires_on"),
    /** Monthly caps in micros, by usage type ({ "relay_everything": 20000000 }); missing or null is no cap. */
    caps: jsonb("caps").$type<Record<string, number | null>>().notNull().default({}),
    /** The month (YYYY-MM) each type reached its cap in: paused until that month ends. */
    capsReached: jsonb("caps_reached").$type<Record<string, string>>().notNull().default({}),
    standing: text("standing", { enum: ["ok", "grace", "paused"] }).notNull().default("ok"),
    graceStartedAt: at("grace_started_at"),
    pausedAt: at("paused_at"),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: at("updated_at").notNull().defaultNow()
  },
  (t) => [
    check("station_billing_clear_has_link", sql`${t.funding} is distinct from 'clear' or ${t.clearLinkId} is not null`),
    check("station_billing_grace_started", sql`${t.standing} = 'ok' or ${t.graceStartedAt} is not null`)
  ]
);

/**
 * A station's bill for a month (UTC): opened with its first day of usage, closed after the month
 * ends. What was accrued, paid and still due are the ledger's (`usage` and `usage_payment` entries
 * with this bill as their source); the row keeps the month's lines for statements and the last
 * attempt to charge what earnings didn't cover.
 */
export const usageBills = ledger.table(
  "usage_bills",
  {
    id: id(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    /** The month's first day. */
    month: date("month").notNull(),
    status: text("status", { enum: ["open", "due", "paid"] }).notNull().default("open"),
    /** Per usage type once closed: quantity, free, billable, price (the month's last), charge. */
    lines: jsonb("lines"),
    closedAt: at("closed_at"),
    paidAt: at("paid_at"),
    attempts: smallint("attempts").notNull().default(0),
    lastAttemptAt: at("last_attempt_at"),
    lastMethod: text("last_method", { enum: ["card", "clear"] }),
    /** Why the last attempt didn't pay it ("Your card was declined."), or null. */
    lastFailure: text("last_failure"),
    lastProviderRef: text("last_provider_ref"),
    /** A transfer from the owner's Clear wallet waiting to be mined (lower-case), and what it sends. */
    clearTxHash: text("clear_tx_hash"),
    clearAmountMicros: micros("clear_amount_micros"),
    createdAt: createdAt()
  },
  (t) => [
    uniqueIndex("usage_bills_station_month").on(t.stationId, t.month),
    uniqueIndex("usage_bills_clear_tx").on(t.clearTxHash).where(sql`${t.clearTxHash} is not null`),
    check("usage_bill_month_start", sql`extract(day from ${t.month}) = 1`)
  ]
);
