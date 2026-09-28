import { eq, inArray, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../context.js";

export interface SpotsService {
  businessNames(ids: string[]): Promise<Map<string, string>>;
  /** Spot time already placed in each break. */
  filledMsByBreak(breakIds: string[]): Promise<Map<string, number>>;
}

export function createSpotsService({ deps }: ModuleContext): SpotsService {
  const { db } = deps;

  return {
    async businessNames(ids) {
      const unique = [...new Set(ids)];
      if (!unique.length) return new Map();
      const rows = await db
        .select({ id: schema.advertisers.id, name: schema.advertisers.name })
        .from(schema.advertisers)
        .where(inArray(schema.advertisers.id, unique));
      return new Map(rows.map((r) => [r.id, r.name]));
    },

    async filledMsByBreak(breakIds) {
      if (!breakIds.length) return new Map();
      const rows = await db
        .select({ breakId: schema.airings.breakId, ms: sql<number>`sum(${schema.spotsTable.lengthSec} * 1000)::int` })
        .from(schema.airings)
        .innerJoin(schema.spotsTable, eq(schema.spotsTable.id, schema.airings.spotId))
        .where(inArray(schema.airings.breakId, breakIds))
        .groupBy(schema.airings.breakId);
      return new Map(rows.map((r) => [r.breakId, r.ms]));
    }
  };
}
