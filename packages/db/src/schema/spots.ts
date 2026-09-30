import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
 
  primaryKey,
  real,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { at, createdAt, id, micros, millis } from "./columns.js";
import { spots } from "./namespaces.js";
import { breaks, contents, programs, stations } from "./broadcast.js";
import { agreements } from "./catalog.js";
import { markets } from "./network.js";
import { users } from "./accounts.js";
import { holds } from "./ledger.js";

export const advertisers = spots.table("advertisers", {
  id: id(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  about: text("about"),
  website: text("website"),
  logoUrl: text("logo_url"),
  customersWhere: text("customers_where", { enum: ["location", "service_area", "online"] }).notNull(),
  /** Warnings before spots pause, in days of current spend. */
  warnDays: jsonb("warn_days").$type<number[]>().notNull().default([3, 1]),
  autoTopUp: boolean("auto_top_up").notNull().default(false),
  autoTopUpMicros: micros("auto_top_up_micros"),
  autoTopUpBelowDays: smallint("auto_top_up_below_days").notNull().default(3),
  legalName: text("legal_name"),
  /** Only the last four digits are stored; the full EIN goes to the payments provider. */
  einLast4: text("ein_last4"),
  receiptsEmail: text("receipts_email"),
  /** The house maker is a studio station; this marks Clear sponsoring as itself. */
  isHouse: boolean("is_house").notNull().default(false),
  /** P25 (added 2026-09-29): the name in tight places ("Orange Street"). Null: the name. */
  shortName: text("short_name"),
  /** P12 (added 2026-09-29): the Redeem tool. Null: the default (on, except for online businesses). */
  redeemOn: boolean("redeem_on"),
  /** E4 (added 2026-09-29): signs the business's receipt and statement PDF links. Made on first use. */
  receiptsKey: text("receipts_key"),
  closedAt: at("closed_at"),
  createdAt: createdAt()
});

/** A private street address (used for distance) or a city and radius. Stations see the city. */
export const advertiserLocations = spots.table(
  "advertiser_locations",
  {
    id: id(),
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertisers.id),
    kind: text("kind", { enum: ["location", "service_area"] }).notNull(),
    label: text("label"),
    streetAddress: text("street_address"),
    city: text("city").notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    radiusMiles: real("radius_miles"),
    createdAt: createdAt()
  },
  (t) => [check("service_area_radius", sql`${t.kind} <> 'service_area' or ${t.radiusMiles} > 0`)]
);

/** For online businesses: the markets they chose. No distance. */
export const advertiserMarkets = spots.table(
  "advertiser_markets",
  {
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertisers.id),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id)
  },
  (t) => [primaryKey({ columns: [t.advertiserId, t.marketId] })]
);

export const spotStatus = spots.enum("spot_status", ["draft", "in_review", "listed", "paused", "ended"]);

export const spotsTable = spots.table(
  "spots",
  {
    id: id(),
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertisers.id),
    title: text("title").notNull(),
    lengthSec: smallint("length_sec").notNull(),
    category: text("category").notNull(),
    status: spotStatus("status").notNull().default("draft"),
    /** Why it's paused: the daily cap resumes by itself at midnight; the others need the business. */
    /** `by_hand` (added 2026-09-29, A115): the business paused it; it waits for the business. */
    pauseReason: text("pause_reason", { enum: ["daily_cap", "budget_spent", "balance", "by_hand"] }),
    pausedAt: at("paused_at"),
    /** P6 (added 2026-09-29): the last pause and the resume after it, kept once it's back (the pause story). */
    lastPauseReason: text("last_pause_reason", { enum: ["daily_cap", "budget_spent", "balance", "by_hand"] }),
    lastPausedAt: at("last_paused_at"),
    resumedAt: at("resumed_at"),
    resumeReason: text("resume_reason", { enum: ["raised_budget", "added_money", "by_hand", "midnight"] }),
    rateKind: text("rate_kind", { enum: ["per_thousand", "per_airing"] }).notNull(),
    rateMicros: micros("rate_micros").notNull(),
    /** Per-thousand spots: the most one airing can cost, which caps its hold. */
    perAiringMaxMicros: micros("per_airing_max_micros"),
    totalBudgetMicros: micros("total_budget_micros").notNull(),
    dailyCapMicros: micros("daily_cap_micros"),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    listedAt: at("listed_at"),
    endedAt: at("ended_at"),
    /** Set when a production order became this spot. */
    productionOrderId: uuid("production_order_id").references((): AnyPgColumn => productionOrders.id),
    createdAt: createdAt()
  },
  (t) => [
    check("spot_length", sql`${t.lengthSec} in (15, 30, 60)`),
    check("rate_positive", sql`${t.rateMicros} > 0`),
    check("budget_positive", sql`${t.totalBudgetMicros} > 0`),
    check("daily_cap_positive", sql`${t.dailyCapMicros} is null or ${t.dailyCapMicros} > 0`),
    check("paused_has_reason", sql`(${t.status} = 'paused') = (${t.pauseReason} is not null)`),
    index("spots_advertiser").on(t.advertiserId)
  ]
);

