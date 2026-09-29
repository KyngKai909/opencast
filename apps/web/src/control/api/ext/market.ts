// Fields the Market area (the syndication market, offering programs, carriers, studios) needs that
// the catalog contract doesn't have yet, as optional extensions (see ../ext.ts for the pattern).
// Each names its request in docs/contract-requests.md. Against the real API they're absent until
// the request lands, and the screens hide what depends on them (or fall back, as noted).

import { Band, CarriageTerm, catalogApi, Colour, Id, Micros, Millis, Offer, Slot, StationIdent, Timestamp, CarriageRequest, Agreement, Terms } from "@opencast/contracts";
import { z } from "zod";

// ---- the program on an offer ----

/**
 * L1: a program's format: series or one-off, how often it airs, the typical episode length, and
 * the bands it's made for ("Series, 22 episodes of 2 hr 20 min", "Weekly, live, 60 min", "Radio band").
 */
export const ProgramFormatX = z.object({
  kind: z.enum(["series", "one_off"]),
  cadence: z.enum(["weekly", "nightly", "weeknights"]).nullable(),
  episodeLengthMs: Millis.nullable(),
  bands: z.array(Band)
});
export type ProgramFormatX = z.infer<typeof ProgramFormatX>;

const OfferProgramX = Offer.shape.program.extend({
  format: ProgramFormatX.optional(),
  /** L1: the colour its title card is drawn in (the maker's, or the catalog shelf's). */
  colour: Colour.nullable().optional(),
  /** L1: the program's advisory (library.getProgram has it, for the maker's own programs only). */
  advisory: z.enum(["none", "language", "mature"]).optional()
});

// ---- why it fits ----

/**
 * C1: where an offer fits the browsing station's schedule: a dead-air gap tonight ("11:40 pm to
 * 2:00 am", exact when the episode fills it), or a slot the station fills with library repeats or
 * that its audience says is weak ("Weeknights after 1:00 am").
 */
export const FitSlotX = z.object({
  reason: z.enum(["dead_air", "library_repeats", "weak_slot"]),
  /** For the amber tag after "Fits": "11:40 pm gap", "weeknights 1:00 am". */
  label: z.string(),
  /** For the fit box: "Weeknights after 1:00 am". Dead air is written from its times instead. */
  title: z.string(),
  startsAt: Timestamp.nullable(),
  endsAt: Timestamp.nullable(),
  exact: z.boolean()
});
export type FitSlotX = z.infer<typeof FitSlotX>;

// ---- the offer ----

/** C3: the fee and split for cash plus barter, which the contract's single price can't hold. */
export const CashPlusBarterX = z.object({
  priceMicros: Micros,
  unit: z.enum(["per_airing", "per_hour"]),
  makerMsPerHour: Millis
});
export type CashPlusBarterX = z.infer<typeof CashPlusBarterX>;

export const OfferX = Offer.extend({
  program: OfferProgramX,
  /** C1 */
  fit: z.array(FitSlotX).optional(),
  /** C3: break time in each hour of the program ("Each hour has 4:00 of breaks"). */
  breakMsPerHour: Millis.optional(),
  /** C3 */
  cashPlusBarter: CashPlusBarterX.nullable().optional(),
  /** C3: what the maker's barter share is: spots, or only its underwriting credit ("Underwriting credit only"). */
  barterFill: z.enum(["spots", "credit_only"]).optional(),
  /** C8: the deal a one-tap carry uses (phone 06.1). */
  defaultTerm: CarriageTerm.optional(),
  /** C9: who underwrites a catalog program ("Clear, the member-owned co-op"). */
  underwriter: z.string().nullable().optional(),
  /** C2: when it was first offered, for "Newest". */
  offeredAt: Timestamp.optional()
});
export type OfferX = z.infer<typeof OfferX>;

export const BrowseX = z.array(OfferX);

/**
 * C2: the browse filters the contract lacks. The Browse tab filters and counts facets on the
 * client (over the whole market); these narrow the list for the other pages.
 */
export interface BrowseQueryX {
  forStation?: string;
  q?: string;
  band?: "tv" | "radio";
  fitsSchedule?: boolean;
  /** Offers by one maker (Offered by BEAT, a studio's programs). Includes withdrawn ones. */
  maker?: string;
  makerKind?: "station" | "studio" | "catalog";
  /** Only offers that fit the dead-air gap starting then (phone 06.1, the dead-air sheet). */
  gap?: string;
}

/** C5: an episode's first airing and captions ("First aired September 19 on HALL"; "None, no speech"). */
const EpisodeX = catalogApi.getOffer.response.shape.episodes.element.extend({
  episodeNumber: z.number().int().nullable().optional(),
  firstAiredAt: Timestamp.nullable().optional(),
  firstAiredOn: StationIdent.nullable().optional(),
  captions: z.enum(["none", "generated", "uploaded"]).optional(),
  speech: z.boolean().optional()
});
export type EpisodeX = z.infer<typeof EpisodeX>;

/** C6: when each carrier airs it ("Nightly at 11:00 pm"). */
const CarriedByX = catalogApi.getOffer.response.shape.carriedBy.element.extend({ slots: z.array(Slot).optional() });
export type CarriedByX = z.infer<typeof CarriedByX>;

export const OfferDetailX = OfferX.extend({
  episodes: z.array(EpisodeX),
  carriedBy: z.array(CarriedByX)
});
export type OfferDetailX = z.infer<typeof OfferDetailX>;

// ---- requests and agreements ----

/** C7: the asking station as the maker sees it: its description, members, what it carries, what it blocks. */
export const CarrierProfileX = z.object({
  description: z.string().nullable(),
  members: z.number().int().nullable(),
  carriesPrograms: z.number().int(),
  blockedCategories: z.array(z.string())
});
export type CarrierProfileX = z.infer<typeof CarrierProfileX>;

export const CarriageRequestX = CarriageRequest.extend({
  /** C4: the agreement, when the request needed no approval (or extends one the station has). */
  agreementId: Id.nullable().optional(),
  /** C7 */
  carrierProfile: CarrierProfileX.optional()
});
export type CarriageRequestX = z.infer<typeof CarriageRequestX>;

export const RequestsX = z.object({ incoming: z.array(CarriageRequestX), outgoing: z.array(CarriageRequestX) });

export const AgreementX = Agreement.extend({
  /** C6: when the carrier airs it. */
  slots: z.array(Slot).optional(),
  /** C6: the offer it came from (the carriers page is per offer). */
  offerId: Id.optional()
});
export type AgreementX = z.infer<typeof AgreementX>;

export const AgreementsX = z.object({ carrying: z.array(AgreementX), carriedBy: z.array(AgreementX) });

// ---- bodies ----

/** offerProgram / updateOffer, with the C3 cash-plus-barter price. */
export const TermsBodyX = Terms.extend({ cashPlusBarter: CashPlusBarterX.nullable().optional() });
export type TermsBodyX = z.infer<typeof TermsBodyX>;
