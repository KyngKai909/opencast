import { z } from "zod";
import { endpoint } from "./core.js";
import {
  Band,
  CallSign,
  ChannelNumber,
  Colour,
  Id,
  LogCode,
  Market,
  Millis,
  Ok,
  StationIdent,
  StationKind,
  Timestamp
} from "./common.js";

/** What's on, as the dial and guide show it. */
export const Airing = z.object({
  logEntryId: Id.nullable(),
  title: z.string(),
  episodeTitle: z.string().nullable(),
  code: LogCode,
  kind: z.enum(["program", "live", "off_air", "listed"]),
  startsAt: Timestamp,
  endsAt: Timestamp,
  live: z.boolean(),
  /** "Carried from REEL 24.1". */
  carriedFrom: StationIdent.nullable(),
  programId: Id.nullable(),
  /** G5 (added 2026-09-29): the airing's own description, else its episode's ("Tonight: a steamboat, a haunted barn…"). */
  episodeDescription: z.string().nullable().optional(),
  /**
   * Added 2026-09-29, on `off_air` airings only: when the station is back ("Off air, back at
   * 6:00 am"). Planned off air (the station's off air hours, or a sign-off on its log) is one
   * airing from sign-off to sign-on, with `logEntryId` the sign-off entry's when there is one.
   */
  backAt: Timestamp.nullable().optional()
});
export type Airing = z.infer<typeof Airing>;

/**
 * Follow-up Phase 6 (added 2026-09-30): how an external station plays. `embed`: the source's own
 * embeddable player, where its terms allow it. `stream_link`: its raw HLS (or DASH) address, played
 * in Opencast's player straight from the source (never proxied, cached or re-served).
 */
export const ExternalPlays = z.enum(["embed", "stream_link"]);
export type ExternalPlays = z.infer<typeof ExternalPlays>;

/**
 * Where an external station's "what's on" comes from: the source's own calendar or schedule feed
 * (`feed`), guide data checked against its published schedule (`guide_data`), or neither (`none`:
 * the banner shows the station, "External", "Live" and the source, with no progress bar).
 */
export const ExternalSchedule = z.enum(["feed", "guide_data", "none"]);
export type ExternalSchedule = z.infer<typeof ExternalSchedule>;

/** Phase 6: what the dial, the banner and the station page say about an external station. */
export const ExternalInfo = z.object({
  /** Whose stream it is: "City of Colton". */
  source: z.string(),
  plays: ExternalPlays,
  schedule: ExternalSchedule
});
export type ExternalInfo = z.infer<typeof ExternalInfo>;

/**
 * Where a station's picture comes from. `kind: "hls"`: Opencast's player plays `url` (a station's
 * channel, or an external station's stream link); `kind: "embed"`: the source's own player.
 *
 * `format` (added 2026-09-30, A201): the stream's format when Opencast's player plays it, `dash`
 * for a DASH stream link (its `url` is the source's `.mpd`); absent means HLS. It's a new optional
 * field rather than a new `kind`, so apps built before it still read the dial (their contracts
 * check `kind` against `hls` and `embed`, and a new value would fail the whole response): they try
 * a DASH row as HLS, which fails, and show Stand by as for any stream link that won't play.
 */
export const Playback = z.object({
  kind: z.enum(["hls", "embed"]),
  url: z.string(),
  format: z.enum(["hls", "dash"]).optional()
});
export type Playback = z.infer<typeof Playback>;

export const DialRow = z.object({
  station: StationIdent,
  /** Lit only when something is actually on air. */
  onAir: z.boolean(),
  now: Airing.nullable(),
  next: Airing.nullable(),
  /** Listed city streams play in the source's own player. A DASH stream link says `format: "dash"` (A201). */
  playback: Playback.nullable(),
  /**
   * S13 (added 2026-09-28): `standby` while a live block is on the stand-by slate waiting for its
   * signal; `ok` otherwise. Absent when the station isn't on air (and from listed city streams).
   */
  signal: z.enum(["ok", "standby"]).optional(),
  /**
   * Added 2026-09-29: while the station is off air on a schedule (its off air hours or a sign-off
   * on its log), when it's back. `now` is then the `off_air` airing and `onAir` is false. Absent otherwise.
   */
  backAt: Timestamp.optional(),
  /**
   * Follow-up Phase 6 (added 2026-09-30), external stations only: whose stream it is, how it plays
   * and where its schedule comes from. An external station is on the dial while its stream is up;
   * `onAir` is true then, with `now` null when nothing is scheduled (never a made-up title).
   */
  external: ExternalInfo.optional()
});

