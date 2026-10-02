// Platform connections (follow-up Phase 3): where a station's translators relay, and the viewers
// YouTube and Twitch report.
//
// - YouTube and Twitch connect by signing in (OAuth with a one-time state, PKCE where the platform
//   has it). YouTube: Opencast creates one reusable live stream (its key never changes) and a live
//   broadcast bound to it, which starts when the relay's stream arrives. Twitch: Opencast reads the
//   stream key. Anything else is added by hand with an address and key.
// - Keys and tokens are sealed (secrets.ts) and opened only in memory, for the call that needs them.
// - The relay service's seam (relay.ts): `destinationsFor`, `prepareNextBroadcast`, `endBroadcast`,
//   `setPaidPromotion`. Manual destinations can't be driven: those record a reminder for the station.
// - Every minute, the viewers each connected YouTube and Twitch reports (`platform_viewer_samples`);
//   YouTube's viewer geography per broadcast and day, fetched when billing asks for it.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { callSignLabel } from "@opencast/domain";
import {
  PLATFORM_NAMES,
  type AddManualPlatform,
  type CountedPlatform,
  type OAuthProvider,
  type NextBroadcast,
  type PlatformConnection,
  type PlatformKind,
  type PlatformList,
  type PlatformsSeam,
  type RelayDestination
} from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { conflict, notFound } from "../../errors.js";
import { PlatformAuthError, providersFromEnv, type GeographyResult, type OAuthClient, type OAuthTokens, type PlatformProviders } from "./providers.js";
import { secretBoxFromEnv, secretContext, SecretsUnavailable, type SecretBox } from "./secrets.js";

export interface PlatformDeps {
  providers: PlatformProviders;
  secrets: SecretBox;
}

export function platformsFromEnv(env: NodeJS.ProcessEnv): PlatformDeps {
  return { providers: providersFromEnv(env), secrets: secretBoxFromEnv(env) };
}

export type GeographyView =
  | { status: "pending" }
  | { status: "none" }
  | { status: "ready"; places: Array<{ label: string; latitude: number | null; longitude: number | null; share: number }>; placedShare: number };

export interface PlatformsTick {
  polled: number;
  samples: number;
  failed: number;
  geography: { checked: number; ready: number; none: number } | null;
  resealed: number | null;
}

/** The relay service's seam (relay.ts's `PlatformsSeam`) is part of it. */
export interface PlatformsService extends PlatformsSeam {
  list(stationId: string): Promise<PlatformList>;
  /** Where to send the owner to sign in. `apiBase`: the API's public origin (the callback's). */
  startSignIn(input: { stationId: string; provider: OAuthProvider; userId: string; returnTo?: string; apiBase: string }): Promise<{ url: string }>;
  /** The platform's redirect back: connects it, and answers where to send the browser (master control). */
  finishSignIn(input: { provider: string; state: string | null; code: string | null; error: string | null }): Promise<string>;
  addManual(stationId: string, userId: string, input: AddManualPlatform): Promise<PlatformConnection>;
  /** One click: secrets erased, tokens revoked where the platform allows. */
  remove(stationId: string, platformId: string): Promise<{ revoked: boolean | null }>;

  // ---- The relay service's seam (relay.ts's `PlatformsSeam`) ----
  /** A station's destinations with their keys, decrypted only in memory. `connected`: signed in and working. */
  destinationsFor(stationId: string): Promise<RelayDestination[]>;
  /** YouTube: the next broadcast, created and bound to the same stream (same key) before the current one ends, title and description carried over. Null for everything else (Twitch starts one itself; manual ones: the station is reminded). */
  prepareNextBroadcast(platformId: string): Promise<NextBroadcast | null>;
  /** YouTube: ends that broadcast (or the current one) and moves on to the prepared one. Everything else: nothing to do (manual ones: the station is reminded). */
  endBroadcast(platformId: string, broadcastId?: string | null): Promise<void>;
  /** YouTube's paid product placement; Twitch's branded content. Manual ones aren't `applied`: the station is reminded. */
  setPaidPromotion(platformId: string, on: boolean): Promise<{ applied: boolean }>;

