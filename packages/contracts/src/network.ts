import { z } from "zod";
import { endpoint } from "./core.js";
import { Band, CallSign, ChannelNumber, Colour, DateOnly, Id, Market, Micros, Millis, StationIdent, Timestamp } from "./common.js";
import { CreatorStage } from "./states.js";
import { BreakCadence, ExternalPlays, ExternalSchedule, StationIdCadence } from "./stations.js";

export const SlotState = z.enum(["station", "claimable", "listed", "catalog", "held", "open"]);
export const SLOT_STATE_LABELS = {
  station: "Independent station",
  claimable: "Claimable, run by Opencast",
  listed: "External city stream",
  catalog: "Opencast catalog",
  held: "Held for the waitlist",
  open: "Open"
} as const;

/**
 * A234 (added 2026-09-30): a full station sharing X.1's call sign whose owners no longer include
 * anyone who owns X.1 (an ownership handover, an owner who left). Nothing changes on air by itself;
 * the Network desk decides with the owners. Gone again once they have an owner in common.
 */
export const CallSignOwnersApart = z.object({
  /** The station on X.1 ("12.1 BEAT"). */
  head: StationIdent,
  /** The station sharing its call sign ("12.2 BEAT"). */
  member: StationIdent,
  /** When they stopped having an owner in common (the desk was told then). */
  since: Timestamp,
  /** Who owns each now, by name (empty when nobody does). */
  headOwners: z.array(z.string()),
  memberOwners: z.array(z.string()),
  /** The member's call sign is fixed (it has signed on), so only the desk and its owners can change it. */
  fixed: z.boolean()
});

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
  }),
  /**
   * A234 (added 2026-09-30): stations sharing X.1's call sign whose owners no longer match X.1's, on
   * this band (TV only: radio has no subchannels). Absent from an older API.
   */
  ownersApart: z.array(CallSignOwnersApart).optional()
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
  setup: CreatorSetup.nullable().optional(),
  /**
   * Follow-up Phase 6 (added 2026-09-30): a lead found on a public IPTV list, with its stream
   * address noted. Never on the dial from here: it becomes an external station (with their written
   * permission, or once confirmed public) or a full one (asked like any creator). Null otherwise.
   */
  lead: z
    .object({
      from: z.literal("iptv_list"),
      streamUrl: z.string(),
      /** The list it was found on (an iptv-org address), or null when pasted or uploaded. */
      listUrl: z.string().nullable(),
      tvgId: z.string().nullable(),
      group: z.string().nullable(),
      country: z.string().nullable(),
      logoUrl: z.string().nullable()
    })
    .nullable()
    .optional(),
  /** Phase 6: the external station it became, once listed. */
  listedSourceId: Id.nullable().optional()
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

// ---- External stations (follow-up Phase 6, added 2026-09-30) ----

/**
 * Why an external station may play the way it does. `embed_terms`: the source's terms allow
 * embedding its player (the terms page and the date checked are recorded). `written_permission`:
 * the source said yes in writing to its stream link (a `StreamPermission`). `public_source`: a
 * clearly public source (a government body, public access, a public agency), with the basis.
 */
export const ExternalBasis = z.enum(["embed_terms", "written_permission", "public_source"]);
export type ExternalBasis = z.infer<typeof ExternalBasis>;

/** A calendar or schedule feed's format. */
export const ScheduleFormat = z.enum(["ical", "rss", "json", "xmltv"]);
export type ScheduleFormat = z.infer<typeof ScheduleFormat>;

/**
 * An external station's stream, checked every minute: `unchecked` (not yet), `up`, `down` (failing,
 * still on the dial for its first 5 minutes) and `hidden` (down 5 minutes or more: off the dial, the
 * guide and the swipe order until it's back).
 */
export const ExternalHealth = z.enum(["unchecked", "up", "down", "hidden"]);
export type ExternalHealth = z.infer<typeof ExternalHealth>;