export const Dial = z.object({
  market: Market,
  band: Band,
  /** In channel order, the same every time. */
  rows: z.array(DialRow),
  /** A thin market also shows nearby markets' stations after its own. */
  nearby: z.array(z.object({ market: Market, miles: z.number(), rows: z.array(DialRow) }))
});

export const GuideRow = z.object({ station: StationIdent, airings: z.array(Airing) });

export const StationPage = z.object({
  station: StationIdent,
  description: z.string().nullable(),
  onAir: z.boolean(),
  now: Airing.nullable(),
  upNext: z.array(Airing),
  programs: z.array(z.object({ id: Id, title: z.string(), description: z.string().nullable(), live: z.boolean() })),
  /** Claimable stations: "Run by Opencast for Marcus Reyes, not yet claimed", with the escrow reference. */
  claimable: z
    .object({
      runFor: z.string(),
      claimed: z.boolean(),
      escrowContract: z.string().nullable(),
      escrowStationId: z.number().int()
    })
    .nullable(),
  pledgesTaxDeductible: z.boolean().nullable(),
  playback: Playback.nullable(),
  /**
   * Follow-up Phase 6 (added 2026-09-30), external stations only: as on the dial, and `down` while
   * it's off the dial because its stream is down (the page stays; `playback` is null then).
   */
  external: ExternalInfo.extend({ down: z.boolean() }).optional()
});

export const SearchResult = z.object({
  /** Typing a channel or frequency tunes to it. */
  tuneTo: StationIdent.nullable(),
  stations: z.array(StationIdent),
  airings: z.array(z.object({ station: StationIdent, airing: Airing, listed: z.boolean() }))
});

/** Master control's view of a station's setup. */
export const StationSetup = z.object({
  station: StationIdent,
  description: z.string().nullable(),
  status: z.enum(["setting_up", "on_air", "off_air", "signed_off"]),
  firstSignedOnAt: Timestamp.nullable(),
  /** Call sign, channel, band and market are fixed after first sign-on. */
  fixed: z.boolean(),
  bug: z.object({
    mode: z.enum(["off", "call_sign_and_channel", "logo"]),
    position: z.string(),
    opacity: z.number().int().min(0).max(100)
  }),
  logoUrl: z.string().nullable(),
  category: z.string().nullable(),
  studioLocation: z.object({ latitude: z.number(), longitude: z.number() }).nullable(),
  legalName: z.string().nullable(),
  legalContact: z.string().nullable(),
  pledgesTaxDeductible: z.boolean().nullable(),
  memberCreditStyle: z.enum(["voice", "text"]),
  /** Makes spots to order ("Made for you"). */
  orders: z.object({ takesOrders: z.boolean(), turnaround: z.string().nullable(), fromMicros: z.number().int().nullable() }),
  /** IAB Content Taxonomy 3.0 ids for the station (added 2026-09-28), derived from its category unless set. */
  iabCategories: z.array(z.string()).optional(),
  /**
   * Added 2026-09-30 (A229): the station on X.1 whose call sign this one shares (12.2 sharing 12.1
   * BEAT's), or null. Set with `chooseChannel`'s `shareCallSign`; fixed, like the call sign, after
   * first sign-on.
   */
  sharesCallSignWith: StationIdent.nullable().optional(),
  /** Added 2026-09-30 (A229): the owner's own stations on this one's subchannels that share its call sign. */
  callSignFamily: z.array(StationIdent).optional()
});

