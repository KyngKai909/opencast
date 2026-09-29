// The business app's requests (added 2026-09-29): editing a location in place (P26), the logo
// (P11), bands and category reach (P8, P9), the place lookup (P10), codes Opencast picks and one
// for every listed spot (P4, A116), a spot paused by hand (A115) and its story (P6, P5, P7), the
// Redeem tool (P12, B5), connections and checkout webhooks (P20), results by period and code (P13
// to P15, S1), statements, receipts and funding sources (E3 to E7), what a business can sponsor
// (P16, P17), makers and quotes (P18, P19), closing the account (P21), full playback addresses
// (A117) and scheduled sign-ons (A124).
import { createHmac } from "node:crypto";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { anon, createHarness, market, stationFixture, testClip, type Harness, type User } from "./harness.js";
import type { PlaceLookup } from "../src/v1/places.js";

const PUBLIC = "https://api.opencast.test";
let h: Harness;
let jess: User; // Orange Street Coffee's owner
let tomas: User; // its manager
let kai: User; // BEAT's owner
let dee: User; // an Opencast admin
let marketId: string;
let businessId: string;
let beatId: string;
let civcId: string;
let niteId: string;
let studioId: string;
let firstLocation: string;
let bank8810: string;
let spotA: string; // a code Opencast picked
let spotB: string; // listed without a code
let airingId: string;

const $ = (dollars: number) => Math.round(dollars * 1_000_000);

const places: PlaceLookup = {
  configured: true,
  async lookup(q) {
    if (/nowhere/i.test(q)) return null;
    return /orange st/i.test(q)
      ? { streetAddress: "204 Orange St", city: "Redlands", latitude: 34.0558, longitude: -117.1817 }
      : { streetAddress: null, city: "Colton", latitude: 34.0739, longitude: -117.3136 };
  }
};

async function squarePng(size: number, height = size) {
  const file = path.join(os.tmpdir(), `logo-${size}x${height}-${Date.now()}.png`);
  await sharp({ create: { width: size, height, channels: 3, background: "#9A5412" } }).png().toFile(file);
  return file;
}

beforeAll(async () => {
  h = await createHarness({ publicBase: PUBLIC, places });
  h.clock.set("2026-09-21T19:00:00.000Z"); // Monday noon in Los Angeles.
  const m = await market(h);
  marketId = m.id;
  await h.db.update(schema.markets).set({ latitude: "34.06", longitude: "-117.2" }).where(eq(schema.markets.id, marketId));
  kai = await h.signIn("Kai");
  jess = await h.signIn("Jess Lin");
  tomas = await h.signIn("Tomás");
  dee = await h.signIn("Dee", { admin: true });
  const redlands = { studioLatitude: 34.0556, studioLongitude: -117.1825, homeCity: "Redlands" };
  beatId = (await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId, tenths: 121, signedOn: true })).id;
  civcId = (await stationFixture(h, { callSign: "CIVC", name: "Civic", marketId, tenths: 71, signedOn: true })).id;
  niteId = (await stationFixture(h, { callSign: "NITE", name: "Nite", marketId, tenths: 883, band: "radio", signedOn: true })).id;
  studioId = (await stationFixture(h, { kind: "studio", name: "Opencast Studio" })).id;
  await h.db.update(schema.stations).set({ ...redlands, category: "Music" }).where(eq(schema.stations.id, beatId));
  await h.db.update(schema.stations).set({ ...redlands, category: "Public affairs" }).where(eq(schema.stations.id, civcId));
  await h.db.update(schema.stations).set({ ...redlands, category: "Music" }).where(eq(schema.stations.id, niteId));
  await h.db.insert(schema.blockedCategories).values([
    { stationId: civcId, category: "Alcohol" },
    { stationId: niteId, category: "Gambling" }
  ]);

  const business = await jess
    .post("/v1/businesses", {
      name: "Orange Street Coffee",
      category: "Coffee and food",
      customersWhere: "location",
      locations: [{ kind: "location", streetAddress: "204 Orange St", city: "Redlands", latitude: 34.0558, longitude: -117.1817 }],
      marketIds: [marketId]
    })
    .expect(201);
  businessId = business.body.id;
  firstLocation = business.body.locations[0].id;
  const invite = await jess.post(`/v1/businesses/${businessId}/team/invites`, { email: "tomas@example.com", role: "manager" }).expect((r) => expect([200, 201]).toContain(r.status));
  await h.db.update(schema.users).set({ email: "tomas@example.com" }).where(eq(schema.users.id, tomas.id));
  await tomas.post(`/v1/invites/${invite.body.id}/accept`).expect(200);

  const sources = await jess.post(`/v1/businesses/${businessId}/funding-sources`, { kind: "clear_bank", token: "plaid-link-8810" }).expect(201);
  bank8810 = sources.body[0].id;
  await jess.post(`/v1/businesses/${businessId}/funding-sources`, { kind: "card", token: "tok_visa_4417" }).expect(201);
  const deposit = await jess.post(`/v1/businesses/${businessId}/deposits`, { amountMicros: $(500), fundingSourceId: bank8810 }).expect(201);
  await h.services.ledger.completeDeposit(deposit.body.depositId);
}, 60_000);
afterAll(() => h.close());