/**
 * A source's written permission for its stream link, kept like a claimable station's permission
 * record: recorded once, never edited, naming exactly the stream address it covers.
 */
export const StreamPermission = z.object({
  id: Id,
  /** Who said yes, and for whom: "Maria Lopez, City Clerk, City of Colton". */
  grantedBy: z.string(),
  grantedOn: DateOnly,
  /** Where the written yes is kept: "Email to network@opencast.tv, Sept 18". */
  evidence: z.string(),
  documentUrl: z.string().nullable(),
  /** The stream address the yes covers. */
  streamUrl: z.string(),
  recordedAt: Timestamp,
  recordedBy: z.string().nullable(),
  /** The pipeline lead it came from, when there was one. */
  creatorId: Id.nullable()
});
export type StreamPermission = z.infer<typeof StreamPermission>;

/** One stretch of an external station's stream being down, for the history on External sources. */
export const ExternalOutage = z.object({
  id: Id,
  /** The first failed check. */
  downSince: Timestamp,
  /** When it came off the dial (5 minutes down); null for a blip that was back sooner. */
  hiddenAt: Timestamp.nullable(),
  /** When it was back; null while it's still down. */
  backAt: Timestamp.nullable(),
  /** What the last failed check saw: "HTTP 404", "No answer in 5 seconds", "Not a stream playlist". */
  detail: z.string().nullable(),
  /**
   * Added 2026-09-30 (A215): how it ended. `back`: the stream answered again (`backAt`). `address_changed`:
   * the listing's address (or how it plays) was changed while it was down, so checks started afresh on
   * the new one. `removed`: taken off the dial for good while it was down. Absent: `back`.
   */
  ended: z.enum(["back", "address_changed", "removed"]).optional()
});
export type ExternalOutage = z.infer<typeof ExternalOutage>;

/** What `updateListedSource` can change, as its change history names it (added 2026-09-30, A215). */
export const ListedField = z.enum(["name", "description", "streamUrl", "plays", "embedTerms", "calendarUrl", "calendarFormat", "schedule", "guideCheckedAgainst", "guideCheckedOn", "channel", "callSign"]);
export type ListedField = z.infer<typeof ListedField>;

/**
 * One entry in an external station's change history (added 2026-09-30, A215): who, when, and each
 * field from → to. `changed`: an edit (`updateListedSource`). `removed`: taken off the dial for good.
 * `restored`: put back on the list. Addresses are shown in full to admins, and as their host
 * (`https://colton.example.gov/…`) to everyone else on the desk.
 */
