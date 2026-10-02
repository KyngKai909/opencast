// The phone remote's relay, for TVs without Cast (Android TV, Fire TV). The same command and
// state messages as the Cast receiver: phones send commands, the TV answers every phone with
// its state. Who may drive a TV: a phone signed in to the TV's account (no pairing), or a guest's
// phone paired by a 4-digit code the TV shows. The TV applies its own "who can change the
// channel" setting, as the Cast receiver does; the relay only says who sent each command.
//
// Streams are Server-Sent Events. A TV's stream and its phones' streams may be on different API
// instances: messages go through `deps.relay` (Redis pub/sub when REDIS_URL is set). Presence
// ("online", "connected") is written to the database by the open streams and renewed at each
// heartbeat, so any instance can answer it.

import { randomInt, randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { PairedPhone, RemoteCommand, RemotePhone, RemoteState } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { CurrentUser, EventStream, PhoneCaller } from "../../http.js";
import type { RelayMessage } from "../../relay.js";
import { conflict, HttpError, notFound } from "../../errors.js";
import { hashToken, newToken, PLATFORM_NAMES, tooManyTries } from "./service.js";

const MINUTE = 60_000;
/** Pair codes last 5 minutes. */
export const PAIR_MS = 5 * MINUTE;
/** Wrong pair codes: this many per phone (or connection) in the window, then 429. */
const PAIR_LIMIT = { tries: 10, windowMs: 10 * MINUTE };
/** A TV whose stream closed stays online this long, so a reconnect doesn't flicker "offline". */
export const TV_GRACE_MS = 10_000;

type PhoneRow = typeof schema.tvRemotePhones.$inferSelect;
type DeviceRow = typeof schema.tvDevices.$inferSelect;

export interface Remote {
  phoneForToken(tokenHash: string): Promise<{ id: string; deviceId: string } | null>;
  /** The TV's session ended: its account's phones are told `ended` and dropped; with tellTv, the TV is told too. */
  accountSignedOut(tvId: string, options?: { tellTv?: boolean }): Promise<void>;
  /** A1: the person's phones stop driving any TV: guest pairings made signed in as them, and account phones. */
  dropPhonesOf(userId: string): Promise<void>;
  /** Which of these TVs have a phone on this account connected now. */
  accountPhonesConnected(tvIds: string[], userId: string): Promise<Set<string>>;
  openTvStream(tvId: string, stream: EventStream): Promise<void>;
  postState(tvId: string, state: RemoteState): Promise<void>;
  end(tvId: string): Promise<void>;
  createPairCode(tvId: string): Promise<{ code: string; expiresAt: string }>;
  pair(input: { code: string; name: string; user: CurrentUser | null; clientKey: string }): Promise<PairedPhone>;
  phones(tvId: string): Promise<RemotePhone[]>;
  removePhone(tvId: string, phoneId: string): Promise<RemotePhone[]>;
  /** The phone driving this TV, or 404 (no TV) / 403 `not_paired`. */
  authorize(caller: { user: CurrentUser | null; phone: PhoneCaller | null }, tvId: string): Promise<PhoneRow>;
  openPhoneStream(phone: PhoneRow, stream: EventStream): Promise<void>;
  sendCommand(phone: PhoneRow, command: RemoteCommand, name: string): Promise<void>;
}

interface RemoteDeps {
  liveSession(tvId: string): Promise<{ id: string; userId: string } | null>;
  device(tvId: string): Promise<DeviceRow | null>;
  attempts: {
    over(scope: "pair", key: string, limit: { tries: number; windowMs: number }): Promise<boolean>;
    wrong(scope: "pair", key: string): Promise<void>;
  };
}

/** "Kai M." is "Kai's phone"; no name is "A phone". */
export function phoneName(displayName: string | null | undefined): string {
  const first = (displayName ?? "").trim().split(/\s+/)[0]?.replace(/[.,]+$/, "") ?? "";
  return first ? `${first.slice(0, 40)}'s phone` : "A phone";
}

export function createRemote({ deps, services }: ModuleContext, r: RemoteDeps): Remote {
  const { db } = deps;
  const D = schema.tvDevices;
  const P = schema.tvRemotePhones;
  const PC = schema.tvPairCodes;
  const now = () => deps.clock.now();
  const heartbeatMs = () => deps.config.sseHeartbeatMs ?? 25_000;
  /** An open stream is online until its next heartbeat is overdue. */
  const onlineUntil = () => new Date(now().getTime() + heartbeatMs() + 15_000);

  const publish = async (channel: string, message: RelayMessage) => {
    try {
      await deps.relay.publish(channel, message);
    } catch (error) {
      console.error(`[tv] relay publish to ${channel} failed: ${(error as Error).message}`);
    }
  };
  const quietly = (work: Promise<unknown>) => void work.catch((error) => console.error(`[tv] ${(error as Error).message}`));

  const view = (p: PhoneRow): RemotePhone => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    connected: Boolean(p.onlineUntil && p.onlineUntil > now()),
    pairedAt: p.pairedAt.toISOString(),
    lastCommandAt: p.lastCommandAt ? p.lastCommandAt.toISOString() : null
  });

  async function phonesChanged(tvId: string) {
    await publish(`tv:${tvId}`, { event: "phones", data: { phones: await remote.phones(tvId) } });
  }

  async function accountPhone(tvId: string, user: CurrentUser): Promise<PhoneRow> {
    const find = async () => {
      const [row] = await db
        .select()
        .from(P)
        .where(and(eq(P.deviceId, tvId), eq(P.kind, "account"), eq(P.userId, user.id), isNull(P.removedAt)));
      return row;
    };
    const existing = await find();
    if (existing) return existing;
    const names = await services.accounts.displayNames([user.id]);
    const [created] = await db
      .insert(P)
      .values({ deviceId: tvId, kind: "account", userId: user.id, name: phoneName(names.get(user.id)), pairedAt: now() })
      .onConflictDoNothing()
      .returning();
    return created ?? (await find())!;
  }

  const remote: Remote = {
    async phoneForToken(tokenHash) {
      const [row] = await db
        .select({ id: P.id, deviceId: P.deviceId })
        .from(P)
        .where(and(eq(P.tokenHash, tokenHash), eq(P.kind, "guest"), isNull(P.removedAt)));
      return row ?? null;
    },

    async accountSignedOut(tvId, options = {}) {
      await db
        .update(P)
        .set({ removedAt: now() })
        .where(and(eq(P.deviceId, tvId), eq(P.kind, "account"), isNull(P.removedAt)));
      await publish(`phones:${tvId}`, { event: "ended", data: { reason: "signed_out" }, only: { kind: "account" } });
      if (options.tellTv) await publish(`tv:${tvId}`, { event: "signed_out", data: {} });
      await phonesChanged(tvId);
    },

    async dropPhonesOf(userId) {
      const dropped = await db
        .update(P)
        .set({ removedAt: now() })
        .where(and(eq(P.userId, userId), isNull(P.removedAt)))
        .returning({ id: P.id, deviceId: P.deviceId });
      for (const phone of dropped) {
        await publish(`phones:${phone.deviceId}`, { event: "ended", data: { reason: "signed_out" }, only: { phoneId: phone.id } });
      }
      for (const tvId of new Set(dropped.map((p) => p.deviceId))) await phonesChanged(tvId);
    },

    async accountPhonesConnected(tvIds, userId) {
      if (!tvIds.length) return new Set();
      const rows = await db
        .select({ deviceId: P.deviceId })
        .from(P)
        .where(and(inArray(P.deviceId, tvIds), eq(P.kind, "account"), eq(P.userId, userId), isNull(P.removedAt), gt(P.onlineUntil, now())));
      return new Set(rows.map((row) => row.deviceId));
    },

    async openTvStream(tvId, stream) {
      const streamId = randomUUID();
      const subscription = deps.relay.subscribe(`tv:${tvId}`, (message) => stream.send(message.event, message.data));
      const ready = (async () => {
        await subscription;
        await db.update(D).set({ onlineUntil: onlineUntil(), onlineStream: streamId, lastSeenAt: now() }).where(eq(D.id, tvId));
      })();
      stream.onClose(() =>
        quietly(
          (async () => {
            await ready.catch(() => undefined);
            await (await subscription)();
            // Only the latest stream starts the grace period: an older one closing after a reconnect doesn't.
            await db
              .update(D)
              .set({ onlineUntil: new Date(now().getTime() + TV_GRACE_MS) })
              .where(and(eq(D.id, tvId), eq(D.onlineStream, streamId)));
          })()
        )
      );
      stream.onHeartbeat(() => quietly(db.update(D).set({ onlineUntil: onlineUntil(), lastSeenAt: now() }).where(eq(D.id, tvId))));
      await ready;
      stream.send("phones", { phones: await remote.phones(tvId) });
    },

    async postState(tvId, state) {
      await db.update(D).set({ remoteState: state, remoteStateAt: now() }).where(eq(D.id, tvId));
      await publish(`phones:${tvId}`, { event: "state", data: state });
    },

    async end(tvId) {
      await db.update(D).set({ remoteState: null, remoteStateAt: now() }).where(eq(D.id, tvId));
      await publish(`phones:${tvId}`, { event: "ended", data: { reason: "tv_ended" } });
    },

    async createPairCode(tvId) {
      const at = now();
      const expiresAt = new Date(at.getTime() + PAIR_MS);
      const code = await db.transaction(async (tx) => {
        // One at a time, so two TVs never hold the same four digits.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tv.pair_codes'))`);
        await tx
          .update(PC)
          .set({ expiresAt: at })
          .where(and(eq(PC.deviceId, tvId), gt(PC.expiresAt, at)));
        for (let tries = 0; tries < 50; tries++) {
          const candidate = String(randomInt(0, 10_000)).padStart(4, "0");
          const [taken] = await tx
            .select({ id: PC.id })
            .from(PC)
            .where(and(eq(PC.code, candidate), gt(PC.expiresAt, at)));
          if (taken) continue;
          await tx.insert(PC).values({ deviceId: tvId, code: candidate, createdAt: at, expiresAt });
          return candidate;
        }
        throw new HttpError(503, "busy", "Couldn't make a code just now. Try again in a moment.");
      });
      return { code, expiresAt: expiresAt.toISOString() };
    },

    async pair({ code, name, user, clientKey }) {
      if (await r.attempts.over("pair", clientKey, PAIR_LIMIT)) throw tooManyTries();
      const at = now();
      const [row] = await db
        .select()
        .from(PC)
        .where(and(eq(PC.code, code), gt(PC.expiresAt, at)))
        .orderBy(asc(PC.expiresAt))
        .limit(1);
      if (!row) {
        await r.attempts.wrong("pair", clientKey);
        throw new HttpError(404, "code_not_found", "That code isn't right, or it's run out. Check the code on the TV.");
      }
      const d = await r.device(row.deviceId);
      if (!d) throw notFound("That TV");
      const phoneToken = newToken("tvp_");
      await db.insert(P).values({ deviceId: d.id, kind: "guest", userId: user && !user.viaTv ? user.id : null, name, tokenHash: hashToken(phoneToken), pairedAt: at });
      await phonesChanged(d.id);
      return { tvId: d.id, tvName: d.name ?? PLATFORM_NAMES[d.platform], phoneToken };
    },

    async phones(tvId) {
      const rows = await db
        .select()
        .from(P)
        .where(and(eq(P.deviceId, tvId), isNull(P.removedAt)))
        .orderBy(asc(P.pairedAt));
      return rows.map(view);
    },

    async removePhone(tvId, phoneId) {
      const [row] = await db
        .update(P)
        .set({ removedAt: now() })
        .where(and(eq(P.id, phoneId), eq(P.deviceId, tvId), isNull(P.removedAt)))
        .returning();
      if (!row) throw notFound("That phone");
      await publish(`phones:${tvId}`, { event: "ended", data: { reason: "unpaired" }, only: { phoneId } });
      await phonesChanged(tvId);
      return remote.phones(tvId);
    },

    async authorize(caller, tvId) {
      const d = await r.device(tvId);
      if (!d) throw notFound("That TV");
      if (caller.phone?.tvId === tvId) {
        const [row] = await db
          .select()
          .from(P)
          .where(and(eq(P.id, caller.phone.phoneId), isNull(P.removedAt)));
        if (row) return row;
      }
      if (caller.user && !caller.user.viaTv) {
        const session = await r.liveSession(tvId);
        if (session && session.userId === caller.user.id) return accountPhone(tvId, caller.user);
      }
      throw new HttpError(403, "not_paired", "Pair this phone with the TV first: enter the code the TV shows.");
    },

    async openPhoneStream(phone, stream) {
      const streamId = randomUUID();
      const subscription = deps.relay.subscribe(`phones:${phone.deviceId}`, (message) => {
        if (message.only?.phoneId && message.only.phoneId !== phone.id) return;
        if (message.only?.kind && message.only.kind !== phone.kind) return;
        stream.send(message.event, message.data);
        if (message.event === "ended") stream.close();
      });
      const ready = (async () => {
        await subscription;
        await db.update(P).set({ onlineUntil: onlineUntil(), onlineStream: streamId }).where(eq(P.id, phone.id));
      })();
      stream.onClose(() =>
        quietly(
          (async () => {
            await ready.catch(() => undefined);
            await (await subscription)();
            const [changed] = await db
              .update(P)
              .set({ onlineUntil: now() })
              .where(and(eq(P.id, phone.id), eq(P.onlineStream, streamId)))
              .returning();
            if (changed) await phonesChanged(phone.deviceId);
          })()
        )
      );
      stream.onHeartbeat(() => quietly(db.update(P).set({ onlineUntil: onlineUntil() }).where(and(eq(P.id, phone.id), isNull(P.removedAt)))));
      await ready;
      const d = await r.device(phone.deviceId);
      if (d?.remoteState) stream.send("state", d.remoteState);
      await phonesChanged(phone.deviceId);
    },

    async sendCommand(phone, command, name) {
      const d = await r.device(phone.deviceId);
      if (!d?.onlineUntil || d.onlineUntil <= now()) {
        throw conflict("tv_not_connected", "The TV isn't connected. Check that Opencast is open on it.");
      }
      const at = now();
      await db.update(P).set({ name, lastCommandAt: at }).where(eq(P.id, phone.id));
      await publish(`tv:${phone.deviceId}`, { event: "command", data: { command, from: { phoneId: phone.id, name }, at: at.toISOString() } });
      if (name !== phone.name) await phonesChanged(phone.deviceId);
    }
  };
  return remote;
}
