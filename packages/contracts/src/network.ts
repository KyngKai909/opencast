import { z } from "zod";
import { endpoint } from "./core.js";
import { Band, CallSign, ChannelNumber, Colour, Id, Market, Micros, Millis, StationIdent, Timestamp } from "./common.js";
import { CreatorStage } from "./states.js";
import { BreakCadence, StationIdCadence } from "./stations.js";

export const SlotState = z.enum(["station", "claimable", "listed", "catalog", "held", "open"]);
export const SLOT_STATE_LABELS = {
  station: "Independent station",
  claimable: "Claimable, run by Opencast",
  listed: "External city stream",
  catalog: "Opencast catalog",
  held: "Held for the waitlist",
  open: "Open"
} as const;

export const MarketBoard = z.object({
  market: Market,
  band: Band,
  slots: z.array(
    z.object({
      /** The main channel, e.g. "12"; subchannels live inside a slot. Radio: the frequency in tenths, 882 to 1078 in even tenths. */
      major: z.number().int(),
      state: SlotState,
      stations: z.array(StationIdent),
      heldFor: CallSign.nullable(),
      status: z.string().nullable(),
      /** N7 (added 2026-09-28): when a station that isn't on air yet signs on. */
      signOnAt: Timestamp.nullable().optional(),
      /** N7: a claimable station's creator. */
      creatorId: Id.nullable().optional()
    })
  ),
  stats: z.object({
    localShareOfTonightPercent: z.number().nullable(),
    claimableOnAir: z.number().int(),
    saidYesNotSetUp: z.number().int(),
    deadAirComing: z.array(StationIdent),
    waitlistHere: z.number().int(),
    /** N7 (added 2026-09-28): the same for both bands together. */
    market: z
      .object({ localShareOfTonightPercent: z.number().nullable(), claimableOnAir: z.number().int(), deadAirComing: z.array(StationIdent) })
      .optional()
  })
});

/** N5 (added 2026-09-28): a claimable station's setup, read back. */
export const CreatorSetup = z.object({
  recipeId: Id,
  band: Band,
  channel: ChannelNumber,
  callSign: z.string(),
  name: z.string(),
  colour: Colour.nullable(),
  operator: z.object({ id: Id, name: z.string() }).nullable(),
  /** When it signed on, or is set to. */
  signOnAt: Timestamp.nullable(),
  /** Items prepared for air so far, of the works the yes or the licence covers. */
  importDone: z.number().int(),
  importTotal: z.number().int(),
  /** The station's ID in the escrow contract. */
  escrowStationId: z.number().int().nullable()
});
export type CreatorSetup = z.infer<typeof CreatorSetup>;

export const Pronoun = z.enum(["she", "he", "they"]);

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
  worksDurationMs: Millis,
  // ---- Added 2026-09-28 (N1, N3, N5, N9, N12) ----
  /** N1: every channel proposed ("38.1 or 45.1"); no channels is the band only ("Radio band"). */
  proposedOptions: z.object({ band: Band, channels: z.array(ChannelNumber) }).nullable().optional(),
  /** N3: the pipeline's dates. */
  askedAt: Timestamp.nullable().optional(),
  remindedAt: Timestamp.nullable().optional(),
  /** When they said yes, or no. */
  answeredAt: Timestamp.nullable().optional(),
  claimInviteSentAt: Timestamp.nullable().optional(),
  claimLinkSentAt: Timestamp.nullable().optional(),
  claimedAt: Timestamp.nullable().optional(),
  /** N9: the licence an already-licensed creator's works carry ("CC BY 4.0"). */
  licenceName: z.string().nullable().optional(),
  /** N12: how the desk refers to them ("Her videos"). Absent: "their". */
  pronoun: z.enum(["she", "he", "they"]).optional(),
  /** N5: the claimable station's setup, read back once it exists. */
  setup: CreatorSetup.nullable().optional()
});

