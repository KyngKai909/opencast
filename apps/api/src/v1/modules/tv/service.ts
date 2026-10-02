// The TV app: devices, sign-in by code (B2), TVs on the account, and the phone remote's relay.
//
// A TV registers on first launch and keeps an opaque device token. "Sign in on your phone" shows a
// 6-character code; the person approves it on their phone; the TV's next poll collects a TV
// session token, once. That token acts as the person on the account endpoints a TV uses (marked
// `tvSession` in the contracts) and as the device on the TV's own endpoints. Every token is kept
// only as its SHA-256.

import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, desc, eq, gt, gte, isNull, lt, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { RegisteredTv, Tv, TvCode, TvCodeStatus, TvPlatform } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import type { CurrentUser, TvTokenResolution } from "../../http.js";
import { conflict, HttpError, notFound } from "../../errors.js";
import { createRemote, type Remote } from "./remote.js";

const MINUTE = 60_000;
/** Sign-in codes last 10 minutes. */
export const CODE_MS = 10 * MINUTE;
export const POLL_SECONDS = 3;
/** No 0/O or 1/I, so it reads from a sofa. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Wrong sign-in codes: this many per person in the window, then 429. */
const APPROVE_LIMIT = { tries: 10, windowMs: 15 * MINUTE };
/** Last-used times are written at most this often. */
const TOUCH_MS = MINUTE;

export const PLATFORM_NAMES: Record<TvPlatform, string> = {
  android_tv: "Android TV",
  fire_tv: "Fire TV",
  google_tv: "Google TV",
  tv_browser: "TV",
  web: "TV mode"
};

export interface TvService {
  /** What a `tvd_`, `tvs_` or `tvp_` token is, or null (unknown, signed out, unpaired). */
  resolveToken(token: string): Promise<TvTokenResolution | null>;
  register(input: { platform: TvPlatform; name?: string }): Promise<RegisteredTv>;
  createCode(tvId: string): Promise<TvCode>;
  pollCode(pollToken: string): Promise<TvCodeStatus>;
  approveCode(user: CurrentUser, code: string): Promise<Tv>;
  /** The TV signs itself out. */
  signOutDevice(tvId: string): Promise<void>;
  listTvs(userId: string): Promise<Tv[]>;
  /** Ends a TV's session on this account, or forgets a cast target. */
  signOutTv(userId: string, tvId: string): Promise<Tv[]>;
  recordCastTarget(userId: string, input: { kind: "chromecast" | "airplay"; name: string }): Promise<Tv>;
  /** A1: every TV signed in to the account signs out (and is told), and the phones the person drives TVs with are dropped. */
  signOutEverywhere(userId: string): Promise<void>;
  /** A3: signs out everywhere and forgets the account's cast targets. */
  forgetUser(userId: string): Promise<void>;
  /** The live session on a TV, if it's signed in. */
  liveSession(tvId: string): Promise<{ id: string; userId: string } | null>;
  remote: Remote;
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = (prefix: "tvd_" | "tvs_" | "tvp_") => `${prefix}${randomBytes(32).toString("base64url")}`;
export const tooManyTries = () => new HttpError(429, "too_many_tries", "Too many wrong codes. Wait a few minutes and try again.");

/** "K7Q 4MP", "k7q4mp" and "K7Q-4MP" are all K7Q4MP. */
export function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function makeCode(random: (max: number) => number = (max) => randomInt(0, max)): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[random(CODE_ALPHABET.length)]).join("");
}

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);
const latest = (...dates: Array<Date | null | undefined>) =>
  dates.reduce<Date | null>((best, d) => (d && (!best || d > best) ? d : best), null);

