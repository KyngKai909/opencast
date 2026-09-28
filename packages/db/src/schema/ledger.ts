import { sql } from "drizzle-orm";
import { type AnyPgColumn, bigint, boolean, check, date, index, integer, jsonb, smallint, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, createdAt, id, micros } from "./columns.js";
import { ledger } from "./namespaces.js";
import { stations } from "./broadcast.js";
import { users } from "./accounts.js";
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
  "external"
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
    check(
      "account_owner_fits_kind",
      sql`case ${t.kind}
        when 'advertiser_available' then ${t.advertiserId} is not null and ${t.stationId} is null
        when 'station_earnings' then ${t.stationId} is not null and ${t.advertiserId} is null
        when 'escrow_owed' then ${t.stationId} is not null and ${t.advertiserId} is null
        when 'escrow' then ${t.stationId} is not null and ${t.advertiserId} is null
        when 'creator' then ${t.stationId} is not null and ${t.userId} is not null
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
  "reversal"
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
  removedAt: at("removed_at"),
  createdAt: createdAt()
});

/** A deposit on its way ("Arrives Tuesday", with Undo). Money lands through a `deposit` entry. */
export const deposits = ledger.table("deposits", {
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
  entryId: uuid("entry_id").references(() => entries.id),
  createdAt: createdAt()
});

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
  endsAfter: date("ends_after")
});

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
