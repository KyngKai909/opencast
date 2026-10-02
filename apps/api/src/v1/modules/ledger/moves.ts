// The outbox: what the payments provider has to do for each ledger entry.
//
// Each posting's account sits in a wallet (the adapter's `custody`). An entry's postings then say
// two things: how each hold's encumbrance changed, and how much each wallet gained or lost.
// Encumbrance changes become encumber/release moves; wallets that lost money pay wallets that
// gained it. Postings with no custody (banks, cards, the chain) were moved by whoever reported
// them, so they produce nothing.

import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Deps, Executor } from "../../context.js";
import type { AccountDirectory, LedgerAccount, Owner, Payments, ProviderAccountKind, Wallet } from "../../payments/index.js";

export interface PostingForMoves {
  account: LedgerAccount;
  micros: number;
  holdId: string | null;
  holdAdvertiserId: string | null;
}

export interface DerivedMove {
  kind: "encumber" | "release" | "transfer";
  fromWallet: Wallet;
  toWallet: Wallet | null;
  holdId: string | null;
  amountMicros: number;
}

export function deriveMoves(postings: PostingForMoves[], custody: Payments["custody"]): DerivedMove[] {
  const moves: DerivedMove[] = [];
  const net = new Map<Wallet, number>();
  const encumbrance = new Map<string, { wallet: Wallet; micros: number }>();
  for (const p of postings) {
    const wallet = custody(p.account, p.holdAdvertiserId);
    if (!wallet) continue;
    net.set(wallet, (net.get(wallet) ?? 0) + p.micros);
    if (p.account.kind === "holds" && p.holdId) {
      const e = encumbrance.get(p.holdId) ?? { wallet, micros: 0 };
      e.micros += p.micros;
      encumbrance.set(p.holdId, e);
    }
  }
  // Releases first (money has to be free before it can move), then transfers, then new encumbrances.
  for (const [holdId, e] of encumbrance) {
    if (e.micros < 0) moves.push({ kind: "release", fromWallet: e.wallet, toWallet: null, holdId, amountMicros: -e.micros });
  }
  const payers = [...net].filter(([, m]) => m < 0).map(([w, m]) => ({ wallet: w, left: -m }));
  const payees = [...net].filter(([, m]) => m > 0).map(([w, m]) => ({ wallet: w, left: m }));
  for (const payee of payees) {
    for (const payer of payers) {
      if (payee.left === 0) break;
      const amount = Math.min(payer.left, payee.left);
      if (amount <= 0) continue;
      moves.push({ kind: "transfer", fromWallet: payer.wallet, toWallet: payee.wallet, holdId: null, amountMicros: amount });
      payer.left -= amount;
      payee.left -= amount;
    }
  }
  for (const [holdId, e] of encumbrance) {
    if (e.micros > 0) moves.push({ kind: "encumber", fromWallet: e.wallet, toWallet: null, holdId, amountMicros: e.micros });
  }
  return moves;
}

