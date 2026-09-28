import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../context.js";

export interface LedgerService {
  /** What each carriage agreement's producer was paid in a window (cash fees and barter shares). */
  carriagePaid(agreementIds: string[], from: Date, to: Date): Promise<Map<string, number>>;
}

export function createLedgerService({ deps }: ModuleContext): LedgerService {
  const { db } = deps;

  return {
    async carriagePaid(agreementIds, from, to) {
      if (!agreementIds.length) return new Map();
      const rows = await db
        .select({ agreementId: schema.entries.sourceId, micros: sql<number>`sum(${schema.postings.amountMicros})::bigint` })
        .from(schema.entries)
        .innerJoin(schema.postings, eq(schema.postings.entryId, schema.entries.id))
        .innerJoin(schema.accountsTable, eq(schema.accountsTable.id, schema.postings.accountId))
        .where(
          and(
            eq(schema.entries.sourceType, "agreement"),
            inArray(schema.entries.sourceId, agreementIds),
            inArray(schema.entries.kind, ["carriage_fee", "barter_split"]),
            eq(schema.accountsTable.kind, "station_earnings"),
            sql`${schema.postings.amountMicros} > 0`,
            gte(schema.entries.occurredAt, from),
            lt(schema.entries.occurredAt, to)
          )
        )
        .groupBy(schema.entries.sourceId);
      return new Map(rows.map((r) => [r.agreementId!, Number(r.micros)]));
    }
  };
}
