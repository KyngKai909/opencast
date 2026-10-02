import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/clock", () => ({ now: () => new Date("2026-09-27T03:42:12Z"), STATION_TZ: "America/Los_Angeles", useNow: () => new Date("2026-09-27T03:42:12Z") }));

const { setupServer } = await import("msw/node");
const { earningsHandlers } = await import("./earnings");
const { resetDb } = await import("../db");
const { resetEarnings } = await import("../fixtures/earnings");
const { BEAT, LAB } = await import("../fixtures/stations");

const server = setupServer(...earningsHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetEarnings();
});

const api = (path: string, as: string | null, init: RequestInit = {}) =>
  fetch(`http://localhost/v1${path}`, { ...init, headers: { ...(as ? { authorization: `Bearer mock-access-token:${as}@example.com` } : {}), "content-type": "application/json" } });

describe("who sees BEAT's money", () => {
  it("owners and operators see earnings; hosts and strangers don't", async () => {
    expect((await api(`/stations/${BEAT.id}/earnings?period=month`, "kai")).status).toBe(200);
    expect((await api(`/stations/${BEAT.id}/earnings?period=month`, "marcus")).status).toBe(200);
    expect((await api(`/stations/${BEAT.id}/earnings?period=month`, "jen")).status).toBe(403);
    expect((await api(`/stations/${BEAT.id}/earnings?period=month`, "sam")).status).toBe(403);
    expect((await api(`/stations/${BEAT.id}/earnings?period=month`, null)).status).toBe(401);
  });

  it("only owners see the payout account and move money", async () => {
    expect((await api(`/stations/${BEAT.id}/payout-account`, "kai")).status).toBe(200);
    expect((await api(`/stations/${BEAT.id}/payout-account`, "marcus")).status).toBe(403);
    const op = await api(`/stations/${BEAT.id}/payouts`, "marcus", { method: "POST", body: JSON.stringify({ amountMicros: 1_000_000 }) });
    expect(op.status).toBe(403);
    const owner = await api(`/stations/${BEAT.id}/payouts`, "kai", { method: "POST", body: JSON.stringify({ amountMicros: 100_000_000 }) });
    expect(owner.status).toBe(201);
    const after = await (await api(`/stations/${BEAT.id}/earnings?period=month`, "kai")).json();
    expect(after.account.availableMicros).toBe(540_120_000);
  });

  it("refuses more than is available, with the amount in the message", async () => {
    const r = await api(`/stations/${BEAT.id}/payouts`, "kai", { method: "POST", body: JSON.stringify({ amountMicros: 1_000_000_000 }) });
    expect(r.status).toBe(422);
    expect((await r.json()).error.message).toBe("Up to $640.12 is available.");
  });

  it("only owners download a statement's CSV", async () => {
    const list = await (await api(`/stations/${BEAT.id}/statements`, "marcus")).json();
    // Four weeks, and August's month with its usage section (pay-as-you-go).
    expect(list).toHaveLength(5);
    expect(list[4]).toMatchObject({ period: "month", periodStart: "2026-08-01" });
    expect(list[4].lines.filter((l: { group?: string }) => l.group === "usage").map((l: { label: string }) => l.label)).toEqual(["Usage, taken from earnings", "Storage", "Relays, everything you air", "Live hours"]);
    const id = list[0].id;
    expect((await api(`/statements/${id}/csv`, "marcus")).status).toBe(403);
    const csv = await (await api(`/statements/${id}/csv`, "kai")).json();
    expect(csv.filename).toMatch(/^BEAT-statement-week-of-/);
  });

  it("the audience is the station's own, and a studio has none", async () => {
    const q = `from=2026-09-27T01:00:00.000Z&to=2026-09-27T06:00:00.000Z`;
    const a = await api(`/stations/${BEAT.id}/audience?${q}`, "marcus");
    expect(a.status).toBe(200);
    expect((await a.json()).tunedInNow).toBe(312);
    expect((await api(`/stations/${BEAT.id}/audience?${q}`, "jen")).status).toBe(403);
    expect((await api(`/stations/${LAB.id}/audience?${q}`, "sam")).status).toBe(409);
  });

  it("a studio that hasn't finished setting up where it's paid", async () => {
    const acct = await (await api(`/stations/${LAB.id}/payout-account`, "sam")).json();
    expect(acct.status).toBe("needs_onboarding");
    const e = await (await api(`/stations/${LAB.id}/earnings?period=month`, "sam")).json();
    expect(e.totalMicros).toBe(186_400_000);
    expect(e.nextPayout).toBeNull();
  });
});
