// Counting and billing relay viewers (follow-up Phase 3), through the services and the API with fake
// YouTube and Twitch. BEAT relays to both; the same $8-per-thousand spot is bought by an online
// business (Clicky Shop) and a local one (Orange Street Coffee, Redlands, within 10 miles).
//
// - Online: Opencast viewers plus every relay viewer, settled once the platforms' counts are in.
// - Local: Opencast viewers placed inside the area; YouTube's relay viewers only for the share its
//   viewer geography places inside the area, settled when that data arrives; Twitch never; no
//   location data, not billed; none within 7 days, returned to the balance.
// The ledger balances at every step, and nothing is left held.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { schema } from "@opencast/db";
import { createHarness, market, stationFixture, type Harness, type User } from "./harness.js";
import { fakePlatforms, type FakePlatforms } from "../src/v1/modules/platforms/fake.js";
import { secretBox } from "../src/v1/modules/platforms/secrets.js";

let h: Harness;
let fake: FakePlatforms;
let kai: User; // BEAT's owner
let jess: User; // Orange Street Coffee (local)
let lee: User; // Clicky Shop (online)
let beat: { id: string };
let ie: string; // Inland Empire, BEAT's market
let la: string; // Los Angeles, not in Orange's area
let orange: string;
let clicky: string;
let orangeSpot: string;
let clickySpot: string;
let flatSpot: string;
let youtube: string;
let twitch: string;
const airings: Record<string, { airingId: string; holdMicros: number }> = {};

const $ = (dollars: number) => Math.round(dollars * 1_000_000);
const at = (iso: string) => new Date(iso);

async function balanceOfKind(kind: string, owner: { stationId?: string; advertiserId?: string } = {}) {
  const rows = await h.db.execute<{ sum: string }>(sql`
    select coalesce(sum(p.amount_micros), 0) as sum
    from ledger.postings p join ledger.accounts a on a.id = p.account_id
    where a.kind = ${kind}
      and (${owner.stationId ?? null}::uuid is null or a.station_id = ${owner.stationId ?? null}::uuid)
      and (${owner.advertiserId ?? null}::uuid is null or a.advertiser_id = ${owner.advertiserId ?? null}::uuid)`);
  return Number(rows.rows[0].sum);
}

/** Every entry balances, and the whole ledger adds up to nothing. */
async function ledgerBalances() {
  const unbalanced = await h.db.execute<{ n: string }>(sql`select count(*) as n from (select entry_id from ledger.postings group by entry_id having sum(amount_micros) <> 0) x`);
  const total = await h.db.execute<{ sum: string }>(sql`select coalesce(sum(amount_micros), 0) as sum from ledger.postings`);
  expect(Number(unbalanced.rows[0].n)).toBe(0);
  expect(Number(total.rows[0].sum)).toBe(0);
}

async function signIn(provider: "youtube" | "twitch", account: string, accountId: string) {
  const start = await kai.post(`/v1/stations/${beat.id}/platforms/oauth/${provider}/start`, {}).expect(200);
  const code = `code-${randomBytes(4).toString("hex")}`;
  fake.codes.set(code, { account, accountId });
  await request(h.app).get(`/v1/platforms/oauth/${provider}/callback?state=${new URL(start.body.url).searchParams.get("state")}&code=${code}`).expect(302);
}

/** Opencast's viewers for a minute: `total` tuned in, of them placed by market (the rest can't be placed). */
async function opencastViewers(minute: string, total: number, placed: Record<string, number>) {
  await h.db.insert(schema.minuteSamples).values({ stationId: beat.id, minute: at(minute), tunedIn: total, web: total }).onConflictDoNothing();
  for (const [marketId, n] of Object.entries(placed)) await h.db.insert(schema.minuteMarkets).values({ stationId: beat.id, minute: at(minute), marketId, tunedIn: n }).onConflictDoNothing();
}

