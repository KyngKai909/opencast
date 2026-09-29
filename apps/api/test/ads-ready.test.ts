// Ready for ads from partners (the programmatic backfill isn't built): every station and program
// has IAB categories, programs have a rating and a
// child-directed flag, the station has its switch, and earnings have the line.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let owner: User;
let operator: User;
let stationId: string;

const rule = {
  mode: "after_every_program",
  everyMinutes: null,
  lengthMs: 120_000,
  spotMsPerHour: 180_000,
  sameSpotPerHour: 2,
  fillOrder: ["SPT", "UND", "BMP", "SID"],
  openTimeTo: "spot_market",
  blockedCategories: ["Alcohol", "Vaping"]
};

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-01T19:00:00.000Z");
  const m = await market(h);
  owner = await h.signIn("Kai");
  operator = await h.signIn("Op");
  const station = await stationFixture(h, { callSign: "BEAT", ownerId: owner.id, marketId: m.id, tenths: 121 });
  stationId = station.id;
  await h.services.accounts.addStationMember(h.db, stationId, operator.id, "operator");
}, 60_000);
afterAll(() => h.close());

describe("IAB categories on stations", () => {
  it("are derived from the station's category, or Entertainment without one", async () => {
    expect((await owner.get(`/v1/stations/${stationId}/setup`).expect(200)).body.iabCategories).toEqual(["JLBCU7"]);
    const res = await owner.patch(`/v1/stations/${stationId}/setup`, { category: "Music" }).expect(200);
    expect(res.body.iabCategories).toEqual(["338"]);
  });

  it("can be set by hand, and set back to derived", async () => {
    expect((await owner.patch(`/v1/stations/${stationId}/setup`, { iabCategories: ["338", "371"] }).expect(200)).body.iabCategories).toEqual(["338", "371"]);
    expect((await owner.patch(`/v1/stations/${stationId}/setup`, { iabCategories: null }).expect(200)).body.iabCategories).toEqual(["338"]);
    await owner.patch(`/v1/stations/${stationId}/setup`, { iabCategories: ["not an id!"] }).expect(400);
  });
});

describe("programs", () => {
  it("a children's rating makes a program child-directed; categories come from it, else the station", async () => {
    const kids = await owner.post(`/v1/stations/${stationId}/programs`, { title: "Story Time", rating: "TV-Y" }).expect(201);
    expect(kids.body).toMatchObject({ rating: "TV-Y", childDirected: true, iabCategories: ["338"] });
    const food = await owner.post(`/v1/stations/${stationId}/programs`, { title: "Kitchen", category: "Food", rating: "TV-14" }).expect(201);
    expect(food.body).toMatchObject({ rating: "TV-14", childDirected: false, iabCategories: ["210"] });
    const plain = await owner.post(`/v1/stations/${stationId}/programs`, { title: "Plain" }).expect(201);
    expect(plain.body).toMatchObject({ rating: null, childDirected: false });
  });

  it("updates its rating, flag and categories", async () => {
    const show = await owner.post(`/v1/stations/${stationId}/programs`, { title: "Late Crate", category: "Music" }).expect(201);
    const updated = await owner.patch(`/v1/programs/${show.body.id}`, { rating: "TV-Y7" }).expect(200);
    expect(updated.body).toMatchObject({ rating: "TV-Y7", childDirected: true });
    const adult = await owner.patch(`/v1/programs/${show.body.id}`, { rating: "TV-MA", childDirected: false, iabCategories: ["646"] }).expect(200);
    expect(adult.body).toMatchObject({ rating: "TV-MA", childDirected: false, iabCategories: ["646"] });
    await owner.patch(`/v1/programs/${show.body.id}`, { rating: "R" }).expect(400);
    expect((await owner.patch(`/v1/programs/${show.body.id}`, { iabCategories: null }).expect(200)).body.iabCategories).toEqual(["338"]);
  });
});

describe("the station's switch", () => {
  it("is off by default, stored through the break rule, and kept when an older app leaves it out", async () => {
    expect((await operator.get(`/v1/stations/${stationId}/break-rule`).expect(200)).body.adsFromPartners).toBe(false);
    expect((await operator.put(`/v1/stations/${stationId}/break-rule`, { ...rule, adsFromPartners: true }).expect(200)).body.adsFromPartners).toBe(true);
    expect((await operator.put(`/v1/stations/${stationId}/break-rule`, rule).expect(200)).body.adsFromPartners).toBe(true);
    const profile = await h.services.stations.adProfile(stationId);
    expect(profile).toEqual({ iabCategories: ["338"], blockedIabAdProducts: ["1002", "1548", "1549", "1550"], adsFromPartners: true, spotMsPerHour: 180_000 });
  });

  it("shows on the earnings as its own line, at $0 until partner ads exist", async () => {
    const earnings = await owner.get(`/v1/stations/${stationId}/earnings?period=month`).expect(200);
    expect(earnings.body.lines.partnerAds).toEqual({ on: true, micros: 0, pendingMicros: 0 });
    await operator.put(`/v1/stations/${stationId}/break-rule`, { ...rule, adsFromPartners: false }).expect(200);
    expect((await owner.get(`/v1/stations/${stationId}/earnings?period=week`).expect(200)).body.lines.partnerAds.on).toBe(false);
  });
});
