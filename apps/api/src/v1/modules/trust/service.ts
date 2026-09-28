// Rights claims: an item comes off air at once, everywhere it's carried, until
// the station answers. No answer by the deadline removes it from the library,
// which counts as removed, not upheld.

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Claim } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { notFound, refused } from "../../errors.js";

export interface StandingView {
  status: "good" | "offers_paused";
  openClaims: number;
  upheldLast12Months: number;
  threshold: number;
}

export interface ClaimInput {
  itemId: string;
  claimantName: string;
  claimantRole?: string;
  claimantContact: string;
  workKind?: string;
  claimText: string;
  rangeStartMs?: number;
  rangeEndMs?: number;
}

export interface TrustService {
  standing(stationId: string): Promise<StandingView>;
  /** Items with an open claim: off air everywhere until answered. */
  offAirItems(itemIds: string[]): Promise<Set<string>>;
  file(input: ClaimInput): Promise<{ claimId: string; answerDueAt: string }>;
  claims(stationId: string): Promise<Claim[]>;
  stationOfClaim(claimId: string): Promise<string>;
  answer(claimId: string, userId: string, input: { basis: "made_it" | "owner_permission" | "public_domain"; note?: string; attachmentUrl?: string }): Promise<Claim>;
  remove(claimId: string): Promise<Claim>;
  resolve(claimId: string, outcome: "upheld" | "withdrawn" | "restored"): Promise<Claim>;
  /** Open claims past their deadline: removed from the library. Run by the scheduler. */
  expireOverdue(): Promise<number>;
}

const DAY = 86_400_000;

/** Adds business days (Monday to Friday). */
export function addBusinessDays(from: Date, days: number): Date {
  const at = new Date(from);
  let added = 0;
  while (added < days) {
    at.setUTCDate(at.getUTCDate() + 1);
    const weekday = at.getUTCDay();
    if (weekday !== 0 && weekday !== 6) added++;
  }
  return at;
}