async function listedSpot(advertiserId: string, title: string, rate: { kind: "per_thousand" | "per_airing"; micros: number }, withinMiles: number | null = null) {
  const [spot] = await h.db
    .insert(schema.spotsTable)
    .values({ advertiserId, title, lengthSec: 30, category: "Food", status: "listed", rateKind: rate.kind, rateMicros: rate.micros, totalBudgetMicros: $(50), listedAt: h.clock.now() })
    .returning();
  await h.db.insert(schema.targeting).values({ spotId: spot.id, withinMiles });
  return spot.id;
}

async function breakAt(iso: string) {
  const [brk] = await h.db.insert(schema.breaks).values({ stationId: beat.id, startsAt: at(iso), lengthMs: 120_000, origin: "rule" }).returning();
  return brk.id;
}

/** Places a spot, airs it (the as-run log) and settles it for Opencast's viewers. */
async function air(key: string, spotId: string, breakId: string, startedAt: string) {
  const placed = await h.services.spots.place({ spotId, stationId: beat.id, breakId, scheduledAt: at(startedAt) });
  const [run] = await h.db
    .insert(schema.asRun)
    .values({ stationId: beat.id, code: "SPT", startedAt: at(startedAt), endedAt: new Date(Date.parse(startedAt) + 30_000), airingId: placed.airingId, breakId, reason: "rotation" })
    .returning();
  const settled = await h.services.spots.settleAiring({ airingId: placed.airingId, asRunId: run.id, startedAt: run.startedAt, endedAt: run.endedAt });
  airings[key] = placed;
  return { ...placed, ...settled };
}

async function charges(airingId: string) {
  return h.db.select().from(schema.relayCharges).where(eq(schema.relayCharges.airingId, airingId)).orderBy(schema.relayCharges.platform);
}
const open = async (key: string) => {
  const [a] = await h.db.select({ holdId: schema.airings.holdId }).from(schema.airings).where(eq(schema.airings.id, airings[key].airingId));
  return (await h.services.ledger.openAmount([a.holdId])).get(a.holdId) ?? 0;
};

beforeAll(async () => {
  fake = fakePlatforms();
  h = await createHarness({ platforms: { providers: fake, secrets: secretBox({ id: "t", key: randomBytes(32) }) }, publicBase: "https://api.opencast.test" });
  h.clock.set("2026-10-05T19:00:00.000Z"); // Monday noon in Los Angeles
  ie = (await market(h)).id;
  la = (await market(h, "los-angeles", "Los Angeles")).id;
  kai = await h.signIn("Kai");
  jess = await h.signIn("Jess Lin");
  lee = await h.signIn("Lee");
  beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: ie, tenths: 121, signedOn: true });
  await h.db.update(schema.stations).set({ studioLatitude: 34.0556, studioLongitude: -117.1825, homeCity: "Redlands" }).where(eq(schema.stations.id, beat.id));

  const o = await jess
    .post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "location", locations: [{ kind: "location", streetAddress: "101 Orange St", city: "Redlands", latitude: 34.0558, longitude: -117.1817 }] })
    .expect(201);
  orange = o.body.id;
  const c = await lee.post("/v1/businesses", { name: "Clicky Shop", category: "Retail", customersWhere: "online", marketIds: [ie] }).expect(201);
  clicky = c.body.id;
  for (const [user, id] of [
    [jess, orange],
    [lee, clicky]
  ] as const) {
    const sources = await user.post(`/v1/businesses/${id}/funding-sources`, { kind: "card", token: "tok_visa_4417" }).expect(201);
    await user.post(`/v1/businesses/${id}/deposits`, { amountMicros: $(100), fundingSourceId: sources.body[0].id }).expect(201);
  }
  orangeSpot = await listedSpot(orange, "Fall menu", { kind: "per_thousand", micros: $(8) }, 10);
  clickySpot = await listedSpot(clicky, "Free shipping", { kind: "per_thousand", micros: $(8) });
  flatSpot = await listedSpot(clicky, "Flat rate", { kind: "per_airing", micros: $(3) });

  // BEAT relays to YouTube and Twitch, both signed in.
  await signIn("youtube", "Inland Beat channel", "UC-beat");
  await signIn("twitch", "InlandBeat", "tw-42");
  const destinations = await h.services.platforms.destinationsFor(beat.id);
  youtube = destinations.find((d) => d.kind === "youtube")!.platformId;
  twitch = destinations.find((d) => d.kind === "twitch")!.platformId;

  // Last Monday evening at 8 pm (03:00 UTC), which prices the holds: 100 on Opencast, 200 on YouTube, 50 on Twitch.
  for (let i = 0; i < 60; i++) {
    const minute = new Date(Date.parse("2026-10-05T03:00:00Z") + i * 60_000);
    await h.db.insert(schema.minuteSamples).values({ stationId: beat.id, minute, tunedIn: 100, web: 100 });
    await h.db.insert(schema.platformViewerSamples).values([
      { platformId: youtube, stationId: beat.id, kind: "youtube", minute, viewers: 200, broadcastRef: "yt-video-0" },
      { platformId: twitch, stationId: beat.id, kind: "twitch", minute, viewers: 50, broadcastRef: "tw-old" }
    ]);
  }
}, 60_000);
afterAll(() => h.close());

