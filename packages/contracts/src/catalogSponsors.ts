// Catalog sponsors in Network desk (added 2026-09-29, follow-up Phase 0 item 11, desk-pages 03):
// catalog programs keep one sponsor credit an hour, and the desk sells it by series and market: a
// business sponsors one catalog series (or every catalog series) in one market, for a month at a
// time, prepaid and renewed monthly like any sponsorship. Wherever nobody has bought the slot, the
// credit thanks the house sponsor, Clear. Prices come from the rules registry
// (`catalog.sponsor_prices`, per market); where the money goes is Open (`shares.catalog_sponsorship`).
//
// The desk's endpoints are `desk`: the team reads; a market's lead or an admin offers, assigns and
// ends in that market (403 `desk_role` otherwise). A business answers an offer from its own side.

import { z } from "zod";
import { endpoint } from "./core.js";
import { Colour, DateOnly, Id, Market, Micros, Timestamp } from "./common.js";
import { DeskPerson } from "./desk.js";

/** The house sponsor: thanked in the catalog's credit wherever no sponsor has bought the slot. */
export const CATALOG_HOUSE_SPONSOR = { name: "Clear", creditText: "The member-owned co-op" } as const;

/** A catalog series as the sponsors page names it. */
export const CatalogSeriesRef = z.object({ id: Id, title: z.string(), colour: Colour.nullable() });
export type CatalogSeriesRef = z.infer<typeof CatalogSeriesRef>;

/**
 * offered: waiting for the business's answer. starting: agreed, credited from its first month.
 * credited: this month is paid and its credit airs. ending: ended, credited to the end of its paid
 * month. ended, lapsed (a month it couldn't pay), declined (the business said no).
 */
export const CatalogSponsorState = z.enum(["offered", "starting", "credited", "ending", "ended", "lapsed", "declined"]);
export type CatalogSponsorState = z.infer<typeof CatalogSponsorState>;

export const CatalogSponsorship = z.object({
  id: Id,
  business: z.object({ id: Id, name: z.string() }),
  /** Null: every catalog series in the market. */
  series: CatalogSeriesRef.nullable(),
  market: Market,
  monthlyMicros: Micros,
  /** Who they are and where, checked by the same credit rules as station sponsorships. */
  creditText: z.string(),
  state: CatalogSponsorState,
  /** offered: the business said yes to the desk's offer. assigned: the desk assigned it on the business's word. */
  how: z.enum(["offered", "assigned"]),
  startsOn: DateOnly,
  /** The 1st it renews on, while it runs. */
  renewsOn: DateOnly.nullable(),
  /** The last day it's credited, once it's ending. */
  endsOn: DateOnly.nullable(),
  /** Its first paid month ("Since August"), once it has one. */
  since: DateOnly.nullable(),
  offeredBy: DeskPerson.nullable(),
  createdAt: Timestamp,
  /** Credits naming it aired this month. */
  creditsThisMonth: z.number().int(),
  /** Stations in the market airing its series, now or in the coming week. */
  airsOn: z.number().int(),
  /** The caller may end it: the market's lead or an admin (never the business's side). */
  canEnd: z.boolean()
});
export type CatalogSponsorship = z.infer<typeof CatalogSponsorship>;

/** One slot: a series (or every series) in a market, and who its credit thanks. */
export const CatalogSlot = z.object({
  series: CatalogSeriesRef.nullable(),
  market: Market,
  /** Who the credit thanks there now: its own sponsor, the market's every-series sponsor, or the house sponsor. */
  creditedBy: z.enum(["sponsor", "every_series", "house"]),
  /** The sponsorship crediting it now or starting, if any. */
  sponsorshipId: Id.nullable(),
  /** An offer waiting for the business's answer. */
  offerId: Id.nullable(),
  /** The registry's price a month (the market's own, else Opencast-wide). Null: not set, so not for sale. */
  priceMicros: Micros.nullable(),
  /** Priced, and nobody has it or has been offered it. */
  forSale: z.boolean(),
  /** How often it airs in the market a day, over the coming week (every series: all of them together). */
  airsPerDay: z.number().int(),
  /** Stations in the market airing it, now or in the coming week. */
  stations: z.number().int(),
  /** Credits aired there this month, whoever they thanked. */
  creditsThisMonth: z.number().int(),
  /** The caller may offer, assign and end here. */
  canEdit: z.boolean()
});
export type CatalogSlot = z.infer<typeof CatalogSlot>;

