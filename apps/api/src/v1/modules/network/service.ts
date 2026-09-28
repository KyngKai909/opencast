import { and, asc, eq, gte, ilike, inArray, lt } from "drizzle-orm";
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
  marketForZip(zip: string): Promise<Market | null>;
  /** Other markets within `maxMiles` of this one's centre, nearest first. */
  nearbyMarkets(marketId: string, maxMiles?: number): Promise<Array<{ market: Market; miles: number }>>;
  listedAiringsByIds(ids: string[]): Promise<Map<string, ListedAiringRef>>;
  listedAiringsInWindow(stationIds: string[], from: Date, to: Date): Promise<Map<string, ListedAiringRef[]>>;
  searchListedAirings(q: string, after: Date): Promise<ListedAiringRef[]>;
  /** A listed station plays in the source's own player. */
  listedPlayback(stationIds: string[]): Promise<Map<string, string>>;
  /** For a claimable station: who it's run for, and whether it's been claimed. */
  claimableInfo(stationId: string): Promise<{ runFor: string; claimed: boolean } | null>;
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

    async marketBySlug(slug) {
      const [row] = await db.select().from(m).where(eq(m.slug, slug));
      return row ? toMarket(row) : null;
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

    async listedPlayback(stationIds) {
      if (!stationIds.length) return new Map();
      const rows = await db
        .select({ stationId: schema.listedSources.stationId, url: schema.listedSources.streamUrl, embed: schema.listedSources.embedTerms })
        .from(schema.listedSources)
        .where(inArray(schema.listedSources.stationId, stationIds));
      // "Terms unclear" means we link to the source rather than embed it; both play in the source's player.
      return new Map(rows.map((r) => [r.stationId, r.url]));
    },

    async claimableInfo(stationId) {
      const [creator] = await db.select().from(schema.creators).where(eq(schema.creators.stationId, stationId));
      if (!creator) return null;
      return { runFor: creator.personName ?? creator.displayName, claimed: creator.stage === "claimed" };
    }
  };
  return service;
}
