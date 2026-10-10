// Other apps viewers on per-thousand spots (programming Phase 5, P5.1, the user's decision), through
// the services and the API. BEAT has viewers in other apps (runs of `via=iptv` playlist polls); the
// same $8-per-thousand spot is bought by an online business (Clicky Shop) and a local one (Orange
// Street Coffee, Redlands, within 10 miles).
//
// - A session is billed for a spot when its polls ran from the spot's start (or before) to its end
//   (or after), it counts (a minute of polls), and its polls average one every 30 seconds; one per
//   connection.
// - Online: every such session. Local: only those placed in a market inside the area.
// - The part stays held as the spot airs and settles two minutes after it, once the polls are in.
// The ledger balances at every step, and nothing is left held.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import { schema } from "@opencast/db";
import { createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User; // BEAT's owner
let jess: User; // Orange Street Coffee (local)
let lee: User; // Clicky Shop (online)
let beat: { id: string };
let other: { id: string };
let ie: string; // Inland Empire, BEAT's market
let la: string; // Los Angeles, not in Orange's area
let orange: string;
let clicky: string;
let orangeSpot: string;
let clickySpot: string;
let flatSpot: string;
const airings: Record<string, { airingId: string; holdMicros: number }> = {};
const sessions: Record<string, string> = {};

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

/** A run of playlist polls from one connection, as `audience/otherApps.ts` writes it. */
async function session(key: string, fields: { stationId?: string; marketId?: string | null; startedAt: string; lastPollAt: string; polls: number; clientKey?: string }) {
  const [row] = await h.db
    .insert(schema.otherAppSessions)
    .values({ stationId: fields.stationId ?? beat.id, marketId: fields.marketId ?? null, clientKey: fields.clientKey ?? `key-${key}`, startedAt: at(fields.startedAt), lastPollAt: at(fields.lastPollAt), polls: fields.polls })
    .returning();
  sessions[key] = row.id;
}

/** The session polled on (its row written again). */
async function polled(keys: string[], lastPollAt: string, more: number) {
  await h.db
    .update(schema.otherAppSessions)
    .set({ lastPollAt: at(lastPollAt), polls: sql`${schema.otherAppSessions.polls} + ${more}` })
    .where(inArray(schema.otherAppSessions.id, keys.map((k) => sessions[k])));
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
  const now = h.clock.now();
  h.clock.set("2026-10-05T19:00:00.000Z");
  const placed = await h.services.spots.place({ spotId, stationId: beat.id, breakId, scheduledAt: at(startedAt) });
  h.clock.set(now.toISOString());
  const [run] = await h.db
    .insert(schema.asRun)
    .values({ stationId: beat.id, code: "SPT", startedAt: at(startedAt), endedAt: new Date(Date.parse(startedAt) + 30_000), airingId: placed.airingId, breakId, reason: "rotation" })
    .returning();
  const settled = await h.services.spots.settleAiring({ airingId: placed.airingId, asRunId: run.id, startedAt: run.startedAt, endedAt: run.endedAt });
  airings[key] = placed;
  return { ...placed, ...settled };
}

async function charge(key: string) {
  const [row] = await h.db.select().from(schema.otherAppCharges).where(eq(schema.otherAppCharges.airingId, airings[key].airingId));
  return row;
}
const open = async (key: string) => {
  const [a] = await h.db.select({ holdId: schema.airings.holdId }).from(schema.airings).where(eq(schema.airings.id, airings[key].airingId));
  return (await h.services.ledger.openAmount([a.holdId])).get(a.holdId) ?? 0;
};

beforeAll(async () => {
  h = await createHarness({ publicBase: "https://api.opencast.test" });
  h.clock.set("2026-10-05T19:00:00.000Z"); // Monday noon in Los Angeles
  ie = (await market(h)).id;
  la = (await market(h, "los-angeles", "Los Angeles")).id;
  kai = await h.signIn("Kai");
  jess = await h.signIn("Jess Lin");
  lee = await h.signIn("Lee");
  beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: ie, tenths: 121, signedOn: true });
  other = await stationFixture(h, { callSign: "KOTH", name: "Other", ownerId: kai.id, marketId: ie, tenths: 131, signedOn: true });
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

  // Last Monday evening at 8 pm (03:00 UTC), which prices the holds: 100 on Opencast.
  for (let i = 0; i < 60; i++) {
    const minute = new Date(Date.parse("2026-10-05T03:00:00Z") + i * 60_000);
    await h.db.insert(schema.minuteSamples).values({ stationId: beat.id, minute, tunedIn: 100, web: 100 });
  }
  // And each evening last week, 50 sessions in other apps through the hour (KOTH's never count for BEAT).
  for (let d = 0; d < 7; d++) {
    const start = new Date(Date.parse("2026-09-29T03:00:00Z") + d * 86_400_000);
    await h.db.insert(schema.otherAppSessions).values(
      Array.from({ length: 50 }, (_, i) => ({ stationId: beat.id, clientKey: `past-${d}-${i}`, startedAt: start, lastPollAt: new Date(start.getTime() + 3_600_000), polls: 1200 }))
    );
    await h.db.insert(schema.otherAppSessions).values({ stationId: other.id, clientKey: `koth-${d}`, startedAt: start, lastPollAt: new Date(start.getTime() + 3_600_000), polls: 1200 });
  }
}, 60_000);
afterAll(() => h.close());

