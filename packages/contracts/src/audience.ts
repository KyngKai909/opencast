import { z } from "zod";
import { endpoint } from "./core.js";
import { Id, Platform, Timestamp } from "./common.js";

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
  byPlatform: z.object({ phone: z.number().int(), cast: z.number().int(), web: z.number().int(), tv_app: z.number().int() }),
  stayedToTheEnd: z.array(z.object({ programId: Id, title: z.string(), percent: z.number() })),
  /** Viewers on YouTube and Twitch relays: shown apart, never billed. */
  translators: z.array(z.object({ translatorId: Id, name: z.string(), viewers: z.number().int() }))
});

export const audienceApi = {
  heartbeat: endpoint({
    method: "POST",
    path: "/heartbeat",
    auth: "public",
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
