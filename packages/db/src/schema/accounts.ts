import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, primaryKey, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, createdAt, id } from "./columns.js";
import { accounts } from "./namespaces.js";
import { stations } from "./broadcast.js";
import { markets, listedAirings } from "./network.js";
import { advertisers } from "./spots.js";
import { logEntries } from "./broadcast.js";

export const users = accounts.table("users", {
  id: id(),
  /** Privy's user id (did:privy:…). Null only for users migrated from a bare wallet. */
  privyDid: text("privy_did").unique(),
  /** "What stations call you." Only used if you ask to be credited on air. */
  displayName: text("display_name"),
  email: text("email"),
  marketId: uuid("market_id").references(() => markets.id),
  isAdmin: boolean("is_admin").notNull().default(false),
  /** The eight settings sections (watching, notifications, appearance, privacy, …). */
  settings: jsonb("settings").notNull().default({}),
  createdAt: createdAt(),
  lastSeenAt: at("last_seen_at"),
  /**
   * "Sign out everywhere" (A1). Privy's sessions can't be ended from here, so Privy tokens issued
   * before this (by the token's `iat`) are refused, as are sessions seen before it (below).
   */
  signedOutAt: at("signed_out_at"),
  /**
   * The account was deleted (A3): the row stays as an empty tombstone, because the ledger and the
   * records others hold point at it. Tokens issued before this are refused; signing in again later
   * starts a new, empty account.
   */
  deletedAt: at("deleted_at")
});

/**
 * Privy sessions (the token's `sid`) this API has seen, so "sign out everywhere" can refuse a
 * session's later tokens too (Privy refreshes a session's token with a new `iat`).
 */
export const signInSessions = accounts.table(
  "sign_in_sessions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    sid: text("sid").notNull(),
    firstSeenAt: at("first_seen_at").notNull().defaultNow(),
    endedAt: at("ended_at")
  },
  (t) => [primaryKey({ columns: [t.userId, t.sid] })]
);

/**
 * What a signed-in person watched (A2), from their tuned-in heartbeats, only while their
 * `privacy.keepWatchHistory` setting is on. Never linked to the anonymous audience sessions.
 * Kept 30 days. One row per stretch of watching one station.
 */
export const watchHistory = accounts.table(
  "watch_history",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    startedAt: at("started_at").notNull(),
    lastAt: at("last_at").notNull()
  },
  (t) => [index("watch_history_user").on(t.userId, t.lastAt)]
);

/** How someone signs in. A wallet identity is how migrated station owners are matched. */
export const identities = accounts.table(
  "identities",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind", { enum: ["email", "apple", "google", "wallet"] }).notNull(),
    value: text("value").notNull(),
    verifiedAt: at("verified_at"),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex("identities_kind_value").on(t.kind, t.value)]
);

export const stationRole = accounts.enum("station_role", ["owner", "operator", "host"]);

export const stationMemberships = accounts.table(
  "station_memberships",
  {
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: stationRole("role").notNull(),
    note: text("note"),
    lastInAt: at("last_in_at"),
    createdAt: createdAt()
  },
  (t) => [
    primaryKey({ columns: [t.stationId, t.userId] }),
    uniqueIndex("station_one_owner").on(t.stationId).where(sql`${t.role} = 'owner'`)
  ]
);

export const advertiserRole = accounts.enum("advertiser_role", ["owner", "manager", "viewer"]);

export const advertiserMemberships = accounts.table(
  "advertiser_memberships",
  {
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertisers.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: advertiserRole("role").notNull(),
    /** "Bookkeeper", "Inland Creative, the agency". An agency is a person with a note. */
    note: text("note"),
    lastInAt: at("last_in_at"),
    createdAt: createdAt()
  },
  (t) => [
    primaryKey({ columns: [t.advertiserId, t.userId] }),
    uniqueIndex("advertiser_one_owner").on(t.advertiserId).where(sql`${t.role} = 'owner'`)
  ]
);

