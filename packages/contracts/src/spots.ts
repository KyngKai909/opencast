import { z } from "zod";
import { endpoint } from "./core.js";
import { DateOnly, Id, Micros, Millis, Ok, StationIdent, Timestamp } from "./common.js";
import { OrderState, SponsorshipDeclineReason, SponsorshipState, SpotState } from "./states.js";
import { PreviewStatus } from "./catalog.js";
import { RelayViewersLine, RelayViewersPart } from "./platforms.js";

// Businesses ------------------------------------------------------------------

export const CustomersWhere = z.enum(["location", "service_area", "online"]);

export const BusinessLocation = z.object({
  id: Id,
  kind: z.enum(["location", "service_area"]),
  label: z.string().nullable(),
  /** Private: only the business sees it. Stations see the city. */
  streetAddress: z.string().nullable(),
  city: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  radiusMiles: z.number().nullable()
});

export const Business = z.object({
  id: Id,
  name: z.string(),
  category: z.string(),
  about: z.string().nullable(),
  website: z.string().nullable(),
  logoUrl: z.string().nullable(),
  customersWhere: CustomersWhere,
  locations: z.array(BusinessLocation),
  marketIds: z.array(Id),
  warnDays: z.array(z.number().int()),
  autoTopUp: z.object({ on: z.boolean(), amountMicros: Micros.nullable(), belowDays: z.number().int() }),
  receiptsEmail: z.string().nullable(),
  legalName: z.string().nullable(),
  einLast4: z.string().nullable(),
  createdAt: Timestamp,
  /** P25 (added 2026-09-29): the name in tight places ("Orange Street"): its own, else the name. */
  shortName: z.string().optional(),
  /** P11 (added 2026-09-29): the square drawn until a logo is uploaded: initials and a colour. */
  logoMark: z.object({ initials: z.string(), colour: z.string() }).optional(),
  /** P12 (added 2026-09-29): the Redeem tool is on (the default, except for online businesses). */
  redeemOn: z.boolean().optional()
});
export type Business = z.infer<typeof Business>;

const LocationInput = z.object({
  kind: z.enum(["location", "service_area"]),
  label: z.string().max(80).optional(),
  streetAddress: z.string().max(200).optional(),
  city: z.string().min(1).max(80),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMiles: z.number().positive().max(200).optional()
});

// Spots -----------------------------------------------------------------------

/**
 * P1, P4 (added 2026-09-29): the keys an upload check's `detail` carries, beside whatever else the
 * check recorded. `note`: the line under the check ("Exactly a :30 spot"). `box`: where on the frame
 * (fractions of its width and height): the problem (safe_area, once frames are analysed) or where
 * the code and QR sit (code). `text`: words found there. `fromMs`/`toMs`: the part of the spot it
 * covers (the code shows for the last :10). `placement`: the code's corner.
 */
export const CodePlacement = z.enum(["bottom_left", "bottom_right", "top_left", "top_right"]);
export const UploadCheckDetail = z
  .object({
    note: z.string().optional(),
    box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
    text: z.string().optional(),
    fromMs: Millis.optional(),
    toMs: Millis.optional(),
    placement: CodePlacement.optional()
  })
  .loose();

export const UploadCheck = z.object({
  check: z.enum(["length", "picture", "safe_area", "captions", "loudness", "code"]),
  result: z.enum(["fine", "fixed", "for_you", "pending"]),
  label: z.string(),
  detail: z.record(z.string(), z.unknown()).nullable()
});

export const Targeting = z.object({
  /** Distance from the business's locations (location and service-area businesses). */
  withinMiles: z.number().positive().nullable(),
  locationIds: z.array(Id),
  /** Online businesses: whole markets. */
  marketIds: z.array(Id),
  stationCategories: z.array(z.string()),
  dayparts: z.array(z.enum(["mornings", "afternoons", "evenings", "late_night"])),
  excludedStationIds: z.array(Id),
  /** P8 (added 2026-09-29): the bands it airs on; missing or empty is both. A radio station out of it reads "Radio band, not chosen". */
  bands: z.array(z.enum(["tv", "radio"])).optional()
});

/** P23 (added 2026-09-29): the still a spot shows in lists: a captured frame, or its colour and words. */
export const SpotStill = z.object({
  /** A proof frame from its latest airing, once it has aired. */
  stillUrl: z.string().nullable(),
  colour: z.string(),
  /** The short line on the thumbnail: the title. */
  label: z.string(),
  /** Its title card, when known (not read from the file yet: null). */
  headline: z.string().nullable(),
  /** Its on-screen offer, if it has a code. */
  line: z.string().nullable()
});

/**
 * P6 (added 2026-09-29): the business's side of a pause. `by_you`: the business paused it (it's
 * `waiting_for_you`). `lastHold`: the last money held for it before the pause. `held`: airings
 * placed before the pause, which still air (`airedAt` once the last of them has). `stations`: each
 * station that had it in its rotation, what it put in its place (from its as-run log since the
 * pause), and whether it was told when the spot came back.
 */
export const SpotPauseStory = z.object({
  reason: z.enum(["budget_spent", "balance", "by_you"]),
  pausedAt: Timestamp,
  lastHold: z.object({ amountMicros: Micros, station: StationIdent }).nullable(),
  held: z.object({ airings: z.number().int(), airedAt: Timestamp.nullable() }),
  stations: z.array(z.object({ station: StationIdent, filledWith: z.enum(["backup_rotation", "another_spot", "station_id"]), toldWhenBack: z.boolean() }))
});

/** P6 (added 2026-09-29): when and why it came back, and the stations told (none has it in rotation until it adds it again). */
export const SpotBackStory = z.object({ backAt: Timestamp, reason: z.enum(["raised_budget", "added_money", "resumed"]), told: z.array(StationIdent) });

