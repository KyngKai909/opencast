// Invite-only sign-ups (added 2026-10-07, the user's request; packages/contracts invites.ts). Who's
// in, and the codes that let people in: a person's own (one use each, up to the
// `signups.codes_per_person` rule) and the desk's (any number of uses). Someone signed in who isn't
// in yet can redeem a code, accept a team invite, sign out or delete the account; the desk can let
// them in. While `signups.invite_only` is off, everyone signing in is let in at once.

import { randomInt } from "node:crypto";
import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { DeskInvites, InviteCheck, InviteCodeView, MyInvites } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import type { CurrentUser } from "../../http.js";
import { conflict, HttpError, notFound, refused } from "../../errors.js";

type How = "existing" | "open" | "admin" | "code" | "team_invite" | "desk";

/** No 0, O, 1, I or L: nothing to misread on a phone. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Any case, spaces or dashes: "7kq2-m9xp" is 7KQ2M9XP. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** As people see it: 7KQ2-M9XP. */
export function showCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function newCode(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export interface Invites {
  /** Lets someone in now, if they aren't already (the first way wins). */
  admit(db: Executor, userId: string, how: How, codeId?: string): Promise<void>;
  /** Whether sign-ups need a code now. */
  inviteOnly(): Promise<boolean>;
  check(code: string): Promise<InviteCheck>;
  redeem(user: CurrentUser, code: string): Promise<void>;
  mine(user: CurrentUser): Promise<MyInvites>;
  make(user: CurrentUser): Promise<InviteCodeView>;
  takeBack(user: CurrentUser, code: string): Promise<MyInvites>;
  desk(): Promise<DeskInvites>;
  deskMake(user: CurrentUser, input: { count: number; maxUses: number | null; note: string | null; expiresAt: string | null }): Promise<InviteCodeView[]>;
  deskRevoke(code: string): Promise<DeskInvites>;
  letIn(userId: string): Promise<DeskInvites>;
}

export function createInvites({ deps, services }: ModuleContext): Invites {
  const { db } = deps;
  const U = schema.users;
  const C = schema.inviteCodes;

  const inviteOnly = async () => (await services.settings.valueAt("signups.invite_only")).on;
  const allowance = async () => (await services.settings.valueAt("signups.codes_per_person")).codes;

  async function views(rows: Array<typeof C.$inferSelect>): Promise<InviteCodeView[]> {
    const joined = rows.length
      ? await db
          .select({ codeId: U.admittedByCode, name: U.displayName, deletedAt: U.deletedAt, at: U.admittedAt })
          .from(U)
          .where(inArray(U.admittedByCode, rows.map((r) => r.id)))
          .orderBy(desc(U.admittedAt))
      : [];
    return rows.map((r) => ({
      code: showCode(r.code),
      kind: r.kind,
      note: r.note,
      maxUses: r.maxUses,
      uses: r.uses,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      joined: joined
        .filter((j) => j.codeId === r.id && j.at)
        .slice(0, 50)
        .map((j) => ({ name: j.deletedAt ? null : j.name, at: j.at!.toISOString() }))
    }));
  }

  async function insertCodes(rows: Array<Omit<typeof C.$inferInsert, "code">>): Promise<Array<typeof C.$inferSelect>> {
    // A clash (31^8 codes, so rarely) just draws again for what's left.
    const out: Array<typeof C.$inferSelect> = [];
    for (let attempt = 0; attempt < 5 && rows.length; attempt++) {
      const made = await db
        .insert(C)
        .values(rows.map((r) => ({ ...r, code: newCode() })))
        .onConflictDoNothing({ target: C.code })
        .returning();
      out.push(...made);
      rows = rows.slice(made.length);
    }
    if (!rows.length) return out;
    throw new HttpError(500, "invite_codes_clash", "Couldn't make the codes. Try again.");
  }

  const service: Invites = {
    async admit(tx, userId, how, codeId) {
      await tx
        .update(U)
        .set({ admittedAt: deps.clock.now(), admittedHow: how, admittedByCode: codeId ?? null })
        .where(and(eq(U.id, userId), isNull(U.admittedAt)));
    },

    inviteOnly,

    async check(input) {
      const [row] = await db.select().from(C).where(eq(C.code, normalizeCode(input)));
      if (!row) return { usable: false, reason: "unknown", from: null };
      const [maker] = row.createdBy ? await db.select({ name: U.displayName }).from(U).where(eq(U.id, row.createdBy)) : [];
      const from = row.kind === "internal" ? "Opencast" : (maker?.name ?? null);
      const reason = row.revokedAt ? "revoked" : row.expiresAt && row.expiresAt <= deps.clock.now() ? "expired" : row.maxUses != null && row.uses >= row.maxUses ? "used" : null;
      return { usable: !reason, reason, from };
    },

    async redeem(user, input) {
      const code = normalizeCode(input);
      await db.transaction(async (tx) => {
        const [me] = await tx.select({ admittedAt: U.admittedAt }).from(U).where(eq(U.id, user.id));
        // Already in: the code isn't spent.
        if (me?.admittedAt) return;
        const [row] = await tx.select().from(C).where(eq(C.code, code)).for("update");
        if (!row) throw notFound("That invite code");
        if (row.revokedAt) throw conflict("invite_revoked", "That invite code was taken back. Ask for another.");
        if (row.expiresAt && row.expiresAt <= deps.clock.now()) throw refused("invite_expired", "That invite code has expired. Ask for another.");
        if (row.maxUses != null && row.uses >= row.maxUses) throw conflict("invite_used", "That invite code has been used. Ask for another.");
        await tx.update(C).set({ uses: sql`${C.uses} + 1` }).where(eq(C.id, row.id));
        await service.admit(tx, user.id, "code", row.id);
      });
    },

    async mine(user) {
      const [rows, limit, only] = await Promise.all([
        db.select().from(C).where(and(eq(C.createdBy, user.id), eq(C.kind, "personal"))).orderBy(desc(C.createdAt)),
        allowance(),
        inviteOnly()
      ]);
      // A code taken back before anyone used it goes back to what you can make.
      const counted = rows.filter((r) => !(r.revokedAt && r.uses === 0)).length;
      return { inviteOnly: only, allowance: limit, left: Math.max(0, limit - counted), codes: await views(rows.filter((r) => !(r.revokedAt && r.uses === 0))) };
    },

    async make(user) {
      const mine = await service.mine(user);
      if (mine.left <= 0) throw conflict("no_invites_left", `You've made all ${mine.allowance} of your invite codes.`);
      const [row] = await insertCodes([{ kind: "personal", createdBy: user.id, maxUses: 1 }]);
      return (await views([row!]))[0]!;
    },

    async takeBack(user, input) {
      const [row] = await db.select().from(C).where(and(eq(C.code, normalizeCode(input)), eq(C.createdBy, user.id), eq(C.kind, "personal")));
      if (!row) throw notFound("That invite code");
      if (row.uses > 0) throw conflict("invite_used", "Someone already came in with that code.");
      if (!row.revokedAt) await db.update(C).set({ revokedAt: deps.clock.now() }).where(eq(C.id, row.id));
      return service.mine(user);
    },

    async desk() {
      const [internal, waiting, [waitingCount], byHow, [made], top, only, perPerson] = await Promise.all([
        db.select().from(C).where(eq(C.kind, "internal")).orderBy(desc(C.createdAt)).limit(200),
        db
          .select({ userId: U.id, name: U.displayName, email: U.email, signedUpAt: U.createdAt })
          .from(U)
          .where(and(isNull(U.admittedAt), isNull(U.deletedAt)))
          .orderBy(desc(U.createdAt))
          .limit(200),
        db.select({ n: count() }).from(U).where(and(isNull(U.admittedAt), isNull(U.deletedAt))),
        db
          .select({ how: U.admittedHow, kind: C.kind, n: count() })
          .from(U)
          .leftJoin(C, eq(C.id, U.admittedByCode))
          .where(and(isNotNull(U.admittedAt), isNull(U.deletedAt)))
          .groupBy(U.admittedHow, C.kind),
        db.select({ n: count() }).from(C).where(eq(C.kind, "personal")),
        db
          .select({ name: U.displayName, email: U.email, joined: sql<number>`sum(${C.uses})::int` })
          .from(C)
          .innerJoin(U, eq(U.id, C.createdBy))
          .where(and(eq(C.kind, "personal"), sql`${C.uses} > 0`))
          .groupBy(U.id, U.displayName, U.email)
          .orderBy(sql`sum(${C.uses}) desc`)
          .limit(10),
        inviteOnly(),
        allowance()
      ]);
      const n = (f: (r: (typeof byHow)[number]) => boolean) => byHow.filter(f).reduce((t, r) => t + Number(r.n), 0);
      return {
        inviteOnly: only,
        codesPerPerson: perPerson,
        internal: await views(internal),
        waiting: waiting.map((w) => ({ ...w, signedUpAt: w.signedUpAt.toISOString() })),
        counts: {
          admitted: n(() => true),
          byPersonalCode: n((r) => r.how === "code" && r.kind === "personal"),
          byInternalCode: n((r) => r.how === "code" && r.kind === "internal"),
          byTeamInvite: n((r) => r.how === "team_invite"),
          byDesk: n((r) => r.how === "desk"),
          waiting: Number(waitingCount?.n ?? 0),
          personalCodesMade: Number(made?.n ?? 0)
        },
        topInviters: top.map((t) => ({ name: t.name, email: t.email, joined: t.joined }))
      };
    },

    async deskMake(user, input) {
      const rows = await insertCodes(
        Array.from({ length: input.count }, () => ({ kind: "internal" as const, createdBy: user.id, maxUses: input.maxUses, note: input.note || null, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }))
      );
      return views(rows);
    },

    async deskRevoke(input) {
      const [row] = await db.select({ id: C.id, revokedAt: C.revokedAt }).from(C).where(eq(C.code, normalizeCode(input)));
      if (!row) throw notFound("That invite code");
      if (!row.revokedAt) await db.update(C).set({ revokedAt: deps.clock.now() }).where(eq(C.id, row.id));
      return service.desk();
    },

    async letIn(userId) {
      const [row] = await db.select({ admittedAt: U.admittedAt, deletedAt: U.deletedAt }).from(U).where(eq(U.id, userId));
      if (!row || row.deletedAt) throw notFound("That person");
      await service.admit(db, userId, "desk");
      return service.desk();
    }
  };
  return service;
}
