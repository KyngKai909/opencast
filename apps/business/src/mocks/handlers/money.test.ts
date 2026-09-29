// The Money mock's rules: the seeded balance, every move through move() (so "Available" and the
// runway agree), bank transfers pending until they arrive and undoable until then, cards at once
// with Stripe's fee, Clear transfers (full access only, idempotent on the hash), taking money out
// (owners only, never more than is available), the movements filter, and starting a business. On
// the reference's Saturday, 8:42 pm.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getResponse, type HttpHandler } from "msw";

const NOW = new Date("2026-09-27T03:42:00Z");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OSC = U(60001);
const CHASE = U(62001);
const $ = (d: number) => Math.round(d * 1_000_000);

let handlers: HttpHandler[];
let db: typeof import("../db");
let fx: typeof import("../fixtures/money");

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  db = await import("../db");
  fx = await import("../fixtures/money");
  handlers = (await import("./money")).moneyHandlers;
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  localStorage.clear();
  db.resetDb();
  fx.resetMoneyState();
});

const WHO: Record<string, string> = { jess: "jess@orangestreet.example", tomas: "tomas@orangestreet.example", ana: "ana@ledgerline.example", new: "new@example.com" };

async function api(method: string, path: string, o: { as?: string; body?: unknown; query?: Record<string, string> } = {}) {
  const url = new URL(`http://localhost/v1${path}`);
  for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
  const email = WHO[o.as ?? "jess"] ?? o.as!;
  const req = new Request(url, { method, headers: { authorization: `Bearer mock-access-token:${email}`, "content-type": "application/json" }, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const res = await getResponse(handlers, req);
  if (!res) throw new Error(`No mock for ${method} ${path}`);
  return { status: res.status, json: await res.json() };
}

describe("the balance", () => {
  it("is the frame's: $412.50 available, $14.20 held for 41 airings, $248.90 spent on 118, about 44 days", async () => {
    const { json } = await api("GET", `/businesses/${OSC}/balance`, { as: "ana" });
    expect(json.availableMicros).toBe($(412.5));
    expect(json.heldMicros).toBe($(14.2));
    expect(json.heldAirings).toBe(41);
    expect(json.spentThisMonthMicros).toBe($(248.9));
    expect(json.spentThisMonthAirings).toBe(118);
    expect(json.pacePerDayMicros).toBe($(9.2));
    expect(json.runwayDays).toBe(44);
    expect(json.depositAddress).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it("is only for the business's team", async () => {
    expect((await api("GET", `/businesses/${OSC}/balance`, { as: "new" })).status).toBe(404);
  });
});

describe("movements", () => {
  it("lists newest first, and filters money in and out from airings", async () => {
    const all = (await api("GET", `/businesses/${OSC}/movements`)).json;
    expect(all.map((m: { label: string }) => m.label)).toEqual(["Aired on BEAT 12.1", "Held for 9 airings tonight", "Returned: airing cut short", "Aired on CIVC 7.1", "Added by bank transfer"]);
    const money = (await api("GET", `/businesses/${OSC}/movements`, { query: { filter: "money" } })).json;
    expect(money.map((m: { kind: string }) => m.kind)).toEqual(["added"]);
    const airings = (await api("GET", `/businesses/${OSC}/movements`, { query: { filter: "airings" } })).json;
    expect(airings).toHaveLength(4);
  });
});

describe("adding money", () => {
  it("by bank transfer is pending until Tuesday, and not available until then", async () => {
    const r = await api("POST", `/businesses/${OSC}/deposits`, { as: "tomas", body: { amountMicros: $(250), fundingSourceId: CHASE } });
    expect(r.status).toBe(201);
    expect(r.json.status).toBe("pending");
    expect(r.json.balance.availableMicros).toBe($(412.5));
    const p = r.json.balance.pendingDeposits[0];
    expect(p.amountMicros).toBe($(250));
    expect(p.method).toBe("clear_bank");
    expect(p.expectedAt).toBe("2026-09-29T16:00:00.000Z"); // Tuesday, 9:00 am in Redlands
  });

  it("arrives through move() once the clock passes Tuesday, 9:00 am", async () => {
    await api("POST", `/businesses/${OSC}/deposits`, { body: { amountMicros: $(250), fundingSourceId: CHASE } });
    vi.setSystemTime(new Date("2026-09-29T16:01:00Z"));
    const b = (await api("GET", `/businesses/${OSC}/balance`)).json;
    expect(b.pendingDeposits).toEqual([]);
    expect(b.availableMicros).toBe($(662.5));
    expect(b.runwayDays).toBe(72);
    const top = (await api("GET", `/businesses/${OSC}/movements`)).json[0];
    expect(top).toMatchObject({ kind: "added", label: "Added by bank transfer", detail: "Through Clear, from Chase ending 8810", amountMicros: $(250) });
  });

  it("can be undone before it arrives, and not after", async () => {
    const r = await api("POST", `/businesses/${OSC}/deposits`, { body: { amountMicros: $(250), fundingSourceId: CHASE } });
    const undo = await api("POST", `/businesses/${OSC}/deposits/${r.json.depositId}/cancel`);
    expect(undo.status).toBe(200);
    expect(undo.json.pendingDeposits).toEqual([]);
    expect(undo.json.availableMicros).toBe($(412.5));
    expect((await api("POST", `/businesses/${OSC}/deposits/${r.json.depositId}/cancel`)).status).toBe(404);
  });

  it("by card is available at once, less Stripe's fee at cost", async () => {
    const cards = (await api("POST", `/businesses/${OSC}/funding-sources`, { body: { kind: "card", token: "tok" } })).json;
    const card = cards.find((f: { kind: string }) => f.kind === "card");
    const q = (await api("POST", `/businesses/${OSC}/deposits/quote`, { body: { amountMicros: $(250), method: "card" } })).json;
    expect(q.feeMicros).toBe($(7.55));
    expect(q.roughAirings).toBe(120);
    const r = await api("POST", `/businesses/${OSC}/deposits`, { body: { amountMicros: $(250), fundingSourceId: card.id } });
    expect(r.json.status).toBe("arrived");
    expect(r.json.balance.availableMicros).toBe($(412.5 + 250 - 7.55));
    const moves = (await api("GET", `/businesses/${OSC}/movements`, { query: { filter: "money" } })).json;
    expect(moves.slice(0, 2).map((m: { label: string; amountMicros: number }) => [m.label, m.amountMicros])).toEqual(
      expect.arrayContaining([
        ["Added by card", $(250)],
        ["Card fee", -$(7.55)]
      ])
    );
    expect((await api("POST", `/businesses/${OSC}/deposits/${r.json.depositId}/cancel`)).status).toBe(409);
  });

  it("is for owners and managers; viewers can't, and only owners link sources", async () => {
    expect((await api("POST", `/businesses/${OSC}/deposits`, { as: "ana", body: { amountMicros: $(250), fundingSourceId: CHASE } })).status).toBe(403);
    expect((await api("POST", `/businesses/${OSC}/funding-sources`, { as: "tomas", body: { kind: "card", token: "tok" } })).status).toBe(403);
  });
});

describe("from Clear", () => {
  const link = (access: "full" | "read_only") => {
    db.getDb().clearLinks[U(21)] = { address: "0x1234567890abcdef1234567890abcdef12345678", access, linkedAt: NOW.toISOString() };
  };
  const hash = `0x${"ab".repeat(32)}`;

  it("quotes where to send it with full access, and credits it once, however often it's confirmed", async () => {
    link("full");
    const q = (await api("POST", `/businesses/${OSC}/deposits/clear-transfer/quote`, { body: { amountMicros: $(250) } })).json;
    expect(q).toMatchObject({ chainId: 8453, amountUnits: "250000000", from: "0x1234567890abcdef1234567890abcdef12345678", token: { symbol: "USDC", decimals: 6 } });
    const a = await api("POST", `/businesses/${OSC}/deposits/clear-transfer`, { body: { amountMicros: $(250), txHash: hash } });
    expect(a.status).toBe(201);
    expect(a.json.status).toBe("arrived");
    expect(a.json.balance.availableMicros).toBe($(662.5));
    const again = await api("POST", `/businesses/${OSC}/deposits/clear-transfer`, { body: { amountMicros: $(250), txHash: hash } });
    expect(again.json.depositId).toBe(a.json.depositId);
    expect(again.json.balance.availableMicros).toBe($(662.5));
  });

  it("answers 409 when the link is read-only or missing", async () => {
    expect((await api("POST", `/businesses/${OSC}/deposits/clear-transfer/quote`, { body: { amountMicros: $(250) } })).status).toBe(409);
    link("read_only");
    expect((await api("POST", `/businesses/${OSC}/deposits/clear-transfer/quote`, { body: { amountMicros: $(250) } })).status).toBe(409);
  });

  it("adds the linked account as a source with the token \"linked\"", async () => {
    link("read_only");
    const list = (await api("POST", `/businesses/${OSC}/funding-sources`, { body: { kind: "clear_account", token: "linked" } })).json;
    expect(list.find((f: { kind: string }) => f.kind === "clear_account").label).toBe("Clear, 0x1234…5678");
  });
});

describe("taking money out", () => {
  it("pauses the spots when less than a day is left, and adding money brings them back (A49)", async () => {
    const live = () => db.getDb().spots.filter((x) => x.businessId === OSC && ["listed", "in_rotation"].includes(x.state)).length;
    const paused = () => db.getDb().spots.filter((x) => x.businessId === OSC && x.state === "paused_balance").length;
    expect(live()).toBeGreaterThan(0);
    // $412.50 available at $9.20 a day: leave $5.00.
    expect((await api("POST", `/businesses/${OSC}/withdrawals`, { body: { amountMicros: $(407.5), fundingSourceId: CHASE } })).status).toBe(201);
    expect(live()).toBe(0);
    expect(paused()).toBeGreaterThan(0);
    // By card (Visa ending 4417): it arrives at once, and they're back in the market.
    expect((await api("POST", `/businesses/${OSC}/deposits`, { body: { amountMicros: $(100), fundingSourceId: U(62002) } })).status).toBe(201);
    expect(paused()).toBe(0);
    expect(db.getDb().spots.filter((x) => x.businessId === OSC && x.state === "listed").length).toBeGreaterThan(0);
  });

  it("takes it from what's available through move(), owners only, never more than is available", async () => {
    expect((await api("POST", `/businesses/${OSC}/withdrawals`, { as: "tomas", body: { amountMicros: $(300), fundingSourceId: CHASE } })).status).toBe(403);
    expect((await api("POST", `/businesses/${OSC}/withdrawals`, { body: { amountMicros: $(500), fundingSourceId: CHASE } })).status).toBe(422);
    const r = await api("POST", `/businesses/${OSC}/withdrawals`, { body: { amountMicros: $(300), fundingSourceId: CHASE } });
    expect(r.status).toBe(201);
    expect(r.json.balance.availableMicros).toBe($(112.5));
    expect(r.json.balance.heldMicros).toBe($(14.2));
    expect(r.json.balance.runwayDays).toBe(12);
    expect(db.balanceOf(OSC).availableMicros).toBe($(112.5));
  });
});

describe("starting a business", () => {
  it("makes someone new its owner, with an empty balance", async () => {
    const body = {
      name: "Orange Street Coffee",
      category: "Coffee and food",
      website: "https://orangestreet.example",
      customersWhere: "location",
      locations: [{ kind: "location", streetAddress: "204 Orange St", city: "Redlands", latitude: 34.05, longitude: -117.18 }]
    };
    const r = await api("POST", "/businesses", { as: "new", body });
    expect(r.status).toBe(201);
    expect(r.json.locations[0].streetAddress).toBe("204 Orange St");
    const id = r.json.id;
    const bal = (await api("GET", `/businesses/${id}/balance`, { as: "new" })).json;
    expect(bal.availableMicros).toBe(0);
    expect(bal.runwayDays).toBeNull();
    expect((await api("GET", `/businesses/${id}/balance`, { as: "jess" })).status).toBe(404);
  });

  it("needs a place for a location, and markets for an online business", async () => {
    expect((await api("POST", "/businesses", { as: "new", body: { name: "A", category: "Shops", customersWhere: "location" } })).status).toBe(400);
    expect((await api("POST", "/businesses", { as: "new", body: { name: "A", category: "Shops", customersWhere: "online" } })).status).toBe(400);
  });

  it("finds Redlands in the address, and says how many stations carry a category", async () => {
    const place = (await api("GET", "/places/lookup", { query: { q: "204 Orange St, Redlands, CA 92373" } })).json;
    expect(place).toMatchObject({ streetAddress: "204 Orange St", city: "Redlands" });
    expect((await api("GET", "/places/lookup", { query: { q: "1 Main St, Springfield" } })).status).toBe(404);
    const reach = (await api("GET", `/markets/${U(90001)}/category-reach`, { query: { category: "Alcohol" } })).json;
    expect(reach).toMatchObject({ reached: 6, total: 8, blockedBy: ["PREP", "HALL"] });
  });
});
