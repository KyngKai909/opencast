// Platform connections (follow-up Phase 3; platformsApi in contracts/platforms.ts): the Translators
// page's "Connected platforms" and "Add a platform". BEAT starts as step A4 draws it: YouTube
// ("Inland Beat channel, signed in. Opencast starts each broadcast for you") and Twitch
// ("inlandbeat, signed in"). Kept in memory; `resetPlatforms()` puts the seed back.
//
// Signing in: the real API answers with the platform's consent page, and the platform comes back
// to /v1/platforms/oauth/:provider/callback, which redirects to master control. The mock can't
// leave the app, so it connects at once and answers with where the callback would send the browser
// (`<returnTo>?platform=youtube&connected=1`). A second YouTube or Twitch sign-in reconnects the
// same account. Stream keys are never returned (only `hasStreamKey`), as in the API.
//
// Who: owners and operators see the list; only owners connect, add and remove (403 otherwise).

import { http, type HttpHandler } from "msw";
import { platformsApi, type PlatformConnection, type PlatformKind } from "@opencast/contracts";
import { BEAT } from "../fixtures/stations";
import { bodyOf, fail, path, reply } from "../respond";
import { roleOn } from "./log";

const U = (n: number) => `00000000-0000-4000-b770-${String(n).padStart(12, "0")}`;
const BEAT_ID = BEAT.id;

function seed(): Map<string, PlatformConnection[]> {
  const m = new Map<string, PlatformConnection[]>();
  if (BEAT_ID) {
    m.set(BEAT_ID, [
      {
        id: U(1),
        kind: "youtube",
        method: "signed_in",
        name: "Inland Beat channel",
        account: "Inland Beat channel",
        rtmpUrl: "rtmps://a.rtmps.youtube.com/live2",
        hasStreamKey: true,
        status: "connected",
        countsViewers: true,
        reportsLocation: true,
        paidPromotion: "automatic",
        paidPromotionOn: false,
        broadcast: { id: "mockYtVideo1", title: "BEAT: Inland Beat", url: "https://www.youtube.com/watch?v=mockYtVideo1" },
        lastViewers: { viewers: 212, at: "2026-09-27T03:41:00.000Z" },
        connectedAt: "2026-09-14T17:02:00.000Z"
      },
      {
        id: U(2),
        kind: "twitch",
        method: "signed_in",
        name: "inlandbeat on Twitch",
        account: "inlandbeat",
        rtmpUrl: "rtmp://live.twitch.tv/app",
        hasStreamKey: true,
        status: "connected",
        countsViewers: true,
        reportsLocation: false,
        paidPromotion: "automatic",
        paidPromotionOn: false,
        broadcast: null,
        lastViewers: { viewers: 48, at: "2026-09-27T03:41:00.000Z" },
        connectedAt: "2026-09-14T17:05:00.000Z"
      }
    ]);
  }
  return m;
}

let state = seed();
let next = 100;

export function resetPlatforms() {
  state = seed();
  next = 100;
}

export function mockPlatformsOf(stationId: string): PlatformConnection[] {
  return state.get(stationId) ?? [];
}

/** Whether signing in is set up in the mock: both, as on a server with the Google and Twitch clients set. */
const SIGN_IN = { youtube: true, twitch: true, facebook: false };

const origin = (request: Request) => (typeof location !== "undefined" && location.origin !== "null" ? location.origin : new URL(request.url).origin);

export const platformHandlers: HttpHandler[] = [
  http.get(path(platformsApi.listPlatforms), ({ request, params }) => {
    const id = String(params.stationId);
    const r = roleOn(request, id, ["owner", "operator"]);
    if (r instanceof Response) return r;
    return reply(platformsApi.listPlatforms.response, { platforms: mockPlatformsOf(id), signIn: SIGN_IN, canStoreKeys: true });
  }),

  http.post(path(platformsApi.startPlatformSignIn), async ({ request, params }) => {
    const id = String(params.stationId);
    const provider = String(params.provider);
    const r = roleOn(request, id, ["owner"]);
    if (r instanceof Response) return r;
    if (provider !== "youtube" && provider !== "twitch") return fail(400, "bad_request", "Sign in to YouTube or Twitch; add anything else with its address and key.");
    const body = (await bodyOf<{ returnTo?: string }>(request)) ?? {};
    const returnTo = typeof body.returnTo === "string" && body.returnTo.startsWith("/control/") ? body.returnTo : `/control/${r.station.ident.slug ?? r.station.ident.callSign?.toLowerCase() ?? id}/translators`;
    const list = mockPlatformsOf(id);
    const name = r.station.ident.name;
    const existing = list.find((p) => p.kind === provider && p.method === "signed_in");
    if (existing) existing.status = "connected";
    else {
      const youtube = provider === "youtube";
      list.push({
        id: U(next++),
        kind: provider,
        method: "signed_in",
        name: youtube ? `${name} channel` : `${name.toLowerCase().replace(/[^a-z0-9]/g, "")} on Twitch`,
        account: youtube ? `${name} channel` : name.toLowerCase().replace(/[^a-z0-9]/g, ""),
        rtmpUrl: youtube ? "rtmps://a.rtmps.youtube.com/live2" : "rtmp://live.twitch.tv/app",
        hasStreamKey: true,
        status: "connected",
        countsViewers: true,
        reportsLocation: youtube,
        paidPromotion: "automatic",
        paidPromotionOn: false,
        broadcast: youtube ? { id: `mockYtVideo${next}`, title: `${r.station.ident.callSign ?? name}: ${name}`, url: `https://www.youtube.com/watch?v=mockYtVideo${next}` } : null,
        lastViewers: null,
        connectedAt: new Date().toISOString()
      });
      state.set(id, list);
    }
    // Where the platform's callback would send the browser.
    return reply(platformsApi.startPlatformSignIn.response, { url: `${origin(request)}${returnTo}?platform=${provider}&connected=1` });
  }),

  http.post(path(platformsApi.addManualPlatform), async ({ request, params }) => {
    const id = String(params.stationId);
    const r = roleOn(request, id, ["owner"]);
    if (r instanceof Response) return r;
    const parsed = platformsApi.addManualPlatform.body.safeParse(await bodyOf(request));
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "body")] = issue.message;
      return fail(400, "bad_request", fields.rtmpUrl ? "Use an rtmp:// or rtmps:// address." : "Add a name, an address and a stream key.", fields);
    }
    const connection: PlatformConnection = {
      id: U(next++),
      kind: parsed.data.kind as PlatformKind,
      method: "manual",
      name: parsed.data.name,
      account: null,
      rtmpUrl: parsed.data.rtmpUrl,
      hasStreamKey: true,
      status: "connected",
      countsViewers: false,
      reportsLocation: false,
      paidPromotion: "remind",
      paidPromotionOn: false,
      broadcast: null,
      lastViewers: null,
      connectedAt: new Date().toISOString()
    };
    state.set(id, [...mockPlatformsOf(id), connection]);
    return reply(platformsApi.addManualPlatform.response, connection, 201);
  }),

  http.delete(path(platformsApi.removePlatform), ({ request, params }) => {
    const id = String(params.stationId);
    const r = roleOn(request, id, ["owner"]);
    if (r instanceof Response) return r;
    const list = mockPlatformsOf(id);
    if (!list.some((p) => p.id === String(params.platformId))) return fail(404, "not_found", "That platform wasn't found.");
    state.set(
      id,
      list.filter((p) => p.id !== String(params.platformId))
    );
    return reply(platformsApi.removePlatform.response, { ok: true });
  })
];
