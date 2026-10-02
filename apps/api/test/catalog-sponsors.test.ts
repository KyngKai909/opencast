// Catalog sponsors (follow-up Phase 0 item 11, desk-pages 03): the catalog's credit sold by series and
// market. Prices and availability from the rules registry; a slot offered to a business, which says
// yes from its own side, or assigned on its word; each month held at its start and paid to the
// catalog station at its end; Clear thanked wherever nobody has bought the slot, those credits
// counted and the month's Clear-filled slots recorded (not billed); the credit in a catalog
// program's breaks, once an hour, naming the series' sponsor in that market, regenerated when it
// changes; and a market lead working only in their own market.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createPlanner, type Segment } from "../src/v1/modules/playout/engine/plan.js";
import { createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

const $ = (d: number) => Math.round(d * 1_000_000);
const U0 = "00000000-0000-4000-8000-000000000000";

let h: Harness;
let dee: User;
let rae: User;
let lee: User;
let kai: User;
let mia: User;
let jess: User;
let stranger: User;
let ie: { id: string };
let la: { id: string };
let ocat: { id: string };
let beat: { id: string };
let lax: { id: string };
let nights: { id: string; programId: string };
let cartoons: { id: string; programId: string };
let libraries: string;
let coffee: string;
let unfunded: string;
let offerId: string;
let everyId: string;
let planner: ReturnType<typeof createPlanner>;

const page = async (who: User = dee, query = "") => (await who.get(`/v1/admin/catalog/sponsors${query}`).expect(200)).body;
type SlotRow = { series: { id: string } | null; market: { id: string }; creditedBy: string; canEdit: boolean; forSale: boolean; creditsThisMonth: number } & Record<string, unknown>;
const slot = (body: { slots: SlotRow[] }, seriesId: string | null, marketId: string) => body.slots.find((s) => (s.series?.id ?? null) === seriesId && s.market.id === marketId)!;
const held = async (businessId: string) => (await jess.get(`/v1/businesses/${businessId}/balance`).expect(200)).body.heldMicros as number;
const credits = (segments: Segment[]) => segments.filter((s) => s.code === "UND");

async function business(owner: User, name: string, dollars: number) {
  const b = await owner.post("/v1/businesses", { name, category: "Community", customersWhere: "location", locations: [{ kind: "location", city: "Redlands", latitude: 34.05, longitude: -117.18 }] }).expect(201);
  if (dollars) {
    const card = await owner.post(`/v1/businesses/${b.body.id}/funding-sources`, { kind: "card", token: `tok_${name.length}` }).expect(201);
    await owner.post(`/v1/businesses/${b.body.id}/deposits`, { amountMicros: $(dollars), fundingSourceId: card.body[0].id }).expect(201);
  }
  return b.body.id as string;
}

/** A catalog series' episode carried by a station, on its log for an hour. */
async function carry(owner: User, stationId: string, programId: string, itemId: string, startsAt: string) {
  const offer = await dee
    .post(`/v1/programs/${programId}/offer`, { termsOffered: ["free"], cashPriceMicros: null, cashPriceUnit: null, barterMakerMsPerHour: null, airingsPerEpisode: null, windowDays: 30, liveOnly: false, noticeDays: 7, approval: "any_station", radioBandAllowed: true })
    .expect(201);
  await owner.post(`/v1/catalog/offers/${offer.body.id}/requests`, { carrierStationId: stationId, term: "free", slots: [{ weekday: 0, time: "05:00" }], startsOn: "2026-09-15" }).expect(201);
  const agreement = (await owner.get(`/v1/stations/${stationId}/carriage/agreements`).expect(200)).body.carrying.find((a: { program: { id: string } }) => a.program.id === programId);
  await owner.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt, endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(), itemId, carriageAgreementId: agreement.id }).expect(201);
}