export const CreatorWork = z.object({
  id: Id,
  title: z.string(),
  durationMs: Millis.nullable(),
  sourceUrl: z.string(),
  groupLabel: z.string().nullable(),
  /** N4 (added 2026-09-28): what one is called ("film", "video"), for "6 films". */
  noun: z.string().nullable().optional(),
  leftOutReason: z.string().nullable(),
  covered: z.enum(["permission", "licence", "none"]),
  licence: z.object({ licence: z.string(), url: z.string(), attribution: z.string(), allowsCarriage: z.boolean() }).nullable()
});

/** The creator's permission page. No account needed. */
export const PermissionPage = z.object({
  creator: z.object({
    displayName: z.string(),
    personName: z.string().nullable(),
    /** N4 (added 2026-09-28): where their work is ("from your Vimeo"). */
    sourcePlatform: z.enum(["youtube", "vimeo", "internet_archive", "instagram", "facebook", "soundcloud", "bandcamp", "other"]).optional()
  }),
  proposed: z.object({ band: Band, channel: ChannelNumber }).nullable(),
  note: z.string().nullable(),
  works: z.array(
    z.object({
      id: Id,
      title: z.string(),
      durationMs: Millis.nullable(),
      included: z.boolean(),
      leftOutReason: z.string().nullable(),
      /** N4 (added 2026-09-28). */
      groupLabel: z.string().nullable().optional(),
      noun: z.string().nullable().optional()
    })
  ),
  /** A schedule built from titles and lengths only. */
  schedulePreview: z.array(z.object({ time: z.string(), title: z.string(), source: z.enum(["creator", "catalog", "carried", "repeats"]) })),
  answer: z.object({ answer: z.enum(["yes", "no"]), answeredAt: Timestamp, works: z.number().int() }).nullable(),
  /** After a yes: stop, or claim now. */
  station: StationIdent.nullable(),
  claimable: z.boolean(),
  // ---- Added 2026-09-28 (N4, B8) ----
  /** N4: a line the desk wrote for the works ("6 skate films and 7 park session edits"). Null: the app words it from the works. */
  summary: z.object({ included: z.string(), leftOut: z.string().nullable() }).nullable().optional(),
  /** The market's name, for "on the Inland Empire dial". */
  marketName: z.string().optional(),
  /** B8: stopped from the link. */
  stoppedAt: Timestamp.nullable().optional(),
  /** B8: a claim started from the link (or on the station), and where it's got to. */
  claim: z
    .object({ handoverId: Id, status: z.enum(["verifying", "approved", "waiting_period", "completed", "cancelled"]), startedAt: Timestamp })
    .nullable()
    .optional()
});

/**
 * A recipe's break rule, typed (N6, added 2026-09-28). `Recipe.breakRule` keeps its record type;
 * this is how to read it. Any other keys are kept. `saveRecipe` refuses a rule whose four known
 * keys have the wrong type (400).
 */
export const RecipeBreakRule = z
  .object({
    everyMinutes: z.number().int().positive().optional(),
    lengthMs: z.number().int().positive().optional(),
    fillFrom: z.enum(["market", "house"]).optional(),
    blockedCategories: z.array(z.string()).optional(),
    /** Added 2026-09-29: how often the station ID, bumpers, credit and spots air, as `BreakRule.cadence`. */
    cadence: z.object({ stationId: StationIdCadence, bumpers: BreakCadence, underwriting: BreakCadence, spots: BreakCadence.optional() }).optional()
  })
  .loose();

