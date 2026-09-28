import { inArray } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../context.js";

export interface SpotsService {
  businessNames(ids: string[]): Promise<Map<string, string>>;
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
    }
  };
}
