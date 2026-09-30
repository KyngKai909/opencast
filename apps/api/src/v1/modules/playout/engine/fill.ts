// Fills upcoming breaks with spots, holding the money for each airing first.
// Spots come from the station's rotation (then its backup rotation), within the
// hourly cap, the same-spot limit, blocked categories and dayparts. Inside a
// carried program under barter, the producer's share is filled from the
// producer's rotation (the producer is paid for those). What's left is for the
// credit, bumpers and the station ID, which playout adds when it airs the break.

import type { ModuleContext } from "../../../context.js";
import { tzOffsetMinutes } from "../../../lib/time.js";
import type { BreakSlotView } from "../../log/service.js";

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

export interface FillResult {
  breakId: string;
  placed: Array<{ spotId: string; airingId: string; lengthSec: number; producer: boolean }>;
  skipped: Array<{ spotId: string; reason: string }>;
}

export function createFiller({ services }: ModuleContext) {
  async function fillOne(stationId: string, slot: BreakSlotView, tz: string, hasCredits: boolean): Promise<FillResult> {
    const result: FillResult = { breakId: slot.id!, placed: [], skipped: [] };
    const startsAt = new Date(slot.startsAt);
    const [rule, profile, already, entry, stationIdMs] = await Promise.all([
      services.stations.breakRule(stationId),
      services.stations.profiles([stationId]).then((m) => m.get(stationId)),
      services.spots.placedOnStation(stationId, new Date(startsAt.getTime() - HOUR), startsAt),
      slot.logEntryId ? services.log.entries(stationId, new Date(startsAt.getTime() - 6 * HOUR), new Date(startsAt.getTime() + 1)) : Promise.resolve([]),
      services.playout.stationIdMs(stationId)
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

    // The station's own time, keeping room for the credit and the station ID.
    if (rule.openTimeTo === "spot_market") {
      // A station whose credit never airs in breaks (its cadence, added 2026-09-29) keeps no room for it.
      const credit = hasCredits && rule.cadence.underwriting.every !== "never";
      const stationMs = slot.lengthMs - slot.producerShareMs - stationIdMs - (credit ? CREDIT_MS : 0);
      if (stationMs > 0) {
        const used = await tryPlace(await services.spots.rotationFor(stationId, "main"), stationMs);
        if (used < stationMs) await tryPlace(await services.spots.rotationFor(stationId, "backup"), stationMs - used);
      }
    }
    await services.log.markBreakFilled(slot.id!);
    return result;
  }

  return {
    /** Stores and fills every break starting in the next `aheadMs`. Money for each spot is held here. */
    async fillAhead(stationId: string, now: Date, aheadMs: number): Promise<FillResult[]> {
      const tz = await services.stations.timezoneOf(stationId);
      const slots = await services.log.ensureBreaks(stationId, now, new Date(now.getTime() + aheadMs));
      const credits = await services.spots.creditsFor(stationId);
      const members = await services.ledger.memberCredits(stationId);
      const results: FillResult[] = [];
      for (const slot of slots) {
        if (!slot.id || slot.filledAt) continue;
        results.push(await fillOne(stationId, slot, tz, credits.length > 0 || members.named.length > 0));
      }
      return results;
    },
    fillOne
  };
}
