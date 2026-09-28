// A business's month, through the API, with the ledger checked at each step.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createHarness, itemFixture, market, stationFixture, testClip, type Harness, type User } from "./harness.js";

let h: Harness;
let jess: User; // Orange Street Coffee's owner
let kai: User; // BEAT's owner
let admin: User;
let businessId: string;
let beat: { id: string };
let bankId: string;
let cardId: string;
let spotId: string;

const $ = (dollars: number) => Math.round(dollars * 1_000_000);

async function balanceOfKind(kind: string, owner: { stationId?: string; advertiserId?: string } = {}) {
  const rows = await h.db.execute<{ sum: string }>(sql`
    select coalesce(sum(p.amount_micros), 0) as sum
    from ledger.postings p join ledger.accounts a on a.id = p.account_id
    where a.kind = ${kind}
      and (${owner.stationId ?? null}::uuid is null or a.station_id = ${owner.stationId ?? null}::uuid)
      and (${owner.advertiserId ?? null}::uuid is null or a.advertiser_id = ${owner.advertiserId ?? null}::uuid)`);
  return Number(rows.rows[0].sum);
}

async function asRun(stationId: string, airingId: string, startedAt: string, seconds: number) {
  const [row] = await h.db
    .insert(schema.asRun)
    .values({ stationId, code: "SPT", startedAt: new Date(startedAt), endedAt: new Date(Date.parse(startedAt) + seconds * 1000), airingId, reason: "rotation" })
    .returning();
  return row;
}

/** Tuned-in samples for a station: `n` people for every minute of a window. */
async function audience(stationId: string, from: string, minutes: number, n: number) {
  for (let i = 0; i < minutes; i++) {
    await h.db
      .insert(schema.minuteSamples)
      .values({ stationId, minute: new Date(Date.parse(from) + i * 60_000), tunedIn: n, web: n })
      .onConflictDoNothing();
  }
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-09-21T19:00:00.000Z"); // Monday noon in Los Angeles.
  const m = await market(h);
  kai = await h.signIn("Kai");
  jess = await h.signIn("Jess Lin");
  admin = await h.signIn("Dee", { admin: true });
  beat = await stationFixture(h, { callSign: "BEAT", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true });
  await h.db.update(schema.stations).set({ studioLatitude: 34.0556, studioLongitude: -117.1825, homeCity: "Redlands", category: "Music" }).where(eq(schema.stations.id, beat.id));
  // Last week's tuned in at 8 pm (03:00 UTC), when the spot will air: 262.
  await audience(beat.id, "2026-09-15T03:00:00.000Z", 60, 262);
}, 60_000);
afterAll(() => h.close());

