// Pipeline leads from public IPTV lists (follow-up Phase 6): a channel found on a list, with its
// stream noted. Never on the dial from here. It becomes an external station (List as external
// station, with their written permission or once confirmed public) or a full one (asked like any
// creator). Once listed, the row says which external station it became.

import type { Creator } from "@opencast/contracts";

export const isLead = (c: Creator): c is Creator & { lead: NonNullable<Creator["lead"]> } => !!c.lead;

/** Where its work lives, for a lead: "From an IPTV list, Public". */
export function leadSource(c: Creator): string {
  return `From an IPTV list${c.lead?.group ? `, ${c.lead.group}` : ""}`;
}

/** The external station a lead became: "External station 9.3 ICTV", or not on the dial yet. */
export function externalLine(c: Creator): string {
  const ch = c.station?.channel;
  return ch ? `External station ${ch}${c.station?.callSign ? ` ${c.station.callSign}` : ""}` : "External station, not on the dial yet";
}

/** A lead's Next line. */
export function leadNext(c: Creator): string {
  if (c.listedSourceId) return externalLine(c);
  return c.nextAction ?? "Ask for permission, or confirm it's public";
}

export type LeadAction = { kind: "list"; label: string } | { kind: "open-external"; label: string; sourceId: string };

/** A lead's button: list it as an external station, or open the one it became. Null once it's finished with (declined). */
export function leadAction(c: Creator): LeadAction | null {
  if (c.listedSourceId) return { kind: "open-external", label: "Open", sourceId: c.listedSourceId };
  if (c.stage !== "found") return null;
  return { kind: "list", label: "List as external station" };
}
