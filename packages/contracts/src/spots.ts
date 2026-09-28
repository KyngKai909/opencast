import { z } from "zod";
import { endpoint } from "./core.js";
import { DateOnly, Id, Micros, Millis, Ok, StationIdent, Timestamp } from "./common.js";
import { OrderState, SponsorshipDeclineReason, SponsorshipState, SpotState } from "./states.js";

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
  createdAt: Timestamp
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
  excludedStationIds: z.array(Id)
});

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
  code: z.object({ code: z.string(), offer: z.string(), windowDays: z.number().int() }).nullable(),
  file: z
    .object({
      url: z.string(),
      /** A low-bitrate HLS preview while the spot is in review (added in 2026-09). */
      previewUrl: z.string().nullable().optional(),
      durationMs: Millis,
      originalFilename: z.string().nullable(),
      checks: z.array(UploadCheck)
    })
    .nullable(),
  productionOrderId: Id.nullable(),
  createdAt: Timestamp
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

export const MarketSpot = z.object({
  spot: z.object({ id: Id, title: z.string(), lengthSec: z.number().int(), category: z.string(), onScreen: z.string().nullable() }),
  business: z.object({ id: Id, name: z.string(), category: z.string(), city: z.string().nullable(), online: z.boolean() }),
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

export const Avail = z.object({
  breakStartsAt: Timestamp,
  context: z.string(),
  lengthMs: Millis,
  openMs: Millis,
  producerShareMs: Millis
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
      suggestion: z.string()
    })
  )
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
  createdAt: Timestamp
});

export const SponsorshipSetting = z.object({
  programId: Id.nullable(),
  title: z.string(),
  minMonthlyMicros: Micros,
  maxSponsors: z.number().int().min(0),
  closed: z.boolean(),
  sponsors: z.number().int(),
  /** Carried programs are sponsored through their maker: "REEL's to sponsor". */
  sponsoredThrough: StationIdent.nullable()
});

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
      /** A low-bitrate HLS preview while the order is open (added in 2026-09). */
      previewUrl: z.string().nullable().optional(),
      createdAt: Timestamp
    })
  ),
  notes: z.array(OrderNote),
  deliveredAt: Timestamp.nullable(),
  autoApproveAt: Timestamp.nullable(),
  spotId: Id.nullable(),
  tellMakerWhenListed: z.boolean(),
  createdAt: Timestamp
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
  scansNextHour: z.number().int()
});

export const Results = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  totals: z.object({
    airings: z.number().int(),
    /** Labelled "People tuned in, added up across airings" — never reach or unique viewers. */
    tunedInAddedUp: z.number().int(),
    spentMicros: Micros,
    scans: z.number().int(),
    saves: z.number().int(),
    uses: z.number().int(),
    customers: z.number().int()
  }),
  byStation: z.array(
    z.object({ station: StationIdent, airings: z.number().int(), averageTunedIn: z.number(), spentMicros: Micros, customers: z.number().int() })
  ),
  byDaypart: z.array(z.object({ daypart: z.string(), airings: z.number().int(), customers: z.number().int() })),
  bySpot: z.array(z.object({ spotId: Id, title: z.string(), airings: z.number().int(), spentMicros: Micros, customers: z.number().int() })),
  airings: z.array(ResultsAiring)
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
        ein: z.string().regex(/^\d{2}-?\d{7}$/).nullable()
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
    summary: "Upload the spot. Checked on arrival: exact length, picture, title safe, captions, loudness, code.",
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
    response: z.object({ sponsorships: z.array(Sponsorship), settings: z.array(SponsorshipSetting) })
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
    summary: "Stations that take orders, and Opencast Studio",
    query: z.object({ marketId: Id.optional() }),
    response: z.array(z.object({ station: StationIdent, turnaround: z.string().nullable(), fromMicros: Micros.nullable(), samples: z.number().int() }))
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
    summary: "Mark a code used at the counter (owner, manager). Checks it's valid and the customer's first use.",
    params: BusinessParams,
    body: z.object({ code: z.string(), customerRef: z.string().max(120).optional() }),
    response: z.object({
      valid: z.boolean(),
      firstUse: z.boolean(),
      countsAsCustomer: z.boolean(),
      savedFrom: StationIdent.nullable(),
      message: z.string()
    })
  }),
  getResults: endpoint({
    method: "GET",
    path: "/businesses/:businessId/results",
    auth: "user",
    summary: "Every airing from the as-run log with proof, tuned in and cost; codes and customers",
    params: BusinessParams,
    query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
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
  })
};

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