/** The uploaded spot file and what the checks found. */
export const spotFiles = spots.table("spot_files", {
  id: id(),
  spotId: uuid("spot_id")
    .notNull()
    .references(() => spotsTable.id),
  version: integer("version").notNull(),
  originalFilename: text("original_filename"),
  /** The spot's file, by content ID: the original upload (since 2026-09-29), which playout prepares for air. */
  contentId: text("content_id").references(() => contents.cid),
  /** Before content IDs: a disk path or URL. */
  location: text("location"),
  durationMs: millis("duration_ms").notNull(),
  widthPx: integer("width_px"),
  heightPx: integer("height_px"),
  loudnessLufs: real("loudness_lufs"),
  captions: jsonb("captions"),
  scaledToFit: boolean("scaled_to_fit").notNull().default(false),
  current: boolean("current").notNull().default(true),
  createdAt: createdAt()
}, (t) => [check("spot_file_has_content", sql`${t.contentId} is not null or ${t.location} is not null`)]);

export const uploadChecks = spots.table("upload_checks", {
  id: id(),
  spotFileId: uuid("spot_file_id")
    .notNull()
    .references(() => spotFiles.id),
  check: text("check", { enum: ["length", "picture", "safe_area", "captions", "loudness", "code"] }).notNull(),
  result: text("result", { enum: ["fine", "fixed", "for_you"] }).notNull(),
  /** e.g. where on the frame text falls outside title safe. */
  detail: jsonb("detail"),
  createdAt: createdAt()
});

/** Targeting decides which stations see a spot in their market. It never places a spot. */
export const targeting = spots.table("targeting", {
  spotId: uuid("spot_id")
    .primaryKey()
    .references(() => spotsTable.id),
  withinMiles: real("within_miles"),
  locationIds: jsonb("location_ids").$type<string[]>().notNull().default([]),
  stationCategories: jsonb("station_categories").$type<string[]>().notNull().default([]),
  dayparts: jsonb("dayparts").$type<string[]>().notNull().default([]),
  excludedStationIds: jsonb("excluded_station_ids").$type<string[]>().notNull().default([]),
  /** P8 (added 2026-09-29): the bands it can air on ("tv", "radio"). Null: both. */
  bands: jsonb("bands").$type<Array<"tv" | "radio">>()
});

/** One code per spot, with its QR, rendered for the last :10. */
export const codes = spots.table("codes", {
  id: id(),
  spotId: uuid("spot_id")
    .notNull()
    .unique()
    .references(() => spotsTable.id),
  code: text("code").notNull(),
  offer: text("offer").notNull(),
  /** A use counts as a customer only within this many days after an airing. */
  windowDays: smallint("window_days").notNull().default(7),
  /** P4 (added 2026-09-29): who chose the code's letters. Opencast picks them unless the business typed its own. */
  pickedBy: text("picked_by", { enum: ["opencast", "business"] }).notNull().default("business"),
  createdAt: createdAt()
});

export const codeEvents = spots.table(
  "code_events",
  {
    id: id(),
    codeId: uuid("code_id")
      .notNull()
      .references(() => codes.id),
    kind: text("kind", { enum: ["scan", "save", "use"] }).notNull(),
    source: text("source", { enum: ["qr", "clear_pay", "shopify", "stripe", "square", "marked_used"] }).notNull(),
    /** The airing it's attributed to, if any, and that airing's station. */
    airingId: uuid("airing_id").references(() => airings.id),
    stationId: uuid("station_id").references(() => stations.id),
    customerRef: text("customer_ref"),
    countsAsCustomer: boolean("counts_as_customer").notNull().default(false),
    markedBy: uuid("marked_by").references(() => users.id),
    occurredAt: at("occurred_at").notNull().defaultNow()
  },
  (t) => [index("code_events_code").on(t.codeId, t.occurredAt)]
);