describe("where Opencast's viewers are", () => {
  it("a session is placed once, by the viewer's chosen market, and counted by market each minute", async () => {
    const viewer = await h.signIn("Viewer");
    await h.services.accounts.updateMe(viewer.id, { marketId: la });
    const sessionId = crypto.randomUUID();
    h.clock.set("2026-10-05T20:00:05.000Z");
    const beatBody = { stationId: beat.id, sessionId, platform: "web", playing: true };
    await viewer.post("/v1/heartbeat", { ...beatBody, mediaTimeMs: 0 }).expect(200);
    h.clock.set("2026-10-05T20:00:35.000Z");
    await viewer.post("/v1/heartbeat", { ...beatBody, mediaTimeMs: 30_000 }).expect(200);
    const [session] = await h.db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
    expect(session.marketId).toBe(la);
    const placed = await h.db.select().from(schema.minuteMarkets).where(and(eq(schema.minuteMarkets.stationId, beat.id), eq(schema.minuteMarkets.minute, at("2026-10-05T20:00:00Z"))));
    expect(placed).toEqual([expect.objectContaining({ marketId: la, tunedIn: 1 })]);
    // Signed out with no location lookup set up: counted as tuned in, but not placed.
    const anon = crypto.randomUUID();
    await request(h.app).post("/v1/heartbeat").send({ ...beatBody, sessionId: anon, mediaTimeMs: 0 }).expect(200);
    const [s2] = await h.db.select().from(schema.sessions).where(eq(schema.sessions.id, anon));
    expect(s2.marketId).toBeNull();
  });
});

describe("the hold", () => {
  it("covers Opencast's viewers plus an estimate for the relay share (local: YouTube's only); flat spots are unaffected", async () => {
    h.clock.set("2026-10-05T19:00:00.000Z");
    const brk = await breakAt("2026-10-06T03:00:00Z");
    const online = await h.services.spots.place({ spotId: clickySpot, stationId: beat.id, breakId: brk, scheduledAt: at("2026-10-06T03:00:00Z") });
    const local = await h.services.spots.place({ spotId: orangeSpot, stationId: beat.id, breakId: brk, scheduledAt: at("2026-10-06T03:00:30Z") });
    const flat = await h.services.spots.place({ spotId: flatSpot, stationId: beat.id, breakId: brk, scheduledAt: at("2026-10-06T03:01:00Z") });
    // 100 × $8 ÷ 1,000 = $0.80 for Opencast; relays: (200 + 50) → $2.00 online, 200 → $1.60 local.
    expect(online.holdMicros).toBe($(2.8));
    expect(local.holdMicros).toBe($(2.4));
    expect(flat.holdMicros).toBe($(3));
    const rows = await h.db.select().from(schema.airings).where(inArray(schema.airings.id, [online.airingId, local.airingId, flat.airingId]));
    expect(Object.fromEntries(rows.map((r) => [r.id, r.relayEstimateMicros]))).toEqual({ [online.airingId]: $(2), [local.airingId]: $(1.6), [flat.airingId]: 0 });
    // These never air: the unaired sweep returns their holds later in the week.
  });
});