export const ListedChange = z.object({
  id: Id,
  at: Timestamp,
  /** Who made it (their display name), or null for the system. */
  by: z.string().nullable(),
  action: z.enum(["changed", "removed", "restored"]),
  fields: z.array(z.object({ field: ListedField, from: z.string().nullable(), to: z.string().nullable() })),
  /**
   * What the change did: `waits_for_evidence` (the evidence no longer covers what plays: a new stream
   * address, an embed on another host, or a new way to play), `checks_restart` (a new address or way
   * to play, checked afresh), `schedule_reread` (the feed or guide data read again). Empty for the rest.
   */
  effects: z.array(z.enum(["waits_for_evidence", "checks_restart", "schedule_reread"]))
});
export type ListedChange = z.infer<typeof ListedChange>;

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
  upcoming: z.number().int(),
  // ---- Added 2026-09-30 (follow-up Phase 6) ----
  /** How it plays: the source's official embed (`streamUrl` is the embed's address) or its stream link. */
  plays: ExternalPlays.optional(),
  /** A stream link's format, from its address or its playlist; null for an embed. */
  streamFormat: z.enum(["hls", "dash"]).nullable().optional(),
  /** The evidence it may play that way. `basis` null: not established yet (it's not on the dial). */
  evidence: z
    .object({
      basis: ExternalBasis.nullable(),
      termsUrl: z.string().nullable(),
      termsCheckedOn: DateOnly.nullable(),
      /** A public source's basis: "US government, public", "Public body, stream published for the public". */
      publicBasis: z.string().nullable(),
      permission: StreamPermission.nullable(),
      /** What's being waited on, in the desk's words: "Asked Sept 22". */
      note: z.string().nullable()
    })
    .optional(),
  /** Where "what's on" comes from. `url`: the feed; `checkedAgainst`: the published schedule guide data is checked against. */
  schedule: z
    .object({
      source: ExternalSchedule,
      format: ScheduleFormat.nullable(),
      url: z.string().nullable(),
      checkedAgainst: z.string().nullable(),
      checkedOn: DateOnly.nullable()
    })
    .optional(),
  /** On the dial now: evidence in place, in its market, and not hidden for being down. */
  onDial: z.boolean().optional(),
  /**
   * Why it isn't on the dial, when it isn't: `terms_unclear`, `needs_permission`, `needs_terms`
   * (an embed with no terms page recorded), `dash_not_played` (a DASH-only stream link, A201),
   * `other_market` (A200), `down` (hidden while its stream is down). Null when it's on the dial.
   */
  waiting: z.enum(["terms_unclear", "needs_terms", "needs_permission", "dash_not_played", "other_market", "down"]).nullable().optional(),
  /** The stream's checks: the state, since when, the last check and what it saw. */
  health: z
    .object({
      state: ExternalHealth,
      since: Timestamp.nullable(),
      lastCheckedAt: Timestamp.nullable(),
      detail: z.string().nullable()
    })
    .optional(),
  /** The latest outages, newest first (up to 5; `listExternalOutages` has the rest). */
  outages: z.array(ExternalOutage).optional(),
  /** The pipeline lead it came from (an IPTV-list channel), if any. */
  creatorId: Id.nullable().optional(),
  // ---- Added 2026-09-30 (A215: changing a listing, and taking it off for good) ----
  /**
   * Taken off the dial for good (archived, never deleted): when, by whom, and the channel it had. As
   * for a full station that signs off for good, the channel stays held for it until `channelHeldUntil`
   * (90 days) and is freed then ("Put back on the list" after that needs it, or another, still free);
   * its call sign stays its own, held a year on the waitlist's side too. `listingState` is
   * `not_listed` and `onDial` false. Null while it's listed.
   */
  removed: z
    .object({
      at: Timestamp,
      by: z.string().nullable(),
      channel: ChannelNumber.nullable(),
      channelHeldUntil: Timestamp,
      /** Added 2026-09-30 (A231): taken off with the listing on X.1 whose call sign it shares (its id); "Put back" on that one brings it back too. */
      withListing: Id.nullable().optional()
    })
    .nullable()
    .optional(),
  /** Written permissions recorded earlier for this listing that don't cover its address now (kept, never edited), newest first. */
  earlierPermissions: z.array(StreamPermission).optional(),
  // ---- Added 2026-09-30: shared call signs (A229) ----
  /**
   * One brand's streams sharing a call sign on one channel's subchannels (15.1 SBCO, 15.2 SBCO,
   * 15.3 SBCO). `head`: this listing is on X.1 and its call sign is shared; `member`: it's on X.n
   * sharing X.1's. `members`: the streams sharing it, in channel order (the ones on the list; one
   * taken off the dial isn't counted). Each keeps its own evidence, health, outages and watch data:
   * only the call sign is shared. Null when it shares nothing.
   */
  family: z
    .object({ role: z.enum(["head", "member"]), head: StationIdent, members: z.array(StationIdent) })
    .nullable()
    .optional()
});