  // ---- Relay viewers ----
  /** Signed-in YouTube and Twitch whose viewers are counted (connected now). */
  countedPlatforms(stationId: string): Promise<Array<{ platformId: string; platform: CountedPlatform }>>;
  /** Reads each connected platform's concurrent viewers (run every minute). */
  pollViewers(): Promise<{ polled: number; samples: number; failed: number }>;
  /** A platform's reported viewers averaged over a window (minutes it reported nothing count as none), and the broadcasts they were on. */
  viewersDuring(platformId: string, from: Date, to: Date): Promise<{ viewers: number; samples: number; broadcasts: Array<{ ref: string; day: string; weight: number }> }>;
  /** The usual relay viewers at this hour over the last week, by platform: for holds. */
  typicalViewers(stationId: string, at: Date): Promise<Record<CountedPlatform, number>>;
  /** The latest count from each of a station's platforms (the audience page). */
  latestViewers(stationId: string): Promise<Array<{ platformId: string; name: string; viewers: number }>>;
  /** YouTube's geography for a broadcast's day; asking for it is what gets it fetched. */
  geography(platformId: string, broadcastRef: string, day: string): Promise<GeographyView>;
  fetchGeography(): Promise<{ checked: number; ready: number; none: number }>;
  /** Re-seals anything under an old key with the current one (key rotation). */
  resealSecrets(): Promise<number>;
  tick(): Promise<PlatformsTick>;
}

const C = schema.platformConnections;
const SI = schema.platformSignIns;
const EV = schema.platformEvents;
const VS = schema.platformViewerSamples;
const G = schema.platformGeography;
const GC = schema.platformGeographyChecks;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const SIGN_IN_MS = 15 * MINUTE;
const GEOGRAPHY_RETRY_MS = 6 * HOUR;

type Row = typeof C.$inferSelect;
type EventKind = (typeof EV.$inferInsert)["kind"];

const COUNTED = new Set<PlatformKind>(["youtube", "twitch"]);
const b64u = (buf: Buffer) => buf.toString("base64url");
const minuteOf = (at: Date) => new Date(Math.floor(at.getTime() / MINUTE) * MINUTE);
const dayOf = (at: Date) => at.toISOString().slice(0, 10);