export function createTvService(ctx: ModuleContext): TvService {
  const { deps, services } = ctx;
  const { db } = deps;
  const D = schema.tvDevices;
  const S = schema.tvSessions;
  const C = schema.tvSignInCodes;
  const T = schema.tvCastTargets;
  const A = schema.tvCodeAttempts;
  const now = () => deps.clock.now();

  /** Counts a wrong code and says whether the key is over its limit (checked before the lookup). */
  const attempts = {
    async over(scope: "sign_in" | "pair", key: string, limit: { tries: number; windowMs: number }) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(A)
        .where(and(eq(A.scope, scope), eq(A.key, key), gte(A.at, new Date(now().getTime() - limit.windowMs))));
      return (row?.n ?? 0) >= limit.tries;
    },
    async wrong(scope: "sign_in" | "pair", key: string) {
      const at = now();
      await db.insert(A).values({ scope, key, at });
      // Kept only as long as a limit looks back.
      await db.delete(A).where(and(eq(A.scope, scope), eq(A.key, key), lt(A.at, new Date(at.getTime() - 60 * MINUTE))));
    }
  };

  async function device(tvId: string) {
    const [row] = await db.select().from(D).where(eq(D.id, tvId));
    return row ?? null;
  }

  function appView(d: typeof D.$inferSelect, s: typeof S.$inferSelect, castingNow: boolean): Tv {
    return {
      id: d.id,
      name: d.name ?? PLATFORM_NAMES[d.platform],
      kind: "tv_app",
      platform: d.platform,
      signedIn: s.endedAt === null,
      lastUsedAt: iso(latest(s.lastUsedAt, s.claimedAt, s.createdAt, s.endedAt === null ? d.lastSeenAt : null)),
      online: Boolean(d.onlineUntil && d.onlineUntil > now()),
      castingNow
    };
  }

  function targetView(t: typeof T.$inferSelect): Tv {
    return { id: t.id, name: t.name, kind: t.kind, platform: null, signedIn: false, lastUsedAt: iso(t.lastUsedAt ?? t.createdAt), online: false, castingNow: false };
  }

  /** Ends the TV's live session, if any; its account's phones stop driving it. */
  async function endSession(tx: Executor, tvId: string, by: "tv" | "account" | "replaced") {
    const [ended] = await tx
      .update(S)
      .set({ endedAt: now(), endedBy: by })
      .where(and(eq(S.deviceId, tvId), isNull(S.endedAt)))
      .returning();
    return ended ?? null;
  }

  const service: TvService = {
    async resolveToken(token) {
      const hash = hashToken(token);
      const at = now();
      const stale = new Date(at.getTime() - TOUCH_MS);
      if (token.startsWith("tvd_")) {
        const [row] = await db.select({ id: D.id, lastSeenAt: D.lastSeenAt }).from(D).where(eq(D.tokenHash, hash));
        if (!row) return null;
        if (!row.lastSeenAt || row.lastSeenAt < stale) await db.update(D).set({ lastSeenAt: at }).where(eq(D.id, row.id));
        return { kind: "device", tvId: row.id };
      }
      if (token.startsWith("tvs_")) {
        const [row] = await db
          .select()
          .from(S)
          .where(and(eq(S.tokenHash, hash), isNull(S.endedAt)));
        if (!row) return null;
        const person = await services.accounts.currentUser(row.userId);
        if (!person) return null;
        if (!row.lastUsedAt || row.lastUsedAt < stale) {
          await db.update(S).set({ lastUsedAt: at }).where(eq(S.id, row.id));
          await db.update(D).set({ lastSeenAt: at }).where(eq(D.id, row.deviceId));
        }
        // A TV is never an admin, whoever signed it in.
        return { kind: "tv_session", tvId: row.deviceId, sessionId: row.id, user: { id: person.id, privyDid: person.privyDid, isAdmin: false, viaTv: { tvId: row.deviceId, sessionId: row.id } } };
      }
      if (token.startsWith("tvp_")) {
        const phone = await service.remote.phoneForToken(hash);
        return phone ? { kind: "phone", phoneId: phone.id, tvId: phone.deviceId } : null;
      }
      return null;
    },

    async register(input) {
      const deviceToken = newToken("tvd_");
      const [row] = await db
        .insert(D)
        .values({ platform: input.platform, name: input.name ?? null, tokenHash: hashToken(deviceToken), lastSeenAt: now() })
        .returning();
      return { tvId: row.id, deviceToken };
    },

    async createCode(tvId) {
      const at = now();
      const expiresAt = new Date(at.getTime() + CODE_MS);
      const pollToken = randomBytes(24).toString("base64url");
      const code = await db.transaction(async (tx) => {
        // A new code replaces the TV's earlier ones, so a renewed code is visibly new.
        await tx
          .update(C)
          .set({ expiresAt: at })
          .where(and(eq(C.deviceId, tvId), isNull(C.approvedAt), gt(C.expiresAt, at)));
        for (;;) {
          const candidate = makeCode();
          const [taken] = await tx
            .select({ id: C.id })
            .from(C)
            .where(and(eq(C.code, candidate), gt(C.expiresAt, at)));
          if (taken) continue;
          await tx.insert(C).values({ deviceId: tvId, code: candidate, pollTokenHash: hashToken(pollToken), createdAt: at, expiresAt });
          return candidate;
        }
      });
      const origin = deps.config.appOrigin.replace(/\/+$/, "");
      let host = origin;
      try {
        host = new URL(origin).host;
      } catch {
        // Not a URL: shown as it is.
      }
      return { code, qrUrl: `${origin}/tv?code=${code}`, enterAt: `${host}/tv`, expiresAt: expiresAt.toISOString(), pollToken, pollSeconds: POLL_SECONDS };
    },

    async pollCode(pollToken) {
      const [code] = await db.select().from(C).where(eq(C.pollTokenHash, hashToken(pollToken)));
      if (!code) throw new HttpError(404, "not_found", "That code wasn't found. The TV will show a new one.");
      const at = now();
      if (code.claimedAt) return { status: "expired" };
      if (code.approvedAt && code.sessionId) {
        const token = newToken("tvs_");
        const claimed = await db.transaction(async (tx) => {
          const [mine] = await tx
            .update(C)
            .set({ claimedAt: at })
            .where(and(eq(C.id, code.id), isNull(C.claimedAt)))
            .returning();
          if (!mine) return false;
          const [session] = await tx
            .update(S)
            .set({ tokenHash: hashToken(token), claimedAt: at, lastUsedAt: at })
            .where(and(eq(S.id, code.sessionId!), isNull(S.endedAt), isNull(S.tokenHash)))
            .returning();
          return Boolean(session);
        });
        if (!claimed) return { status: "expired" };
        const names = await services.accounts.displayNames([code.approvedBy!]);
        return { status: "approved", token, signedInAs: names.get(code.approvedBy!) ?? null };
      }
      if (code.expiresAt <= at) return { status: "expired" };
      return { status: "pending" };
    },

    async approveCode(user, raw) {
      if (await attempts.over("sign_in", user.id, APPROVE_LIMIT)) throw tooManyTries();
      const code = normaliseCode(raw);
      const at = now();
      const [row] =
        code.length === 6
          ? await db
              .select()
              .from(C)
              .where(and(eq(C.code, code), gt(C.expiresAt, at)))
              .orderBy(desc(C.createdAt))
              .limit(1)
          : [];
      if (!row) {
        await attempts.wrong("sign_in", user.id);
        throw new HttpError(404, "code_not_found", "That code isn't right, or it's run out. Check the code on the TV.");
      }
      if (row.approvedAt) throw conflict("code_used", "That code has been used. The TV will show a new one.");
      const previous = await db.transaction(async (tx) => {
        const [mine] = await tx
          .update(C)
          .set({ approvedAt: at, approvedBy: user.id })
          .where(and(eq(C.id, row.id), isNull(C.approvedAt)))
          .returning();
        if (!mine) throw conflict("code_used", "That code has been used. The TV will show a new one.");
        const ended = await endSession(tx, row.deviceId, "replaced");
        const [session] = await tx.insert(S).values({ deviceId: row.deviceId, userId: user.id, createdAt: at, lastUsedAt: at }).returning();
        await tx.update(C).set({ sessionId: session.id }).where(eq(C.id, row.id));
        return ended;
      });
      // Someone else's phones stop driving it; the same person's keep going.
      if (previous && previous.userId !== user.id) await service.remote.accountSignedOut(row.deviceId);
      const [d] = await db.select().from(D).where(eq(D.id, row.deviceId));
      const [s] = await db
        .select()
        .from(S)
        .where(and(eq(S.deviceId, row.deviceId), isNull(S.endedAt)));
      return appView(d, s, false);
    },

    async signOutDevice(tvId) {
      const ended = await endSession(db, tvId, "tv");
      if (ended) await service.remote.accountSignedOut(tvId);
    },

    async liveSession(tvId) {
      const [row] = await db
        .select({ id: S.id, userId: S.userId })
        .from(S)
        .where(and(eq(S.deviceId, tvId), isNull(S.endedAt)));
      return row ?? null;
    },

    async listTvs(userId) {
      const [apps, targets] = await Promise.all([
        db
          .select({ session: S, device: D })
          .from(S)
          .innerJoin(D, eq(D.id, S.deviceId))
          .where(and(eq(S.userId, userId), isNull(S.endedAt))),
        db.select().from(T).where(eq(T.userId, userId)).orderBy(desc(T.lastUsedAt))
      ]);
      const casting = await service.remote.accountPhonesConnected(
        apps.map((a) => a.device.id),
        userId
      );
      const views = apps.map((a) => appView(a.device, a.session, casting.has(a.device.id)));
      views.sort((a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? ""));
      return [...views, ...targets.map(targetView)];
    },

    async signOutTv(userId, tvId) {
      const [session] = await db
        .select()
        .from(S)
        .where(and(eq(S.deviceId, tvId), eq(S.userId, userId), isNull(S.endedAt)));
      if (session) {
        await endSession(db, tvId, "account");
        await service.remote.accountSignedOut(tvId, { tellTv: true });
      } else {
        const [target] = await db
          .delete(T)
          .where(and(eq(T.id, tvId), eq(T.userId, userId)))
          .returning();
        if (!target) throw notFound("That TV");
      }
      return service.listTvs(userId);
    },

    async recordCastTarget(userId, input) {
      const at = now();
      const name = input.name.trim();
      const [existing] = await db
        .select()
        .from(T)
        .where(and(eq(T.userId, userId), eq(T.kind, input.kind), sql`lower(${T.name}) = lower(${name})`));
      if (existing) {
        const [row] = await db.update(T).set({ lastUsedAt: at, name }).where(eq(T.id, existing.id)).returning();
        return targetView(row);
      }
      const [row] = await db.insert(T).values({ userId, kind: input.kind, name, lastUsedAt: at, createdAt: at }).returning();
      return targetView(row);
    },

    async signOutEverywhere(userId) {
      const ended = await db
        .update(S)
        .set({ endedAt: now(), endedBy: "account" })
        .where(and(eq(S.userId, userId), isNull(S.endedAt)))
        .returning({ deviceId: S.deviceId });
      for (const { deviceId } of ended) await service.remote.accountSignedOut(deviceId, { tellTv: true });
      await service.remote.dropPhonesOf(userId);
    },

    async forgetUser(userId) {
      await service.signOutEverywhere(userId);
      await db.delete(T).where(eq(T.userId, userId));
    },

    remote: undefined as unknown as Remote
  };
  service.remote = createRemote(ctx, { liveSession: (tvId) => service.liveSession(tvId), device, attempts });
  return service;
}