async function aired(stationId: string, programId: string, at: string, n = 1) {
  for (let i = 0; i < n; i++) {
    const start = new Date(Date.parse(at) + i * 3_600_000);
    await h.db.insert(schema.asRun).values({ stationId, code: "UND", startedAt: start, endedAt: new Date(start.getTime() + 15_000), programId, reason: "planned" });
  }
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-09-15T19:00:00.000Z");
  planner = createPlanner({ deps: h.deps, services: h.services });
  const ieRow = await market(h);
  const laRow = await market(h, "los-angeles", "Los Angeles");
  ie = ieRow;
  la = laRow;
  dee = await h.signIn("Dee A.", { admin: true });
  rae = await h.signIn("Rae T.");
  lee = await h.signIn("Lee R.");
  kai = await h.signIn("Kai");
  mia = await h.signIn("Mia");
  jess = await h.signIn("Jess");
  stranger = await h.signIn("Sam");
  await h.db.update(schema.users).set({ email: "rae@opencast.test" }).where(eq(schema.users.id, rae.id));
  await h.db.update(schema.users).set({ email: "lee@opencast.test" }).where(eq(schema.users.id, lee.id));
  await dee.post("/v1/admin/desk/team", { email: "rae@opencast.test", roles: [{ role: "rights_reviewer" }] }).expect(200);
  await dee.post("/v1/admin/desk/team", { email: "lee@opencast.test", roles: [{ role: "market_lead", marketId: ie.id }] }).expect(200);

  ocat = await stationFixture(h, { kind: "catalog", callSign: "OCAT", name: "Opencast Classics", ownerId: dee.id, marketId: ie.id, tenths: 601, signedOn: true });
  beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: ie.id, tenths: 121, signedOn: true, colour: "#8C3B7A" });
  lax = await stationFixture(h, { callSign: "LAXB", name: "Westside Tapes", ownerId: mia.id, marketId: la.id, tenths: 141, signedOn: true });
  const made = async (title: string, colour: string) => (await dee.post("/v1/admin/catalog/series", { title, rightsBasis: "us_government", colour }).expect(200)).body as { id: string; programId: string };
  nights = await made("Nights at the observatory", "#1F3A5F");
  cartoons = await made("Cartoons, 1928 to 1936", "#9A5412");

  await kai
    .put(`/v1/stations/${beat.id}/break-rule`, { mode: "every_n_minutes", everyMinutes: 30, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "spot_market", blockedCategories: [] })
    .expect(200);
  const nightsEp = await itemFixture(h, ocat.id, { programId: nights.programId, title: "Nights 1", durationMs: 55 * 60_000 });
  const cartoonsEp = await itemFixture(h, ocat.id, { programId: cartoons.programId, title: "Cartoons 14", durationMs: 28 * 60_000 });
  await carry(kai, beat.id, nights.programId, nightsEp.id, "2026-09-15T20:00:00.000Z");
  await carry(mia, lax.id, cartoons.programId, cartoonsEp.id, "2026-09-15T21:00:00.000Z");

  libraries = await business(jess, "Inland Empire Libraries", 1000);
  coffee = await business(jess, "Orange Street Coffee", 100);
  unfunded = await business(jess, "Tumbleweed Books", 0);
  // BEAT's own sponsor, credited in its other breaks.
  const own = await jess.post(`/v1/businesses/${coffee}/sponsorships`, { stationId: beat.id, monthlyMicros: $(25), creditText: "Orange Street Coffee, roasting in Redlands.", startsOn: "2026-09-01" }).expect(201);
  await kai.post(`/v1/sponsorships/${own.body.id}/decision`, { decision: "approve" }).expect(200);
}, 120_000);
afterAll(() => h.close());

