import { z } from "zod";
import { endpoint } from "./core.js";
import { Band, DateOnly, Id, Micros, Millis, StationIdent, Timestamp } from "./common.js";
import { CarriageDeclineReason, CarriageRequestState } from "./states.js";

/**
 * Added 2026-09-29: where a preview stands. Previews play the file's prepared segments (the ones
 * it airs from): `preparing` until it's prepared (show "Being prepared"; `previewUrl` is null
 * until then), `ready` with `previewUrl`, `failed` when it couldn't be prepared. Null or absent:
 * there's no preview (no file, or a rights claim holds it).
 */
export const PreviewStatus = z.enum(["ready", "preparing", "failed"]);
export type PreviewStatus = z.infer<typeof PreviewStatus>;

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

/**
 * C3 (added 2026-09-29): cash plus barter's own fee and split, which the single cash price can't
 * hold. Null: cash plus barter uses the cash price and the barter split above.
 */
export const CashPlusBarter = z.object({
  priceMicros: Micros.positive(),
  unit: z.enum(["per_airing", "per_hour"]),
  makerMsPerHour: Millis
});
export type CashPlusBarter = z.infer<typeof CashPlusBarter>;

/**
 * C1 (added 2026-09-29): where an offer fits the browsing station's next 24 hours: a dead-air gap
 * ("11:40 pm gap", exact when an episode fills it within five minutes), or a slot the station
 * fills with library repeats (filled automatically, or a "Repeat this day").
 */
export const FitSlot = z.object({
  reason: z.enum(["dead_air", "library_repeats", "weak_slot"]),
  label: z.string(),
  title: z.string(),
  startsAt: Timestamp.nullable(),
  endsAt: Timestamp.nullable(),
  exact: z.boolean()
});
export type FitSlot = z.infer<typeof FitSlot>;

/** Terms as offerProgram and updateOffer take them (C3 fields added 2026-09-29). */
const TermsBody = Terms.extend({
  cashPlusBarter: CashPlusBarter.nullable().optional(),
  barterFill: z.enum(["spots", "credit_only"]).optional()
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
    rightsNote: z.string().nullable(),
    /** L1 (added 2026-09-29): see `Program.format`. */
    format: z
      .object({
        kind: z.enum(["series", "one_off"]),
        cadence: z.enum(["weekly", "nightly", "weeknights"]).nullable(),
        episodeLengthMs: Millis.nullable(),
        bands: z.array(Band)
      })
      .optional(),
    /** L1 (added 2026-09-29): the title card's colour (the maker's). */
    colour: z.string().nullable().optional(),
    /** L1 (added 2026-09-29). */
    advisory: z.enum(["none", "language", "mature"]).optional()
  }),
  maker: StationIdent,
  makerKind: z.enum(["station", "studio", "catalog"]),
  status: z.enum(["offered", "withdrawn"]),
  carriers: z.number().int(),
  /** For the browsing station: how the program fits its open schedule. */
  fitsYourSchedule: z.boolean().nullable(),
  previews: z.number().int(),
  // ---- Added 2026-09-29 ----
  /** C1: with `forStation`, where it fits that station's next 24 hours. */
  fit: z.array(FitSlot).optional(),
  /** C3: break time in each hour of the program, from the maker's break rule. */
  breakMsPerHour: Millis.optional(),
  cashPlusBarter: CashPlusBarter.nullable().optional(),
  barterFill: z.enum(["spots", "credit_only"]).optional(),
  /** C8: the deal a one-tap carry uses: the first one offered. */
  defaultTerm: CarriageTerm.optional(),
  /** C9: who underwrites it (an approved sponsor of the program), for catalog programs. */
  underwriter: z.string().nullable().optional(),
  /** C2: when it was first offered, for "Newest". */
  offeredAt: Timestamp.optional()
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
  decidedAt: Timestamp.nullable(),
  /** C4 (added 2026-09-29): the agreement, once approved (at once when the offer needs no approval). */
  agreementId: Id.nullable().optional(),
  /**
   * C7 (added 2026-09-29): the asking station as the maker sees it: its description, members
   * (active pledges), how many programs it carries now, and what it blocks.
   */
  carrierProfile: z
    .object({ description: z.string().nullable(), members: z.number().int().nullable(), carriesPrograms: z.number().int(), blockedCategories: z.array(z.string()) })
    .optional()
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
  paidThisMonthMicros: Micros,
  /** C6 (added 2026-09-29): when the carrier airs it (the request's slots). */
  slots: z.array(Slot).optional(),
  /** C6 (added 2026-09-29): the offer it came from. */
  offerId: Id.optional()
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
      q: z.string().optional(),
      // ---- C2 (added 2026-09-29) ----
      /** One maker's offers (a station or studio), withdrawn ones too. */
      maker: Id.optional(),
      makerKind: z.enum(["station", "studio", "catalog"]).optional(),
      /** Only offers with an episode that fits the dead-air gap starting then (needs `forStation`). */
      gap: Timestamp.optional()
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
      episodes: z.array(
        z.object({
          id: Id,
          title: z.string(),
          durationMs: Millis.nullable(),
          breakPointsMs: z.array(Millis),
          /**
           * An HLS preview (added in 2026-09). Since 2026-09-29 a short-cache playlist over the
           * episode's prepared segments (360p, or 64k sound on the radio band), once it's prepared.
           */
          previewUrl: z.string().nullable().optional(),
          /** Added 2026-09-29: see `PreviewStatus`. */
          previewStatus: PreviewStatus.nullable().optional(),
          // ---- C5 (added 2026-09-29) ----
          episodeNumber: z.number().int().nullable().optional(),
          /** From the as-run log, anywhere. */
          firstAiredAt: Timestamp.nullable().optional(),
          firstAiredOn: StationIdent.nullable().optional(),
          captions: z.enum(["none", "generated", "uploaded"]).optional()
        })
      ),
      carriedBy: z.array(
        z.object({
          station: StationIdent,
          since: Timestamp,
          /** C6 (added 2026-09-29): when this carrier airs it. */
          slots: z.array(Slot).optional()
        })
      )
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
    body: TermsBody,
    response: Offer,
    status: 201
  }),
  updateOffer: endpoint({
    method: "PATCH",
    path: "/catalog/offers/:offerId",
    auth: "user",
    summary: "Change terms (new carriers only) or withdraw",
    params: z.object({ offerId: Id }),
    body: TermsBody.partial().extend({ status: z.enum(["offered", "withdrawn"]).optional() }),
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
  }),

  // ---- Added 2026-09-29: C4 ----

  withdrawRequest: endpoint({
    method: "POST",
    path: "/carriage/requests/:requestId/withdraw",
    auth: "user",
    summary: "C4: withdraw a request the maker hasn't answered (the carrier's owner or operator). 409 `decided` once it's approved or declined.",
    params: z.object({ requestId: Id }),
    response: CarriageRequest
  })
};

export type CarriageTerm = z.infer<typeof CarriageTerm>;
export type Terms = z.infer<typeof Terms>;
export type Slot = z.infer<typeof Slot>;
export type CarriageRequest = z.infer<typeof CarriageRequest>;
export type Agreement = z.infer<typeof Agreement>;