describe("the hold", () => {
  it("covers Opencast's viewers plus the usual Other apps sessions at the hour; flat spots are unaffected", async () => {
    h.clock.set("2026-10-05T19:00:00.000Z");
    expect(await h.services.audience.otherApps.typical(beat.id, at("2026-10-06T03:00:00Z"))).toBe(50);
    const brk = await breakAt("2026-10-06T05:00:00Z");
    const online = await h.services.spots.place({ spotId: clickySpot, stationId: beat.id, breakId: brk, scheduledAt: at("2026-10-06T03:00:00Z") });
    const flat = await h.services.spots.place({ spotId: flatSpot, stationId: beat.id, breakId: brk, scheduledAt: at("2026-10-06T03:01:00Z") });
    // 100 × $8 ÷ 1,000 = $0.80 for Opencast; 50 in other apps → $0.40.
    expect(online.holdMicros).toBe($(1.2));
    expect(flat.holdMicros).toBe($(3));
    // These never air: the unaired sweep returns their holds later in the week.
  });
});

describe("Monday's break: the same spot, online and local", () => {
  it("settles Opencast's part as it airs and keeps the Other apps part held while it counts", async () => {
    // Opencast: 100 tuned in; 70 placed in the Inland Empire.
    await h.db.insert(schema.minuteSamples).values({ stationId: beat.id, minute: at("2026-10-06T03:00:00Z"), tunedIn: 100, web: 100 });
    await h.db.insert(schema.minuteMarkets).values({ stationId: beat.id, minute: at("2026-10-06T03:00:00Z"), marketId: ie, tunedIn: 70 });
    // Other apps, as their rows stand when the spots end (written at most every 15 seconds).
    await session("a", { marketId: ie, startedAt: "2026-10-06T02:50:00Z", lastPollAt: "2026-10-06T03:00:58Z", polls: 300 });
    await session("b", { marketId: la, startedAt: "2026-10-06T02:55:00Z", lastPollAt: "2026-10-06T03:00:58Z", polls: 200 });
    await session("c", { marketId: null, startedAt: "2026-10-06T02:58:00Z", lastPollAt: "2026-10-06T03:00:58Z", polls: 150 });
    // Tuned in 10 seconds into the online spot: only the local one, which starts at 03:00:30.
    await session("d", { marketId: ie, startedAt: "2026-10-06T03:00:10Z", lastPollAt: "2026-10-06T03:00:58Z", polls: 20 });
    // Left during the online spot.
    await session("e", { marketId: ie, startedAt: "2026-10-06T02:50:00Z", lastPollAt: "2026-10-06T03:00:20Z", polls: 300 });
    // Hardly polling: 5 polls over 11 minutes isn't a player playing.
    await session("f", { marketId: ie, startedAt: "2026-10-06T02:50:00Z", lastPollAt: "2026-10-06T03:00:58Z", polls: 5 });
    // Gone before the break.
    await session("g", { marketId: ie, startedAt: "2026-10-06T02:40:00Z", lastPollAt: "2026-10-06T02:59:50Z", polls: 300 });
    // A's connection again (another replica's row for the same run): one viewer, not two.
    await session("a2", { marketId: ie, startedAt: "2026-10-06T02:51:00Z", lastPollAt: "2026-10-06T03:00:58Z", polls: 300, clientKey: "key-a" });
    // On KOTH: not BEAT's.
    await session("koth", { stationId: other.id, marketId: ie, startedAt: "2026-10-06T02:50:00Z", lastPollAt: "2026-10-06T03:00:58Z", polls: 300 });

    h.clock.set("2026-10-05T19:00:00.000Z");
    const brk = await breakAt("2026-10-06T03:00:00Z");
    h.clock.set("2026-10-06T03:01:05.000Z");
    const online = await air("online", clickySpot, brk, "2026-10-06T03:00:00Z");
    const local = await air("local", orangeSpot, brk, "2026-10-06T03:00:30Z");
    const flat = await air("flat", flatSpot, brk, "2026-10-06T03:01:00Z");
    expect(online).toMatchObject({ holdMicros: $(1.2), costMicros: $(0.8), working: "100 × $8.00 ÷ 1,000 = $0.80" });
    expect(local).toMatchObject({ holdMicros: $(1.2), costMicros: $(0.56), working: "70 in your area (of 100 tuned in) × $8.00 ÷ 1,000 = $0.56" });
    expect(flat).toMatchObject({ costMicros: $(3) });
    // What's left of each hold stays held for its Other apps part.
    expect(await charge("online")).toMatchObject({ audience: "online", status: "counting", heldMicros: $(0.4) });
    expect(await charge("local")).toMatchObject({ audience: "local", status: "counting", heldMicros: $(0.64) });
    expect(await open("online")).toBe($(0.4));
    expect(await open("local")).toBe($(0.64));
    // Flat per-airing spots have no Other apps part.
    expect(await charge("flat")).toBeUndefined();
    // Not unaired: the sweep leaves a counting part's hold alone.
    h.clock.set("2026-10-06T04:30:00.000Z");
    await h.services.spots.releaseUnaired();
    expect(await open("online")).toBe($(0.4));
    await ledgerBalances();
  });

  it("settles two minutes after the spot, once the polls after it are in: online every session, local only those placed in the area", async () => {
    h.clock.set("2026-10-06T03:02:00.000Z");
    // Too soon: a run still going may not have written its polls since the spot.
    expect(await h.services.spots.settleOtherApps()).toEqual({ settled: 0, notBilled: 0 });
    // The runs that went on polling (one row write every 15 seconds or so).
    await polled(["a", "b", "c", "d", "f", "a2", "koth"], "2026-10-06T03:02:50Z", 8);
    h.clock.set("2026-10-06T03:03:01.000Z");
    expect(await h.services.spots.settleOtherApps()).toEqual({ settled: 2, notBilled: 0 });
    // Online: A, B and C watched through 03:00:00 to 03:00:30. 3 × $8 ÷ 1,000 = $0.024.
    expect(await charge("online")).toMatchObject({ status: "settled", sessions: 3, billedSessions: 3, costMicros: 24_000, heldMicros: 0, working: "3 × $8.00 ÷ 1,000 = $0.02" });
    // Local: A, B, C and D watched through 03:00:30 to 03:01:00; A and D are placed inside the area (B is in Los Angeles, C unplaced).
    expect(await charge("local")).toMatchObject({ status: "settled", sessions: 4, billedSessions: 2, costMicros: 16_000, working: "2 in your area (of 4) × $8.00 ÷ 1,000 = $0.02" });
    expect(await open("online")).toBe(0);
    expect(await open("local")).toBe(0);
    // BEAT got Opencast's viewers, the flat spot and both Other apps parts.
    expect(await balanceOfKind("station_earnings", { stationId: beat.id })).toBe($(0.8 + 0.56 + 3) + 24_000 + 16_000);
    // (The first test's airings never aired: the sweep gave their holds back.)
    expect(await balanceOfKind("advertiser_available", { advertiserId: clicky })).toBe($(100) - $(0.8 + 3) - 24_000);
    // Settled once: running it again does nothing.
    h.clock.set("2026-10-06T03:05:00.000Z");
    expect(await h.services.spots.settleOtherApps()).toEqual({ settled: 0, notBilled: 0 });
    await ledgerBalances();
  });

  it("the online business's results and statement show Other apps as their own line", async () => {
    const res = await lee.get(`/v1/businesses/${clicky}/results?month=2026-10`).expect(200);
    const airing = res.body.airings.find((a: { spot: { title: string } }) => a.spot.title === "Free shipping");
    expect(airing.costMicros).toBe($(0.8));
    expect(airing.otherApps).toEqual({ label: "Other apps", status: "settled", reason: null, sessions: 3, billedSessions: 3, costMicros: 24_000, heldMicros: 0, working: "3 × $8.00 ÷ 1,000 = $0.02" });
    expect(res.body.airings.find((a: { spot: { title: string } }) => a.spot.title === "Flat rate").otherApps).toBeUndefined();
    expect(res.body.totals).toMatchObject({ spentMicros: $(0.8 + 3) + 24_000, otherAppsSpentMicros: 24_000, otherAppsWaitingMicros: 0 });
    expect(res.body.otherApps).toEqual({ label: "Other apps", airings: 1, sessionsAddedUp: 3, billedSessionsAddedUp: 3, spentMicros: 24_000, waitingMicros: 0, waitingAirings: 0 });
    expect(res.body.relayViewers).toBeUndefined();
    const statement = (await lee.get(`/v1/businesses/${clicky}/statements`).expect(200)).body[0];
    expect(statement.lines).toContainEqual(expect.objectContaining({ group: "balance", kind: "other_apps", label: "Other apps", detail: "1 airing", amountMicros: -24_000, airings: 1 }));
    // The lines add up to the closing (those shown "included above" aside).
    const added = statement.lines.filter((l: { includedAbove?: boolean; group: string }) => !l.includedAbove && l.group === "balance").reduce((s: number, l: { amountMicros: number }) => s + l.amountMicros, 0);
    expect(statement.openingMicros + added).toBe(statement.closingMicros);
    // Spent, by spot and station, takes it in; the airings aren't counted twice.
    expect(statement.lines).toContainEqual(expect.objectContaining({ group: "spent", label: expect.stringContaining("Free shipping on BEAT"), amountMicros: $(0.8) + 24_000, airings: 1 }));
    // The statement's PDF (its receipt) has the line too.
    const url = new URL(statement.pdfUrl);
    const pdf = await request(h.app)
      .get(`${url.pathname}${url.search}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((pdf.body as Buffer).toString("latin1")).toContain("(Other apps \\(1 airing\\)  -$0.02)");
  });

  it("the local business's results show who in its area was billed", async () => {
    const res = await jess.get(`/v1/businesses/${orange}/results?month=2026-10`).expect(200);
    expect(res.body.airings[0].otherApps).toMatchObject({ status: "settled", sessions: 4, billedSessions: 2, costMicros: 16_000, working: "2 in your area (of 4) × $8.00 ÷ 1,000 = $0.02" });
    expect(res.body.totals).toMatchObject({ spentMicros: $(0.56) + 16_000, otherAppsSpentMicros: 16_000 });
  });
});

describe("Tuesday, for the local business", () => {
  it("only an unplaced session in another app: not billed to a local business, and its hold goes back", async () => {
    await h.db.insert(schema.minuteMarkets).values({ stationId: beat.id, minute: at("2026-10-07T03:00:00Z"), marketId: ie, tunedIn: 70 });
    await h.db.insert(schema.minuteSamples).values({ stationId: beat.id, minute: at("2026-10-07T03:00:00Z"), tunedIn: 100, web: 100 });
    await session("tue", { marketId: null, startedAt: "2026-10-07T02:50:00Z", lastPollAt: "2026-10-07T03:00:58Z", polls: 300 });
    h.clock.set("2026-10-05T19:00:00.000Z");
    const brk = await breakAt("2026-10-07T03:00:00Z");
    h.clock.set("2026-10-07T03:00:35.000Z");
    await air("tuesday", orangeSpot, brk, "2026-10-07T03:00:00Z");
    expect(await charge("tuesday")).toMatchObject({ status: "counting" });
    const availableBefore = await balanceOfKind("advertiser_available", { advertiserId: orange });
    const held = await open("tuesday");
    expect(held).toBeGreaterThan(0);
    await polled(["tue"], "2026-10-07T03:02:20Z", 10);
    h.clock.set("2026-10-07T03:02:31.000Z");
    expect(await h.services.spots.settleOtherApps()).toEqual({ settled: 0, notBilled: 1 });
    expect(await charge("tuesday")).toMatchObject({ status: "not_billed", reason: "none_in_area", sessions: 1, billedSessions: 0, costMicros: 0 });
    expect(await open("tuesday")).toBe(0);
    expect(await balanceOfKind("advertiser_available", { advertiserId: orange })).toBe(availableBefore + held);
    const res = await jess.get(`/v1/businesses/${orange}/results?month=2026-10`).expect(200);
    const tuesday = res.body.airings.find((a: { startedAt: string }) => a.startedAt.startsWith("2026-10-07"));
    expect(tuesday.otherApps).toMatchObject({ status: "not_billed", reason: "Nobody watching in another app was placed inside your area", costMicros: 0 });
    await ledgerBalances();
  });

  it("nobody in another app: no Other apps part at all", async () => {
    h.clock.set("2026-10-05T19:00:00.000Z");
    const brk = await breakAt("2026-10-08T03:00:00Z");
    h.clock.set("2026-10-08T03:00:35.000Z");
    const wednesday = await air("wednesday", orangeSpot, brk, "2026-10-08T03:00:00Z");
    expect(await charge("wednesday")).toBeUndefined();
    // Nothing kept held: the whole hold settled or went back as it aired.
    expect(await open("wednesday")).toBe(0);
    expect(wednesday.holdMicros).toBeGreaterThan(wednesday.costMicros);
  });

  it("nothing's left held, and the local business paid for its Other apps viewers inside its area only", async () => {
    h.clock.set("2026-10-15T12:00:00.000Z");
    await h.services.spots.releaseUnaired();
    expect(await balanceOfKind("holds")).toBe(0);
    const statement = (await jess.get(`/v1/businesses/${orange}/statements`).expect(200)).body[0];
    expect(statement.lines).toContainEqual(expect.objectContaining({ kind: "other_apps", label: "Other apps", amountMicros: -16_000, airings: 1 }));
    // The station's earnings count them in Spots.
    const earnings = await kai.get(`/v1/stations/${beat.id}/earnings?period=month`).expect(200);
    expect(earnings.body.lines.spots.micros).toBe($(0.8 + 0.56 * 2 + 3) + 24_000 + 16_000);
    await ledgerBalances();
  });
});