export const Spot = z.object({
  id: Id,
  businessId: Id,
  title: z.string(),
  lengthSec: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  category: z.string(),
  state: SpotState,
  /** For "In rotation on {n} stations". */
  inRotationOn: z.number().int(),
  rate: z.object({ kind: z.enum(["per_thousand", "per_airing"]), micros: Micros, perAiringMaxMicros: Micros.nullable() }),
  budget: z.object({
    totalMicros: Micros,
    dailyCapMicros: Micros.nullable(),
    /** Held and spent, counted against the budget. */
    usedMicros: Micros,
    usedTodayMicros: Micros
  }),
  startsOn: DateOnly.nullable(),
  endsOn: DateOnly.nullable(),
  targeting: Targeting,
  code: z
    .object({
      code: z.string(),
      offer: z.string(),
      windowDays: z.number().int(),
      // ---- P4 (added 2026-09-29) ----
      /** Who chose the letters: Opencast, unless the business typed its own. */
      pickedBy: z.enum(["opencast", "business"]).optional(),
      /** Each customer's first use counts; a second is refused. */
      oncePerCustomer: z.boolean().optional(),
      /** How long an offer saved to a phone keeps (the offer's window). */
      savedForDays: z.number().int().optional(),
      /** Where the code and QR sit, and for how long at the end of the spot. */
      placement: CodePlacement.optional(),
      showsForLastMs: Millis.optional()
    })
    .nullable(),
  file: z
    .object({
      url: z.string(),
      /**
       * An HLS preview (added in 2026-09). Since 2026-09-29 a short-cache playlist over the spot's
       * prepared segments, once it's prepared: asked for when it goes to review, there after.
       */
      previewUrl: z.string().nullable().optional(),
      /** Added 2026-09-29: see `PreviewStatus` ("Being prepared" while `preparing`). */
      previewStatus: PreviewStatus.nullable().optional(),
      durationMs: Millis,
      originalFilename: z.string().nullable(),
      checks: z.array(UploadCheck)
    })
    .nullable(),
  productionOrderId: Id.nullable(),
  createdAt: Timestamp,
  // ---- Added 2026-09-29 (the business app's requests) ----
  /** P23. */
  still: SpotStill.optional(),
  /** P5: the stations with it in their rotation (not the backup rotation). */
  inRotationStations: z.array(StationIdent).optional(),
  /** P6: while it's paused for its budget, its balance or by the business (not a daily cap). */
  pause: SpotPauseStory.nullable().optional(),
  /** P6: after it came back from one of those. */
  back: SpotBackStory.nullable().optional(),
  /** P7: what it has spent a day lately (the last 7 days, or since it was listed); null before anything was held for it. */
  pacePerDayMicros: Micros.nullable().optional()
});
export type Spot = z.infer<typeof Spot>;

export const TargetMatch = z.object({
  station: StationIdent,
  category: z.string().nullable(),
  miles: z.number().nullable(),
  included: z.boolean(),
  /** Why a nearby station is left out: "not chosen", "blocks this category", "From Monday". */
  reason: z.string().nullable(),
  estimatedCostPerAiringMicros: z.object({ low: Micros, high: Micros }).nullable()
});

// The station side --------------------------------------------------------------

/** P23 (added 2026-09-29): a market spot's preview. */
export const SpotPreview = z.object({
  /** The spot's file (a storage URL); null until it has one. */
  url: z.string().nullable(),
  /** The still's colour while there's no picture: the business's, derived from its id. */
  colour: z.string(),
  /** The line on the still: its on-screen offer, else its title. */
  line: z.string().nullable(),
  /** Added 2026-09-29: an HLS preview over the spot's prepared segments, once it's prepared. */
  previewUrl: z.string().nullable().optional(),
  /** Added 2026-09-29: see `PreviewStatus`. */
  previewStatus: PreviewStatus.nullable().optional()
});

/**
 * P6 (added 2026-09-29): why a spot paused, as the station sees it. `heldTonightMs`: the time it
 * still had in this station's breaks from the pause to the end of the station's day (held, so it
 * airs); `filledBy`: businesses whose backup-rotation spots aired here since.
 */
export const PauseStory = z.object({
  reason: z.enum(["budget_spent", "balance"]),
  pausedAt: Timestamp,
  heldTonightMs: Millis,
  filledBy: z.array(z.string())
});

/** P6 (added 2026-09-29): why it came back. */
export const BackStory = z.object({ reason: z.enum(["raised_budget", "added_money"]), backAt: Timestamp });

export const MarketSpot = z.object({
  spot: z.object({
    id: Id,
    title: z.string(),
    lengthSec: z.number().int(),
    category: z.string(),
    onScreen: z.string().nullable(),
    /** P23 (added 2026-09-29). */
    preview: SpotPreview.optional()
  }),
  business: z.object({
    id: Id,
    name: z.string(),
    category: z.string(),
    city: z.string().nullable(),
    online: z.boolean(),
    /** P25 (added 2026-09-29). */
    shortName: z.string().optional()
  }),
  /** P6 (added 2026-09-29): while it's paused for its budget or balance. */
  pause: PauseStory.nullable().optional(),
  /** P6 (added 2026-09-29): once it's back after one of those, until it's back in this station's rotation. */
  back: BackStory.nullable().optional(),
  miles: z.number().nullable(),
  rate: z.object({ kind: z.enum(["per_thousand", "per_airing"]), micros: Micros }),
  upToPerDay: z.number().int().nullable(),
  listedUntil: DateOnly.nullable(),
  /** Roughly how many days the balance lasts at the current pace. Never the balance itself. */
  runway: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("days"), days: z.number().int() }),
    z.object({ kind: z.literal("tops_up") })
  ]),
  inRotation: z.enum(["main", "backup"]).nullable(),
  customersFromThisStation: z.number().int(),
  state: z.enum(["in_the_market", "in_rotation", "paused", "its_back"])
});

export const Rotation = z.object({
  kind: z.enum(["main", "backup"]),
  spots: z.array(z.object({ spotId: Id, title: z.string(), business: z.string(), lengthSec: z.number().int(), paused: z.boolean() }))
});

/** G1 (added 2026-09-29): one thing in a break, as the station's Breaks page lists it. */
export const BreakContent = z.object({
  id: z.string(),
  kind: z.enum(["producer", "station_id", "bumper", "underwriting", "spot", "sponsor", "open"]),
  title: z.string(),
  lengthMs: Millis,
  spotId: Id.nullable(),
  business: z.string().nullable(),
  shortName: z.string().nullable(),
  /** Which rotation placed it (spots only). */
  rotation: z.enum(["main", "backup"]).nullable(),
  note: z.string().nullable()
});
export type BreakContent = z.infer<typeof BreakContent>;

export const Avail = z.object({
  breakStartsAt: Timestamp,
  context: z.string(),
  lengthMs: Millis,
  openMs: Millis,
  producerShareMs: Millis,
  /** G1 (added 2026-09-29): the stored break's id (null before it's stored), its origin and contents. */
  breakId: Id.nullable().optional(),
  origin: z.enum(["rule", "cued_live", "carried_barter"]).optional(),
  contents: z.array(BreakContent).optional()
});

// Sponsorships ------------------------------------------------------------------

