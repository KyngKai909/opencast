// The sponsorships and orders mock, through its handlers: who may do what (owner, manager, viewer),
// the credit check, and the order's walk from a brief to a spot, with the money held and paid.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { setupServer as SetupServer } from "msw/node";

const ORIGIN = "http://localhost";
const OSC = "00000000-0000-4000-8000-000000060001";
const JESS = "jess@orangestreet.example";
const TOMAS = "tomas@orangestreet.example";
const ANA = "ana@ledgerline.example";
const NEW = "someone@example.com";
let server: ReturnType<typeof SetupServer>;
let deals: typeof import("../fixtures/deals");
let db: typeof import("../db");

const as = (email: string) => ({ authorization: `Bearer mock-access-token:${email}`, "content-type": "application/json" });
async function api(method: string, path: string, email = JESS, body?: unknown) {
  const res = await fetch(`${ORIGIN}/v1${path}`, { method, headers: as(email), body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  vi.useFakeTimers({ now: new Date("2026-09-27T03:42:12.000Z"), toFake: ["Date"] });
  localStorage.clear();
  const { setupServer } = await import("msw/node");
  const { dealsHandlers } = await import("./deals");
  deals = await import("../fixtures/deals");
  db = await import("../db");
  server = setupServer(...dealsHandlers);
  server.listen({ onUnhandledRequest: "bypass" });
});

afterAll(() => {
  server.close();
  vi.useRealTimers();
});

describe("roles", () => {
  it("lets owners and managers see sponsorships and orders, and not viewers or strangers", async () => {
    expect((await api("GET", `/businesses/${OSC}/sponsorships`, JESS)).status).toBe(200);
    expect((await api("GET", `/businesses/${OSC}/orders`, TOMAS)).status).toBe(200);
    const ana = await api("GET", `/businesses/${OSC}/orders`, ANA);
    expect(ana.status).toBe(403);
    expect(ana.json.error.message).toBe("Viewers see results, airings and statements.");
    expect((await api("GET", `/businesses/${OSC}/sponsor-targets`, ANA)).status).toBe(403);
    expect((await api("GET", `/orders/${deals.ORDER_IDS.brunch}`, ANA)).status).toBe(403);
    expect((await api("GET", `/businesses/${OSC}/orders`, NEW)).status).toBe(404);
  });

  it("lets a manager accept a quote (approving orders and spending are manager rights), and not a viewer", async () => {
    expect((await api("POST", `/orders/${deals.ORDER_IDS.giftCards}/accept`, ANA)).status).toBe(403);
    const r = await api("POST", `/orders/${deals.ORDER_IDS.giftCards}/accept`, TOMAS);
    expect(r.status).toBe(200);
    expect(r.json.state).toBe("accepted");
    expect(db.balanceOf(OSC).availableMicros).toBe(272_500_000);
  });
});

describe("sponsorships", () => {
  it("checks a credit as it's typed", async () => {
    const r = await api("POST", "/sponsorships/credit-check", JESS, { text: "a coffee house in Redlands, the best in town. Come by this weekend." });
    expect(r.json.passes).toBe(false);
    expect(r.json.flags.map((f: { kind: string }) => f.kind)).toEqual(["comparison", "call_to_action"]);
  });

  it("offers Beat Tape Live, and hears back yes from BEAT", async () => {
    const targets = await api("GET", `/businesses/${OSC}/sponsor-targets`);
    expect(targets.json.near).toBe("Redlands");
    const btl = targets.json.targets[0];
    expect(btl).toMatchObject({ program: { title: "Beat Tape Live" }, minMonthlyMicros: 75_000_000, sponsors: 0, maxSponsors: 2 });
    const sent = await api("POST", `/businesses/${OSC}/sponsorships`, TOMAS, {
      stationId: btl.station.id,
      programId: btl.program.id,
      monthlyMicros: 75_000_000,
      creditText: "A family coffee house on Orange Street in downtown Redlands, and home of the pumpkin bread.",
      startsOn: "2026-10-01"
    });
    expect(sent.status).toBe(201);
    expect(sent.json).toMatchObject({ state: "requested", programFormat: "Weekly, live" });
    const yes = await api("POST", `/sponsorships/${sent.json.id}/decision`, JESS, { decision: "approve" });
    expect(yes.json.state).toBe("approved");
    const list = await api("GET", `/businesses/${OSC}/sponsorships`);
    expect(list.json.map((x: { state: string }) => x.state)).toEqual(["credited", "approved"]);
  });
});

describe("an order, from the brief to a spot", () => {
  it("is quoted, held, delivered, noted and approved into a spot with its order id", async () => {
    const o = await api("POST", `/businesses/${OSC}/orders`, JESS, { makerStationId: deals.BEAT.id, title: "Winter hours", lengthSec: 15, about: "Shorter hours in winter.", neededBy: "2026-11-01" });
    expect(o.status).toBe(201);
    const id = o.json.id;
    // Multipart through jsdom's FormData stalls undici's fetch; the handler's form reading is
    // checked in the browser. Here, the fixture's attach.
    const fx = deals.getDeals().orders.find((x) => x.id === id)!;
    deals.attachBriefFile(fx, "logo.svg");
    expect((await api("GET", `/orders/${id}`)).json.briefFiles[0].filename).toBe("logo.svg");
    const quoted = await api("POST", `/orders/${id}/quote`, JESS, deals.mockQuoteFor(fx));
    expect(quoted.json.quote).toMatchObject({ priceMicros: 140_000_000, deliverBy: "2026-10-09" });

    const before = db.balanceOf(OSC).availableMicros;
    await api("POST", `/orders/${id}/accept`, JESS);
    expect(db.balanceOf(OSC).availableMicros).toBe(before - 140_000_000);
    await api("POST", `/orders/${id}/deliveries`, JESS);
    const noted = await api("POST", `/orders/${id}/notes`, JESS, { timecodeMs: 6000, body: "Bigger logo." });
    expect(noted.json.notes[0]).toMatchObject({ timecodeMs: 6000, author: "Jess Lin", round: 1 });
    expect((await api("POST", `/orders/${id}/review`, ANA, { decision: "approve" })).status).toBe(403);
    const held = db.balanceOf(OSC).heldMicros;
    const done = await api("POST", `/orders/${id}/review`, TOMAS, { decision: "approve" });
    expect(done.json.state).toBe("approved");
    expect(db.balanceOf(OSC).heldMicros).toBe(held - 140_000_000);
    const spot = db.getDb().spots.find((s) => s.id === done.json.spotId)!;
    expect(spot).toMatchObject({ title: "Winter hours", state: "draft", productionOrderId: id });
  });
});