describe("Monday's break: the same spot, online and local", () => {
  it("counts the relay viewers each minute and settles Opencast's part as it airs", async () => {
    // What BEAT reports at 8 pm on Tuesday (03:00 UTC): YouTube 200, Twitch 50.
    h.clock.set("2026-10-06T03:00:10.000Z");
    fake.youtubeViewers.set("yt-video-1", 200);
    fake.twitchViewers.set("tw-42", 50);
    expect(await h.services.platforms.pollViewers()).toMatchObject({ samples: 2 });
    // Opencast: 100 tuned in; 70 placed in the Inland Empire, 10 in Los Angeles, 20 not placed.
    await opencastViewers("2026-10-06T03:00:00Z", 100, { [ie]: 70, [la]: 10 });
    h.clock.set("2026-10-05T19:00:00.000Z");
    const brk = await breakAt("2026-10-06T03:00:00Z");
    h.clock.set("2026-10-06T03:01:05.000Z");
    const online = await air("online", clickySpot, brk, "2026-10-06T03:00:00Z");
    const local = await air("local", orangeSpot, brk, "2026-10-06T03:00:30Z");
    const flat = await air("flat", flatSpot, brk, "2026-10-06T03:01:00Z");
    expect(online).toMatchObject({ costMicros: $(0.8), working: "100 × $8.00 ÷ 1,000 = $0.80" });
    // Local: only the 70 placed inside the area.
    expect(local).toMatchObject({ costMicros: $(0.56), working: "70 in your area (of 100 tuned in) × $8.00 ÷ 1,000 = $0.56" });
    expect(flat).toMatchObject({ costMicros: $(3) });
    // The relay estimate stays held, shared by the platforms' usual viewers (local: YouTube's only).
    expect(await open("online")).toBe($(2));
    expect(await open("local")).toBe($(1.6));
    expect(await open("flat")).toBe(0);
    expect((await charges(airings.online.airingId)).map((c) => [c.platform, c.status, c.heldMicros])).toEqual([
      ["twitch", "counting", $(0.4)],
      ["youtube", "counting", $(1.6)]
    ]);
    expect((await charges(airings.local.airingId)).map((c) => [c.platform, c.audience, c.heldMicros])).toEqual([
      ["twitch", "local", 0],
      ["youtube", "local", $(1.6)]
    ]);
    // Flat per-airing spots have no relay part.
    expect(await charges(airings.flat.airingId)).toEqual([]);
    await ledgerBalances();
  });

  it("online: every relay viewer, once the counts are in; local: Twitch never, YouTube waits for its location data", async () => {
    h.clock.set("2026-10-06T03:01:30.000Z");
    // Too soon: the last minute's counts may still be coming.
    expect(await h.services.spots.settleRelayViewers()).toEqual({ settled: 0, notBilled: 0, returned: 0 });
    h.clock.set("2026-10-06T03:04:00.000Z");
    expect(await h.services.spots.settleRelayViewers()).toEqual({ settled: 2, notBilled: 1, returned: 0 });
    const online = await charges(airings.online.airingId);
    expect(online.map((c) => [c.platform, c.status, c.viewers, c.costMicros, c.working])).toEqual([
      ["twitch", "settled", 50, $(0.4), "50 × $8.00 ÷ 1,000 = $0.40"],
      ["youtube", "settled", 200, $(1.6), "200 × $8.00 ÷ 1,000 = $1.60"]
    ]);
    const local = await charges(airings.local.airingId);
    expect(local.map((c) => [c.platform, c.status, c.reason, c.viewers])).toEqual([
      ["twitch", "not_billed", "twitch_no_location", 50],
      ["youtube", "waiting_location", null, 200]
    ]);
    expect(await open("online")).toBe(0);
    expect(await open("local")).toBe($(1.6));
    // BEAT got Opencast's viewers and Clicky's relay viewers.
    expect(await balanceOfKind("station_earnings", { stationId: beat.id })).toBe($(0.8 + 0.56 + 3 + 1.6 + 0.4));
    await ledgerBalances();
  });

  it("the local business's results say it's waiting for YouTube's location data", async () => {
    const res = await jess.get(`/v1/businesses/${orange}/results?month=2026-10`).expect(200);
    expect(res.body.airings[0].relayViewers).toEqual([
      expect.objectContaining({ platform: "youtube", label: "Relay viewers, waiting for YouTube's location data", status: "waiting_location", viewers: 200, heldMicros: $(1.6), costMicros: 0 }),
      expect.objectContaining({ platform: "twitch", label: "Relay viewers, as reported by Twitch", status: "not_billed", reason: expect.stringContaining("Twitch doesn't report where viewers are"), costMicros: 0 })
    ]);
    expect(res.body.totals).toMatchObject({ spentMicros: $(0.56), relaySpentMicros: 0, relayWaitingMicros: $(1.6) });
    const statements = await jess.get(`/v1/businesses/${orange}/statements`).expect(200);
    expect(statements.body[0].lines).toContainEqual(
      expect.objectContaining({ kind: "relay_waiting", label: "Relay viewers, waiting for YouTube's location data", amountMicros: $(1.6), includedAbove: true, relay: { platform: "youtube" } })
    );
  });

  it("the online business's results and statement show each platform's relay viewers as their own line", async () => {
    const res = await lee.get(`/v1/businesses/${clicky}/results?month=2026-10`).expect(200);
    const airing = res.body.airings.find((a: { spot: { title: string } }) => a.spot.title === "Free shipping");
    expect(airing.costMicros).toBe($(0.8));
    expect(airing.relayViewers).toEqual([
      expect.objectContaining({ platform: "youtube", label: "Relay viewers, as reported by YouTube", status: "settled", viewers: 200, billedViewers: 200, shareInArea: null, costMicros: $(1.6) }),
      expect.objectContaining({ platform: "twitch", label: "Relay viewers, as reported by Twitch", status: "settled", viewers: 50, costMicros: $(0.4) })
    ]);
    expect(res.body.totals).toMatchObject({ spentMicros: $(0.8 + 1.6 + 0.4 + 3), relaySpentMicros: $(2), relayWaitingMicros: 0 });
    expect(res.body.relayViewers).toEqual([
      expect.objectContaining({ platform: "youtube", label: "Relay viewers, as reported by YouTube", airings: 1, viewersAddedUp: 200, spentMicros: $(1.6) }),
      expect.objectContaining({ platform: "twitch", label: "Relay viewers, as reported by Twitch", airings: 1, viewersAddedUp: 50, spentMicros: $(0.4) })
    ]);
    const statement = (await lee.get(`/v1/businesses/${clicky}/statements`).expect(200)).body[0];
    expect(statement.lines).toContainEqual(expect.objectContaining({ kind: "relay_viewers", label: "Relay viewers, as reported by YouTube", amountMicros: -$(1.6), relay: { platform: "youtube" } }));
    expect(statement.lines).toContainEqual(expect.objectContaining({ kind: "relay_viewers", label: "Relay viewers, as reported by Twitch", amountMicros: -$(0.4), relay: { platform: "twitch" } }));
    // The lines add up to the closing (those shown "included above" aside).
    const added = statement.lines.filter((l: { includedAbove?: boolean; group: string }) => !l.includedAbove && l.group === "balance").reduce((s: number, l: { amountMicros: number }) => s + l.amountMicros, 0);
    expect(statement.openingMicros + added).toBe(statement.closingMicros);
  });
});