export const CreditCheck = z.object({
  passes: z.boolean(),
  flags: z.array(
    z.object({
      kind: z.enum(["price_or_offer", "comparison", "call_to_action"]),
      text: z.string(),
      start: z.number().int(),
      end: z.number().int(),
      suggestion: z.string(),
      /** P17 (added 2026-09-29): the words the flag is about, for its title ("the best"). */
      quote: z.string().optional()
    })
  ),
  /** P17 (added 2026-09-29): the part that passes, "who you are and where": the text without the flagged words. Null when nothing's left. */
  who: z.string().nullable().optional()
});

export const Sponsorship = z.object({
  id: Id,
  business: z.object({ id: Id, name: z.string() }),
  station: StationIdent,
  program: z.object({ id: Id, title: z.string() }).nullable(),
  monthlyMicros: Micros,
  creditText: z.string(),
  state: SponsorshipState,
  declineReason: SponsorshipDeclineReason.nullable(),
  startsOn: DateOnly,
  renewsOn: DateOnly.nullable(),
  createdAt: Timestamp,
  /**
   * P22 (added 2026-09-29): the sponsor as the station sees it: its category, the city it gives
   * (or null, online), miles from the station's studio to its nearest place, and what else it
   * sponsors ("Council Watch on CIVC"). On the station's list only.
   */
  profile: z.object({ category: z.string(), city: z.string().nullable(), miles: z.number().nullable(), elsewhere: z.array(z.string()) }).optional(),
  /** L1 (added 2026-09-29): the program's format in words ("Weekly, live"); null for a whole station. */
  programFormat: z.string().nullable().optional()
});

export const SponsorshipSetting = z.object({
  programId: Id.nullable(),
  title: z.string(),
  minMonthlyMicros: Micros,
  maxSponsors: z.number().int().min(0),
  closed: z.boolean(),
  sponsors: z.number().int(),
  /** Carried programs are sponsored through their maker: "REEL's to sponsor". */
  sponsoredThrough: StationIdent.nullable(),
  /** L1 (added 2026-09-29): the program's format in words ("Weekly, live", "Series"); null for the station row. */
  format: z.string().nullable().optional()
});

/**
 * P17 (added 2026-09-29): the members' credit: the name read in it ("members of Inland Beat"), how
 * many members (active pledges) and how many asked to be named on air.
 */
export const MembersCredit = z.object({ creditName: z.string(), members: z.number().int(), named: z.number().int() });

// Production orders -------------------------------------------------------------

export const OrderNote = z.object({
  id: Id,
  timecodeMs: Millis.nullable(),
  author: z.string().nullable(),
  body: z.string(),
  makersMistake: z.boolean(),
  round: z.number().int(),
  createdAt: Timestamp
});

export const ProductionOrder = z.object({
  id: Id,
  business: z.object({ id: Id, name: z.string() }),
  maker: StationIdent,
  title: z.string(),
  lengthSec: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  about: z.string(),
  mustSay: z.string().nullable(),
  neededBy: DateOnly,
  state: OrderState,
  quote: z
    .object({ priceMicros: Micros, deliverBy: DateOnly, roundsIncluded: z.number().int().min(0).max(2), voicedBy: z.string().nullable() })
    .nullable(),
  roundsUsed: z.number().int(),
  briefFiles: z.array(z.object({ id: Id, url: z.string(), filename: z.string().nullable() })),
  deliveries: z.array(
    z.object({
      id: Id,
      version: z.number().int(),
      url: z.string(),
      /**
       * An HLS preview (added in 2026-09). Since 2026-09-29 a short-cache playlist over the
       * delivery's prepared segments, once it's prepared (asked for when it's delivered).
       */
      previewUrl: z.string().nullable().optional(),
      /** Added 2026-09-29: see `PreviewStatus` ("Being prepared" while `preparing`). */
      previewStatus: PreviewStatus.nullable().optional(),
      createdAt: Timestamp,
      /** P19 (added 2026-09-29): its length; left out when it couldn't be read (or was delivered before this). */
      durationMs: Millis.optional(),
      /** P19 (added 2026-09-29): the spot checks it passed on delivery: "length", "picture", "loudness". */
      checksPassed: z.array(z.string()).optional()
    })
  ),
  notes: z.array(OrderNote),
  deliveredAt: Timestamp.nullable(),
  autoApproveAt: Timestamp.nullable(),
  spotId: Id.nullable(),
  tellMakerWhenListed: z.boolean(),
  createdAt: Timestamp,
  /** P24 (added 2026-09-29): the maker asked to be told when the spot is listed (`tellMeWhenListed`). */
  makerToldWhenListed: z.boolean().optional(),
  /** P24 (added 2026-09-29): the rate its spot is listed at; null until it's listed. */
  listedRate: z.object({ kind: z.enum(["per_thousand", "per_airing"]), micros: Micros }).nullable().optional(),
  // ---- P19 (added 2026-09-29) ----
  /** When the maker last quoted (null for quotes made before this). */
  quotedAt: Timestamp.nullable().optional(),
  approvedAt: Timestamp.nullable().optional(),
  /** What came back to the balance from its hold (cancelled after the delivery date, refunded or split after review). */
  refundedMicros: Micros.optional()
});

// Codes and results --------------------------------------------------------------

export const ResultsAiring = z.object({
  asRunId: Id,
  station: StationIdent,
  spot: z.object({ id: Id, title: z.string(), lengthSec: z.number().int() }),
  startedAt: Timestamp,
  endedAt: Timestamp,
  /** "Before / During / After <program>". */
  programContext: z.string().nullable(),
  airedMs: Millis,
  inFull: z.boolean(),
  /** Averaged over the spot. */
  tunedIn: z.number(),
  costMicros: Micros,
  /** "262 × $8.00 ÷ 1,000 = $2.10". */
  working: z.string(),
  proofFrameUrl: z.string().nullable(),
  scansNextHour: z.number().int(),
  // ---- P15 (added 2026-09-29) ----
  /** Why it aired short ("The break was cut short"); null when it aired in full. */
  shortReason: z.string().nullable().optional(),
  /** When its proof frame was captured. */
  proofCapturedAt: Timestamp.nullable().optional(),
  // ---- Relay viewers (added 2026-09-30, follow-up Phase 3) ----
  /**
   * Per-thousand spots on a station relaying to signed-in YouTube or Twitch: the viewers each
   * platform reported during the spot, and what they cost (apart from `costMicros`, which is
   * Opencast's own viewers). Absent when there's nothing relayed to count.
   */
  relayViewers: z.array(RelayViewersPart).optional()
});