export const CatalogSponsors = z.object({
  /** The 1st of this month. */
  month: DateOnly,
  stats: z.object({
    /** Catalog credits aired this month, every market. */
    creditsThisMonth: z.number().int(),
    /** What paid sponsors pay a month, every market (credited this month). */
    monthlyMicros: Micros,
    /** Markets with a slot for sale that nobody has. */
    marketsWithOpenSlots: z.number().int(),
    /** The creator fund's share of catalog sponsorship (`shares.catalog_sponsorship`), and whether it's set. */
    fundShareBps: z.number().int(),
    fundShareSet: z.boolean()
  }),
  /** The house sponsor, thanked wherever nobody else is. */
  house: z.object({
    name: z.string(),
    creditText: z.string(),
    creditsThisMonth: z.number().int(),
    /** Whether Clear pays for the slots it fills is Open: null, not billed. */
    billedMicros: Micros.nullable(),
    /** Last month's Clear-filled slots, as recorded: how many series × markets, and the credits aired. */
    lastMonth: z.object({ month: DateOnly, slots: z.number().int(), credits: z.number().int() }).nullable()
  }),
  /** Every sponsor running, starting or offered, then those that ended this month. */
  sponsors: z.array(CatalogSponsorship),
  /** Every series (and every series together) in every market, series first, in market order. */
  slots: z.array(CatalogSlot),
  series: z.array(CatalogSeriesRef),
  markets: z.array(Market),
  /** Markets the caller may offer, assign and end in: every market for an admin, a market lead's own. */
  editableMarketIds: z.array(Id)
});
export type CatalogSponsors = z.infer<typeof CatalogSponsors>;

/** A business the desk can offer a slot to. */
export const CatalogSponsorBusiness = z.object({ id: Id, name: z.string(), category: z.string(), city: z.string().nullable() });
export type CatalogSponsorBusiness = z.infer<typeof CatalogSponsorBusiness>;

const SlotInput = z.object({
  /** Null: every catalog series in the market. */
  seriesId: Id.nullable(),
  marketId: Id,
  businessId: Id,
  creditText: z.string().trim().min(1).max(200),
  /** The 1st of the month it starts: this month or later. */
  startsOn: DateOnly
});

export const catalogSponsorsApi = {
  getCatalogSponsors: endpoint({
    method: "GET",
    path: "/admin/catalog/sponsors",
    auth: "desk",
    summary: "The catalog's credit by series and market: who it thanks, the price, what aired, and the offers out",
    query: z.object({ marketId: Id.optional() }),
    response: CatalogSponsors
  }),
  catalogSponsorBusinesses: endpoint({
    method: "GET",
    path: "/admin/catalog/sponsors/businesses",
    auth: "desk",
    summary: "Businesses to offer a slot to, by name (the first 20)",
    query: z.object({ q: z.string().max(80).optional() }),
    response: z.array(CatalogSponsorBusiness)
  }),
  offerCatalogSponsorship: endpoint({
    method: "POST",
    path: "/admin/catalog/sponsors/offers",
    auth: "desk",
    summary:
      "Offers a slot to a business at the registry's price; it answers from its own side. 422 `credit_text`, `not_for_sale` (no price set), `bad_month`; 409 `slot_taken`",
    body: SlotInput,
    response: CatalogSponsorship,
    status: 200
  }),
  assignCatalogSponsorship: endpoint({
    method: "POST",
    path: "/admin/catalog/sponsors/assignments",
    auth: "desk",
    summary: "Assigns a slot to a business that has agreed to it, holding its first month now (as `offerCatalogSponsorship`, and 422 `insufficient_balance`)",
    body: SlotInput.extend({ agreed: z.literal(true) }),
    response: CatalogSponsorship,
    status: 200
  }),
  endCatalogSponsorship: endpoint({
    method: "POST",
    path: "/admin/catalog/sponsors/:sponsorshipId/end",
    auth: "desk",
    summary: "Ends a sponsorship (credited to the end of its paid month, then Clear again), or withdraws an offer",
    params: z.object({ sponsorshipId: Id }),
    response: CatalogSponsorship,
    status: 200
  }),

  // The business's side.
  listBusinessCatalogSponsorships: endpoint({
    method: "GET",
    path: "/businesses/:businessId/catalog-sponsorships",
    auth: "user",
    summary: "A business's catalog sponsorships and the offers waiting for its answer (owner or manager)",
    params: z.object({ businessId: Id }),
    response: z.array(CatalogSponsorship)
  }),
  answerCatalogOffer: endpoint({
    method: "POST",
    path: "/businesses/:businessId/catalog-sponsorships/:sponsorshipId/answer",
    auth: "user",
    summary: "Accepts an offer (its first month is held now if it has started; 422 `insufficient_balance`) or declines it (owner or manager)",
    params: z.object({ businessId: Id, sponsorshipId: Id }),
    body: z.object({ decision: z.enum(["accept", "decline"]) }),
    response: CatalogSponsorship,
    status: 200
  })
} as const;
