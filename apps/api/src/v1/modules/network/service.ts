import { eq, inArray } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Market } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";

export interface ListedAiringRef {
  id: string;
  stationId: string;
  title: string;
  startsAt: string;
}

export interface NetworkService {
  marketsByIds(ids: string[]): Promise<Map<string, Market>>;
  marketBySlug(slug: string): Promise<Market | null>;
  listedAiringsByIds(ids: string[]): Promise<Map<string, ListedAiringRef>>;
}

export function toMarket(row: typeof schema.markets.$inferSelect): Market {
  return { id: row.id, slug: row.slug, name: row.name, timezone: row.timezone, open: row.openedAt !== null };
}

export function createNetworkService({ deps }: ModuleContext): NetworkService {
  const { db } = deps;

  return {
    async marketsByIds(ids) {
      const unique = [...new Set(ids)];
      if (!unique.length) return new Map();
      const rows = await db.select().from(schema.markets).where(inArray(schema.markets.id, unique));
      return new Map(rows.map((r) => [r.id, toMarket(r)]));
    },

    async marketBySlug(slug) {
      const [row] = await db.select().from(schema.markets).where(eq(schema.markets.slug, slug));
      return row ? toMarket(row) : null;
    },

    async listedAiringsByIds(ids) {
      if (!ids.length) return new Map();
      const rows = await db
        .select({ airing: schema.listedAirings, source: schema.listedSources })
        .from(schema.listedAirings)
        .innerJoin(schema.listedSources, eq(schema.listedSources.id, schema.listedAirings.listedSourceId))
        .where(inArray(schema.listedAirings.id, ids));
      return new Map(
        rows.map(({ airing, source }) => [
          airing.id,
          { id: airing.id, stationId: source.stationId, title: airing.title, startsAt: airing.startsAt.toISOString() }
        ])
      );
    }
  };
}