/** P13 (added 2026-09-29): one code's scans, saves and uses in the period, and how the uses were counted. */
export const ResultsCode = z.object({
  code: z.string(),
  spotId: Id,
  spotTitle: z.string(),
  offer: z.string(),
  windowDays: z.number().int(),
  oncePerCustomer: z.boolean(),
  savedForDays: z.number().int(),
  scans: z.number().int(),
  saves: z.number().int(),
  uses: z.number().int(),
  /** Uses by where they were counted; null where that counter isn't connected (and nothing came from it). */
  usesBy: z.object({ clearPay: z.number().int().nullable(), marked: z.number().int(), online: z.number().int().nullable() }),
  /** The station most saves came from. */
  savedMostFrom: StationIdent.nullable()
});

export const Results = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  // ---- P14 (added 2026-09-29) ----
  period: z.enum(["week", "month", "all"]).optional(),
  /** The first and last day covered so far (the market's dates). */
  from: DateOnly.optional(),
  to: DateOnly.optional(),
  /** P13 (added 2026-09-29). */
  codes: z.array(ResultsCode).optional(),
  totals: z.object({
    airings: z.number().int(),
    /** Labelled "People tuned in, added up across airings" — never reach or unique viewers. */
    tunedInAddedUp: z.number().int(),
    spentMicros: Micros,
    scans: z.number().int(),
    saves: z.number().int(),
    uses: z.number().int(),
    customers: z.number().int(),
    /**
     * Relay viewers (added 2026-09-30): spent on them (included in `spentMicros`, which is now
     * Opencast viewers and relay viewers together), and still held waiting for location data.
     */
    relaySpentMicros: Micros.optional(),
    relayWaitingMicros: Micros.optional()
  }),
  byStation: z.array(
    z.object({
      station: StationIdent,
      airings: z.number().int(),
      averageTunedIn: z.number(),
      spentMicros: Micros,
      customers: z.number().int(),
      /** S1 (added 2026-09-29): the station's category ("Music"). */
      category: z.string().nullable().optional()
    })
  ),
  byDaypart: z.array(z.object({ daypart: z.string(), airings: z.number().int(), customers: z.number().int() })),
  bySpot: z.array(z.object({ spotId: Id, title: z.string(), airings: z.number().int(), spentMicros: Micros, customers: z.number().int() })),
  airings: z.array(ResultsAiring),
  /** Relay viewers (added 2026-09-30): one line per platform, "Relay viewers, as reported by YouTube". Absent with none. */
  relayViewers: z.array(RelayViewersLine).optional()
});

// ---- Added 2026-09-29: the business app's requests ----

/** P16: one thing a business can sponsor near it. */
export const SponsorTarget = z.object({
  station: StationIdent,
  /** null: the whole station. */
  program: z.object({ id: Id, title: z.string() }).nullable(),
  /** "Saturdays at 9:00 pm", "Credited in every break, 24 hours", or the program's format. */
  schedule: z.string(),
  programFormat: z.string().nullable(),
  minMonthlyMicros: Micros,
  /** null: the station set no limit. */
  maxSponsors: z.number().int().min(0).nullable(),
  /** Sponsors it has now (requested or approved). */
  sponsors: z.number().int().min(0),
  /** The members' credit read after the sponsors ("members of Inland Beat"), or null. */
  membersCredit: z.string().nullable(),
  /** "In BEAT's breaks during the program". */
  where: z.string()
});

/** P9: how many of a market's stations can carry a category, and which don't. */
export const CategoryReach = z.object({
  category: z.string(),
  marketName: z.string(),
  reached: z.number().int(),
  total: z.number().int(),
  /** Call signs (or names) of the stations that block it. */
  blockedBy: z.array(z.string()),
  /** Categories some stations in the market block, for the line under the bar. */
  sometimesBlocked: z.array(z.string())
});

/** P10: an address or a city, as `LocationInput` needs it. Nothing is stored. */
export const Place = z.object({
  /** Null when only a city was found (a service area). */
  streetAddress: z.string().nullable(),
  city: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  /** The market it's in (within 150 miles of a market's centre), if any. */
  marketId: Id.nullable()
});

/** P20: what the business is connected to. The Clear account itself is the person's (Connect Clear). */
export const Connections = z.object({
  clearPay: z.object({ connected: z.boolean(), connectedAt: Timestamp.nullable().optional() }),
  checkout: z.object({
    connected: z.boolean(),
    provider: z.enum(["shopify", "stripe", "square"]).nullable(),
    connectedAt: Timestamp.nullable().optional(),
    /** Where the checkout sends its order webhooks (paste it into the provider's webhook settings). Owner only; null for others. */
    webhookUrl: z.string().nullable().optional()
  })
});

const RedeemResult = z.object({
  valid: z.boolean(),
  firstUse: z.boolean(),
  countsAsCustomer: z.boolean(),
  savedFrom: StationIdent.nullable(),
  message: z.string(),
  // ---- B5, P12 (added 2026-09-29) ----
  code: z.string().optional(),
  offer: z.string().nullable().optional(),
  /** When this customer saved the offer, if they did. */
  savedAt: Timestamp.nullable().optional(),
  spotTitle: z.string().nullable().optional(),
  /** Codes marked used at the counter today (the business's market day). */
  redeemedToday: z.number().int().optional()
});

const BusinessParams = z.object({ businessId: Id });
const SpotParams = z.object({ spotId: Id });
const StationParams = z.object({ stationId: Id });
const OrderParams = z.object({ orderId: Id });