export function createPlatformsService({ deps, services }: ModuleContext): PlatformsService {
  const { db } = deps;
  const platformDeps = deps.platforms ?? platformsFromEnv(process.env);
  const { providers, secrets } = platformDeps;
  let lastGeography = 0;
  let lastReseal = "";

  const ctx = (id: string, field: string) => secretContext("platform_connections", id, field);
  const seal = (id: string, field: string, value: string | null) => (value === null ? null : secrets.seal(value, ctx(id, field)));
  const open = (id: string, field: string, value: string | null) => (value === null ? null : secrets.open(value, ctx(id, field)));

  const clientFor = (kind: PlatformKind): OAuthClient | null => (kind === "youtube" ? providers.youtube : kind === "twitch" ? providers.twitch : null);

  async function event(row: Pick<Row, "id" | "stationId">, kind: EventKind, detail: Record<string, unknown> | null = null) {
    await db.insert(EV).values({ platformId: row.id, stationId: row.stationId, kind, detail, at: deps.clock.now() });
  }

  async function rowOf(platformId: string): Promise<Row> {
    const [row] = await db.select().from(C).where(eq(C.id, platformId));
    if (!row) throw notFound("That platform");
    return row;
  }

  async function saveTokens(row: Row, tokens: OAuthTokens) {
    await db
      .update(C)
      .set({
        accessTokenEnc: seal(row.id, "access_token", tokens.accessToken),
        refreshTokenEnc: tokens.refreshToken ? seal(row.id, "refresh_token", tokens.refreshToken) : row.refreshTokenEnc,
        tokenExpiresAt: tokens.expiresAt,
        status: "connected"
      })
      .where(eq(C.id, row.id));
  }

  async function needsSignIn(row: Row) {
    if (row.status === "needs_sign_in") return;
    await db.update(C).set({ status: "needs_sign_in" }).where(eq(C.id, row.id));
    await event(row, "needs_sign_in");
  }

  /**
   * Calls the platform with the connection's access token, refreshing it when it's about to expire
   * or is refused once. A refusal after refreshing marks the connection `needs_sign_in`.
   */
  async function withToken<T>(row: Row, fn: (token: string) => Promise<T>): Promise<T> {
    const client = clientFor(row.kind);
    if (!client || row.method !== "signed_in" || row.removedAt) throw new PlatformAuthError(PLATFORM_NAMES[row.kind]);
    let token = open(row.id, "access_token", row.accessTokenEnc);
    const refreshToken = open(row.id, "refresh_token", row.refreshTokenEnc);
    const refresh = async () => {
      if (!refreshToken) throw new PlatformAuthError(PLATFORM_NAMES[row.kind]);
      const fresh = await client.refresh(refreshToken);
      await saveTokens(row, fresh);
      return fresh.accessToken;
    };
    try {
      if (!token || (row.tokenExpiresAt && row.tokenExpiresAt.getTime() < deps.clock.now().getTime() + MINUTE)) token = await refresh();
      try {
        return await fn(token);
      } catch (error) {
        if (!(error instanceof PlatformAuthError) || !refreshToken) throw error;
        return await fn(await refresh());
      }
    } catch (error) {
      if (error instanceof PlatformAuthError) await needsSignIn(row);
      throw error;
    }
  }

  async function lastCounts(ids: string[]) {
    if (!ids.length) return new Map<string, { viewers: number; at: Date }>();
    const rows = await db.execute<{ platform_id: string; viewers: number; minute: Date }>(sql`
      select distinct on (platform_id) platform_id, viewers, minute
      from broadcast.platform_viewer_samples where platform_id in ${ids}
      order by platform_id, minute desc`);
    return new Map(rows.rows.map((r) => [r.platform_id, { viewers: Number(r.viewers), at: new Date(r.minute) }]));
  }

  function view(row: Row, last: { viewers: number; at: Date } | undefined): PlatformConnection {
    const signedIn = row.method === "signed_in";
    return {
      id: row.id,
      kind: row.kind,
      method: row.method,
      name: row.name,
      account: row.accountName,
      rtmpUrl: row.rtmpUrl,
      hasStreamKey: row.streamKeyEnc !== null,
      status: row.status,
      countsViewers: signedIn && COUNTED.has(row.kind),
      reportsLocation: signedIn && row.kind === "youtube" && row.scopes.some((s) => s.includes("yt-analytics")),
      paidPromotion: signedIn && COUNTED.has(row.kind) ? "automatic" : "remind",
      paidPromotionOn: row.paidPromotion,
      broadcast:
        row.kind === "youtube" && row.currentBroadcastId
          ? { id: row.currentBroadcastId, title: row.broadcastTitle ?? row.name, url: `https://www.youtube.com/watch?v=${encodeURIComponent(row.currentBroadcastId)}` }
          : null,
      lastViewers: last ? { viewers: last.viewers, at: last.at.toISOString() } : null,
      connectedAt: row.createdAt.toISOString()
    };
  }

  async function activeRows(stationId: string) {
    return db
      .select()
      .from(C)
      .where(and(eq(C.stationId, stationId), isNull(C.removedAt)))
      .orderBy(asc(C.createdAt));
  }

  async function stationTitle(stationId: string) {
    const ident = (await services.stations.idents([stationId])).get(stationId);
    const name = ident?.name ?? "Opencast";
    // A229: a shared call sign is told apart by its channel ("BEAT 12.2: Beat Tapes").
    return { ident, title: ident?.callSign ? `${ident ? callSignLabel(ident) : ""}: ${name}` : name, description: `${name}, live on Opencast.${ident?.channel ? ` Channel ${ident.channel}.` : ""}` };
  }

  const back = (returnTo: string, fields: Record<string, string>) => `${deps.config.appOrigin.replace(/\/+$/, "")}${returnTo}${returnTo.includes("?") ? "&" : "?"}${new URLSearchParams(fields)}`;

  const service: PlatformsService = {
    async list(stationId) {
      const rows = await activeRows(stationId);
      const last = await lastCounts(rows.map((r) => r.id));
      return {
        platforms: rows.map((r) => view(r, last.get(r.id))),
        signIn: { youtube: providers.youtube !== null, twitch: providers.twitch !== null, facebook: false },
        canStoreKeys: secrets.usable
      };
    },

    async startSignIn({ stationId, provider, userId, returnTo, apiBase }) {
      const client = clientFor(provider);
      if (!client) throw conflict("sign_in_not_set_up", `Signing in to ${PLATFORM_NAMES[provider]} isn't set up here yet. Add it with its address and stream key instead.`);
      if (!secrets.usable) throw conflict("secrets_key_missing", "Stream keys can't be stored until PLATFORM_SECRETS_KEY is set on the server.");
      const { ident } = await stationTitle(stationId);
      const state = b64u(randomBytes(32));
      const verifier = b64u(randomBytes(32));
      const challenge = b64u(createHash("sha256").update(verifier).digest());
      const redirectUri = `${apiBase.replace(/\/+$/, "")}/v1/platforms/oauth/${provider}/callback`;
      const now = deps.clock.now();
      await db.insert(SI).values({
        state,
        stationId,
        provider,
        userId,
        verifierEnc: secrets.seal(verifier, secretContext("platform_sign_ins", state, "verifier")),
        redirectUri,
        returnTo: returnTo ?? `/control/${ident?.slug ?? ident?.callSign?.toLowerCase() ?? stationId}/translators`,
        createdAt: now,
        expiresAt: new Date(now.getTime() + SIGN_IN_MS)
      });
      return { url: client.authorizeUrl({ state, redirectUri, codeChallenge: challenge }) };
    },

    async finishSignIn({ provider, state, code, error }) {
      const fallback = "/control";
      if (!state || (provider !== "youtube" && provider !== "twitch")) return back(fallback, { platform: provider, error: "expired" });
      // Once only: the state is used up whatever happens next.
      const [signIn] = await db
        .update(SI)
        .set({ usedAt: deps.clock.now() })
        .where(and(eq(SI.state, state), isNull(SI.usedAt), eq(SI.provider, provider), gte(SI.expiresAt, deps.clock.now())))
        .returning();
      if (!signIn) return back(fallback, { platform: provider, error: "expired" });
      const done = (fields: Record<string, string>) => back(signIn.returnTo, { platform: provider, ...fields });
      if (error || !code) return done({ error: error === "access_denied" ? "denied" : "failed" });
      const client = clientFor(provider);
      if (!client) return done({ error: "not_set_up" });
      try {
        const verifier = secrets.open(signIn.verifierEnc, secretContext("platform_sign_ins", state, "verifier"));
        const tokens = await client.exchangeCode({ code, redirectUri: signIn.redirectUri, codeVerifier: verifier });
        const required = provider === "youtube" ? "youtube.force-ssl" : "channel:read:stream_key";
        if (!tokens.scopes.some((s) => s.includes(required))) {
          await client.revoke(tokens.refreshToken ?? tokens.accessToken);
          return done({ error: "scopes" });
        }
        const { title, description } = await stationTitle(signIn.stationId);
        let account: { id: string; name: string };
        let ingest: { rtmpUrl: string; streamKey: string; liveStreamId: string | null; broadcastId: string | null };
        if (provider === "youtube") {
          const yt = providers.youtube!;
          const channel = await yt.channel(tokens.accessToken);
          account = { id: channel.id, name: channel.title };
          const existing = await sameAccount(signIn.stationId, "youtube", channel.id);
          if (existing?.liveStreamId && existing.streamKeyEnc) {
            // Signed in again: the same stream and key, the broadcast it had.
            ingest = { rtmpUrl: existing.rtmpUrl, streamKey: open(existing.id, "stream_key", existing.streamKeyEnc)!, liveStreamId: existing.liveStreamId, broadcastId: existing.currentBroadcastId };
          } else {
            const stream = await yt.createStream(tokens.accessToken, { title: `${title} (Opencast relay)` });
            const broadcast = await yt.createBroadcast(tokens.accessToken, { title, description, streamId: stream.streamId, scheduledStart: deps.clock.now() });
            ingest = { rtmpUrl: stream.rtmpUrl, streamKey: stream.streamKey, liveStreamId: stream.streamId, broadcastId: broadcast.broadcastId };
          }
        } else {
          const tw = providers.twitch!;
          const user = await tw.user(tokens.accessToken);
          account = { id: user.id, name: user.login };
          ingest = { rtmpUrl: tw.ingestUrl, streamKey: await tw.streamKey(tokens.accessToken, user.id), liveStreamId: null, broadcastId: null };
        }
        const existing = await sameAccount(signIn.stationId, provider, account.id);
        const id = existing?.id ?? randomUUID();
        const values = {
          name: provider === "youtube" ? account.name : `${account.name} on Twitch`,
          accountName: account.name,
          externalAccountId: account.id,
          rtmpUrl: ingest.rtmpUrl,
          streamKeyEnc: seal(id, "stream_key", ingest.streamKey),
          accessTokenEnc: seal(id, "access_token", tokens.accessToken),
          refreshTokenEnc: seal(id, "refresh_token", tokens.refreshToken),
          tokenExpiresAt: tokens.expiresAt,
          scopes: tokens.scopes,
          status: "connected" as const,
          liveStreamId: ingest.liveStreamId,
          currentBroadcastId: ingest.broadcastId,
          broadcastTitle: existing?.broadcastTitle ?? (provider === "youtube" ? title : null),
          broadcastDescription: existing?.broadcastDescription ?? (provider === "youtube" ? description : null)
        };
        if (existing) await db.update(C).set(values).where(eq(C.id, id));
        else await db.insert(C).values({ id, stationId: signIn.stationId, kind: provider, method: "signed_in", connectedBy: signIn.userId, createdAt: deps.clock.now(), ...values });
        await event({ id, stationId: signIn.stationId }, "connected", { method: "signed_in", again: Boolean(existing), broadcastId: ingest.broadcastId });
        return done({ connected: "1" });
      } catch (e) {
        return done({ error: e instanceof PlatformAuthError ? "denied" : e instanceof SecretsUnavailable ? "secrets_key_missing" : "failed" });
      }
    },

    async addManual(stationId, userId, input) {
      if (!secrets.usable) throw conflict("secrets_key_missing", "Stream keys can't be stored until PLATFORM_SECRETS_KEY is set on the server.");
      const id = randomUUID();
      const [row] = await db
        .insert(C)
        .values({
          id,
          stationId,
          kind: input.kind,
          method: "manual",
          name: input.name,
          rtmpUrl: input.rtmpUrl,
          streamKeyEnc: seal(id, "stream_key", input.streamKey),
          connectedBy: userId,
          createdAt: deps.clock.now()
        })
        .returning();
      await event(row, "connected", { method: "manual" });
      return view(row, undefined);
    },

    async remove(stationId, platformId) {
      const row = await rowOf(platformId);
      if (row.stationId !== stationId || row.removedAt) throw notFound("That platform");
      let revoked: boolean | null = null;
      const client = clientFor(row.kind);
      if (row.method === "signed_in" && client) {
        // Revoke where the platform allows; removing never waits on it succeeding.
        const tokens = [open(row.id, "refresh_token", row.refreshTokenEnc), open(row.id, "access_token", row.accessTokenEnc)].filter((t): t is string => Boolean(t));
        const results = await Promise.all(tokens.map((t) => client.revoke(t).catch(() => false)));
        revoked = results.length > 0 && results.some(Boolean);
      }
      await db
        .update(C)
        .set({ removedAt: deps.clock.now(), streamKeyEnc: null, accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, paidPromotion: false })
        .where(eq(C.id, row.id));
      if (revoked !== null) await event(row, revoked ? "revoked" : "revoke_failed");
      await event(row, "removed");
      return { revoked };
    },

    async destinationsFor(stationId) {
      const rows = await activeRows(stationId);
      return rows
        .filter((r) => r.streamKeyEnc)
        .map((r) => ({
          platformId: r.id,
          kind: r.kind,
          name: r.name,
          rtmpUrl: r.rtmpUrl,
          streamKey: open(r.id, "stream_key", r.streamKeyEnc)!,
          // Signed in and working: Opencast can start its broadcasts, mark paid promotion and read viewers.
          connected: r.method === "signed_in" && r.status === "connected"
        }));
    },

    async prepareNextBroadcast(platformId) {
      const row = await rowOf(platformId);
      if (row.removedAt) throw notFound("That platform");
      if (row.method === "manual") {
        // A pasted key can't be restarted from here: the station is reminded when it's due.
        await event(row, "remind_restart");
        return null;
      }
      // Twitch starts a new broadcast by itself when the stream reconnects.
      if (row.kind !== "youtube") return null;
      if (row.status !== "connected") throw conflict("needs_sign_in", "YouTube needs signing in again before Opencast can start its next broadcast.");
      if (!row.liveStreamId || !row.streamKeyEnc) throw conflict("no_stream", "This YouTube connection has no live stream to bind a broadcast to.");
      const streamKey = open(row.id, "stream_key", row.streamKeyEnc)!;
      if (row.nextBroadcastId) return { rtmpUrl: row.rtmpUrl, streamKey, broadcastId: row.nextBroadcastId };
      const station = await stationTitle(row.stationId);
      const title = row.broadcastTitle ?? station.title;
      const description = row.broadcastDescription ?? station.description;
      const { broadcastId } = await withToken(row, (token) =>
        providers.youtube!.createBroadcast(token, { title, description, streamId: row.liveStreamId!, scheduledStart: deps.clock.now() })
      );
      await db.update(C).set({ nextBroadcastId: broadcastId }).where(eq(C.id, row.id));
      await event(row, "broadcast_prepared", { broadcastId, title });
      // The same stream, so the same address and key: the relay's push doesn't change.
      return { rtmpUrl: row.rtmpUrl, streamKey, broadcastId };
    },

    async endBroadcast(platformId, broadcastId = null) {
      const row = await rowOf(platformId);
      if (row.removedAt) return;
      if (row.method === "manual") {
        await event(row, "remind_end");
        return;
      }
      if (row.kind !== "youtube") return;
      // The one before the one just prepared (the current one), unless it's named.
      const ending = broadcastId ?? row.currentBroadcastId;
      if (!ending) return;
      await withToken(row, (token) => providers.youtube!.endBroadcast(token, ending));
      const endsCurrent = ending === row.currentBroadcastId;
      if (endsCurrent) await db.update(C).set({ currentBroadcastId: row.nextBroadcastId, nextBroadcastId: null }).where(eq(C.id, row.id));
      else if (ending === row.nextBroadcastId) await db.update(C).set({ nextBroadcastId: null }).where(eq(C.id, row.id));
      await event(row, "broadcast_ended", { broadcastId: ending, next: endsCurrent ? row.nextBroadcastId : null });
      // The new broadcast is a new video: paid promotion follows it.
      if (endsCurrent && row.paidPromotion && row.nextBroadcastId) {
        await withToken(row, (token) => providers.youtube!.setPaidPromotion(token, row.nextBroadcastId!, true)).catch(() => undefined);
      }
    },

    async setPaidPromotion(platformId, on) {
      const row = await rowOf(platformId);
      if (row.removedAt) return { applied: false };
      if (row.method === "manual" || !COUNTED.has(row.kind)) {
        // Can't be marked from here: the station is reminded to mark it on the platform.
        if (on && !row.paidPromotion) await event(row, "remind_paid_promotion");
        if (row.paidPromotion !== on) await db.update(C).set({ paidPromotion: on }).where(eq(C.id, row.id));
        return { applied: false };
      }
      if (row.paidPromotion === on) return { applied: true };
      if (row.status !== "connected") return { applied: false };
      if (row.kind === "youtube" && !row.currentBroadcastId) return { applied: false };
      try {
        if (row.kind === "youtube") await withToken(row, (token) => providers.youtube!.setPaidPromotion(token, row.currentBroadcastId!, on));
        else await withToken(row, (token) => providers.twitch!.setBrandedContent(token, row.externalAccountId!, on));
      } catch {
        return { applied: false };
      }
      await db.update(C).set({ paidPromotion: on }).where(eq(C.id, row.id));
      await event(row, on ? "paid_promotion_on" : "paid_promotion_off", row.kind === "youtube" ? { broadcastId: row.currentBroadcastId } : null);
      return { applied: true };
    },

    async countedPlatforms(stationId) {
      const rows = await activeRows(stationId);
      return rows
        .filter((r) => r.method === "signed_in" && COUNTED.has(r.kind) && r.status === "connected")
        .map((r) => ({ platformId: r.id, platform: r.kind as CountedPlatform }));
    },

    async pollViewers() {
      const rows = await db
        .select()
        .from(C)
        .where(and(isNull(C.removedAt), eq(C.method, "signed_in"), eq(C.status, "connected"), inArray(C.kind, ["youtube", "twitch"])));
      const minute = minuteOf(deps.clock.now());
      let samples = 0;
      let failed = 0;
      for (const row of rows) {
        try {
          let reported: { viewers: number; ref: string } | null = null;
          if (row.kind === "youtube" && providers.youtube && row.currentBroadcastId) {
            const n = await withToken(row, (token) => providers.youtube!.concurrentViewers(token, row.currentBroadcastId!));
            if (n !== null) reported = { viewers: n, ref: row.currentBroadcastId };
          } else if (row.kind === "twitch" && providers.twitch && row.externalAccountId) {
            const s = await withToken(row, (token) => providers.twitch!.stream(token, row.externalAccountId!));
            if (s) reported = { viewers: s.viewers, ref: s.id };
          }
          if (!reported) continue;
          await db
            .insert(VS)
            .values({ platformId: row.id, stationId: row.stationId, kind: row.kind, minute, viewers: Math.max(0, Math.round(reported.viewers)), broadcastRef: reported.ref })
            .onConflictDoUpdate({ target: [VS.platformId, VS.minute], set: { viewers: Math.max(0, Math.round(reported.viewers)), broadcastRef: reported.ref } });
          samples++;
        } catch {
          // The reason (a status and code, never a token) is the platform's; the next minute tries again.
          failed++;
        }
      }
      return { polled: rows.length, samples, failed };
    },

    async viewersDuring(platformId, from, to) {
      const rows = await db
        .select()
        .from(VS)
        .where(and(eq(VS.platformId, platformId), gte(VS.minute, minuteOf(from)), lt(VS.minute, to)));
      const span = to.getTime() - from.getTime();
      if (!rows.length || span <= 0) return { viewers: 0, samples: rows.length, broadcasts: [] };
      // Like Opencast's tuned in: each minute weighted by how much of the window it covers.
      let weighted = 0;
      const byBroadcast = new Map<string, { ref: string; day: string; weight: number }>();
      for (const row of rows) {
        const start = Math.max(row.minute.getTime(), from.getTime());
        const end = Math.min(row.minute.getTime() + MINUTE, to.getTime());
        if (end <= start) continue;
        weighted += row.viewers * (end - start);
        if (row.broadcastRef) {
          const key = `${row.broadcastRef}:${dayOf(row.minute)}`;
          const b = byBroadcast.get(key) ?? { ref: row.broadcastRef, day: dayOf(row.minute), weight: 0 };
          b.weight += row.viewers * (end - start);
          byBroadcast.set(key, b);
        }
      }
      const total = [...byBroadcast.values()].reduce((s, b) => s + b.weight, 0);
      return {
        viewers: weighted / span,
        samples: rows.length,
        broadcasts: [...byBroadcast.values()].map((b) => ({ ...b, weight: total ? b.weight / total : 0 }))
      };
    },

    async typicalViewers(stationId, at) {
      const weekAgo = new Date(at.getTime() - 7 * 86_400_000);
      const byHour = await db.execute<{ kind: string; viewers: number }>(sql`
        select kind, sum(avg_viewers)::float as viewers from (
          select platform_id, kind, avg(viewers) as avg_viewers from broadcast.platform_viewer_samples
          where station_id = ${stationId} and minute >= ${weekAgo} and minute < ${at}
            and extract(hour from minute at time zone 'UTC') = ${at.getUTCHours()}
          group by platform_id, kind) p
        group by kind`);
      const result: Record<CountedPlatform, number> = { youtube: 0, twitch: 0 };
      for (const r of byHour.rows) if (r.kind === "youtube" || r.kind === "twitch") result[r.kind] = Math.round(Number(r.viewers));
      return result;
    },

    async latestViewers(stationId) {
      const rows = (await activeRows(stationId)).filter((r) => r.method === "signed_in" && COUNTED.has(r.kind));
      const last = await lastCounts(rows.map((r) => r.id));
      const recent = deps.clock.now().getTime() - 5 * MINUTE;
      return rows.map((r) => {
        const l = last.get(r.id);
        return { platformId: r.id, name: r.name, viewers: l && l.at.getTime() >= recent ? l.viewers : 0 };
      });
    },

    async geography(platformId, broadcastRef, day) {
      const [row] = await db
        .select()
        .from(G)
        .where(and(eq(G.platformId, platformId), eq(G.broadcastRef, broadcastRef), eq(G.day, day)));
      if (row) return row.status === "none" ? { status: "none" } : { status: "ready", places: row.places, placedShare: row.placedShare };
      await db.insert(GC).values({ platformId, broadcastRef, day, wantedAt: deps.clock.now() }).onConflictDoNothing();
      return { status: "pending" };
    },

    async fetchGeography() {
      const now = deps.clock.now();
      const today = dayOf(now);
      const wait = (await services.settings.valueAt("relays.location_wait")).days;
      const wanted = await db
        .select({ check: GC, platform: C })
        .from(GC)
        .innerJoin(C, eq(C.id, GC.platformId))
        .leftJoin(G, and(eq(G.platformId, GC.platformId), eq(G.broadcastRef, GC.broadcastRef), eq(G.day, GC.day)))
        .where(
          and(
            isNull(G.platformId),
            // A day or two late: never the day itself.
            lt(GC.day, today),
            gte(GC.wantedAt, new Date(now.getTime() - (wait + 1) * 86_400_000)),
            sql`(${GC.checkedAt} is null or ${GC.checkedAt} < ${new Date(now.getTime() - GEOGRAPHY_RETRY_MS)})`
          )
        );
      let ready = 0;
      let none = 0;
      for (const { check, platform } of wanted) {
        if (platform.kind !== "youtube" || !providers.youtube || platform.removedAt || platform.status !== "connected") continue;
        let result: GeographyResult;
        try {
          result = await withToken(platform, (token) => providers.youtube!.geography(token, { videoId: check.broadcastRef, day: check.day }));
        } catch {
          result = { status: "not_ready" };
        }
        await db
          .update(GC)
          .set({ checkedAt: now, attempts: sql`${GC.attempts} + 1` })
          .where(and(eq(GC.platformId, check.platformId), eq(GC.broadcastRef, check.broadcastRef), eq(GC.day, check.day)));
        if (result.status === "not_ready") continue;
        if (result.status === "none") {
          await db.insert(G).values({ platformId: check.platformId, broadcastRef: check.broadcastRef, day: check.day, status: "none", fetchedAt: now }).onConflictDoNothing();
          await event(platform, "geography", { broadcastRef: check.broadcastRef, day: check.day, status: "none" });
          none++;
          continue;
        }
        // Places without coordinates are placed by name where a places lookup is set up (PLACES_URL); the rest stay unplaced.
        const places = [];
        for (const p of result.places) {
          let latitude = p.latitude;
          let longitude = p.longitude;
          if ((latitude === null || longitude === null) && deps.places?.configured) {
            const found = await deps.places.lookup(p.label).catch(() => null);
            if (found) {
              latitude = found.latitude;
              longitude = found.longitude;
            }
          }
          places.push({ label: p.label, latitude, longitude, share: result.totalViews ? p.views / result.totalViews : 0 });
        }
        const placedShare = Math.min(1, places.filter((p) => p.latitude !== null && p.longitude !== null).reduce((s, p) => s + p.share, 0));
        await db.insert(G).values({ platformId: check.platformId, broadcastRef: check.broadcastRef, day: check.day, status: "ready", places, placedShare, fetchedAt: now }).onConflictDoNothing();
        await event(platform, "geography", { broadcastRef: check.broadcastRef, day: check.day, status: "ready", places: places.length });
        ready++;
      }
      return { checked: wanted.length, ready, none };
    },

    async resealSecrets() {
      if (!secrets.usable) return 0;
      const rows = await db.select().from(C).where(isNull(C.removedAt));
      let resealed = 0;
      for (const row of rows) {
        const fields = [
          ["stream_key", "streamKeyEnc"],
          ["access_token", "accessTokenEnc"],
          ["refresh_token", "refreshTokenEnc"]
        ] as const;
        const patch: Partial<Record<(typeof fields)[number][1], string>> = {};
        for (const [field, column] of fields) {
          const sealed = row[column];
          if (sealed && secrets.needsRotation(sealed)) patch[column] = secrets.seal(secrets.open(sealed, ctx(row.id, field)), ctx(row.id, field));
        }
        if (Object.keys(patch).length) {
          await db.update(C).set(patch).where(eq(C.id, row.id));
          resealed++;
        }
      }
      return resealed;
    },

    async tick() {
      const now = deps.clock.now();
      const counts = await service.pollViewers();
      let geography: PlatformsTick["geography"] = null;
      if (now.getTime() - lastGeography >= HOUR) {
        lastGeography = now.getTime();
        geography = await service.fetchGeography();
      }
      let resealed: number | null = null;
      if (dayOf(now) !== lastReseal) {
        lastReseal = dayOf(now);
        resealed = await service.resealSecrets();
      }
      return { ...counts, geography, resealed };
    }
  };

  async function sameAccount(stationId: string, kind: PlatformKind, externalAccountId: string) {
    const [row] = await db
      .select()
      .from(C)
      .where(and(eq(C.stationId, stationId), eq(C.kind, kind), eq(C.externalAccountId, externalAccountId), isNull(C.removedAt)));
    return row ?? null;
  }

  return service;
}
