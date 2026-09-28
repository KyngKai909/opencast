import { and, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../context.js";

export interface StandingView {
  status: "good" | "offers_paused";
  openClaims: number;
  upheldLast12Months: number;
  threshold: number;
}

export interface TrustService {
  standing(stationId: string): Promise<StandingView>;
  /** Items with an open claim: off air everywhere until answered. */
  offAirItems(itemIds: string[]): Promise<Set<string>>;
}

export function createTrustService({ deps }: ModuleContext): TrustService {
  const { db } = deps;
  const C = schema.claims;

  const service: TrustService = {
    async standing(stationId) {
      const [policy] = await db.select().from(schema.policy).where(eq(schema.policy.id, 1));
      const threshold = policy?.upheldPerYearToPauseOffers ?? 3;
      const yearAgo = new Date(deps.clock.now().getTime() - 365 * 86_400_000);
      const [counts] = await db
        .select({
          open: sql<number>`count(*) filter (where ${C.status} = 'open')::int`,
          upheld: sql<number>`count(*) filter (where ${C.status} = 'upheld' and ${C.closedAt} >= ${yearAgo})::int`
        })
        .from(C)
        .where(eq(C.stationId, stationId));
      return {
        status: counts.upheld >= threshold ? "offers_paused" : "good",
        openClaims: counts.open,
        upheldLast12Months: counts.upheld,
        threshold
      };
    },

    async offAirItems(itemIds) {
      if (!itemIds.length) return new Set();
      const rows = await db
        .select({ assetId: C.assetId })
        .from(C)
        .where(and(inArray(C.assetId, itemIds), eq(C.status, "open")));
      return new Set(rows.map((r) => r.assetId));
    }
  };
  return service;
}
