import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, date, index, integer, jsonb, serial, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
  /** Added 2026-09-29 (0029): who's asking and what for, as they wrote it (the desk's "Reserved by"). */
  name: text("name"),
  about: text("about"),
  createdAt: createdAt()
});

/**
 * A call sign held for someone on the waitlist ("BEAT is on hold for you"),
 * and for a year after a station signs off for good. While active, no other
 * station can take it (enforced by trigger on broadcast.stations).
 *
 * Since 0029 (2026-09-29): two people may ask for the same name (the index isn't unique); the
 * desk decides, keeping one (`decision` kept) and releasing the others (`release_reason`
 * not_kept), each with a name held for them instead (a new row that `replaces` theirs, with the
 * same `created_at`, their place in line). A hold ends at `held_until` (`call_signs.hold`, 120
 * days), with a reminder before; the desk can extend or release it.
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
    createdAt: createdAt(),
    // Added 2026-09-29 (0029).
    invitedAt: at("invited_at"),
    remindedAt: at("reminded_at"),
    extendedAt: at("extended_at"),
    extendedBy: uuid("extended_by").references(() => users.id),
    decision: text("decision", { enum: ["kept", "not_kept"] }),
    decidedAt: at("decided_at"),
    decidedBy: uuid("decided_by").references(() => users.id),
    /** The names offered with it when it wasn't kept or wasn't allowed (the first is held). */
    suggested: text("suggested").array(),
    /** The reservation this one was held in place of (a suggestion). */
    replaces: uuid("replaces"),
    releaseReason: text("release_reason", { enum: ["expired", "released", "not_kept", "refused", "signed_on", "replaced"] }),
    releasedBy: uuid("released_by").references(() => users.id),
    note: text("note")
  },
  (t) => [
    check("call_sign_format", sql`${t.callSign} ~ '^[A-Z]{3,5}$'`),
    index("call_sign_reservations_active").on(t.callSign).where(sql`${t.releasedAt} is null`)
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
  /** How the desk's lines refer to them ("Her videos"). Null: "their". */
  pronoun: text("pronoun", { enum: ["she", "he", "they"] }),
  /** Every channel proposed ("38.1 or 45.1"), in tenths, on `proposedBand`. Empty with a band: the band only. */
  proposedChannels: integer("proposed_channels").array(),
  /** The claimable station's setup, read back: the recipe it was made from and who runs it. */
  recipeId: uuid("recipe_id").references(() => recipes.id),
  operatorUserId: uuid("operator_user_id").references(() => users.id),
  /** "On air with credit. Claim invite sent Sept 24", then the claim link itself. */
  claimInviteSentAt: at("claim_invite_sent_at"),
  claimLinkSentAt: at("claim_link_sent_at"),
  createdAt: createdAt(),
  // ---- Added 2026-09-30 (follow-up Phase 6, migration 0039) ----
  /** A lead found on a public IPTV list: never on the dial from here, until they say yes or are confirmed public. */
  leadSource: text("lead_source", { enum: ["iptv_list"] }),
  /** The lead's stream address, as the list gave it (noted, never played or checked from here). */
  streamUrl: text("stream_url"),
  /** The list it was found on (an iptv-org address); null when pasted or uploaded. */
  leadListUrl: text("lead_list_url"),
  /** The list's own details: `{ tvgId, group, country, logoUrl }`. */
  leadDetails: jsonb("lead_details").$type<{ tvgId: string | null; group: string | null; country: string | null; logoUrl: string | null }>()
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
  /** What one of these is called ("film", "video", "recording"), for "6 films". */
  noun: text("noun"),
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
  sentAt: at("sent_at").notNull().defaultNow(),
  /** The works ticked when asking (B7): only these are covered by a yes. Null: every work not left out. */
  workIds: jsonb("work_ids").$type<string[]>(),
  /** The creator stopped it from the link (B8): nothing it covered airs again. */
  stoppedAt: at("stopped_at"),
  stoppedFromIp: text("stopped_from_ip")
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
  copySentTo: text("copy_sent_to"),
  /** Which wording of the permission page they answered (N4). */
  wordingVersion: text("wording_version")
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
  /** "at night": when the creator's work airs, for "Their films at night" (N6). */
  whenText: text("when_text"),
  /** "Classic films and overnight programming". */
  catalogAbout: text("catalog_about"),
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
  createdAt: createdAt(),
  // ---- External stations (added 2026-09-30, follow-up Phase 6, migration 0039) ----
  /** How it plays: the source's official embed (`stream_url` is the embed) or its raw stream link, in Opencast's player. */
  plays: text("plays", { enum: ["embed", "stream_link"] }).notNull().default("embed"),
  /** A stream link's format. Null for an embed. */
  streamFormat: text("stream_format", { enum: ["hls", "dash"] }),
  /** Why it may play that way; null until the evidence is in (it isn't on the dial until then). */
  basis: text("basis", { enum: ["embed_terms", "written_permission", "public_source"] }),
  /** An embed's terms page, and the day it was read. */
  termsUrl: text("terms_url"),
  termsCheckedOn: date("terms_checked_on"),
  /** A clearly public source's basis, in words ("US government, public"). */
  publicBasis: text("public_basis"),
  /** A stream link's written permission (recorded once, never edited). */
  streamPermissionId: uuid("stream_permission_id").references(() => streamPermissions.id),
  /** What's being waited on: "Asked Sept 22". */
  waitingNote: text("waiting_note"),
  /** The source is outside the market it's listed in (rule `external.other_markets`). */
  outsideMarket: boolean("outside_market").notNull().default(false),
  /** Where "what's on" comes from: its feed (`calendar_url`), guide data checked against its published schedule, or neither. */
  scheduleSource: text("schedule_source", { enum: ["feed", "guide_data", "none"] }).notNull().default("none"),
  scheduleFormat: text("schedule_format", { enum: ["ical", "rss", "json", "xmltv"] }),
  guideCheckedAgainst: text("guide_checked_against"),
  guideCheckedOn: date("guide_checked_on"),
  /** The stream, checked every minute: unchecked, up, down (still on the dial), hidden (down 5 minutes: off the dial). */
  health: text("health", { enum: ["unchecked", "up", "down", "hidden"] }).notNull().default("unchecked"),
  healthSince: at("health_since"),
  lastCheckedAt: at("last_checked_at"),
  lastCheckDetail: text("last_check_detail"),
  /** The pipeline lead (an IPTV-list channel) it came from. */
  creatorId: uuid("creator_id").references(() => creators.id),
  // ---- A215 (added 2026-09-30, migration 0040): taken off the dial for good, never deleted ----
  /** The lead's stage before this listing put it On air: where it goes back to if the listing is taken off. */
  leadStageBefore: creatorStage("lead_stage_before"),
  /** Taken off the dial for good: when and by whom. Null while it's listed. */
  removedAt: at("removed_at"),
  removedBy: uuid("removed_by").references(() => users.id),
  /** Where it was on the dial when it was taken off (the station keeps its channel 90 days, then it's freed). */
  removedMarketId: uuid("removed_market_id").references(() => markets.id),
  removedBand: band("removed_band"),
  removedTenths: integer("removed_tenths"),
  /** When its held channel was freed (90 days after it was taken off). */
  channelReleasedAt: at("channel_released_at"),
  // ---- A229 (added 2026-09-30, migration 0042): shared call signs ----
  /** Taken off the dial with the listing on X.1 whose call sign it shares ("Put back" on X.1 brings it back too). */
  removedWith: uuid("removed_with").references((): AnyPgColumn => listedSources.id),
  // ---- A237 (added 2026-10-01, migration 0044): plain-http stream links ----
  /**
   * An `http://` stream link's https address (same host and path) when a real playlist answered
   * there: the dial plays it straight from the source instead of through the relay. Null: not
   * upgraded (not tried, or it didn't answer).
   */
  httpsUrl: text("https_url"),
  /** When https was last tried for an `http://` stream link (at listing, a new address, then hourly). */
  httpsCheckedAt: at("https_checked_at")
});

