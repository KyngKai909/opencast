import { and, asc, eq, gte, ilike, inArray, lt, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Market } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { createDesk, type DeskPart } from "./desk.js";

export interface ListedAiringRef {
  id: string;
  stationId: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
}

export interface NetworkService extends DeskPart {
  marketsByIds(ids: string[]): Promise<Map<string, Market>>;
  marketBySlug(slug: string): Promise<Market | null>;
  allMarkets(): Promise<Market[]>;
  /** A251 Phase 7: the creator pipeline by stage (in these markets, or all), and markets opened in a span. */
  growth(marketIds: string[] | null, from: Date, to: Date): Promise<{ pipeline: Record<string, number>; addedToPipeline: number; marketsOpened: number; marketsOpen: number }>;
  /** A251 Phase 7: external stations' outages overlapping a span. */
  outagesBetween(stationIds: string[], from: Date, to: Date): Promise<Array<{ stationId: string; downSince: Date; backAt: Date | null }>>;
  /** A251: an external station's minutes down in a span (its outages overlapping it), per station. */
  outageMinutes(stationIds: string[], from: Date, to: Date): Promise<Map<string, number>>;
  marketForZip(zip: string): Promise<Market | null>;
  /** Other markets within `maxMiles` of this one's centre, nearest first. */
  nearbyMarkets(marketId: string, maxMiles?: number): Promise<Array<{ market: Market; miles: number }>>;
  /**
   * The market for a point (a device's location, or where its connection is): the nearest market
   * within 50 miles of its centre, and the others within 60 miles, nearest first. With nothing that
   * close, no market and the open markets by distance. The point isn't stored.
   */
  marketNear(point: { lat: number; lng: number }): Promise<{ market: Market | null; nearby: Array<{ market: Market; miles: number | null }> }>;
  /** Open markets by name, for when where someone is isn't known. */
  openMarkets(): Promise<Market[]>;
  listedAiringsByIds(ids: string[]): Promise<Map<string, ListedAiringRef>>;
  listedAiringsInWindow(stationIds: string[], from: Date, to: Date): Promise<Map<string, ListedAiringRef[]>>;
  searchListedAirings(q: string, after: Date): Promise<ListedAiringRef[]>;
  /** For a claimable station: who it's run for, and whether it's been claimed. */
  claimableInfo(stationId: string): Promise<{ runFor: string; claimed: boolean } | null>;
  /** Added 2026-09-29: the market a creator is in (a market lead works only in theirs). */
  creatorMarket(creatorId: string): Promise<string | null>;
}

export function toMarket(row: typeof schema.markets.$inferSelect): Market {
  return { id: row.id, slug: row.slug, name: row.name, timezone: row.timezone, open: row.openedAt !== null };
}

/** Great-circle distance in miles. */
export function miles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

function listedRef(airing: typeof schema.listedAirings.$inferSelect, stationId: string): ListedAiringRef {
  return {
    id: airing.id,
    stationId,
    title: airing.title,
    startsAt: airing.startsAt.toISOString(),
    endsAt: airing.endsAt ? airing.endsAt.toISOString() : null
  };
}