export const Recipe = z.object({
  id: Id,
  name: z.string(),
  category: z.string(),
  band: Band,
  blocks: z.array(
    z.object({
      start: z.string(),
      end: z.string(),
      source: z.enum(["creator", "catalog", "carried", "repeats", "overnight"]),
      // N6 (added 2026-09-28): what the desk draws and the permission message says.
      /** The day bar's words ("Lupe's kitchen"); `{creator}` is the creator's short name. */
      label: z.string().optional(),
      /** What the message's schedule calls it ("Classic films from the catalog"). */
      listing: z.string().optional(),
      /** The block's colour on the day bar (catalog blocks). */
      colour: Colour.optional(),
      /** A carried program in the block. */
      carried: z.object({ station: StationIdent, programTitle: z.string(), schedule: z.string(), about: z.string() }).optional()
    })
  ),
  maxAiringsPerWorkPerWeek: z.number().int(),
  breakRule: z.record(z.string(), z.unknown()),
  /** N6: "at night", when the creator's work airs ("Their films at night"). */
  when: z.string().optional(),
  /** N6: "Classic films and overnight programming". */
  catalogAbout: z.string().optional()
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
      status: z.enum(["not_on_air_yet", "on_air", "invited", "claim_link_sent", "claim_pending", "claimed", "stopped"]),
      // ---- Added 2026-09-28 (N3, N9, A125) ----
      invitedAt: Timestamp.nullable().optional(),
      claimLinkSentAt: Timestamp.nullable().optional(),
      /** When it signs on, while it isn't on air yet. */
      signOnAt: Timestamp.nullable().optional(),
      /** "CC BY 4.0", for a station on licensed works. */
      licenceName: z.string().nullable().optional(),
      /** A125: the creator in the pipeline, and their own name ("Crate"), beside `creator` (the person's name when known, as drawn: "for Marcus Reyes"). */
      creatorId: Id.optional(),
      creatorName: z.string().optional()
    })
  ),
  totalHeldMicros: Micros,
  /** Always $0.00: nothing held for a creator ever moves to Opencast. */
  everMovedToOpencastMicros: Micros,
  // ---- Added 2026-09-28 (N9, A125) ----
  /** A125: rows holding any money (held or owed), for "Held across 2 stations". Always counted from `stations`. */
  stationsHoldingMoney: z.number().int().optional(),
  /** N9: how long money waits before it can go to the creator fund. */
  unclaimedPeriodDays: z.number().int().positive().optional(),
  /** N9: where the contract lives, for the explorer link. Null without a chain, or one with no public explorer. */
  chain: z.object({ name: z.string(), explorerUrl: z.url() }).nullable().optional()
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

/**
 * N10 (added 2026-09-29): the creator's claim page, public by the link we sent them (the same
 * token as their permission page). Their station, what it holds for them, and the claim once
 * it's started.
 */
