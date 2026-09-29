import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
 
  primaryKey,
  real,
  serial,
  smallint,
  text,
  time,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { at, createdAt, id, millis } from "./columns.js";
import { broadcast, band, logCode, rightsBasis } from "./namespaces.js";
import { markets, creatorWorks, licenceRecords, permissionRecords } from "./network.js";
import { users } from "./accounts.js";
import { agreements } from "./catalog.js";
import { airings } from "./spots.js";

export const stationKind = broadcast.enum("station_kind", [
  /** An independent station. */
  "station",
  /** Makes programs and spots; no channel, never signs on. */
  "studio",
  /** Run by Opencast for a creator until they claim it; earnings go to escrow. */
  "claimable",
  /** A city or county stream on the dial; viewers get the source's own player. */
  "listed",
  /** Opencast's own catalog station (OCAT). */
  "catalog"
]);

export const stationStatus = broadcast.enum("station_status", [
  "setting_up",
  "on_air",
  "off_air",
  "signed_off"
]);

export const stations = broadcast.table(
  "stations",
  {
    id: id(),
    kind: stationKind("kind").notNull().default("station"),
    /** Null for a studio, or before setup. Unique platform-wide; fixed after first sign-on. */
    callSign: text("call_sign"),
    /** A studio's short handle in place of a call sign. */
    handle: text("handle"),
    name: text("name").notNull(),
    description: text("description"),
    colour: text("colour"),
    homeCity: text("home_city"),
    /** Where spot distances are measured from ("from your studio"). */
    studioLatitude: real("studio_latitude"),
    studioLongitude: real("studio_longitude"),
    category: text("category"),
    /** IAB Content Taxonomy 3.0 ids, when the station sets its own; null: derived from its category (packages/domain ads.ts). */
    iabCategories: jsonb("iab_categories").$type<string[]>(),
    status: stationStatus("status").notNull().default("setting_up"),
    firstSignedOnAt: at("first_signed_on_at"),
    signedOffAt: at("signed_off_at"),
    /** Stable number used as the station's key in the escrow contract. */
    escrowId: serial("escrow_id").notNull().unique(),
    bugMode: text("bug_mode", { enum: ["off", "call_sign_and_channel", "logo"] })
      .notNull()
      .default("call_sign_and_channel"),
    bugPosition: text("bug_position").notNull().default("bottom_right"),
    bugOpacity: smallint("bug_opacity").notNull().default(78),
    logoUrl: text("logo_url"),
    legalName: text("legal_name"),
    legalContact: text("legal_contact"),
    /** "What the station told us" about pledges being tax-deductible. */
    pledgesTaxDeductible: boolean("pledges_tax_deductible"),
    /** Makes spots to order for businesses ("Made for you"). Studios always do. */
    takesOrders: boolean("takes_orders").notNull().default(false),
    /** "About a week". */
    orderTurnaround: text("order_turnaround"),
    /** "From $100". */
    orderFromMicros: bigint("order_from_micros", { mode: "number" }),
    /** The member credit: read by the station ID voice, or text over bumper music. */
    memberCreditStyle: text("member_credit_style", { enum: ["voice", "text"] }).notNull().default("text"),
    /** The owner in the old model; kept so migrated stations can be matched to a user. */
    legacyOwnerWallet: text("legacy_owner_wallet"),
    legacySlug: text("legacy_slug"),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow()
  },
  (t) => [
    check("call_sign_format", sql`${t.callSign} is null or ${t.callSign} ~ '^[A-Z]{3,5}$'`),
    check("colour_contrast", sql`${t.colour} is null or public.contrast_on_white(${t.colour}) >= 4.5`),
    check("studio_never_signs_on", sql`${t.kind} <> 'studio' or ${t.firstSignedOnAt} is null`),
    check("signed_on_has_call_sign", sql`${t.firstSignedOnAt} is null or ${t.callSign} is not null`),
    check("bug_opacity_range", sql`${t.bugOpacity} between 0 and 100`),
    uniqueIndex("stations_call_sign").on(t.callSign),
    uniqueIndex("stations_handle").on(t.handle)
  ]
);

/**
 * A station's place on the dial. The number is stored in tenths (12.2 is 122).
 * Unique per market and band while not released; fixed once the station has
 * signed on (trigger). A released channel frees its number 90 days after a
 * station signs off for good.
 */