export function createNetworkService(ctx: ModuleContext): NetworkService {
  const { deps } = ctx;
  const { db } = deps;
  const m = schema.markets;

  const service: NetworkService = {
    ...createDesk(ctx),

    async marketsByIds(ids) {
      const unique = [...new Set(ids)];
      if (!unique.length) return new Map();
      const rows = await db.select().from(m).where(inArray(m.id, unique));
      return new Map(rows.map((r) => [r.id, toMarket(r)]));
    },

    async creatorMarket(creatorId) {
      const [row] = await db.select({ marketId: schema.creators.marketId }).from(schema.creators).where(eq(schema.creators.id, creatorId));
      return row?.marketId ?? null;
    },

    async marketBySlug(slug) {
      const [row] = await db.select().from(m).where(eq(m.slug, slug));
      return row ? toMarket(row) : null;
    },

    async outageMinutes(stationIds, from, to) {
      const out = new Map<string, number>();
      if (!stationIds.length) return out;
      const now = deps.clock.now();
      const rows = await db
        .select({ stationId: schema.listedSources.stationId, downSince: schema.externalOutages.downSince, backAt: schema.externalOutages.backAt })
        .from(schema.externalOutages)
        .innerJoin(schema.listedSources, eq(schema.listedSources.id, schema.externalOutages.listedSourceId))
        .where(and(inArray(schema.listedSources.stationId, stationIds), lt(schema.externalOutages.downSince, to)));
      for (const r of rows) {
        const a = Math.max(r.downSince.getTime(), from.getTime());
        const b = Math.min((r.backAt ?? now).getTime(), to.getTime());
        if (b > a) out.set(r.stationId, (out.get(r.stationId) ?? 0) + Math.round((b - a) / 60_000));
      }
      return out;
    },

    async growth(marketIds, from, to) {
      const C = schema.creators;
      const inMarkets = marketIds ? [inArray(C.marketId, marketIds.length ? marketIds : ["00000000-0000-0000-0000-000000000000"])] : [];
      const [stages, added, markets] = await Promise.all([
        db.select({ stage: C.stage, n: sql<number>`count(*)::int` }).from(C).where(and(...inMarkets)).groupBy(C.stage),
        db.select({ n: sql<number>`count(*)::int` }).from(C).where(and(gte(C.createdAt, from), lt(C.createdAt, to), ...inMarkets)),
        db.select({ openedAt: schema.markets.openedAt }).from(schema.markets)
      ]);
      return {
        pipeline: Object.fromEntries(stages.map((r) => [r.stage, r.n])),
        addedToPipeline: added[0]?.n ?? 0,
        marketsOpened: markets.filter((m) => m.openedAt && m.openedAt >= from && m.openedAt < to).length,
        marketsOpen: markets.filter((m) => m.openedAt && m.openedAt < to).length
      };
    },

    async outagesBetween(stationIds, from, to) {
      if (!stationIds.length) return [];
      const rows = await db
        .select({ stationId: schema.listedSources.stationId, downSince: schema.externalOutages.downSince, backAt: schema.externalOutages.backAt })
        .from(schema.externalOutages)
        .innerJoin(schema.listedSources, eq(schema.listedSources.id, schema.externalOutages.listedSourceId))
        .where(and(inArray(schema.listedSources.stationId, stationIds), lt(schema.externalOutages.downSince, to)));
      return rows.filter((r) => !r.backAt || r.backAt > from);
    },

    async allMarkets() {
      const rows = await db.select().from(m).orderBy(asc(m.name));
      return rows.map(toMarket);
    },

    async marketForZip(zip) {
      const [row] = await db
        .select({ market: m })
        .from(schema.zipMarkets)
        .innerJoin(m, eq(m.id, schema.zipMarkets.marketId))
        .where(eq(schema.zipMarkets.zip, zip));
      return row ? toMarket(row.market) : null;
    },

    async nearbyMarkets(marketId, maxMiles = 60) {
      const rows = await db.select().from(m);
      const home = rows.find((r) => r.id === marketId);
      if (!home?.latitude || !home.longitude) return [];
      const centre = { lat: Number(home.latitude), lng: Number(home.longitude) };
      return rows
        .filter((r) => r.id !== marketId && r.latitude && r.longitude)
        .map((r) => ({ market: toMarket(r), miles: Math.round(miles(centre, { lat: Number(r.latitude), lng: Number(r.longitude) })) }))
        .filter((r) => r.miles <= maxMiles)
        .sort((a, b) => a.miles - b.miles);
    },

    async marketNear(point) {
      const rows = await db.select().from(m);
      const placed = rows
        .filter((r) => r.latitude && r.longitude)
        .map((r) => ({ row: r, miles: Math.round(miles(point, { lat: Number(r.latitude), lng: Number(r.longitude) })) }))
        .sort((a, b) => a.miles - b.miles);
      const home = placed.find((p) => p.miles <= 50);
      if (home) {
        return {
          market: toMarket(home.row),
          nearby: placed.filter((p) => p !== home && p.miles <= 60).map((p) => ({ market: toMarket(p.row), miles: p.miles }))
        };
      }
      const open = rows.filter((r) => r.openedAt !== null);
      const distance = new Map(placed.map((p) => [p.row.id, p.miles]));
      return {
        market: null,
        nearby: open
          .map((r) => ({ market: toMarket(r), miles: distance.get(r.id) ?? null }))
          .sort((a, b) => (a.miles ?? Infinity) - (b.miles ?? Infinity) || a.market.name.localeCompare(b.market.name))
      };
    },

    async openMarkets() {
      const rows = await db.select().from(m).orderBy(asc(m.name));
      return rows.filter((r) => r.openedAt !== null).map(toMarket);
    },

    async listedAiringsByIds(ids) {
      if (!ids.length) return new Map();
      const rows = await db
        .select({ airing: schema.listedAirings, source: schema.listedSources })
        .from(schema.listedAirings)
        .innerJoin(schema.listedSources, eq(schema.listedSources.id, schema.listedAirings.listedSourceId))
        .where(inArray(schema.listedAirings.id, ids));
      return new Map(rows.map(({ airing, source }) => [airing.id, listedRef(airing, source.stationId)]));
    },

    async listedAiringsInWindow(stationIds, from, to) {
      if (!stationIds.length) return new Map();
      const rows = await db
        .select({ airing: schema.listedAirings, source: schema.listedSources })
        .from(schema.listedAirings)
        .innerJoin(schema.listedSources, eq(schema.listedSources.id, schema.listedAirings.listedSourceId))
        .where(
          and(
            inArray(schema.listedSources.stationId, stationIds),
            lt(schema.listedAirings.startsAt, to),
            gte(schema.listedAirings.startsAt, new Date(from.getTime() - 6 * 3_600_000))
          )
        )
        .orderBy(asc(schema.listedAirings.startsAt));
      const result = new Map<string, ListedAiringRef[]>();
      for (const { airing, source } of rows) {
        const ends = airing.endsAt ?? new Date(airing.startsAt.getTime() + 3_600_000);
        if (ends <= from) continue;
        result.set(source.stationId, [...(result.get(source.stationId) ?? []), listedRef(airing, source.stationId)]);
      }
      return result;
    },

    async searchListedAirings(q, after) {
      const rows = await db
        .select({ airing: schema.listedAirings, source: schema.listedSources })
        .from(schema.listedAirings)
        .innerJoin(schema.listedSources, eq(schema.listedSources.id, schema.listedAirings.listedSourceId))
        .where(and(ilike(schema.listedAirings.title, `%${q.replace(/[%_]/g, "")}%`), gte(schema.listedAirings.startsAt, after)))
        .orderBy(asc(schema.listedAirings.startsAt))
        .limit(20);
      return rows.map(({ airing, source }) => listedRef(airing, source.stationId));
    },

    async claimableInfo(stationId) {
      const [creator] = await db.select().from(schema.creators).where(eq(schema.creators.stationId, stationId));
      if (!creator) return null;
      return { runFor: creator.personName ?? creator.displayName, claimed: creator.stage === "claimed" };
    }
  };
  return service;
}
