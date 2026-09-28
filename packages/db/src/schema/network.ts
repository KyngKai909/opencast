import { sql } from "drizzle-orm";
import { boolean, check, date, integer, jsonb, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, createdAt, id, millis } from "./columns.js";
import { network, band } from "./namespaces.js";
import { stations } from "./broadcast.js";
import { users } from "./accounts.js";

// Markets live here because the dial is Opencast's to run. The prompt also lists
// markets under `accounts`; a viewer's chosen market is `accounts.users.market_id`.
export const markets = network.table("markets", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  // "Nearby: Inland Empire, 40 miles" is measured between market centres.
  latitude: text("latitude"),
  longitude: text("longitude"),
  openedAt: at("opened_at"),
  createdAt: createdAt()
});

/** "Your ZIP decides your market." Location itself is never stored. */
export const zipMarkets = network.table("zip_markets", {
  zip: text("zip").primaryKey(),
  marketId: uuid("market_id").notNull().references(() => markets.id)
});

export const waitlistRole = network.enum("waitlist_role", ["viewer", "station", "producer", "business"]);

export const waitlistSignups = network.table("waitlist_signups", {
  id: id(),
  role: waitlistRole("role").notNull(),
  email: text("email").notNull(),
  zip: text("zip").notNull(),
  marketId: uuid("market_id").references(() => markets.id),
  requestedCallSign: text("requested_call_sign"),
  notifiedAt: at("notified_at"),
  createdAt: createdAt()
});

/**
 * A call sign held for someone on the waitlist ("BEAT is on hold for you"),
 * and for a year after a station signs off for good. While active, no other
 * station can take it (enforced by trigger on broadcast.stations).
 */
export const callSignReservations = network.table(
  "call_sign_reservations",
  {
    id: id(),
    callSign: text("call_sign").notNull(),
    signupId: uuid("signup_id").references(() => waitlistSignups.id),
    marketId: uuid("market_id").references(() => markets.id),
    /** The station that may use it: set when the holder creates their station. */
    stationId: uuid("station_id").references(() => stations.id),
    reason: text("reason", { enum: ["waitlist", "signed_off", "admin"] }).notNull(),
    heldUntil: at("held_until"),
    releasedAt: at("released_at"),
    createdAt: createdAt()
  },
  (t) => [
    check("call_sign_format", sql`${t.callSign} ~ '^[A-Z]{3,5}$'`),
    uniqueIndex("call_sign_reservations_active").on(t.callSign).where(sql`${t.releasedAt} is null`)
  ]
);

/**
 * A channel held for a reservation ("Held for the waitlist" on the market board).
 * A held number can only go to the reservation's station (trigger on broadcast.channels).
 */
export const channelHolds = network.table(
  "channel_holds",
  {
    id: id(),
    marketId: uuid("market_id").notNull().references(() => markets.id),
    band: band("band").notNull(),
    tenths: integer("tenths").notNull(),
    reservationId: uuid("reservation_id").notNull().references(() => callSignReservations.id),
    releasedAt: at("released_at"),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex("channel_holds_active").on(t.marketId, t.band, t.tenths).where(sql`${t.releasedAt} is null`)]
);

export const creatorStage = network.enum("creator_stage", [
  "found",
  "already_licensed",
  "asked",
  "said_yes",
  "setting_up",
  "on_air",
  "claimed",
  "declined",
  "no_answer"
]);

/** A creator in the pipeline. The display name and the person who says yes differ. */
export const creators = network.table("creators", {
  id: id(),
  marketId: uuid("market_id").references(() => markets.id),
  displayName: text("display_name").notNull(),
  personName: text("person_name"),
  description: text("description"),
  /** Where the work lives, and the account they connect later to prove it's them. */
  sourcePlatform: text("source_platform", {
    enum: ["youtube", "vimeo", "internet_archive", "instagram", "facebook", "soundcloud", "bandcamp", "other"]
  }).notNull(),
  sourceUrl: text("source_url").notNull(),
  contactEmail: text("contact_email"),
  stage: creatorStage("stage").notNull().default("found"),
  proposedBand: band("proposed_band"),
  proposedTenths: integer("proposed_tenths"),
  nextAction: text("next_action"),
  nextActionDue: date("next_action_due"),
  remindedAt: at("reminded_at"),
  /** "Said no Sept 2. Don't ask again." */
  doNotAsk: boolean("do_not_ask").notNull().default(false),
  stationId: uuid("station_id").references(() => stations.id),
  createdAt: createdAt()
});

/** A work found on the creator's source, catalogued from its title and length only. */
export const creatorWorks = network.table("creator_works", {
  id: id(),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id),
  title: text("title").notNull(),
  durationMs: millis("duration_ms"),
  sourceUrl: text("source_url").notNull(),
  groupLabel: text("group_label"),
  /** Works left out of an ask ("Likely someone else's rights"). */
  leftOutReason: text("left_out_reason"),
  createdAt: createdAt()
});

