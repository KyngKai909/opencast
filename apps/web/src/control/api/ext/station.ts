// Fields the Station area's Rights page needs that the contracts don't have yet, as optional
// extensions (see ../ext.ts for the pattern). Each names its request in docs/contract-requests.md.
// Against the real API the fields are absent until the request lands, and the screens hide what
// depends on them. The rest of this area's requests (A4, A5, B6, N10, S17) landed on 2026-09-29.

import { Claim, Timestamp, trustApi } from "@opencast/contracts";
import { z } from "zod";

// ---- trust ----

const Takedown = Claim.shape.takedowns.element;

/** T1: each pulled airing's time and what replaced it; the carrier's deal ("Carries on barter"). */
export const TakedownX = Takedown.extend({
  airings: z.array(z.object({ startsAt: Timestamp, replacedWith: z.string().nullable() })).optional(),
  term: z.enum(["cash", "barter"]).nullable().optional()
});
export type TakedownX = z.infer<typeof TakedownX>;

/**
 * T1: what carriers were told. T4 (new): the claimed thing as a noun ("recording"), for the
 * claim's heading and the list ("says they own this recording", "Claim: the recording is theirs").
 */
export const ClaimX = Claim.extend({
  takedowns: z.array(TakedownX),
  carrierNotice: z.string().nullable().optional(),
  workNoun: z.string().nullable().optional()
});
export type ClaimX = z.infer<typeof ClaimX>;

export const ClaimsX = trustApi.listClaims.response.extend({ claims: z.array(ClaimX) });
export type ClaimsX = z.infer<typeof ClaimsX>;
