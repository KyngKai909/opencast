// The run sheet and break filling, against the database (no ffmpeg).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createFiller } from "../src/v1/modules/playout/engine/fill.js";
import { StationRunner, type RunnerOptions } from "../src/v1/modules/playout/engine/runner.js";
import { createPlanner, type Segment } from "../src/v1/modules/playout/engine/plan.js";
import { anon, createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let jess: User;
let beat: { id: string };
let businessId: string;
let spotId: string;
let planner: ReturnType<typeof createPlanner>;
let filler: ReturnType<typeof createFiller>;

const $ = (d: number) => Math.round(d * 1_000_000);
const shape = (segments: Segment[]) => segments.map((s) => `${s.startsAt.toISOString().slice(11, 19)} ${s.code} ${Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 1000)}s`);

async function listedSpot(owner: User, business: string, title: string, lengthSec: 15 | 30) {
  const s = await owner.post(`/v1/businesses/${business}/spots`, { title, lengthSec, category: "Food", rate: { kind: "per_airing", micros: $(4) }, budget: { totalMicros: $(100), dailyCapMicros: $(20) } }).expect(201);
  await h.db.insert(schema.spotFiles).values({ spotId: s.body.id, version: 1, location: `/fixtures/${title}.mp4`, durationMs: lengthSec * 1000 });
  await h.db.update(schema.spotsTable).set({ status: "listed" }).where(eq(schema.spotsTable.id, s.body.id));
  return s.body.id as string;
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-02T02:59:00.000Z"); // 7:59 pm in Los Angeles.
  planner = createPlanner({ deps: h.deps, services: h.services });
  filler = createFiller({ deps: h.deps, services: h.services });
  const m = await market(h);
  kai = await h.signIn("Kai");
  jess = await h.signIn("Jess");
  beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true, colour: "#8C3B7A" });
  await kai
    .put(`/v1/stations/${beat.id}/break-rule`, { mode: "every_n_minutes", everyMinutes: 30, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "spot_market", blockedCategories: [] })
    .expect(200);
  await itemFixture(h, beat.id, { title: "BEAT ident", code: "SID", durationMs: 5_000 });
  await itemFixture(h, beat.id, { title: "Back to the reel", code: "BMP", durationMs: 10_000 });
  const show = await itemFixture(h, beat.id, { title: "Late Crate", durationMs: 56 * 60_000 });
  await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-02T03:00:00.000Z", endsAt: "2026-10-02T04:00:00.000Z", itemId: show.id }).expect(201);

  const b = await jess.post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "location", locations: [{ kind: "location", city: "Redlands", latitude: 34.05, longitude: -117.18 }] }).expect(201);
  businessId = b.body.id;
  const card = await jess.post(`/v1/businesses/${businessId}/funding-sources`, { kind: "card", token: "tok_4417" }).expect(201);
  await jess.post(`/v1/businesses/${businessId}/deposits`, { amountMicros: $(100), fundingSourceId: card.body[0].id }).expect(201);
  spotId = await listedSpot(jess, businessId, "Fall menu", 30);
  await h.db.update(schema.stations).set({ studioLatitude: 34.05, studioLongitude: -117.18 }).where(eq(schema.stations.id, beat.id));
  await kai.put(`/v1/stations/${beat.id}/rotations/main`, { spotIds: [spotId] }).expect(200);
  const sponsorship = await jess
    .post(`/v1/businesses/${businessId}/sponsorships`, { stationId: beat.id, monthlyMicros: $(25), creditText: "Orange Street Coffee, roasting in Redlands.", startsOn: "2026-10-01" })
    .expect(201);
  await kai.post(`/v1/sponsorships/${sponsorship.body.id}/decision`, { decision: "approve" }).expect(200);
}, 60_000);
afterAll(() => h.close());

