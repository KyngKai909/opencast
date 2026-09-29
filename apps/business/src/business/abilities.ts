// What each role can do: the team frame's "What each role can do" (biz-settings 02.1).
//   See results, airings and statements                                  Owner Manager Viewer
//   Spots, sponsorships, production orders, redeeming codes              Owner Manager
//   Add money, approve orders                                            Owner Manager
//   Take money out, connections, team, close account                     Owner

import type { BusinessPage } from "@opencast/ui";

export type Role = "owner" | "manager" | "viewer";

export type Ability =
  /** Results, airings, statements, the balance (read). */
  | "see"
  /** Spots, sponsorships, production orders, redeeming codes. */
  | "advertise"
  /** Add money, approve orders. */
  | "spend"
  /** Take money out, funding sources, connections, team, close the account. */
  | "manage";

const ABILITIES: Record<Role, readonly Ability[]> = {
  owner: ["see", "advertise", "spend", "manage"],
  manager: ["see", "advertise", "spend"],
  viewer: ["see"]
};

export function can(role: Role | null | undefined, ability: Ability): boolean {
  return !!role && ABILITIES[role].includes(ability);
}

/** Which ability opens each page of the rail. */
export const PAGE_ABILITY: Record<BusinessPage, Ability> = {
  spots: "advertise",
  sponsorships: "advertise",
  "made-for-you": "advertise",
  "where-it-aired": "see",
  balance: "see",
  settings: "see"
};

/** The line a disabled rail item gives a viewer. */
export const VIEWER_REASON = "Viewers see results, airings and statements";