/** A station's rotation, and its backup rotation for when spots pause. */
export const rotations = spots.table(
  "rotations",
  {
    id: id(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    kind: text("kind", { enum: ["main", "backup"] }).notNull()
  },
  (t) => [uniqueIndex("rotations_station_kind").on(t.stationId, t.kind)]
);

/** A paused spot that resumes is never re-added by itself: the station adds it back. */
export const rotationSpots = spots.table("rotation_spots", {
  id: id(),
  rotationId: uuid("rotation_id")
    .notNull()
    .references(() => rotations.id),
  spotId: uuid("spot_id")
    .notNull()
    .references(() => spotsTable.id),
  position: integer("position").notNull(),
  addedAt: at("added_at").notNull().defaultNow(),
  removedAt: at("removed_at")
});

/**
 * A spot placed in a break. Money for it must already be held: `hold_id` is
 * required, and a trigger checks the hold belongs to the spot's advertiser.
 * A held airing always airs, even if the spot is paused afterwards.
 */
export const airings = spots.table(
  "airings",
  {
    id: id(),
    spotId: uuid("spot_id")
      .notNull()
      .references(() => spotsTable.id),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    breakId: uuid("break_id")
      .notNull()
      .references(() => breaks.id),
    holdId: uuid("hold_id")
      .notNull()
      .unique()
      .references(() => holds.id),
    scheduledAt: at("scheduled_at").notNull(),
    /** Set when it filled a producer's barter share inside a carried program: the producer is paid. */
    carriageAgreementId: uuid("carriage_agreement_id").references(() => agreements.id),
    /** The rate as it was at placement. */
    rateKind: text("rate_kind", { enum: ["per_thousand", "per_airing"] }).notNull(),
    rateMicros: micros("rate_micros").notNull(),
    createdAt: createdAt()
  },
  (t) => [index("airings_station_time").on(t.stationId, t.scheduledAt)]
);

/** Minimum a month, and the most sponsors, for the whole station or one program. */
export const sponsorshipSettings = spots.table(
  "sponsorship_settings",
  {
    id: id(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    programId: uuid("program_id").references(() => programs.id),
    minMonthlyMicros: micros("min_monthly_micros").notNull(),
    maxSponsors: smallint("max_sponsors").notNull(),
    /** "None": the program can't be sponsored. */
    closed: boolean("closed").notNull().default(false)
  },
  (t) => [unique("sponsorship_settings_scope").on(t.stationId, t.programId).nullsNotDistinct()]
);

export const sponsorships = spots.table(
  "sponsorships",
  {
    id: id(),
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertisers.id),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    /** Null for the whole station. A carried program is sponsored through its maker. */
    programId: uuid("program_id").references(() => programs.id),
    monthlyMicros: micros("monthly_micros").notNull(),
    /** Who they are, where, and what they do. Checked as typed; can't be sent until it passes. */
    creditText: text("credit_text").notNull(),
    creditCheckedAt: at("credit_checked_at").notNull(),
    status: text("status", { enum: ["requested", "approved", "declined", "lapsed", "ended"] })
      .notNull()
      .default("requested"),
    declineReason: text("decline_reason", { enum: ["not_right_fit", "full", "amount"] }),
    startsOn: date("starts_on").notNull(),
    decidedAt: at("decided_at"),
    decidedBy: uuid("decided_by").references(() => users.id),
    /**
     * A catalog sponsorship (added 2026-09-29, migration 0030): the market its credit is sold in.
     * The station is the catalog station, the program the series' (null: every catalog series in
     * the market). Null for a station's own sponsorships.
     */
    marketId: uuid("market_id").references(() => markets.id),
    /** A catalog sponsorship: who on the desk offered or assigned it. */
    offeredBy: uuid("offered_by").references(() => users.id),
    createdAt: createdAt()
  },
  (t) => [
    check("sponsorship_amount_positive", sql`${t.monthlyMicros} > 0`),
    // One live sponsorship or offer per catalog slot (series × market).
    uniqueIndex("sponsorships_catalog_slot")
      .on(t.marketId, sql`coalesce(${t.programId}, '00000000-0000-0000-0000-000000000000'::uuid)`)
      .where(sql`${t.marketId} is not null and ${t.status} in ('requested', 'approved')`)
  ]
);

/** Each month's amount, held from the sponsor's balance at the start of the month. */
export const sponsorshipMonths = spots.table(
  "sponsorship_months",
  {
    sponsorshipId: uuid("sponsorship_id")
      .notNull()
      .references(() => sponsorships.id),
    month: date("month").notNull(),
    holdId: uuid("hold_id")
      .notNull()
      .unique()
      .references(() => holds.id)
  },
  (t) => [primaryKey({ columns: [t.sponsorshipId, t.month] })]
);

/**
 * Clear-filled catalog slots (added 2026-09-29, migration 0030): each month, each catalog series in
 * each market where the credit thanked the house sponsor because nobody had bought the slot, with
 * the credits that aired. Recorded on the 1st for the month before. Nothing is billed (Open:
 * whether Clear pays for these); `billed_micros` stays 0 until that's decided.
 */
export const catalogHouseCredits = spots.table(
  "catalog_house_credits",
  {
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    month: date("month").notNull(),
    credits: integer("credits").notNull(),
    billedMicros: micros("billed_micros").notNull().default(0),
    recordedAt: at("recorded_at").notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.programId, t.marketId, t.month] }), check("catalog_house_credits_counted", sql`${t.credits} > 0`)]
);