/** Team invites. Owners can't be invited; invites expire after a week. */
export const invites = accounts.table(
  "invites",
  {
    id: id(),
    stationId: uuid("station_id").references(() => stations.id),
    advertiserId: uuid("advertiser_id").references(() => advertisers.id),
    email: text("email"),
    phone: text("phone"),
    role: text("role", { enum: ["operator", "host", "manager", "viewer"] }).notNull(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    expiresAt: at("expires_at").notNull(),
    acceptedAt: at("accepted_at"),
    acceptedBy: uuid("accepted_by").references(() => users.id),
    /** A4 (added 2026-09-29): the live programs a host invite hosts, assigned when it's accepted. */
    programIds: jsonb("program_ids").$type<string[]>(),
    createdAt: createdAt()
  },
  (t) => [
    check("invite_one_target", sql`(${t.stationId} is null) <> (${t.advertiserId} is null)`),
    check("invite_has_contact", sql`${t.email} is not null or ${t.phone} is not null`),
    check(
      "invite_role_fits",
      sql`(${t.stationId} is not null and ${t.role} in ('operator', 'host'))
       or (${t.advertiserId} is not null and ${t.role} in ('manager', 'viewer'))`
    )
  ]
);

/** Keys 1 to 6, then "More presets" in order with no key. Never deleted by a replace. */
export const presets = accounts.table(
  "presets",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    key: smallint("key"),
    position: integer("position").notNull(),
    createdAt: createdAt()
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.stationId] }),
    check("preset_key_range", sql`${t.key} is null or ${t.key} between 1 and 6`),
    uniqueIndex("presets_key").on(t.userId, t.key).where(sql`${t.key} is not null`)
  ]
);

/** Per-key use, so a replace can suggest "the key used least in the last month". */
export const presetKeyUse = accounts.table(
  "preset_key_use",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    key: smallint("key").notNull(),
    day: date("day").notNull(),
    uses: integer("uses").notNull().default(0)
  },
  (t) => [primaryKey({ columns: [t.userId, t.key, t.day] })]
);

/** A reminder for an airing on the log, or for a listed city meeting. */
export const reminders = accounts.table(
  "reminders",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    logEntryId: uuid("log_entry_id").references(() => logEntries.id),
    listedAiringId: uuid("listed_airing_id").references(() => listedAirings.id),
    /** "Switch me over at 9:00, if I'm watching something else on Opencast." Off by default. */
    switchMeOver: boolean("switch_me_over").notNull().default(false),
    notifiedAt: at("notified_at"),
    createdAt: createdAt()
  },
  (t) => [check("reminder_one_target", sql`(${t.logEntryId} is null) <> (${t.listedAiringId} is null)`)]
);

/** Per person, per station or business, or for their own viewing. "Dead air coming" can't be turned off. */
export const notificationPrefs = accounts.table(
  "notification_prefs",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    scope: text("scope", { enum: ["viewer", "station", "advertiser"] }).notNull(),
    scopeId: uuid("scope_id"),
    prefs: jsonb("prefs").notNull().default({})
  },
  (t) => [uniqueIndex("notification_prefs_scope").on(t.userId, t.scope, t.scopeId)]
);

/** TVs: app TVs hold a sign-in paired with a code; cast targets are remembered only for the list. */
export const devices = accounts.table("devices", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["chromecast", "tv_app", "airplay"] }).notNull(),
  pairedAt: at("paired_at"),
  lastUsedAt: at("last_used_at"),
  signedOutAt: at("signed_out_at"),
  createdAt: createdAt()
});

/**
 * A person's Clear wallet, linked through Privy's cross-app linking: Clear's Privy app is the
 * provider, Opencast's the requester. Nothing about a Clear account is known until the person
 * links it. `access` is what Clear granted Opencast when it was linked (Clear's dashboard setting):
 * read-only (verify the address, pay out to it) or full (also request transfers the person
 * confirms). Unlinking keeps the row, so funding sources and payouts that used it can tell.
 */
export const clearLinks = accounts.table(
  "clear_links",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** The Clear wallet's address (the cross-app account's embedded wallet), checksummed. */
    address: text("address").notNull(),
    /** The person's user ID in Clear's Privy app (the cross-app account's subject). */
    subject: text("subject").notNull(),
    /** Clear's provider app ID it was linked through. */
    providerAppId: text("provider_app_id").notNull(),
    access: text("access", { enum: ["read_only", "full"] }).notNull(),
    linkedAt: at("linked_at").notNull(),
    unlinkedAt: at("unlinked_at"),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex("clear_links_one_per_user").on(t.userId).where(sql`${t.unlinkedAt} is null`)]
);