describe("the rest of the week, for the local business", () => {
  it("airs again Tuesday and Wednesday; a held relay part isn't taken for an unaired spot", async () => {
    for (const [key, day] of [
      ["tuesday", "2026-10-07"],
      ["wednesday", "2026-10-08"]
    ] as const) {
      h.clock.set(`${day}T03:00:10.000Z`);
      expect(await h.services.platforms.pollViewers()).toMatchObject({ samples: 2 });
      await opencastViewers(`${day}T03:00:00Z`, 100, { [ie]: 70 });
      h.clock.set("2026-10-05T19:00:00.000Z");
      const brk = await breakAt(`${day}T03:00:00Z`);
      h.clock.set(`${day}T03:01:05.000Z`);
      await air(key, orangeSpot, brk, `${day}T03:00:00Z`);
      h.clock.set(`${day}T03:04:00.000Z`);
      await h.services.spots.settleRelayViewers();
      expect((await charges(airings[key].airingId)).map((c) => [c.platform, c.status])).toEqual([
        ["twitch", "not_billed"],
        ["youtube", "waiting_location"]
      ]);
    }
    // Hours later, the unaired sweep leaves waiting relay parts alone.
    h.clock.set("2026-10-08T12:00:00.000Z");
    await h.services.spots.releaseUnaired();
    expect(await open("local")).toBe($(1.6));
    expect(await open("tuesday")).toBeGreaterThan(0);
    await ledgerBalances();
  });

  it("YouTube's location data arrives: Monday's share inside the area is billed; Tuesday had none, so it isn't", async () => {
    h.clock.set("2026-10-09T15:00:00.000Z");
    // Monday: 60% of the broadcast's views in Redlands, 30% in Los Angeles (60 miles away), 10% somewhere YouTube can't place.
    fake.geography.set("yt-video-1:2026-10-06", {
      status: "ready",
      totalViews: 1000,
      places: [
        { label: "Redlands", latitude: 34.0556, longitude: -117.1825, views: 600 },
        { label: "Los Angeles", latitude: 34.0522, longitude: -118.2437, views: 300 },
        { label: "Somewhere", latitude: null, longitude: null, views: 100 }
      ]
    });
    // Tuesday: below YouTube's thresholds, no location data at all.
    fake.geography.set("yt-video-1:2026-10-07", { status: "none", totalViews: 40 });
    expect(await h.services.platforms.fetchGeography()).toEqual({ checked: 3, ready: 1, none: 1 });
    expect(await h.services.spots.settleRelayViewers()).toEqual({ settled: 1, notBilled: 1, returned: 0 });
    const [, monday] = await charges(airings.local.airingId);
    // 200 on YouTube × 60% inside the area = 120 viewers; × $8 ÷ 1,000 = $0.96.
    expect(monday).toMatchObject({ status: "settled", shareInArea: expect.closeTo(0.6, 5), billedViewers: expect.closeTo(120, 3), costMicros: $(0.96), working: "200 × 60% in your area × $8.00 ÷ 1,000 = $0.96" });
    expect(await open("local")).toBe(0);
    const [, tuesday] = await charges(airings.tuesday.airingId);
    expect(tuesday).toMatchObject({ status: "not_billed", reason: "no_location_data", costMicros: 0 });
    expect(await open("tuesday")).toBe(0);
    // Wednesday's data isn't in yet: asked again later.
    expect((await charges(airings.wednesday.airingId))[1].status).toBe("waiting_location");
    await ledgerBalances();
  });

  it("Wednesday's never comes: after 7 days the relay part isn't charged and goes back", async () => {
    const heldBefore = await open("wednesday");
    expect(heldBefore).toBeGreaterThan(0);
    const availableBefore = await balanceOfKind("advertiser_available", { advertiserId: orange });
    h.clock.set("2026-10-15T03:00:00.000Z");
    expect(await h.services.spots.settleRelayViewers()).toEqual({ settled: 0, notBilled: 0, returned: 0 });
    h.clock.set("2026-10-15T03:01:31.000Z");
    expect(await h.services.spots.settleRelayViewers()).toEqual({ settled: 0, notBilled: 0, returned: 1 });
    const [, wednesday] = await charges(airings.wednesday.airingId);
    expect(wednesday).toMatchObject({ status: "returned", reason: "waited", costMicros: 0, returnedMicros: heldBefore });
    expect(await open("wednesday")).toBe(0);
    expect(await balanceOfKind("advertiser_available", { advertiserId: orange })).toBe(availableBefore + heldBefore);
    await ledgerBalances();
  });

  it("the local business paid for 70 Opencast viewers a night and Monday's 120 YouTube viewers in its area, and nothing's left held", async () => {
    // $0.56 × 3 for Opencast's viewers, $0.96 for Monday's YouTube viewers in the area.
    expect(await balanceOfKind("advertiser_available", { advertiserId: orange })).toBe($(100) - $(0.56 * 3 + 0.96));
    expect(await balanceOfKind("advertiser_available", { advertiserId: clicky })).toBe($(100) - $(0.8 + 2 + 3));
    expect(await balanceOfKind("holds")).toBe(0);
    const res = await jess.get(`/v1/businesses/${orange}/results?month=2026-10`).expect(200);
    expect(res.body.relayViewers).toEqual([
      expect.objectContaining({ platform: "youtube", airings: 3, viewersAddedUp: 600, billedViewersAddedUp: 120, spentMicros: $(0.96), waitingMicros: 0, returnedMicros: expect.any(Number) }),
      expect.objectContaining({ platform: "twitch", airings: 3, spentMicros: 0 })
    ]);
    expect(res.body.totals).toMatchObject({ spentMicros: $(0.56 * 3 + 0.96), relaySpentMicros: $(0.96), relayWaitingMicros: 0 });
    const statement = (await jess.get(`/v1/businesses/${orange}/statements`).expect(200)).body[0];
    expect(statement.lines).toContainEqual(expect.objectContaining({ kind: "relay_viewers", label: "Relay viewers, as reported by YouTube", amountMicros: -$(0.96), airings: 1 }));
    expect(statement.lines.find((l: { kind?: string }) => l.kind === "relay_waiting")).toBeUndefined();
    await ledgerBalances();
  });

  it("the station's earnings and statement show relay viewers as their own lines", async () => {
    h.clock.set("2026-10-15T12:00:00.000Z");
    const earnings = await kai.get(`/v1/stations/${beat.id}/earnings?period=month`).expect(200);
    expect(earnings.body.lines.spots.micros).toBe($(0.8 + 0.56 * 3 + 3));
    expect(earnings.body.lines.relayViewers).toEqual([
      { platform: "youtube", label: "Relay viewers, as reported by YouTube", micros: $(1.6 + 0.96), airings: 2 },
      { platform: "twitch", label: "Relay viewers, as reported by Twitch", micros: $(0.4), airings: 1 }
    ]);
    await h.services.ledger.issueStatements("week", at("2026-10-05T00:00:00Z"));
    const statements = await kai.get(`/v1/stations/${beat.id}/statements`).expect(200);
    const week = statements.body.find((s: { period: string; periodStart: string }) => s.period === "week" && s.periodStart === "2026-10-05");
    expect(week.lines).toContainEqual(expect.objectContaining({ label: "Relay viewers, as reported by YouTube", amountMicros: $(1.6 + 0.96), group: "spots", relay: { platform: "youtube" } }));
    expect(week.lines).toContainEqual(expect.objectContaining({ label: "Relay viewers, as reported by Twitch", amountMicros: $(0.4), group: "spots", relay: { platform: "twitch" } }));
    expect(week.lines).toContainEqual(expect.objectContaining({ label: "Spots", amountMicros: $(0.8 + 0.56 * 3 + 3) }));
  });
});