describe("the business's profile", () => {
  it("edits a location in place: the first place stays first (P26)", async () => {
    await jess.post(`/v1/businesses/${businessId}/locations`, { kind: "location", streetAddress: "1 Main St", city: "Colton", latitude: 34.07, longitude: -117.31 }).expect(201);
    const moved = await tomas.patch(`/v1/businesses/${businessId}/locations/${firstLocation}`, { streetAddress: "210 Orange St" }).expect(200);
    expect(moved.body.locations.map((l: { id: string; streetAddress: string }) => [l.id === firstLocation, l.streetAddress])).toEqual([
      [true, "210 Orange St"],
      [false, "1 Main St"]
    ]);
    const noRadius = await jess.patch(`/v1/businesses/${businessId}/locations/${firstLocation}`, { kind: "service_area" }).expect(400);
    expect(noRadius.body.error.fields).toEqual({ radiusMiles: "Required" });
    const area = await jess.patch(`/v1/businesses/${businessId}/locations/${firstLocation}`, { kind: "service_area", radiusMiles: 10 }).expect(200);
    expect(area.body.locations[0]).toMatchObject({ kind: "service_area", radiusMiles: 10, streetAddress: null });
    const back = await jess.patch(`/v1/businesses/${businessId}/locations/${firstLocation}`, { kind: "location", streetAddress: "204 Orange St" }).expect(200);
    expect(back.body.locations[0]).toMatchObject({ kind: "location", radiusMiles: null });
  });

  it("takes a square logo, and draws a mark until then (P11)", async () => {
    const before = await jess.get(`/v1/businesses/${businessId}`).expect(200);
    expect(before.body).toMatchObject({ logoUrl: null, logoMark: { initials: "OSC", colour: expect.stringMatching(/^#/) }, redeemOn: true });
    const wide = await jess.post(`/v1/businesses/${businessId}/logo`).attach("file", await squarePng(400, 200)).expect(422);
    expect(wide.body.error.code).toBe("logo_size");
    const small = await jess.post(`/v1/businesses/${businessId}/logo`).attach("file", await squarePng(128)).expect(422);
    expect(small.body.error.code).toBe("logo_size");
    const text = path.join(os.tmpdir(), "not-a-logo.txt");
    await (await import("node:fs")).promises.writeFile(text, "hello");
    expect((await jess.post(`/v1/businesses/${businessId}/logo`).attach("file", text).expect(422)).body.error.code).toBe("not_an_image");
    const done = await tomas.post(`/v1/businesses/${businessId}/logo`).attach("file", await squarePng(300)).expect(200);
    // A117: a full address on the API's origin.
    expect(done.body.logoUrl).toMatch(new RegExp(`^${PUBLIC}/objects/`));
  });

  it("looks up an address, or says it can't (P10)", async () => {
    const found = await jess.get("/v1/places/lookup?q=204%20Orange%20St%2C%20Redlands").expect(200);
    expect(found.body).toEqual({ streetAddress: "204 Orange St", city: "Redlands", latitude: 34.0558, longitude: -117.1817, marketId });
    await jess.get("/v1/places/lookup?q=nowhere%20at%20all").expect(404);
    const saved = h.deps.places;
    h.deps.places = undefined;
    const off = await jess.get("/v1/places/lookup?q=Colton").expect(503);
    expect(off.body.error).toMatchObject({ code: "not_available", message: "Addresses can't be looked up here yet. Choose Online to go on." });
    h.deps.places = saved;
    await anon(h).get("/v1/places/lookup?q=Colton").expect(401);
  });

  it("says how many of a market's stations carry a category, and which block it (P9)", async () => {
    const reach = await jess.get(`/v1/markets/${marketId}/category-reach?category=Alcohol`).expect(200);
    expect(reach.body).toEqual({ category: "Alcohol", marketName: "Inland Empire", reached: 2, total: 3, blockedBy: ["CIVC"], sometimesBlocked: ["gambling"] });
  });
});

describe("spots", () => {
  it("a new spot's upload adds its code: Opencast's letters, until the business types its own (P4)", async () => {
    const res = await jess
      .post(`/v1/businesses/${businessId}/spots`, {
        title: "Fall menu",
        lengthSec: 30,
        category: "Coffee and food",
        rate: { kind: "per_airing", micros: $(4) },
        budget: { totalMicros: $(300), dailyCapMicros: $(12) },
        targeting: { withinMiles: 10, bands: ["tv"] }
      })
      .expect(201);
    spotA = res.body.id;
    expect(res.body.code).toBeNull();
    expect(res.body.targeting.bands).toEqual(["tv"]);
    expect(res.body).toMatchObject({ still: { stillUrl: null, label: "Fall menu", line: null }, inRotationStations: [], pause: null, back: null, pacePerDayMicros: null });
  });

  it("the radio band is left out when only TV is chosen (P8)", async () => {
    const matches = await jess.post(`/v1/spots/${spotA}/matches`, {}).expect(200);
    const nite = matches.body.stations.find((s: { station: { callSign: string } }) => s.station.callSign === "NITE");
    expect(nite).toMatchObject({ included: false, reason: "Radio band, not chosen" });
    expect(matches.body.stations.find((s: { station: { callSign: string } }) => s.station.callSign === "BEAT").included).toBe(true);
  });

  it("the upload's checks carry their second line, and the code's box and timing (P1, P4)", async () => {
    const uploaded = await jess.post(`/v1/spots/${spotA}/file`).attach("file", await testClip(30)).expect(200);
    expect(uploaded.body.code).toMatchObject({ code: "ORANGE10", offer: "Fall menu", pickedBy: "opencast", oncePerCustomer: true, savedForDays: 7, placement: "bottom_left", showsForLastMs: 10_000 });
    expect(uploaded.body.file.checks.find((c: { check: string }) => c.check === "code").label).toBe("Code ORANGE10 added");
    // The business names the offer, keeping Opencast's letters; letters it types are its own.
    const offer = await jess.patch(`/v1/spots/${spotA}`, { code: { code: "ORANGE10", offer: "10% off", windowDays: 7 } }).expect(200);
    expect(offer.body.code).toMatchObject({ code: "ORANGE10", offer: "10% off", pickedBy: "opencast" });
    const own = await jess.patch(`/v1/spots/${spotA}`, { code: { code: "FALLMENU", offer: "A free pastry", windowDays: 7 } }).expect(200);
    expect(own.body.code).toMatchObject({ code: "FALLMENU", offer: "A free pastry", pickedBy: "business" });
    expect(own.body.still.line).toBe("A free pastry");
    const again = await jess.post(`/v1/spots/${spotA}/file`).attach("file", await testClip(30)).expect(200);
    const code = again.body.file.checks.find((c: { check: string }) => c.check === "code");
    expect(code).toMatchObject({ label: "Code FALLMENU added", detail: { note: "With a QR, bottom left, for the last :10", placement: "bottom_left", box: { x: 0.1, y: 0.72, w: 0.2, h: 0.18 }, fromMs: 20_000, toMs: 30_000 } });
    expect(uploaded.body.file.checks.find((c: { check: string }) => c.check === "length").detail.note).toBe("Exactly a :30 spot");
    await jess.post(`/v1/spots/${spotA}/submit`).expect(200);
    await dee.post(`/v1/review/spots/${spotA}`, { decision: "approve" }).expect(200);
  }, 60_000);

  it("a spot listed without a code gets one (A116)", async () => {
    const res = await jess
      .post(`/v1/businesses/${businessId}/spots`, { title: "Pumpkin latte", lengthSec: 15, category: "Coffee and food", rate: { kind: "per_airing", micros: $(3) }, budget: { totalMicros: $(100), dailyCapMicros: null } })
      .expect(201);
    spotB = res.body.id;
    expect(res.body.code).toBeNull();
    await h.db.update(schema.spotsTable).set({ status: "in_review" }).where(eq(schema.spotsTable.id, spotB));
    const listed = await dee.post(`/v1/review/spots/${spotB}`, { decision: "approve" }).expect(200);
    expect(listed.body.state).toBe("listed");
    expect(listed.body.code).toMatchObject({ code: "ORANGE10", offer: "Pumpkin latte", pickedBy: "opencast", windowDays: 7 });
  });

  it("the stations it's in rotation on, and its pace (P5, P7)", async () => {
    await kai.put(`/v1/stations/${beatId}/rotations/main`, { spotIds: [spotA] }).expect(200);
    const [brk] = await h.db.insert(schema.breaks).values({ stationId: beatId, startsAt: new Date("2026-09-22T03:00:00.000Z"), lengthMs: 120_000, origin: "rule" }).returning();
    airingId = (await h.services.spots.place({ spotId: spotA, stationId: beatId, breakId: brk.id, scheduledAt: new Date("2026-09-22T03:00:00.000Z") })).airingId;
    const spot = await jess.get(`/v1/spots/${spotA}`).expect(200);
    expect(spot.body.state).toBe("in_rotation");
    expect(spot.body.inRotationStations.map((s: { callSign: string }) => s.callSign)).toEqual(["BEAT"]);
    expect(spot.body.pacePerDayMicros).toBe($(4));
  });

  it("a spot the business pauses waits for it, with its story; bringing it back tells the stations (A115, P6)", async () => {
    h.sent.length = 0;
    const paused = await tomas.post(`/v1/spots/${spotA}/pause`).expect(200);
    expect(paused.body.state).toBe("waiting_for_you");
    expect(paused.body.pause).toMatchObject({
      reason: "by_you",
      pausedAt: "2026-09-21T19:00:00.000Z",
      lastHold: { amountMicros: $(4), station: { callSign: "BEAT" } },
      held: { airings: 1, airedAt: null },
      stations: [{ station: { callSign: "BEAT" }, filledWith: "station_id", toldWhenBack: false }]
    });
    await h.deps.bus.settle();
    // The business isn't told what it did itself; BEAT is.
    const notices = await h.db.select().from(schema.notices).where(eq(schema.notices.kind, "spot_paused"));
    expect(notices.map((n) => n.scopeKind)).toEqual(["station"]);
    const market = await kai.get(`/v1/stations/${beatId}/spot-market`).expect(200);
    expect(market.body.find((m: { spot: { id: string } }) => m.spot.id === spotA)).toMatchObject({ state: "paused", pause: null });

    h.clock.advance(60_000);
    const back = await jess.post(`/v1/spots/${spotA}/resume`).expect(200);
    expect(back.body).toMatchObject({ state: "listed", pause: null, back: { reason: "resumed", backAt: "2026-09-21T19:01:00.000Z", told: [{ callSign: "BEAT" }] }, inRotationStations: [] });
    await kai.put(`/v1/stations/${beatId}/rotations/main`, { spotIds: [spotA] }).expect(200);
  });
});

describe("codes at the counter", () => {
  it("checks a code without counting it, then redeems it (B5, P12)", async () => {
    await anon(h).post("/v1/c/FALLMENU/save").send({ stationId: beatId, customerRef: "ana" }).expect(200);
    const today = await tomas.get(`/v1/businesses/${businessId}/redeem/today`).expect(200);
    expect(today.body).toEqual({ on: true, redeemedToday: 0, clearPay: false });
    const check = await tomas.post(`/v1/businesses/${businessId}/redeem/check`, { code: "fallmenu", customerRef: "ana" }).expect(200);
    expect(check.body).toMatchObject({ valid: true, firstUse: true, code: "FALLMENU", offer: "A free pastry", spotTitle: "Fall menu", savedAt: "2026-09-21T19:01:00.000Z", savedFrom: { callSign: "BEAT" }, redeemedToday: 0 });
    const bad = await tomas.post(`/v1/businesses/${businessId}/redeem/check`, { code: "NOPE1" }).expect(200);
    expect(bad.body).toMatchObject({ valid: false, message: "NOPE1 isn't one of your codes. Check it with the customer." });
    const used = await tomas.post(`/v1/businesses/${businessId}/redeem`, { code: "FALLMENU", customerRef: "ana" }).expect(200);
    expect(used.body).toMatchObject({ valid: true, firstUse: true, redeemedToday: 1 });
    const again = await tomas.post(`/v1/businesses/${businessId}/redeem/check`, { code: "FALLMENU", customerRef: "ana" }).expect(200);
    expect(again.body).toMatchObject({ firstUse: false, message: "Already used by this customer." });
  });

  it("the Redeem tool can be turned off (P12)", async () => {
    await jess.patch(`/v1/businesses/${businessId}`, { redeemOn: false }).expect(200);
    expect((await tomas.post(`/v1/businesses/${businessId}/redeem`, { code: "FALLMENU" }).expect(409)).body.error.code).toBe("redeem_off");
    expect((await tomas.get(`/v1/businesses/${businessId}/redeem/today`).expect(200)).body.on).toBe(false);
    await jess.patch(`/v1/businesses/${businessId}`, { redeemOn: true }).expect(200);
  });
});

describe("connections (P20)", () => {
  const SECRET = "shpss_test_secret";
  let hook: string;

  it("the owner connects Clear Pay and a checkout; managers can't", async () => {
    const none = await tomas.get(`/v1/businesses/${businessId}/connections`).expect(200);
    expect(none.body).toEqual({ clearPay: { connected: false, connectedAt: null }, checkout: { connected: false, provider: null, connectedAt: null, webhookUrl: null } });
    await tomas.post(`/v1/businesses/${businessId}/connections/checkout`, { token: SECRET, provider: "shopify" }).expect(403);
    await jess.post(`/v1/businesses/${businessId}/connections/checkout`, { token: SECRET }).expect(400);
    const res = await jess.post(`/v1/businesses/${businessId}/connections/checkout`, { token: SECRET, provider: "shopify" }).expect(200);
    expect(res.body.checkout).toMatchObject({ connected: true, provider: "shopify", webhookUrl: expect.stringMatching(new RegExp(`^${PUBLIC}/v1/webhooks/checkout/`)) });
    hook = new URL(res.body.checkout.webhookUrl).pathname;
    // Only the owner sees where the webhook goes.
    expect((await tomas.get(`/v1/businesses/${businessId}/connections`).expect(200)).body.checkout.webhookUrl).toBeNull();
    await jess.post(`/v1/businesses/${businessId}/connections/clear_pay`, { token: "clear-pay-token" }).expect(200);
    expect((await tomas.get(`/v1/businesses/${businessId}/redeem/today`).expect(200)).body.clearPay).toBe(true);
  });

  it("a signed order webhook counts each promotion code once", async () => {
    const order = JSON.stringify({ id: 820982911946154500, email: "sam@example.com", discount_codes: [{ code: "FALLMENU" }, { code: "SOMEONEELSE" }], processed_at: "2026-09-21T19:02:00.000Z" });
    const sig = createHmac("sha256", SECRET).update(order).digest("base64");
    const send = (signature: string) => anon(h).post(hook).set("content-type", "application/json").set("x-shopify-hmac-sha256", signature).set("x-shopify-webhook-id", "wh-1").send(order);
    expect((await send("bm90IHRoZSBzaWduYXR1cmU=").expect(400)).body.error.code).toBe("bad_signature");
    expect((await send(sig).expect(200)).body).toEqual({ received: true, counted: 1 });
    expect((await send(sig).expect(200)).body).toEqual({ received: true, counted: 0 });
    await anon(h).post("/v1/webhooks/checkout/not-a-connection").send("{}").expect(404);
  });

  it("Stripe's signature is checked with its timestamp", async () => {
    const { verified, readOrder } = await import("../src/v1/modules/spots/business.js");
    const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", created: 1790017200, data: { object: { customer: "cus_9", total_details: { breakdown: { discounts: [{ discount: { promotion_code: { code: "FALLMENU" } } }] } } } } });
    const t = Math.floor(h.clock.now().getTime() / 1000);
    const header = `t=${t},v1=${createHmac("sha256", "whsec_x").update(`${t}.${body}`).digest("hex")}`;
    expect(verified("stripe", "whsec_x", Buffer.from(body), { "stripe-signature": header }, "", h.clock.now())).toBe(true);
    expect(verified("stripe", "whsec_x", Buffer.from(body), { "stripe-signature": header }, "", new Date(h.clock.now().getTime() + 600_000))).toBe(false);
    expect(readOrder("stripe", JSON.parse(body), {})).toMatchObject({ ref: "evt_1", codes: ["FALLMENU"], customer: "cus_9" });
    const square = JSON.stringify({ event_id: "sq-1", data: { object: { order: { customer_id: "C1", discounts: [{ name: "FALLMENU" }] } } } });
    const url = "https://api.opencast.test/v1/webhooks/checkout/abc";
    expect(verified("square", "sqkey", Buffer.from(square), { "x-square-hmacsha256-signature": createHmac("sha256", "sqkey").update(url + square).digest("base64") }, url, h.clock.now())).toBe(true);
  });
});

describe("results (P13, P14, P15, S1)", () => {
  it("counts an airing, its proof, and each code's uses by how they were counted", async () => {
    h.clock.set("2026-09-22T03:10:00.000Z");
    const [run] = await h.db
      .insert(schema.asRun)
      .values({ stationId: beatId, code: "SPT", startedAt: new Date("2026-09-22T03:00:00.000Z"), endedAt: new Date("2026-09-22T03:00:20.000Z"), airingId, reason: "rotation", proofFrameUrl: "https://proof.test/1.jpg", proofFrameAt: new Date("2026-09-22T03:00:10.000Z") })
      .returning();
    await h.services.spots.settleAiring({ airingId, asRunId: run.id, startedAt: run.startedAt, endedAt: run.endedAt });
    const month = await jess.get(`/v1/businesses/${businessId}/results?month=2026-09`).expect(200);
    expect(month.body).toMatchObject({ period: "month", from: "2026-09-01", to: "2026-09-22" });
    expect(month.body.airings[0]).toMatchObject({ inFull: false, shortReason: "The break was cut short", proofCapturedAt: "2026-09-22T03:00:10.000Z", costMicros: 2_666_667 });
    expect(month.body.byStation[0]).toMatchObject({ station: { callSign: "BEAT" }, category: "Music" });
    const fall = month.body.codes.find((c: { code: string }) => c.code === "FALLMENU");
    expect(fall).toMatchObject({ offer: "A free pastry", saves: 1, uses: 2, usesBy: { clearPay: 0, marked: 1, online: 1 }, savedMostFrom: { callSign: "BEAT" }, oncePerCustomer: true, savedForDays: 7 });
    const week = await jess.get(`/v1/businesses/${businessId}/results?month=2026-09&period=week&week=2026-09-23`).expect(200);
    expect(week.body).toMatchObject({ period: "week", from: "2026-09-20", totals: { airings: 1 } });
    const all = await jess.get(`/v1/businesses/${businessId}/results?month=2026-09&period=all`).expect(200);
    expect(all.body).toMatchObject({ period: "all", from: "2026-09-22", totals: { airings: 1 } });
    // The spot's still is the proof frame now.
    expect((await jess.get(`/v1/spots/${spotA}`).expect(200)).body.still.stillUrl).toBe("https://proof.test/1.jpg");
  });
});

describe("money for the books (E3 to E7)", () => {
  it("this month's statement counts the balance and what's held, with spent by spot and station (E3)", async () => {
    const list = await jess.get(`/v1/businesses/${businessId}/statements`).expect(200);
    const [now] = list.body;
    expect(now).toMatchObject({ period: "month", periodStart: "2026-09-01", periodEnd: "2026-09-30", inProgress: true, asOf: "2026-09-22", finalOn: "2026-10-01", openingMicros: 0 });
    const kinds = now.lines.map((l: { group: string; kind: string }) => `${l.group}:${l.kind}`);
    expect(kinds).toEqual(["balance:added", "balance:aired", "balance:returned", "balance:fees", "spent:spot_station"]);
    expect(now.lines[1]).toMatchObject({ label: "Spent on airings", amountMicros: -2_666_667, airings: 1 });
    expect(now.lines[4]).toMatchObject({ label: "Fall menu on BEAT 12.1", amountMicros: 2_666_667, airings: 1 });
    const balance = await jess.get(`/v1/businesses/${businessId}/balance`).expect(200);
    expect(now.closingMicros).toBe($(500) - 2_666_667);
    expect(now.closingAvailableMicros).toBe(balance.body.availableMicros);
    expect(now.closingHeldMicros).toBe(balance.body.heldMicros);
    const csv = await jess.get(now.csvUrl).expect(200);
    expect(csv.body.csv).toContain("Added");
    expect(now.pdfUrl).toMatch(new RegExp(`^${PUBLIC}/v1/receipts/`));
  });

  it("every receipt has a PDF at a signed link (E4)", async () => {
    const list = await jess.get(`/v1/businesses/${businessId}/receipts`).expect(200);
    expect(list.body).toEqual([expect.objectContaining({ kind: "prepayment", title: "Money added", amountMicros: $(500), detail: "Bank transfer through Clear, Bank ending 8810" })]);
    const url = new URL(list.body[0].pdfUrl);
    const pdf = await anon(h)
      .get(`${url.pathname}${url.search}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect((pdf.body as Buffer).toString("latin1").startsWith("%PDF-1.4")).toBe(true);
    await anon(h).get(`${url.pathname}?sig=0000`).expect(404);
    await anon(h).get(url.pathname.replace(list.body[0].id, "00000000-0000-4000-8000-000000000000") + url.search).expect(404);
  });

  it("chooses the default funding source, and never removes it (E5)", async () => {
    const added = await jess.post(`/v1/businesses/${businessId}/funding-sources`, { kind: "clear_bank", token: "plaid-link-2231" }).expect(201);
    const bank2231 = added.body.find((s: { label: string }) => s.label === "Bank ending 2231").id;
    await tomas.post(`/v1/businesses/${businessId}/funding-sources/${bank2231}/default`).expect(403);
    const sources = await jess.post(`/v1/businesses/${businessId}/funding-sources/${bank2231}/default`).expect(200);
    expect(sources.body.filter((s: { isDefault: boolean }) => s.isDefault).map((s: { id: string }) => s.id)).toEqual([bank2231]);
    expect((await jess.delete(`/v1/businesses/${businessId}/funding-sources/${bank2231}`).expect(409)).body.error.code).toBe("default_source");
    const left = await jess.delete(`/v1/businesses/${businessId}/funding-sources/${bank8810}`).expect(200);
    expect(left.body.map((s: { label: string }) => s.label).sort()).toEqual(["Bank ending 2231", "Visa ending 4417"]);
  });

  it("the airings estimate says what it's based on (E6), and the balance where to send USDC (E7)", async () => {
    const quote = await jess.post(`/v1/businesses/${businessId}/deposits/quote`, { amountMicros: $(35), method: "clear_bank" }).expect(200);
    expect(quote.body).toMatchObject({ roughAirings: 10, basis: { rateKind: "per_airing", rateMicros: $(3.5), station: null } });
    const balance = await jess.get(`/v1/businesses/${businessId}/balance`).expect(200);
    expect(balance.body.depositAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

describe("sponsoring and making (P16 to P19)", () => {
  it("lists the stations and programs near it that take sponsors (P16)", async () => {
    const program = await kai.post(`/v1/stations/${beatId}/programs`, { title: "Beat Tape Live", live: true }).expect(201);
    await kai.put(`/v1/stations/${beatId}/sponsorship-settings`, [
      { programId: null, minMonthlyMicros: $(100), maxSponsors: 3, closed: false },
      { programId: program.body.id, minMonthlyMicros: $(75), maxSponsors: 2, closed: false }
    ]).expect(200);
    await h.db.insert(schema.sponsorshipSettings).values({ stationId: civcId, programId: null, minMonthlyMicros: 0, maxSponsors: 0, closed: true });
    const res = await tomas.get(`/v1/businesses/${businessId}/sponsor-targets`).expect(200);
    expect(res.body.near).toBe("Redlands");
    const beat = res.body.targets.filter((t: { station: { callSign: string } }) => t.station.callSign === "BEAT");
    expect(beat).toEqual([
      expect.objectContaining({ program: null, schedule: "Credited in every break, 24 hours", minMonthlyMicros: $(100), maxSponsors: 3, sponsors: 0, where: "In every one of BEAT's breaks" }),
      expect.objectContaining({ program: { id: program.body.id, title: "Beat Tape Live" }, minMonthlyMicros: $(75), maxSponsors: 2, where: "In BEAT's breaks during the program", programFormat: expect.stringMatching(/live/i) })
    ]);
    // CIVC closed itself to sponsors; NITE set nothing: no minimum, no limit.
    expect(res.body.targets.some((t: { station: { callSign: string } }) => t.station.callSign === "CIVC")).toBe(false);
    expect(res.body.targets.find((t: { station: { callSign: string } }) => t.station.callSign === "NITE")).toMatchObject({ minMonthlyMicros: 0, maxSponsors: null });
    await anon(h).get(`/v1/businesses/${businessId}/sponsor-targets`).expect(401);
  });

  it("the credit check names the part that passes (P17)", async () => {
    const res = await anon(h).post("/v1/sponsorships/credit-check").send({ text: "A family coffee house on Orange Street, the best in Redlands" }).expect(200);
    expect(res.body.passes).toBe(false);
    expect(res.body.flags[0].quote).toBe(res.body.flags[0].text);
    expect(res.body.who).not.toContain(res.body.flags[0].text);
    expect(res.body.who).toContain("A family coffee house on Orange Street");
  });

  it("makers say what they made for the business; quotes and refunds are dated (P18, P19)", async () => {
    const order = await jess.post(`/v1/businesses/${businessId}/orders`, { makerStationId: studioId, title: "Holiday", lengthSec: 30, about: "Gift cards", neededBy: "2026-10-20" }).expect(201);
    await h.db.insert(schema.stationMemberships).values({ stationId: studioId, userId: dee.id, role: "owner" });
    const quoted = await dee.post(`/v1/orders/${order.body.id}/quote`, { action: "quote", priceMicros: $(90), deliverBy: "2026-10-01", roundsIncluded: 1, voicedBy: null }).expect(200);
    expect(quoted.body).toMatchObject({ quotedAt: "2026-09-22T03:10:00.000Z", approvedAt: null, refundedMicros: 0 });
    const makers = await jess.get(`/v1/makers?businessId=${businessId}`).expect(200);
    expect(makers.body.find((m: { station: { id: string } }) => m.station.id === studioId)).toMatchObject({ history: null, specialty: "Any category" });
    await kai.get(`/v1/makers?businessId=${businessId}`).expect(404);
    await jess.post(`/v1/orders/${order.body.id}/accept`).expect(200);
  });
});

describe("closing the account (P21)", () => {
  it("waits for an order being made, then closes: spots end, money goes back, the team loses access", async () => {
    const [order] = await h.db.select().from(schema.productionOrders).where(eq(schema.productionOrders.advertiserId, businessId));
    expect((await jess.post(`/v1/businesses/${businessId}/close`, { confirmName: "Orange Street Coffee" }).expect(409)).body.error.code).toBe("order_in_progress");
    // The delivery date passes with nothing delivered: the hold comes back.
    h.clock.set("2026-10-02T19:00:00.000Z");
    const cancelled = await jess.post(`/v1/orders/${order.id}/cancel`).expect(200);
    expect(cancelled.body.refundedMicros).toBe($(90));

    // One more airing is placed (held) before closing.
    const [brk] = await h.db.insert(schema.breaks).values({ stationId: beatId, startsAt: new Date("2026-10-03T03:00:00.000Z"), lengthMs: 120_000, origin: "rule" }).returning();
    const held = await h.services.spots.place({ spotId: spotA, stationId: beatId, breakId: brk.id, scheduledAt: new Date("2026-10-03T03:00:00.000Z") });

    await tomas.post(`/v1/businesses/${businessId}/close`, { confirmName: "Orange Street Coffee" }).expect(403);
    const wrong = await jess.post(`/v1/businesses/${businessId}/close`, { confirmName: "Orange" }).expect(400);
    expect(wrong.body.error.message).toBe("Type Orange Street Coffee to close it.");
    const before = await jess.get(`/v1/businesses/${businessId}/balance`).expect(200);
    const closed = await jess.post(`/v1/businesses/${businessId}/close`, { confirmName: "orange street coffee" }).expect(200);
    expect(closed.body).toEqual({ closedAt: "2026-10-02T19:00:00.000Z", returnedMicros: before.body.availableMicros, heldMicros: held.holdMicros });

    await jess.get(`/v1/businesses/${businessId}`).expect(404);
    expect((await jess.get("/v1/me").expect(200)).body.memberships).toEqual([]);
    const spots = await h.db.select({ status: schema.spotsTable.status }).from(schema.spotsTable).where(eq(schema.spotsTable.advertiserId, businessId));
    expect(spots.every((s) => s.status === "ended")).toBe(true);
    expect((await kai.get(`/v1/stations/${beatId}/rotations`).expect(200)).body.main.spots).toEqual([]);

    // The held airing never airs: its hold comes back, then follows the rest.
    h.clock.set("2026-10-03T05:00:00.000Z");
    await h.services.spots.releaseUnaired();
    expect(await h.services.ledger.sweepClosedBusinesses()).toBe(1);
    const after = await h.services.ledger.balance(businessId);
    expect(after).toMatchObject({ availableMicros: 0, heldMicros: 0 });
  });
});

describe("the platform's fixes", () => {
  it("playback addresses are full URLs on the API's origin (A117)", async () => {
    await h.db.insert(schema.playoutState).values({ stationId: civcId, onAir: true }).onConflictDoNothing();
    const status = await h.services.playout.statusFor([civcId]);
    // The channel's master playlist (prepare once, then assemble).
    expect(status.get(civcId)?.playbackUrl).toBe(`${PUBLIC}/hls/${civcId}/master.m3u8`);
  });

  it("a claimable station signs on at its scheduled time, and its creator is on air (A124)", async () => {
    const crate = await stationFixture(h, { kind: "claimable", callSign: "CRTE", name: "Crate", marketId, tenths: 381 });
    const shelf = await stationFixture(h, { kind: "claimable", callSign: "SHLF", name: "Shelf", marketId, tenths: 391 });
    const [creator] = await h.db
      .insert(schema.creators)
      .values({ marketId, displayName: "Crate Diggers", sourcePlatform: "vimeo", sourceUrl: "https://vimeo.com/crate", stage: "setting_up", stationId: crate.id, nextAction: "Sign on" })
      .returning();
    await h.services.playout.scheduleSignOn(crate.id, new Date("2026-10-03T04:00:00.000Z"));
    await h.services.playout.scheduleSignOn(shelf.id, new Date("2026-10-03T04:30:00.000Z"));
    // Crate's log is ready (the checks pass); Shelf's isn't.
    const checks = h.services.playout.checks;
    h.services.playout.checks = async (stationId) => (stationId === crate.id ? { ready: true, checks: [] } : checks(stationId));
    try {
      const result = await h.services.playout.runDueSignOns();
      expect(result).toEqual({ signedOn: 1, notReady: 1 });
      expect(await h.services.playout.runDueSignOns()).toEqual({ signedOn: 0, notReady: 0 });
    } finally {
      h.services.playout.checks = checks;
    }
    await h.deps.bus.settle();
    const [station] = await h.db.select().from(schema.stations).where(eq(schema.stations.id, crate.id));
    expect(station.status).toBe("on_air");
    const [row] = await h.db.select().from(schema.creators).where(eq(schema.creators.id, creator.id));
    expect(row).toMatchObject({ stage: "on_air", nextAction: "Claim invite" });
    const [other] = await h.db.select().from(schema.stations).where(eq(schema.stations.id, shelf.id));
    expect(other.status).toBe("setting_up");
  });
});

describe("the place lookup's answers (P10)", () => {
  it("reads Nominatim's, Mapbox's, Google's and a plain answer", async () => {
    const { parsePlace } = await import("../src/v1/places.js");
    expect(parsePlace([{ lat: "34.0558", lon: "-117.1817", address: { house_number: "204", road: "Orange Street", city: "Redlands" } }])).toEqual({
      streetAddress: "204 Orange Street",
      city: "Redlands",
      latitude: 34.0558,
      longitude: -117.1817
    });
    expect(parsePlace([{ lat: "34.07", lon: "-117.31", address: { town: "Colton" } }])).toMatchObject({ streetAddress: null, city: "Colton" });
    expect(parsePlace({ features: [{ center: [-117.18, 34.05], place_type: ["address"], address: "204", text: "Orange St", context: [{ id: "place.1", text: "Redlands" }] }] })).toEqual({
      streetAddress: "204 Orange St",
      city: "Redlands",
      latitude: 34.05,
      longitude: -117.18
    });
    expect(
      parsePlace({
        results: [{ geometry: { location: { lat: 34.05, lng: -117.18 } }, address_components: [{ long_name: "204", types: ["street_number"] }, { long_name: "Orange St", types: ["route"] }, { long_name: "Redlands", types: ["locality"] }] }]
      })
    ).toMatchObject({ streetAddress: "204 Orange St", city: "Redlands" });
    expect(parsePlace({ latitude: 34.05, longitude: -117.18, city: "Redlands" })).toMatchObject({ streetAddress: null, city: "Redlands" });
    expect(parsePlace([])).toBeNull();
    expect(parsePlace({ results: [] })).toBeNull();
  });
});
