// The spots mock, through its handlers: filling breaks from the rotation, who may change it, the
// pause story (backup rotation, "It's back"), sponsorship answers and quoting an order.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { setupServer as SetupServer } from "msw/node";

const ORIGIN = "http://localhost";
let server: ReturnType<typeof SetupServer>;
let ids: typeof import("../fixtures/spots");

const as = (email: string) => ({ authorization: `Bearer mock-access-token:${email}`, "content-type": "application/json" });
async function api(method: string, path: string, email = "kai@example.com", body?: unknown) {
  const res = await fetch(`${ORIGIN}/v1${path}`, { method, headers: as(email), body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  // The reference moment, before the mocks work out "tonight".
  vi.useFakeTimers({ now: new Date("2026-09-27T03:42:12.000Z"), toFake: ["Date"] });
  localStorage.clear();
  const { setupServer } = await import("msw/node");
  const { spotsHandlers } = await import("./spots");
  ids = await import("../fixtures/spots");
  server = setupServer(...spotsHandlers);
  server.listen({ onUnhandledRequest: "bypass" });
});

afterAll(() => {
  server.close();
  vi.useRealTimers();
});

const BEAT = "00000000-0000-4000-8000-000000000012";

describe("spots mock", () => {
  it("starts with 4:15 open tonight and an empty rotation", async () => {
    const avails = await api("GET", `/stations/${BEAT}/avails?hours=24`);
    expect(avails.json.totalOpenMs).toBe(255_000);
    const rot = await api("GET", `/stations/${BEAT}/rotations`);
    expect(rot.json.main.spots).toEqual([]);
    expect(rot.json.backup.spots.map((s: { business: string }) => s.business)).toEqual(["Redlands Hardware", "Citrus Valley Farmers Market"]);
  });

  it("keeps blocked categories out of the market", async () => {
    const m = await api("GET", `/stations/${BEAT}/spot-market`);
    expect(m.json.map((s: { spot: { category: string } }) => s.spot.category)).not.toContain("Alcohol");
    expect(m.json[0].business.name).toBe("Orange Street Coffee");
    expect(m.json[0].runway).toEqual({ kind: "days", days: 44 });
  });

  it("doesn't let a host change the rotation", async () => {
    const r = await api("PUT", `/stations/${BEAT}/rotations/main`, "jen@example.com", { spotIds: [ids.SPOT_IDS.fallMenu] });
    expect(r.status).toBe(403);
  });

  it("fills the breaks from the rotation, leaving 0:30 (C.3)", async () => {
    const r = await api("PUT", `/stations/${BEAT}/rotations/main`, "marcus@example.com", { spotIds: [ids.SPOT_IDS.fallMenu, ids.SPOT_IDS.tire, ids.SPOT_IDS.dental] });
    expect(r.status).toBe(200);
    const avails = await api("GET", `/stations/${BEAT}/avails?hours=24`);
    expect(avails.json.totalOpenMs).toBe(30_000);
    const last = avails.json.breaks.at(-1);
    expect(last.contents.filter((c: { kind: string }) => c.kind === "spot").map((c: { shortName: string }) => c.shortName)).toEqual(["Inland Tire", "Cypress Dental", "Orange Street", "Redlands Hardware"]);
  });

  it("hands a paused spot's time to the backup rotation, and tells the station", async () => {
    await api("POST", `/spots/${ids.SPOT_IDS.fallMenu}/pause`);
    const m = await api("GET", `/stations/${BEAT}/spot-market`);
    const fall = m.json.find((s: { spot: { id: string } }) => s.spot.id === ids.SPOT_IDS.fallMenu);
    expect(fall.state).toBe("paused");
    expect(fall.pause.heldTonightMs).toBe(90_000);
    expect(fall.pause.filledBy).toContain("Redlands Hardware");
    const avails = await api("GET", `/stations/${BEAT}/avails?hours=24`);
    const spots = avails.json.breaks.flatMap((b: { contents: { spotId: string; kind: string }[] }) => b.contents.filter((c) => c.kind === "spot"));
    expect(spots.some((c: { spotId: string }) => c.spotId === ids.SPOT_IDS.fallMenu)).toBe(false);
    const rot = await api("GET", `/stations/${BEAT}/rotations`);
    expect(rot.json.main.spots.find((s: { spotId: string }) => s.spotId === ids.SPOT_IDS.fallMenu).paused).toBe(true);
  });

  it("brings it back without putting it back: It's back, then Add it back", async () => {
    await api("POST", `/spots/${ids.SPOT_IDS.fallMenu}/resume`);
    let m = await api("GET", `/stations/${BEAT}/spot-market`);
    let fall = m.json.find((s: { spot: { id: string } }) => s.spot.id === ids.SPOT_IDS.fallMenu);
    expect(fall.state).toBe("its_back");
    expect(fall.inRotation).toBeNull();
    expect(fall.back.reason).toBe("raised_budget");
    await api("PUT", `/stations/${BEAT}/rotations/main`, "kai@example.com", { spotIds: [ids.SPOT_IDS.tire, ids.SPOT_IDS.dental, ids.SPOT_IDS.fallMenu] });
    m = await api("GET", `/stations/${BEAT}/spot-market`);
    fall = m.json.find((s: { spot: { id: string } }) => s.spot.id === ids.SPOT_IDS.fallMenu);
    expect(fall.state).toBe("in_rotation");
  });

  it("answers a sponsorship once, and only owners change minimums", async () => {
    const id = ids.SPONSORSHIP_IDS.orange;
    const ok = await api("POST", `/sponsorships/${id}/decision`, "marcus@example.com", { decision: "approve" });
    expect(ok.json.state).toBe("approved");
    const again = await api("POST", `/sponsorships/${id}/decision`, "kai@example.com", { decision: "decline", reason: "full" });
    expect(again.status).toBe(409);
    const list = await api("GET", `/stations/${BEAT}/sponsorships`);
    expect(list.json.settings.find((s: { title: string }) => s.title === "Beat Tape Live").sponsors).toBe(1);
    const op = await api("PUT", `/stations/${BEAT}/sponsorship-settings`, "marcus@example.com", []);
    expect(op.status).toBe(403);
  });

  it("quotes an order, once", async () => {
    const id = ids.ORDER_IDS.giftCards;
    const q = await api("POST", `/orders/${id}/quote`, "kai@example.com", { action: "quote", priceMicros: 140_000_000, deliverBy: "2026-10-09", roundsIncluded: 1, voicedBy: "Jen Park, host of Beat Tape Live" });
    expect(q.json.state).toBe("quoted");
    expect(q.json.quote.priceMicros).toBe(140_000_000);
    const again = await api("POST", `/orders/${id}/quote`, "kai@example.com", { action: "pass" });
    expect(again.status).toBe(409);
  });
});
