// The states both sides of a transaction see, with each side's words. The
// business app and master control change together, so both read their labels
// from here. Copy is from the reference designs; `{n}` and `{station}` are filled in.

import { z } from "zod";

export const SpotState = z.enum([
  "draft",
  "in_review",
  "listed",
  "in_rotation",
  "paused_daily_cap",
  "paused_budget",
  "paused_balance",
  "waiting_for_you",
  "ended"
]);
export type SpotState = z.infer<typeof SpotState>;

/** `null` on the station side means the station doesn't see the spot in that state. */
export const SPOT_STATE_LABELS: Record<SpotState, { business: string; station: string | null }> = {
  draft: { business: "Draft", station: null },
  in_review: { business: "In review", station: null },
  listed: { business: "Listed", station: "In the market" },
  in_rotation: { business: "In rotation on {n} stations", station: "In rotation" },
  paused_daily_cap: { business: "Paused until midnight", station: "In rotation, not scheduled" },
  paused_budget: { business: "Paused (budget spent)", station: "Paused" },
  paused_balance: { business: "Paused (balance)", station: "Paused" },
  waiting_for_you: { business: "Waiting for you", station: "Paused" },
  ended: { business: "Ended", station: "Gone" }
};

/** When a paused spot comes back: the station is told and adds it back itself. */
export const SPOT_RESUMED_LABELS = { business: "Back in the market", station: "It's back" } as const;

export const SponsorshipState = z.enum(["requested", "approved", "credited", "lapsed", "declined", "ended"]);
export type SponsorshipState = z.infer<typeof SponsorshipState>;

export const SPONSORSHIP_STATE_LABELS: Record<SponsorshipState, { business: string; station: string }> = {
  requested: { business: "Waiting for {station}", station: "New request" },
  approved: { business: "Approved", station: "Approved" },
  credited: { business: "Credited on air", station: "In the credit" },
  lapsed: { business: "Lapsed", station: "Removed from the credit" },
  declined: { business: "Declined", station: "Declined" },
  ended: { business: "Ended", station: "Removed from the credit" }
};

export const SponsorshipDeclineReason = z.enum(["not_right_fit", "full", "amount"]);
export const SPONSORSHIP_DECLINE_LABELS = {
  not_right_fit: "Not the right fit",
  full: "We're full",
  amount: "Amount"
} as const;

export const OrderState = z.enum([
  "asked",
  "quoted",
  "passed",
  "accepted",
  "delivered",
  "changes_requested",
  "approved",
  "disputed",
  "cancelled"
]);
export type OrderState = z.infer<typeof OrderState>;

export const ORDER_STATE_LABELS: Record<OrderState, { business: string; maker: string }> = {
  asked: { business: "Quote requested", maker: "New request" },
  quoted: { business: "Quote ready, your turn", maker: "Quoted" },
  passed: { business: "They passed on this one", maker: "Passed" },
  accepted: { business: "Paid, in the making", maker: "Accepted, make it" },
  delivered: { business: "Delivered, review by {date}", maker: "Delivered, waiting" },
  changes_requested: { business: "Changes asked for", maker: "Changes asked for" },
  approved: { business: "Approved. It's a spot now", maker: "Approved, money released" },
  disputed: { business: "With Opencast for review", maker: "With Opencast for review" },
  cancelled: { business: "Cancelled", maker: "Cancelled" }
};

export const CarriageRequestState = z.enum(["asked", "approved", "declined", "withdrawn"]);
export const CARRIAGE_REQUEST_LABELS = {
  asked: { carrier: "Asked", maker: "Review request" },
  approved: { carrier: "Approved", maker: "Approved" },
  declined: { carrier: "Declined", maker: "Declined" },
  withdrawn: { carrier: "Withdrawn", maker: "Withdrawn" }
} as const;
export const CarriageDeclineReason = z.enum(["not_right_fit", "time_slot", "terms"]);
export const CARRIAGE_DECLINE_LABELS = { not_right_fit: "Not the right fit", time_slot: "Time slot", terms: "Terms" } as const;

export const ClaimState = z.enum(["open", "answered", "upheld", "removed", "expired", "withdrawn", "restored"]);
export const CLAIM_STATE_LABELS = {
  open: "Off air, {n} days to answer",
  answered: "Answered",
  upheld: "Upheld",
  removed: "Removed",
  expired: "Removed",
  withdrawn: "Back on air",
  restored: "Back on air"
} as const;

export const CreatorStage = z.enum([
  "found",
  "already_licensed",
  "asked",
  "said_yes",
  "setting_up",
  "on_air",
  "claimed",
  "declined",
  "no_answer"
]);
export type CreatorStage = z.infer<typeof CreatorStage>;

/** Network desk's words, and the creator's own (the permission page). */
export const CREATOR_STAGE_LABELS: Record<CreatorStage, { desk: string; creator: string | null }> = {
  found: { desk: "Found", creator: null },
  already_licensed: { desk: "Already licensed", creator: null },
  asked: { desk: "Asked", creator: "Permission page" },
  said_yes: { desk: "Said yes", creator: "Said yes" },
  setting_up: { desk: "Setting up", creator: "Said yes" },
  on_air: { desk: "On air", creator: "Claim ready" },
  claimed: { desk: "Claimed", creator: "Claimed" },
  declined: { desk: "Declined", creator: null },
  no_answer: { desk: "No answer", creator: null }
};

/** Values that aren't decided read like this in every app, at $0.00. */
export const NOT_SET_YET = "Not set yet";

export type SponsorshipDeclineReason = z.infer<typeof SponsorshipDeclineReason>;
export type CarriageRequestState = z.infer<typeof CarriageRequestState>;
export type CarriageDeclineReason = z.infer<typeof CarriageDeclineReason>;
export type ClaimState = z.infer<typeof ClaimState>;