export const spotsApi = {
  createBusiness: endpoint({
    method: "POST",
    path: "/businesses",
    auth: "user",
    summary: "Start a business account. The creator is its owner.",
    body: z.object({
      name: z.string().min(1).max(120),
      category: z.string().min(1).max(80),
      about: z.string().max(300).optional(),
      website: z.url().optional(),
      customersWhere: CustomersWhere,
      locations: z.array(LocationInput).default([]),
      marketIds: z.array(Id).default([])
    }),
    response: Business,
    status: 201
  }),
  getBusiness: endpoint({ method: "GET", path: "/businesses/:businessId", auth: "user", summary: "Profile and settings", params: BusinessParams, response: Business }),
  updateBusiness: endpoint({
    method: "PATCH",
    path: "/businesses/:businessId",
    auth: "user",
    summary: "Change the profile, where customers are, warnings and auto top-up (owner; managers can't change funding)",
    params: BusinessParams,
    body: z
      .object({
        name: z.string().min(1).max(120),
        category: z.string().min(1).max(80),
        about: z.string().max(300).nullable(),
        website: z.url().nullable(),
        logoUrl: z.string().nullable(),
        customersWhere: CustomersWhere,
        marketIds: z.array(Id),
        warnDays: z.array(z.number().int().min(1).max(14)).min(1),
        autoTopUp: z.object({ on: z.boolean(), amountMicros: Micros.nullable(), belowDays: z.number().int().min(1).max(14) }),
        receiptsEmail: z.email().nullable(),
        legalName: z.string().nullable(),
        ein: z.string().regex(/^\d{2}-?\d{7}$/).nullable(),
        /** P25 (added 2026-09-29): null goes back to the name. */
        shortName: z.string().min(1).max(24).nullable(),
        /** P12 (added 2026-09-29): turn the Redeem tool on or off. */
        redeemOn: z.boolean()
      })
      .partial(),
    response: Business
  }),
  addLocation: endpoint({
    method: "POST",
    path: "/businesses/:businessId/locations",
    auth: "user",
    summary: "Add a location or service area",
    params: BusinessParams,
    body: LocationInput,
    response: Business,
    status: 201
  }),
  removeLocation: endpoint({
    method: "DELETE",
    path: "/businesses/:businessId/locations/:locationId",
    auth: "user",
    summary: "Remove a location",
    params: z.object({ businessId: Id, locationId: Id }),
    response: Business
  }),

  listSpots: endpoint({ method: "GET", path: "/businesses/:businessId/spots", auth: "user", summary: "A business's spots", params: BusinessParams, response: z.array(Spot) }),
  createSpot: endpoint({
    method: "POST",
    path: "/businesses/:businessId/spots",
    auth: "user",
    summary: "Start a spot (a draft) with its rate, budget and targeting",
    params: BusinessParams,
    body: z.object({
      title: z.string().min(1).max(120),
      lengthSec: z.union([z.literal(15), z.literal(30), z.literal(60)]),
      category: z.string().min(1),
      rate: z.object({ kind: z.enum(["per_thousand", "per_airing"]), micros: Micros.positive(), perAiringMaxMicros: Micros.positive().nullable().default(null) }),
      budget: z.object({ totalMicros: Micros.positive(), dailyCapMicros: Micros.positive().nullable().default(null) }),
      startsOn: DateOnly.nullable().default(null),
      endsOn: DateOnly.nullable().default(null),
      targeting: Targeting.partial().default({}),
      code: z.object({ code: z.string().regex(/^[A-Z0-9]{3,16}$/), offer: z.string().min(1).max(80), windowDays: z.number().int().min(1).max(60).default(7) }).nullable().default(null)
    }),
    response: Spot,
    status: 201
  }),
  getSpot: endpoint({ method: "GET", path: "/spots/:spotId", auth: "user", summary: "One spot", params: SpotParams, response: Spot }),
  updateSpot: endpoint({
    method: "PATCH",
    path: "/spots/:spotId",
    auth: "user",
    summary: "Change the rate, budget, dates, targeting or code. Raising the budget uses money already available.",
    params: SpotParams,
    body: z
      .object({
        title: z.string().min(1).max(120),
        rate: z.object({ kind: z.enum(["per_thousand", "per_airing"]), micros: Micros.positive(), perAiringMaxMicros: Micros.positive().nullable() }),
        budget: z.object({ totalMicros: Micros.positive(), dailyCapMicros: Micros.positive().nullable() }),
        startsOn: DateOnly.nullable(),
        endsOn: DateOnly.nullable(),
        targeting: Targeting.partial(),
        code: z.object({ code: z.string().regex(/^[A-Z0-9]{3,16}$/), offer: z.string().min(1).max(80), windowDays: z.number().int().min(1).max(60) }).nullable()
      })
      .partial(),
    response: Spot
  }),
  uploadSpotFile: endpoint({
    method: "POST",
    path: "/spots/:spotId/file",
    auth: "user",
    summary:
      "Upload the spot. Checked on arrival: exact length, picture, title safe, captions, loudness, code. A spot without a code gets one here (added 2026-09-29, P4): Opencast's letters, the title as the offer until the business names one.",
    params: SpotParams,
    multipart: true,
    body: z.object({ scaleToFit: z.coerce.boolean().default(false) }),
    response: Spot
  }),
  matchStations: endpoint({
    method: "POST",
    path: "/spots/:spotId/matches",
    auth: "user",
    summary: "Which stations would see it, with the reason any nearby station is left out, and an estimated cost per airing",
    params: SpotParams,
    body: Targeting.partial().default({}),
    response: z.object({ stations: z.array(TargetMatch) })
  }),
  submitSpot: endpoint({
    method: "POST",
    path: "/spots/:spotId/submit",
    auth: "user",
    summary: "Send for review (category and content), before any station can see it",
    params: SpotParams,
    response: Spot
  }),
  pauseSpot: endpoint({ method: "POST", path: "/spots/:spotId/pause", auth: "user", summary: "Pause. Airings already held still air.", params: SpotParams, response: Spot }),
  resumeSpot: endpoint({
    method: "POST",
    path: "/spots/:spotId/resume",
    auth: "user",
    summary: "Back in the market. Stations that had it are told; it never returns to a rotation by itself.",
    params: SpotParams,
    response: Spot
  }),
  endSpot: endpoint({ method: "POST", path: "/spots/:spotId/end", auth: "user", summary: "End it. It stays in your results.", params: SpotParams, response: Spot }),
  listSpotAirings: endpoint({
    method: "GET",
    path: "/spots/:spotId/airings",
    auth: "user",
    summary: "Scheduled (held) and aired",
    params: SpotParams,
    response: z.object({
      held: z.array(z.object({ airingId: Id, station: StationIdent, scheduledAt: Timestamp, heldMicros: Micros })),
      aired: z.array(ResultsAiring)
    })
  }),

  reviewQueue: endpoint({ method: "GET", path: "/review/spots", auth: "admin", summary: "Spots in review", response: z.array(Spot) }),
  reviewSpot: endpoint({
    method: "POST",
    path: "/review/spots/:spotId",
    auth: "admin",
    summary: "Approve (lists it, if the balance covers a day of budget) or send back",
    params: SpotParams,
    body: z.object({ decision: z.enum(["approve", "send_back"]), note: z.string().max(300).optional() }),
    response: Spot
  }),

  stationMarket: endpoint({
    method: "GET",
    path: "/stations/:stationId/spot-market",
    auth: "user",
    summary: "Spots listed for this station's market, matched by targeting, blocked categories hidden",
    params: StationParams,
    query: z.object({ withinMiles: z.coerce.number().optional(), category: z.string().optional() }),
    response: z.array(MarketSpot)
  }),
  getRotations: endpoint({
    method: "GET",
    path: "/stations/:stationId/rotations",
    auth: "user",
    summary: "The rotation and the backup rotation",
    params: StationParams,
    response: z.object({ main: Rotation, backup: Rotation })
  }),
  setRotation: endpoint({
    method: "PUT",
    path: "/stations/:stationId/rotations/:kind",
    auth: "user",
    summary: "Set a rotation's spots in order (owner, operator)",
    params: z.object({ stationId: Id, kind: z.enum(["main", "backup"]) }),
    body: z.object({ spotIds: z.array(Id) }),
    response: Rotation
  }),
  getAvails: endpoint({
    method: "GET",
    path: "/stations/:stationId/avails",
    auth: "user",
    summary: "Open time in upcoming breaks",
    params: StationParams,
    query: z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) }),
    response: z.object({ totalOpenMs: Millis, breaks: z.array(Avail) })
  }),

  checkCredit: endpoint({
    method: "POST",
    path: "/sponsorships/credit-check",
    auth: "public",
    summary: "Check credit text as it's typed: who, where and what they do, and nothing else",
    body: z.object({ text: z.string().max(200) }),
    response: CreditCheck
  }),
  offerSponsorship: endpoint({
    method: "POST",
    path: "/businesses/:businessId/sponsorships",
    auth: "user",
    summary: "Offer to underwrite a station or one program, flat monthly. Can't be sent until the credit passes.",
    params: BusinessParams,
    body: z.object({
      stationId: Id,
      programId: Id.nullable().default(null),
      monthlyMicros: Micros.positive(),
      creditText: z.string().min(1).max(200),
      startsOn: DateOnly
    }),
    response: Sponsorship,
    status: 201
  }),
  listBusinessSponsorships: endpoint({
    method: "GET",
    path: "/businesses/:businessId/sponsorships",
    auth: "user",
    summary: "A business's sponsorships",
    params: BusinessParams,
    response: z.array(Sponsorship)
  }),
  listStationSponsorships: endpoint({
    method: "GET",
    path: "/stations/:stationId/sponsorships",
    auth: "user",
    summary: "Requests and sponsors, and the station's sponsorship settings",
    params: StationParams,
    response: z.object({ sponsorships: z.array(Sponsorship), settings: z.array(SponsorshipSetting), members: MembersCredit.nullable().optional() })
  }),
  decideSponsorship: endpoint({
    method: "POST",
    path: "/sponsorships/:sponsorshipId/decision",
    auth: "user",
    summary: "Approve, or decline with a reason from the short list",
    params: z.object({ sponsorshipId: Id }),
    body: z.discriminatedUnion("decision", [
      z.object({ decision: z.literal("approve") }),
      z.object({ decision: z.literal("decline"), reason: SponsorshipDeclineReason })
    ]),
    response: Sponsorship
  }),
  endSponsorship: endpoint({
    method: "POST",
    path: "/sponsorships/:sponsorshipId/end",
    auth: "user",
    summary: "Stop renewing; it ends with its paid month",
    params: z.object({ sponsorshipId: Id }),
    response: Sponsorship
  }),
  setSponsorshipSettings: endpoint({
    method: "PUT",
    path: "/stations/:stationId/sponsorship-settings",
    auth: "user",
    summary: "Minimum a month and most sponsors for the station and each program; closed programs can't be sponsored",
    params: StationParams,
    body: z.array(z.object({ programId: Id.nullable(), minMonthlyMicros: Micros.nonnegative(), maxSponsors: z.number().int().min(0), closed: z.boolean() })),
    response: z.array(SponsorshipSetting)
  }),

  listMakers: endpoint({
    method: "GET",
    path: "/makers",
    auth: "user",
    summary: "Stations that take orders, and Opencast Studio. `businessId` (added 2026-09-29, P18) adds each maker's history with that business.",
    query: z.object({ marketId: Id.optional(), businessId: Id.optional() }),
    response: z.array(
      z.object({
        station: StationIdent,
        turnaround: z.string().nullable(),
        fromMicros: Micros.nullable(),
        samples: z.number().int(),
        /** P18 (added 2026-09-29): what it made for the business ("Made your Fall menu spot"), with `businessId`. */
        history: z.string().nullable().optional(),
        /** P18 (added 2026-09-29): what it's good at: its category, or "Any category" for Opencast Studio. */
        specialty: z.string().nullable().optional()
      })
    )
  }),
  orderSpot: endpoint({
    method: "POST",
    path: "/businesses/:businessId/orders",
    auth: "user",
    summary: "Send a brief to a maker",
    params: BusinessParams,
    body: z.object({
      makerStationId: Id,
      title: z.string().min(1).max(120),
      lengthSec: z.union([z.literal(15), z.literal(30), z.literal(60)]),
      about: z.string().min(1).max(1000),
      mustSay: z.string().max(500).optional(),
      neededBy: DateOnly
    }),
    response: ProductionOrder,
    status: 201
  }),
  listBusinessOrders: endpoint({ method: "GET", path: "/businesses/:businessId/orders", auth: "user", summary: "A business's orders", params: BusinessParams, response: z.array(ProductionOrder) }),
  listMakerOrders: endpoint({ method: "GET", path: "/stations/:stationId/orders", auth: "user", summary: "Orders sent to this maker", params: StationParams, response: z.array(ProductionOrder) }),
  getOrder: endpoint({ method: "GET", path: "/orders/:orderId", auth: "user", summary: "One order", params: OrderParams, response: ProductionOrder }),
  attachBriefFile: endpoint({
    method: "POST",
    path: "/orders/:orderId/brief-files",
    auth: "user",
    summary: "Attach a file to the brief",
    params: OrderParams,
    multipart: true,
    body: z.object({}),
    response: ProductionOrder
  }),
  quoteOrder: endpoint({
    method: "POST",
    path: "/orders/:orderId/quote",
    auth: "user",
    summary: "Quote a price, delivery date, rounds included and who voices it; or pass",
    params: OrderParams,
    body: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("quote"),
        priceMicros: Micros.positive(),
        deliverBy: DateOnly,
        roundsIncluded: z.number().int().min(0).max(2),
        voicedBy: z.string().max(80).nullable()
      }),
      z.object({ action: z.literal("pass") })
    ]),
    response: ProductionOrder
  }),
  acceptQuote: endpoint({
    method: "POST",
    path: "/orders/:orderId/accept",
    auth: "user",
    summary: "Accept the quote; the price is held from the balance",
    params: OrderParams,
    response: ProductionOrder
  }),
  deliverOrder: endpoint({
    method: "POST",
    path: "/orders/:orderId/deliveries",
    auth: "user",
    summary: "Deliver a version (the maker)",
    params: OrderParams,
    multipart: true,
    body: z.object({}),
    response: ProductionOrder
  }),
  addOrderNote: endpoint({
    method: "POST",
    path: "/orders/:orderId/notes",
    auth: "user",
    summary: "A note pinned to a timecode",
    params: OrderParams,
    body: z.object({ timecodeMs: Millis.nullable(), body: z.string().min(1).max(1000) }),
    response: ProductionOrder
  }),
  markOwnMistake: endpoint({
    method: "POST",
    path: "/orders/:orderId/notes/:noteId/makers-mistake",
    auth: "user",
    summary: "The maker marks a note as its own mistake; it doesn't use up a round",
    params: z.object({ orderId: Id, noteId: Id }),
    response: ProductionOrder
  }),
  reviewDelivery: endpoint({
    method: "POST",
    path: "/orders/:orderId/review",
    auth: "user",
    summary: "Approve (releases the money and makes it a spot), ask for changes, or ask Opencast to review after the included rounds",
    params: OrderParams,
    body: z.object({ decision: z.enum(["approve", "request_changes", "dispute"]), tellMakerWhenListed: z.boolean().optional() }),
    response: ProductionOrder
  }),
  cancelOrder: endpoint({
    method: "POST",
    path: "/orders/:orderId/cancel",
    auth: "user",
    summary: "Cancel. After the delivery date passes undelivered, the hold returns in full.",
    params: OrderParams,
    response: ProductionOrder
  }),
  resolveOrderDispute: endpoint({
    method: "POST",
    path: "/admin/orders/:orderId/resolve",
    auth: "admin",
    summary: "Opencast's review of a disputed order: pay the maker, refund the business, or split (added 2026-09)",
    params: OrderParams,
    body: z.object({ outcome: z.enum(["pay_maker", "refund", "split"]), makerMicros: Micros.positive().optional(), note: z.string().max(500).optional() }),
    response: ProductionOrder
  }),

  scanCode: endpoint({
    method: "POST",
    path: "/c/:code/scan",
    auth: "public",
    summary: "Count a QR scan (from the page the QR opens)",
    params: z.object({ code: z.string() }),
    body: z.object({ stationId: Id.optional(), airingId: Id.optional() }),
    response: z.object({ business: z.string(), offer: z.string() })
  }),
  saveOffer: endpoint({
    method: "POST",
    path: "/c/:code/save",
    auth: "optional",
    summary: "Save the offer to a phone",
    params: z.object({ code: z.string() }),
    body: z.object({ stationId: Id.optional(), customerRef: z.string().max(120).optional() }),
    response: z.object({ savedUntil: DateOnly, savedFrom: StationIdent.nullable() })
  }),
  redeemCode: endpoint({
    method: "POST",
    path: "/businesses/:businessId/redeem",
    auth: "user",
    summary: "Mark a code used at the counter (owner, manager). Checks it's valid and the customer's first use. 409 `redeem_off` while the Redeem tool is off (added 2026-09-29).",
    params: BusinessParams,
    body: z.object({ code: z.string(), customerRef: z.string().max(120).optional() }),
    response: RedeemResult
  }),
  getResults: endpoint({
    method: "GET",
    path: "/businesses/:businessId/results",
    auth: "user",
    summary:
      "Every airing from the as-run log with proof, tuned in and cost; codes and customers. `period` (added 2026-09-29, P14): a `week` (the Sunday `week`, default this one), the `month`, or `all` time.",
    params: BusinessParams,
    query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), period: z.enum(["week", "month", "all"]).default("month"), week: DateOnly.optional() }),
    response: Results
  }),
  stationCustomers: endpoint({
    method: "GET",
    path: "/stations/:stationId/customers",
    auth: "user",
    summary: "Customers from airings on this station only, per spot",
    params: StationParams,
    query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
    response: z.array(z.object({ spotId: Id, business: z.string(), customers: z.number().int() }))
  }),

  // ---- Added 2026-09-29: P24, S17 ----

  tellMeWhenListed: endpoint({
    method: "POST",
    path: "/orders/:orderId/tell-me-when-listed",
    auth: "user",
    summary: "P24: the maker asks to be told when the business lists the spot it made (the maker's owner or operator). Told once, when it's listed; at once if it already is.",
    params: OrderParams,
    response: ProductionOrder
  }),
  listSpotCategories: endpoint({
    method: "GET",
    path: "/spot-categories",
    auth: "public",
    summary: "S17: every spot category, in one list: what a business is, what markets filter by, and (`blockable`) what a station can block",
    response: z.array(z.object({ name: z.string(), blockable: z.boolean() }))
  }),

  // ---- Added 2026-09-29: the business app's requests ----

  updateLocation: endpoint({
    method: "PATCH",
    path: "/businesses/:businessId/locations/:locationId",
    auth: "user",
    summary: "P26: change a location or service area in place (owner, manager); it keeps its place in the list. A location has no radius.",
    params: z.object({ businessId: Id, locationId: Id }),
    body: z
      .object({
        kind: z.enum(["location", "service_area"]),
        label: z.string().max(80).nullable(),
        streetAddress: z.string().max(200).nullable(),
        city: z.string().min(1).max(80),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        radiusMiles: z.number().positive().max(200).nullable()
      })
      .partial(),
    response: Business
  }),
  uploadLogo: endpoint({
    method: "POST",
    path: "/businesses/:businessId/logo",
    auth: "user",
    summary: "P11: upload the logo (owner, manager): a square PNG or JPEG, at least 256 pixels. Stored at 512 pixels. 422 `logo_size`, `not_an_image`.",
    params: BusinessParams,
    multipart: true,
    body: z.object({}),
    response: Business
  }),
  closeBusiness: endpoint({
    method: "POST",
    path: "/businesses/:businessId/close",
    auth: "user",
    summary:
      "P21: close the account (owner only; type its name). Spots end (out of every rotation), sponsorships stop renewing, unanswered orders are cancelled. Held money pays for what's already scheduled; the available balance goes back to the default bank or Clear account now, and what's left after the held airings follows. 409 `order_in_progress` while an order is being made or reviewed; 409 `no_source` when there's money to send back and no bank or Clear account to send it to.",
    params: BusinessParams,
    body: z.object({ confirmName: z.string() }),
    response: z.object({ closedAt: Timestamp, returnedMicros: Micros, heldMicros: Micros })
  }),
  getConnections: endpoint({
    method: "GET",
    path: "/businesses/:businessId/connections",
    auth: "user",
    summary: "P20: Clear Pay and an online checkout",
    params: BusinessParams,
    response: Connections
  }),
  connect: endpoint({
    method: "POST",
    path: "/businesses/:businessId/connections/:kind",
    auth: "user",
    summary:
      "P20: connect Clear Pay or an online checkout (owner only). For a checkout, `token` is the webhook signing secret the provider shows (Shopify's app secret, Stripe's `whsec_…`, Square's signature key); the answer's `webhookUrl` is where the provider sends order events, and each promotion code used counts as a use. Connecting another checkout replaces the one before.",
    params: z.object({ businessId: Id, kind: z.enum(["clear_pay", "checkout"]) }),
    body: z.object({ token: z.string().min(1).max(500), provider: z.enum(["shopify", "stripe", "square"]).optional() }),
    response: Connections
  }),
  disconnect: endpoint({
    method: "DELETE",
    path: "/businesses/:businessId/connections/:kind",
    auth: "user",
    summary: "P20: disconnect Clear Pay or the checkout (owner only). Uses already counted stay counted.",
    params: z.object({ businessId: Id, kind: z.enum(["clear_pay", "checkout"]) }),
    response: Connections
  }),
  redeemCheck: endpoint({
    method: "POST",
    path: "/businesses/:businessId/redeem/check",
    auth: "user",
    summary: "B5: check a code at the counter without counting the use (owner, manager): valid, first use for this customer, when and where the offer was saved, its text",
    params: BusinessParams,
    body: z.object({ code: z.string(), customerRef: z.string().max(120).optional() }),
    response: RedeemResult
  }),
  redeemToday: endpoint({
    method: "GET",
    path: "/businesses/:businessId/redeem/today",
    auth: "user",
    summary: "P12: the Redeem tool: on or off, codes marked used today, and whether Clear Pay counts uses by itself (owner, manager)",
    params: BusinessParams,
    response: z.object({ on: z.boolean(), redeemedToday: z.number().int(), clearPay: z.boolean() })
  }),
  listSponsorTargets: endpoint({
    method: "GET",
    path: "/businesses/:businessId/sponsor-targets",
    auth: "user",
    summary:
      "P16: the stations near the business (its markets; within 25 miles of a place, or its service area) and their own programs that take sponsors, with the minimum and the room. Closed ones and full ones are left out.",
    params: BusinessParams,
    response: z.object({ near: z.string().nullable(), targets: z.array(SponsorTarget) })
  }),
  getCategoryReach: endpoint({
    method: "GET",
    path: "/markets/:marketId/category-reach",
    auth: "user",
    summary: "P9: how many of a market's stations on the air can carry a spot category, and which block it",
    params: z.object({ marketId: Id }),
    query: z.object({ category: z.string().min(1).max(80) }),
    response: CategoryReach
  }),
  lookupPlace: endpoint({
    method: "GET",
    path: "/places/lookup",
    auth: "user",
    summary:
      "P10: an address or a city to coordinates and a market, through the server's place lookup (PLACES_URL). Nothing is stored. 404 `not_found` when nothing matches; 503 `not_available` when no lookup is set up.",
    query: z.object({ q: z.string().min(2).max(200) }),
    response: Place
  })
};