export function createTrustService({ deps, services }: ModuleContext): TrustService {
  const { db } = deps;
  const C = schema.claims;
  const A = schema.answers;
  const T = schema.takedowns;

  async function policy() {
    const [row] = await db.select().from(schema.policy).where(eq(schema.policy.id, 1));
    return { threshold: row?.upheldPerYearToPauseOffers ?? 3, answerDays: row?.answerDays ?? 14, replyDays: row?.claimantReplyBusinessDays ?? 10 };
  }

  async function views(rows: Array<typeof C.$inferSelect>): Promise<Claim[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [answers, takedowns, titles] = await Promise.all([
      db.select().from(A).where(inArray(A.claimId, ids)),
      db.select().from(T).where(inArray(T.claimId, ids)),
      services.library.titles({ itemIds: rows.map((r) => r.assetId), programIds: [] })
    ]);
    const replacements = await services.library.titles({
      itemIds: takedowns.map((t) => t.replacedWithAssetId).filter((v): v is string => Boolean(v)),
      programIds: []
    });
    const idents = await services.stations.idents([...rows.map((r) => r.stationId), ...takedowns.map((t) => t.stationId)]);
    const now = deps.clock.now().getTime();
    return rows.flatMap((r) => {
      const station = idents.get(r.stationId);
      if (!station) return [];
      const answer = answers.find((a) => a.claimId === r.id);
      return [
        {
          id: r.id,
          item: { id: r.assetId, title: titles.items.get(r.assetId) ?? "" },
          station,
          claimantName: r.claimantName,
          claimantRole: r.claimantRole,
          workKind: r.workKind,
          claimText: r.claimText,
          rangeStartMs: r.rangeStartMs,
          rangeEndMs: r.rangeEndMs,
          swornStatement: r.swornStatement,
          state: r.status,
          receivedAt: r.receivedAt.toISOString(),
          answerDueAt: r.answerDueAt.toISOString(),
          daysToAnswer: r.status === "open" ? Math.max(0, Math.ceil((r.answerDueAt.getTime() - now) / DAY)) : null,
          answer: answer
            ? {
                basis: answer.basis,
                note: answer.note,
                attachmentUrl: answer.attachmentUrl,
                answeredAt: answer.answeredAt.toISOString(),
                claimantReplyDueAt: answer.claimantReplyDueAt.toISOString()
              }
            : null,
          takedowns: takedowns
            .filter((t) => t.claimId === r.id)
            .flatMap((t) => {
              const where = idents.get(t.stationId);
              return where
                ? [
                    {
                      station: where,
                      pulledAt: t.pulledAt.toISOString(),
                      airingsReplaced: t.airingsReplaced,
                      replacedWith: t.replacedWithAssetId ? (replacements.items.get(t.replacedWithAssetId) ?? null) : null,
                      restoredAt: t.restoredAt?.toISOString() ?? null
                    }
                  ]
                : [];
            })
        }
      ];
    });
  }

  async function one(claimId: string) {
    const [row] = await db.select().from(C).where(eq(C.id, claimId));
    if (!row) throw notFound("That claim");
    return row;
  }

  const service: TrustService = {
    async standing(stationId) {
      const { threshold } = await policy();
      const yearAgo = new Date(deps.clock.now().getTime() - 365 * DAY);
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
    },

    async file(input) {
      const item = (await services.library.itemsByIds([input.itemId])).get(input.itemId);
      if (!item || item.archived) throw notFound("That item");
      const { answerDays } = await policy();
      const now = deps.clock.now();
      const answerDueAt = new Date(now.getTime() + answerDays * DAY);
      const [claim] = await db
        .insert(C)
        .values({
          assetId: item.id,
          stationId: item.stationId,
          claimantName: input.claimantName,
          claimantRole: input.claimantRole ?? null,
          claimantContact: input.claimantContact,
          workKind: input.workKind ?? null,
          claimText: input.claimText,
          rangeStartMs: input.rangeStartMs ?? null,
          rangeEndMs: input.rangeEndMs ?? null,
          swornStatement: true,
          receivedAt: now,
          answerDueAt
        })
        .returning();
      // Off air at once: every future airing, on the maker and every carrier.
      const pulled = await services.log.pullItem(item.id);
      const stations = new Set([item.stationId, ...pulled.map((p) => p.stationId)]);
      for (const stationId of stations) {
        await db.insert(T).values({
          claimId: claim.id,
          stationId,
          pulledAt: now,
          airingsReplaced: pulled.find((p) => p.stationId === stationId)?.entries ?? 0
        });
      }
      deps.bus.emit("claim.filed", {
        claimId: claim.id,
        stationId: item.stationId,
        itemTitle: item.title,
        carrierStationIds: [...stations].filter((s) => s !== item.stationId)
      });
      return { claimId: claim.id, answerDueAt: answerDueAt.toISOString() };
    },

    async claims(stationId) {
      const rows = await db.select().from(C).where(eq(C.stationId, stationId)).orderBy(desc(C.receivedAt));
      return views(rows);
    },

    async stationOfClaim(claimId) {
      return (await one(claimId)).stationId;
    },

    async answer(claimId, userId, input) {
      const claim = await one(claimId);
      if (claim.status !== "open") throw refused("not_open", "That claim has been dealt with.");
      const setup = await services.stations.setup(claim.stationId);
      if (!setup.legalName || !setup.legalContact) {
        throw refused("legal_details", "Add the station's legal name and contact in Settings first. They're sent with your answer.");
      }
      const { replyDays } = await policy();
      const now = deps.clock.now();
      await db.transaction(async (tx) => {
        await tx.insert(A).values({
          claimId,
          basis: input.basis,
          note: input.note ?? null,
          attachmentUrl: input.attachmentUrl ?? null,
          attestedBy: userId,
          legalName: setup.legalName!,
          legalContact: setup.legalContact!,
          answeredAt: now,
          claimantReplyDueAt: addBusinessDays(now, replyDays)
        });
        await tx.update(C).set({ status: "answered" }).where(eq(C.id, claimId));
        // Back on air: the station can put it on the log again.
        await tx.update(T).set({ restoredAt: now }).where(eq(T.claimId, claimId));
      });
      return (await views([await one(claimId)]))[0];
    },

    async remove(claimId) {
      const claim = await one(claimId);
      if (claim.status !== "open" && claim.status !== "answered") throw refused("not_open", "That claim has been dealt with.");
      await services.library.archiveForClaim(claim.assetId);
      await db.update(C).set({ status: "removed", closedAt: deps.clock.now() }).where(eq(C.id, claimId));
      return (await views([await one(claimId)]))[0];
    },

    async resolve(claimId, outcome) {
      const claim = await one(claimId);
      const now = deps.clock.now();
      if (outcome === "upheld") await services.library.archiveForClaim(claim.assetId);
      await db.update(C).set({ status: outcome, closedAt: now }).where(eq(C.id, claimId));
      if (outcome !== "upheld") await db.update(T).set({ restoredAt: now }).where(and(eq(T.claimId, claimId), sql`${T.restoredAt} is null`));
      return (await views([await one(claimId)]))[0];
    },

    async expireOverdue() {
      const overdue = await db
        .select()
        .from(C)
        .where(and(eq(C.status, "open"), lt(C.answerDueAt, deps.clock.now())));
      for (const claim of overdue) {
        await services.library.archiveForClaim(claim.assetId);
        await db.update(C).set({ status: "expired", closedAt: deps.clock.now() }).where(eq(C.id, claim.id));
      }
      return overdue.length;
    }
  };
  return service;
}
