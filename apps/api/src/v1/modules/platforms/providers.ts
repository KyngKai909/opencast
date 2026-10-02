// YouTube and Twitch, behind an interface (follow-up Phase 3). The real clients call Google's and
// Twitch's APIs with fetch; tests use fakes (fake.ts) and never reach either. docs/platforms.md has
// the setup (Google Cloud's OAuth consent screen and APIs, Twitch's developer console).
//
// Nothing here logs, and errors never carry a token or a key: a platform's answer is reduced to its
// status and error code before it goes anywhere.

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

/** The platform refused the token (revoked, expired past refreshing): the station signs in again. */
export class PlatformAuthError extends Error {
  constructor(provider: string) {
    super(`${provider} refused Opencast's sign-in.`);
  }
}

/** Anything else a platform refused or failed at, with its status and error code only. */
export class PlatformCallError extends Error {
  constructor(
    provider: string,
    what: string,
    readonly status: number,
    readonly code: string | null = null
  ) {
    super(`${provider}: ${what} failed (${status}${code ? `, ${code}` : ""}).`);
  }
}

export interface OAuthClient {
  readonly scopes: string[];
  authorizeUrl(input: { state: string; redirectUri: string; codeChallenge: string }): string;
  exchangeCode(input: { code: string; redirectUri: string; codeVerifier: string }): Promise<OAuthTokens>;
  refresh(refreshToken: string): Promise<OAuthTokens>;
  /** True when the platform revoked it. */
  revoke(token: string): Promise<boolean>;
}

export interface GeographyPlace {
  label: string;
  latitude: number | null;
  longitude: number | null;
  views: number;
}

/** `not_ready`: nothing yet (it comes a day or two late). `none`: data, but no location (below YouTube's thresholds). */
export type GeographyResult = { status: "not_ready" } | { status: "none"; totalViews: number } | { status: "ready"; totalViews: number; places: GeographyPlace[] };

export interface YouTubeApi extends OAuthClient {
  channel(accessToken: string): Promise<{ id: string; title: string }>;
  /** A live stream the relay sends to. Its key stays the same for every broadcast bound to it. */
  createStream(accessToken: string, input: { title: string }): Promise<{ streamId: string; rtmpUrl: string; streamKey: string }>;
  /** A live broadcast, bound to the stream; it starts when the stream arrives and ends when it stops. */
  createBroadcast(accessToken: string, input: { title: string; description: string; streamId: string; scheduledStart: Date }): Promise<{ broadcastId: string }>;
  endBroadcast(accessToken: string, broadcastId: string): Promise<void>;
  /** The video's `paidProductPlacementDetails.hasPaidProductPlacement`. */
  setPaidPromotion(accessToken: string, videoId: string, on: boolean): Promise<void>;
  /** `liveStreamingDetails.concurrentViewers`; null when it isn't live. */
  concurrentViewers(accessToken: string, videoId: string): Promise<number | null>;
  /** YouTube Analytics: the video's views by city on one day (UTC). */
  geography(accessToken: string, input: { videoId: string; day: string }): Promise<GeographyResult>;
}

export interface TwitchApi extends OAuthClient {
  readonly ingestUrl: string;
  user(accessToken: string): Promise<{ id: string; login: string; displayName: string }>;
  streamKey(accessToken: string, broadcasterId: string): Promise<string>;
  /** Get Streams: the live stream and its `viewer_count`; null when offline. */
  stream(accessToken: string, userId: string): Promise<{ id: string; viewers: number; title: string } | null>;
  /** Modify Channel Information's `is_branded_content`: Twitch's paid promotion. */
  setBrandedContent(accessToken: string, broadcasterId: string, on: boolean): Promise<void>;
}

export interface PlatformProviders {
  /** Null: not set up here (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). */
  youtube: YouTubeApi | null;
  /** Null: not set up here (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET). */
  twitch: TwitchApi | null;
}

// ---- The real clients ----

const TIMEOUT_MS = 10_000;

async function call(provider: string, what: string, url: string, init: RequestInit & { token?: string } = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  headers.set("accept", "application/json");
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    // The network's error can carry the request; it's replaced with the step's name.
    throw new PlatformCallError(provider, what, 0, "network");
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (response.status === 401) throw new PlatformAuthError(provider);
  if (!response.ok) {
    const b = body as { error?: unknown; message?: unknown } | null;
    const code =
      typeof b?.error === "string"
        ? b.error
        : typeof (b?.error as { status?: unknown } | undefined)?.status === "string"
          ? String((b!.error as { status: string }).status)
          : null;
    if (code === "invalid_grant") throw new PlatformAuthError(provider);
    throw new PlatformCallError(provider, what, response.status, code);
  }
  return body;
}

const form = (fields: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });

