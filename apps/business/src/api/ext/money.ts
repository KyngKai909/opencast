// The Money area's proposals: what getting started and the balance need that the contracts don't
// have yet, each naming its request in docs/contract-requests.md. The mocks answer them; against
// the real API the extended fields are absent and the proposed endpoints fail, and the screens
// hide what depends on them. Delete each one here when its request lands in @opencast/contracts.

import { endpoint, Id, ledgerApi, Micros, StationIdent } from "@opencast/contracts";
import { z } from "zod";

/**
 * E6: what the airings estimate is based on ("At $8.00 per 1,000 people tuned in, $250 is roughly
 * 120 airings on a station like BEAT 12.1"): the rate and a reference station.
 */
export const DepositQuoteX = ledgerApi.quoteDeposit.response.extend({
  basis: z
    .object({
      rateKind: z.enum(["per_thousand", "per_airing"]),
      rateMicros: Micros,
      /** Per-thousand rates only: the station the estimate is worked out on. */
      station: StationIdent.nullable()
    })
    .nullable()
    .optional()
});
export type DepositQuoteX = z.infer<typeof DepositQuoteX>;

/** P9: how many of a market's stations can carry a category, and which don't. */
export const CategoryReach = z.object({
  category: z.string(),
  marketName: z.string(),
  reached: z.number().int(),
  total: z.number().int(),
  /** Call signs of the stations that don't carry it. */
  blockedBy: z.array(z.string()),
  /** Categories some stations in the market don't carry ("alcohol", "gambling"), for the line under the bar. */
  sometimesBlocked: z.array(z.string())
});
export type CategoryReach = z.infer<typeof CategoryReach>;

export const getCategoryReach = endpoint({
  method: "GET",
  path: "/markets/:marketId/category-reach",
  auth: "user",
  summary: "PROPOSED (P9): how many stations in a market can carry a category, and which block it",
  params: z.object({ marketId: Id }),
  query: z.object({ category: z.string().min(1).max(80) }),
  response: CategoryReach
});

/** P10: a typed address or a city, turned into what LocationInput needs. */
export const Place = z.object({
  /** Null when only a city was given (a service area). */
  streetAddress: z.string().nullable(),
  city: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  marketId: Id.nullable()
});
export type Place = z.infer<typeof Place>;

export const lookupPlace = endpoint({
  method: "GET",
  path: "/places/lookup",
  auth: "user",
  summary: "PROPOSED (P10): an address or a city to coordinates and a market. Nothing is stored.",
  query: z.object({ q: z.string().min(2).max(200) }),
  response: Place
});

/**
 * E7 (new): the business's balance account, to send USDC to from inside Clear when Clear shares
 * the person's account read-only (quoteClearTransfer answers 409 then, so it can't say where).
 */
export const BalanceX = ledgerApi.getBalance.response.extend({ depositAddress: z.string().nullable().optional() });
export type BalanceX = z.infer<typeof BalanceX>;