describe("before anything is sold", () => {
  it("thanks Clear in every slot; nothing is for sale until the rules price it", async () => {
    const body = await page();
    expect(body.month).toBe("2026-09-01");
    expect(body.house).toMatchObject({ name: "Clear", creditText: "The member-owned co-op", billedMicros: null, lastMonth: null });
    expect(body.series.map((s: { title: string }) => s.title)).toEqual(["Nights at the observatory", "Cartoons, 1928 to 1936"]);
    // Two series and every series, in each of the two markets.
    expect(body.slots).toHaveLength(6);
    expect(body.slots.every((s: { creditedBy: string; forSale: boolean; priceMicros: number | null }) => s.creditedBy === "house" && !s.forSale && s.priceMicros === null)).toBe(true);
    expect(slot(body, nights.id, ie.id)).toMatchObject({ stations: 1, airsPerDay: 0, canEdit: true });
    expect(body.stats).toMatchObject({ creditsThisMonth: 0, monthlyMicros: 0, marketsWithOpenSlots: 0, fundShareBps: 0, fundShareSet: false });

    const refused = await dee.post("/v1/admin/catalog/sponsors/offers", { seriesId: nights.id, marketId: ie.id, businessId: libraries, creditText: "Inland Empire Libraries, in every city in the valley.", startsOn: "2026-09-01" });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("not_for_sale");
  });

  it("scopes a market lead to their market; the rest of the team reads", async () => {
    const lead = await page(lee);
    expect(lead.editableMarketIds).toEqual([ie.id]);
    expect(slot(lead, nights.id, ie.id).canEdit).toBe(true);
    expect(slot(lead, nights.id, la.id).canEdit).toBe(false);
    const reviewer = await page(rae);
    expect(reviewer.editableMarketIds).toEqual([]);
    expect(reviewer.slots.some((s: { canEdit: boolean }) => s.canEdit)).toBe(false);
    expect((await page(lee, `?marketId=${ie.id}`)).slots.map((s: { market: { id: string } }) => s.market.id)).toEqual([ie.id, ie.id, ie.id]);
    expect((await stranger.get("/v1/admin/catalog/sponsors")).status).toBe(403);
  });

  it("airs the catalog's credit once an hour in a catalog program, thanking Clear; the station's own in its other breaks", async () => {
    const segments = await planner.plan(beat.id, new Date("2026-09-15T20:00:00Z"), new Date("2026-09-15T21:00:00Z"));
    const [catalogCredit, stationCredit] = credits(segments);
    expect(catalogCredit).toMatchObject({ label: "Nights at the observatory is made possible by", programId: nights.programId, startsAt: new Date("2026-09-15T20:30:00Z") });
    expect(stationCredit.label).toBe("Inland Beat is made possible by");
    expect(stationCredit.programId).toBeUndefined();
    const credit = await h.services.spots.catalogCredits(beat.id, [nights.programId, cartoons.programId, U0], h.clock.now());
    expect([...credit.keys()].sort()).toEqual([nights.programId, cartoons.programId].sort());
    expect(credit.get(nights.programId)).toMatchObject({ subject: "Nights at the observatory", colour: "#1F3A5F", sponsor: { business: "Clear", creditText: "The member-owned co-op" }, house: true });
    // The log shows it as master control will air it.
    const log = (await kai.get(`/v1/stations/${beat.id}/log?from=2026-09-15T20:00:00.000Z&to=2026-09-15T21:00:00.000Z`).expect(200)).body;
    const rows = JSON.stringify(log);
    expect(rows).toContain("Nights at the observatory is made possible by");
  });
});

