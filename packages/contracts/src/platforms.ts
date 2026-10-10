// Platform connections (added 2026-09-30, follow-up Phase 3): where a station's translators relay.
// YouTube and Twitch connect by signing in (OAuth), so Opencast can start broadcasts, read the
// stream key and read the viewers each platform reports; anything else (Facebook, Kick, any RTMP or
// RTMPS address) is added by hand with its address and stream key. Stream keys and sign-in tokens
// are encrypted at rest and never returned: a connection says only whether it has one.
//
// Relay viewers (the viewers YouTube and Twitch report) are counted every minute for connected
// accounts and billed for per-thousand spots: online businesses on Opencast viewers plus relay
// viewers; local businesses only for relay viewers the platform places inside their area (YouTube's
// viewer geography; Twitch never). Their lines are here, used by results, statements and earnings.
//
// The seam with the relay service (`PlatformsSeam`, `RelayDestination`) is defined in relay.ts; the
// platforms module implements it as `services.platforms`.

import { z } from "zod";
import { endpoint } from "./core.js";
import { Id, Micros, Ok, Timestamp } from "./common.js";

/** What a destination is. `custom`: any other RTMP or RTMPS address. */
export const PlatformKind = z.enum(["youtube", "twitch", "facebook", "kick", "custom"]);
export type PlatformKind = z.infer<typeof PlatformKind>;

/** The platforms that connect by signing in. Facebook by sign-in is Open (docs/open-decisions.md): it's added by hand for now. */
export const OAuthProvider = z.enum(["youtube", "twitch"]);
export type OAuthProvider = z.infer<typeof OAuthProvider>;

/** Platforms whose viewer numbers Opencast reads (when connected by signing in). */
export const COUNTED_PLATFORMS = ["youtube", "twitch"] as const;
export const CountedPlatform = z.enum(COUNTED_PLATFORMS);
export type CountedPlatform = z.infer<typeof CountedPlatform>;

/** "YouTube", "Twitch", "Facebook", "Kick", "Custom". */
export const PLATFORM_NAMES: Record<PlatformKind, string> = { youtube: "YouTube", twitch: "Twitch", facebook: "Facebook", kick: "Kick", custom: "Custom" };

/** A relay destination, as master control's Translators page shows it. The stream key and tokens are never returned. */
export const PlatformConnection = z.object({
  id: Id,
  kind: PlatformKind,
  /** `signed_in` (YouTube, Twitch by OAuth) or `manual` (an address and key pasted in). */
  method: z.enum(["signed_in", "manual"]),
  /** What the station called it, or the channel's name ("Inland Beat channel"). */
  name: z.string(),
  /** The account it's signed in as ("inlandbeat"); null for manual destinations. */
  account: z.string().nullable(),
  /** Where the relay sends (the platform's ingest address for signed-in ones). */
  rtmpUrl: z.string(),
  /** Never the key itself: only whether one is set. */
  hasStreamKey: z.boolean(),
  /**
   * `connected`; `needs_sign_in` (the platform refused its token: sign in again; the relay skips it
   * until then). Manual destinations are always `connected`.
   */
  status: z.enum(["connected", "needs_sign_in"]),
  /** Opencast reads its viewer numbers (signed-in YouTube and Twitch). Manual destinations can't be counted. */
  countsViewers: z.boolean(),
  /** The platform says where viewers are (YouTube's viewer geography), so local businesses can be billed for them. */
  reportsLocation: z.boolean(),
  /** Paid promotion is marked for you (signed-in YouTube and Twitch), or you're reminded to mark it (everything else). */
  paidPromotion: z.enum(["automatic", "remind"]),
  /** Marked as containing paid promotion right now (automatic ones), or when the station was last reminded (the rest). */
  paidPromotionOn: z.boolean(),
  /** The broadcast Opencast started on it (YouTube), with its title; null otherwise. */
  broadcast: z.object({ id: z.string(), title: z.string(), url: z.string().nullable() }).nullable(),
  /** The last viewer count it reported, and when; null if never counted. */
  lastViewers: z.object({ viewers: z.number().int(), at: Timestamp }).nullable(),
  connectedAt: Timestamp
});
export type PlatformConnection = z.infer<typeof PlatformConnection>;

