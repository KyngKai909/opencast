import { inArray } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../context.js";

export interface LibraryService {
  titles(input: { itemIds: string[]; programIds: string[] }): Promise<{ items: Map<string, string>; programs: Map<string, string> }>;
}

export function createLibraryService({ deps }: ModuleContext): LibraryService {
  const { db } = deps;

  return {
    async titles({ itemIds, programIds }) {
      const [items, programs] = await Promise.all([
        itemIds.length
          ? db.select({ id: schema.assets.id, title: schema.assets.title }).from(schema.assets).where(inArray(schema.assets.id, itemIds))
          : [],
        programIds.length
          ? db.select({ id: schema.programs.id, title: schema.programs.title }).from(schema.programs).where(inArray(schema.programs.id, programIds))
          : []
      ]);
      return { items: new Map(items.map((r) => [r.id, r.title])), programs: new Map(programs.map((r) => [r.id, r.title])) };
    }
  };
}
