// Fake YouTube and Twitch for tests and demos (follow-up Phase 3): the same interfaces as the real
// clients, with every call recorded and nothing sent anywhere. Tests set what the platforms report
// (viewers, geography) and check what Opencast asked them to do.

import type { GeographyResult, OAuthTokens, PlatformProviders, TwitchApi, YouTubeApi } from "./providers.js";
import { PlatformAuthError, TWITCH_SCOPES, YOUTUBE_SCOPES } from "./providers.js";

export interface FakeCall {
  provider: "youtube" | "twitch";
  op: string;
  args: Record<string, unknown>;
}

export interface FakePlatforms extends PlatformProviders {
  youtube: YouTubeApi;
  twitch: TwitchApi;
  calls: FakeCall[];
  /** Tokens the platforms consider revoked (or never issued). */
  revoked: Set<string>;
  /** What each platform reports now: YouTube by video id, Twitch by user id (null: offline). */
  youtubeViewers: Map<string, number | null>;
  twitchViewers: Map<string, number | null>;
  /** YouTube Analytics' answer for a video on a day (`<videoId>:<day>`). Unset: not ready. */
  geography: Map<string, GeographyResult>;
  /** The codes a sign-in may use, and whose account each one is. */
  codes: Map<string, { account: string; accountId: string }>;
  /** Make the next revoke fail (the platform is down). */
  failRevoke: boolean;
  /** Access tokens refuse after this (a sign-in the station revoked on the platform's side). */
  refuseAccess: boolean;
}

export function fakePlatforms(): FakePlatforms {
  // Numbered per kind, so a test can name them: the first broadcast is yt-video-1.
  const counters = new Map<string, number>();
  const next = (prefix: string) => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}-${n}`;
  };
  const calls: FakeCall[] = [];
  const revoked = new Set<string>();
  const youtubeViewers = new Map<string, number | null>();
  const twitchViewers = new Map<string, number | null>();
  const geography = new Map<string, GeographyResult>();
  const codes = new Map<string, { account: string; accountId: string }>();
  const issued = new Map<string, { account: string; accountId: string }>();
  const record = (provider: "youtube" | "twitch", op: string, args: Record<string, unknown> = {}) => void calls.push({ provider, op, args });

  const fake: FakePlatforms = {
    calls,
    revoked,
    youtubeViewers,
    twitchViewers,
    geography,
    codes,
    failRevoke: false,
    refuseAccess: false,
    youtube: undefined as unknown as YouTubeApi,
    twitch: undefined as unknown as TwitchApi
  };

  function tokens(provider: "youtube" | "twitch", who: { account: string; accountId: string }, scopes: string[]): OAuthTokens {
    const accessToken = `${provider}-access-${next("t")}-secret`;
    const refreshToken = `${provider}-refresh-${next("t")}-secret`;
    issued.set(accessToken, who);
    issued.set(refreshToken, who);
    return { accessToken, refreshToken, expiresAt: null, scopes };
  }
  const check = (provider: "youtube" | "twitch", token: string) => {
    if (fake.refuseAccess || revoked.has(token) || !issued.has(token)) throw new PlatformAuthError(provider === "youtube" ? "YouTube" : "Twitch");
    return issued.get(token)!;
  };

  fake.youtube = {
    scopes: YOUTUBE_SCOPES,
    authorizeUrl: ({ state, redirectUri, codeChallenge }) =>
      `https://accounts.google.test/o/oauth2/v2/auth?${new URLSearchParams({ state, redirect_uri: redirectUri, code_challenge: codeChallenge, scope: YOUTUBE_SCOPES.join(" ") })}`,
    async exchangeCode({ code, redirectUri, codeVerifier }) {
      record("youtube", "exchangeCode", { redirectUri, hasVerifier: Boolean(codeVerifier) });
      const who = codes.get(code);
      if (!who) throw new PlatformAuthError("YouTube");
      codes.delete(code);
      return tokens("youtube", who, YOUTUBE_SCOPES);
    },
    async refresh(refreshToken) {
      record("youtube", "refresh");
      return tokens("youtube", check("youtube", refreshToken), YOUTUBE_SCOPES);
    },
    async revoke(token) {
      record("youtube", "revoke");
      if (fake.failRevoke) return false;
      revoked.add(token);
      return true;
    },
    async channel(token) {
      const who = check("youtube", token);
      return { id: who.accountId, title: who.account };
    },
    async createStream(token, { title }) {
      check("youtube", token);
      record("youtube", "createStream", { title });
      return { streamId: next("yt-stream"), rtmpUrl: "rtmps://a.rtmps.youtube.test/live2", streamKey: `yt-key-${next("k")}-secret` };
    },
    async createBroadcast(token, { title, description, streamId }) {
      check("youtube", token);
      const broadcastId = next("yt-video");
      record("youtube", "createBroadcast", { title, description, streamId, broadcastId });
      return { broadcastId };
    },
    async endBroadcast(token, broadcastId) {
      check("youtube", token);
      record("youtube", "endBroadcast", { broadcastId });
      youtubeViewers.set(broadcastId, null);
    },
    async setPaidPromotion(token, videoId, on) {
      check("youtube", token);
      record("youtube", "setPaidPromotion", { videoId, on });
    },
    async concurrentViewers(token, videoId) {
      check("youtube", token);
      record("youtube", "concurrentViewers", { videoId });
      return youtubeViewers.get(videoId) ?? null;
    },
    async geography(token, { videoId, day }) {
      check("youtube", token);
      record("youtube", "geography", { videoId, day });
      return geography.get(`${videoId}:${day}`) ?? { status: "not_ready" };
    }
  };

  fake.twitch = {
    scopes: TWITCH_SCOPES,
    ingestUrl: "rtmp://live.twitch.test/app",
    authorizeUrl: ({ state, redirectUri }) => `https://id.twitch.test/oauth2/authorize?${new URLSearchParams({ state, redirect_uri: redirectUri, scope: TWITCH_SCOPES.join(" ") })}`,
    async exchangeCode({ code, redirectUri }) {
      record("twitch", "exchangeCode", { redirectUri });
      const who = codes.get(code);
      if (!who) throw new PlatformAuthError("Twitch");
      codes.delete(code);
      return tokens("twitch", who, TWITCH_SCOPES);
    },
    async refresh(refreshToken) {
      record("twitch", "refresh");
      return tokens("twitch", check("twitch", refreshToken), TWITCH_SCOPES);
    },
    async revoke(token) {
      record("twitch", "revoke");
      if (fake.failRevoke) return false;
      revoked.add(token);
      return true;
    },
    async user(token) {
      const who = check("twitch", token);
      return { id: who.accountId, login: who.account.toLowerCase(), displayName: who.account };
    },
    async streamKey(token, broadcasterId) {
      check("twitch", token);
      record("twitch", "streamKey", { broadcasterId });
      return `live_${broadcasterId}_twitch-key-secret`;
    },
    async stream(token, userId) {
      check("twitch", token);
      record("twitch", "stream", { userId });
      const viewers = twitchViewers.get(userId);
      return viewers === null || viewers === undefined ? null : { id: `tw-stream-${userId}`, viewers, title: "Live" };
    },
    async setBrandedContent(token, broadcasterId, on) {
      check("twitch", token);
      record("twitch", "setBrandedContent", { broadcasterId, on });
    }
  };
  return fake;
}