/**
 * S17 (added 2026-09-29): the spot categories, the same list `listSpotCategories` returns. The
 * blockable ones are the categories stations commonly refuse.
 */
export const SPOT_CATEGORIES: ReadonlyArray<{ name: string; blockable: boolean }> = [
  { name: "Alcohol", blockable: true },
  { name: "Gambling", blockable: true },
  { name: "Cannabis", blockable: true },
  { name: "Political", blockable: true },
  { name: "Payday loans", blockable: true },
  { name: "Vaping", blockable: true },
  { name: "Tobacco", blockable: true },
  { name: "Dating", blockable: true },
  { name: "Adult", blockable: true },
  { name: "Weapons", blockable: true },
  { name: "Coffee and food", blockable: false },
  { name: "Food", blockable: false },
  { name: "Retail", blockable: false },
  { name: "Services", blockable: false },
  { name: "Auto", blockable: false },
  { name: "Health", blockable: false },
  { name: "Underwriting", blockable: false },
  { name: "Nonprofit", blockable: false },
  { name: "Real estate", blockable: false },
  { name: "Legal", blockable: false },
  { name: "Religion", blockable: false },
  { name: "Education", blockable: false },
  { name: "Events", blockable: false },
  { name: "Fitness", blockable: false },
  { name: "Travel", blockable: false },
  { name: "Finance", blockable: false }
];

