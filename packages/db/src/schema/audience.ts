import { boolean, index, integer, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { at, id } from "./columns.js";
import { audience } from "./namespaces.js";
import { stations, translators } from "./broadcast.js";

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
