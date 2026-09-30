// Platform connections (added 2026-09-30, follow-up Phase 3; migration 0035): where a station's
// relays go, and the viewers YouTube and Twitch report. Owned by the platforms module.
//
// Secrets (stream keys, sign-in tokens) are stored only encrypted (AES-256-GCM, a key from
// PLATFORM_SECRETS_KEY; apps/api/src/v1/modules/platforms/secrets.ts), each bound to its row and
// field, and erased when the destination is removed. The API never returns them.

import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, primaryKey, real, text, uuid } from "drizzle-orm/pg-core";
import { at, createdAt } from "./columns.js";
import { broadcast } from "./namespaces.js";
import { stations } from "./broadcast.js";
import { users } from "./accounts.js";

export const platformKind = broadcast.enum("platform_kind", ["youtube", "twitch", "facebook", "kick", "custom"]);

/** A relay destination: signed in (YouTube, Twitch) or added by hand (an address and key). */
export const platformConnections = broadcast.table(
  "platform_connections",
  {
    /** Set by the API before the insert: each secret is bound to it. */
    id: uuid("id").primaryKey(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    kind: platformKind("kind").notNull(),
    method: text("method", { enum: ["signed_in", "manual"] }).notNull(),
    name: text("name").notNull(),
    /** The channel or user it's signed in as ("inlandbeat"), and the platform's id for it. */
    accountName: text("account_name"),
    externalAccountId: text("external_account_id"),
    rtmpUrl: text("rtmp_url").notNull(),
    /** Encrypted ("v1.<key id>.<iv>.<tag>.<ciphertext>"); null once removed. */
    streamKeyEnc: text("stream_key_enc"),
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: at("token_expires_at"),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    status: text("status", { enum: ["connected", "needs_sign_in"] }).notNull().default("connected"),
    /** YouTube: the live stream the relay sends to (its key stays the same across broadcasts). */
    liveStreamId: text("live_stream_id"),
    /** YouTube: the broadcast on air now, and the next one prepared before a restart. */
    currentBroadcastId: text("current_broadcast_id"),
    nextBroadcastId: text("next_broadcast_id"),
    broadcastTitle: text("broadcast_title"),
    broadcastDescription: text("broadcast_description"),
    /** Marked as containing paid promotion now (signed in), or last reminded (manual). */
    paidPromotion: boolean("paid_promotion").notNull().default(false),
    connectedBy: uuid("connected_by").references(() => users.id),
    createdAt: createdAt(),
    /** Removed in one click: the secrets are erased and the row stays for its viewer history and bills. */
    removedAt: at("removed_at")
  },
  (t) => [
    index("platform_connections_station").on(t.stationId),
    check("platform_connections_secrets_gone", sql`${t.removedAt} is null or (${t.streamKeyEnc} is null and ${t.accessTokenEnc} is null and ${t.refreshTokenEnc} is null)`)
  ]
);

/** A sign-in on its way: the OAuth state, checked once at the callback and good for 15 minutes. */
export const platformSignIns = broadcast.table("platform_sign_ins", {
  /** The OAuth `state` (random, 32 bytes, base64url). */
  state: text("state").primaryKey(),
  stationId: uuid("station_id")
    .notNull()
    .references(() => stations.id),
  provider: text("provider", { enum: ["youtube", "twitch"] }).notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  /** PKCE's verifier, encrypted like the other secrets. */
  verifierEnc: text("verifier_enc").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  returnTo: text("return_to").notNull(),
  createdAt: createdAt(),
  expiresAt: at("expires_at").notNull(),
  usedAt: at("used_at")
});

/**
 * What happened to a destination: connected, removed (and whether its tokens were revoked),
 * broadcasts started and ended, paid promotion marked, the station reminded (manual ones). Never a secret.
 */
export const platformEvents = broadcast.table(
  "platform_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => platformConnections.id),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    kind: text("kind", {
      enum: [
        "connected",
        "removed",
        "revoked",
        "revoke_failed",
        "broadcast_prepared",
        "broadcast_ended",
        "paid_promotion_on",
        "paid_promotion_off",
        "remind_paid_promotion",
        "remind_restart",
        "remind_end",
        "needs_sign_in",
        "geography"
      ]
    }).notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    at: at("at").notNull().defaultNow()
  },
  (t) => [index("platform_events_platform").on(t.platformId, t.at)]
);

/**
 * The concurrent viewers a connected YouTube or Twitch reported, each minute, like
 * `audience.minute_samples`. Attributed to whatever was airing by its minute; billing reads it.
 */
export const platformViewerSamples = broadcast.table(
  "platform_viewer_samples",
  {
    platformId: uuid("platform_id")
      .notNull()
      .references(() => platformConnections.id),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    kind: platformKind("kind").notNull(),
    minute: at("minute").notNull(),
    viewers: integer("viewers").notNull(),
    /** The platform's broadcast (YouTube's video id, Twitch's stream id): YouTube's geography is per broadcast. */
    broadcastRef: text("broadcast_ref")
  },
  (t) => [primaryKey({ columns: [t.platformId, t.minute] }), index("platform_viewer_samples_station").on(t.stationId, t.minute), check("platform_viewer_samples_viewers", sql`${t.viewers} >= 0`)]
);

/**
 * YouTube Analytics' viewer geography for one broadcast on one day (UTC; aggregated, a day or two
 * late; by day so a relay that runs for days still gets its numbers): each place and its share of
 * the broadcast's views. `none`: YouTube returned no location data (below its privacy thresholds),
 * so none of its viewers are billed to local businesses.
 */
export const platformGeography = broadcast.table(
  "platform_geography",
  {
    platformId: uuid("platform_id")
      .notNull()
      .references(() => platformConnections.id),
    broadcastRef: text("broadcast_ref").notNull(),
    day: date("day").notNull(),
    status: text("status", { enum: ["ready", "none"] }).notNull(),
    /** Places with coordinates and their share of views; unplaced views are the rest. */
    places: jsonb("places").$type<Array<{ label: string; latitude: number | null; longitude: number | null; share: number }>>().notNull().default(sql`'[]'::jsonb`),
    placedShare: real("placed_share").notNull().default(0),
    fetchedAt: at("fetched_at").notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.platformId, t.broadcastRef, t.day] })]
);

/**
 * A broadcast's day whose geography billing is waiting for, and when YouTube was last asked (the
 * numbers come a day or two late: asked again every few hours until they come or the wait is over).
 */
export const platformGeographyChecks = broadcast.table(
  "platform_geography_checks",
  {
    platformId: uuid("platform_id")
      .notNull()
      .references(() => platformConnections.id),
    broadcastRef: text("broadcast_ref").notNull(),
    day: date("day").notNull(),
    wantedAt: at("wanted_at").notNull().defaultNow(),
    checkedAt: at("checked_at"),
    attempts: integer("attempts").notNull().default(0)
  },
  (t) => [primaryKey({ columns: [t.platformId, t.broadcastRef, t.day] })]
);
