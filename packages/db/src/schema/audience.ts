import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, createdAt, id } from "./columns.js";
import { audience } from "./namespaces.js";
import { asRun, programs, stations, translators } from "./broadcast.js";

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
    flagReason: text("flag_reason")
  },
  (t) => [index("sessions_station_beat").on(t.stationId, t.lastBeatAt)]
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