describe("selling a slot", () => {
  it("prices from the registry, per market", async () => {
    await dee.post("/v1/admin/rules/catalog.sponsor_prices/versions", { value: { seriesMonthlyMicros: $(150), everySeriesMonthlyMicros: $(400) }, effectiveFrom: "2026-09-15" }).expect(200);
    // Los Angeles: every series only.
    await dee.post("/v1/admin/rules/catalog.sponsor_prices/versions", { value: { seriesMonthlyMicros: null, everySeriesMonthlyMicros: $(300) }, effectiveFrom: "2026-09-15", scope: la.id }).expect(200);
    const body = await page();
    expect(slot(body, nights.id, ie.id)).toMatchObject({ priceMicros: $(150), forSale: true });
    expect(slot(body, null, ie.id)).toMatchObject({ priceMicros: $(400), forSale: true });
    expect(slot(body, cartoons.id, la.id)).toMatchObject({ priceMicros: null, forSale: false });
    expect(slot(body, null, la.id)).toMatchObject({ priceMicros: $(300), forSale: true });
    expect(body.stats.marketsWithOpenSlots).toBe(2);
  });

  it("offers a slot to a business, checked by the credit rules, in the lead's own market only", async () => {
    const base = { seriesId: nights.id, marketId: ie.id, businessId: libraries, startsOn: "2026-09-01" };
    const salesy = await lee.post("/v1/admin/catalog/sponsors/offers", { ...base, creditText: "20% off every membership. Call now!" });
    expect(salesy.status).toBe(422);
    expect(salesy.body.error.code).toBe("credit_text");
    expect((await lee.post("/v1/admin/catalog/sponsors/offers", { ...base, marketId: la.id, seriesId: null, creditText: "Inland Empire Libraries." })).status).toBe(403);
    expect((await rae.post("/v1/admin/catalog/sponsors/offers", { ...base, creditText: "Inland Empire Libraries." })).status).toBe(403);
    expect((await lee.post("/v1/admin/catalog/sponsors/offers", { ...base, startsOn: "2026-08-01", creditText: "Inland Empire Libraries." })).body.error.code).toBe("bad_month");

    const offered = await lee.post("/v1/admin/catalog/sponsors/offers", { ...base, creditText: "Inland Empire Libraries, in every city in the valley." }).expect(200);
    offerId = offered.body.id;
    expect(offered.body).toMatchObject({ state: "offered", how: "offered", monthlyMicros: $(150), business: { name: "Inland Empire Libraries" }, series: { title: "Nights at the observatory" }, offeredBy: { name: "Lee R." }, renewsOn: null });
    const again = await dee.post("/v1/admin/catalog/sponsors/offers", { ...base, businessId: coffee, creditText: "Orange Street Coffee, roasting in Redlands." });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("slot_taken");
    expect(slot(await page(), nights.id, ie.id)).toMatchObject({ offerId, forSale: false, creditedBy: "house" });
    // Not the catalog station's to approve: the business answers.
    const station = await dee.post(`/v1/sponsorships/${offerId}/decision`, { decision: "approve" });
    expect(station.body.error.code).toBe("catalog_offer");
    // Nothing is held until the business says yes.
    expect(await held(libraries)).toBe(0);
  });

  it("the business says yes: its first month is held now and the credit names it, regenerated", async () => {
    const before = credits(await planner.plan(beat.id, new Date("2026-09-15T20:00:00Z"), new Date("2026-09-15T21:00:00Z")))[0];
    await h.db.insert(schema.playoutState).values({ stationId: beat.id, onAir: true });
    const mine = (await jess.get(`/v1/businesses/${libraries}/catalog-sponsorships`).expect(200)).body;
    expect(mine.map((s: { state: string }) => s.state)).toEqual(["offered"]);
    expect((await kai.post(`/v1/businesses/${libraries}/catalog-sponsorships/${offerId}/answer`, { decision: "accept" })).status).toBe(404);
    const yes = await jess.post(`/v1/businesses/${libraries}/catalog-sponsorships/${offerId}/answer`, { decision: "accept" }).expect(200);
    expect(yes.body).toMatchObject({ state: "credited", since: "2026-09-01", renewsOn: "2026-10-01", canEnd: false });
    expect(await held(libraries)).toBe($(150));
    expect((await jess.post(`/v1/businesses/${libraries}/catalog-sponsorships/${offerId}/answer`, { decision: "decline" })).body.error.code).toBe("already_answered");

    // BEAT, on air, is told to plan again; its credit now names the sponsor, drawn anew.
    const commands = await h.db.select().from(schema.commands).where(and(eq(schema.commands.stationId, beat.id), eq(schema.commands.action, "replan")));
    expect(commands.length).toBeGreaterThan(0);
    const after = credits(await planner.plan(beat.id, new Date("2026-09-15T20:00:00Z"), new Date("2026-09-15T21:00:00Z")))[0];
    expect(after.label).toBe("Nights at the observatory is made possible by");
    expect(after.source).not.toEqual(before.source);
    expect((await h.services.spots.catalogCredits(beat.id, [nights.programId], h.clock.now())).get(nights.programId)).toMatchObject({ sponsor: { business: "Inland Empire Libraries", creditText: "Inland Empire Libraries, in every city in the valley." }, house: false, sponsorshipId: offerId });
    // Only in its market: Los Angeles still thanks Clear.
    expect((await h.services.spots.catalogCredits(lax.id, [nights.programId], h.clock.now())).get(nights.programId)?.house).toBe(true);

    const body = await page();
    expect(slot(body, nights.id, ie.id)).toMatchObject({ creditedBy: "sponsor", sponsorshipId: offerId, offerId: null, forSale: false });
    expect(slot(body, cartoons.id, ie.id).creditedBy).toBe("house");
    expect(body.stats.monthlyMicros).toBe($(150));
    expect(body.sponsors).toEqual([expect.objectContaining({ id: offerId, state: "credited", airsOn: 1 })]);
  });

  it("assigns a slot on the business's word, only if its first month can be held", async () => {
    const base = { seriesId: null, marketId: la.id, creditText: "Tumbleweed Books, on Main Street.", agreed: true };
    const broke = await dee.post("/v1/admin/catalog/sponsors/assignments", { ...base, businessId: unfunded, startsOn: "2026-09-01" });
    expect(broke.status).toBe(422);
    expect(broke.body.error.code).toBe("insufficient_balance");
    expect(broke.body.error.message).toBe("Tumbleweed Books doesn't have $300.00 available to hold for the first month.");
    expect(slot(await page(), null, la.id).forSale).toBe(true);
    expect((await dee.post("/v1/admin/catalog/sponsors/assignments", { ...base, businessId: libraries, startsOn: "2026-10-01", agreed: false })).status).toBe(400);
    // From next month: agreed now, held on the 1st.
    const assigned = await dee.post("/v1/admin/catalog/sponsors/assignments", { ...base, businessId: libraries, creditText: "Inland Empire Libraries, in every city in the valley.", startsOn: "2026-10-01" }).expect(200);
    everyId = assigned.body.id;
    expect(assigned.body).toMatchObject({ state: "starting", how: "assigned", series: null, monthlyMicros: $(300), renewsOn: "2026-10-01", since: null });
    expect(await held(libraries)).toBe($(150));
    expect((await h.services.spots.catalogCredits(lax.id, [cartoons.programId], h.clock.now())).get(cartoons.programId)?.house).toBe(true);
  });
});

