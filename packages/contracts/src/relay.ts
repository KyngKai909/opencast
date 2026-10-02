// Relays (added 2026-09-30, follow-up Phase 3): how a station's translators simulcast it, set once
// for all of its relays. Master control's Translators page (A4) reads and changes it here; the
// platforms it relays to are connected in platforms.ts.
//
// - "Live shows only" (`live_only`, the default, free): only live blocks go out. A TV station's live
//   Livepeer stream sends them to every connected platform with Livepeer's multistream (no relay
//   service); a radio station's live blocks come in through the worker's own ingest, so the relay
//   service relays just the live block (still free).
// - "Everything I air" (`everything`, pay as you go, per hour relayed, per station however many
//   platforms): the whole schedule, prerecorded and live, as one continuous stream from the relay
//   service (apps/relay) to a per-station Livepeer relay stream with no transcoding, which Livepeer
//   sends on to every connected platform.
//
// One break setting for every relay ("During breaks, relays show: Your spots / Station ID slate");
// time filled by ads from partners always shows the slate. Platform limits (rules registry,
// `relays.platform_limits`) restart one platform at a time, during the station ID in a break.
//
// The seam with the platforms module (`PlatformsSeam`) is defined here: the relay reads a station's
// destinations (keys decrypted in memory only), and asks connected accounts for their next broadcast.

import { z } from "zod";
import { endpoint } from "./core.js";
import { Id, Micros, Ok, Timestamp } from "./common.js";

export const RelayMode = z.enum(["live_only", "everything"]);
export type RelayMode = z.infer<typeof RelayMode>;

/** "During breaks, relays show": your spots, or the station ID slate. The same names as a translator's old `breakHandling`. */
export const RelayBreakHandling = z.enum(["air_spots", "station_id_slate"]);
export type RelayBreakHandling = z.infer<typeof RelayBreakHandling>;

/** What a relay destination is. `custom`: any other RTMP or RTMPS address. (platforms.ts's `PlatformKind`.) */
export const RelayPlatformKind = z.enum(["youtube", "twitch", "facebook", "kick", "custom"]);
export type RelayPlatformKind = z.infer<typeof RelayPlatformKind>;

// ---- The seam with the platforms module ----

/** One place a station relays to, with its key (in memory only: never logged, never returned by the API). */
export interface RelayDestination {
  /** The platforms module's ID for it. */
  platformId: string;
  kind: RelayPlatformKind;
  /** What the station calls it, for notices ("Inland Beat channel"). Optional. */
  name?: string;
  rtmpUrl: string;
  streamKey: string;
  /** Connected by signing in (Opencast can start broadcasts, mark paid promotion, read viewers). False: a pasted key. */
  connected: boolean;
  /** This destination's broadcast length limit in hours, when the platforms module knows better than the rules registry. */
  limitHours?: number | null;
}

/** A connected account's next broadcast: where to push to it (often the same address and key). */
export interface NextBroadcast {
  rtmpUrl: string;
  streamKey: string;
  /** The platform's ID for the new broadcast, handed back to `endBroadcast` when it rolls again. */
  broadcastId?: string | null;
}

/**
 * What the relay needs from the platforms module (added 2026-09-30). The platforms module
 * implements it as `services.platforms`; until it's there the relay reads the station's old
 * translators (every one a pasted key). Tests stub it.
 */
export interface PlatformsSeam {
  /** Every destination the station relays to now, enabled and with a key. */
  destinationsFor(stationId: string): Promise<RelayDestination[]>;
  /**
   * Connected accounts only: makes the next broadcast (carrying over the title and description)
   * before the current one ends, so viewers land on the new one. Null: nothing to do (the platform
   * starts a new broadcast by itself when the stream reconnects).
   */
  prepareNextBroadcast(platformId: string): Promise<NextBroadcast | null>;
  /** Connected accounts only: ends a broadcast (the one before the one just prepared, when `broadcastId` is null). */
  endBroadcast(platformId: string, broadcastId?: string | null): Promise<void>;
  /**
   * Marks the current broadcast as containing paid promotion (YouTube; Twitch's branded content,
   * if its API allows). `applied: false`: the platform can't (the station is reminded instead).
   */
  setPaidPromotion(platformId: string, on: boolean): Promise<{ applied: boolean }>;
}

// ---- What the Translators page shows ----

/** A restart for a platform's limit, planned or done. */
export const RelayRestart = z.object({
  id: Id,
  platformId: z.string(),
  kind: RelayPlatformKind,
  /** `limit`: the platform caps one broadcast (Twitch 48 hours); `save_video`: YouTube saves only broadcasts under 12 hours. */
  reason: z.enum(["limit", "save_video"]),
  /**
   * `scheduled`; `done`; `failed`; `due` (the station has to restart it itself: a pasted key the
   * platform can't restart on its own, like Facebook's); `cancelled`.
   */
  status: z.enum(["scheduled", "done", "failed", "due", "cancelled"]),
  at: Timestamp,
  /** The broadcast's limit: the restart is always before it. */
  deadline: Timestamp,
  /** Timed to the station ID in a break (false only when no break fell inside the limit). */
  duringBreak: z.boolean(),
  /** Done by Opencast (false: the station is told when it's due). */
  automatic: z.boolean(),
  /** "Twitch restarts Saturday at 11:59 pm, during a break", in the station's time zone. */
  label: z.string(),
  doneAt: Timestamp.nullable()
});
export type RelayRestart = z.infer<typeof RelayRestart>;

