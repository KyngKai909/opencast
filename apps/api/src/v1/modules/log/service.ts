import { inArray } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../context.js";

export interface AiringRef {
  id: string;
  stationId: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface LogService {
  /** Log entries by id, with a display title (the episode, else the item's or program's title). */
  airingsByIds(ids: string[]): Promise<Map<string, AiringRef>>;
}

export function createLogService({ deps, services }: ModuleContext): LogService {
  const { db } = deps;

  return {
    async airingsByIds(ids) {
      if (!ids.length) return new Map();
      const rows = await db.select().from(schema.logEntries).where(inArray(schema.logEntries.id, ids));
      const titles = await services.library.titles({
        itemIds: rows.map((r) => r.assetId).filter((v): v is string => Boolean(v)),
        programIds: rows.map((r) => r.programId).filter((v): v is string => Boolean(v))
      });
      return new Map(
        rows.map((r) => [
          r.id,
          {
            id: r.id,
            stationId: r.stationId,
            title:
              r.episodeTitle ??
              (r.programId ? titles.programs.get(r.programId) : undefined) ??
              (r.assetId ? titles.items.get(r.assetId) : undefined) ??
              (r.kind === "off_air" ? "Off air" : "Untitled"),
            startsAt: r.startsAt.toISOString(),
            endsAt: r.endsAt.toISOString()
          }
        ])
      );
    }
  };
}
