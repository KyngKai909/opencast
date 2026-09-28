// Fields the viewer's screens need that the contracts don't have yet, as optional extensions of
// the contract schemas. Each names its request in docs/contract-requests.md. The mocks fill them
// in; against the real API they're absent until the request lands, and the screens hide what
// depends on them. When a request lands in @opencast/contracts, delete its extension here.

import { Airing, Dial, DialRow, GuideRow, Market, SearchResult, StationIdent, StationPage, stationsApi } from "@opencast/contracts";
import { z } from "zod";

/** S1: the station's category ("Public affairs"), for the chips, the preview and search. */
export const StationIdentX = StationIdent.extend({ category: z.string().optional() });
export type StationIdentX = z.infer<typeof StationIdentX>;

/**
 * S4: the line under an airing's title ("Overnight repeat", "Live from Redlands City Hall").
 * B4: a listed city meeting's own id, so it can be reminded.
 * G5: tonight's episode, described ("Tonight: a steamboat, a haunted barn…").
 */
export const AiringX = Airing.extend({ note: z.string().nullable().optional(), episodeDescription: z.string().nullable().optional(), carriedFrom: StationIdentX.nullable(), listedAiringId: z.string().nullable().optional() });
export type AiringX = z.infer<typeof AiringX>;

export const DialRowX = DialRow.extend({ station: StationIdentX, now: AiringX.nullable(), next: AiringX.nullable() });
export type DialRowX = z.infer<typeof DialRowX>;

/** S2: programs carried widely in the market. */
export const CarriedWidely = z.object({
  program: z.object({ id: z.string(), title: z.string() }),
  maker: StationIdentX,
  carriers: z.number().int(),
  /** Where it's on in this market now or next. */
  where: z.object({ station: StationIdentX, airing: AiringX, onNow: z.boolean() }).nullable()
});
/** S3: live airings coming up, past the guide's 24 hours. */
export const ComingUpLive = z.object({ station: StationIdentX, airing: AiringX, listed: z.boolean() });
/** S11: the open channels, for a thin market's "start a station here". */
export const OpenChannels = z.object({ tv: z.array(z.string()), radio: z.array(z.string()) });

export const DialX = Dial.extend({
  rows: z.array(DialRowX),
  nearby: z.array(z.object({ market: Market, miles: z.number(), rows: z.array(DialRowX) })),
  carriedWidely: z.array(CarriedWidely).optional(),
  comingUpLive: z.array(ComingUpLive).optional(),
  openChannels: OpenChannels.optional()
});
export type DialX = z.infer<typeof DialX>;

/** S9: how many stations each market has. */
export const MarketX = Market.extend({ stationCount: z.number().int().optional() });
export type MarketX = z.infer<typeof MarketX>;
export const MarketsX = z.array(MarketX);

export const GuideX = z.object({
  market: Market,
  from: z.string(),
  to: z.string(),
  rows: z.array(GuideRow.extend({ station: StationIdentX, airings: z.array(AiringX) }))
});
export type GuideX = z.infer<typeof GuideX>;

export const SearchX = SearchResult.extend({
  tuneTo: StationIdentX.nullable(),
  stations: z.array(StationIdentX.extend({ description: z.string().nullable().optional() })),
  airings: z.array(z.object({ station: StationIdentX, airing: AiringX, listed: z.boolean() }))
});
export type SearchX = z.infer<typeof SearchX>;

/** S5, S6: the station page's schedule range, members, about, hours and when it joined the dial. */
export const StationPageX = StationPage.extend({
  station: StationIdentX,
  now: AiringX.nullable(),
  upNext: z.array(AiringX),
  about: z.string().nullable().optional(),
  members: z.number().int().optional(),
  onDialSince: z.string().nullable().optional(),
  hours: z.string().nullable().optional(),
  schedule: z.array(AiringX).optional()
});
export type StationPageX = z.infer<typeof StationPageX>;

/** The getGuide response shape, checked against the contract's own at build time. */
void stationsApi.getGuide.response;