/**
 * Added 2026-09-29: how often a part of the break airs. `break`: in every break. `program`: in
 * the break after every program (the break that ends a program's slot). `n_programs`: in the break
 * after every `n` programs (counted from the last break it aired in). `hour`: once an hour, in the
 * first break after the top of the hour (the station's time). `never`: not at all.
 */
export const BreakCadenceEvery = z.enum(["break", "program", "n_programs", "hour", "never"]);
export const BreakCadence = z.object({
  every: BreakCadenceEvery,
  /** With `n_programs`: after every this many programs (2 to 12). */
  n: z.number().int().min(2).max(12).optional()
});
/** The station ID can't be `never`. */
export const StationIdCadence = BreakCadence.extend({ every: BreakCadenceEvery.exclude(["never"]) });

export const BreakRule = z.object({
  mode: z.enum(["after_every_program", "every_n_minutes", "none"]),
  everyMinutes: z.number().int().positive().nullable(),
  lengthMs: Millis,
  /** Spot time per hour; default 3:00. */
  spotMsPerHour: Millis,
  /** Same spot, at most this many times an hour. */
  sameSpotPerHour: z.number().int().min(1),
  /**
   * After SPT. SID is always last when it airs and can't be removed (how often it airs is
   * `cadence.stationId`). The order is what master control shows. Playout airs (changed
   * 2026-09-29) a bumper into the break, the spots (the maker's barter time first), the credit, a
   * bumper out of the break, then the station ID; time none of them takes holds on the station ID
   * slate just before the station ID. `BMP` stands for both bumpers wherever it's put.
   */
  fillOrder: z.array(LogCode),
  openTimeTo: z.enum(["spot_market", "station_id_and_bumpers"]),
  blockedCategories: z.array(z.string()),
  /**
   * "Ads from partners" (added 2026-09-28): a programmatic backfill for time still open after
   * the rotation, backups and thank-you credit. Only a flag until the backend supports it; off by default.
   */
  adsFromPartners: z.boolean().optional(),
  /**
   * Added 2026-09-29: how often the station ID, bumpers, the thank-you credit and (added later
   * that day) spots air in breaks. Always in `getBreakRule`, `spots` included; left out of
   * `setBreakRule`, what's set stays (the whole cadence, or `spots` alone). The default is every
   * break for all four (as before). When bumpers air, one opens the break and one closes it (the
   * same one twice with only one in the library, none without); a break without them has none.
   * A break without spots airs only the parts that do and is as long as they need (the maker's
   * barter time stays), except the break that closes a program's slot or one cued live, whose
   * length the log sets: their time left over holds on the station ID slate. Nothing is placed
   * (and nothing held) in a break without spots, and its `openMs` is 0. Open time, sign-on and
   * dead-air fill still air the station ID and bumpers.
   */
  cadence: z
    .object({
      stationId: StationIdCadence,
      bumpers: BreakCadence,
      underwriting: BreakCadence,
      /** Added 2026-09-29 (later): how often the station's spots air. Left out, every break. */
      spots: BreakCadence.optional()
    })
    .optional()
});

export const Translator = z.object({
  id: Id,
  service: z.enum(["youtube", "twitch", "rtmp"]),
  name: z.string(),
  rtmpUrl: z.string(),
  /** Never returned; only whether one is set. */
  hasStreamKey: z.boolean(),
  /**
   * Superseded 2026-09-30 (follow-up Phase 3) by the station's one setting for all its relays
   * (relay.ts, `RelayView.breakHandling`), which the relay reads first. Kept, and still accepted.
   */
  breakHandling: z.enum(["air_spots", "station_id_slate"]),
  prerecordedLabel: z.boolean(),
  enabled: z.boolean(),
  status: z.enum(["not_connected", "connected", "relaying"]),
  /** Added 2026-09-29 (X2): captions drawn into the relayed picture. False (off) unless the station chooses it. */
  burnCaptions: z.boolean().optional()
});