describe("getting started", () => {
  it("a business signs up with where its customers are", async () => {
    const res = await jess
      .post("/v1/businesses", {
        name: "Orange Street Coffee",
        category: "Coffee and food",
        customersWhere: "location",
        locations: [{ kind: "location", streetAddress: "101 Orange St", city: "Redlands", latitude: 34.0558, longitude: -117.1817 }]
      })
      .expect(201);
    businessId = res.body.id;
    expect(res.body.locations[0]).toMatchObject({ city: "Redlands", streetAddress: "101 Orange St" });
  });

  it("links a bank and a card; card top-ups show Stripe's fee in dollars first", async () => {
    await jess.post(`/v1/businesses/${businessId}/funding-sources`, { kind: "clear_bank", token: "plaid-link-8810" }).expect(201);
    const sources = await jess.post(`/v1/businesses/${businessId}/funding-sources`, { kind: "card", token: "tok_visa_4417" }).expect(201);
    bankId = sources.body.find((s: { kind: string }) => s.kind === "clear_bank").id;
    cardId = sources.body.find((s: { kind: string }) => s.kind === "card").id;
    expect(sources.body.find((s: { kind: string }) => s.kind === "clear_bank")).toMatchObject({ label: "Bank ending 8810", isDefault: true });
    const quote = await jess.post(`/v1/businesses/${businessId}/deposits/quote`, { amountMicros: $(250), method: "card" }).expect(200);
    expect(quote.body).toMatchObject({ amountMicros: $(250), feeMicros: $(7.55), arrives: "Arrives right away" });
    const bank = await jess.post(`/v1/businesses/${businessId}/deposits/quote`, { amountMicros: $(250), method: "clear_bank" }).expect(200);
    expect(bank.body.feeMicros).toBe(0);
  });

  it("a bank transfer is pending until it arrives, and can be undone until then", async () => {
    const pending = await jess.post(`/v1/businesses/${businessId}/deposits`, { amountMicros: $(100), fundingSourceId: bankId }).expect(201);
    expect(pending.body.status).toBe("pending");
    expect(pending.body.balance).toMatchObject({ availableMicros: 0, pendingDeposits: [expect.objectContaining({ amountMicros: $(100) })] });
    const undone = await jess.post(`/v1/businesses/${businessId}/deposits/${pending.body.depositId}/cancel`).expect(200);
    expect(undone.body.pendingDeposits).toEqual([]);

    const real = await jess.post(`/v1/businesses/${businessId}/deposits`, { amountMicros: $(500), fundingSourceId: bankId }).expect(201);
    await h.services.ledger.completeDeposit(real.body.depositId);
    const balance = await jess.get(`/v1/businesses/${businessId}/balance`).expect(200);
    expect(balance.body).toMatchObject({ availableMicros: $(500), heldMicros: 0 });
  });

  it("a card top-up arrives right away; the fee is paid on top, never from the balance", async () => {
    await jess.post(`/v1/businesses/${businessId}/deposits`, { amountMicros: $(250), fundingSourceId: cardId }).expect(201);
    expect(await balanceOfKind("advertiser_available", { advertiserId: businessId })).toBe($(750));
    expect(await balanceOfKind("card_fees")).toBe($(7.55));
  });
});

