import { z } from "zod";
import { endpoint } from "./core.js";
import { Band, DateOnly, Id, Micros, Millis, StationIdent, Timestamp } from "./common.js";
import { CarriageDeclineReason, CarriageRequestState } from "./states.js";

export const CarriageTerm = z.enum(["barter", "cash", "cash_plus_barter", "free"]);
export const CARRIAGE_TERM_LABELS = { barter: "Barter", cash: "Cash", cash_plus_barter: "Cash plus barter", free: "Free" } as const;

export const Terms = z.object({
  termsOffered: z.array(CarriageTerm).min(1).max(3),
  cashPriceMicros: Micros.nullable(),
  cashPriceUnit: z.enum(["per_airing", "per_hour"]).nullable(),
  /** Break time the maker fills under barter, per hour ("REEL fills 2:00 of 4:00"). */
  barterMakerMsPerHour: Millis.nullable(),
  /** 1, 2 or 3; null is Any. */
  airingsPerEpisode: z.number().int().min(1).max(3).nullable(),
  windowDays: z.union([z.literal(7), z.literal(30)]),
  liveOnly: z.boolean(),
  noticeDays: z.number().int().min(1),
  approval: z.enum(["any_station", "i_approve"]),
  radioBandAllowed: z.boolean()
});

export const Offer = Terms.extend({
  id: Id,
  program: z.object({
    id: Id,
    title: z.string(),
    description: z.string().nullable(),
    category: z.string().nullable(),
    live: z.boolean(),
    episodeCount: z.number().int(),
    rightsNote: z.string().nullable()
  }),
  maker: StationIdent,
  makerKind: z.enum(["station", "studio", "catalog"]),
  status: z.enum(["offered", "withdrawn"]),
  carriers: z.number().int(),
  /** For the browsing station: how the program fits its open schedule. */
  fitsYourSchedule: z.boolean().nullable(),
  previews: z.number().int()
});
export type Offer = z.infer<typeof Offer>;

export const Slot = z.object({
  /** 0 = Sunday. */
  weekday: z.number().int().min(0).max(6),
  /** Local time, `HH:MM`. */
  time: z.string().regex(/^\d{2}:\d{2}$/)
});

export const CarriageRequest = z.object({
  id: Id,
  offerId: Id,
  program: z.object({ id: Id, title: z.string() }),
  carrier: StationIdent,
  maker: StationIdent,
  term: CarriageTerm,
  slots: z.array(Slot),
  startsOn: DateOnly,
  audioOnly: z.boolean(),
  status: CarriageRequestState,
  declineReason: CarriageDeclineReason.nullable(),
  /** The carrier's spot cap per hour, shown to the maker. */
  carrierSpotMsPerHour: Millis,
  createdAt: Timestamp,
  decidedAt: Timestamp.nullable()
});

export const Agreement = z.object({
  id: Id,
  program: z.object({ id: Id, title: z.string() }),
  maker: StationIdent,
  carrier: StationIdent,
  term: CarriageTerm,
  /** The terms as they were agreed; later changes to the offer apply to new carriers only. */
  terms: Terms.omit({ termsOffered: true, approval: true, radioBandAllowed: true }),
  audioOnly: z.boolean(),
  startedAt: Timestamp,
  endNoticeGivenAt: Timestamp.nullable(),
  endsAt: Timestamp.nullable(),
  airingsThisMonth: z.number().int(),
  paidThisMonthMicros: Micros
});

const StationParams = z.object({ stationId: Id });