export const LiveSource = z.object({
  id: Id,
  kind: z.enum(["encoder", "browser"]),
  name: z.string(),
  /** Encoders: where to point OBS. The key is shown once, on create or reset. */
  server: z.string().nullable(),
  streamKeyPreview: z.string().nullable(),
  signal: z.enum(["not_connected", "receiving"]),
  createdAt: Timestamp,
  /** S14 (added 2026-09-29): signal quality ("1080p, 4.5 Mbps"). Not measured yet: null. */
  quality: z.string().nullable().optional(),
  /**
   * S14 (added 2026-09-29): a private preview of what the source is sending (the rehearsal only
   * the team sees): the source's own playback, for sources that send through Livepeer. Null for
   * sources without one.
   */
  previewUrl: z.string().nullable().optional(),
  /**
   * B3 (added 2026-09-29): where a browser source publishes (WHIP, WebRTC): POST the SDP offer to
   * `whipUrl` (the token is in it; send it as the bearer too). Browser sources added while the
   * server sends live sources through Livepeer have one; null otherwise. Hosts get it too: they go
   * live from the browser.
   */
  ingest: z.object({ whipUrl: z.string(), token: z.string() }).nullable().optional(),
  /**
   * Added 2026-09-29: where an encoder's push goes. `livepeer` (TV: Livepeer transcodes it to the
   * channel's ladder), `opencast` (radio: Opencast's own ingest, `server` and the key, takes the
   * sound and packages it at AAC 128 and 64 kbps; any picture is ignored), or null when the server
   * has no live path for it (TV without Livepeer set up).
   */
  route: z.enum(["livepeer", "opencast"]).nullable().optional()
});

/**
 * Added 2026-09-29: a radio station's background for its translators (relays to YouTube, Twitch
 * or any RTMP address, which want a picture): a still image, a GIF or a short looping video (up to
 * 30 s), prepared once at upload into a loop at the relay's size. The relay airs the station's
 * sound over it, with the bug, and a spot's code in its last 10 s. Relays only: Opencast's own apps
 * never show it (they draw the radio screen themselves). With none, relays use a picture in the
 * station's colour with its call sign and channel.
 */
export const RelayBackground = z.object({
  kind: z.enum(["image", "gif", "video"]),
  fileName: z.string().nullable(),
  /** Prepared once at upload: `preparing` for a few seconds, then `ready` (or `failed`, with `error`). */
  status: z.enum(["preparing", "ready", "failed"]),
  error: z.string().nullable(),
  /** The prepared loop (MP4, H.264, no sound) at the relay's size, and a still from it; null until ready. */
  loopUrl: z.string().nullable(),
  stillUrl: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** The loop's length. A still image is a two-second loop. */
  durationMs: Millis.nullable(),
  updatedAt: Timestamp
});

export const AvailableChannels = z.object({
  market: Market,
  band: Band,
  /** Main channels (X.1) and whether each is free. Held ones show as taken. */
  channels: z.array(z.object({ channel: ChannelNumber, state: z.enum(["open", "taken", "held"]) })),
  /**
   * Added 2026-09-30 (A229, rule `numbering.own_subchannels`): subchannels open to the signed-in
   * owner, beside a station they own on X.1 (`beside`), each the next free X.n in that major. It can
   * share X.1's call sign (`chooseChannel`'s `shareCallSign`). Empty when the rule is off.
   */
  ownSubchannels: z.array(z.object({ channel: ChannelNumber, beside: StationIdent })).optional()
});

/**
 * A market found from where someone is (S10, added 2026-09-28). `miles` is from the market's
 * centre to the person's, or null when where they are isn't known (only the markets are).
 */
export const MarketLookup = z.object({
  market: Market.nullable(),
  nearby: z.array(z.object({ market: Market, miles: z.number().nullable() }))
});
export type MarketLookup = z.infer<typeof MarketLookup>;

const StationParams = z.object({ stationId: Id });

/** A4 (added 2026-09-29): every live program and who hosts it. */
export const HostsByProgram = z.object({
  programs: z.array(
    z.object({
      programId: Id,
      title: z.string(),
      hosts: z.array(z.object({ userId: Id, displayName: z.string().nullable() }))
    })
  )
});
export type HostsByProgram = z.infer<typeof HostsByProgram>;

