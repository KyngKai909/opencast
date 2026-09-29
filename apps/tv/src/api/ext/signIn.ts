// What TV sign-in and TV settings need that the contracts don't have yet. Each names its request
// in docs/contract-requests.md. The mock answers them (mocks/handlers/signIn.ts); against the real
// API they 404 until the request lands, and the screens say so in the API's words.

import { endpoint, Market, Ok, Timestamp } from "@opencast/contracts";
import { z } from "zod";

// ---------- B2: TV sign-in by code ----------

/** A code for this TV, shown until a phone approves it or it runs out. */
export const TvCode = z.object({
  /** Six letters and numbers, no spaces ("K7Q4MP"); the TV shows it in two groups of three. */
  code: z.string().regex(/^[A-Z0-9]{6}$/),
  /** What the QR opens: the viewer's /tv page with the code filled in. */
  qrUrl: z.string(),
  expiresAt: Timestamp,
  /** Only this TV knows it: it asks with it whether the code has been approved. */
  pollToken: z.string(),
  /** B2 addition: the address to type, as the TV shows it ("useopencast.org/tv"), like OAuth's verification_uri. */
  enterAt: z.string().optional(),
  /** B2 addition: how often to ask, in seconds. */
  pollSeconds: z.number().positive().optional()
});
export type TvCode = z.infer<typeof TvCode>;

/** Where a code stands. Approved carries the TV's own session, used as `user` from then on. */
export const TvCodeStatus = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("approved"), token: z.string().min(1), signedInAs: z.string().nullable() }),
  z.object({ status: z.literal("expired") })
]);
export type TvCodeStatus = z.infer<typeof TvCodeStatus>;

export const tvCodesApi = {
  createCode: endpoint({ method: "POST", path: "/tv/codes", auth: "public", summary: "B2: a sign-in code for this TV", response: TvCode }),
  pollCode: endpoint({
    method: "GET",
    path: "/tv/codes/:pollToken",
    auth: "public",
    summary: "B2: has a phone approved this TV's code?",
    params: z.object({ pollToken: z.string() }),
    response: TvCodeStatus
  }),
  /** B2: the TV signing itself out (its session ends on the server too). */
  signOutThisTv: endpoint({ method: "DELETE", path: "/tv/session", auth: "user", summary: "B2: sign this TV out", response: Ok })
};

// ---------- S10: the market from the TV's connection ----------

export const MarketByConnection = z.object({ market: Market.nullable(), nearby: z.array(z.object({ market: Market, miles: z.number() })) });
export type MarketByConnection = z.infer<typeof MarketByConnection>;

export const marketsApiX = {
  byConnection: endpoint({
    method: "GET",
    path: "/markets/by-connection",
    auth: "public",
    summary: "S10: the market for the request's IP address. The address isn't stored.",
    response: MarketByConnection
  })
};

// ---------- A7: TV settings on the account ----------

/**
 * The TV-only rows, saved on the account under a top-level `tv` key: `ViewerSettings` is loose at
 * the top but its sections (`watching`, `tvs`…) strip keys they don't type, so these can't ride
 * inside `watching` until A7 types them. Captions and caption size stay in `watching` (shared
 * with the phone and web), and "who on the Wi-Fi can change the channel" in `tvs`.
 */
export const TvAccountSettings = z
  .object({
    channelUp: z.enum(["up_the_dial", "down_the_dial"]),
    bannerSeconds: z.union([z.literal(3), z.literal(5), z.literal(8)]),
    numberWaitSeconds: z.union([z.literal(1), z.literal(1.5), z.literal(2), z.literal(3)]),
    includeRadioBand: z.boolean(),
    quality: z.enum(["auto", "data_saver", "best"]),
    eveningOut: z.boolean()
  })
  .partial();
export type TvAccountSettings = z.infer<typeof TvAccountSettings>;