export const catalogApi = {
  browse: endpoint({
    method: "GET",
    path: "/catalog/offers",
    auth: "user",
    summary: "Browse the syndication market. With forStation, each offer says whether it fits that station's open schedule.",
    query: z.object({
      forStation: Id.optional(),
      category: z.string().optional(),
      band: Band.optional(),
      term: CarriageTerm.optional(),
      fitsSchedule: z.coerce.boolean().optional(),
      q: z.string().optional()
    }),
    response: z.array(Offer)
  }),
  getOffer: endpoint({
    method: "GET",
    path: "/catalog/offers/:offerId",
    auth: "user",
    summary: "An offer, with its episodes, break marks and who carries it",
    params: z.object({ offerId: Id }),
    response: Offer.extend({
      episodes: z.array(z.object({ id: Id, title: z.string(), durationMs: Millis.nullable(), breakPointsMs: z.array(Millis) })),
      carriedBy: z.array(z.object({ station: StationIdent, since: Timestamp }))
    })
  }),
  countPreview: endpoint({
    method: "POST",
    path: "/catalog/offers/:offerId/preview",
    auth: "user",
    summary: "Count a preview (not who; it doesn't use up an airing)",
    params: z.object({ offerId: Id }),
    response: z.object({ previews: z.number().int() })
  }),
  offerProgram: endpoint({
    method: "POST",
    path: "/programs/:programId/offer",
    auth: "user",
    summary: "Offer a program for carriage. Refused if any episode was imported from a link.",
    params: z.object({ programId: Id }),
    body: Terms,
    response: Offer,
    status: 201
  }),
  updateOffer: endpoint({
    method: "PATCH",
    path: "/catalog/offers/:offerId",
    auth: "user",
    summary: "Change terms (new carriers only) or withdraw",
    params: z.object({ offerId: Id }),
    body: Terms.partial().extend({ status: z.enum(["offered", "withdrawn"]).optional() }),
    response: Offer
  }),
  requestCarriage: endpoint({
    method: "POST",
    path: "/catalog/offers/:offerId/requests",
    auth: "user",
    summary: "Ask to carry a program: choose a deal, when it airs and when it starts",
    params: z.object({ offerId: Id }),
    body: z.object({
      carrierStationId: Id,
      term: CarriageTerm,
      slots: z.array(Slot).min(1),
      startsOn: DateOnly,
      audioOnly: z.boolean().default(false)
    }),
    response: CarriageRequest,
    status: 201
  }),
  listRequests: endpoint({
    method: "GET",
    path: "/stations/:stationId/carriage/requests",
    auth: "user",
    summary: "Requests to carry this station's programs, and requests it has made",
    params: StationParams,
    response: z.object({ incoming: z.array(CarriageRequest), outgoing: z.array(CarriageRequest) })
  }),
  decideRequest: endpoint({
    method: "POST",
    path: "/carriage/requests/:requestId/decision",
    auth: "user",
    summary: "Approve, or decline with a reason from the short list (the maker)",
    params: z.object({ requestId: Id }),
    body: z.discriminatedUnion("decision", [
      z.object({ decision: z.literal("approve") }),
      z.object({ decision: z.literal("decline"), reason: CarriageDeclineReason.nullable() })
    ]),
    response: CarriageRequest
  }),
  listAgreements: endpoint({
    method: "GET",
    path: "/stations/:stationId/carriage/agreements",
    auth: "user",
    summary: "What this station carries, and who carries its programs",
    params: StationParams,
    response: z.object({ carrying: z.array(Agreement), carriedBy: z.array(Agreement) })
  }),
  endAgreement: endpoint({
    method: "POST",
    path: "/carriage/agreements/:agreementId/end",
    auth: "user",
    summary: "Give notice to end carriage (either side). It ends after the notice period.",
    params: z.object({ agreementId: Id }),
    response: Agreement
  }),
  placeInLog: endpoint({
    method: "POST",
    path: "/carriage/agreements/:agreementId/place",
    auth: "user",
    summary: "Put the agreed slots on the carrier's log: next unaired episode, in order, replacing what's there",
    params: z.object({ agreementId: Id }),
    body: z.object({ from: DateOnly, weeks: z.number().int().min(1).max(12).default(4), replaceExisting: z.boolean().default(false) }),
    response: z.object({ placed: z.number().int(), replaced: z.number().int(), blockedByLimit: z.number().int() })
  })
};

export type CarriageTerm = z.infer<typeof CarriageTerm>;
export type Terms = z.infer<typeof Terms>;
export type Slot = z.infer<typeof Slot>;
export type CarriageRequest = z.infer<typeof CarriageRequest>;
export type Agreement = z.infer<typeof Agreement>;
