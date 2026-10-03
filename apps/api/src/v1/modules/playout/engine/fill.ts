// Fills upcoming breaks with spots, holding the money for each airing first.
// Spots come from the station's rotation (then its backup rotation), within the
// hourly cap, the same-spot limit, blocked categories and dayparts. Inside a
// carried program under barter, the producer's share is filled from the
// producer's rotation (the producer is paid for those). Room is kept for what
// playout adds when it airs the break, as far as the break rule's cadence has
// them in it: a bumper into the break and one out of it, the credit and the
// station ID. Since A243 (2026-10-02) the bumpers are the break's chosen sequences, and the
// between sequence after a break that closes a program's slot (sequence.ts `elementsMs`).
//
// A break spots don't air in (the cadence, added 2026-09-29) gets none of the
// station's: nothing is placed or held there, and it isn't marked filled (a
// break marked filled is one spots air in: see cadence.ts). The maker's barter
// share still is, once. The hourly cap, the same-spot limit and each spot's
// daily cap apply to the breaks spots do air in, as before.

import type { ModuleContext } from "../../../context.js";
import { tzOffsetMinutes } from "../../../lib/time.js";
import type { BreakSlotView } from "../../log/service.js";
import { bumpersIn, hourStartIn, partsOf, type BreakParts } from "./cadence.js";
import { elementsMs } from "./sequence.js";
import { catalogCreditBreaks, catalogEntries } from "./catalogCredit.js";

const HOUR = 3_600_000;
/**
 * Kept free in every break: the station ID (:05; :10 for a station airing its generated one, once
 * it's prepared) and, when there are sponsors, the credit (:15).
 */
export const STATION_ID_MS = 5_000;
export const CREDIT_MS = 15_000;

const DAYPART_HOURS: Record<string, [number, number]> = {
  mornings: [6, 12],
  afternoons: [12, 18],
  evenings: [18, 23],
  late_night: [23, 30]
};

function inDaypart(dayparts: string[], at: Date, tz: string) {
  if (!dayparts.length) return true;
  const local = new Date(at.getTime() + tzOffsetMinutes(at, tz) * 60_000);
  const hour = local.getUTCHours();
  return dayparts.some((d) => {
    const [from, to] = DAYPART_HOURS[d] ?? [0, 24];
    return (hour >= from && hour < to) || (hour + 24 >= from && hour + 24 < to);
  });
}

/** A slot without its bumpers picked: the first two Any bumpers (or the one twice), where the cadence has them. */
function defaultBumpersMs(bumpers: Array<{ durationMs: number | null; bumperRole?: string | null }>, parts: BreakParts): number {
  const any = bumpers.filter((b) => !b.bumperRole || b.bumperRole === "any");
  const [into, outOf] = [any[0], any[1] ?? any[0]];
  if (!into) return 0;
  return (bumpersIn(parts, "open") ? into.durationMs! : 0) + (bumpersIn(parts, "close") ? outOf!.durationMs! : 0);
}

export interface FillResult {
  breakId: string;
  placed: Array<{ spotId: string; airingId: string; lengthSec: number; producer: boolean }>;
  skipped: Array<{ spotId: string; reason: string }>;
}

