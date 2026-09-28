// Who sees and changes what in Settings, from the team frame's "What each role can do"
// (biz-settings 02.1) and the inventory's states per role:
//   the profile: the owner and managers change it; viewers read it (P-17 in the inventory is open).
//   the team, funding sources, tax details, auto top-up, connections, closing: the owner only;
//     managers read them; viewers read the team and the connections' status.
//   receipts and statements: everyone.
//   notifications: everyone sets their own.

import { can, type Role } from "../../business/abilities";

export type SectionId = "business" | "team" | "money" | "notifications" | "connections" | "close";

export interface SectionDef {
  id: SectionId;
  label: string;
  danger?: boolean;
}

export const SECTIONS: SectionDef[] = [
  { id: "business", label: "Business" },
  { id: "team", label: "Team" },
  { id: "money", label: "Money and receipts" },
  { id: "notifications", label: "Notifications" },
  { id: "connections", label: "Connections" },
  { id: "close", label: "Close account", danger: true }
];

/** The sections a role sees: closing the account is the owner's alone. */
export function sectionsFor(role: Role): SectionDef[] {
  return SECTIONS.filter((s) => s.id !== "close" || can(role, "manage"));
}

export type Access = "edit" | "read" | "hidden";

export interface SettingsAccess {
  profile: Access;
  team: Access;
  /** Funding sources, auto top-up. */
  funding: Access;
  /** Legal name, EIN, where receipts go. */
  tax: Access;
  receipts: Access;
  notifications: Access;
  connections: Access;
  close: Access;
}

export function accessFor(role: Role): SettingsAccess {
  const owner = can(role, "manage");
  const manager = can(role, "spend");
  return {
    profile: can(role, "advertise") ? "edit" : "read",
    team: owner ? "edit" : "read",
    funding: owner ? "edit" : manager ? "read" : "hidden",
    tax: owner ? "edit" : manager ? "read" : "hidden",
    receipts: "read",
    notifications: "edit",
    connections: owner ? "edit" : "read",
    close: owner ? "edit" : "hidden"
  };
}

/** Why a section reads only, said once near its top. */
export const READ_ONLY = {
  profile: "Only the owner and managers change the profile.",
  team: "Only the owner changes the team.",
  connections: "Only the owner connects or disconnects these."
} as const;
