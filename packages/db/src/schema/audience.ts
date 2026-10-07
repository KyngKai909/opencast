import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, createdAt, id } from "./columns.js";
import { audience } from "./namespaces.js";
import { asRun, programs, stations, translators } from "./broadcast.js";
import { markets } from "./network.js";

/** `mirror`: the iPhone's second screen (TV mode mirrored to a TV). */
export const platform = audience.enum("platform", ["phone", "cast", "web", "tv_app", "mirror"]);

/** A viewer's player session. Heartbeats every 30 s; sessions that act like bots never count. */
export const sessions = audience.table(
  "sessions",
  {
    id: id(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    platform: platform("platform").notNull(),
    startedAt: at("started_at").notNull().defaultNow(),
    lastBeatAt: at("last_beat_at").notNull().defaultNow(),
    beats: integer("beats").notNull().default(0),
    lastMediaTimeMs: integer("last_media_time_ms"),
    flaggedBot: boolean("flagged_bot").notNull().default(false),
    flagReason: text("flag_reason"),
    /**
     * Added 2026-09-30 (follow-up Phase 3, migration 0035): the market the viewer is placed in,
     * their chosen market when signed in, else a coarse location from the connection (GEOIP_URL),
     * looked up once and forgotten. Null: Opencast can't place them (not billed to local businesses).
     */
    marketId: uuid("market_id").references(() => markets.id),
    // ---- A251 (added 2026-10-06, migration 0054): the desk's analytics ----
    /**
     * The tab's (or TV app run's) id the player beat with: the session's own id for the first
     * station, and the same for each station after, whose sessions get ids of their own. Sessions
     * of one visit one after another are channel changes.
     */
    visitId: uuid("visit_id"),
    /** A hash of the player's device id (never the id itself, never an account): counts of devices only. */
    deviceHash: text("device_hash"),
    /** How it was tuned (`Heartbeat.via`), from its first beat. */
    via: text("via"),
    /** Ms from the press to the first picture, from its first beat. */
    tuneMs: integer("tune_ms")
  },
  (t) => [index("sessions_station_beat").on(t.stationId, t.lastBeatAt), index("sessions_visit").on(t.visitId, t.startedAt), index("sessions_device").on(t.deviceHash, t.startedAt)]
);

/**
 * A251 (added 2026-10-06, migration 0054): a search a viewer settled on (`POST /search/seen`): its
 * words, lower-cased, and how many results it had. No account, device or session. Kept 90 days,
 * then only the desk's totals.
 */
export const searches = audience.table(
  "searches",
  {
    id: id(),
    term: text("term").notNull(),
    results: integer("results").notNull(),
    at: at("at").notNull().defaultNow()
  },
  (t) => [index("searches_at").on(t.at)]
);

/** Tuned-in concurrency per station per minute, by platform. Per-thousand billing reads this. */
export const minuteSamples = audience.table(
  "minute_samples",
  {
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    minute: at("minute").notNull(),
    tunedIn: integer("tuned_in").notNull(),
    phone: integer("phone").notNull().default(0),
    cast: integer("cast").notNull().default(0),
    web: integer("web").notNull().default(0),
    tvApp: integer("tv_app").notNull().default(0),
    mirror: integer("mirror").notNull().default(0)
  },
  (t) => [primaryKey({ columns: [t.stationId, t.minute] })]
);

/**
 * Added 2026-09-30 (follow-up Phase 3, migration 0035): tuned in per station per minute, by the
 * market viewers are placed in (sessions with a market only). A local business's per-thousand spot
 * is billed for the viewers placed inside its area.
 */
export const minuteMarkets = audience.table(
  "minute_markets",
  {
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    minute: at("minute").notNull(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    tunedIn: integer("tuned_in").notNull()
  },
  (t) => [primaryKey({ columns: [t.stationId, t.minute, t.marketId] })]
);

/** Viewers on a translator (YouTube, Twitch). Shown to the station apart; never billed. */
export const translatorSamples = audience.table(
  "translator_samples",
  {
    translatorId: uuid("translator_id")
      .notNull()
      .references(() => translators.id),
    minute: at("minute").notNull(),
    viewers: integer("viewers").notNull()
  },
  (t) => [primaryKey({ columns: [t.translatorId, t.minute] })]
);

// ---- Watch data (added 2026-09-29, follow-up Phase 1; migration 0031) ----
// Per-session rows (`session_minutes`, `not_for_me_votes`, and `sessions` themselves) are kept only
// while they're needed to work out each airing's numbers: `watch_data.retention` days (30), then a
// daily job deletes them. Votes go sooner, once their airing's numbers are final. What stays is
// `airing_stats`, which names no session and no person (docs/schema.md, "Watch data").

/** Each minute a session counted as tuned in (the same rule as `minute_samples`). */
export const sessionMinutes = audience.table(
  "session_minutes",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    minute: at("minute").notNull()
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.minute] }), index("session_minutes_station_minute").on(t.stationId, t.minute)]
);