describe("a spot", () => {
  it("is drafted, uploaded and checked", async () => {
    const res = await jess
      .post(`/v1/businesses/${businessId}/spots`, {
        title: "Fall menu",
        lengthSec: 30,
        category: "Food",
        rate: { kind: "per_thousand", micros: $(8) },
        budget: { totalMicros: $(300), dailyCapMicros: $(12) },
        targeting: { withinMiles: 10 },
        code: { code: "ORANGE10", offer: "10% off", windowDays: 7 }
      })
      .expect(201);
    spotId = res.body.id;
    expect(res.body.state).toBe("draft");
    const clip = await testClip(30);
    const uploaded = await jess.post(`/v1/spots/${spotId}/file`).attach("file", clip).expect(200);
    const checks = Object.fromEntries(uploaded.body.file.checks.map((c: { check: string; result: string }) => [c.check, c.result]));
    expect(checks).toMatchObject({ length: "fine", picture: "fixed", safe_area: "pending", captions: "pending", code: "fine" });
  }, 60_000);

  it("stations see who it reaches before it's listed", async () => {
    const matches = await jess.post(`/v1/spots/${spotId}/matches`, {}).expect(200);
    expect(matches.body.stations).toEqual([expect.objectContaining({ station: expect.objectContaining({ callSign: "BEAT" }), included: true, miles: 0 })]);
    const estimate = matches.body.stations[0].estimatedCostPerAiringMicros;
    expect(estimate.low).toBeLessThan($(2.1));
    expect(estimate.high).toBeGreaterThan($(2.1));
  });

  it("goes to review, and is listed once approved", async () => {
    await jess.post(`/v1/spots/${spotId}/submit`).expect(200);
    await jess.post(`/v1/review/spots/${spotId}`, { decision: "approve" }).expect(403);
    const listed = await admin.post(`/v1/review/spots/${spotId}`, { decision: "approve" }).expect(200);
    expect(listed.body.state).toBe("listed");
  });

  it("can't be listed without a day of its budget available", async () => {
    const poor = await h.signIn();
    const b = await poor.post("/v1/businesses", { name: "Poor Co", category: "Services", customersWhere: "online", marketIds: [(await h.db.select().from(schema.markets))[0].id] }).expect(201);
    const s = await poor.post(`/v1/businesses/${b.body.id}/spots`, { title: "X", lengthSec: 15, category: "Services", rate: { kind: "per_airing", micros: $(4) }, budget: { totalMicros: $(40) } }).expect(201);
    await h.db.insert(schema.spotFiles).values({ spotId: s.body.id, version: 1, location: "x", durationMs: 15_000 });
    await h.db.update(schema.spotsTable).set({ status: "in_review" }).where(eq(schema.spotsTable.id, s.body.id));
    const res = await admin.post(`/v1/review/spots/${s.body.id}`, { decision: "approve" }).expect(422);
    expect(res.body.error.message).toMatch(/doesn't cover a day/);
  });
});

describe("in a station's rotation", () => {
  let breakId: string;
  let airingId: string;

  it("the station sees it in its market, with a runway and never the balance", async () => {
    const market = await kai.get(`/v1/stations/${beat.id}/spot-market`).expect(200);
    expect(market.body).toEqual([
      expect.objectContaining({
        spot: expect.objectContaining({ title: "Fall menu", onScreen: "A code for 10% off" }),
        business: expect.objectContaining({ name: "Orange Street Coffee", city: "Redlands" }),
        runway: { kind: "days", days: expect.any(Number) },
        state: "in_the_market"
      })
    ]);
    expect(JSON.stringify(market.body)).not.toMatch(/available|balance|101 Orange/);
    await kai.put(`/v1/stations/${beat.id}/rotations/main`, { spotIds: [spotId] }).expect(200);
    const spot = await jess.get(`/v1/spots/${spotId}`).expect(200);
    expect(spot.body).toMatchObject({ state: "in_rotation", inRotationOn: 1 });
  });

  it("placing it in a break holds the money first", async () => {
    const show = await itemFixture(h, beat.id, { title: "Late Crate", durationMs: 28.5 * 60_000 });
    await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-09-22T03:00:00.000Z", endsAt: "2026-09-22T03:30:00.000Z", itemId: show.id }).expect(201);
    const [brk] = await h.services.log.ensureBreaks(beat.id, new Date("2026-09-22T03:00:00Z"), new Date("2026-09-22T04:00:00Z"));
    breakId = brk.id!;
    const placed = await h.services.spots.place({ spotId, stationId: beat.id, breakId, scheduledAt: new Date("2026-09-22T03:28:30Z") });
    airingId = placed.airingId;
    // Per thousand: held at an estimate from the station's usual 262 tuned in (262 × $8 ÷ 1,000).
    expect(placed.holdMicros).toBe(2_096_000);
    const balance = await jess.get(`/v1/businesses/${businessId}/balance`).expect(200);
    expect(balance.body).toMatchObject({ availableMicros: $(750) - 2_096_000, heldMicros: 2_096_000, heldAirings: 1 });
  });

  it("settles from the as-run log at the real tuned in; the difference comes back", async () => {
    await audience(beat.id, "2026-09-22T03:28:00.000Z", 2, 175);
    const run = await asRun(beat.id, airingId, "2026-09-22T03:28:30.000Z", 30);
    const settled = await h.services.spots.settleAiring({ airingId, asRunId: run.id, startedAt: run.startedAt, endedAt: run.endedAt });
    expect(settled).toEqual({ costMicros: 1_400_000, working: "175 × $8.00 ÷ 1,000 = $1.40" });
    expect(await balanceOfKind("station_earnings", { stationId: beat.id })).toBe(1_400_000);
    expect(await balanceOfKind("advertiser_available", { advertiserId: businessId })).toBe($(750) - 1_400_000);
    expect(await balanceOfKind("holds")).toBe(0);
  });

  it("an airing cut short is prorated; the unaired share goes back", async () => {
    const placed = await h.services.spots.place({ spotId, stationId: beat.id, breakId, scheduledAt: new Date("2026-09-22T03:29:00Z") });
    const run = await asRun(beat.id, placed.airingId, "2026-09-22T03:29:00.000Z", 12);
    const settled = await h.services.spots.settleAiring({ airingId: placed.airingId, asRunId: run.id, startedAt: run.startedAt, endedAt: run.endedAt });
    // :12 of :30 at 175 tuned in: $1.40 × 12/30 = $0.56.
    expect(settled.costMicros).toBe(560_000);
    expect(settled.working).toBe("175 × $8.00 ÷ 1,000 × 12/30s = $0.56");
    expect(await balanceOfKind("holds")).toBe(0);
  });

  it("the business reads every airing, from the as-run log, with its working", async () => {
    const results = await jess.get(`/v1/businesses/${businessId}/results?month=2026-09`).expect(200);
    expect(results.body.totals).toMatchObject({ airings: 2, spentMicros: 1_960_000 });
    expect(results.body.airings[0]).toMatchObject({ inFull: true, tunedIn: 175, programContext: "After Late Crate", working: "175 × $8.00 ÷ 1,000 = $1.40" });
    expect(results.body.airings[1]).toMatchObject({ inFull: false, airedMs: 12_000 });
  });
});

describe("when the money runs low", () => {
  it("withdrawing leaves held money held", async () => {
    const available = await balanceOfKind("advertiser_available", { advertiserId: businessId });
    await jess.post(`/v1/businesses/${businessId}/withdrawals`, { amountMicros: available + 1, fundingSourceId: bankId }).expect(422);
    await jess.post(`/v1/businesses/${businessId}/withdrawals`, { amountMicros: available - $(5), fundingSourceId: bankId }).expect(201);
    expect(await balanceOfKind("advertiser_available", { advertiserId: businessId })).toBe($(5));
  });

  it("a manager can add money but never take it out", async () => {
    const manager = await h.signIn("Sam");
    await h.db.insert(schema.advertiserMemberships).values({ advertiserId: businessId, userId: manager.id, role: "manager" });
    await manager.post(`/v1/businesses/${businessId}/withdrawals`, { amountMicros: $(1), fundingSourceId: bankId }).expect(403);
  });

  it("under a day of budget, the spot pauses and the stations are told", async () => {
    const events: string[] = [];
    h.deps.bus.on("spot.paused", (e) => void events.push(`${e.reason}:${e.stationIds.length}`));
    await h.services.spots.reviewBalance(businessId);
    await h.deps.bus.settle();
    expect(events).toEqual(["balance:1"]);
    const spot = await jess.get(`/v1/spots/${spotId}`).expect(200);
    expect(spot.body.state).toBe("paused_balance");
    const notices = await kai.get("/v1/me/notices").expect(200);
    expect(notices.body[0]).toMatchObject({ kind: "spot_paused", title: "Fall menu paused" });
  });

  it("topping up puts it back in the market; the station adds it back itself", async () => {
    await jess.post(`/v1/businesses/${businessId}/deposits`, { amountMicros: $(100), fundingSourceId: cardId }).expect(201);
    const spot = await jess.get(`/v1/spots/${spotId}`).expect(200);
    expect(spot.body.state).toBe("listed");
    const rotations = await kai.get(`/v1/stations/${beat.id}/rotations`).expect(200);
    expect(rotations.body.main.spots).toEqual([]);
    await h.deps.bus.settle();
    const notices = await kai.get("/v1/me/notices").expect(200);
    expect(notices.body[0]).toMatchObject({ kind: "spot_back", title: "Fall menu is back" });
  });

  it("a station is paid in full even when the business can't cover a per-thousand airing: Opencast absorbs the gap", async () => {
    await kai.put(`/v1/stations/${beat.id}/rotations/main`, { spotIds: [spotId] }).expect(200);
    const [brk] = await h.services.log.ensureBreaks(beat.id, new Date("2026-09-22T03:00:00Z"), new Date("2026-09-22T04:00:00Z"));
    const placed = await h.services.spots.place({ spotId, stationId: beat.id, breakId: brk.id!, scheduledAt: new Date("2026-09-22T03:29:30Z") });
    // Everything else is withdrawn, then the airing turns out far bigger than its hold.
    const available = await balanceOfKind("advertiser_available", { advertiserId: businessId });
    await jess.post(`/v1/businesses/${businessId}/withdrawals`, { amountMicros: available, fundingSourceId: bankId }).expect(201);
    await h.db.update(schema.minuteSamples).set({ tunedIn: 5000 }).where(eq(schema.minuteSamples.stationId, beat.id));
    const before = await balanceOfKind("station_earnings", { stationId: beat.id });
    const run = await asRun(beat.id, placed.airingId, "2026-09-22T03:29:30.000Z", 30);
    const settled = await h.services.spots.settleAiring({ airingId: placed.airingId, asRunId: run.id, startedAt: run.startedAt, endedAt: run.endedAt });
    expect(settled.costMicros).toBe($(40));
    expect((await balanceOfKind("station_earnings", { stationId: beat.id })) - before).toBe($(40));
    expect(await balanceOfKind("opencast_absorbed")).toBe(-($(40) - placed.holdMicros));
    expect(await balanceOfKind("advertiser_available", { advertiserId: businessId })).toBe(0);
  });
});

describe("sponsoring", () => {
  it("credit text is checked as it's typed and can't be sent until it passes", async () => {
    const check = await jess.post("/v1/sponsorships/credit-check", { text: "The best coffee in Redlands. Come by!" }).expect(200);
    expect(check.body.passes).toBe(false);
    await jess
      .post(`/v1/businesses/${businessId}/sponsorships`, { stationId: beat.id, monthlyMicros: $(125), creditText: "The best coffee in Redlands.", startsOn: "2026-09-01" })
      .expect(422);
  });

  it("the station approves; the month is held from the balance", async () => {
    await jess.post(`/v1/businesses/${businessId}/deposits`, { amountMicros: $(200), fundingSourceId: cardId }).expect(201);
    const offer = await jess
      .post(`/v1/businesses/${businessId}/sponsorships`, { stationId: beat.id, monthlyMicros: $(125), creditText: "Orange Street Coffee, roasting in Redlands.", startsOn: "2026-09-01" })
      .expect(201);
    expect(offer.body.state).toBe("requested");
    const approved = await kai.post(`/v1/sponsorships/${offer.body.id}/decision`, { decision: "approve" }).expect(200);
    expect(approved.body.state).toBe("credited");
    expect(await h.services.spots.creditsFor(beat.id)).toEqual([{ business: "Orange Street Coffee", creditText: "Orange Street Coffee, roasting in Redlands.", programId: null }]);
  });
});

describe("made for you", () => {
  it("order, quote, accept (held), deliver, changes, approve: the maker is paid and it's a spot", async () => {
    const studioOwner = await h.signIn("Studio");
    const studio = await studioOwner.post("/v1/stations", { kind: "studio", name: "Inland Creative", handle: "inland-creative" }).expect(201);
    const studioId = studio.body.station.id;
    const makers = await jess.get("/v1/makers").expect(200);
    expect(makers.body.map((m: { station: { id: string } }) => m.station.id)).toContain(studioId);

    await jess.post(`/v1/businesses/${businessId}/deposits`, { amountMicros: $(200), fundingSourceId: cardId }).expect(201);
    const order = await jess
      .post(`/v1/businesses/${businessId}/orders`, { makerStationId: studioId, title: "Pumpkin spice", lengthSec: 30, about: "Our fall drinks.", neededBy: "2026-10-15" })
      .expect(201);
    const orderId = order.body.id;
    await studioOwner.post(`/v1/orders/${orderId}/quote`, { action: "quote", priceMicros: $(140), deliverBy: "2026-10-01", roundsIncluded: 1, voicedBy: "Mara" }).expect(200);
    const accepted = await jess.post(`/v1/orders/${orderId}/accept`).expect(200);
    expect(accepted.body.state).toBe("accepted");
    const clip = await testClip(30);
    await studioOwner.post(`/v1/orders/${orderId}/deliveries`).attach("file", clip).expect(200);
    await jess.post(`/v1/orders/${orderId}/notes`, { timecodeMs: 6000, body: "Say it's in Redlands." }).expect(200);
    await jess.post(`/v1/orders/${orderId}/review`, { decision: "request_changes" }).expect(200);
    await studioOwner.post(`/v1/orders/${orderId}/deliveries`).attach("file", clip).expect(200);
    const done = await jess.post(`/v1/orders/${orderId}/review`, { decision: "approve", tellMakerWhenListed: true }).expect(200);
    expect(done.body).toMatchObject({ state: "approved", roundsUsed: 1 });
    expect(await balanceOfKind("station_earnings", { stationId: studioId })).toBe($(140));
    const spot = await jess.get(`/v1/spots/${done.body.spotId}`).expect(200);
    expect(spot.body).toMatchObject({ state: "draft", title: "Pumpkin spice", productionOrderId: orderId });
  }, 60_000);
});

describe("codes", () => {
  it("scans are counted; a use at the counter counts as a customer within the window after an airing", async () => {
    h.clock.set("2026-09-23T19:00:00.000Z"); // The day after the airings.
    await jess.post("/v1/c/ORANGE10/scan", { stationId: beat.id }).expect(200);
    const saved = await jess.post("/v1/c/ORANGE10/save", { stationId: beat.id, customerRef: "phone-1" }).expect(200);
    expect(saved.body.savedFrom).toMatchObject({ callSign: "BEAT" });
    const first = await jess.post(`/v1/businesses/${businessId}/redeem`, { code: "ORANGE10", customerRef: "phone-1" }).expect(200);
    expect(first.body).toMatchObject({ valid: true, firstUse: true, countsAsCustomer: true });
    const again = await jess.post(`/v1/businesses/${businessId}/redeem`, { code: "ORANGE10", customerRef: "phone-1" }).expect(200);
    expect(again.body).toMatchObject({ firstUse: false, countsAsCustomer: false });
    const station = await kai.get(`/v1/stations/${beat.id}/customers?month=2026-09`).expect(200);
    expect(station.body).toEqual([{ spotId, business: "Orange Street Coffee", customers: 1 }]);
  });
});

describe("a claimable station", () => {
  it("earns into what's owed to escrow, never a wallet", async () => {
    const lupe = await stationFixture(h, { callSign: "LUPE", kind: "claimable", signedOn: true });
    const [hold] = await h.db.select().from(schema.holds).limit(1);
    void hold;
    // A per-airing spot on the claimable station, settled.
    const [brk] = await h.db.insert(schema.breaks).values({ stationId: lupe.id, startsAt: new Date("2026-09-22T05:00:00Z"), lengthMs: 60_000, origin: "rule" }).returning();
    await jess.post(`/v1/businesses/${businessId}/deposits`, { amountMicros: $(50), fundingSourceId: cardId }).expect(201);
    const s = await jess.post(`/v1/businesses/${businessId}/spots`, { title: "Online", lengthSec: 15, category: "Food", rate: { kind: "per_airing", micros: $(4) }, budget: { totalMicros: $(40) } }).expect(201);
    await h.db.update(schema.spotsTable).set({ status: "listed" }).where(eq(schema.spotsTable.id, s.body.id));
    const placed = await h.services.spots.place({ spotId: s.body.id, stationId: lupe.id, breakId: brk.id, scheduledAt: brk.startsAt });
    const run = await asRun(lupe.id, placed.airingId, "2026-09-22T05:00:00.000Z", 15);
    await h.services.spots.settleAiring({ airingId: placed.airingId, asRunId: run.id, startedAt: run.startedAt, endedAt: run.endedAt });
    expect(await balanceOfKind("escrow_owed", { stationId: lupe.id })).toBe($(4));
    expect(await balanceOfKind("station_earnings", { stationId: lupe.id })).toBe(0);
  });
});