export const permissionRequests = network.table("permission_requests", {
  id: id(),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id),
  /** The unguessable part of the permission page link; the creator needs no account. */
  linkToken: text("link_token").notNull().unique(),
  sentVia: jsonb("sent_via").$type<string[]>().notNull(),
  note: text("note"),
  proposedBand: band("proposed_band"),
  proposedTenths: integer("proposed_tenths"),
  sentBy: uuid("sent_by").references(() => users.id),
  sentAt: at("sent_at").notNull().defaultNow()
});

/** The yes or no, recorded against the link with the exact list of works. Never edited. */
export const permissionRecords = network.table("permission_records", {
  id: id(),
  requestId: uuid("request_id")
    .notNull()
    .unique()
    .references(() => permissionRequests.id),
  answer: text("answer", { enum: ["yes", "no"] }).notNull(),
  answeredAt: at("answered_at").notNull().defaultNow(),
  answeredFromIp: text("answered_from_ip"),
  copySentAt: at("copy_sent_at"),
  copySentTo: text("copy_sent_to")
});

export const permissionRecordWorks = network.table(
  "permission_record_works",
  {
    permissionRecordId: uuid("permission_record_id")
      .notNull()
      .references(() => permissionRecords.id),
    creatorWorkId: uuid("creator_work_id")
      .notNull()
      .references(() => creatorWorks.id)
  },
  (t) => [uniqueIndex("permission_record_works_pk").on(t.permissionRecordId, t.creatorWorkId)]
);

export const licence = network.enum("licence", [
  "cc0",
  "cc_by",
  "cc_by_sa",
  "cc_by_nd",
  "cc_by_nc",
  "cc_by_nc_sa",
  "cc_by_nc_nd",
  "other"
]);

/** A work published under a licence. It only counts when the licence allows commercial use. */
export const licenceRecords = network.table("licence_records", {
  id: id(),
  creatorWorkId: uuid("creator_work_id")
    .notNull()
    .references(() => creatorWorks.id),
  licence: licence("licence").notNull(),
  licenceUrl: text("licence_url").notNull(),
  attribution: text("attribution").notNull(),
  allowsCarriage: boolean("allows_carriage")
    .notNull()
    .generatedAlwaysAs(sql`licence in ('cc0', 'cc_by', 'cc_by_sa')`),
  lastCheckedAt: at("last_checked_at").notNull().defaultNow(),
  createdAt: createdAt()
});

/** Template schedules by category ("Cooking and food, TV band"). */
export const recipes = network.table("recipes", {
  id: id(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  band: band("band").notNull(),
  /** 24-hour block timeline: [{ start: "06:00", end: "10:00", source: "catalog" | "creator" | "carried" | "repeats" }]. */
  blocks: jsonb("blocks").notNull(),
  maxAiringsPerWorkPerWeek: integer("max_airings_per_work_per_week").notNull().default(3),
  breakRule: jsonb("break_rule").notNull(),
  createdAt: createdAt()
});

/** City and county streams listed on the dial. The station row carries the call sign and channel. */
export const listedSources = network.table("listed_sources", {
  id: id(),
  stationId: uuid("station_id")
    .notNull()
    .unique()
    .references(() => stations.id),
  name: text("name").notNull(),
  description: text("description"),
  streamUrl: text("stream_url").notNull(),
  embedTerms: text("embed_terms", { enum: ["allowed", "unclear"] }).notNull(),
  calendarUrl: text("calendar_url"),
  calendarSync: text("calendar_sync", { enum: ["synced", "calendar_not_found", "not_set"] })
    .notNull()
    .default("not_set"),
  listingState: text("listing_state", { enum: ["not_listed", "checking", "listed"] })
    .notNull()
    .default("not_listed"),
  lastSyncedAt: at("last_synced_at"),
  createdAt: createdAt()
});

/** A meeting pulled from a listed source's agenda calendar. Viewers can set reminders on it. */
export const listedAirings = network.table("listed_airings", {
  id: id(),
  listedSourceId: uuid("listed_source_id")
    .notNull()
    .references(() => listedSources.id),
  title: text("title").notNull(),
  startsAt: at("starts_at").notNull(),
  endsAt: at("ends_at"),
  externalId: text("external_id"),
  createdAt: createdAt()
});

/** Claiming (or stopping) a claimable station. The escrow contract enforces the money side. */
export const handovers = network.table("handovers", {
  id: id(),
  stationId: uuid("station_id")
    .notNull()
    .references(() => stations.id),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id),
  kind: text("kind", { enum: ["claim", "stop"] }).notNull(),
  claimantUserId: uuid("claimant_user_id").references(() => users.id),
  /** The creator's wallet the verifiers approve on-chain; the escrow pays nowhere else. */
  payeeAddress: text("payee_address"),
  sourceAccountVerifiedAt: at("source_account_verified_at"),
  approvedAt: at("approved_at"),
  /** Approval plus the 72-hour public waiting period. */
  payableAfter: at("payable_after"),
  cancelledAt: at("cancelled_at"),
  cancelReason: text("cancel_reason"),
  completedAt: at("completed_at"),
  createdAt: createdAt()
});
