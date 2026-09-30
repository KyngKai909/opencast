// The Settings mock's rules: the team (who can invite, already on the team, invites waiting and
// expiring, roles, removing, joining), notification settings per person, what managers and viewers
// can change, locations in use, receipts by date, funding sources and closing. On the reference's
// Saturday, 8:42 pm.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getResponse, type HttpHandler } from "msw";

const NOW = new Date("2026-09-27T03:42:00Z");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OSC = U(60001);
const REDLANDS = U(61001);
const COLTON = U(61002);

let handlers: HttpHandler[];
let db: typeof import("../db");
let fx: typeof import("../fixtures/settings");

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  db = await import("../db");
  fx = await import("../fixtures/settings");
  handlers = (await import("./settings")).settingsHandlers;
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  localStorage.clear();
  db.resetDb();
  fx.resetSettings();
});

const WHO: Record<string, string> = { jess: "jess@orangestreet.example", tomas: "tomas@orangestreet.example", ana: "ana@ledgerline.example", devon: "devon@inlandcreative.example" };

async function api(method: string, path: string, o: { as?: string; body?: unknown; query?: Record<string, string> } = {}) {
  const url = new URL(`http://localhost/v1${path}`);
  for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
  const email = WHO[o.as ?? "jess"] ?? o.as!;
  const req = new Request(url, { method, headers: { authorization: `Bearer mock-access-token:${email}`, "content-type": "application/json" }, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const res = await getResponse(handlers, req);
  if (!res) throw new Error(`No mock for ${method} ${path}`);
  return { status: res.status, json: await res.json() };
}

describe("the team", () => {
  it("lists the owner first, the others as seeded, and sam's invite", async () => {
    const { json } = await api("GET", `/businesses/${OSC}/team`, { as: "ana" });
    expect(json.members.map((m: { displayName: string }) => m.displayName)).toEqual(["Jess Lin", "Tomás Rivera", "Ana K.", "Devon M."]);
    expect(json.members[1].note).toBe("Manager, Colton opening");
    expect(json.invites.map((i: { email: string }) => i.email)).toEqual(["sam@orangestreet.example"]);
  });

  it("lets only the owner invite", async () => {
    expect((await api("POST", `/businesses/${OSC}/team/invites`, { as: "tomas", body: { email: "maya@orangestreet.example", role: "manager" } })).status).toBe(403);
    const r = await api("POST", `/businesses/${OSC}/team/invites`, { body: { email: "Maya@OrangeStreet.example", role: "manager" } });
    expect(r.status).toBe(201);
    expect(r.json.email).toBe("maya@orangestreet.example");
    expect(Date.parse(r.json.expiresAt) - NOW.getTime()).toBe(7 * 86_400_000);
  });

  it("refuses someone already on the team, and an invite already waiting", async () => {
    const on = await api("POST", `/businesses/${OSC}/team/invites`, { body: { email: "tomas@orangestreet.example", role: "viewer" } });
    expect(on.status).toBe(409);
    expect(on.json.error.message).toBe("tomas@orangestreet.example is already on the team.");
    const waiting = await api("POST", `/businesses/${OSC}/team/invites`, { body: { email: "sam@orangestreet.example", role: "viewer" } });
    expect(waiting.status).toBe(409);
    expect(waiting.json.error.message).toMatch(/already has an invite waiting/);
  });

  it("replaces an expired invite, and resending extends one a week, 10 minutes apart at least", async () => {
    vi.setSystemTime(new Date(NOW.getTime() + 8 * 86_400_000));
    const again = await api("POST", `/businesses/${OSC}/team/invites`, { body: { email: "sam@orangestreet.example", role: "manager" } });
    expect(again.status).toBe(201);
    const team = await api("GET", `/businesses/${OSC}/team`);
    expect(team.json.invites).toHaveLength(1);
    expect(team.json.invites[0].role).toBe("manager");
    const soon = await api("POST", `/invites/${again.json.id}/resend`);
    expect(soon.status).toBe(429);
    expect(soon.json.error.message).toBe("It went out less than a minute ago. You can send it again in 10 minutes.");
    vi.setSystemTime(new Date(Date.now() + 11 * 60_000));
    const resent = await api("POST", `/invites/${again.json.id}/resend`);
    expect(Date.parse(resent.json.expiresAt)).toBe(Date.now() + 7 * 86_400_000);
    expect((await api("POST", `/invites/${again.json.id}/resend`, { as: "tomas" })).status).toBe(403);
  });

  it("changes roles and removes people, never the owner", async () => {
    const jess = U(21);
    const tomas = U(22);
    expect((await api("PATCH", `/businesses/${OSC}/team/${jess}`, { body: { role: "viewer" } })).status).toBe(409);
    expect((await api("PATCH", `/businesses/${OSC}/team/${tomas}`, { as: "devon", body: { role: "viewer" } })).status).toBe(403);
    const changed = await api("PATCH", `/businesses/${OSC}/team/${tomas}`, { body: { role: "viewer" } });
    expect(changed.json.members.find((m: { userId: string }) => m.userId === tomas).role).toBe("viewer");
    expect((await api("DELETE", `/businesses/${OSC}/team/${jess}`)).status).toBe(409);
    const removed = await api("DELETE", `/businesses/${OSC}/team/${tomas}`);
    expect(removed.json.members).toHaveLength(3);
    expect((await api("GET", `/businesses/${OSC}/team`, { as: "tomas" })).status).toBe(404);
  });

  it("joins the invited person with the invite's role", async () => {
    const inv = await api("POST", `/businesses/${OSC}/team/invites`, { body: { email: "maya@orangestreet.example", role: "viewer" } });
    const other = await api("POST", `/invites/${inv.json.id}/accept`, { as: "someone@else.example" });
    expect(other.status).toBe(403);
    expect(other.json.error.message).toBe("This invite is for m…@orangestreet.example; you're signed in as someone@else.example. Sign in with m…@orangestreet.example to join.");
    const me = await api("POST", `/invites/${inv.json.id}/accept`, { as: "maya@orangestreet.example" });
    expect(me.status).toBe(200);
    // Again by the same person changes nothing; by anyone else, it's used.
    expect((await api("POST", `/invites/${inv.json.id}/accept`, { as: "maya@orangestreet.example" })).status).toBe(200);
    expect((await api("POST", `/invites/${inv.json.id}/accept`, { as: "someone@else.example" })).json.error.code).toBe("invite_used");
    expect(me.json.memberships).toEqual([{ kind: "business", business: { id: OSC, name: "Orange Street Coffee" }, role: "viewer" }]);
    const team = await api("GET", `/businesses/${OSC}/team`);
    expect(team.json.members.map((m: { email: string }) => m.email)).toContain("maya@orangestreet.example");
    expect(team.json.invites.map((i: { email: string }) => i.email)).not.toContain("maya@orangestreet.example");
  });
});

describe("notification settings", () => {
  const q = { scope: "business", scopeId: OSC };
  it("starts viewers with only the weekly summary, and keeps the pause warning on for everyone", async () => {
    const ana = await api("GET", "/me/notification-prefs", { as: "ana", query: q });
    const on = Object.entries(ana.json.prefs as Record<string, { push: boolean }>).filter(([, v]) => v.push).map(([k]) => k);
    expect(on.sort()).toEqual(["low_balance", "weekly_summary"]);
    expect(ana.json.alwaysOn).toEqual(["low_balance"]);
    const jess = await api("GET", "/me/notification-prefs", { query: q });
    expect(jess.json.prefs.code_used.push).toBe(false);
    expect(jess.json.prefs.spot_added.push).toBe(true);
  });
  it("is each person's own, and can't turn off the pause warning", async () => {
    await api("PUT", "/me/notification-prefs", { body: { scope: "business", scopeId: OSC, prefs: { code_used: { push: true, email: true }, low_balance: { push: false, email: false } } } });
    const jess = await api("GET", "/me/notification-prefs", { query: q });
    expect(jess.json.prefs.code_used.push).toBe(true);
    expect(jess.json.prefs.low_balance.push).toBe(true);
    const tomas = await api("GET", "/me/notification-prefs", { as: "tomas", query: q });
    expect(tomas.json.prefs.code_used.push).toBe(false);
  });
});

describe("the profile", () => {
  it("lets managers change the profile, not money settings; viewers nothing", async () => {
    const named = await api("PATCH", `/businesses/${OSC}`, { as: "tomas", body: { about: "Coffee on Orange Street." } });
    expect(named.status).toBe(200);
    expect(named.json.about).toBe("Coffee on Orange Street.");
    expect((await api("PATCH", `/businesses/${OSC}`, { as: "tomas", body: { receiptsEmail: "books@orangestreet.example" } })).status).toBe(403);
    expect((await api("PATCH", `/businesses/${OSC}`, { as: "ana", body: { name: "Ana's" } })).status).toBe(403);
  });
  it("keeps only the EIN's last four", async () => {
    const r = await api("PATCH", `/businesses/${OSC}`, { body: { ein: "12-3454471" } });
    expect(r.json.einLast4).toBe("4471");
    expect((await api("PATCH", `/businesses/${OSC}`, { body: { ein: "1234" } })).status).toBe(400);
  });
  it("won't remove a location a spot targets, or the last one", async () => {
    const colton = await api("DELETE", `/businesses/${OSC}/locations/${COLTON}`);
    expect(colton.status).toBe(409);
    expect(colton.json.error.message).toBe("Now open in Colton targets Colton. Change its targeting first.");
    db.getDb().spots.forEach((s) => (s.targeting.locationIds = []));
    expect((await api("DELETE", `/businesses/${OSC}/locations/${COLTON}`)).status).toBe(200);
    expect((await api("DELETE", `/businesses/${OSC}/locations/${REDLANDS}`)).status).toBe(409);
  });
  it("changes a location in place, keeping it first", async () => {
    const r = await api("PATCH", `/businesses/${OSC}/locations/${REDLANDS}`, { body: { streetAddress: "210 Orange St" } });
    expect(r.json.locations[0]).toMatchObject({ id: REDLANDS, streetAddress: "210 Orange St", city: "Redlands" });
  });
});

describe("receipts and funding", () => {
  it("lists money added and last month's statement, and September's from October 1", async () => {
    const now = await api("GET", `/businesses/${OSC}/receipts`, { as: "ana" });
    expect(now.json.map((r: { title: string }) => r.title)).toEqual(["Money added", "August statement"]);
    expect(now.json[0]).toMatchObject({ kind: "prepayment", detail: "Bank transfer through Clear", amountMicros: 500_000_000 });
    vi.setSystemTime(new Date("2026-10-01T16:00:00Z"));
    const later = await api("GET", `/businesses/${OSC}/receipts`);
    expect(later.json[0]).toMatchObject({ title: "September statement", kind: "statement", detail: "118 airings, 1 sponsorship", amountMicros: 298_900_000 });
  });
  it("lists orders held as expenses", async () => {
    db.move(OSC, { kind: "order", label: "Held for Holiday gift cards", amountMicros: 140_000_000, detail: "Holiday gift cards, BEAT, held", hold: true });
    const r = await api("GET", `/businesses/${OSC}/receipts`);
    expect(r.json[0]).toMatchObject({ title: "Production order", kind: "expense", detail: "Holiday gift cards, BEAT, held", amountMicros: 140_000_000 });
  });
  it("won't remove the default source; the owner alone changes sources", async () => {
    const def = db.balanceOf(OSC).fundingSources[0]!;
    expect((await api("DELETE", `/businesses/${OSC}/funding-sources/${def.id}`)).status).toBe(409);
    // The seed has the frame's second source, Visa ending 4417 (biz-settings 03.1).
    expect(db.balanceOf(OSC).fundingSources.map((f) => f.id)).toContain(U(62002));
    expect((await api("POST", `/businesses/${OSC}/funding-sources/${U(62002)}/default`, { as: "tomas" })).status).toBe(403);
    const made = await api("POST", `/businesses/${OSC}/funding-sources/${U(62002)}/default`);
    expect(made.json.find((f: { isDefault: boolean }) => f.isDefault).id).toBe(U(62002));
    const removed = await api("DELETE", `/businesses/${OSC}/funding-sources/${def.id}`);
    expect(removed.json).toHaveLength(1);
  });
});

describe("connections", () => {
  it("connects a checkout with its secret, shows the owner where webhooks go, and disconnects", async () => {
    expect((await api("POST", `/businesses/${OSC}/connections/checkout`, { as: "tomas", body: { token: "whsec_test", provider: "stripe" } })).status).toBe(403);
    expect((await api("POST", `/businesses/${OSC}/connections/checkout`, { body: { token: "whsec_test" } })).status).toBe(400);
    const on = await api("POST", `/businesses/${OSC}/connections/checkout`, { body: { token: "whsec_test", provider: "stripe" } });
    expect(on.json.checkout).toMatchObject({ connected: true, provider: "stripe" });
    expect(on.json.checkout.webhookUrl).toMatch(/\/v1\/webhooks\/checkout\//);
    expect((await api("GET", `/businesses/${OSC}/connections`, { as: "tomas" })).json.checkout.webhookUrl).toBeNull();
    const off = await api("DELETE", `/businesses/${OSC}/connections/checkout`);
    expect(off.json.checkout).toMatchObject({ connected: false, provider: null });
  });
});

describe("closing the account", () => {
  it("is the owner's, takes the name, waits for orders being made, returns what's available and empties the team", async () => {
    expect((await api("POST", `/businesses/${OSC}/close`, { as: "tomas", body: { confirmName: "Orange Street Coffee" } })).status).toBe(403);
    expect((await api("POST", `/businesses/${OSC}/close`, { body: { confirmName: "Orange Street" } })).status).toBe(400);
    // Weekend brunch is delivered and waiting for review: approve or settle it first.
    const busy = await api("POST", `/businesses/${OSC}/close`, { body: { confirmName: "Orange Street Coffee" } });
    expect(busy.status).toBe(409);
    expect(busy.json.error.code).toBe("order_in_progress");
    const { getDeals } = await import("../fixtures/deals");
    for (const o of getDeals().orders) if (o.state === "delivered") o.state = "approved";
    const r = await api("POST", `/businesses/${OSC}/close`, { body: { confirmName: "orange street coffee" } });
    expect(r.json).toMatchObject({ returnedMicros: 412_500_000, heldMicros: 14_200_000 });
    expect(db.balanceOf(OSC).availableMicros).toBe(0);
    expect(db.getDb().members.filter((m) => m.businessId === OSC)).toHaveLength(0);
    expect((await api("GET", `/businesses/${OSC}`)).status).toBe(404);
  });
  it("won't send money back to a card", async () => {
    const bal = db.balanceOf(OSC);
    bal.fundingSources = bal.fundingSources.filter((f) => f.kind === "card");
    const { getDeals } = await import("../fixtures/deals");
    for (const o of getDeals().orders) if (o.state === "delivered") o.state = "approved";
    const r = await api("POST", `/businesses/${OSC}/close`, { body: { confirmName: "Orange Street Coffee" } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("no_source");
  });
});