describe("filling breaks", () => {
  it("places spots ahead of air, holding the money first, within the same-spot limit", async () => {
    const results = await filler.fillAhead(beat.id, h.clock.now(), 90 * 60_000);
    expect(results.map((r) => r.placed.length)).toEqual([1, 1]);
    const balance = await jess.get(`/v1/businesses/${businessId}/balance`).expect(200);
    // Two airings ($4 each), plus the sponsorship's month ($25) held when it was approved.
    expect(balance.body).toMatchObject({ heldMicros: $(33), heldAirings: 2 });
    // Filled breaks aren't filled again.
    expect(await filler.fillAhead(beat.id, h.clock.now(), 90 * 60_000)).toEqual([]);
  });
});

describe("the run sheet", () => {
  it("covers the hour with no gaps: program, then each break's spot, credit, bumpers and station ID last", async () => {
    const segments = await planner.plan(beat.id, new Date("2026-10-02T03:00:00Z"), new Date("2026-10-02T04:00:00Z"));
    for (let i = 1; i < segments.length; i++) expect(segments[i].startsAt.getTime()).toBe(segments[i - 1].endsAt.getTime());
    expect(shape(segments)).toEqual([
      "03:00:00 PGM 1800s",
      "03:30:00 SPT 30s",
      "03:30:30 UND 15s",
      "03:30:45 BMP 10s",
      "03:30:55 BMP 10s",
      "03:31:05 BMP 10s",
      "03:31:15 BMP 10s",
      "03:31:25 BMP 10s",
      "03:31:35 BMP 10s",
      "03:31:45 BMP 10s",
      "03:31:55 SID 5s",
      "03:32:00 PGM 1560s",
      "03:58:00 SPT 30s",
      "03:58:30 UND 15s",
      "03:58:45 BMP 10s",
      "03:58:55 BMP 10s",
      "03:59:05 BMP 10s",
      "03:59:15 BMP 10s",
      "03:59:25 BMP 10s",
      "03:59:35 BMP 10s",
      "03:59:45 BMP 10s",
      "03:59:55 SID 5s"
    ]);
    // The program resumes where it left off.
    const resumed = segments.find((s) => s.startsAt.toISOString() === "2026-10-02T03:32:00.000Z")!;
    expect(resumed.source).toMatchObject({ kind: "file", seekMs: 1_800_000 });
    // The spot carries its code for the last :10 when it has one; the credit is a generated slate.
    expect(segments.find((s) => s.code === "UND")!.label).toBe("Inland Beat is made possible by");
    expect(segments[1]).toMatchObject({ inBreak: true, airingId: expect.any(String) });
  });

  it("open time airs station ID and bumpers, never nothing", async () => {
    const segments = await planner.plan(beat.id, new Date("2026-10-02T04:00:00Z"), new Date("2026-10-02T04:01:00Z"));
    expect(shape(segments)).toEqual(["04:00:00 BMP 10s", "04:00:10 BMP 10s", "04:00:20 BMP 10s", "04:00:30 BMP 10s", "04:00:40 BMP 10s", "04:00:50 OPEN 5s", "04:00:55 SID 5s"]);
    expect(segments.every((s) => ["BMP", "SID", "OPEN"].includes(s.code) && s.reason === "station_id_fill")).toBe(true);
    const total = segments.reduce((sum, s) => sum + (s.endsAt.getTime() - s.startsAt.getTime()), 0);
    expect(total).toBe(60_000);
  });

  it("an item pulled by a rights claim airs station ID and bumpers instead", async () => {
    const pulled = await itemFixture(h, beat.id, { title: "Borrowed", durationMs: 25 * 60_000 });
    await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-02T05:00:00.000Z", itemId: pulled.id }).expect(201);
    await anon(h).post("/v1/claims").send({ itemId: pulled.id, claimantName: "Studio", claimantContact: "x@example.com", claimText: "Ours.", swornStatement: true }).expect(201);
    const segments = await planner.plan(beat.id, new Date("2026-10-02T05:00:00Z"), new Date("2026-10-02T05:25:00Z"));
    expect(segments.some((s) => s.code === "PGM")).toBe(false);
  });
});