describe("the month turns", () => {
  it("counts credits by whom they thanked, pays September to the catalog station, holds October, and records Clear's slots", async () => {
    // Aired in September: two Clear credits in Nights before the yes, three after; five Cartoons credits in Los Angeles.
    await aired(beat.id, nights.programId, "2026-09-10T20:30:00.000Z", 2);
    await aired(beat.id, nights.programId, "2026-09-15T20:30:00.000Z", 3);
    await aired(lax.id, cartoons.programId, "2026-09-12T21:10:00.000Z", 5);
    h.clock.set("2026-09-15T23:59:00.000Z");
    const september = await page();
    expect(september.stats.creditsThisMonth).toBe(10);
    expect(september.house.creditsThisMonth).toBe(7);
    expect(september.sponsors[0]).toMatchObject({ id: offerId, creditsThisMonth: 3 });
    expect(slot(september, nights.id, ie.id).creditsThisMonth).toBe(5);
    expect(slot(september, null, la.id).creditsThisMonth).toBe(5);

    h.clock.set("2026-10-01T00:05:00.000Z");
    await h.services.spots.rollSponsorships();
    const earnings = await h.services.ledger.stationEarnings(ocat.id, "month");
    expect(earnings.account.availableMicros).toBe($(150));
    // October: Nights in the Inland Empire ($150) and every series in Los Angeles ($300).
    expect(await held(libraries)).toBe($(450));
    const recorded = await h.db.select().from(schema.catalogHouseCredits).where(eq(schema.catalogHouseCredits.month, "2026-09-01"));
    expect(recorded.map((r) => [r.programId === nights.programId ? "nights" : "cartoons", r.marketId === ie.id ? "ie" : "la", r.credits, r.billedMicros]).sort()).toEqual([
      ["cartoons", "la", 5, 0],
      ["nights", "ie", 2, 0]
    ]);
    // Recorded once.
    expect(await h.services.spots.recordHouseCredits("2026-09-01")).toBe(0);
    const october = await page();
    expect(october.house.lastMonth).toEqual({ month: "2026-09-01", slots: 2, credits: 7 });
    expect(october.stats.monthlyMicros).toBe($(450));
    expect(slot(october, cartoons.id, la.id)).toMatchObject({ creditedBy: "every_series", sponsorshipId: null });
    expect((await h.services.spots.catalogCredits(lax.id, [cartoons.programId], h.clock.now())).get(cartoons.programId)).toMatchObject({ house: false, sponsorshipId: everyId });
  });

  it("ends a sponsorship: credited to the end of its paid month, then Clear again", async () => {
    expect((await lee.post(`/v1/admin/catalog/sponsors/${everyId}/end`)).status).toBe(403);
    const ended = await lee.post(`/v1/admin/catalog/sponsors/${offerId}/end`).expect(200);
    expect(ended.body).toMatchObject({ state: "ending", endsOn: "2026-10-31", renewsOn: null, canEnd: false });
    expect((await h.services.spots.catalogCredits(beat.id, [nights.programId], h.clock.now())).get(nights.programId)?.house).toBe(false);
    // The slot can be sold again from November.
    expect(slot(await page(), nights.id, ie.id)).toMatchObject({ creditedBy: "sponsor", forSale: true });

    h.clock.set("2026-11-01T00:05:00.000Z");
    await h.services.spots.rollSponsorships();
    expect((await h.services.spots.catalogCredits(beat.id, [nights.programId], h.clock.now())).get(nights.programId)?.house).toBe(true);
    // October paid to the catalog station; only Los Angeles is held for November.
    expect(await held(libraries)).toBe($(300));
    const body = await page();
    expect(body.sponsors.map((s: { id: string }) => s.id)).toEqual([everyId]);
    expect(slot(body, nights.id, ie.id).creditedBy).toBe("house");
  });

  it("withdraws an offer nobody answered, and a business can decline one", async () => {
    const offered = await dee.post("/v1/admin/catalog/sponsors/offers", { seriesId: cartoons.id, marketId: ie.id, businessId: coffee, creditText: "Orange Street Coffee, roasting in Redlands.", startsOn: "2026-11-01" }).expect(200);
    expect((await dee.post(`/v1/admin/catalog/sponsors/${offered.body.id}/end`).expect(200)).body.state).toBe("ended");
    const again = await dee.post("/v1/admin/catalog/sponsors/offers", { seriesId: cartoons.id, marketId: ie.id, businessId: coffee, creditText: "Orange Street Coffee, roasting in Redlands.", startsOn: "2026-12-01" }).expect(200);
    const no = await jess.post(`/v1/businesses/${coffee}/catalog-sponsorships/${again.body.id}/answer`, { decision: "decline" }).expect(200);
    expect(no.body.state).toBe("declined");
    expect(slot(await page(), cartoons.id, ie.id)).toMatchObject({ forSale: true, offerId: null });
  });
});

describe("the business picker", () => {
  it("finds businesses by name, with their city", async () => {
    const found = (await lee.get("/v1/admin/catalog/sponsors/businesses?q=inland").expect(200)).body;
    expect(found).toEqual([{ id: libraries, name: "Inland Empire Libraries", category: "Community", city: "Redlands" }]);
  });
});