/** The evidence a listing is added with, or recorded later (`recordListedEvidence`). */
export const ListedEvidenceInput = z.object({
  /** An embed: the terms page that allows embedding, and the day it was read. */
  termsUrl: z.url().optional(),
  termsCheckedOn: DateOnly.optional(),
  /** A clearly public source: the basis, in words. */
  publicBasis: z.string().min(3).max(120).optional(),
  /** The source's written permission for its stream link. */
  permission: z
    .object({ grantedBy: z.string().min(3).max(160), grantedOn: DateOnly, evidence: z.string().min(3).max(300), documentUrl: z.url().optional() })
    .optional(),
  /** What's being waited on: "Asked Sept 22". */
  note: z.string().max(160).optional()
});

/** A channel found on a public IPTV list (an M3U or iptv-org's JSON), before it's imported. */
export const IptvChannel = z.object({
  name: z.string().min(1).max(160),
  streamUrl: z.url(),
  tvgId: z.string().max(120).nullable(),
  group: z.string().max(120).nullable(),
  country: z.string().max(8).nullable(),
  logoUrl: z.string().max(500).nullable()
});
export type IptvChannel = z.infer<typeof IptvChannel>;

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
    auth: "desk",
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
    auth: "desk",
    summary: "The creator pipeline, sorted by next action",
    query: z.object({ marketId: Id.optional(), stage: CreatorStage.optional() }),
    response: z.array(Creator)
  }),
  addCreator: endpoint({
    method: "POST",
    path: "/admin/creators",
    auth: "desk",
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
    auth: "desk",
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
  listWorks: endpoint({ method: "GET", path: "/admin/creators/:creatorId/works", auth: "desk", summary: "Works found on the creator's source", params: CreatorParams, response: z.array(CreatorWork) }),
  addWorks: endpoint({
    method: "POST",
    path: "/admin/creators/:creatorId/works",
    auth: "desk",
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
    auth: "desk",
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
    auth: "desk",
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
  listListedSources: endpoint({
    method: "GET",
    path: "/admin/listed-sources",
    auth: "desk",
    summary: "City and county streams. A215 (added 2026-09-30): the listed ones by default; `show=removed` lists the ones taken off the dial for good",
    query: z.object({ marketId: Id.optional(), show: z.enum(["listed", "removed"]).optional() }),
    response: z.array(ListedSource)
  }),
  addListedSource: endpoint({
    method: "POST",
    path: "/admin/listed-sources",
    auth: "admin",
    summary:
      "List a source as an external station: its official embed (where its terms allow embedding) or its stream link (with its written permission, or a clearly public source). On the dial only once the evidence is in; same channel and call sign rules as full stations. Added 2026-09-30 (A229): `shareCallSign` on X.n beside an external X.1 shares its call sign (\"Same brand as 15.1\").",
    body: z.object({
      marketId: Id,
      band: Band,
      channel: ChannelNumber,
      /** Optional (2026-09-30) only with `shareCallSign`, which takes X.1's; required otherwise. */
      callSign: CallSign.optional(),
      name: z.string().min(1),
      description: z.string().max(160).optional(),
      /** The embed's address, or the stream link. */
      streamUrl: z.url(),
      /** An embed's terms. Required for an embed (Phase 6 made it optional for stream links). */
      embedTerms: z.enum(["allowed", "unclear"]).optional(),
      calendarUrl: z.url().optional(),
      // ---- Added 2026-09-30 (follow-up Phase 6) ----
      /** Default `embed`. */
      plays: ExternalPlays.optional(),
      /** The feed's format (`calendarUrl`); worked out from the address when absent. */
      calendarFormat: ScheduleFormat.optional(),
      /** Guide data instead of a feed: the published schedule it was checked against, and when. */
      guideData: z.object({ checkedAgainst: z.url(), checkedOn: DateOnly }).optional(),
      evidence: ListedEvidenceInput.optional(),
      /** A pipeline lead (an IPTV-list channel) becoming this external station. */
      creatorId: Id.optional(),
      /** The source is outside this market (a county meeting that covers two). Waits unless `external.other_markets` allows it (A200). */
      outsideMarket: z.boolean().optional(),
      /**
       * Added 2026-09-30 (A229): "Same brand as 15.1 SBCO". On X.n (n ≥ 2) beside an external
       * station on X.1, share its call sign; `callSign` can then be left out (or must be X.1's).
       * 422 `cannot_share` anywhere else (a full station on X.1, another major or market, X.1 itself).
       */
      shareCallSign: z.boolean().optional()
    }),
    response: ListedSource,
    status: 201
  }),
  recordListedEvidence: endpoint({
    method: "POST",
    path: "/admin/listed-sources/:sourceId/evidence",
    auth: "admin",
    summary:
      "Phase 6: record the evidence a listing was waiting for (terms checked, written permission, a public basis, or a note). It goes on the dial once the evidence is complete. A permission is recorded once and never edited.",
    params: z.object({ sourceId: Id }),
    body: ListedEvidenceInput.extend({ embedTerms: z.enum(["allowed", "unclear"]).optional() }),
    response: ListedSource
  }),
  listExternalOutages: endpoint({
    method: "GET",
    path: "/admin/listed-sources/:sourceId/outages",
    auth: "desk",
    summary: "Phase 6: an external station's outages, newest first (the last 90 days)",
    params: z.object({ sourceId: Id }),
    response: z.array(ExternalOutage)
  }),
  previewIptvList: endpoint({
    method: "POST",
    path: "/admin/creators/iptv/preview",
    auth: "desk",
    summary:
      "Phase 6: read a public IPTV list (a pasted or uploaded M3U, or an iptv-org address: M3U or JSON) and list its channels, each with whether it's already a lead or an external station. Nothing is saved. Only the list is fetched, never a stream.",
    body: z.object({ m3u: z.string().max(5_000_000).optional(), url: z.url().optional() }).refine((b) => Boolean(b.m3u) !== Boolean(b.url), "Paste a list or give its address"),
    response: z.object({
      listUrl: z.string().nullable(),
      channels: z.array(IptvChannel.extend({ already: z.enum(["lead", "external"]).nullable() })),
      /** Entries that weren't channels with an http(s) address. */
      skipped: z.number().int()
    })
  }),
  importIptvLeads: endpoint({
    method: "POST",
    path: "/admin/creators/iptv/import",
    auth: "desk",
    summary:
      "Phase 6: import IPTV-list channels into the creator pipeline as leads (stage `found`), with their stream addresses noted. Never on the dial from here. A channel already a lead or an external station (by its stream address) is skipped.",
    body: z.object({ marketId: Id, listUrl: z.url().optional(), channels: z.array(IptvChannel).min(1).max(100) }),
    response: z.object({ imported: z.array(Creator), skipped: z.number().int() }),
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

  // ---- Added 2026-09-30: A215, changing a listing and taking it off for good ----

  updateListedSource: endpoint({
    method: "PATCH",
    path: "/admin/listed-sources/:sourceId",
    auth: "admin",
    summary:
      "A215: change a listing: its name, description, address, how it plays, the embed terms, the schedule feed or guide data, and its channel and call sign (the rules for listing). An edit never puts anything on the dial without evidence that covers what now plays: a written permission covers one exact stream address, so a new address waits for new evidence; embed terms stay for an address on the same host and wait for one on another; a public basis stays; a new way to play needs its own evidence. A new address or way to play is checked afresh (an open outage ends); a new schedule is read again. Every change is kept in the listing's history. 409 `removed` for a listing taken off the dial.",
    params: z.object({ sourceId: Id }),
    body: z
      .object({
        name: z.string().min(1).optional(),
        description: z.string().max(160).nullable().optional(),
        /** The embed's address, or the stream link. */
        streamUrl: z.url().optional(),
        plays: ExternalPlays.optional(),
        /** An embed's terms. */
        embedTerms: z.enum(["allowed", "unclear"]).optional(),
        /** What's on: a feed (`calendarUrl`, `calendarFormat` or null to work it out), guide data (`calendarUrl` and `guideData`), or none. */
        schedule: z
          .discriminatedUnion("source", [
            z.object({ source: z.literal("feed"), calendarUrl: z.url(), calendarFormat: ScheduleFormat.nullable().optional() }),
            z.object({ source: z.literal("guide_data"), calendarUrl: z.url(), calendarFormat: ScheduleFormat.nullable().optional(), guideData: z.object({ checkedAgainst: z.url(), checkedOn: DateOnly }) }),
            z.object({ source: z.literal("none") })
          ])
          .optional(),
        /** A new channel, in the same band. */
        channel: ChannelNumber.optional(),
        /**
         * On X.1 with a family (A229): the whole family's call sign changes with it, and the old one is
         * held a year for the family. On a family member: its own call sign, so it leaves the family.
         */
        callSign: CallSign.optional(),
        /** Added 2026-09-30 (A229): `true` shares X.1's call sign (on X.n beside an external X.1); `false` with `callSign` leaves the family. */
        shareCallSign: z.boolean().optional()
      })
      .refine((b) => Object.values(b).some((v) => v !== undefined), "Change at least one thing"),
    response: ListedSource
  }),
  listListedChanges: endpoint({
    method: "GET",
    path: "/admin/listed-sources/:sourceId/changes",
    auth: "desk",
    summary: "A215: a listing's change history, newest first: each change (who, when, which fields from → to, and what it did), taking it off the dial and putting it back. Addresses in full to admins, as their host to the rest of the desk",
    params: z.object({ sourceId: Id }),
    response: z.array(ListedChange)
  }),
  removeListedSource: endpoint({
    method: "POST",
    path: "/admin/listed-sources/:sourceId/remove",
    auth: "admin",
    summary:
      "A215: take a listing off the dial for good. Archived, never deleted: its permission records, outage history, change history, watch data and lead link stay. It leaves the dial, the guide, search and the swipe order at once, its checks and schedule reads stop. Like a full station that signs off for good, its channel is held for it 90 days and then freed, and its call sign stays its own (held a year on the waitlist's side). Its pipeline lead goes back to the stage it had before it went on air (Found when that wasn't recorded) and is a lead again. 409 `removed` when it already is. Added 2026-09-30 (A231): X.1 whose call sign stations share goes with them, only with `withFamily` (409 `family` names them otherwise).",
    params: z.object({ sourceId: Id }),
    /**
     * Added 2026-09-30 (A229): X.1 with a family (streams sharing its call sign) is taken off with
     * its family, and only when `withFamily` says so (409 `family` names them otherwise). "Put back
     * on the list" on X.1 brings back the ones taken off with it.
     */
    body: z.object({ withFamily: z.boolean().optional() }).optional(),
    response: ListedSource
  }),
  restoreListedSource: endpoint({
    method: "POST",
    path: "/admin/listed-sources/:sourceId/restore",
    auth: "admin",
    summary:
      "A215: put a listing taken off the dial back on the list, on its old channel (or `channel`, another free one in its band, by the rules for listing). It comes back with its evidence as recorded and waits for its checks (`health: unchecked`); its lead goes back to On air once the evidence holds. 409 `channel_taken` when the channel has gone to another station or a hold, `call_sign_taken` when its call sign has (after its hold), `not_removed` when it's listed.",
    params: z.object({ sourceId: Id }),
    body: z.object({ channel: ChannelNumber.optional() }),
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
export type CallSignOwnersApart = z.infer<typeof CallSignOwnersApart>;
export type Creator = z.infer<typeof Creator>;
export type CreatorWork = z.infer<typeof CreatorWork>;
export type PermissionPage = z.infer<typeof PermissionPage>;

export type Recipe = z.infer<typeof Recipe>;
export type HeldEarnings = z.infer<typeof HeldEarnings>;
export type ListedSource = z.infer<typeof ListedSource>;