describe("barter inside a carried program", () => {
  it("fills the producer's share from the producer's rotation, and pays the producer", async () => {
    const reelOwner = await h.signIn("Reel");
    const reel = await stationFixture(h, { callSign: "REEL", ownerId: reelOwner.id, signedOn: true });
    const program = await reelOwner.post(`/v1/stations/${reel.id}/programs`, { title: "Saturday Reel", description: "Films." }).expect(201);
    const episode = await itemFixture(h, reel.id, { programId: program.body.id, title: "Reel 1", durationMs: 55 * 60_000 });
    const offer = await reelOwner
      .post(`/v1/programs/${program.body.id}/offer`, { termsOffered: ["barter"], cashPriceMicros: null, cashPriceUnit: null, barterMakerMsPerHour: 60_000, airingsPerEpisode: null, windowDays: 7, liveOnly: false, noticeDays: 7, approval: "any_station", radioBandAllowed: true })
      .expect(201);
    await kai.post(`/v1/catalog/offers/${offer.body.id}/requests`, { carrierStationId: beat.id, term: "barter", slots: [{ weekday: 5, time: "22:00" }], startsOn: "2026-10-01" }).expect(201);
    const agreement = (await kai.get(`/v1/stations/${beat.id}/carriage/agreements`).expect(200)).body.carrying[0];
    // The producer sells its share to its own advertisers.
    const reelSpot = await listedSpot(jess, businessId, "Reel sponsor", 30);
    await h.db.insert(schema.rotations).values({ stationId: reel.id, kind: "main" }).onConflictDoNothing();
    const [rotation] = await h.db.select().from(schema.rotations).where(eq(schema.rotations.stationId, reel.id));
    await h.db.insert(schema.rotationSpots).values({ rotationId: rotation.id, spotId: reelSpot, position: 0 });

    await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-02T06:00:00.000Z", endsAt: "2026-10-02T07:00:00.000Z", itemId: episode.id, carriageAgreementId: agreement.id }).expect(201);
    h.clock.set("2026-10-02T05:59:00.000Z");
    const [filled] = await filler.fillAhead(beat.id, h.clock.now(), 60 * 60_000);
    const producerSpot = filled.placed.find((p) => p.producer);
    expect(producerSpot).toMatchObject({ spotId: reelSpot, lengthSec: 30 });

    const [asRun] = await h.db
      .insert(schema.asRun)
      .values({ stationId: beat.id, code: "SPT", startedAt: new Date("2026-10-02T06:30:00Z"), endedAt: new Date("2026-10-02T06:30:30Z"), airingId: producerSpot!.airingId, reason: "rotation" })
      .returning();
    await h.services.spots.settleAiring({ airingId: producerSpot!.airingId, asRunId: asRun.id, startedAt: asRun.startedAt, endedAt: asRun.endedAt });
    const earnings = async (stationId: string) => (await h.services.ledger.stationEarnings(stationId, "month")).account.availableMicros;
    expect(await earnings(reel.id)).toBe($(4));
    expect(await earnings(beat.id)).toBe(0);
  });
});

