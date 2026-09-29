import { z } from "zod";
import { endpoint } from "./core.js";
import { Id, Platform, StationIdent, Timestamp } from "./common.js";

export const Heartbeat = z.object({
  stationId: Id,
  /** A random id the player keeps for the session. */
  sessionId: Id,
  platform: Platform,
  /** Media time in ms, so sessions with no progress don't count. */
  mediaTimeMs: z.number().int().nonnegative(),
  playing: z.boolean()
});

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
        onNow: z.boolean()
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
    response: z.object({ ok: z.literal(true), nextInMs: z.number().int() })
  }),
  getAudience: endpoint({
    method: "GET",
    path: "/stations/:stationId/audience",
    auth: "user",
    summary: "The station's own numbers (never shown to viewers)",
    params: z.object({ stationId: Id }),
    query: z.object({ from: Timestamp, to: Timestamp }),
    response: AudienceReport
  })
};

export type Heartbeat = z.infer<typeof Heartbeat>;
export type AudienceReport = z.infer<typeof AudienceReport>;