export const ClaimPage = z.object({
  station: StationIdent,
  /** Who it's for: the person's name when known, else the creator's. */
  personName: z.string(),
  /** The yes the station was set up from; null for a station set up under a licence. */
  saidYesAt: Timestamp.nullable(),
  /** "a station of your skate films and park session edits". */
  works: z.string(),
  /** "your skate films". */
  worksShort: z.string(),
  sourcePlatform: z.enum(["youtube", "vimeo", "internet_archive", "instagram", "facebook", "soundcloud", "bandcamp", "other"]),
  onAirSince: Timestamp.nullable(),
  /** Viewers with the station as a preset. */
  presetCount: z.number().int(),
  /** Held in escrow, plus earned and not yet deposited. */
  heldMicros: Micros,
  escrowContract: z.string().nullable(),
  escrowStationId: z.number().int(),
  handover: z
    .object({
      handoverId: Id,
      kind: z.enum(["claim", "stop"]),
      status: z.enum(["verifying", "approved", "waiting_period", "completed", "cancelled"]),
      payableAfter: Timestamp.nullable()
    })
    .nullable()
});
export type ClaimPage = z.infer<typeof ClaimPage>;

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
      contactEmail: z.email().optional(),
      /** N12 (added 2026-09-28). */
      pronoun: Pronoun.optional(),
      /** N1 (added 2026-09-28): channels proposed, or a band only. */
      proposedOptions: z.object({ band: Band, channels: z.array(ChannelNumber).max(6) }).optional()
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
        personName: z.string().nullable(),
        /** N12 (added 2026-09-28). */
        pronoun: Pronoun.nullable(),
        /** N1 (added 2026-09-28): replaces `proposed` (its first channel becomes `proposed`). */
        proposedOptions: z.object({ band: Band, channels: z.array(ChannelNumber).max(6) }).nullable()
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
    body: z.array(
      z.object({ title: z.string().min(1), durationMs: Millis.nullable(), sourceUrl: z.url(), groupLabel: z.string().optional(), leftOutReason: z.string().optional(), noun: z.string().max(40).optional() })
    ),
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
      recipeId: Id.optional(),
      /**
       * B7 (added 2026-09-28): the ticked works. Only these are covered by a yes; the others are left
       * out (keeping their reason, or "Left out when asking"), and ticking one again brings it back.
       * Absent: every work not already left out. 400 if one isn't the creator's, or the list is empty.
       */
      workIds: z.array(Id).min(1).optional()
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
    body: z.object({
      answer: z.enum(["yes", "no"]),
      copyTo: z.email().optional(),
      /** N4 (added 2026-09-28): the version of the page's wording they read, recorded with the answer. */
      wordingVersion: z.string().max(40).optional()
    }),
    response: PermissionPage
  }),
  /** B8 (added 2026-09-28). */
  stopFromLink: endpoint({
    method: "POST",
    path: "/permission/:token/stop",
    auth: "public",
    summary:
      "B8: stop from the permission link, any time after a yes. Nothing the yes covered airs again: a station set up from it signs off, and its held money goes to the creator by the stop path once they're verified (a stop handover the desk checks). 422 `nothing_to_stop` without a yes; stopping twice is the same page.",
    params: z.object({ token: z.string().min(16) }),
    response: PermissionPage
  }),
  claimFromLink: endpoint({
    method: "POST",
    path: "/permission/:token/claim",
    auth: "user",
    summary:
      "B8: claim from the permission link, signed in, before or after the station exists. Before, the claim waits and joins the station when the desk sets it up. 422 `nothing_to_claim` without a yes, or after a stop; 422 `in_progress` while a claim is open.",
    params: z.object({ token: z.string().min(16) }),
    response: PermissionPage
  }),
  /** N2 (added 2026-09-28). */
  remindCreator: endpoint({
    method: "POST",
    path: "/admin/creators/:creatorId/reminders",
    auth: "admin",
    summary:
      "N2: send the one reminder about the open permission request (to the contact email, with the same link). Next action becomes No answer, due in 7 days. 422 `not_asked` unless they're Asked; 422 `reminded` after the one reminder.",
    params: CreatorParams,
    response: Creator,
    status: 201
  }),
  /** N3 (added 2026-09-28). */
  sendClaimInvite: endpoint({
    method: "POST",
    path: "/admin/creators/:creatorId/claim-invites",
    auth: "admin",
    summary:
      "N3: tell a claimable station's creator it's theirs to claim: `invite` (the station is on air, claim when you like) or `link` (the claim link itself: their permission page's Claim). Held earnings then say Invited or Claim link sent. 422 `no_station` before the station is set up; 422 `no_contact` without a contact email.",
    params: CreatorParams,
    body: z.object({ kind: z.enum(["invite", "link"]) }),
    response: Creator,
    status: 201
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
    summary: "Record the desk's check of the claimant. With the escrow contract live, the verifiers then approve on-chain (what they sign is in `onChain`) and the 72 hours start there",
    params: z.object({ handoverId: Id }),
    response: z.object({
      handoverId: Id,
      /** The earliest it can be paid. With the contract live, the chain decides (after the verifiers' approvals). */
      payableAfter: Timestamp,
      /** Added 2026-09: what each verifier signs, when the escrow contract is live. */
      onChain: z
        .object({ contract: z.string(), escrowStationId: z.number().int(), payee: z.string(), kind: z.enum(["claim", "stop"]), calldata: z.string() })
        .nullable()
        .optional()
    })
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
  }),

  // ---- Added 2026-09-29: N10 ----

  getClaimPage: endpoint({
    method: "GET",
    path: "/claim/:token",
    auth: "public",
    summary: "N10: the creator's claim page, by the link we sent them (their permission link's token), and the claim's status once started. 404 when there's no station to claim from it.",
    params: z.object({ token: z.string().min(8) }),
    response: ClaimPage
  })
};

export type SlotState = z.infer<typeof SlotState>;
export type MarketBoard = z.infer<typeof MarketBoard>;
export type Creator = z.infer<typeof Creator>;
export type CreatorWork = z.infer<typeof CreatorWork>;
export type PermissionPage = z.infer<typeof PermissionPage>;

export type Recipe = z.infer<typeof Recipe>;
export type HeldEarnings = z.infer<typeof HeldEarnings>;
export type ListedSource = z.infer<typeof ListedSource>;