export const orderStatus = spots.enum("order_status", [
  "asked",
  "quoted",
  "passed",
  "accepted",
  "delivered",
  "changes_requested",
  "approved",
  "disputed",
  "cancelled"
]);

/** A business asks a station that takes orders, or Opencast Studio, to make a spot. */
export const productionOrders = spots.table("production_orders", {
  id: id(),
  advertiserId: uuid("advertiser_id")
    .notNull()
    .references(() => advertisers.id),
  makerStationId: uuid("maker_station_id")
    .notNull()
    .references(() => stations.id),
  title: text("title").notNull(),
  lengthSec: smallint("length_sec").notNull(),
  about: text("about").notNull(),
  mustSay: text("must_say"),
  neededBy: date("needed_by").notNull(),
  status: orderStatus("status").notNull().default("asked"),
  quoteMicros: micros("quote_micros"),
  deliverBy: date("deliver_by"),
  roundsIncluded: smallint("rounds_included"),
  voicedBy: text("voiced_by"),
  holdId: uuid("hold_id")
    .unique()
    .references((): AnyPgColumn => holds.id),
  deliveredAt: at("delivered_at"),
  /** No answer for 7 days after delivery approves it. */
  autoApproveAt: at("auto_approve_at"),
  approvedAt: at("approved_at"),
  spotId: uuid("spot_id").references(() => spotsTable.id),
  tellMakerWhenListed: boolean("tell_maker_when_listed").notNull().default(false),
  /** P24 (added 2026-09-29): the maker asked to be told when the spot is listed. */
  makerAskedListedAt: at("maker_asked_listed_at"),
  /** P19 (added 2026-09-29): when the maker last quoted. */
  quotedAt: at("quoted_at"),
  createdAt: createdAt()
});

export const orderFiles = spots.table("order_files", {
  id: id(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => productionOrders.id),
  role: text("role", { enum: ["brief", "delivery"] }).notNull(),
  version: integer("version"),
  contentId: text("content_id").references(() => contents.cid),
  /** Before content IDs: a disk path or URL. */
  location: text("location"),
  filename: text("filename"),
  /** P19 (added 2026-09-29): a delivery's length and the spot checks it passed ("length", "picture", "loudness"). */
  durationMs: millis("duration_ms"),
  checksPassed: jsonb("checks_passed").$type<string[]>(),
  createdAt: createdAt()
}, (t) => [check("order_file_has_content", sql`${t.contentId} is not null or ${t.location} is not null`)]);

/** Notes pinned to timecodes. The maker's own mistakes don't use up a round. */
export const orderNotes = spots.table("order_notes", {
  id: id(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => productionOrders.id),
  deliveryFileId: uuid("delivery_file_id").references(() => orderFiles.id),
  timecodeMs: millis("timecode_ms"),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id),
  body: text("body").notNull(),
  makersMistake: boolean("makers_mistake").notNull().default(false),
  round: smallint("round").notNull(),
  createdAt: createdAt()
});

/**
 * P20 (added 2026-09-29): what a business is connected to for counting code uses: Clear Pay (in
 * person) and one online checkout (Shopify, Stripe or Square promotion codes, counted by webhook).
 * `secret` is the webhook signing secret the provider gave the business; `hookToken` names the
 * connection in its webhook address. A disconnected row is kept (its uses stay counted).
 */
export const connections = spots.table(
  "connections",
  {
    id: id(),
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertisers.id),
    kind: text("kind", { enum: ["clear_pay", "checkout"] }).notNull(),
    provider: text("provider", { enum: ["clear", "shopify", "stripe", "square"] }).notNull(),
    secret: text("secret").notNull(),
    hookToken: text("hook_token").notNull().unique(),
    connectedBy: uuid("connected_by").references(() => users.id),
    connectedAt: at("connected_at").notNull().defaultNow(),
    disconnectedAt: at("disconnected_at"),
    /** The last webhook that counted something. */
    lastEventAt: at("last_event_at")
  },
  (t) => [index("connections_advertiser").on(t.advertiserId, t.kind)]
);

/** P20: provider events already counted, so a retried webhook counts once. */
export const connectionEvents = spots.table(
  "connection_events",
  {
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id),
    eventRef: text("event_ref").notNull(),
    receivedAt: at("received_at").notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.eventRef] })]
);
