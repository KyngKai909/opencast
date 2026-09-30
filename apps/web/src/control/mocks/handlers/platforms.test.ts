// The Translators page's platform connections (follow-up Phase 3): BEAT as step A4 draws it
// (YouTube and Twitch signed in), signing in (the mock connects at once and answers where the
// platform would send the browser back), adding any other destination by address and key, and
// removing one. Owners change them; operators see them; hosts don't.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const { setupServer } = await import("msw/node");
const { PlatformList, PlatformConnection } = await import("@opencast/contracts");
const { platformHandlers, resetPlatforms } = await import("./platforms");
const { earningsHandlers } = await import("./earnings");
const { resetDb } = await import("../db");
const { BEAT, HALL } = await import("../fixtures/stations");

const server = setupServer(...platformHandlers, ...earningsHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetPlatforms();
});

const api = (path: string, as: string | null, init: RequestInit = {}) =>
  fetch(`http://localhost/v1${path}`, { ...init, headers: { ...(as ? { authorization: `Bearer mock-access-token:${as}@example.com` } : {}), "content-type": "application/json" } });
const list = async (stationId: string, as = "kai") => PlatformList.parse(await (await api(`/stations/${stationId}/platforms`, as)).json());

describe("connected platforms", () => {
  it("BEAT has YouTube and Twitch signed in; keys are never sent", async () => {
    const l = await list(BEAT.id);
    expect(l.signIn).toEqual({ youtube: true, twitch: true, facebook: false });
    expect(l.platforms.map((p) => [p.kind, p.account, p.method, p.countsViewers, p.paidPromotion])).toEqual([
      ["youtube", "Inland Beat channel", "signed_in", true, "automatic"],
      ["twitch", "inlandbeat", "signed_in", true, "automatic"]
    ]);
    expect(JSON.stringify(l)).not.toMatch(/streamKey"/);
    // Operators see it; hosts don't.
    expect((await list(BEAT.id, "marcus")).platforms).toHaveLength(2);
    expect((await api(`/stations/${BEAT.id}/platforms`, "jen")).status).toBe(403);
  });

  it("signing in connects and answers where the platform sends the browser back", async () => {
    expect((await api(`/stations/${HALL.id}/platforms/oauth/youtube/start`, "kai", { method: "POST", body: "{}" })).status).toBe(403); // Kai operates HALL
    const res = await api(`/stations/${BEAT.id}/platforms/oauth/youtube/start`, "kai", { method: "POST", body: JSON.stringify({ returnTo: "/control/setup/x/translators" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).url).toMatch(/\/control\/setup\/x\/translators\?platform=youtube&connected=1$/);
    // The same account again: still one YouTube.
    expect((await list(BEAT.id)).platforms.filter((p) => p.kind === "youtube")).toHaveLength(1);
  });

  it("adds any other destination by rtmp:// or rtmps:// address and key, and removes it", async () => {
    const bad = await api(`/stations/${BEAT.id}/platforms`, "kai", { method: "POST", body: JSON.stringify({ kind: "facebook", name: "Facebook", rtmpUrl: "https://x", streamKey: "k" }) });
    expect(bad.status).toBe(400);
    const added = await api(`/stations/${BEAT.id}/platforms`, "kai", { method: "POST", body: JSON.stringify({ kind: "facebook", name: "Inland Beat on Facebook", rtmpUrl: "rtmps://live-api-s.facebook.com:443/rtmp/", streamKey: "FB-1" }) });
    expect(added.status).toBe(201);
    const fb = PlatformConnection.parse(await added.json());
    expect(fb).toMatchObject({ method: "manual", countsViewers: false, paidPromotion: "remind", hasStreamKey: true });
    expect((await api(`/stations/${BEAT.id}/platforms/${fb.id}`, "marcus", { method: "DELETE" })).status).toBe(403);
    expect((await api(`/stations/${BEAT.id}/platforms/${fb.id}`, "kai", { method: "DELETE" })).status).toBe(200);
    expect((await list(BEAT.id)).platforms.map((p) => p.kind)).toEqual(["youtube", "twitch"]);
  });
});

describe("relay viewers in the station's earnings", () => {
  it("BEAT's YouTube and Twitch viewers are their own lines, out of the spots line", async () => {
    const e = await (await api(`/stations/${BEAT.id}/earnings?period=month`, "kai")).json();
    expect(e.lines.relayViewers).toEqual([
      { platform: "youtube", label: "Relay viewers, as reported by YouTube", micros: 12_400_000, airings: 31 },
      { platform: "twitch", label: "Relay viewers, as reported by Twitch", micros: 3_100_000, airings: 9 }
    ]);
    const hall = await (await api(`/stations/${HALL.id}/earnings?period=month`, "kai")).json();
    expect(hall.lines?.relayViewers).toBeUndefined();
  });
});
