// Who a per-thousand spot is billed for (follow-up Phase 3): Opencast's own viewers and the viewers
// connected YouTube and Twitch report while it airs on a relayed station. Flat per-airing spots are
// unaffected.
//
// - Online businesses ("where your customers are: online"): every Opencast viewer, plus every relay
//   viewer, at the spot's rate.
// - Local businesses (a location or a service area): only viewers Opencast can place inside the
//   spot's area. Opencast viewers by the market they're placed in (their chosen market, or a coarse
//   location from the connection); relay viewers only where the platform says where they are:
//   YouTube's viewer geography per broadcast (a day or two late), as the share of the broadcast's
//   viewers inside the area, applied to the relay viewers during the spot. Twitch doesn't say, so
//   Twitch viewers are never billed to local businesses; no YouTube location data, not billed.
//
// Money: the hold covers Opencast's viewers plus an estimate for the relay part. The airing settles
// for Opencast's viewers when it airs and keeps the relay estimate held; each platform's relay part
// (a `relay_charges` row) settles when its numbers are in (online) or YouTube's location data
// arrives (local). None by `relays.location_wait` (7 days): not charged, returned to the balance.
// Other apps viewers (P5.1) are the airing's third part, kept held beside these (`otherAppViewers.ts`).

import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@opencast/db";
import { PLATFORM_NAMES, relayViewersLabel, relayWaitingLabel, type CountedPlatform, type RelayPartStatus, type RelayViewersLine, type RelayViewersPart } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { miles } from "../network/service.js";

const SP = schema.spotsTable;
const AD = schema.advertisers;
const AI = schema.airings;
const RC = schema.relayCharges;
const OC = schema.otherAppCharges;
const MINUTE = 60_000;
const DAY = 86_400_000;
/** A platform's count for a minute comes in within the minute after: settled after this. */
const COUNTS_SETTLE_MS = 2 * MINUTE;

type SpotRow = typeof SP.$inferSelect;
type AiringRow = typeof AI.$inferSelect;
type ChargeRow = typeof RC.$inferSelect;

/** A local business's area: its locations and reach, and the markets it covers. */
export interface Area {
  online: boolean;
  points: Array<{ lat: number; lng: number }>;
  /** Miles from a location; null: no reach set (then a place is inside when it's in one of `markets`). */
  radius: number | null;
  markets: Set<string>;
}

const fmt = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const pct = (share: number) => `${Math.round(share * 100)}%`;

const REASONS: Record<string, string> = {
  twitch_no_location: "Twitch doesn't report where viewers are, so they aren't billed to local businesses",
  no_location_data: "YouTube had no location data for these viewers, so they aren't billed",
  no_viewers: "No viewers were reported during the spot",
  not_connected: "The platform wasn't connected when it aired",
  waited: "YouTube's location data didn't arrive in time, so this wasn't charged"
};

export interface RelayViewers {
  /** A spot's area on a station (online businesses: everywhere). */
  area(spot: SpotRow, stationId: string): Promise<Area>;
  /** The relay part of a per-thousand spot's hold: the usual relay viewers at this hour (local: YouTube's only). */
  holdEstimate(spot: SpotRow, stationId: string, at: Date): Promise<number>;
  /** Opencast's viewers billed for a per-thousand airing: all tuned in (online), or those placed inside the area (local). */
  opencastViewers(spot: SpotRow, stationId: string, from: Date, to: Date): Promise<{ tunedIn: number; billed: number; local: boolean }>;
  /**
   * Opens the relay parts of an airing that just aired, one per counted platform, and answers how
   * much of its hold stays held for them.
   */
  open(input: { airing: AiringRow; spot: SpotRow; startedAt: Date; endedAt: Date; fraction: number; opencastCostMicros: number; openHoldMicros: number }): Promise<number>;
  /** Settles, marks not billed, or returns each waiting relay part whose numbers are in (run every minute). */
  settleDue(): Promise<{ settled: number; notBilled: number; returned: number }>;
  /** What's still held for relay viewers waiting for location data, per platform. */
  waiting(businessId: string): Promise<Array<{ platform: CountedPlatform; heldMicros: number; airings: number }>>;
  /** Each airing's relay parts, as results show them. */
  parts(airingIds: string[]): Promise<Map<string, RelayViewersPart[]>>;
  /** A period's relay viewers per platform, added up. */
  lines(parts: RelayViewersPart[][]): RelayViewersLine[];
  /** Airings whose relay parts are still open (their holds aren't "unaired"). */
  openAirings(airingIds: string[]): Promise<Set<string>>;
}

