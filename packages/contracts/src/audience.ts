import { z } from "zod";
import { endpoint } from "./core.js";
import { Id, Platform, StationIdent, Timestamp } from "./common.js";

/**
 * Added 2026-10-06 (A251, the desk's analytics): how a channel was tuned. `swipe` (the phone's
 * swipe home), `channel` (channel up or down), `keypad` (a number), `guide`, `search`, `link` (a
 * shared or typed address), `preset`, `last` (last channel), `remote` (a phone remote or Cast
 * sender), `reminder`, `resume` (the app's first channel), `dial` (a station picked from a list),
 * `suggestion` (one offered on screen, as Stand by's "on now").
 */
export const TuneVia = z.enum(["swipe", "channel", "keypad", "guide", "search", "link", "preset", "last", "remote", "reminder", "resume", "dial", "suggestion"]);
export type TuneVia = z.infer<typeof TuneVia>;

export const Heartbeat = z.object({
  stationId: Id,
  /**
   * A random id the player keeps for the tab (or the TV app's run). Changed 2026-10-06 (A251): a
   * session is one station's, and the API makes a session of its own for each station the same id
   * beats for (before, a beat for a second station was refused and never counted).
   */
  sessionId: Id,
  platform: Platform,
  /** Media time in ms, so sessions with no progress don't count. */
  mediaTimeMs: z.number().int().nonnegative(),
  playing: z.boolean(),
  /**
   * Added 2026-10-06 (A251), optional: a random id the player keeps on the device (not the person,
   * never tied to an account), for counts of devices. The API keeps a hash of it with the session
   * (30 days); after that only counts.
   */
  deviceId: Id.optional(),
  /** Added 2026-10-06 (A251), optional, the station's first beat only: how it was tuned. */
  via: TuneVia.optional(),
  /** Added 2026-10-06 (A251), optional, the first beat only: ms from the press to the first picture. */
  tuneMs: z.number().int().nonnegative().max(600_000).optional()
});

// ---- Watch data (added 2026-09-29, follow-up Phase 1) ----

/** TV counts watch time; the radio band counts listening time, the same way. */
export const WatchTimeLabel = z.enum(["watch_time", "listening_time"]);
export type WatchTimeLabel = z.infer<typeof WatchTimeLabel>;

/**
 * Whether numbers are shown: `shown`; `not_enough_viewers` (under the rules registry's
 * `watch_data.minimum_audience`, 20 viewers at once at some point; stored all the same, and every
 * number is null); `counting` (on now, or ended and not worked out yet: within ten minutes or so).
 */
export const WatchStatus = z.enum(["shown", "not_enough_viewers", "counting"]);
export type WatchStatus = z.infer<typeof WatchStatus>;

/** "Not enough viewers yet", as the API words it, for `not_enough_viewers`. */
export const NOT_ENOUGH_VIEWERS = "Not enough viewers yet";

/**
 * Per airing of a program (a log entry's program rows in the station's as-run log), from the
 * tuned-in sessions after bot filtering. Numbers are null unless `status` is `shown`.
 */
export const AiringWatch = z.object({
  status: WatchStatus,
  /** "Not enough viewers yet" when there aren't; null otherwise. */
  note: z.string().nullable(),
  timeLabel: WatchTimeLabel,
  /** Minutes watched (listened) in all, to a tenth: each viewer's minutes while the program was on, breaks inside it not counted. */
  watchMinutes: z.number().nullable(),
  /** Viewers at once in its first minute, its busiest minute and its last minute. */
  audienceAtStart: z.number().int().nullable(),
  peakAudience: z.number().int().nullable(),
  audienceAtEnd: z.number().int().nullable(),
  /** Percent of those there in its first minute still there in its last (null with nobody at the start). */
  stayedToTheEnd: z.number().int().nullable(),
  /**
   * Viewers who changed channel or stopped, by the minute of the program they left in: index 0 is
   * its first minute (always 0), one entry per minute to its last.
   */
  tuneAways: z.array(z.number().int()).nullable(),
  /** "Not for me" votes that counted: one per viewer, from viewers who watched at least 2 minutes of it. */
  notForMe: z.number().int().nullable()
});
export type AiringWatch = z.infer<typeof AiringWatch>;

/**
 * A maker's program across every station that aired it (its own and its carriers), added up: never
 * a station's audience per airing. One row per program and band (a TV program carried audio-only
 * on the radio band has a listening-time row too). Other stations' airings count only together:
 * at least `carriedAirings` of them (2) reaching the minimum audience between them; until then
 * they're left out (`notCounted`). The totals show once the airings in them reach the minimum
 * together (the sum of each airing's busiest minute).
 */
export const MakerProgramWatch = z.object({
  programId: Id,
  title: z.string(),
  band: z.enum(["tv", "radio"]),
  timeLabel: WatchTimeLabel,
  status: z.enum(["shown", "not_enough_viewers"]),
  note: z.string().nullable(),
  /** Stations and airings in the totals (0 while `not_enough_viewers`). */
  stations: z.number().int(),
  airings: z.number().int(),
  /** Other stations' airings not in the totals yet: too few, or too few viewers between them. */
  notCounted: z.object({ airings: z.number().int() }),
  totals: z
    .object({
      watchMinutes: z.number(),
      /** Each airing's first-minute, busiest-minute and last-minute audience, added up. */
      audienceAtStart: z.number().int(),
      combinedPeak: z.number().int(),
      audienceAtEnd: z.number().int(),
      /** Percent of everyone there at an airing's start still there at its end. */
      stayedToTheEnd: z.number().int().nullable(),
      /** By minute of the program, every airing's tune-aways added up (as long as its longest airing). */
      tuneAways: z.array(z.number().int()),
      notForMe: z.number().int()
    })
    .nullable()
});
export type MakerProgramWatch = z.infer<typeof MakerProgramWatch>;