export function createFiller({ services }: ModuleContext) {
  async function fillOne(stationId: string, slot: BreakSlotView, tz: string, hasCredits: boolean): Promise<FillResult> {
    const result: FillResult = { breakId: slot.id!, placed: [], skipped: [] };
    const startsAt = new Date(slot.startsAt);
    const parts = partsOf(slot);
    const [rule, profile, already, entry, stationIdMs, fillers] = await Promise.all([
      services.stations.breakRule(stationId),
      services.stations.profiles([stationId]).then((m) => m.get(stationId)),
      services.spots.placedOnStation(stationId, new Date(startsAt.getTime() - HOUR), startsAt),
      slot.logEntryId ? services.log.entries(stationId, new Date(startsAt.getTime() - 6 * HOUR), new Date(startsAt.getTime() + 1)) : Promise.resolve([]),
      services.playout.stationIdMs(stationId),
      services.library.fillers(stationId)
    ]);
    const blocked = new Set((profile?.blockedCategories ?? []).map((c) => c.toLowerCase()));
    let hourMs = already.reduce((s, a) => s + a.lengthSec * 1000, 0);
    const perSpot = new Map<string, number>();
    for (const a of already) perSpot.set(a.spotId, (perSpot.get(a.spotId) ?? 0) + 1);

    const tryPlace = async (candidates: Array<{ spotId: string; lengthSec: number; category: string; dayparts: string[] }>, budgetMs: number, agreementId?: string) => {
      let used = 0;
      for (const spot of candidates) {
        const ms = spot.lengthSec * 1000;
        if (used + ms > budgetMs) continue;
        if (!agreementId && hourMs + ms > rule.spotMsPerHour) {
          result.skipped.push({ spotId: spot.spotId, reason: "hourly cap" });
          continue;
        }
        if ((perSpot.get(spot.spotId) ?? 0) >= rule.sameSpotPerHour) {
          result.skipped.push({ spotId: spot.spotId, reason: "same spot this hour" });
          continue;
        }
        if (blocked.has(spot.category.toLowerCase())) {
          result.skipped.push({ spotId: spot.spotId, reason: "blocked category" });
          continue;
        }
        if (!inDaypart(spot.dayparts, startsAt, tz)) {
          result.skipped.push({ spotId: spot.spotId, reason: "daypart" });
          continue;
        }
        try {
          const placed = await services.spots.place({ spotId: spot.spotId, stationId, breakId: slot.id!, scheduledAt: new Date(startsAt.getTime() + used), carriageAgreementId: agreementId });
          result.placed.push({ spotId: spot.spotId, airingId: placed.airingId, lengthSec: spot.lengthSec, producer: Boolean(agreementId) });
          used += ms;
          if (!agreementId) hourMs += ms;
          perSpot.set(spot.spotId, (perSpot.get(spot.spotId) ?? 0) + 1);
        } catch (error) {
          // Couldn't hold the money (or budget, daily cap): the next spot, then the backup rotation.
          result.skipped.push({ spotId: spot.spotId, reason: (error as { code?: string }).code ?? "refused" });
        }
      }
      return used;
    };

    // The producer's barter share, from the producer's own rotation. Whatever it leaves airs station ID and bumpers.
    const carried = entry.find((e) => e.id === slot.logEntryId && e.carriageAgreementId);
    if (slot.producerShareMs > 0 && carried?.carriageAgreementId) {
      const agreement = (await services.catalog.agreementsByIds([carried.carriageAgreementId])).get(carried.carriageAgreementId);
      if (agreement) {
        await tryPlace(await services.spots.rotationFor(agreement.makerStationId, "main"), slot.producerShareMs, agreement.id);
      }
    }

    // Spots don't air in this break (the cadence): the maker's share only, and not marked filled.
    if (!parts.spots) return result;

    // The station's own time, keeping room for what airs with the spots: the station ID, the
    // credit, and the bumpers into and out of the break, each where the break rule's cadence has
    // it in this break (a credit or bumper that doesn't air here keeps no room).
    if (rule.openTimeTo === "spot_market") {
      const credit = hasCredits && parts.underwriting;
      // A243: the break's chosen bumpers (its opening and closing sequences, and the between
      // sequence after it when it closes a program's slot), picked with the break.
      const bumpersMs = slot.elements ? elementsMs(slot) : defaultBumpersMs(fillers.bumpers, parts);
      const stationMs = slot.lengthMs - slot.producerShareMs - (parts.stationId ? stationIdMs : 0) - (credit ? CREDIT_MS : 0) - bumpersMs;
      if (stationMs > 0) {
        const used = await tryPlace(await services.spots.rotationFor(stationId, "main"), stationMs);
        if (used < stationMs) await tryPlace(await services.spots.rotationFor(stationId, "backup"), stationMs - used);
      }
    }
    await services.log.markBreakFilled(slot.id!);
    return result;
  }

  /** The breaks ahead that carry a catalog program's hourly credit (counted from the top of the first one's hour). */
  async function catalogCreditsAhead(stationId: string, slots: BreakSlotView[], tz: string, now: Date, aheadMs: number): Promise<Set<string>> {
    if (!slots.length) return new Set();
    const hourStart = hourStartIn(tz);
    const from = new Date(hourStart(Math.min(...slots.map((s) => Date.parse(s.startsAt)))));
    const to = new Date(now.getTime() + aheadMs);
    const entries = await services.log.entries(stationId, from, to);
    const { programOf } = await catalogEntries(services, stationId, entries, now);
    if (!programOf.size) return new Set();
    return catalogCreditBreaks(await services.log.breaks(stationId, from, to), (entryId) => programOf.has(entryId), hourStart);
  }

  return {
    /** Stores and fills every break starting in the next `aheadMs`. Money for each spot is held here. */
    async fillAhead(stationId: string, now: Date, aheadMs: number): Promise<FillResult[]> {
      const tz = await services.stations.timezoneOf(stationId);
      const slots = await services.log.ensureBreaks(stationId, now, new Date(now.getTime() + aheadMs));
      const credits = await services.spots.creditsFor(stationId);
      const members = await services.ledger.memberCredits(stationId);
      const waiting = slots.some((slot) => slot.id && !slot.filledAt);
      const catalogBreaks = waiting ? await catalogCreditsAhead(stationId, slots, tz, now, aheadMs) : new Set<string>();
      const results: FillResult[] = [];
      for (const slot of slots) {
        if (!slot.id || slot.filledAt) continue;
        // A break without spots is never marked filled: only its barter share is placed, once.
        if (!partsOf(slot).spots && (slot.producerShareMs === 0 || slot.filledMs > 0)) continue;
        // Room for the credit: the station's own, or a catalog program's hourly one (its series' sponsor, or Clear).
        results.push(await fillOne(stationId, slot, tz, credits.length > 0 || members.named.length > 0 || catalogBreaks.has(slot.startsAt)));
      }
      return results;
    },
    fillOne
  };
}
