// The account's data in the mock (A1, A2, A3, E1), in the contract's shapes and the API's words,
// and the Settings words that read them.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// On the reference's Saturday, 8:42:12 pm, whatever the real time is: the mock clock, as dev:mock
// runs it. (On the real clock from 11 pm to 6 am, PREP is already in its nightly off air hours,
// and the heartbeat answered with those instead of the sign-off the test makes.)
vi.mock("../../../config", async (importOriginal) => {
  const { config } = await importOriginal<typeof import("../../../config")>();
  return { config: { ...config, mock: true, mockClock: "2026-09-27T03:42:12Z" } };
});
import { setupServer } from "msw/node";
import { AccountExport, audienceApi, ledgerApi, WatchHistory } from "@opencast/contracts";
import { ApiError } from "../../../api/client";
import { mockTokenFor } from "../../../auth/mockToken";
import { deleteRefusal, leadLine, quietLine } from "../../components/settings/panes";
import { getDb, resetDb } from "../db";
import { MOCK_TOKEN } from "../respond";
import { stationByRef } from "../fixtures/stations";
import { AIRINGS } from "../fixtures/schedule";
import { applySignOff } from "../fixtures/signoff";
import { now } from "../../../lib/clock";
import { meHandlers } from "./me";

const server = setupServer(...meHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
});
afterEach(() => server.resetHandlers());

const BASE = "http://api.test/v1";
const req = (method: string, path: string, body?: unknown, token: string | null = MOCK_TOKEN) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
const beat = () => stationByRef("BEAT")!.ident.id;
const beatHeartbeat = { stationId: beat(), sessionId: "00000000-0000-4000-8000-000000000999", platform: "web", mediaTimeMs: 30_000, playing: true };

describe("watch history (A2)", () => {
  it("is kept from signed-in heartbeats only, and says the last channel", async () => {
    await req("POST", "/heartbeat", beatHeartbeat, null);
    expect(WatchHistory.parse(await (await req("GET", "/me/watch-history")).json()).lastChannel).toBeNull();
    await req("POST", "/heartbeat", beatHeartbeat);
    const h = WatchHistory.parse(await (await req("GET", "/me/watch-history")).json());
    expect(h.keep).toBe(true);
    expect(h.lastChannel?.station.callSign).toBe("BEAT");
    expect(h.items).toHaveLength(1);
  });

  it("clears, and stops keeping when watch history is turned off", async () => {
    await req("POST", "/heartbeat", beatHeartbeat);
    expect((await req("DELETE", "/me/watch-history")).status).toBe(200);
    expect(WatchHistory.parse(await (await req("GET", "/me/watch-history")).json()).items).toEqual([]);
    await req("PATCH", "/me", { settings: { privacy: { keepWatchHistory: false } } });
    await req("POST", "/heartbeat", beatHeartbeat);
    const h = WatchHistory.parse(await (await req("GET", "/me/watch-history")).json());
    expect(h).toMatchObject({ keep: false, lastChannel: null, items: [] });
  });

  it("wants a sign-in", async () => {
    expect((await req("GET", "/me/watch-history", undefined, null)).status).toBe(401);
  });
});

describe("your data (A3)", () => {
  it("emails a link, and the file is the whole account", async () => {
    const r = await (await req("POST", "/me/export")).json();
    expect(r.email).toBe("kai@example.com");
    const file = AccountExport.parse(await (await req("GET", "/me/export")).json());
    expect(file.account.email).toBe("kai@example.com");
    expect(file.presets.length).toBeGreaterThan(0);
    expect(file.pledges.map((p) => p.receipts.items?.length ?? 0).every((n) => n > 0)).toBe(true);
  });

  it("won't delete an owner's account (Kai owns BEAT), and says so in the viewer's words", async () => {
    const res = await req("DELETE", "/me");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("owns_station");
    const me = { memberships: [{ kind: "station" as const, role: "owner" as const, station: stationByRef("BEAT")!.ident }] };
    expect(deleteRefusal(new ApiError(409, "owns_station", body.error.message), me)).toBe("You own BEAT 12.1. Make someone on its team the owner in master control first, then delete your account.");
    expect(deleteRefusal(new ApiError(409, "owns_business", "…"), null)).toBe("You own a business on Opencast. Write to us to hand it over first, then delete your account.");
  });

  it("deletes the account of someone who owns nothing", async () => {
    expect((await req("DELETE", "/me", undefined, mockTokenFor("jen@example.com"))).status).toBe(200);
  });
});

describe("pledges (E1)", () => {
  it("has the card and each receipt", async () => {
    const list = ledgerApi.listMyPledges.response.parse(await (await req("GET", "/me/pledges")).json());
    expect(list[0]!.card).toMatchObject({ label: "Visa ending 4417", expired: false });
    expect(list[0]!.receipts.items!.length).toBe(list[0]!.receipts.count);
  });

  it("changes monthly to once, but not once to monthly; the card page is for monthly pledges", async () => {
    const [monthly, once] = getDb().pledges;
    const toOnce = ledgerApi.updatePledge.response.parse(await (await req("PATCH", `/me/pledges/${monthly!.id}`, { cadence: "once" })).json());
    expect(toOnce.endsAfter).not.toBeNull();
    const refused = await req("PATCH", `/me/pledges/${once!.id}`, { cadence: "monthly" });
    expect(refused.status).toBe(422);
    expect((await refused.json()).error.code).toBe("new_pledge_needed");
    expect((await req("POST", `/me/pledges/${once!.id}/card-session`)).status).toBe(422);
  });
});

describe("notification timing's words (O2)", () => {
  it("says how early and the quiet window", () => {
    expect(leadLine(undefined)).toBe("At the start");
    expect(leadLine(0)).toBe("At the start");
    expect(leadLine(10)).toBe("10 minutes before");
    expect(leadLine(60)).toBe("An hour before");
    expect(quietLine({})).toBe("Nothing between 10:00 pm and 8:00 am");
    expect(quietLine({ quietFrom: "23:30", quietTo: "07:00" })).toBe("Nothing between 11:30 pm and 7:00 am");
  });
});

describe("the heartbeat during planned off air (G9)", () => {
  it("isn't counted or kept, and says when the station is back", async () => {
    const prep = stationByRef("PREP")!.ident.id;
    const t = now().getTime();
    const back = new Date(t + 10 * 60_000).toISOString();
    applySignOff(AIRINGS, prep, new Date(t - 60_000).toISOString(), back);
    const r = audienceApi.heartbeat.response.parse(await (await req("POST", "/heartbeat", { ...beatHeartbeat, stationId: prep })).json());
    expect(r.offAirUntil).toBe(back);
    expect(r.nextInMs).toBeGreaterThan(9 * 60_000);
    expect(r.nextInMs).toBeLessThanOrEqual(10 * 60_000);
    expect(WatchHistory.parse(await (await req("GET", "/me/watch-history")).json()).items).toEqual([]);
    // Another station beats as usual.
    expect(audienceApi.heartbeat.response.parse(await (await req("POST", "/heartbeat", beatHeartbeat)).json())).toEqual({ ok: true, nextInMs: 30_000 });
  });
});