export const channels = broadcast.table(
  "channels",
  {
    id: id(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    band: band("band").notNull(),
    tenths: integer("tenths").notNull(),
    isPrimary: boolean("is_primary").notNull().default(true),
    /** For a 24/7 subchannel: the station carried on it. */
    carriesStationId: uuid("carries_station_id").references(() => stations.id),
    releasedAt: at("released_at"),
    createdAt: createdAt()
  },
  (t) => [
    check(
      "channel_number_in_band",
      sql`(${t.band} = 'tv' and ${t.tenths} between 21 and 699 and ${t.tenths} % 10 <> 0)
       or (${t.band} = 'radio' and ${t.tenths} between 881 and 1079 and ${t.tenths} % 2 = 1)`
    ),
    uniqueIndex("channels_number_in_market").on(t.marketId, t.band, t.tenths).where(sql`${t.releasedAt} is null`),
    uniqueIndex("channels_one_primary").on(t.stationId).where(sql`${t.isPrimary} and ${t.releasedAt} is null`)
  ]
);

/** A series or show: what listings, sponsorships and carriage offers attach to. */
export const programs = broadcast.table(
  "programs",
  {
    id: id(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category"),
    advisory: text("advisory", { enum: ["none", "language", "mature"] }).notNull().default("none"),
    /** US TV parental guidelines (TV-Y to TV-MA), for ad requests. */
    rating: text("rating", { enum: ["TV-Y", "TV-Y7", "TV-G", "TV-PG", "TV-14", "TV-MA"] }),
    /** Made for children: no personalized ads from partners. */
    childDirected: boolean("child_directed").notNull().default(false),
    /** IAB Content Taxonomy 3.0 ids, when set by hand; null: derived from its category, else the station's. */
    iabCategories: jsonb("iab_categories").$type<string[]>(),
    isLive: boolean("is_live").notNull().default(false),
    /** Where the rights come from, as the market shows it ("Public domain, restored"). */
    rightsNote: text("rights_note"),
    /** Required credit when the work is under a licence (CC BY). */
    attribution: text("attribution"),
    /** L7 (added 2026-09-29): how its airings are captioned, and in what language. Null: not said. */
    captionsMode: text("captions_mode", { enum: ["none", "generated_live", "generated", "uploaded"] }),
    captionsLanguage: text("captions_language"),
    createdAt: createdAt()
  },
  (t) => [
    check("description_length", sql`char_length(${t.description}) <= 160`),
    check("program_rating", sql`${t.rating} is null or ${t.rating} in ('TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA')`)
  ]
);

export const assetFolders = broadcast.table("asset_folders", {
  id: id(),
  stationId: uuid("station_id")
    .notNull()
    .references(() => stations.id),
  name: text("name").notNull(),
  parentFolderId: uuid("parent_folder_id").references((): AnyPgColumn => assetFolders.id),
  createdAt: createdAt()
});

export const assetSource = broadcast.enum("asset_source", [
  "upload",
  /** Imported from a link (yt-dlp). Stays on its station and is never offered for carriage. */
  "link",
  /** A claimable station's import of a creator's work. */
  "creator_work",
  /** Legacy creator-library item, before the move. */
  "library"
]);

export const assets = broadcast.table(
  "assets",
  {
    id: id(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    programId: uuid("program_id").references(() => programs.id),
    folderId: uuid("folder_id").references(() => assetFolders.id),
    title: text("title").notNull(),
    episodeNumber: integer("episode_number"),
    episodeDescription: text("episode_description"),
    code: logCode("code").notNull(),
    source: assetSource("source").notNull(),
    sourceUrl: text("source_url"),
    creatorWorkId: uuid("creator_work_id").references(() => creatorWorks.id),
    mediaKind: text("media_kind", { enum: ["video", "audio"] }).notNull(),
    durationMs: millis("duration_ms"),
    status: text("status", { enum: ["preparing", "ready", "failed"] })
      .notNull()
      .default("preparing"),
    prepProgress: smallint("prep_progress"),
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    loudnessLufs: real("loudness_lufs"),
    /** Audio channels in the file (1 mono, 2 stereo, more surround), from the probe. Null for items made before 2026-09-29. */
    audioChannels: smallint("audio_channels"),
    captions: text("captions", { enum: ["none", "generated", "uploaded"] }).notNull().default("none"),
    originalFilename: text("original_filename"),
    /** The old model's id, for the migration report. */
    legacyId: text("legacy_id").unique(),
    /** Deleted from the library. Kept, because the as-run log and claims still point at it. */
    archivedAt: at("archived_at"),
    createdAt: createdAt()
  },
  (t) => [
    check("link_has_url", sql`${t.source} <> 'link' or ${t.sourceUrl} is not null`),
    check("creator_work_has_work", sql`${t.source} <> 'creator_work' or ${t.creatorWorkId} is not null`),
    index("assets_station").on(t.stationId)
  ]
);

/**
 * A stored file, keyed by its content ID (CIDv1, raw, sha-256). Stored once however
 * many assets, spots or orders point at it. Deleted from storage only when nothing
 * references it and no claim has it locked.
 */
export const contents = broadcast.table(
  "contents",
  {
    cid: text("cid").primaryKey(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull(),
    /** Standard: the prepared file playout airs. Infrequent: originals. */
    storageClass: text("storage_class", { enum: ["standard", "infrequent"] }).notNull(),
    store: text("store", { enum: ["local", "r2"] }).notNull(),
    /** A rights claim is open against it: kept (so it can come back), never deleted, never aired. */
    lockedAt: at("locked_at"),
    lockReason: text("lock_reason"),
    /** Gone from storage: nothing referenced it, or a claim was resolved against it. */
    deletedAt: at("deleted_at"),
    deletedReason: text("deleted_reason", { enum: ["unreferenced", "takedown"] }),
    /** Published to IPFS on purpose: the Opencast catalog, or a station's Export to IPFS. */
    ipfsCid: text("ipfs_cid"),
    ipfsPinId: text("ipfs_pin_id"),
    ipfsReason: text("ipfs_reason", { enum: ["catalog", "export"] }),
    ipfsPublishedAt: at("ipfs_published_at"),
    createdAt: createdAt()
  },
  (t) => [
    check("cid_format", sql`${t.cid} ~ '^b[a-z2-7]{58}$'`),
    check("deleted_has_reason", sql`(${t.deletedAt} is null) = (${t.deletedReason} is null)`),
    check("ipfs_has_reason", sql`(${t.ipfsCid} is null) = (${t.ipfsReason} is null)`)
  ]
);

/** What points at a content ID. The last reference going is what lets the object go. */
export const contentRefs = broadcast.table(
  "content_refs",
  {
    cid: text("cid")
      .notNull()
      .references(() => contents.cid),
    owner: text("owner", { enum: ["asset_file", "asset_original", "spot_file", "order_file", "claim_attachment", "business_logo", "caption_track"] }).notNull(),
    ownerId: uuid("owner_id").notNull(),
    createdAt: createdAt()
  },
  (t) => [primaryKey({ columns: [t.cid, t.owner, t.ownerId] }), index("content_refs_owner").on(t.owner, t.ownerId)]
);

/**
 * Low-bitrate HLS previews, kept only while something needs one: an item offered in
 * the syndication market, a spot in review, a production order's delivery.
 */
export const contentPreviews = broadcast.table("content_previews", {
  cid: text("cid")
    .primaryKey()
    .references(() => contents.cid),
  status: text("status", { enum: ["rendering", "ready", "failed"] }).notNull(),
  createdAt: createdAt()
});

export const contentPreviewNeeds = broadcast.table(
  "content_preview_needs",
  {
    cid: text("cid")
      .notNull()
      .references(() => contents.cid),
    reason: text("reason", { enum: ["offer", "review", "order"] }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    createdAt: createdAt()
  },
  (t) => [primaryKey({ columns: [t.cid, t.reason, t.subjectId] })]
);

/** Stored copies of an asset. Replacing the file adds a version and keeps its history and schedule. */
export const assetFiles = broadcast.table(
  "asset_files",
  {
    id: id(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    version: integer("version").notNull(),
    /** The prepared file playout airs. */
    contentId: text("content_id").references(() => contents.cid),
    /** The original upload, kept in Infrequent Access. */
    originalContentId: text("original_content_id").references(() => contents.cid),
    /** Before content IDs: a disk path or URL. Rows made since point at content IDs instead. */
    storage: text("storage", { enum: ["local", "r2", "ipfs"] }),
    location: text("location"),
    r2Key: text("r2_key"),
    ipfsCid: text("ipfs_cid"),
    compression: jsonb("compression"),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex("asset_files_version").on(t.assetId, t.version), check("asset_file_has_content", sql`${t.contentId} is not null or ${t.location} is not null`)]
);

/** Where a maker allows breaks inside an episode ("Break points 4, every 30 minutes"). */
export const assetBreakPoints = broadcast.table(
  "asset_break_points",
  {
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    offsetMs: millis("offset_ms").notNull()
  },
  (t) => [primaryKey({ columns: [t.assetId, t.offsetMs] })]
);

/**
 * One per asset. A log entry can only reference an asset that has one: the
 * foreign key from log_entries goes here, not to assets.
 */
export const rightsConfirmations = broadcast.table(
  "rights_confirmations",
  {
    assetId: uuid("asset_id")
      .primaryKey()
      .references(() => assets.id),
    basis: rightsBasis("basis").notNull(),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    confirmedAt: at("confirmed_at").notNull().defaultNow(),
    note: text("note"),
    permissionRecordId: uuid("permission_record_id").references(() => permissionRecords.id),
    licenceRecordId: uuid("licence_record_id").references(() => licenceRecords.id)
  },
  (t) => [
    check("permission_record_basis", sql`${t.basis} <> 'permission_record' or ${t.permissionRecordId} is not null`),
    check("licence_record_basis", sql`${t.basis} <> 'licence_record' or ${t.licenceRecordId} is not null`)
  ]
);

export const breakRules = broadcast.table(
  "break_rules",
  {
    stationId: uuid("station_id")
      .primaryKey()
      .references(() => stations.id),
    mode: text("mode", { enum: ["after_every_program", "every_n_minutes", "none"] })
      .notNull()
      .default("after_every_program"),
    everyMinutes: integer("every_minutes"),
    lengthMs: millis("length_ms").notNull().default(120_000),
    /** Spot time per hour. Broadcast TV runs about 16 minutes; the default is 3:00. */
    spotMsPerHour: millis("spot_ms_per_hour").notNull().default(180_000),
    sameSpotPerHour: smallint("same_spot_per_hour").notNull().default(2),
    /** Fill order after SPT: codes in order. SID is always last and can't be removed. */
    fillOrder: jsonb("fill_order").$type<string[]>().notNull().default(["SPT", "UND", "BMP", "SID"]),
    openTimeTo: text("open_time_to", { enum: ["spot_market", "station_id_and_bumpers"] })
      .notNull()
      .default("spot_market"),
    /** "Ads from partners": a programmatic backfill for time still open. Off by default; only a switch until it's built. */
    adsFromPartners: boolean("ads_from_partners").notNull().default(false),
    updatedAt: at("updated_at").notNull().defaultNow()
  },
  (t) => [
    check("every_minutes_set", sql`${t.mode} <> 'every_n_minutes' or ${t.everyMinutes} > 0`),
    check("sid_last", sql`${t.fillOrder}->>(jsonb_array_length(${t.fillOrder}) - 1) = 'SID'`)
  ]
);

/** Spot categories a station won't air (Alcohol, Gambling, …). Blocked spots are hidden from its market. */
export const blockedCategories = broadcast.table(
  "blocked_categories",
  {
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    category: text("category").notNull()
  },
  (t) => [primaryKey({ columns: [t.stationId, t.category] })]
);

export const liveSources = broadcast.table("live_sources", {
  id: id(),
  stationId: uuid("station_id")
    .notNull()
    .references(() => stations.id),
  kind: text("kind", { enum: ["encoder", "browser"] }).notNull(),
  name: text("name").notNull(),
  livepeerStreamId: text("livepeer_stream_id"),
  livepeerPlaybackId: text("livepeer_playback_id"),
  /** Secret. Reset replaces it and the old key stops working. */
  streamKey: text("stream_key"),
  createdAt: createdAt()
});

/**
 * The program log: what airs, in order, with exact start times. Entries never
 * overlap on a station (exclusion constraint). Breaks are generated from the
 * break rule and live in `breaks`.
 */
export const logEntries = broadcast.table(
  "log_entries",
  {
    id: id(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    startsAt: at("starts_at").notNull(),
    endsAt: at("ends_at").notNull(),
    kind: text("kind", { enum: ["program", "live", "off_air"] }).notNull(),
    code: logCode("code").notNull(),
    /** Rights must be confirmed: this references rights_confirmations, not assets. */
    assetId: uuid("asset_id").references(() => rightsConfirmations.assetId),
    programId: uuid("program_id").references(() => programs.id),
    carriageAgreementId: uuid("carriage_agreement_id").references(() => agreements.id),
    liveSourceId: uuid("live_source_id").references(() => liveSources.id),
    /** Entries made by "Build one day and repeat it" share a group. */
    repeatGroupId: uuid("repeat_group_id").references(() => repeatGroups.id),
    localNote: text("local_note"),
    episodeTitle: text("episode_title"),
    episodeDescription: text("episode_description"),
    /** G3 (added 2026-09-29): a live block ended early. `ends_at` is moved to this moment; the log after it moved up. */
    endedEarlyAt: at("ended_early_at"),
    /**
     * Day templates (added 2026-09-29): the date (the station's local day) a template generated this
     * entry for, with `repeat_group_id` the template. Null for entries made by hand and for G7 copies.
     */
    templateDate: date("template_date"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt()
  },
  (t) => [
    check("ends_after_start", sql`${t.endsAt} > ${t.startsAt}`),
    check("program_has_asset", sql`${t.kind} <> 'program' or ${t.assetId} is not null`),
    check("live_has_source", sql`${t.kind} <> 'live' or ${t.liveSourceId} is not null`),
    check("episode_description_length", sql`char_length(${t.episodeDescription}) <= 160`),
    index("log_entries_station_time").on(t.stationId, t.startsAt)
  ]
);

/**
 * "Build one day and repeat it": Every Saturday / Weekdays / Every day / Once.
 *
 * G7 copies (`template` false) copied a day's entries once, up to `ends_on`. Day templates
 * (`template` true, added 2026-09-29) keep the day in `day_template_entries` and generate each
 * future date's log from it, a few weeks ahead (`day_template_dates` records each date made).
 * `starts_on` is the day it was built from; `ends_on` is the last date it repeats on (the date
 * for "once"; null repeats until it's taken off). `weekday` (0 = Sunday) for "weekly".
 */
export const repeatGroups = broadcast.table("repeat_groups", {
  id: id(),
  stationId: uuid("station_id")
    .notNull()
    .references(() => stations.id),
  /** `weekdays` (Monday to Friday) added 2026-09-29; a text column, so no migration for it. */
  pattern: text("pattern", { enum: ["once", "daily", "weekly", "weekdays"] }).notNull(),
  weekday: smallint("weekday"),
  startTime: time("start_time").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on"),
  /** Added 2026-09-29: a day template (generates dates) rather than a one-time copy. */
  template: boolean("template").notNull().default(false),
  name: text("name"),
  /** When the template last changed: dates generated before this are made again (unless edited). */
  updatedAt: at("updated_at"),
  /** Taken off the log (`removeRepeat`): nothing more is generated. */
  removedAt: at("removed_at"),
  createdAt: createdAt()
});

/** Day templates (added 2026-09-29): the day a template repeats, as local wall-clock times. */
export const dayTemplateEntries = broadcast.table(
  "day_template_entries",
  {
    id: id(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => repeatGroups.id),
    /** Minutes after the station's local midnight (0 to 1439): 8:00 pm stays 8:00 pm across DST. */
    startMinute: integer("start_minute").notNull(),
    lengthMs: millis("length_ms").notNull(),
    kind: text("kind", { enum: ["program", "live", "off_air"] }).notNull(),
    code: logCode("code").notNull(),
    assetId: uuid("asset_id").references(() => rightsConfirmations.assetId),
    programId: uuid("program_id").references(() => programs.id),
    carriageAgreementId: uuid("carriage_agreement_id").references(() => agreements.id),
    liveSourceId: uuid("live_source_id").references(() => liveSources.id),
    localNote: text("local_note"),
    episodeTitle: text("episode_title"),
    episodeDescription: text("episode_description"),
    createdAt: createdAt()
  },
  (t) => [
    check("template_entry_start_minute", sql`${t.startMinute} >= 0 and ${t.startMinute} < 1440`),
    check("template_entry_length", sql`${t.lengthMs} > 0`),
    index("day_template_entries_template").on(t.templateId)
  ]
);

/**
 * Day templates (added 2026-09-29): each date a template generated, one per station and date.
 * Generation is idempotent: a date made from the template since its last change is left alone,
 * and an edited date (`edited_at`) is never generated again.
 */
export const dayTemplateDates = broadcast.table(
  "day_template_dates",
  {
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    /** The station's local day. */
    date: date("date").notNull(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => repeatGroups.id),
    generatedAt: at("generated_at").notNull(),
    /** Someone changed this date's log by hand: it's an exception now. */
    editedAt: at("edited_at"),
    entries: integer("entries").notNull().default(0),
    /** Template entries that overlapped something already there, or can't air (rights, carriage). */
    skipped: integer("skipped").notNull().default(0)
  },
  (t) => [primaryKey({ columns: [t.stationId, t.date] }), index("day_template_dates_template").on(t.templateId)]
);

/**
 * Scheduled off air hours (added 2026-09-29): "every night 2:00 to 6:00 am", in the market's time
 * zone. `days` are the weekdays (0 = Sunday) the sign-off falls on; when `back_at` is at or before
 * `sign_off_at` the station is back the next day. Off air isn't dead air: no warnings, no fill.
 */
export const offAirHours = broadcast.table(
  "off_air_hours",
  {
    id: id(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    days: smallint("days").array().notNull(),
    signOffAt: time("sign_off_at").notNull(),
    backAt: time("back_at").notNull(),
    createdAt: createdAt()
  },
  (t) => [index("off_air_hours_station").on(t.stationId)]
);

/** A break slot, generated from the break rule or cued live. Filled from rotations at playout. */
export const breaks = broadcast.table(
  "breaks",
  {
    id: id(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    startsAt: at("starts_at").notNull(),
    lengthMs: millis("length_ms").notNull(),
    /** The log entry it sits after or inside ("After Late Crate, ep. 14", "During Saturday Reel"). */
    logEntryId: uuid("log_entry_id").references(() => logEntries.id),
    origin: text("origin", { enum: ["rule", "cued_live", "carried_barter"] }).notNull(),
    /** Break time owed to the producer inside a carried program, under barter. */
    producerShareMs: millis("producer_share_ms").notNull().default(0),
    /** When spots were placed in it (money held). After this it isn't refilled. */
    filledAt: at("filled_at"),
    createdAt: createdAt()
  },
  (t) => [index("breaks_station_time").on(t.stationId, t.startsAt)]
);

/** Who can go live on which program. Hosts see only their assigned blocks. */
export const hostAssignments = broadcast.table(
  "host_assignments",
  {
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id)
  },
  (t) => [primaryKey({ columns: [t.userId, t.programId] })]
);

/** Lower thirds for a live program: the speaker list. */
export const speakers = broadcast.table("speakers", {
  id: id(),
  programId: uuid("program_id")
    .notNull()
    .references(() => programs.id),
  name: text("name").notNull(),
  title: text("title"),
  position: integer("position").notNull(),
  createdAt: createdAt()
});

/** Sign-on and sign-off windows (the old stream schedules). */
export const schedules = broadcast.table("schedules", {
  id: id(),
  stationId: uuid("station_id")
    .notNull()
    .references(() => stations.id),
  startAt: at("start_at").notNull(),
  endAt: at("end_at"),
  enabled: boolean("enabled").notNull().default(true),
  startedAt: at("started_at"),
  endedAt: at("ended_at"),
  createdAt: createdAt()
});

export const playoutState = broadcast.table("playout_state", {
  stationId: uuid("station_id")
    .primaryKey()
    .references(() => stations.id),
  onAir: boolean("on_air").notNull().default(false),
  currentLogEntryId: uuid("current_log_entry_id").references(() => logEntries.id),
  currentAssetId: uuid("current_asset_id").references(() => assets.id),
  currentStartedAt: at("current_started_at"),
  currentOffsetMs: millis("current_offset_ms").notNull().default(0),
  lastError: text("last_error"),
  /** A live block is on the stand-by slate, waiting for its signal. */
  standingBy: boolean("standing_by").notNull().default(false),
  updatedAt: at("updated_at").notNull().defaultNow()
});

export const commands = broadcast.table("commands", {
  id: id(),
  stationId: uuid("station_id")
    .notNull()
    .references(() => stations.id),
  /**
   * `end_live` (added 2026-09-29): a live block ended early; playout hands back to the log.
   * `replan` (added 2026-09-29): the off air hours changed; playout reads the log again. A text column: no migration.
   */
  action: text("action", { enum: ["sign_on", "sign_off", "skip", "previous", "cue_break", "end_live", "replan"] }).notNull(),
  issuedBy: uuid("issued_by").references(() => users.id),
  createdAt: createdAt(),
  consumedAt: at("consumed_at")
});

/** Relays to YouTube, Twitch or any RTMP address. */
export const translators = broadcast.table("translators", {
  id: id(),
  stationId: uuid("station_id")
    .notNull()
    .references(() => stations.id),
  service: text("service", { enum: ["youtube", "twitch", "rtmp"] }).notNull(),
  name: text("name").notNull(),
  rtmpUrl: text("rtmp_url").notNull(),
  /** Secret. Never returned by the API. */
  streamKey: text("stream_key").notNull(),
  breakHandling: text("break_handling", { enum: ["air_spots", "station_id_slate"] })
    .notNull()
    .default("air_spots"),
  prerecordedLabel: boolean("prerecorded_label").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  /** Added 2026-09-29 (migration 0021): captions drawn into the relayed picture. Off unless the station chooses it. */
  burnCaptions: boolean("burn_captions").notNull().default(false),
  createdAt: createdAt()
});

export const livepeerConfig = broadcast.table("livepeer_config", {
  stationId: uuid("station_id")
    .primaryKey()
    .references(() => stations.id),
  enabled: boolean("enabled").notNull().default(true),
  streamId: text("stream_id"),
  streamKey: text("stream_key"),
  playbackId: text("playback_id"),
  playbackUrl: text("playback_url"),
  ingestUrl: text("ingest_url"),
  lastError: text("last_error"),
  updatedAt: at("updated_at").notNull().defaultNow()
});

/** Link imports in progress (yt-dlp). */
export const importJobs = broadcast.table("import_jobs", {
  id: id(),
  stationId: uuid("station_id")
    .notNull()
    .references(() => stations.id),
  requestedUrls: jsonb("requested_urls").$type<string[]>().notNull(),
  expandPlaylists: boolean("expand_playlists").notNull().default(false),
  status: text("status", {
    enum: ["queued", "expanding", "running", "completed", "partial", "failed", "canceled"]
  }).notNull(),
  items: jsonb("items").notNull().default([]),
  error: text("error"),
  createdAt: createdAt(),
  finishedAt: at("finished_at")
});

/** What actually aired, to the second. Billing reads this, never the planned log. Append-only. */
export const asRun = broadcast.table(
  "as_run",
  {
    id: id(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    code: logCode("code").notNull(),
    startedAt: at("started_at").notNull(),
    endedAt: at("ended_at").notNull(),
    logEntryId: uuid("log_entry_id").references(() => logEntries.id),
    breakId: uuid("break_id").references(() => breaks.id),
    assetId: uuid("asset_id").references(() => assets.id),
    programId: uuid("program_id").references(() => programs.id),
    /** Set for spots: the placement this airing settles. */
    airingId: uuid("airing_id").references(() => airings.id),
    carriageAgreementId: uuid("carriage_agreement_id").references(() => agreements.id),
    liveSourceId: uuid("live_source_id").references(() => liveSources.id),
    /** Why it aired: as planned, or a fill the worker chose. */
    reason: text("reason", {
      enum: ["planned", "rotation", "backup_rotation", "station_id_fill", "dead_air_fill", "live", "slate"]
    }).notNull(),
    /** Proof frame for spots: captured with the station's bug, kept for a year. */
    proofFrameUrl: text("proof_frame_url"),
    proofFrameAt: at("proof_frame_at"),
    createdAt: createdAt()
  },
  (t) => [
    check("as_run_ends_after_start", sql`${t.endedAt} >= ${t.startedAt}`),
    index("as_run_station_time").on(t.stationId, t.startedAt)
  ]
);

/** The rolling dead-air check: warnings at 30 and 12 minutes, then an auto-fill. */
export const deadAirEvents = broadcast.table("dead_air_events", {
  id: id(),
  stationId: uuid("station_id")
    .notNull()
    .references(() => stations.id),
  gapStartsAt: at("gap_starts_at").notNull(),
  gapEndsAt: at("gap_ends_at").notNull(),
  warned30At: at("warned_30_at"),
  warned12At: at("warned_12_at"),
  autoFilledAt: at("auto_filled_at"),
  resolvedAt: at("resolved_at"),
  createdAt: createdAt()
});

/**
 * L7 (added 2026-09-29): an item's caption track, uploaded or edited in master control. WebVTT,
 * kept as text (a track is small). Generated captions don't exist yet.
 */
export const captionTracks = broadcast.table(
  "caption_tracks",
  {
    assetId: uuid("asset_id")
      .primaryKey()
      .references(() => assets.id),
    /** BCP 47 ("en", "es"). */
    language: text("language").notNull(),
    vtt: text("vtt").notNull(),
    source: text("source", { enum: ["uploaded", "edited"] }).notNull(),
    /** Added 2026-09-29 (migration 0021): the WebVTT's content ID; the text is in object storage under it too. Null until stored. */
    contentId: text("content_id"),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: at("updated_at").notNull().defaultNow()
  },
  (t) => [check("caption_track_size", sql`octet_length(${t.vtt}) <= 1048576`)]
);

/**
 * S15 (added 2026-09-29): the lower third on a live block, so a second device reads what's
 * showing. `speaker_id` points into the program's speaker list, which is replaced as a whole
 * (no foreign key); the name and title are copied so the state stands on its own.
 */
export const lowerThirds = broadcast.table("lower_thirds", {
  logEntryId: uuid("log_entry_id")
    .primaryKey()
    .references(() => logEntries.id),
  stationId: uuid("station_id")
    .notNull()
    .references(() => stations.id),
  hidden: boolean("hidden").notNull().default(false),
  speakerId: uuid("speaker_id"),
  name: text("name").notNull(),
  title: text("title"),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: at("updated_at").notNull().defaultNow()
});

// --- Prepare once, then assemble (migration 0020, 2026-09-29) --------------------------------

/**
 * An item prepared for air: transcoded once to the fixed ladder (4-second segments, aligned
 * keyframes, levelled loudness, a few milliseconds of fade at each edge) and stored under
 * `prepared/<key>/<rendition>/` in object storage. Keyed by the file's content ID, so a carried
 * or catalog program is prepared once for every station that airs it. Generated slates (station
 * ID holds, underwriting credits, sign-off and stand-by) use a `slate-…` key made from their
 * picture and length; files from before content IDs use `loc-…`, made from their old location.
 * `renditions` is what's wanted (the union of the bands that air it); each one done is a row in
 * `prepared_renditions`.
 */
export const preparedItems = broadcast.table(
  "prepared_items",
  {
    key: text("key").primaryKey(),
    /** The file's content ID (null for slates and old locations). */
    contentId: text("content_id"),
    kind: text("kind", { enum: ["file", "slate"] }).notNull().default("file"),
    /** Files from before content IDs: the disk path or URL it's read from. */
    sourceLocation: text("source_location"),
    mediaKind: text("media_kind", { enum: ["video", "audio"] }).notNull().default("video"),
    status: text("status", { enum: ["queued", "preparing", "ready", "failed"] }).notNull().default("queued"),
    renditions: text("renditions").array().notNull().default(sql`'{}'::text[]`),
    /** The item's length: known before (from the library) and measured after. */
    durationMs: millis("duration_ms"),
    /** When it's first needed on air, as far as the readiness check knows: earliest first. */
    neededAt: at("needed_at"),
    attempts: smallint("attempts").notNull().default(0),
    error: text("error"),
    /** Wall-clock time the last preparation took, and what it stored. */
    prepMs: integer("prep_ms"),
    bytes: bigint("bytes", { mode: "number" }),
    queuedAt: at("queued_at").notNull().defaultNow(),
    startedAt: at("started_at"),
    preparedAt: at("prepared_at")
  },
  (t) => [index("prepared_items_queue").on(t.status, t.neededAt), index("prepared_items_content").on(t.contentId)]
);

/** One rendition of a prepared item: its segments' lengths, in order (the playlist's EXTINFs). */
export const preparedRenditions = broadcast.table(
  "prepared_renditions",
  {
    key: text("key")
      .notNull()
      .references(() => preparedItems.key),
    rendition: text("rendition").notNull(),
    segments: integer("segments").notNull(),
    segmentMs: jsonb("segment_ms").$type<number[]>().notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    preparedAt: at("prepared_at").notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.key, t.rendition] })]
);

/**
 * Added 2026-09-29 (migration 0021): a prepared item's captions, segmented once to its 4-second
 * segments (WebVTT, each with an X-TIMESTAMP-MAP onto the item's own timestamps), in object storage
 * under `prepared/<key>/<rendition>/` next to its renditions. One row per caption track (by the
 * WebVTT's content ID): a track uploaded to an item whose file this is, or one embedded in the file
 * (`embedded`), or generated from speech later (`generated`). Captions never hold up readiness.
 */
export const preparedCaptions = broadcast.table(
  "prepared_captions",
  {
    key: text("key")
      .notNull()
      .references(() => preparedItems.key),
    /** The WebVTT's content ID. */
    contentId: text("content_id").notNull(),
    /** Its folder under `prepared/<key>/` ("cc" and 12 hex characters of the content ID's hash). */
    rendition: text("rendition").notNull(),
    source: text("source", { enum: ["uploaded", "embedded", "generated"] }).notNull(),
    /** BCP 47, when known. */
    language: text("language"),
    segments: integer("segments").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    preparedAt: at("prepared_at").notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.key, t.contentId] })]
);

/**
 * A channel's assembled timeline: what its playlists point at, in order, a row per item (or live
 * stretch). The worker writes rows a few seconds ahead; a segment is published (appears in the
 * playlist) once its program date-time plus length has passed. Rows are the playlist's state, so
 * any replica, or the API, renders the same playlist. `seq` is the media sequence number of the
 * row's first segment, `disc` the discontinuity sequence at it; `run` starts again after a
 * planned sign-off (a new playlist). Kept two days; the as-run log is the record.
 */
export const channelItems = broadcast.table(
  "channel_items",
  {
    id: id(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    run: integer("run").notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    disc: integer("disc").notNull(),
    /** An #EXT-X-DISCONTINUITY goes before it. */
    discontinuity: boolean("discontinuity").notNull().default(true),
    startsAt: at("starts_at").notNull(),
    endsAt: at("ends_at").notNull(),
    /** `prepared` segments, `live` segments (Livepeer's), or `end`: the playlist ends here (#EXT-X-ENDLIST). */
    kind: text("kind", { enum: ["prepared", "live", "end"] }).notNull(),
    preparedKey: text("prepared_key"),
    firstSegment: integer("first_segment").notNull().default(0),
    segments: integer("segments").notNull().default(0),
    /** Segment lengths on the channel's timeline (ms). */
    segmentMs: jsonb("segment_ms").$type<number[]>().notNull().default([]),
    /** Live: each rendition's segment URLs. */
    liveUris: jsonb("live_uris").$type<Record<string, string[]>>(),
    /** The #EXT-X-DATERANGE lines that go with it. */
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    code: text("code").notNull(),
    label: text("label").notNull(),
    /** What the as-run entry says when it's written. */
    reason: text("reason").notNull(),
    planKey: text("plan_key"),
    inBreak: boolean("in_break").notNull().default(false),
    logEntryId: uuid("log_entry_id"),
    breakId: uuid("break_id"),
    assetId: uuid("asset_id"),
    programId: uuid("program_id"),
    airingId: uuid("airing_id"),
    agreementId: uuid("agreement_id"),
    liveSourceId: uuid("live_source_id"),
    /** Still growing (a live stretch being appended to). */
    open: boolean("open").notNull().default(false),
    /** The as-run entry written once its last segment was published. */
    asRunId: uuid("as_run_id"),
    createdAt: createdAt()
  },
  (t) => [index("channel_items_station_seq").on(t.stationId, t.seq), index("channel_items_station_ends").on(t.stationId, t.endsAt)]
);

/** A translator relaying the channel: one row per session, with what it sent (egress). */
export const translatorSessions = broadcast.table(
  "translator_sessions",
  {
    id: id(),
    /** No foreign key: a translator can be removed, and its egress stays on record. */
    translatorId: uuid("translator_id").notNull(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    /** `copy`: stream-copied; `composite`: re-encoded to draw the bug. */
    mode: text("mode", { enum: ["copy", "composite"] }).notNull(),
    swapsBreaks: boolean("swaps_breaks").notNull().default(false),
    startedAt: at("started_at").notNull(),
    endedAt: at("ended_at"),
    bytesSent: bigint("bytes_sent", { mode: "number" }).notNull().default(0),
    lastError: text("last_error"),
    updatedAt: at("updated_at").notNull().defaultNow()
  },
  (t) => [index("translator_sessions_translator").on(t.translatorId, t.startedAt)]
);