export function createRelayViewers({ deps, services }: ModuleContext): RelayViewers {
  const { db } = deps;

  async function areaFor(spot: SpotRow, stationId: string): Promise<Area> {
    const [business] = await db.select().from(AD).where(eq(AD.id, spot.advertiserId));
    const online = business?.customersWhere === "online";
    if (online) return { online, points: [], radius: null, markets: new Set() };
    const [locations, [targeting], profile] = await Promise.all([
      db.select().from(schema.advertiserLocations).where(eq(schema.advertiserLocations.advertiserId, spot.advertiserId)),
      db.select().from(schema.targeting).where(eq(schema.targeting.spotId, spot.id)),
      services.stations.profiles([stationId]).then((m) => m.get(stationId))
    ]);
    const chosen = targeting?.locationIds.length ? locations.filter((l) => targeting.locationIds.includes(l.id)) : locations;
    const reach = targeting?.withinMiles ?? null;
    // As matching measures it: a service area reaches its radius (or further, if the spot says so).
    const radius = business?.customersWhere === "service_area" ? Math.max(reach ?? 0, ...chosen.map((l) => l.radiusMiles ?? 0)) || null : reach;
    const markets = new Set<string>();
    // The station a local spot airs on is inside its area (that's how it was matched): its market is.
    if (profile?.marketId) markets.add(profile.marketId);
    for (const l of chosen) {
      const near = await services.network.marketNear({ lat: l.latitude, lng: l.longitude });
      if (near.market) markets.add(near.market.id);
      for (const n of near.nearby) if (radius !== null && n.miles !== null && n.miles <= radius) markets.add(n.market.id);
    }
    return { online, points: chosen.map((l) => ({ lat: l.latitude, lng: l.longitude })), radius, markets };
  }

  async function inside(area: Area, place: { latitude: number | null; longitude: number | null }): Promise<boolean> {
    if (place.latitude === null || place.longitude === null) return false;
    const point = { lat: place.latitude, lng: place.longitude };
    if (area.radius !== null) return area.points.some((p) => miles(p, point) <= area.radius!);
    const near = await services.network.marketNear(point);
    return Boolean(near.market && area.markets.has(near.market.id));
  }

  async function shareInArea(area: Area, places: Array<{ label: string; latitude: number | null; longitude: number | null; share: number }>) {
    let share = 0;
    for (const p of places) if (await inside(area, p)) share += p.share;
    return Math.min(1, share);
  }

  async function settleCharge(charge: ChargeRow, airing: AiringRow, spot: SpotRow, outcome: { status: "settled" | "not_billed" | "returned"; reason?: string; viewers?: number | null; shareInArea?: number | null; billedViewers?: number | null; costMicros?: number; working?: string | null; broadcastRef?: string | null }) {
    const now = deps.clock.now();
    await db.transaction(async (tx) => {
      // Still held for the airing's other platforms' parts: kept.
      const others = await tx
        .select({ held: RC.heldMicros })
        .from(RC)
        .where(and(eq(RC.airingId, charge.airingId), inArray(RC.status, ["counting", "waiting_location"])));
      // And for the airing's Other apps part while it counts (P5.1).
      const otherApps = await tx
        .select({ held: OC.heldMicros })
        .from(OC)
        .where(and(eq(OC.airingId, charge.airingId), eq(OC.status, "counting")));
      const keep = others.reduce((s, r) => s + r.held, 0) - charge.heldMicros + otherApps.reduce((s, r) => s + r.held, 0);
      const source = { sourceType: "relay_viewers", sourceId: charge.id };
      let returnedMicros = 0;
      if (outcome.status === "settled" && (outcome.costMicros ?? 0) > 0) {
        let barter: { producerStationId: string; producerShare: number; agreementId: string } | undefined;
        if (airing.carriageAgreementId) {
          const agreement = (await services.catalog.agreementsByIds([airing.carriageAgreementId])).get(airing.carriageAgreementId);
          if (agreement) barter = { producerStationId: agreement.makerStationId, producerShare: 1, agreementId: agreement.id };
        }
        await services.ledger.settle(tx, {
          holdId: airing.holdId,
          stationId: airing.stationId,
          costMicros: outcome.costMicros!,
          kind: "airing",
          source: { ...source, memo: relayViewersLabel(charge.platform), idempotencyKey: `relay:${charge.id}` },
          barter,
          keepHeldMicros: Math.max(0, keep)
        });
      } else {
        const memo =
          outcome.status === "returned"
            ? `Returned: no location data from ${PLATFORM_NAMES[charge.platform]} in time`
            : outcome.status === "not_billed"
              ? `Returned: ${PLATFORM_NAMES[charge.platform]} relay viewers not billed`
              : `Returned: what ${PLATFORM_NAMES[charge.platform]}'s relay viewers didn't use`;
        const openNow = (await services.ledger.openAmount([airing.holdId])).get(airing.holdId) ?? 0;
        const release = openNow - Math.max(0, keep);
        if (release > 0) returnedMicros = await services.ledger.release(tx, airing.holdId, release, { ...source, memo });
      }
      await tx
        .update(RC)
        .set({
          status: outcome.status,
          reason: outcome.reason ?? null,
          viewers: outcome.viewers ?? charge.viewers,
          shareInArea: outcome.shareInArea ?? charge.shareInArea,
          billedViewers: outcome.billedViewers ?? null,
          costMicros: outcome.status === "settled" ? (outcome.costMicros ?? 0) : 0,
          working: outcome.working ?? null,
          broadcastRef: outcome.broadcastRef ?? charge.broadcastRef,
          heldMicros: 0,
          returnedMicros: outcome.status === "returned" ? returnedMicros : 0,
          resolvedAt: now
        })
        .where(eq(RC.id, charge.id));
    });
    await services.ledger.checkRunway(spot.advertiserId);
  }

  function costOf(charge: ChargeRow, airing: AiringRow, billedViewers: number) {
    const full = (billedViewers * airing.rateMicros) / 1000;
    const cost = Math.round(full * charge.fraction);
    return charge.capMicros === null ? cost : Math.min(cost, charge.capMicros);
  }

  const part: RelayViewers = {
    area: areaFor,

    async holdEstimate(spot, stationId, at) {
      const counted = await services.platforms.countedPlatforms(stationId);
      if (!counted.length) return 0;
      const [typical, [business]] = await Promise.all([services.platforms.typicalViewers(stationId, at), db.select({ where: AD.customersWhere }).from(AD).where(eq(AD.id, spot.advertiserId))]);
      const kinds = new Set(counted.map((c) => c.platform));
      const online = business?.where === "online";
      // Local businesses: YouTube's viewers only (all of them: the hold is a ceiling; what isn't used goes back).
      const viewers = (kinds.has("youtube") ? typical.youtube : 0) + (online && kinds.has("twitch") ? typical.twitch : 0);
      return Math.round((viewers * spot.rateMicros) / 1000);
    },

    async opencastViewers(spot, stationId, from, to) {
      const tunedIn = await services.audience.averageTunedIn(stationId, from, to);
      const area = await areaFor(spot, stationId);
      if (area.online) return { tunedIn, billed: tunedIn, local: false };
      const placed = await services.audience.placedTunedIn(stationId, from, to, [...area.markets]);
      return { tunedIn, billed: Math.min(tunedIn, placed), local: true };
    },

    async open({ airing, spot, startedAt, endedAt, fraction, opencastCostMicros, openHoldMicros }) {
      const counted = await services.platforms.countedPlatforms(airing.stationId);
      if (!counted.length) return 0;
      const [business] = await db.select({ where: AD.customersWhere }).from(AD).where(eq(AD.id, spot.advertiserId));
      const audience = business?.where === "online" ? "online" : "local";
      const wait = (await services.settings.valueAt("relays.location_wait")).days;
      const capMicros = spot.perAiringMaxMicros ? Math.max(0, Math.round(spot.perAiringMaxMicros * fraction) - opencastCostMicros) : null;
      // The estimate held at placement, shared between the platforms it can be spent on.
      const reserve = Math.max(0, Math.min(openHoldMicros - opencastCostMicros, airing.relayEstimateMicros));
      // Shared between the platforms it can be spent on (local businesses: YouTube's only), by their usual viewers.
      const billable = counted.filter((c) => audience === "online" || c.platform === "youtube");
      const typical = await services.platforms.typicalViewers(airing.stationId, startedAt);
      const weights = billable.map((c) => typical[c.platform] ?? 0);
      const total = weights.reduce((a, b) => a + b, 0);
      const shares = billable.map((_, i) => (total > 0 ? Math.floor((reserve * weights[i]) / total) : Math.floor(reserve / billable.length)));
      if (shares.length) shares[0] += reserve - shares.reduce((a, b) => a + b, 0);
      const rows = counted.map((c) => {
        const i = billable.indexOf(c);
        const held = i >= 0 ? shares[i] : 0;
        return {
          airingId: airing.id,
          platformId: c.platformId,
          platform: c.platform,
          audience: audience as "online" | "local",
          startedAt,
          endedAt,
          fraction: Math.max(0, Math.min(1, fraction)),
          capMicros,
          heldMicros: held,
          dueBy: new Date(endedAt.getTime() + wait * DAY),
          createdAt: deps.clock.now()
        };
      });
      await db.insert(RC).values(rows).onConflictDoNothing();
      // Settled twice (the same as-run): what's kept is what its open parts still hold.
      const held = await db
        .select({ held: RC.heldMicros })
        .from(RC)
        .where(and(eq(RC.airingId, airing.id), inArray(RC.status, ["counting", "waiting_location"])));
      return held.reduce((s, r) => s + r.held, 0);
    },

    async settleDue() {
      const now = deps.clock.now();
      const open = await db
        .select({ charge: RC, airing: AI, spot: SP })
        .from(RC)
        .innerJoin(AI, eq(AI.id, RC.airingId))
        .innerJoin(SP, eq(SP.id, AI.spotId))
        .where(inArray(RC.status, ["counting", "waiting_location"]));
      let settled = 0;
      let notBilled = 0;
      let returned = 0;
      for (const { charge, airing, spot } of open) {
        if (now.getTime() < charge.endedAt.getTime() + COUNTS_SETTLE_MS) continue;
        const counts = await services.platforms.viewersDuring(charge.platformId, charge.startedAt, charge.endedAt);
        const viewers = Math.round(counts.viewers * 10) / 10;
        const broadcastRef = counts.broadcasts[0]?.ref ?? null;
        const rate = `${fmt(airing.rateMicros)} ÷ 1,000${charge.fraction < 1 ? ` × ${Math.round(charge.fraction * 100)}% aired` : ""}`;
        if (counts.viewers <= 0) {
          await settleCharge(charge, airing, spot, { status: "not_billed", reason: "no_viewers", viewers: 0 });
          notBilled++;
          continue;
        }
        if (charge.audience === "online") {
          const cost = costOf(charge, airing, counts.viewers);
          await settleCharge(charge, airing, spot, { status: "settled", viewers, billedViewers: counts.viewers, costMicros: cost, working: `${Math.round(counts.viewers)} × ${rate} = ${fmt(cost)}`, broadcastRef });
          settled++;
          continue;
        }
        if (charge.platform === "twitch") {
          await settleCharge(charge, airing, spot, { status: "not_billed", reason: "twitch_no_location", viewers, broadcastRef });
          notBilled++;
          continue;
        }
        // A local business on YouTube: the share YouTube places inside the area, when its data comes.
        const geos = await Promise.all(counts.broadcasts.map(async (b) => ({ ...b, geo: await services.platforms.geography(charge.platformId, b.ref, b.day) })));
        if (!geos.length || geos.some((g) => g.geo.status === "pending")) {
          if (now >= charge.dueBy) {
            await settleCharge(charge, airing, spot, { status: "returned", reason: "waited", viewers, broadcastRef });
            returned++;
          } else if (charge.status === "counting") {
            await db.update(RC).set({ status: "waiting_location", viewers, broadcastRef }).where(eq(RC.id, charge.id));
          }
          continue;
        }
        if (geos.every((g) => g.geo.status === "none")) {
          await settleCharge(charge, airing, spot, { status: "not_billed", reason: "no_location_data", viewers, broadcastRef });
          notBilled++;
          continue;
        }
        const area = await areaFor(spot, airing.stationId);
        let share = 0;
        for (const g of geos) if (g.geo.status === "ready") share += g.weight * (await shareInArea(area, g.geo.places));
        const billed = counts.viewers * share;
        const cost = costOf(charge, airing, billed);
        await settleCharge(charge, airing, spot, {
          status: "settled",
          viewers,
          shareInArea: share,
          billedViewers: billed,
          costMicros: cost,
          working: `${Math.round(counts.viewers)} × ${pct(share)} in your area × ${rate} = ${fmt(cost)}`,
          broadcastRef
        });
        settled++;
      }
      return { settled, notBilled, returned };
    },

    async waiting(businessId) {
      const rows = await db
        .select({ platform: RC.platform, held: RC.heldMicros })
        .from(RC)
        .innerJoin(AI, eq(AI.id, RC.airingId))
        .innerJoin(SP, eq(SP.id, AI.spotId))
        .where(and(eq(SP.advertiserId, businessId), eq(RC.status, "waiting_location")));
      const by = new Map<CountedPlatform, { platform: CountedPlatform; heldMicros: number; airings: number }>();
      for (const r of rows) {
        const w = by.get(r.platform) ?? { platform: r.platform, heldMicros: 0, airings: 0 };
        w.heldMicros += r.held;
        w.airings++;
        by.set(r.platform, w);
      }
      return [...by.values()];
    },

    async parts(airingIds) {
      const result = new Map<string, RelayViewersPart[]>();
      if (!airingIds.length) return result;
      const rows = await db.select().from(RC).where(inArray(RC.airingId, airingIds));
      for (const r of rows) {
        const status = r.status as RelayPartStatus;
        const list = result.get(r.airingId) ?? [];
        list.push({
          platform: r.platform,
          label: status === "waiting_location" ? relayWaitingLabel(r.platform) : relayViewersLabel(r.platform),
          status,
          reason: r.reason ? (REASONS[r.reason] ?? r.reason) : null,
          viewers: r.viewers,
          shareInArea: r.audience === "local" && r.platform === "youtube" ? r.shareInArea : null,
          billedViewers: r.billedViewers,
          costMicros: r.costMicros,
          heldMicros: r.heldMicros,
          returnedMicros: r.returnedMicros,
          working: r.working
        });
        result.set(r.airingId, list.sort((a, b) => a.platform.localeCompare(b.platform)).reverse());
      }
      return result;
    },

    lines(parts) {
      const by = new Map<CountedPlatform, RelayViewersLine>();
      for (const list of parts) {
        for (const p of list) {
          const line = by.get(p.platform) ?? { platform: p.platform, label: relayViewersLabel(p.platform), airings: 0, viewersAddedUp: 0, billedViewersAddedUp: 0, spentMicros: 0, waitingMicros: 0, waitingAirings: 0, returnedMicros: 0 };
          line.airings++;
          line.viewersAddedUp += Math.round(p.viewers ?? 0);
          line.billedViewersAddedUp += Math.round(p.billedViewers ?? 0);
          line.spentMicros += p.costMicros;
          line.returnedMicros += p.returnedMicros ?? 0;
          if (p.status === "waiting_location" || p.status === "counting") {
            line.waitingMicros += p.heldMicros;
            line.waitingAirings++;
          }
          by.set(p.platform, line);
        }
      }
      return [...by.values()].sort((a, b) => (a.platform === "youtube" ? -1 : 1) - (b.platform === "youtube" ? -1 : 1));
    },

    async openAirings(airingIds) {
      if (!airingIds.length) return new Set();
      const rows = await db
        .select({ airingId: RC.airingId })
        .from(RC)
        .where(and(inArray(RC.airingId, airingIds), inArray(RC.status, ["counting", "waiting_location"])));
      return new Set(rows.map((r) => r.airingId));
    }
  };
  return part;
}
