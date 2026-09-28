import { and, eq, inArray, isNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import { formatChannelNumber } from "@opencast/domain";
import type { StationIdent } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";

export type StationKind = "station" | "studio" | "claimable" | "listed" | "catalog";

export interface StationsService {
  /** Idents for a set of stations, keyed by id. Unknown ids are left out. */
  idents(ids: string[]): Promise<Map<string, StationIdent>>;
  kindOf(stationId: string): Promise<StationKind | null>;
  removeHost(stationId: string, userId: string): Promise<void>;
}

export function createStationsService({ deps, services }: ModuleContext): StationsService {
  const { db } = deps;
  const s = schema.stations;
  const c = schema.channels;

  const service: StationsService = {
    async idents(ids) {
      const unique = [...new Set(ids)];
      if (!unique.length) return new Map();
      const rows = await db
        .select({ station: s, channel: c })
        .from(s)
        .leftJoin(c, and(eq(c.stationId, s.id), eq(c.isPrimary, true), isNull(c.releasedAt)))
        .where(inArray(s.id, unique));
      const markets = await services.network.marketsByIds(rows.map((r) => r.channel?.marketId).filter((v): v is string => Boolean(v)));
      return new Map(
        rows.map(({ station, channel }) => [
          station.id,
          {
            id: station.id,
            kind: station.kind,
            callSign: station.callSign,
            handle: station.handle,
            name: station.name,
            colour: station.colour,
            band: channel?.band ?? null,
            channel: channel ? formatChannelNumber({ band: channel.band, tenths: channel.tenths }) : null,
            marketSlug: channel ? (markets.get(channel.marketId)?.slug ?? null) : null,
            homeCity: station.homeCity
          }
        ])
      );
    },

    async kindOf(stationId) {
      const [row] = await db.select({ kind: s.kind }).from(s).where(eq(s.id, stationId));
      return row?.kind ?? null;
    },

    async removeHost(stationId, userId) {
      await db
        .delete(schema.hostAssignments)
        .where(and(eq(schema.hostAssignments.stationId, stationId), eq(schema.hostAssignments.userId, userId)));
    }
  };
  return service;
}
