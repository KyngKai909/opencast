// Ready for ads from partners (the programmatic backfill isn't built): every break carries its
// SCTE-35 cue, every station and program has IAB categories, programs have a rating and a
// child-directed flag, the station has its switch, and earnings have the line.
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeSpliceInsert } from "../src/v1/modules/playout/engine/scte35.js";
import { createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

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

describe("break markers", () => {
  it("every break in a live playlist carries SCTE-35 out and in cues, stored or not", async () => {
    const ep = await itemFixture(h, stationId, { title: "Episode" });
    await owner.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-01T20:00:00.000Z", endsAt: "2026-10-01T20:30:00.000Z", itemId: ep.id }).expect(201);
    await owner.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-01T20:30:00.000Z", endsAt: "2026-10-01T21:00:00.000Z", itemId: ep.id }).expect(201);
    const dir = path.join(h.deps.config.storageRoot, "hls", stationId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "index.m3u8"), ["#EXTM3U", "#EXT-X-VERSION:6", "#EXT-X-TARGETDURATION:2", "#EXT-X-PROGRAM-DATE-TIME:2026-10-01T20:27:00.000Z", "#EXTINF:2.0,", "seg_1.ts", ""].join("\n"));

    const cuesAt = async (iso: string) => {
      h.clock.set(iso);
      const playlist = (await h.services.playout.playlistWithCues(stationId))!;
      const window = await h.services.log.breaks(stationId, new Date(Date.parse(iso) - 5 * 60_000), new Date(Date.parse(iso) + 2 * 60_000));
      const tags = playlist.split("\n").filter((l) => l.startsWith("#EXT-X-DATERANGE"));
      return { window, tags };
    };

    // Generated from the rule, not stored yet: still cued.
    const before = await cuesAt("2026-10-01T20:27:00.000Z");
    expect(before.window).toHaveLength(1);
    expect(before.window[0].id).toBeNull();
    expect(before.tags).toHaveLength(2);
    const out = before.tags[0].match(/SCTE35-OUT=0x([0-9A-F]+)/)![1];
    const back = before.tags[1].match(/SCTE35-IN=0x([0-9A-F]+)/)![1];
    expect(decodeSpliceInsert(Buffer.from(out, "hex"))).toMatchObject({ outOfNetwork: true, durationMs: before.window[0].lengthMs, crcOk: true });
    expect(decodeSpliceInsert(Buffer.from(back, "hex"))).toMatchObject({ outOfNetwork: false, crcOk: true });
    // The same cue on the next refresh.
    expect((await cuesAt("2026-10-01T20:27:00.000Z")).tags).toEqual(before.tags);

    // Stored (as playout does 20 minutes ahead): cued by its ID.
    await h.services.log.ensureBreaks(stationId, new Date("2026-10-01T20:00:00.000Z"), new Date("2026-10-01T21:00:00.000Z"));
    const stored = await cuesAt("2026-10-01T20:57:00.000Z");
    expect(stored.window).toHaveLength(1);
    expect(stored.window[0].id).not.toBeNull();
    expect(stored.tags).toHaveLength(2);
    expect(stored.tags[0]).toContain(`ID="${stored.window[0].id}"`);
  });
});