/** Writes an entry's moves, in the entry's own transaction. */
export async function recordMoves(tx: Executor, payments: Payments, entryId: string, lines: Array<{ account: string; micros: number; holdId?: string }>) {
  const accountIds = [...new Set(lines.map((l) => l.account))];
  const holdIds = [...new Set(lines.map((l) => l.holdId).filter((v): v is string => Boolean(v)))];
  const [accounts, holds] = await Promise.all([
    tx.select().from(schema.accountsTable).where(inArray(schema.accountsTable.id, accountIds)),
    holdIds.length ? tx.select({ id: schema.holds.id, advertiserId: schema.holds.advertiserId }).from(schema.holds).where(inArray(schema.holds.id, holdIds)) : Promise.resolve([])
  ]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const holdOwner = new Map(holds.map((h) => [h.id, h.advertiserId]));
  const moves = deriveMoves(
    lines.map((l) => {
      const a = byId.get(l.account)!;
      return {
        account: { kind: a.kind, advertiserId: a.advertiserId, stationId: a.stationId, userId: a.userId, label: a.label },
        micros: l.micros,
        holdId: l.holdId ?? null,
        holdAdvertiserId: l.holdId ? (holdOwner.get(l.holdId) ?? null) : null
      };
    }),
    payments.custody
  );
  if (moves.length) {
    await tx.insert(schema.providerMoves).values(moves.map((m, seq) => ({ entryId, seq, kind: m.kind, fromWallet: m.fromWallet, toWallet: m.toWallet, holdId: m.holdId, amountMicros: m.amountMicros })));
  }
}

/** The provider accounts Opencast has opened, kept in `ledger.provider_accounts`. */
export function accountDirectory(db: Executor): AccountDirectory {
  const where = (owner: Owner, provider: ProviderAccountKind) => {
    const A = schema.providerAccounts;
    return and(
      eq(A.ownerType, owner.type),
      owner.type === "opencast" ? sql`${A.ownerId} is null` : eq(A.ownerId, owner.id),
      owner.type === "opencast" ? eq(A.ownerLabel, owner.label) : sql`${A.ownerLabel} is null`,
      eq(A.provider, provider)
    );
  };
  return {
    async get(owner, provider) {
      const [row] = await db.select().from(schema.providerAccounts).where(where(owner, provider));
      return row ? { ref: row.ref, status: row.status, onboardingUrl: row.onboardingUrl } : null;
    },
    async save(owner, provider, account) {
      const values = {
        ownerType: owner.type,
        ownerId: owner.type === "opencast" ? null : owner.id,
        ownerLabel: owner.type === "opencast" ? owner.label : null,
        provider,
        ref: account.ref,
        status: account.status,
        onboardingUrl: account.onboardingUrl ?? null
      };
      await db
        .insert(schema.providerAccounts)
        .values(values)
        .onConflictDoUpdate({
          target: [schema.providerAccounts.ownerType, schema.providerAccounts.ownerId, schema.providerAccounts.ownerLabel, schema.providerAccounts.provider],
          set: { ref: values.ref, status: values.status, onboardingUrl: values.onboardingUrl }
        });
    }
  };
}

const MAX_ATTEMPTS = 12;

/**
 * Sends what's pending, oldest first. A wallet whose move fails is skipped for the rest of the
 * run, so its later moves never overtake it (a transfer can't run before the release it needs).
 */
export async function sendMoves(deps: Deps, limit = 200): Promise<{ sent: number; failed: number }> {
  const M = schema.providerMoves;
  const pending = await deps.db
    .select()
    .from(M)
    .where(or(eq(M.status, "pending"), and(eq(M.status, "failed"), lt(M.attempts, MAX_ATTEMPTS))))
    .orderBy(asc(M.createdAt), asc(M.entryId), asc(M.seq))
    .limit(limit);
  const blocked = new Set<Wallet>();
  const directory = accountDirectory(deps.db);
  let sent = 0;
  let failed = 0;
  for (const move of pending) {
    if (blocked.has(move.fromWallet) || (move.toWallet && blocked.has(move.toWallet))) continue;
    try {
      const done = await deps.payments.applyMove(
        { id: move.id, kind: move.kind, fromWallet: move.fromWallet, toWallet: move.toWallet, holdId: move.holdId, amountMicros: move.amountMicros, idempotencyKey: `move:${move.id}` },
        directory
      );
      await deps.db.update(M).set({ status: "sent", providerRef: done.providerRef, sentAt: deps.clock.now(), attempts: move.attempts + 1, lastError: null }).where(eq(M.id, move.id));
      sent++;
    } catch (error) {
      blocked.add(move.fromWallet);
      if (move.toWallet) blocked.add(move.toWallet);
      await deps.db
        .update(M)
        .set({ status: "failed", attempts: move.attempts + 1, lastError: (error as Error).message.slice(0, 500) })
        .where(eq(M.id, move.id));
      failed++;
    }
  }
  return { sent, failed };
}
