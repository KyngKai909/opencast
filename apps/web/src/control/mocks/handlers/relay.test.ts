// The Translators page's relay setting (follow-up Phase 3), as master control's mocks answer it:
// BEAT relays everything to YouTube and Twitch (Twitch restarts tonight during a break; YouTube is
// marked as containing paid promotion); other stations start on "Live shows only". The mode, what
// breaks show, the bug and saving YouTube videos change; the month comes from the Station account.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// On the reference's Saturday, 8:42:12 pm, whatever the real time is.
vi.mock("../../../config", async (importOriginal) => {
  const { config } = await importOriginal<typeof import("../../../config")>();
  return { config: { ...config, mock: true, mockClock: "2026-09-27T03:42:12Z" } };
});

const { setupServer } = await import("msw/node");
const { RelayView, RelayRestart } = await import("@opencast/contracts");
const { relayHandlers } = await import("./relay");
const { platformHandlers, resetPlatforms } = await import("./platforms");
const { resetDb } = await import("../db");
const { resetEarnings } = await import("../fixtures/earnings");
const { resetAccounts, setAccountState } = await import("../fixtures/account");
const { resetRelays } = await import("../fixtures/relay");
const { BEAT, HALL } = await import("../fixtures/stations");

const server = setupServer(...relayHandlers, ...platformHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetEarnings();
  resetAccounts();
  resetPlatforms();
  resetRelays();
});

const api = (path: string, as: string | null, init: RequestInit = {}) =>
  fetch(`http://localhost/v1${path}`, { ...init, headers: { ...(as ? { authorization: `Bearer mock-access-token:${as}@example.com` } : {}), "content-type": "application/json" } });
const relay = async (stationId: string, as = "kai") => RelayView.parse(await (await api(`/stations/${stationId}/relay`, as)).json());
const patch = async (stationId: string, body: object, as = "kai") => api(`/stations/${stationId}/relay`, as, { method: "PATCH", body: JSON.stringify(body) });

describe("the relay setting", () => {
  it("BEAT relays everything it airs to YouTube and Twitch; Twitch restarts tonight during a break", async () => {
    const r = await relay(BEAT.id);
    expect(r).toMatchObject({ mode: "everything", breakHandling: "air_spots", bugOnRelays: true, saveYoutubeVideos: false, status: "relaying", pausedBecause: null });
    expect(r.platforms.map((p) => [p.kind, p.connected, p.status, p.paidPromotion])).toEqual([
      ["youtube", true, "relaying", "marked"],
      ["twitch", true, "relaying", null]
    ]);
    expect(r.nextRestarts).toHaveLength(1);
    expect(r.nextRestarts[0]).toMatchObject({ kind: "twitch", reason: "limit", status: "scheduled", duringBreak: true, automatic: true, label: "Twitch restarts Saturday at 11:59 pm, during a break" });
    expect(r.platforms.find((p) => p.kind === "twitch")?.nextRestart?.id).toBe(r.nextRestarts[0].id);
    expect(r.recentRestarts[0].label).toBe("Twitch restarted Friday at 12:59 am, during a break");
    // "Relayed this month": the Station account's relay line.
    expect(r.month.hours).toBeGreaterThan(0);
    expect(r.month.soFarMicros).toBeGreaterThan(0);
    expect(r.month).toMatchObject({ priceMicros: 200_000, capMicros: 60_000_000 });
    const log = (await (await api(`/stations/${BEAT.id}/relay/restarts?limit=10`, "kai")).json()) as unknown[];
    expect(log.map((x) => RelayRestart.parse(x).status)).toEqual(["scheduled", "done"]);
  });

  it("other stations start on live shows only, nothing relayed; owners and operators change it", async () => {
    // HALL has no platforms connected: nothing to relay.
    expect(await relay(HALL.id)).toMatchObject({ mode: "live_only", breakHandling: "air_spots", bugOnRelays: true, status: "off", platforms: [], nextRestarts: [] });
    const changed = RelayView.parse(await (await patch(BEAT.id, { mode: "live_only", breakHandling: "station_id_slate", bugOnRelays: false, saveYoutubeVideos: true }, "marcus")).json());
    expect(changed).toMatchObject({ mode: "live_only", breakHandling: "station_id_slate", bugOnRelays: false, saveYoutubeVideos: true, status: "off", nextRestarts: [] });
    // Spots off relays: nothing is marked as paid promotion.
    expect(changed.platforms.every((p) => p.paidPromotion === null)).toBe(true);
    expect((await patch(BEAT.id, { mode: "sometimes" })).status).toBe(400);
    // Hosts don't see it.
    expect((await api(`/stations/${BEAT.id}/relay`, "jen")).status).toBe(403);
    expect((await patch(BEAT.id, { mode: "everything" }, "jen")).status).toBe(403);
  });

  it("paused with the station account: everything stops at the cap or past the grace period, the page says why", async () => {
    setAccountState(BEAT.id, "paused");
    expect(await relay(BEAT.id)).toMatchObject({ mode: "everything", status: "paused", pausedBecause: "unpaid", nextRestarts: [] });
  });
});
