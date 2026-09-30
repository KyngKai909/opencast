// The Station account's mocks (pay-as-you-go): the three states the screens are built against,
// and what owners and operators may do.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// On the reference's Saturday, 8:42:12 pm, whatever the real time is: the mock clock, as dev:mock
// runs it (the month so far, the grace period's days left and last month's bill all follow it).
vi.mock("../../../config", async (importOriginal) => {
  const { config } = await importOriginal<typeof import("../../../config")>();
  return { config: { ...config, mock: true, mockClock: "2026-09-27T03:42:12Z" } };
});

const { setupServer } = await import("msw/node");
const { StationAccount } = await import("@opencast/contracts");
const { accountHandlers } = await import("./account");
const { getDb, resetDb, saveDb } = await import("../db");
const { resetEarnings } = await import("../fixtures/earnings");
const { resetAccounts, setAccountState } = await import("../fixtures/account");
const { BEAT, HALL, LAB } = await import("../fixtures/stations");
const { KAI } = await import("../fixtures/people");

const server = setupServer(...accountHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetEarnings();
  resetAccounts();
});

const api = (path: string, as: string | null, init: RequestInit = {}) =>
  fetch(`http://localhost/v1${path}`, { ...init, headers: { ...(as ? { authorization: `Bearer mock-access-token:${as}@example.com` } : {}), "content-type": "application/json" } });
const account = async (stationId: string, as: string) => StationAccount.parse(await (await api(`/stations/${stationId}/account`, as)).json());
const $ = (d: number) => Math.round(d * 1_000_000);

describe("the Station account's three states", () => {
  it("the studio is inside the free allowance: nothing so far, nothing expected", async () => {
    const a = await account(LAB.id, "sam");
    expect(a.standing).toBe("ok");
    expect(a.totals).toEqual({ soFarMicros: 0, estimateMicros: 0 });
    expect(a.allowance.storageGbLeft).toBeGreaterThan(0);
    expect(a.usage.find((u) => u.type === "live_hours")).toMatchObject({ quantity: 1.5, allowance: { quantity: 5, left: 3.5 }, soFarMicros: 0 });
    expect(a.funding).toMatchObject({ source: null, card: null, earningsFirst: true });
    expect(a.canManage).toBe(true);
  });

  it("BEAT is paid from its earnings: usage so far, the month's estimate, a cap, a card it never needs", async () => {
    const a = await account(BEAT.id, "kai");
    expect(a.standing).toBe("ok");
    const relays = a.usage.find((u) => u.type === "relay_everything")!;
    expect(relays.soFarMicros).toBeGreaterThan(0);
    expect(relays.estimate.micros).toBeGreaterThan(relays.soFarMicros);
    expect(relays.cap).toMatchObject({ micros: $(60), reached: false, cappable: true });
    expect(a.funding).toMatchObject({ source: "card", card: { label: "Visa ending 4242" }, earningsAvailableMicros: $(640.12) });
    expect(a.bills[1]).toMatchObject({ month: "2026-08", status: "paid", fromEarningsMicros: $(38.94), dueMicros: 0 });
    expect(a.usage.find((u) => u.type === "relay_live_only")).toMatchObject({ free: true, cap: { cappable: false } });
  });

  it("HALL is in its grace period: August is due, relays and live shows keep going, the channel always", async () => {
    const a = await account(HALL.id, "kai");
    expect(a).toMatchObject({ standing: "grace", dueMicros: $(96.4), grace: { daysLeft: 7, dueMicros: $(96.4) }, canManage: false });
    expect(a.bills[1]).toMatchObject({ status: "due", lastAttempt: { method: "card", result: "failed", reason: "Your card was declined." } });
    expect(a.usage.every((u) => u.paused === null)).toBe(true);
    setAccountState(HALL.id, "paused");
    const paused = await account(HALL.id, "kai");
    expect(paused.standing).toBe("paused");
    expect(paused.usage.find((u) => u.type === "relay_everything")?.paused).toBe("unpaid");
    expect(paused.usage.find((u) => u.type === "storage")?.paused).toBeNull();
  });
});

