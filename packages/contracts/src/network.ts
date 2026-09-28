import { z } from "zod";
import { endpoint } from "./core.js";
import { Band, CallSign, ChannelNumber, Id, Market, Micros, Millis, StationIdent, Timestamp } from "./common.js";
import { CreatorStage } from "./states.js";

export const SlotState = z.enum(["station", "claimable", "listed", "catalog", "held", "open"]);
export const SLOT_STATE_LABELS = {
  station: "Independent station",
  claimable: "Claimable, run by Opencast",
  listed: "Listed city stream",
  catalog: "Opencast catalog",
  held: "Held for the waitlist",
  open: "Open"
} as const;

export const MarketBoard = z.object({
  market: Market,
  band: Band,
  slots: z.array(
    z.object({
      /** The main channel, e.g. "12"; subchannels live inside a slot. */
      major: z.number().int(),
      state: SlotState,
      stations: z.array(StationIdent),
      heldFor: CallSign.nullable(),
      status: z.string().nullable()
    })
  ),
  stats: z.object({
    localShareOfTonightPercent: z.number().nullable(),
    claimableOnAir: z.number().int(),
    saidYesNotSetUp: z.number().int(),
    deadAirComing: z.array(StationIdent),
    waitlistHere: z.number().int()
  })
});

export const Creator = z.object({
  id: Id,
  displayName: z.string(),
  personName: z.string().nullable(),
  description: z.string().nullable(),
  sourcePlatform: z.enum(["youtube", "vimeo", "internet_archive", "instagram", "facebook", "soundcloud", "bandcamp", "other"]),
  sourceUrl: z.string(),
  contactEmail: z.string().nullable(),
  stage: CreatorStage,
  proposed: z.object({ band: Band, channel: ChannelNumber }).nullable(),
  nextAction: z.string().nullable(),
  nextActionDue: z.iso.date().nullable(),
  doNotAsk: z.boolean(),
  station: StationIdent.nullable(),
  works: z.number().int(),
  worksDurationMs: Millis
});

export const CreatorWork = z.object({
  id: Id,
  title: z.string(),
  durationMs: Millis.nullable(),
  sourceUrl: z.string(),
  groupLabel: z.string().nullable(),
  leftOutReason: z.string().nullable(),
  covered: z.enum(["permission", "licence", "none"]),
  licence: z.object({ licence: z.string(), url: z.string(), attribution: z.string(), allowsCarriage: z.boolean() }).nullable()
});

/** The creator's permission page. No account needed. */
export const PermissionPage = z.object({
  creator: z.object({ displayName: z.string(), personName: z.string().nullable() }),
  proposed: z.object({ band: Band, channel: ChannelNumber }).nullable(),
  note: z.string().nullable(),
  works: z.array(z.object({ id: Id, title: z.string(), durationMs: Millis.nullable(), included: z.boolean(), leftOutReason: z.string().nullable() })),
  /** A schedule built from titles and lengths only. */
  schedulePreview: z.array(z.object({ time: z.string(), title: z.string(), source: z.enum(["creator", "catalog", "carried", "repeats"]) })),
  answer: z.object({ answer: z.enum(["yes", "no"]), answeredAt: Timestamp, works: z.number().int() }).nullable(),
  /** After a yes: stop, or claim now. */
  station: StationIdent.nullable(),
  claimable: z.boolean()
});

export const Recipe = z.object({
  id: Id,
  name: z.string(),
  category: z.string(),
  band: Band,
  blocks: z.array(z.object({ start: z.string(), end: z.string(), source: z.enum(["creator", "catalog", "carried", "repeats", "overnight"]) })),
  maxAiringsPerWorkPerWeek: z.number().int(),
  breakRule: z.record(z.string(), z.unknown())
});

export const HeldEarnings = z.object({
  contractAddress: z.string().nullable(),
  stations: z.array(
    z.object({
      station: StationIdent,
      creator: z.string(),
      escrowStationId: z.number().int(),
      onAirSince: Timestamp.nullable(),
      rightsBasis: z.enum(["permission", "licence"]),
      heldMicros: Micros,
      owedNotYetDepositedMicros: Micros,
      status: z.enum(["not_on_air_yet", "on_air", "invited", "claim_link_sent", "claim_pending", "claimed", "stopped"])
    })
  ),
  totalHeldMicros: Micros,
  /** Always $0.00: nothing held for a creator ever moves to Opencast. */
  everMovedToOpencastMicros: Micros
});

