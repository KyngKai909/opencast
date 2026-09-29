// The Spots area's proposed fields (docs/contract-requests.md), as optional extensions of the
// spots contract. The mocks fill them in; against the real API they're absent until each request
// lands, and the screens hide what depends on them.
//
//   G1  Break contents: what fills each break (on `Avail`, from getAvails).
//   P6  The pause story, station side: why a spot paused, the time it held tonight, what filled it,
//       and why it came back.
//   P17 The members' credit (the name read in the credit, how many members, how many asked to be named).
//   P22 Sponsor profile: business category, city, distance, what else it sponsors.
//   P23 Market spot preview: a preview URL and the still the market shows.
//   P24 A maker's "Tell me when it's listed" (an endpoint).
//   P25 (new) A business's short name, as frames write it in tight places ("Orange Street").
//   L1  Program format ("Weekly, live") on sponsorship settings rows.

import { z } from "zod";
import { Avail, endpoint, Id, MarketSpot, Micros, Millis, ProductionOrder, Sponsorship, SponsorshipSetting, Timestamp, spotsApi } from "@opencast/contracts";

// ---- Market spots (P6, P23, P25) ----

export const SpotPreview = z.object({
  /** HLS or MP4 to preview the spot; null until it's rendered. */
  url: z.string().nullable(),
  /** The still the market shows, drawn in the business's colour until there's a picture. */
  colour: z.string(),
  /** The line on the still ("Open till midnight on Orange St."). */
  line: z.string().nullable()
});

export const PauseStory = z.object({
  reason: z.enum(["budget_spent", "balance"]),
  pausedAt: Timestamp,
  /** The time it held in tonight's breaks when it paused: "It had 1:30 in tonight's breaks". */
  heldTonightMs: Millis,
  /** What the backup rotation put in its place, by business ("Redlands Hardware"). Empty: nothing did. */
  filledBy: z.array(z.string())
});

export const BackStory = z.object({
  reason: z.enum(["raised_budget", "added_money"]),
  backAt: Timestamp
});

export const MarketSpotExt = MarketSpot.extend({
  spot: MarketSpot.shape.spot.extend({ preview: SpotPreview.optional() }),
  business: MarketSpot.shape.business.extend({ shortName: z.string().optional() }),
  pause: PauseStory.nullable().optional(),
  back: BackStory.nullable().optional()
});
export type MarketSpotExt = z.infer<typeof MarketSpotExt>;
export const StationMarketExt = z.array(MarketSpotExt);

// ---- Break contents (G1) ----

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
  /** "REEL's break time, barter" */
  note: z.string().nullable()
});
export type BreakContent = z.infer<typeof BreakContent>;

export const AvailExt = Avail.extend({
  breakId: z.string().optional(),
  origin: z.enum(["rule", "cued_live", "carried_barter"]).optional(),
  contents: z.array(BreakContent).optional()
});
export type AvailExt = z.infer<typeof AvailExt>;

export const AvailsExt = spotsApi.getAvails.response.extend({ breaks: z.array(AvailExt) });
export type AvailsExt = z.infer<typeof AvailsExt>;

// ---- Sponsorships (P17, P22, L1) ----

export const SponsorProfile = z.object({
  category: z.string(),
  city: z.string().nullable(),
  miles: z.number().nullable(),
  /** "Council Watch on CIVC" */
  elsewhere: z.array(z.string())
});

export const SponsorshipExt = Sponsorship.extend({ profile: SponsorProfile.optional() });
export type SponsorshipExt = z.infer<typeof SponsorshipExt>;

export const SponsorshipSettingExt = SponsorshipSetting.extend({ format: z.string().nullable().optional() });
export type SponsorshipSettingExt = z.infer<typeof SponsorshipSettingExt>;

export const MembersCredit = z.object({
  /** The name read in the credit: "members of Inland Beat". */
  creditName: z.string(),
  members: z.number().int(),
  named: z.number().int()
});

export const StationSponsorshipsExt = z.object({
  sponsorships: z.array(SponsorshipExt),
  settings: z.array(SponsorshipSettingExt),
  members: MembersCredit.nullable().optional()
});
export type StationSponsorshipsExt = z.infer<typeof StationSponsorshipsExt>;

// ---- Production orders (P24) ----

export const ProductionOrderExt = ProductionOrder.extend({
  /** The maker asked to be told when the business lists the finished spot (P24). */
  makerToldWhenListed: z.boolean().optional(),
  /** What the business pays for this order's spot once it's listed; null while it has no rate. */
  listedRate: z.object({ kind: z.enum(["per_thousand", "per_airing"]), micros: Micros }).nullable().optional()
});
export type ProductionOrderExt = z.infer<typeof ProductionOrderExt>;
export const MakerOrdersExt = z.array(ProductionOrderExt);

/** P24: the maker asks to be told when the spot it made is listed (production orders 06.2). */
export const tellMeWhenListed = endpoint({
  method: "POST",
  path: "/orders/:orderId/tell-me-when-listed",
  auth: "user",
  summary: "The maker asks to be told when the business lists the spot it made (proposed, P24)",
  params: z.object({ orderId: Id }),
  response: ProductionOrderExt
});