describe("live, off air and dead air", () => {
  it("a live block airs its source; off air shows when the station's back; unfilled dead air is repeated from the library", async () => {
    const owner = await h.signIn("Nite");
    const nite = await stationFixture(h, { callSign: "NITE", name: "Night Radio", ownerId: owner.id, signedOn: true });
    const source = await owner.post(`/v1/stations/${nite.id}/live-sources`, { kind: "encoder", name: "Studio A" }).expect(201);
    const repeat = await itemFixture(h, nite.id, { title: "Night Desk", durationMs: 9.5 * 60_000 });
    await owner.post(`/v1/stations/${nite.id}/log`, { kind: "live", startsAt: "2026-10-03T03:00:00.000Z", endsAt: "2026-10-03T04:00:00.000Z", liveSourceId: source.body.source.id }).expect(201);
    await owner.post(`/v1/stations/${nite.id}/log`, { kind: "off_air", startsAt: "2026-10-03T04:30:00.000Z", endsAt: "2026-10-03T13:00:00.000Z" }).expect(201);
    await owner.post(`/v1/stations/${nite.id}/log`, { kind: "program", startsAt: "2026-10-03T13:00:00.000Z", itemId: repeat.id }).expect(201);

    // 4:00 to 4:30 is empty. Nobody acts, so it's filled from the library and recorded.
    const placed = await h.services.log.fillDeadAir(nite.id, { startsAt: "2026-10-03T04:00:00.000Z", endsAt: "2026-10-03T04:30:00.000Z" });
    expect(placed).toBe(3);
    const segments = await planner.plan(nite.id, new Date("2026-10-03T03:00:00Z"), new Date("2026-10-03T04:31:00Z"));
    expect(segments[0]).toMatchObject({ code: "PGM", reason: "live", source: { kind: "live", liveSourceId: source.body.source.id } });
    const filled = segments.filter((s) => s.reason === "dead_air_fill");
    expect(filled.map((s) => s.startsAt.toISOString())).toEqual(["2026-10-03T04:00:00.000Z", "2026-10-03T04:10:00.000Z", "2026-10-03T04:20:00.000Z"]);
    const off = segments.find((s) => s.label === "Off air")!;
    expect(off).toMatchObject({ code: "OPEN", reason: "slate", source: { kind: "image" } });
    const [event] = await h.db.select().from(schema.deadAirEvents).where(eq(schema.deadAirEvents.stationId, nite.id));
    expect(event.autoFilledAt).toBeTruthy();
    await h.deps.bus.settle();
    expect((await owner.get("/v1/me/notices").expect(200)).body[0]).toMatchObject({ kind: "dead_air_filled" });
  });
});

describe("airings that never aired", () => {
  it("give their holds back an hour after their slot; aired ones aren't touched", async () => {
    h.clock.set("2026-10-02T09:00:00.000Z");
    const before = await jess.get(`/v1/businesses/${businessId}/balance`).expect(200);
    expect(before.body.heldAirings).toBeGreaterThan(0);
    const released = await h.services.spots.releaseUnaired();
    expect(released).toBe(before.body.heldAirings);
    const after = await jess.get(`/v1/businesses/${businessId}/balance`).expect(200);
    expect(after.body).toMatchObject({ heldAirings: 0, heldMicros: $(25) });
    // Only once.
    expect(await h.services.spots.releaseUnaired()).toBe(0);
  });
});

describe("the runner's run sheet", () => {
  it("reads the log again when it changed while being read (a spot placed mid-plan)", async () => {
    const at = new Date("2026-10-02T09:00:00.000Z");
    const stale: Segment = { key: "a", startsAt: at, endsAt: new Date(at.getTime() + 60_000), code: "BMP", label: "stale", source: { kind: "image", path: "x" }, reason: "planned", inBreak: true };
    const fresh: Segment = { ...stale, key: "b", code: "SPT", label: "fresh" };
    let calls = 0;
    let land: () => void = () => undefined;
    const runner = new StationRunner({ deps: h.deps, services: h.services }, beat.id, {
      plan: async () => {
        calls++;
        if (calls > 1) return [fresh];
        await new Promise<void>((resolve) => (land = resolve));
        return [stale];
      }
    } as unknown as RunnerOptions);
    const pending = (runner as unknown as { segmentAt(now: Date): Promise<Segment | null> }).segmentAt(at);
    await new Promise((r) => setTimeout(r, 10));
    runner.replan();
    land();
    expect((await pending)?.label).toBe("fresh");
    expect(calls).toBe(2);
  });
});