export const ListedSource = z.object({
  id: Id,
  station: StationIdent,
  name: z.string(),
  description: z.string().nullable(),
  streamUrl: z.string(),
  embedTerms: z.enum(["allowed", "unclear"]),
  calendarUrl: z.string().nullable(),
  calendarSync: z.enum(["synced", "calendar_not_found", "not_set"]),
  listingState: z.enum(["not_listed", "checking", "listed"]),
  lastSyncedAt: Timestamp.nullable(),
  upcoming: z.number().int()
});

const CreatorParams = z.object({ creatorId: Id });

export const networkApi = {
  getBoard: endpoint({
    method: "GET",
    path: "/admin/markets/:marketSlug/board",
    auth: "admin",
    summary: "Every channel's state in a market",
    params: z.object({ marketSlug: z.string() }),
    query: z.object({ band: Band.default("tv") }),
    response: MarketBoard
  }),
  createMarket: endpoint({
    method: "POST",
    path: "/admin/markets",
    auth: "admin",
    summary: "Add a market and the ZIPs in it",
    body: z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), name: z.string(), timezone: z.string(), zips: z.array(z.string().regex(/^\d{5}$/)).default([]) }),
    response: Market,
    status: 201
  }),
  listCreators: endpoint({
    method: "GET",
    path: "/admin/creators",
    auth: "admin",
    summary: "The creator pipeline, sorted by next action",
    query: z.object({ marketId: Id.optional(), stage: CreatorStage.optional() }),
    response: z.array(Creator)
  }),
  addCreator: endpoint({
    method: "POST",
    path: "/admin/creators",
    auth: "admin",
    summary: "Add a creator found in a market",
    body: z.object({
      marketId: Id,
      displayName: z.string().min(1),
      personName: z.string().optional(),
      description: z.string().max(200).optional(),
      sourcePlatform: Creator.shape.sourcePlatform,
      sourceUrl: z.url(),
      contactEmail: z.email().optional()
    }),
    response: Creator,
    status: 201
  }),
  updateCreator: endpoint({
    method: "PATCH",
    path: "/admin/creators/:creatorId",
    auth: "admin",
    summary: "Change stage, proposed channel, next action",
    params: CreatorParams,
    body: z
      .object({
        stage: CreatorStage,
        proposed: z.object({ band: Band, channel: ChannelNumber }).nullable(),
        nextAction: z.string().nullable(),
        nextActionDue: z.iso.date().nullable(),
        contactEmail: z.email().nullable(),
        personName: z.string().nullable()
      })
      .partial(),
    response: Creator
  }),
  listWorks: endpoint({ method: "GET", path: "/admin/creators/:creatorId/works", auth: "admin", summary: "Works found on the creator's source", params: CreatorParams, response: z.array(CreatorWork) }),
  addWorks: endpoint({
    method: "POST",
    path: "/admin/creators/:creatorId/works",
    auth: "admin",
    summary: "Catalogue works from titles and lengths. Nothing is copied yet.",
    params: CreatorParams,
    body: z.array(z.object({ title: z.string().min(1), durationMs: Millis.nullable(), sourceUrl: z.url(), groupLabel: z.string().optional(), leftOutReason: z.string().optional() })),
    response: z.array(CreatorWork)
  }),
  recordLicence: endpoint({
    method: "POST",
    path: "/admin/works/:workId/licence",
    auth: "admin",
    summary: "Record a work's published licence. Only CC0, CC BY and CC BY-SA count.",
    params: z.object({ workId: Id }),
    body: z.object({
      licence: z.enum(["cc0", "cc_by", "cc_by_sa", "cc_by_nd", "cc_by_nc", "cc_by_nc_sa", "cc_by_nc_nd", "other"]),
      licenceUrl: z.url(),
      attribution: z.string().min(1)
    }),
    response: CreatorWork
  }),
  askPermission: endpoint({
    method: "POST",
    path: "/admin/creators/:creatorId/permission-requests",
    auth: "admin",
    summary: "Send a permission request with a preview of the station's schedule built from titles",
    params: CreatorParams,
    body: z.object({
      sentVia: z.array(z.string()).min(1),
      note: z.string().max(2000).optional(),
      proposed: z.object({ band: Band, channel: ChannelNumber }).optional(),
      recipeId: Id.optional()
    }),
    response: z.object({ requestId: Id, link: z.string(), preview: PermissionPage }),
    status: 201
  }),
  getPermissionPage: endpoint({
    method: "GET",
    path: "/permission/:token",
    auth: "public",
    summary: "The creator's permission page",
    params: z.object({ token: z.string().min(16) }),
    response: PermissionPage
  }),
  answerPermission: endpoint({
    method: "POST",
    path: "/permission/:token/answer",
    auth: "public",
    summary: "Yes, go ahead / No thanks. Recorded against the link with the exact list of works; a copy is emailed.",
    params: z.object({ token: z.string().min(16) }),
    body: z.object({ answer: z.enum(["yes", "no"]), copyTo: z.email().optional() }),
    response: PermissionPage
  }),
  listRecipes: endpoint({ method: "GET", path: "/admin/recipes", auth: "admin", summary: "Station recipes", response: z.array(Recipe) }),
  saveRecipe: endpoint({
    method: "POST",
    path: "/admin/recipes",
    auth: "admin",
    summary: "Add a recipe",
    body: Recipe.omit({ id: true }),
    response: Recipe,
    status: 201
  }),
  setUpClaimable: endpoint({
    method: "POST",
    path: "/admin/creators/:creatorId/station",
    auth: "admin",
    summary: "Set up a claimable station from a recipe: channel, call sign, and the rights record attached",
    params: CreatorParams,
    body: z.object({
      recipeId: Id,
      marketId: Id,
      band: Band,
      channel: ChannelNumber,
      callSign: CallSign,
      name: z.string().min(1),
      colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      operatorUserId: Id,
      signOnAt: Timestamp.optional()
    }),
    response: z.object({ station: StationIdent, importable: z.number().int() }),
    status: 201
  }),
  heldEarnings: endpoint({ method: "GET", path: "/admin/held-earnings", auth: "admin", summary: "Held earnings per claimable station", response: HeldEarnings }),
  startHandover: endpoint({
    method: "POST",
    path: "/stations/:stationId/claim",
    auth: "user",
    summary: "Claim (or stop) a claimable station: connect the source account to prove it's you",
    params: z.object({ stationId: Id }),
    body: z.object({ kind: z.enum(["claim", "stop"]), sourceAccountProof: z.string().min(1) }),
    response: z.object({ handoverId: Id, status: z.enum(["verifying", "approved", "waiting_period", "completed", "cancelled"]), payableAfter: Timestamp.nullable() }),
    status: 201
  }),
  approveHandover: endpoint({
    method: "POST",
    path: "/admin/handovers/:handoverId/approve",
    auth: "admin",
    summary: "Record the verifier's approval; the 72-hour public waiting period starts",
    params: z.object({ handoverId: Id }),
    response: z.object({ handoverId: Id, payableAfter: Timestamp })
  }),
  listListedSources: endpoint({ method: "GET", path: "/admin/listed-sources", auth: "admin", summary: "City and county streams", query: z.object({ marketId: Id.optional() }), response: z.array(ListedSource) }),
  addListedSource: endpoint({
    method: "POST",
    path: "/admin/listed-sources",
    auth: "admin",
    summary: "List a city stream on the dial. Viewers get the source's own player.",
    body: z.object({
      marketId: Id,
      band: Band,
      channel: ChannelNumber,
      callSign: CallSign,
      name: z.string().min(1),
      description: z.string().max(160).optional(),
      streamUrl: z.url(),
      embedTerms: z.enum(["allowed", "unclear"]),
      calendarUrl: z.url().optional()
    }),
    response: ListedSource,
    status: 201
  }),
  syncListedSource: endpoint({
    method: "POST",
    path: "/admin/listed-sources/:sourceId/sync",
    auth: "admin",
    summary: "Sync listings from the agenda calendar now",
    params: z.object({ sourceId: Id }),
    response: ListedSource
  })
};
