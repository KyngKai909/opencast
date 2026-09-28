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
  programId: Id.nullable()
});
export type Airing = z.infer<typeof Airing>;

export const DialRow = z.object({
  station: StationIdent,
  /** Lit only when something is actually on air. */
  onAir: z.boolean(),
  now: Airing.nullable(),
  next: Airing.nullable(),
  /** Listed city streams play in the source's own player. */
  playback: z.object({ kind: z.enum(["hls", "embed"]), url: z.string() }).nullable()
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
  playback: z.object({ kind: z.enum(["hls", "embed"]), url: z.string() }).nullable()
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
  memberCreditStyle: z.enum(["voice", "text"])
});

export const BreakRule = z.object({
  mode: z.enum(["after_every_program", "every_n_minutes", "none"]),
  everyMinutes: z.number().int().positive().nullable(),
  lengthMs: Millis,
  /** Spot time per hour; default 3:00. */
  spotMsPerHour: Millis,
  /** Same spot, at most this many times an hour. */
  sameSpotPerHour: z.number().int().min(1),
  /** After SPT. SID is always last and can't be removed. */
  fillOrder: z.array(LogCode),
  openTimeTo: z.enum(["spot_market", "station_id_and_bumpers"]),
  blockedCategories: z.array(z.string())
});

export const Translator = z.object({
  id: Id,
  service: z.enum(["youtube", "twitch", "rtmp"]),
  name: z.string(),
  rtmpUrl: z.string(),
  /** Never returned; only whether one is set. */
  hasStreamKey: z.boolean(),
  breakHandling: z.enum(["air_spots", "station_id_slate"]),
  prerecordedLabel: z.boolean(),
  enabled: z.boolean(),
  status: z.enum(["not_connected", "connected", "relaying"])
});

export const LiveSource = z.object({
  id: Id,
  kind: z.enum(["encoder", "browser"]),
  name: z.string(),
  /** Encoders: where to point OBS. The key is shown once, on create or reset. */
  server: z.string().nullable(),
  streamKeyPreview: z.string().nullable(),
  signal: z.enum(["not_connected", "receiving"]),
  createdAt: Timestamp
});

export const AvailableChannels = z.object({
  market: Market,
  band: Band,
  /** Main channels (X.1) and whether each is free. Held ones show as taken. */
  channels: z.array(z.object({ channel: ChannelNumber, state: z.enum(["open", "taken", "held"]) }))
});

const StationParams = z.object({ stationId: Id });

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
    summary: "A station page, by id or call sign",
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
    summary: "Start a station (or a studio). Nothing is public until it signs on. The creator becomes the owner.",
    body: z.object({
      kind: z.enum(["station", "studio"]).default("station"),
      name: z.string().min(1).max(80),
      description: z.string().max(160).optional(),
      colour: Colour.optional(),
      handle: z
        .string()
        .regex(/^[a-z0-9-]{2,30}$/)
        .optional()
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
      memberCreditStyle: z.enum(["voice", "text"]).optional()
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
    summary: "Choose market, band and channel before first sign-on. A station gets X.1.",
    params: StationParams,
    body: z.object({ marketId: Id, band: Band, channel: ChannelNumber }),
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
      prerecordedLabel: z.boolean().default(false)
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
        enabled: z.boolean()
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
  })
};