export type CustomersWhere = z.infer<typeof CustomersWhere>;
export type BusinessLocation = z.infer<typeof BusinessLocation>;
export type UploadCheck = z.infer<typeof UploadCheck>;
export type Targeting = z.infer<typeof Targeting>;
export type TargetMatch = z.infer<typeof TargetMatch>;
export type MarketSpot = z.infer<typeof MarketSpot>;
export type Rotation = z.infer<typeof Rotation>;
export type Avail = z.infer<typeof Avail>;
export type CreditCheck = z.infer<typeof CreditCheck>;
export type Sponsorship = z.infer<typeof Sponsorship>;
export type SponsorshipSetting = z.infer<typeof SponsorshipSetting>;
export type OrderNote = z.infer<typeof OrderNote>;
export type ProductionOrder = z.infer<typeof ProductionOrder>;
export type ResultsAiring = z.infer<typeof ResultsAiring>;
export type Results = z.infer<typeof Results>;
export type ResultsCode = z.infer<typeof ResultsCode>;
export type SpotStill = z.infer<typeof SpotStill>;
export type SpotPauseStory = z.infer<typeof SpotPauseStory>;
export type SpotBackStory = z.infer<typeof SpotBackStory>;
export type SponsorTarget = z.infer<typeof SponsorTarget>;
export type CategoryReach = z.infer<typeof CategoryReach>;
export type Place = z.infer<typeof Place>;
export type Connections = z.infer<typeof Connections>;
export type UploadCheckDetail = z.infer<typeof UploadCheckDetail>;