export const MakerWatchData = z.object({
  from: Timestamp,
  to: Timestamp,
  /** Programs with an airing in the window, by title. */
  programs: z.array(MakerProgramWatch)
});
export type MakerWatchData = z.infer<typeof MakerWatchData>;

export const NotForMeVote = z.object({
  /** The player's session (the one its heartbeats carry). A signed-out vote is tied to it; so is a signed-in one: the person is never stored. */
  sessionId: Id
});
export type NotForMeVote = z.infer<typeof NotForMeVote>;

export const AudienceReport = z.object({
  tunedInNow: z.number().int(),
  peak: z.object({ tunedIn: z.number().int(), at: Timestamp }).nullable(),
  hoursWatched: z.number(),
  presetCount: z.number().int(),
  /** Per minute; breaks shaded; with a comparison line (same window last week). */
  series: z.array(z.object({ minute: Timestamp, tunedIn: z.number().int(), lastWeek: z.number().int().nullable(), inBreak: z.boolean() })),
  byPlatform: z.object({
    phone: z.number().int(),
    cast: z.number().int(),
    web: z.number().int(),
    tv_app: z.number().int(),
    /** The iPhone's second screen (added 2026-09-28; always sent now). */
    mirror: z.number().int().optional()
  }),
  stayedToTheEnd: z.array(z.object({ programId: Id, title: z.string(), percent: z.number() })),
  /** Viewers on YouTube and Twitch relays: shown apart, never billed. */
  translators: z.array(z.object({ translatorId: Id, name: z.string(), viewers: z.number().int() })),
  // ---- Added 2026-09-29 ----
  /**
   * U1: by program, one row per airing in the window that has started, newest first: when it
   * aired (its start on the log), where it came from, the average and peak tuned in over it (to
   * now, while it's on), and the percent still there at its last minute against its first (null
   * while it's on, or with no one at its first minute).
   */
  byProgram: z
    .array(
      z.object({
        key: z.string(),
        programId: Id.nullable(),
        title: z.string(),
        airedAt: Timestamp.nullable(),
        airings: z.number().int(),
        source: z.enum(["library", "carried", "live"]),
        carriedFrom: StationIdent.nullable(),
        averageTunedIn: z.number().int(),
        peakTunedIn: z.number().int(),
        stayedToTheEnd: z.number().nullable(),
        onNow: z.boolean(),
        /** Watch data (added 2026-09-29, follow-up Phase 1): this airing's watch time, audience and tune-aways. */
        watch: AiringWatch.optional()
      })
    )
    .optional(),
  /** U3: the same window a week earlier, minute by minute, past now too. */
  comparison: z.array(z.object({ minute: Timestamp, tunedIn: z.number().int() })).optional(),
  /** U3: every break in the window, for the shaded bands. */
  breaks: z.array(z.object({ startsAt: Timestamp, endsAt: Timestamp })).optional()
});

export const audienceApi = {
  heartbeat: endpoint({
    method: "POST",
    path: "/heartbeat",
    /**
     * `optional` since 2026-09-28 (was `public`; anyone can still call it). Sent signed in (a Privy
     * token, or a TV session), it also keeps the person's watch history (A2) when their
     * keepWatchHistory setting is on. The tuned-in session itself stays anonymous: it's never
     * linked to the person.
     */
    auth: "optional",
    tvSession: true,
    summary: "Players send this every 30 seconds while tuned in",
    body: Heartbeat,
    /**
     * Added 2026-09-29: during the station's planned off air time the beat isn't counted (nor kept
     * in watch history), `offAirUntil` says when it's back, and `nextInMs` runs until then.
     */
    response: z.object({ ok: z.literal(true), nextInMs: z.number().int(), offAirUntil: Timestamp.optional() })
  }),
  getAudience: endpoint({
    method: "GET",
    path: "/stations/:stationId/audience",
    auth: "user",
    summary: "The station's own numbers (never shown to viewers)",
    params: z.object({ stationId: Id }),
    query: z.object({ from: Timestamp, to: Timestamp }),
    response: AudienceReport
  }),
  // ---- Added 2026-09-29: watch data (follow-up Phase 1) ----
  programWatchData: endpoint({
    method: "GET",
    path: "/stations/:stationId/programs/watch-data",
    auth: "user",
    summary: "Offering your programs: each of the maker's programs across every station that aired it, added up",
    params: z.object({ stationId: Id }),
    /** Up to a year; airings that started in the window. */
    query: z.object({ from: Timestamp, to: Timestamp }),
    response: MakerWatchData
  }),
  voteNotForMe: endpoint({
    method: "POST",
    path: "/stations/:stationId/not-for-me",
    /** Signed in or not; the vote is tied to the session, never to the person. Taken whether or not `features.notForMe` is on. */
    auth: "optional",
    tvSession: true,
    summary: "A viewer's \"Not for me\" on the program airing now (one per session per airing)",
    params: z.object({ stationId: Id }),
    body: NotForMeVote,
    status: 200,
    /** `already_recorded`: this session has voted on this airing already (nothing changes). */
    response: z.object({ ok: z.literal(true), status: z.enum(["recorded", "already_recorded"]) })
  })
};

export type Heartbeat = z.infer<typeof Heartbeat>;
export type AudienceReport = z.infer<typeof AudienceReport>;
