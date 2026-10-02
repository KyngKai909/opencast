// Catalog programs keep one sponsor credit an hour (added 2026-09-29, desk-pages 03, Catalog sponsors).
// In each clock hour of a catalog program's slot, the first break the credit airs in (as the break
// rule's cadence has it) thanks the catalog's sponsor for that series in the station's market, or
// Clear where nobody has bought it; the station's own credit airs in its other breaks, as before.
// The same breaks everywhere: the run sheet (plan), the room kept when filling spots, and the log.

import type { ModuleContext } from "../../../context.js";
import { partsOf, type BreakParts } from "./cadence.js";

export interface CreditSlot {
  startsAt: string;
  logEntryId: string | null;
  parts?: BreakParts;
}

/** The breaks (by `startsAt`) that carry a catalog program's credit. */
export function catalogCreditBreaks(slots: CreditSlot[], isCatalogEntry: (entryId: string) => boolean, hourStart: (t: number) => number): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  for (const slot of [...slots].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
    if (!slot.logEntryId || !partsOf(slot).underwriting || !isCatalogEntry(slot.logEntryId)) continue;
    const key = `${slot.logEntryId}:${hourStart(Date.parse(slot.startsAt))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.add(slot.startsAt);
  }
  return out;
}

/**
 * Which of a station's log entries are catalog programs: each entry's program (its own, or its
 * item's), kept where the catalog has a credit for it. `entries` are log rows.
 */
export async function catalogEntries(
  services: ModuleContext["services"],
  stationId: string,
  entries: Array<{ id: string; programId: string | null; assetId: string | null }>,
  at: Date
): Promise<{ programOf: Map<string, string>; credits: Awaited<ReturnType<ModuleContext["services"]["spots"]["catalogCredits"]>> }> {
  const items = await services.library.itemsByIds(entries.map((e) => e.assetId).filter((v): v is string => Boolean(v)));
  const programOf = new Map<string, string>();
  for (const e of entries) {
    const programId = e.programId ?? (e.assetId ? items.get(e.assetId)?.programId : null) ?? null;
    if (programId) programOf.set(e.id, programId);
  }
  const credits = await services.spots.catalogCredits(stationId, [...new Set(programOf.values())], at);
  for (const [entryId, programId] of programOf) if (!credits.has(programId)) programOf.delete(entryId);
  return { programOf, credits };
}