export const PlatformList = z.object({
  platforms: z.array(PlatformConnection),
  /** Whether signing in to each is set up on this server (its client ID and secret). False: add it by hand. */
  signIn: z.object({ youtube: z.boolean(), twitch: z.boolean(), facebook: z.boolean() }),
  /** Whether stream keys can be stored here (PLATFORM_SECRETS_KEY is set, or this isn't production). */
  canStoreKeys: z.boolean()
});
export type PlatformList = z.infer<typeof PlatformList>;

export const AddManualPlatform = z.object({
  kind: PlatformKind,
  name: z.string().trim().min(1).max(80),
  rtmpUrl: z.string().trim().regex(/^rtmps?:\/\/[^\s/]+/i, "An rtmp:// or rtmps:// address"),
  streamKey: z.string().trim().min(1).max(512)
});
export type AddManualPlatform = z.infer<typeof AddManualPlatform>;

// ---- Relay viewers on results, statements and earnings ----

/** "Relay viewers, as reported by YouTube". */
export const relayViewersLabel = (platform: CountedPlatform) => `Relay viewers, as reported by ${PLATFORM_NAMES[platform]}`;
/** "Relay viewers, waiting for YouTube's location data". */
export const relayWaitingLabel = (platform: CountedPlatform) => `Relay viewers, waiting for ${PLATFORM_NAMES[platform]}'s location data`;

/**
 * Where one airing's relay part stands on one platform:
 * - `counting`: waiting for the platform's viewer numbers (a few minutes after it aired);
 * - `waiting_location`: a local business, waiting for YouTube's location data (a day or two);
 * - `settled`: billed (possibly $0.00 when nobody was inside the area);
 * - `not_billed`: nothing to bill: Twitch for a local business (Twitch doesn't say where viewers
 *   are), YouTube with no location data (below its privacy thresholds), or no relay viewers;
 * - `returned`: no location data arrived in time (relays.location_wait, 7 days): not charged, and
 *   what was held went back to the balance.
 */
export const RelayPartStatus = z.enum(["counting", "waiting_location", "settled", "not_billed", "returned"]);
export type RelayPartStatus = z.infer<typeof RelayPartStatus>;

/** One airing's relay viewers on one platform (a business's results). */
export const RelayViewersPart = z.object({
  platform: CountedPlatform,
  /** "Relay viewers, as reported by YouTube", or while waiting "Relay viewers, waiting for YouTube's location data". */
  label: z.string(),
  status: RelayPartStatus,
  /** Why it isn't billed ("Twitch doesn't report where viewers are"); null otherwise. */
  reason: z.string().nullable(),
  /** Concurrent viewers the platform reported, averaged over the spot; null until counted. */
  viewers: z.number().nullable(),
  /** Of those, the share YouTube places inside your area (local businesses); null for online businesses and until known. */
  shareInArea: z.number().min(0).max(1).nullable(),
  /** The viewers billed; null until known. */
  billedViewers: z.number().nullable(),
  costMicros: Micros,
  /** Still held for it while it waits. */
  heldMicros: Micros,
  /** Returned to the balance because no location data came in time (`returned`). */
  returnedMicros: Micros.optional(),
  /** "40 × 62% in your area × $8.00 ÷ 1,000 = $0.20"; null until known. */
  working: z.string().nullable()
});
export type RelayViewersPart = z.infer<typeof RelayViewersPart>;

/** A period's relay viewers on one platform, added up (results, statements, earnings). */
export const RelayViewersLine = z.object({
  platform: CountedPlatform,
  /** "Relay viewers, as reported by YouTube". */
  label: z.string(),
  airings: z.number().int(),
  /** Reported viewers, added up across airings (never reach). */
  viewersAddedUp: z.number().int(),
  billedViewersAddedUp: z.number().int(),
  spentMicros: Micros,
  /** Held while waiting for the platform's location data ("Relay viewers, waiting for YouTube's location data"). */
  waitingMicros: Micros,
  waitingAirings: z.number().int(),
  /** Returned to the balance because no location data came in time. */
  returnedMicros: Micros
});
export type RelayViewersLine = z.infer<typeof RelayViewersLine>;

