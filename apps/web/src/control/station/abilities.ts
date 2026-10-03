// What each role can do: the team frame's "What each role can do" (station-settings 03.1).
//   Go live on their assigned blocks, change lower thirds, cue breaks   Owner Operator Host
//   Library, program log, listings, breaks, carriage                     Owner Operator
//   Spot market and rotations                                            Owner Operator
//   Earnings, payouts and the station account                            Owner (Operator: see only)
//   Team, identity, sign off                                             Owner

import type { ControlPage } from "@opencast/ui";

export type Role = "owner" | "operator" | "host";

export type Ability =
  /** Go live on assigned blocks, change lower thirds, cue a break. */
  | "live"
  /** Library, program log, listings, breaks, carriage (the market). */
  | "programming"
  /** Spot market, rotations, sponsors. */
  | "spots"
  /** See earnings, audience and statements. */
  | "seeMoney"
  /** Payouts, the station account, statement downloads. */
  | "moveMoney"
  /** Team, identity, sign off, ownership. */
  | "manage";

const ABILITIES: Record<Role, readonly Ability[]> = {
  owner: ["live", "programming", "spots", "seeMoney", "moveMoney", "manage"],
  operator: ["live", "programming", "spots", "seeMoney"],
  host: ["live"]
};

export function can(role: Role | null | undefined, ability: Ability): boolean {
  return !!role && ABILITIES[role].includes(ability);
}

/** Which ability opens each page of the rail. Settings opens for everyone who programs; its sections check further. */
export const PAGE_ABILITY: Record<ControlPage, Ability> = {
  monitor: "programming",
  audience: "seeMoney",
  schedule: "programming",
  "live-sources": "live",
  market: "programming",
  library: "programming",
  listings: "programming",
  "spot-market": "spots",
  sponsors: "spots",
  earnings: "seeMoney",
  translators: "programming",
  rights: "programming",
  settings: "programming"
};

/** The one line a disabled rail item gives (docs/apps/open-questions.md A27). */
export const HOST_REASON = "Hosts see their own live blocks";