function tokensFrom(body: unknown, previousRefresh: string | null, fallbackScopes: string[]): OAuthTokens {
  const b = body as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string | string[] };
  if (!b?.access_token) throw new PlatformCallError("sign-in", "reading the tokens", 200, "no_access_token");
  const scopes = Array.isArray(b.scope) ? b.scope : typeof b.scope === "string" ? b.scope.split(/\s+/).filter(Boolean) : fallbackScopes;
  return {
    accessToken: b.access_token,
    refreshToken: b.refresh_token ?? previousRefresh,
    expiresAt: typeof b.expires_in === "number" ? new Date(Date.now() + b.expires_in * 1000) : null,
    scopes
  };
}

export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.force-ssl", "https://www.googleapis.com/auth/yt-analytics.readonly"];
export const TWITCH_SCOPES = ["channel:read:stream_key", "channel:manage:broadcast"];

export function youtubeClient(config: { clientId: string; clientSecret: string }): YouTubeApi {
  const P = "YouTube";
  const api = "https://www.googleapis.com/youtube/v3";
  return {
    scopes: YOUTUBE_SCOPES,
    authorizeUrl({ state, redirectUri, codeChallenge }) {
      const q = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: YOUTUBE_SCOPES.join(" "),
        access_type: "offline",
        // A refresh token every time, so a station that connects again keeps working.
        prompt: "consent",
        include_granted_scopes: "true",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256"
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    },
    async exchangeCode({ code, redirectUri, codeVerifier }) {
      const body = await call(P, "signing in", "https://oauth2.googleapis.com/token", form({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: codeVerifier }));
      return tokensFrom(body, null, YOUTUBE_SCOPES);
    },
    async refresh(refreshToken) {
      const body = await call(P, "refreshing the sign-in", "https://oauth2.googleapis.com/token", form({ refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token" }));
      return tokensFrom(body, refreshToken, YOUTUBE_SCOPES);
    },
    async revoke(token) {
      // In the body, never the address, so it can't end up in a log line.
      try {
        await call(P, "revoking", "https://oauth2.googleapis.com/revoke", form({ token }));
        return true;
      } catch {
        return false;
      }
    },
    async channel(token) {
      const body = (await call(P, "reading the channel", `${api}/channels?part=snippet&mine=true`, { token })) as { items?: Array<{ id: string; snippet?: { title?: string } }> };
      const item = body.items?.[0];
      if (!item) throw new PlatformCallError(P, "reading the channel", 404, "no_channel");
      return { id: item.id, title: item.snippet?.title ?? "YouTube channel" };
    },
    async createStream(token, { title }) {
      const body = (await call(P, "creating the live stream", `${api}/liveStreams?part=snippet,cdn,contentDetails,status`, {
        token,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          snippet: { title },
          cdn: { ingestionType: "rtmp", resolution: "variable", frameRate: "variable" },
          // One stream, bound to each broadcast in turn: the relay's key never changes.
          contentDetails: { isReusable: true }
        })
      })) as { id: string; cdn?: { ingestionInfo?: { ingestionAddress?: string; rtmpsIngestionAddress?: string; streamName?: string } } };
      const info = body.cdn?.ingestionInfo;
      if (!body.id || !info?.streamName) throw new PlatformCallError(P, "creating the live stream", 200, "no_ingestion_info");
      return { streamId: body.id, rtmpUrl: info.rtmpsIngestionAddress ?? info.ingestionAddress ?? "rtmp://a.rtmp.youtube.com/live2", streamKey: info.streamName };
    },
    async createBroadcast(token, { title, description, streamId, scheduledStart }) {
      const created = (await call(P, "creating the broadcast", `${api}/liveBroadcasts?part=snippet,status,contentDetails`, {
        token,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          snippet: { title: title.slice(0, 100), description: description.slice(0, 5000), scheduledStartTime: scheduledStart.toISOString() },
          status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
          contentDetails: { enableAutoStart: true, enableAutoStop: true, latencyPreference: "normal" }
        })
      })) as { id: string };
      await call(P, "binding the broadcast", `${api}/liveBroadcasts/bind?id=${encodeURIComponent(created.id)}&streamId=${encodeURIComponent(streamId)}&part=id`, { token, method: "POST" });
      return { broadcastId: created.id };
    },
    async endBroadcast(token, broadcastId) {
      await call(P, "ending the broadcast", `${api}/liveBroadcasts/transition?broadcastStatus=complete&id=${encodeURIComponent(broadcastId)}&part=status`, { token, method: "POST" });
    },
    async setPaidPromotion(token, videoId, on) {
      await call(P, "marking paid promotion", `${api}/videos?part=paidProductPlacementDetails`, {
        token,
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: videoId, paidProductPlacementDetails: { hasPaidProductPlacement: on } })
      });
    },
    async concurrentViewers(token, videoId) {
      const body = (await call(P, "reading viewers", `${api}/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}`, { token })) as {
        items?: Array<{ liveStreamingDetails?: { concurrentViewers?: string; actualEndTime?: string } }>;
      };
      const live = body.items?.[0]?.liveStreamingDetails;
      if (!live || live.actualEndTime || live.concurrentViewers === undefined) return null;
      const n = Number(live.concurrentViewers);
      return Number.isFinite(n) ? n : null;
    },
    async geography(token, { videoId, day }) {
      const report = async (dimensions: string | null) => {
        const q = new URLSearchParams({ ids: "channel==MINE", startDate: day, endDate: day, metrics: "views", filters: `video==${videoId}` });
        if (dimensions) q.set("dimensions", dimensions);
        const body = (await call(P, "reading viewer geography", `https://youtubeanalytics.googleapis.com/v2/reports?${q}`, { token })) as { rows?: Array<Array<string | number>> };
        return body.rows ?? [];
      };
      const total = await report(null);
      const totalViews = Number(total[0]?.[0] ?? 0);
      if (!total.length || !totalViews) return { status: "not_ready" };
      // Cities: the finest place YouTube reports. Its city values are placed by name (PLACES_URL);
      // anything that can't be placed isn't billed. (docs/platforms.md: to confirm on a real channel.)
      const rows = await report("city");
      const places = rows.map((r) => ({ label: String(r[0]), latitude: null, longitude: null, views: Number(r[1] ?? 0) })).filter((p) => p.views > 0);
      if (!places.length) return { status: "none", totalViews };
      return { status: "ready", totalViews, places };
    }
  };
}