/** One platform as the relay sees it (its connection itself is in platforms.ts). */
export const RelayPlatformState = z.object({
  platformId: z.string(),
  kind: RelayPlatformKind,
  name: z.string(),
  connected: z.boolean(),
  /** `relaying` now; `idle` (nothing to relay: "Live shows only" between live blocks, or off air); `restarting`. */
  status: z.enum(["relaying", "idle", "restarting"]),
  /** When the broadcast on it began (what its limit counts from); null when idle. */
  broadcastStartedAt: Timestamp.nullable(),
  nextRestart: RelayRestart.nullable(),
  /**
   * Paid promotion. `marked`: Opencast marked this broadcast (connected YouTube or Twitch).
   * `remind`: spots aired on a destination Opencast can't mark: the page asks the station to mark
   * it there, until it's dismissed. Null: no spots have aired on it.
   */
  paidPromotion: z.enum(["marked", "remind"]).nullable()
});
export type RelayPlatformState = z.infer<typeof RelayPlatformState>;

export const RelaySettings = z.object({
  mode: RelayMode,
  /** "During breaks, relays show". */
  breakHandling: RelayBreakHandling,
  /** "Station bug on relays": on by default. Off, the relay stream-copies with nothing re-encoded. */
  bugOnRelays: z.boolean(),
  /** "Save relays as YouTube videos": off by default; on, YouTube broadcasts roll about every 11 hours. */
  saveYoutubeVideos: z.boolean()
});
export type RelaySettings = z.infer<typeof RelaySettings>;

export const RelayView = RelaySettings.extend({
  stationId: Id,
  /**
   * `off` (nothing connected, or nothing to relay now); `relaying`; `stopped` (the relay failed:
   * the station and Network desk were told; Opencast's own channel is never affected);
   * `paused` ("Everything I air" paused by its cap or an unpaid bill: live shows still go out).
   */
  status: z.enum(["off", "relaying", "stopped", "paused"]),
  pausedBecause: z.enum(["cap", "unpaid"]).nullable(),
  /** "Relayed this month", from the Station account (pay-as-you-go): relays of everything, per hour, per station. */
  month: z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    hours: z.number(),
    soFarMicros: Micros,
    estimateMicros: Micros,
    /** Per hour now; null: not set yet (nothing is charged). */
    priceMicros: Micros.nullable(),
    capMicros: Micros.nullable(),
    /** Hours relayed in "Live shows only" this month (free). */
    liveOnlyHours: z.number()
  }),
  platforms: z.array(RelayPlatformState),
  /** The next restart per platform, soonest first. */
  nextRestarts: z.array(RelayRestart),
  /** Restarts done lately (the log), newest first. */
  recentRestarts: z.array(RelayRestart),
  /** Who can change it: owners and operators. */
  canManage: z.boolean()
});
export type RelayView = z.infer<typeof RelayView>;

const StationParams = z.object({ stationId: Id });

export const relayApi = {
  getRelay: endpoint({
    method: "GET",
    path: "/stations/:stationId/relay",
    auth: "user",
    summary: "The station's relays: mode, what breaks show, the station bug, hours and cost this month, each platform's next restart (owners, operators)",
    params: StationParams,
    response: RelayView
  }),
  updateRelay: endpoint({
    method: "PATCH",
    path: "/stations/:stationId/relay",
    auth: "user",
    summary: "Change the relay mode, what breaks show, the station bug on relays, or saving YouTube videos (owners, operators)",
    params: StationParams,
    body: RelaySettings.partial(),
    response: RelayView
  }),
  listRelayRestarts: endpoint({
    method: "GET",
    path: "/stations/:stationId/relay/restarts",
    auth: "user",
    summary: "Every restart for platform limits, latest first: planned, done, failed, or due for the station to do",
    params: StationParams,
    query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
    response: z.array(RelayRestart)
  }),
  dismissPaidPromotionReminder: endpoint({
    method: "POST",
    path: "/stations/:stationId/relay/platforms/:platformId/paid-promotion-reminder/dismiss",
    auth: "user",
    summary: "The station marked paid promotion on a destination Opencast can't mark: stop reminding it for this broadcast",
    params: z.object({ stationId: Id, platformId: z.string().min(1) }),
    response: Ok
  })
};

// ---- The relay service's health endpoint (apps/relay, GET /health) ----

export const RelayHealth = z.object({
  ok: z.boolean(),
  service: z.literal("opencast-relay"),
  instance: z.string(),
  /** Leading (it relays) or waiting (another instance holds the lease). */
  leader: z.boolean(),
  /** `livepeer` (one push per station, split by Livepeer) or `direct` (the relay pushes to each platform). */
  fanOut: z.enum(["livepeer", "direct"]),
  stations: z.array(
    z.object({
      stationId: Id,
      callSign: z.string().nullable(),
      mode: RelayMode,
      status: z.enum(["relaying", "stopped", "starting"]),
      /** `copy` (stream-copied) or `composite` (the bug drawn in). */
      picture: z.enum(["copy", "composite"]),
      platforms: z.number().int(),
      /** Hours relayed since this instance started. */
      relayHours: z.number(),
      /** Bytes sent (egress) since this instance started, and the rate over the last minute. */
      bytesSent: z.number(),
      kbps: z.number(),
      errors: z.number().int(),
      lastError: z.string().nullable(),
      since: Timestamp
    })
  ),
  at: Timestamp
});
export type RelayHealth = z.infer<typeof RelayHealth>;
