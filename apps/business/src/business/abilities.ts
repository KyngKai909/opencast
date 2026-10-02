// What each role can do: the team frame's "What each role can do" (biz-settings 02.1). A viewer
// sees results, airings and statements only: not the balance, spots, sponsorships or orders.
//   See results, airings and statements                                  Owner Manager Viewer
//   Spots, sponsorships, production orders, redeeming codes              Owner Manager
//   Add money, approve orders                                            Owner Manager
//   Take money out, connections, team, close account                     Owner

import type { BusinessPage } from "@opencast/ui";

export type Role = "owner" | "manager" | "viewer";

export type Ability =
  /** Results, airings, statements (read). All a viewer has. */
  | "see"
  /** The balance and what moved in and out of it (read): the Balance page, "Available" in the header. */
  | "money"
  /** Spots, sponsorships, production orders, redeeming codes. */
  | "advertise"
  /** Add money, approve orders. */
  | "spend"
  /** Take money out, funding sources, connections, team, close the account. */
  | "manage";

const ABILITIES: Record<Role, readonly Ability[]> = {
  owner: ["see", "money", "advertise", "spend", "manage"],
  manager: ["see", "money", "advertise", "spend"],
  viewer: ["see"]
};

export function can(role: Role | null | undefined, ability: Ability): boolean {
  return !!role && ABILITIES[role].includes(ability);
}

/** Which ability opens each page of the rail. A viewer's statements are under Balance (`/balance/statements`), open to them by link. */
export const PAGE_ABILITY: Record<BusinessPage, Ability> = {
  spots: "advertise",
  sponsorships: "advertise",
  "made-for-you": "advertise",
  "where-it-aired": "see",
  balance: "money",
  settings: "see"
};

/** The line a disabled rail item gives a viewer. */
export const VIEWER_REASON = "Viewers see results, airings and statements";