// ---- Other apps viewers on results and statements (added 2026-10-10, programming Phase 5, P5.1) ----

/** "Other apps": viewers tuned from Opencast's channel list in TiviMate, Jellyfin, Channels DVR, Kodi or VLC. */
export const OTHER_APPS_LABEL = "Other apps";

/**
 * Where one airing's Other apps part stands:
 * - `counting`: waiting for the playlist polls after the spot (a couple of minutes after it aired);
 * - `settled`: billed;
 * - `not_billed`: nobody watched through it in another app, or (local businesses) nobody placed
 *   inside the area did.
 */
export const OtherAppsPartStatus = z.enum(["counting", "settled", "not_billed"]);
export type OtherAppsPartStatus = z.infer<typeof OtherAppsPartStatus>;

/** One airing's Other apps viewers (a business's results). */
export const OtherAppsPart = z.object({
  /** "Other apps". */
  label: z.string(),
  status: OtherAppsPartStatus,
  /** Why it isn't billed ("Nobody watched through the spot in another app"); null otherwise. */
  reason: z.string().nullable(),
  /** Sessions in other apps that watched through the spot (one per connection); null until counted. */
  sessions: z.number().int().nullable(),
  /** Of those, the ones billed (local businesses: placed inside your area); null until counted. */
  billedSessions: z.number().int().nullable(),
  costMicros: Micros,
  /** Still held for it while it counts. */
  heldMicros: Micros,
  /** "3 × $8.00 ÷ 1,000 = $0.02"; null until counted. */
  working: z.string().nullable()
});
export type OtherAppsPart = z.infer<typeof OtherAppsPart>;

/** A period's Other apps viewers, added up (results). */
export const OtherAppsLine = z.object({
  /** "Other apps". */
  label: z.string(),
  airings: z.number().int(),
  /** Sessions that watched through the spots, added up across airings (never reach). */
  sessionsAddedUp: z.number().int(),
  billedSessionsAddedUp: z.number().int(),
  spentMicros: Micros,
  /** Held while the polls after a spot come in. */
  waitingMicros: Micros,
  waitingAirings: z.number().int()
});
export type OtherAppsLine = z.infer<typeof OtherAppsLine>;

// ---- Endpoints ----

const StationParams = z.object({ stationId: Id });

export const platformsApi = {
  listPlatforms: endpoint({
    method: "GET",
    path: "/stations/:stationId/platforms",
    auth: "user",
    summary: "The station's relay destinations: YouTube and Twitch signed in, anything else by address and key (owner, operator)",
    params: StationParams,
    response: PlatformList
  }),
  startPlatformSignIn: endpoint({
    method: "POST",
    path: "/stations/:stationId/platforms/oauth/:provider/start",
    auth: "user",
    summary:
      "Where to send the owner to sign in to YouTube or Twitch. The platform returns to /v1/platforms/oauth/:provider/callback, which connects it and goes back to master control's Translators page (owner)",
    params: z.object({ stationId: Id, provider: OAuthProvider }),
    body: z.object({
      /** A master control path to come back to (`/control/…`); by default the station's Translators page. */
      returnTo: z.string().regex(/^\/control\//).max(300).optional()
    }),
    response: z.object({ url: z.string() })
  }),
  addManualPlatform: endpoint({
    method: "POST",
    path: "/stations/:stationId/platforms",
    auth: "user",
    summary: "Add any destination by its RTMP or RTMPS address and stream key. Its viewers can't be counted (owner)",
    params: StationParams,
    body: AddManualPlatform,
    response: PlatformConnection,
    status: 201
  }),
  removePlatform: endpoint({
    method: "DELETE",
    path: "/stations/:stationId/platforms/:platformId",
    auth: "user",
    summary: "Remove a destination in one click: its key and tokens are erased, and signed-in tokens revoked where the platform allows (owner)",
    params: z.object({ stationId: Id, platformId: Id }),
    response: Ok
  })
} as const;

/** The sign-in callback: not JSON, a redirect back to master control (`?platform=youtube&connected=1` or `&error=…`). */
export const PLATFORM_OAUTH_CALLBACK_PATH = "/platforms/oauth/:provider/callback";