describe("changing it", () => {
  it("owners only; operators see; hosts and strangers don't", async () => {
    expect((await api(`/stations/${BEAT.id}/account`, "marcus")).status).toBe(200);
    expect((await api(`/stations/${BEAT.id}/account`, "jen")).status).toBe(403);
    expect((await api(`/stations/${BEAT.id}/account`, "sam")).status).toBe(404);
    expect((await api(`/stations/${BEAT.id}/account`, null)).status).toBe(401);
    expect((await api(`/stations/${BEAT.id}/account/caps`, "marcus", { method: "PUT", body: JSON.stringify({ caps: { storage: $(5) } }) })).status).toBe(403);
  });

  it("caps: set, reached (paused, never the channel), removed; free types have none", async () => {
    const low = await api(`/stations/${BEAT.id}/account/caps`, "kai", { method: "PUT", body: JSON.stringify({ caps: { relay_everything: $(5) } }) });
    const capped = StationAccount.parse(await low.json());
    expect(capped.usage.find((u) => u.type === "relay_everything")).toMatchObject({ soFarMicros: $(5), cap: { micros: $(5), reached: true }, paused: "cap" });
    expect(capped.standing).toBe("ok");
    const off = StationAccount.parse(await (await api(`/stations/${BEAT.id}/account/caps`, "kai", { method: "PUT", body: JSON.stringify({ caps: { relay_everything: null } }) })).json());
    expect(off.usage.find((u) => u.type === "relay_everything")?.cap.micros).toBeNull();
    expect((await api(`/stations/${BEAT.id}/account/caps`, "kai", { method: "PUT", body: JSON.stringify({ caps: { relay_live_only: $(1) } }) })).status).toBe(422);
  });

  it("in grace: a declined card fails, a new card pays at once and it's back to ok", async () => {
    setAccountState(BEAT.id, "grace");
    const declined = await api(`/stations/${BEAT.id}/account/pay`, "kai", { method: "POST" });
    expect(declined.status).toBe(422);
    expect((await declined.json()).error).toMatchObject({ code: "card_declined", message: "Your card was declined." });
    const setup = await (await api(`/stations/${BEAT.id}/account/card-setup`, "kai", { method: "POST" })).json();
    expect(setup).toMatchObject({ setupIntentId: expect.stringMatching(/^seti_mock_/), clientSecret: expect.any(String), publishableKey: null });
    const saved = StationAccount.parse(await (await api(`/stations/${BEAT.id}/account/card`, "kai", { method: "POST", body: JSON.stringify({ setupIntentId: setup.setupIntentId }) })).json());
    expect(saved).toMatchObject({ standing: "ok", dueMicros: 0, grace: null, funding: { card: { label: "Visa ending 4242" } } });
    expect(saved.bills[1]).toMatchObject({ status: "paid", fromCardMicros: $(96.4) });
    expect((await api(`/stations/${BEAT.id}/account/pay`, "kai", { method: "POST" })).status).toBe(409);
  });

  it("pays from Clear with full access: the owner chooses it, gets a quote and confirms the transfer", async () => {
    setAccountState(BEAT.id, "grace");
    const db = getDb();
    db.clearLinks[KAI.id] = { address: "0x1111111111111111111111111111111111111111", access: "read_only", linkedAt: "2026-09-20T00:00:00.000Z" };
    saveDb();
    expect((await api(`/stations/${BEAT.id}/account/funding`, "kai", { method: "PUT", body: JSON.stringify({ source: "clear" }) })).status).toBe(409);
    db.clearLinks[KAI.id].access = "full";
    saveDb();
    const chosen = StationAccount.parse(await (await api(`/stations/${BEAT.id}/account/funding`, "kai", { method: "PUT", body: JSON.stringify({ source: "clear" }) })).json());
    expect(chosen.funding).toMatchObject({ source: "clear", chosen: "clear", clear: { available: true, access: "full" } });
    expect((await api(`/stations/${BEAT.id}/account/pay`, "kai", { method: "POST" })).status).toBe(409);
    const quote = await (await api(`/stations/${BEAT.id}/account/clear-payment/quote`, "kai", { method: "POST" })).json();
    expect(quote).toMatchObject({ amountMicros: $(96.4), amountUnits: String($(96.4)), from: "0x1111111111111111111111111111111111111111" });
    const paid = StationAccount.parse(await (await api(`/stations/${BEAT.id}/account/clear-payment`, "kai", { method: "POST", body: JSON.stringify({ amountMicros: quote.amountMicros, txHash: `0x${"ab".repeat(32)}` }) })).json());
    expect(paid).toMatchObject({ standing: "ok", dueMicros: 0 });
    expect(paid.bills[1]).toMatchObject({ status: "paid", fromClearMicros: $(96.4) });
  });
});