export function twitchClient(config: { clientId: string; clientSecret: string; ingestUrl?: string }): TwitchApi {
  const P = "Twitch";
  const helix = "https://api.twitch.tv/helix";
  const headers = { "client-id": config.clientId };
  return {
    scopes: TWITCH_SCOPES,
    ingestUrl: config.ingestUrl ?? "rtmp://live.twitch.tv/app",
    authorizeUrl({ state, redirectUri }) {
      // Twitch's authorization code flow uses the client secret; it has no PKCE.
      const q = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, response_type: "code", scope: TWITCH_SCOPES.join(" "), state, force_verify: "true" });
      return `https://id.twitch.tv/oauth2/authorize?${q}`;
    },
    async exchangeCode({ code, redirectUri }) {
      const body = await call(P, "signing in", "https://id.twitch.tv/oauth2/token", form({ client_id: config.clientId, client_secret: config.clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }));
      return tokensFrom(body, null, TWITCH_SCOPES);
    },
    async refresh(refreshToken) {
      const body = await call(P, "refreshing the sign-in", "https://id.twitch.tv/oauth2/token", form({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }));
      return tokensFrom(body, refreshToken, TWITCH_SCOPES);
    },
    async revoke(token) {
      try {
        await call(P, "revoking", "https://id.twitch.tv/oauth2/revoke", form({ client_id: config.clientId, token }));
        return true;
      } catch {
        return false;
      }
    },
    async user(token) {
      const body = (await call(P, "reading the account", `${helix}/users`, { token, headers })) as { data?: Array<{ id: string; login: string; display_name: string }> };
      const u = body.data?.[0];
      if (!u) throw new PlatformCallError(P, "reading the account", 404, "no_user");
      return { id: u.id, login: u.login, displayName: u.display_name };
    },
    async streamKey(token, broadcasterId) {
      const body = (await call(P, "reading the stream key", `${helix}/streams/key?broadcaster_id=${encodeURIComponent(broadcasterId)}`, { token, headers })) as { data?: Array<{ stream_key: string }> };
      const key = body.data?.[0]?.stream_key;
      if (!key) throw new PlatformCallError(P, "reading the stream key", 404, "no_key");
      return key;
    },
    async stream(token, userId) {
      const body = (await call(P, "reading viewers", `${helix}/streams?user_id=${encodeURIComponent(userId)}`, { token, headers })) as { data?: Array<{ id: string; viewer_count: number; title: string; type: string }> };
      const s = body.data?.find((d) => d.type === "live");
      return s ? { id: s.id, viewers: s.viewer_count, title: s.title } : null;
    },
    async setBrandedContent(token, broadcasterId, on) {
      await call(P, "marking branded content", `${helix}/channels?broadcaster_id=${encodeURIComponent(broadcasterId)}`, {
        token,
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ is_branded_content: on })
      });
    }
  };
}

export function providersFromEnv(env: NodeJS.ProcessEnv): PlatformProviders {
  const google = env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim() ? { clientId: env.GOOGLE_CLIENT_ID.trim(), clientSecret: env.GOOGLE_CLIENT_SECRET.trim() } : null;
  const twitch = env.TWITCH_CLIENT_ID?.trim() && env.TWITCH_CLIENT_SECRET?.trim() ? { clientId: env.TWITCH_CLIENT_ID.trim(), clientSecret: env.TWITCH_CLIENT_SECRET.trim() } : null;
  return {
    youtube: google ? youtubeClient(google) : null,
    twitch: twitch ? twitchClient({ ...twitch, ingestUrl: env.TWITCH_INGEST_URL?.trim() || undefined }) : null
  };
}