/** "Not for me": one per session per airing (the log entry on air when it was sent), until the airing's numbers are final. */
export const notForMeVotes = audience.table(
  "not_for_me_votes",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    /** No foreign key: the log entry may come off the log after it aired. */
    logEntryId: uuid("log_entry_id").notNull(),
    votedAt: at("voted_at").notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.logEntryId] }), index("not_for_me_votes_entry").on(t.logEntryId)]
);

/**
 * One airing of a program's numbers, kept for good: no session, no person. An airing is a log
 * entry's program rows in the station's as-run log (`airing_key` `entry:<log entry>`), or one
 * program row with no log entry (a fill: `as_run:<row>`).
 */
export const airingStats = audience.table(
  "airing_stats",
  {
    id: id(),
    airingKey: text("airing_key").notNull(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    logEntryId: uuid("log_entry_id"),
    /** The airing's first program row in the as-run log. Null for what has no as-run log (external stations, later). */
    asRunId: uuid("as_run_id").references(() => asRun.id),
    programId: uuid("program_id").references(() => programs.id),
    /** Whose program it is (its station), for the maker's view across carriers. */
    makerStationId: uuid("maker_station_id").references(() => stations.id),
    /** Aired under a carriage agreement. */
    carried: boolean("carried").notNull().default(false),
    band: text("band", { enum: ["tv", "radio"] }).notNull(),
    /**
     * An external station's tuned-in time (Phase 6): recorded and labelled, and kept out of
     * anything that pays (nothing that pays reads this table; the pool reads `minute_samples`).
     */
    external: boolean("external").notNull().default(false),
    startedAt: at("started_at").notNull(),
    endedAt: at("ended_at").notNull(),
    /** One-minute buckets from its first minute to its last. */
    minutes: integer("minutes").notNull(),
    watchSeconds: bigint("watch_seconds", { mode: "number" }).notNull(),
    audienceAtStart: integer("audience_at_start").notNull(),
    peakAudience: integer("peak_audience").notNull(),
    audienceAtEnd: integer("audience_at_end").notNull(),
    /** Of those there in the first minute, how many were there in the last. */
    stayedToEnd: integer("stayed_to_end").notNull(),
    /** Tune-aways by minute of the airing (index 0 its first minute). */
    tuneAways: integer("tune_aways").array().notNull(),
    notForMe: integer("not_for_me").notNull().default(0),
    /** Worked out for the last time (an hour after it ended): its votes are gone. */
    final: boolean("final").notNull().default(false),
    computedAt: at("computed_at").notNull().defaultNow(),
    createdAt: createdAt()
  },
  (t) => [
    uniqueIndex("airing_stats_key").on(t.airingKey),
    index("airing_stats_station_time").on(t.stationId, t.startedAt),
    index("airing_stats_program_time").on(t.programId, t.startedAt),
    check("airing_stats_counts", sql`${t.minutes} > 0 and ${t.watchSeconds} >= 0 and ${t.audienceAtStart} >= 0 and ${t.peakAudience} >= ${t.audienceAtStart} and ${t.peakAudience} >= ${t.audienceAtEnd} and ${t.stayedToEnd} <= ${t.audienceAtStart} and ${t.notForMe} >= 0`)
  ]
);

// ---- A251 Phase 2 (added 2026-10-06, migration 0055): the desk's analytics totals ----
// Worked out from the per-session rows (`session_minutes`, `sessions`) every ten minutes, and kept
// for good: they name no session, device or person. Every station is in them, external ones too
// (whose minutes `minute_samples` leaves out for billing). Days are the market's (Pacific).

/** Each station's hour: minutes tuned in added up (hours watched × 60), its busiest minute, by platform, sessions started. */
export const stationHours = audience.table(
  "station_hours",
  {
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    hour: at("hour").notNull(),
    tunedMinutes: integer("tuned_minutes").notNull(),
    peak: integer("peak").notNull(),
    phone: integer("phone").notNull().default(0),
    cast: integer("cast").notNull().default(0),
    web: integer("web").notNull().default(0),
    tvApp: integer("tv_app").notNull().default(0),
    mirror: integer("mirror").notNull().default(0),
    sessions: integer("sessions").notNull().default(0)
  },
  (t) => [primaryKey({ columns: [t.stationId, t.hour] }), index("station_hours_hour").on(t.hour)]
);

/** Each station's hour by where its viewers are: `market` is a market's id, or "" for viewers Opencast couldn't place. */
export const stationHourPlaces = audience.table(
  "station_hour_places",
  {
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    hour: at("hour").notNull(),
    market: text("market").notNull(),
    tunedMinutes: integer("tuned_minutes").notNull()
  },
  (t) => [primaryKey({ columns: [t.stationId, t.hour, t.market] })]
);

/**
 * The network's hour, for each filter the desk has: `scope` is "<band>|<market>" (band "all", "tv"
 * or "radio"; market "all" or the stations' market's id). Its busiest minute can't be added up
 * from stations', so it's kept here.
 */
export const networkHours = audience.table(
  "network_hours",
  {
    scope: text("scope").notNull(),
    hour: at("hour").notNull(),
    tunedMinutes: integer("tuned_minutes").notNull(),
    peak: integer("peak").notNull(),
    /** The busiest minute itself. */
    peakAt: at("peak_at")
  },
  (t) => [primaryKey({ columns: [t.scope, t.hour] })]
);

/**
 * A station's day: sessions counted (and how long they lasted, by bucket), sessions filtered as bots
 * (by reason), how they were tuned, press to picture (median and 90th percentile).
 */
export const stationDays = audience.table(
  "station_days",
  {
    day: date("day").notNull(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    sessions: integer("sessions").notNull(),
    /** Session lengths, minutes: { "under_5", "5_15", "15_30", "30_60", "60_120", "120_plus" }. */
    lengths: jsonb("lengths").$type<Record<string, number>>().notNull(),
    medianMinutes: integer("median_minutes"),
    bots: integer("bots").notNull().default(0),
    botReasons: jsonb("bot_reasons").$type<Record<string, number>>().notNull(),
    via: jsonb("via").$type<Record<string, number>>().notNull(),
    tuneMsMedian: integer("tune_ms_median"),
    tuneMsP90: integer("tune_ms_p90"),
    computedAt: at("computed_at").notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.day, t.stationId] })]
);

/**
 * Devices, counted once each (from the hash on sessions, before they go at 30 days). `scope` is
 * "station:<id>", or "<band>|<market>" as on `network_hours`. `devices` that day, `devices7` and
 * `devices30` the 7 and 30 days to it, `returning` that day's devices seen in the 30 days before.
 */
export const deviceDays = audience.table(
  "device_days",
  {
    day: date("day").notNull(),
    scope: text("scope").notNull(),
    devices: integer("devices").notNull(),
    devices7: integer("devices_7").notNull(),
    devices30: integer("devices_30").notNull(),
    returning: integer("returning").notNull()
  },
  (t) => [primaryKey({ columns: [t.day, t.scope] })]
);

/**
 * Moving around the dial: changes from one station to another in a day, from a visit's minutes in a
 * row. `fromStation` "" is a visit starting there ("Started here"), `toStation` "" one ending there ("Stopped").
 */
export const stationFlows = audience.table(
  "station_flows",
  {
    day: date("day").notNull(),
    fromStation: text("from_station").notNull(),
    toStation: text("to_station").notNull(),
    changes: integer("changes").notNull()
  },
  (t) => [primaryKey({ columns: [t.day, t.fromStation, t.toStation] })]
);
