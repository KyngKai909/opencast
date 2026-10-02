// What the Spots area still keeps beside the contract. Its proposed fields (P1, P4 to P8, P23)
// landed on 2026-09-29 (docs/contracts-changelog.md) and are read as the contract's `Spot`. Left
// here: reading spots paused by hand before that change, the typed reading of a check's `detail`,
// and the mock-only spot actions.

import { z } from "zod";
import { endpoint, Id, Spot, UploadCheckDetail, spotsApi } from "@opencast/contracts";

// ---- Spots paused by hand before 2026-09-29 ----

/**
 * A spot the business pauses reads `waiting_for_you` now (A115). One paused by hand before that
 * still reads `paused_budget` with budget left: read it as waiting for you, so the page offers
 * "Bring it back" (resumeSpot) rather than raising a budget that isn't spent.
 */
function pausedByHand<T extends { state: Spot["state"]; budget: Spot["budget"] }>(s: T): T {
  return s.state === "paused_budget" && s.budget.usedMicros < s.budget.totalMicros ? { ...s, state: "waiting_for_you" } : s;
}

/** The contract's spot, with older hand pauses read as waiting for you. */
export const SpotX = Spot.transform(pausedByHand);
export type SpotX = z.infer<typeof SpotX>;
export const SpotsX = z.array(SpotX);

// ---- Check details (P1, P4) ----

export type CheckDetail = z.infer<typeof UploadCheckDetail>;
export type FrameBox = NonNullable<CheckDetail["box"]>;

/** A check's `detail` as `UploadCheckDetail`; empty when it's something else (an older upload). */
export function checkDetail(d: unknown): CheckDetail {
  const r = UploadCheckDetail.safeParse(d ?? {});
  return r.success ? r.data : {};
}

// ---- Mock mode only ----

/**
 * Not an API: the mock's stand-in for what stations and review do on their side, so a spot can be
 * taken through its states on mocks (air it, spend its budget, pass review, have stations add it).
 * Shown only when `config.mock`.
 */
export const MockSpotAction = z.enum(["pass_review", "stations_add", "air_one", "air_all", "midnight"]);
export type MockSpotAction = z.infer<typeof MockSpotAction>;

export const mockSpotAction = endpoint({
  method: "POST",
  path: "/mock/spots/:spotId/:action",
  auth: "user",
  summary: "Mock mode only: what stations and review do to a spot",
  params: z.object({ spotId: Id, action: MockSpotAction }),
  response: SpotX
});

/** The endpoints whose answers change when a spot does. */
export const SPOT_READERS = [spotsApi.listSpots, spotsApi.getSpot, spotsApi.listSpotAirings, spotsApi.getResults];
