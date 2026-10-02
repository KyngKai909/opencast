import { sql } from "drizzle-orm";
import { index, jsonb, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, createdAt, id } from "./columns.js";
import { tv } from "./namespaces.js";
import { users } from "./accounts.js";

// The TV app (Android TV, Fire TV, Google TV, a TV's browser, TV mode on the web). A TV registers
// itself on first launch and holds an opaque device token; "sign in on your phone" gives it a TV
// session for the person who approved its code. Phones reach it through the API's relay (Android
// TV and Fire TV have no Cast). Every token is stored as a SHA-256 hash, never as itself.

export const tvPlatform = tv.enum("platform", ["android_tv", "fire_tv", "google_tv", "tv_browser", "web"]);

export const tvDevices = tv.table("devices", {
  id: id(),
  platform: tvPlatform("platform").notNull(),
  /** "Living room TV". Null: named after the platform. */
  name: text("name"),
  tokenHash: text("token_hash").notNull().unique(),
  /** What the TV last said it's showing (the remote's state message), for phones that connect later. */
  remoteState: jsonb("remote_state"),
  remoteStateAt: at("remote_state_at"),
  /** The TV's relay stream is open (renewed by its heartbeat), with a short grace after it closes. */
  onlineUntil: at("online_until"),
  /** The stream that last opened: only its closing starts the grace period (a reconnect can overlap). */
  onlineStream: uuid("online_stream"),
  lastSeenAt: at("last_seen_at"),
  createdAt: createdAt()
});

/**
 * A TV signed in to a person's account. Made when the person approves the TV's code; its token is
 * made (and only its hash kept) when the TV collects it by polling, once. One live session a device.
 */
export const tvSessions = tv.table(
  "sessions",
  {
    id: id(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => tvDevices.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** Null until the TV collects the token. */
    tokenHash: text("token_hash").unique(),
    createdAt: createdAt(),
    claimedAt: at("claimed_at"),
    lastUsedAt: at("last_used_at"),
    endedAt: at("ended_at"),
    /** tv: it signed itself out; account: signed out from "Your TVs"; replaced: signed in again. */
    endedBy: text("ended_by", { enum: ["tv", "account", "replaced"] })
  },
  (t) => [uniqueIndex("tv_sessions_one_live").on(t.deviceId).where(sql`${t.endedAt} is null`), index("tv_sessions_user").on(t.userId)]
);

/** "Sign in on your phone": a code the TV shows for 10 minutes, and the poll token only the TV knows. */
export const tvSignInCodes = tv.table(
  "sign_in_codes",
  {
    id: id(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => tvDevices.id),
    code: text("code").notNull(),
    pollTokenHash: text("poll_token_hash").notNull().unique(),
    createdAt: createdAt(),
    expiresAt: at("expires_at").notNull(),
    approvedAt: at("approved_at"),
    approvedBy: uuid("approved_by").references(() => users.id),
    sessionId: uuid("session_id").references(() => tvSessions.id),
    /** The TV collected its session token (it's handed over once). */
    claimedAt: at("claimed_at")
  },
  (t) => [index("tv_sign_in_codes_code").on(t.code)]
);

/** Chromecasts and AirPlay TVs, remembered by name for "Your TVs" only. */
export const tvCastTargets = tv.table(
  "cast_targets",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind", { enum: ["chromecast", "airplay"] }).notNull(),
    name: text("name").notNull(),
    lastUsedAt: at("last_used_at"),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex("tv_cast_targets_name").on(t.userId, t.kind, sql`lower(${t.name})`)]
);

/** A 4-digit code the TV shows so a guest's phone can pair with it as a remote (5 minutes). */
export const tvPairCodes = tv.table(
  "pair_codes",
  {
    id: id(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => tvDevices.id),
    code: text("code").notNull(),
    createdAt: createdAt(),
    expiresAt: at("expires_at").notNull()
  },
  (t) => [index("tv_pair_codes_code").on(t.code)]
);

/**
 * Phones that drive a TV: guests paired by code (holding a phone token), and phones signed in to
 * the TV's account (no pairing; one row per account, however many phones it's on).
 */
export const tvRemotePhones = tv.table(
  "remote_phones",
  {
    id: id(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => tvDevices.id),
    kind: text("kind", { enum: ["account", "guest"] }).notNull(),
    /** The account phone's person; a guest's, if it was signed in when it paired. */
    userId: uuid("user_id").references(() => users.id),
    /** "Kai's phone". */
    name: text("name").notNull(),
    /** Guests only. */
    tokenHash: text("token_hash").unique(),
    pairedAt: at("paired_at").notNull().defaultNow(),
    lastCommandAt: at("last_command_at"),
    /** Its relay stream is open (renewed by the heartbeat). */
    onlineUntil: at("online_until"),
    onlineStream: uuid("online_stream"),
    removedAt: at("removed_at")
  },
  (t) => [
    uniqueIndex("tv_remote_phones_account").on(t.deviceId, t.userId).where(sql`${t.kind} = 'account' and ${t.removedAt} is null`),
    index("tv_remote_phones_device").on(t.deviceId)
  ]
);

/** Wrong codes, for the limits on guessing (per person for sign-in codes, per phone or connection for pairing). */
export const tvCodeAttempts = tv.table(
  "code_attempts",
  {
    id: id(),
    scope: text("scope", { enum: ["sign_in", "pair"] }).notNull(),
    /** A user id, or a hash of the connection. Never an address as itself. */
    key: text("key").notNull(),
    at: at("at").notNull().defaultNow()
  },
  (t) => [index("tv_code_attempts_key").on(t.scope, t.key, t.at)]
);