/**
 * An external station's change history (added 2026-09-30, A215, migration 0040): each change to a
 * listing (the fields from → to, and what it did), taking it off the dial and putting it back.
 */
export const listedSourceChanges = network.table(
  "listed_source_changes",
  {
    id: id(),
    /** In the order they happened, when two share a moment. */
    seq: serial("seq").notNull(),
    listedSourceId: uuid("listed_source_id")
      .notNull()
      .references(() => listedSources.id),
    at: at("at").notNull(),
    by: uuid("by").references(() => users.id),
    action: text("action", { enum: ["changed", "removed", "restored"] }).notNull(),
    /** [{ field, from, to }], addresses in full. */
    fields: jsonb("fields").$type<Array<{ field: string; from: string | null; to: string | null }>>().notNull(),
    effects: jsonb("effects").$type<string[]>().notNull()
  },
  (t) => [index("listed_source_changes_source").on(t.listedSourceId, t.at)]
);

/**
 * A source's written permission for its stream link, kept like a claimable station's permission
 * record: recorded once with who said yes, when, where the writing is kept and exactly which
 * stream address it covers. Never edited (added 2026-09-30, follow-up Phase 6).
 */
export const streamPermissions = network.table("stream_permissions", {
  id: id(),
  grantedBy: text("granted_by").notNull(),
  grantedOn: date("granted_on").notNull(),
  evidence: text("evidence").notNull(),
  documentUrl: text("document_url"),
  streamUrl: text("stream_url").notNull(),
  creatorId: uuid("creator_id").references(() => creators.id),
  recordedBy: uuid("recorded_by").references(() => users.id),
  recordedAt: at("recorded_at").notNull().defaultNow(),
  /** The listing it was recorded for (added 2026-09-30, A215): kept when the listing's address changes. */
  listedSourceId: uuid("listed_source_id")
});

/**
 * An external station's stream being down: from the first failed check, off the dial 5 minutes
 * later (`hidden_at`), until it's back (added 2026-09-30, follow-up Phase 6). The desk's history.
 */
export const externalOutages = network.table(
  "external_outages",
  {
    id: id(),
    listedSourceId: uuid("listed_source_id")
      .notNull()
      .references(() => listedSources.id),
    downSince: at("down_since").notNull(),
    hiddenAt: at("hidden_at"),
    backAt: at("back_at"),
    detail: text("detail"),
    createdAt: createdAt(),
    /** How it ended (A215): null when the stream was back, or the address changed, or it was taken off the dial. */
    ended: text("ended", { enum: ["address_changed", "removed"] })
  },
  (t) => [
    index("external_outages_source").on(t.listedSourceId, t.downSince),
    uniqueIndex("external_outages_open").on(t.listedSourceId).where(sql`${t.backAt} is null`)
  ]
);

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
export const handovers = network.table(
  "handovers",
  {
  id: id(),
  /** Null for a claim started from the permission link before the station exists (B8); set when it's set up. */
  stationId: uuid("station_id").references(() => stations.id),
  /** The permission request whose link started it (B8). */
  requestId: uuid("request_id").references(() => permissionRequests.id),
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
  },
  (t) => [check("handover_has_station_or_link", sql`${t.stationId} is not null or ${t.requestId} is not null`)]
);