/**
 * S15 (added 2026-09-29): the lower third on a live block: a speaker from the program's list, free
 * text (`speakerId` null), or hidden. Readable by a second device.
 */
export const LowerThird = z.object({
  entryId: Id,
  hidden: z.boolean(),
  speakerId: Id.nullable(),
  name: z.string().max(80),
  title: z.string().max(120).nullable(),
  /** When it was last set; null for the default (the first speaker) before anyone has. */
  updatedAt: Timestamp.nullable().optional()
});
export type LowerThird = z.infer<typeof LowerThird>;

export const stationsApi = {
  listMarkets: endpoint({ method: "GET", path: "/markets", auth: "public", summary: "Every market", response: z.array(Market) }),
  marketForZip: endpoint({
    method: "GET",
    path: "/markets/by-zip/:zip",
    auth: "public",
    summary: "Your ZIP decides your market. Location isn't stored.",
    params: z.object({ zip: z.string().regex(/^\d{5}$/) }),
    response: z.object({ market: Market.nullable(), nearby: z.array(z.object({ market: Market, miles: z.number() })) })
  }),
  /** S10 (added 2026-09-28): TV first launch. */
  marketForConnection: endpoint({
    method: "GET",
    path: "/markets/by-connection",
    auth: "public",
    summary:
      "The market for the request's internet address, which isn't stored or logged. With no lookup configured, or a private address, `market` is null and `nearby` is the open markets (miles null).",
    response: MarketLookup
  }),
  /** S10 (added 2026-09-28): "Use my location". */
  marketForLocation: endpoint({
    method: "GET",
    path: "/markets/by-location",
    auth: "public",
    summary:
      "The market for a point (the device's location), which isn't stored: the nearest market within 50 miles of its centre, and others within 60 miles, nearest first. Nothing that close: `market` null and the open markets by distance.",
    query: z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }),
    response: MarketLookup
  }),
  getDial: endpoint({
    method: "GET",
    path: "/markets/:marketSlug/dial",
    auth: "public",
    summary: "The dial for a market in channel order, with now and next per station",
    params: z.object({ marketSlug: z.string() }),
    query: z.object({ band: Band.default("tv") }),
    response: Dial
  }),
  getGuide: endpoint({
    method: "GET",
    path: "/markets/:marketSlug/guide",
    auth: "public",
    summary: "The guide for a market and time window (at most 24 hours)",
    params: z.object({ marketSlug: z.string() }),
    query: z.object({ band: Band.default("tv"), from: Timestamp, to: Timestamp }),
    response: z.object({ market: Market, from: Timestamp, to: Timestamp, rows: z.array(GuideRow) })
  }),
  getStation: endpoint({
    method: "GET",
    path: "/stations/:stationRef",
    auth: "public",
    summary: "A station page, by id or call sign. Added 2026-09-30 (A229): or by its address (`StationIdent.slug`): `rivc-15-2` for a station sharing X.1's call sign (the call sign alone is X.1's); a call sign that changed still finds its station through the year it's held",
    params: z.object({ stationRef: z.string() }),
    response: StationPage
  }),
  search: endpoint({
    method: "GET",
    path: "/search",
    auth: "public",
    summary: "Search by call sign, channel number and title. A number returns a station to tune to.",
    query: z.object({ q: z.string().min(1).max(80), market: z.string().optional() }),
    response: SearchResult
  }),

  createStation: endpoint({
    method: "POST",
    path: "/stations",
    auth: "user",
    summary: "Start a station (or a studio). Nothing is public until it signs on. The creator becomes the owner. Changed 2026-09-29: `reservationId` starts it from a waitlist invite, with the call sign and channel held.",
    body: z.object({
      kind: z.enum(["station", "studio"]).default("station"),
      name: z.string().min(1).max(80),
      description: z.string().max(160).optional(),
      colour: Colour.optional(),
      handle: z
        .string()
        .regex(/^[a-z0-9-]{2,30}$/)
        .optional(),
      /**
       * Added 2026-09-29: start it from a waitlist invite (`/control/new?reservation=<id>`). The
       * call sign held takes its call sign, and a channel held its channel. Only for the person the
       * invite is for (403 `reservation_email_mismatch`, unless INVITE_EMAIL_MATCH=off); 422
       * `reservation_ended` once the hold has ended; 409 `reservation_used` when a station is
       * already being set up with it; 409 `call_sign_undecided`, 422 `call_sign_refused` as setup.
       */
      reservationId: Id.optional()
    }),
    response: StationSetup,
    status: 201
  }),
  getSetup: endpoint({
    method: "GET",
    path: "/stations/:stationId/setup",
    auth: "user",
    summary: "Identity and settings, for master control",
    params: StationParams,
    response: StationSetup
  }),
  updateSetup: endpoint({
    method: "PATCH",
    path: "/stations/:stationId/setup",
    auth: "user",
    summary: "Change name, description, colour (4.5:1 on white), bug, logo, legal details (owner)",
    params: StationParams,
    body: z.object({
      name: z.string().min(1).max(80).optional(),
      description: z.string().max(160).nullable().optional(),
      colour: Colour.optional(),
      callSign: CallSign.optional(),
      bug: z
        .object({
          mode: z.enum(["off", "call_sign_and_channel", "logo"]),
          position: z.string(),
          opacity: z.number().int().min(0).max(100)
        })
        .partial()
        .optional(),
      logoUrl: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      homeCity: z.string().nullable().optional(),
      studioLocation: z.object({ latitude: z.number(), longitude: z.number() }).nullable().optional(),
      legalName: z.string().nullable().optional(),
      legalContact: z.string().nullable().optional(),
      pledgesTaxDeductible: z.boolean().nullable().optional(),
      memberCreditStyle: z.enum(["voice", "text"]).optional(),
      orders: z.object({ takesOrders: z.boolean(), turnaround: z.string().max(80).nullable(), fromMicros: z.number().int().nonnegative().nullable() }).partial().optional(),
      /** IAB Content Taxonomy 3.0 ids to use instead of the ones derived from the category (added 2026-09-28); null goes back to derived. */
      iabCategories: z.array(z.string().regex(/^[A-Za-z0-9]{1,8}$/)).min(1).max(10).nullable().optional()
    }),
    response: StationSetup
  }),
  availableChannels: endpoint({
    method: "GET",
    path: "/markets/:marketSlug/channels",
    auth: "user",
    summary: "Which main channels are open in a market and band (setup step A1)",
    params: z.object({ marketSlug: z.string() }),
    query: z.object({ band: Band }),
    response: AvailableChannels
  }),
  chooseChannel: endpoint({
    method: "PUT",
    path: "/stations/:stationId/channel",
    auth: "user",
    summary:
      "Choose market, band and channel before first sign-on. A station gets X.1. Changed 2026-09-29: choosing another than the channel held with its waitlist call sign lets the held one go. Added 2026-09-30 (A229, rule `numbering.own_subchannels`): an owner's own subchannel X.n beside a station they own on X.1 in the same market (409 `not_your_subchannel` otherwise), sharing X.1's call sign with `shareCallSign` (the station then has X.1's call sign; its own, if it had one, is let go). A station sharing a call sign that moves elsewhere, or takes its own call sign (`updateSetup`), stops sharing. X.1 can't move while stations share its call sign (409 `family_channel`).",
    params: StationParams,
    body: z.object({ marketId: Id, band: Band, channel: ChannelNumber, shareCallSign: z.boolean().optional() }),
    response: StationSetup
  }),

  getBreakRule: endpoint({
    method: "GET",
    path: "/stations/:stationId/break-rule",
    auth: "user",
    summary: "The station's break rule and blocked categories",
    params: StationParams,
    response: BreakRule
  }),
  setBreakRule: endpoint({
    method: "PUT",
    path: "/stations/:stationId/break-rule",
    auth: "user",
    summary: "Set the break rule (owner, operator)",
    params: StationParams,
    body: BreakRule,
    response: BreakRule
  }),

  listTranslators: endpoint({
    method: "GET",
    path: "/stations/:stationId/translators",
    auth: "user",
    summary: "Relays to YouTube, Twitch and any RTMP address",
    params: StationParams,
    response: z.array(Translator)
  }),
  addTranslator: endpoint({
    method: "POST",
    path: "/stations/:stationId/translators",
    auth: "user",
    summary: "Add a relay",
    params: StationParams,
    body: z.object({
      service: z.enum(["youtube", "twitch", "rtmp"]),
      name: z.string().min(1).max(80),
      rtmpUrl: z.string().regex(/^rtmps?:\/\//),
      streamKey: z.string().min(1),
      breakHandling: z.enum(["air_spots", "station_id_slate"]).default("air_spots"),
      prerecordedLabel: z.boolean().default(false),
      /** Added 2026-09-29 (X2): draw captions into the relayed picture. Off by default. */
      burnCaptions: z.boolean().optional()
    }),
    response: Translator,
    status: 201
  }),
  updateTranslator: endpoint({
    method: "PATCH",
    path: "/stations/:stationId/translators/:translatorId",
    auth: "user",
    summary: "Change a relay, including its break handling",
    params: z.object({ stationId: Id, translatorId: Id }),
    body: z
      .object({
        name: z.string().min(1).max(80),
        rtmpUrl: z.string().regex(/^rtmps?:\/\//),
        streamKey: z.string().min(1),
        breakHandling: z.enum(["air_spots", "station_id_slate"]),
        prerecordedLabel: z.boolean(),
        enabled: z.boolean(),
        /** Added 2026-09-29 (X2). */
        burnCaptions: z.boolean()
      })
      .partial(),
    response: Translator
  }),
  removeTranslator: endpoint({
    method: "DELETE",
    path: "/stations/:stationId/translators/:translatorId",
    auth: "user",
    summary: "Remove a relay",
    params: z.object({ stationId: Id, translatorId: Id }),
    response: Ok
  }),

  // ---- Added 2026-09-29: a radio station's relay background ----

  getRelayBackground: endpoint({
    method: "GET",
    path: "/stations/:stationId/relay-background",
    auth: "user",
    summary: "The picture a radio station's translators air under its sound (owner, operator). Null: the generated picture in the station's colour",
    params: StationParams,
    response: z.object({ background: RelayBackground.nullable() })
  }),
  setRelayBackground: endpoint({
    method: "PUT",
    path: "/stations/:stationId/relay-background",
    auth: "user",
    summary:
      "Upload or replace a radio station's relay background (owner, operator): a PNG, JPEG or WebP image, a GIF, or an MP4, MOV or WebM video up to 30 seconds (its sound is dropped), up to 100 MB. Prepared once into a loop at the relay's size (`status` `preparing`, then `ready`); relays that are on pick it up once it's ready. 409 `not_radio` (a TV station relays its own picture); 422 `wrong_file_type`, `too_big`, `too_long`, `unreadable_file`.",
    params: StationParams,
    multipart: true,
    body: z.object({}),
    response: RelayBackground
  }),
  removeRelayBackground: endpoint({
    method: "DELETE",
    path: "/stations/:stationId/relay-background",
    auth: "user",
    summary: "Remove the relay background (owner, operator); relays go back to the picture in the station's colour",
    params: StationParams,
    response: Ok
  }),

  listLiveSources: endpoint({
    method: "GET",
    path: "/stations/:stationId/live-sources",
    auth: "user",
    summary: "Encoders and browser sources",
    params: StationParams,
    response: z.array(LiveSource)
  }),
  addLiveSource: endpoint({
    method: "POST",
    path: "/stations/:stationId/live-sources",
    auth: "user",
    summary: "Add an encoder or browser source; an encoder's key is returned once",
    params: StationParams,
    body: z.object({ kind: z.enum(["encoder", "browser"]), name: z.string().min(1).max(80) }),
    response: z.object({ source: LiveSource, streamKey: z.string().nullable() }),
    status: 201
  }),
  resetLiveSourceKey: endpoint({
    method: "POST",
    path: "/stations/:stationId/live-sources/:sourceId/reset-key",
    auth: "user",
    summary: "Reset an encoder's key; the old key stops working",
    params: z.object({ stationId: Id, sourceId: Id }),
    response: z.object({ source: LiveSource, streamKey: z.string() })
  }),
  removeLiveSource: endpoint({
    method: "DELETE",
    path: "/stations/:stationId/live-sources/:sourceId",
    auth: "user",
    summary: "Remove a live source",
    params: z.object({ stationId: Id, sourceId: Id }),
    response: Ok
  }),

  setHosts: endpoint({
    method: "PUT",
    path: "/stations/:stationId/programs/:programId/hosts",
    auth: "user",
    summary: "Who can go live on a live program (hosts see only their blocks)",
    params: z.object({ stationId: Id, programId: Id }),
    body: z.object({ userIds: z.array(Id) }),
    response: z.object({ userIds: z.array(Id) })
  }),
  getSpeakers: endpoint({
    method: "GET",
    path: "/programs/:programId/speakers",
    auth: "user",
    summary: "The lower-thirds speaker list for a live program",
    params: z.object({ programId: Id }),
    response: z.array(z.object({ id: Id, name: z.string(), title: z.string().nullable(), position: z.number().int() }))
  }),
  setSpeakers: endpoint({
    method: "PUT",
    path: "/programs/:programId/speakers",
    auth: "user",
    summary: "Replace the speaker list",
    params: z.object({ programId: Id }),
    body: z.array(z.object({ name: z.string().min(1).max(80), title: z.string().max(120).nullable() })),
    response: z.array(z.object({ id: Id, name: z.string(), title: z.string().nullable(), position: z.number().int() }))
  }),

  // ---- Added 2026-09-29: A4, S15 ----

  listHosts: endpoint({
    method: "GET",
    path: "/stations/:stationId/hosts",
    auth: "user",
    summary: "A4: every live program and who hosts it (owner, operator; a host gets only their own programs)",
    params: StationParams,
    response: HostsByProgram
  }),
  getLowerThird: endpoint({
    method: "GET",
    path: "/stations/:stationId/log/:entryId/lower-third",
    auth: "user",
    summary: "S15: the lower third on a live block (owner, operator, its host). Before anyone sets it: the first speaker, showing.",
    params: z.object({ stationId: Id, entryId: Id }),
    response: LowerThird
  }),
  setLowerThird: endpoint({
    method: "PUT",
    path: "/stations/:stationId/log/:entryId/lower-third",
    auth: "user",
    summary: "S15: show a speaker (their name and title are taken from the list), free text, or hide it (owner, operator, its host). 409 `not_live`.",
    params: z.object({ stationId: Id, entryId: Id }),
    body: z.object({ hidden: z.boolean(), speakerId: Id.nullable(), name: z.string().max(80), title: z.string().max(120).nullable() }),
    response: LowerThird
  })
};

export type DialRow = z.infer<typeof DialRow>;
export type Dial = z.infer<typeof Dial>;
export type GuideRow = z.infer<typeof GuideRow>;
export type StationPage = z.infer<typeof StationPage>;
export type SearchResult = z.infer<typeof SearchResult>;
export type StationSetup = z.infer<typeof StationSetup>;
export type BreakRule = z.infer<typeof BreakRule>;
export type BreakCadence = z.infer<typeof BreakCadence>;
export type BreakCadenceEvery = z.infer<typeof BreakCadenceEvery>;
export type BreakCadences = NonNullable<BreakRule["cadence"]>;
export type Translator = z.infer<typeof Translator>;
export type LiveSource = z.infer<typeof LiveSource>;
export type RelayBackground = z.infer<typeof RelayBackground>;
export type AvailableChannels = z.infer<typeof AvailableChannels>;
