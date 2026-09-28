// The syndication market: offer, request, approve, place in the log, and the limits.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let reelOwner: User;
let beatOwner: User;
let reel: { id: string };
let beat: { id: string };
let programId: string;
let offerId: string;

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-01T19:00:00.000Z");
  const m = await market(h);
  reelOwner = await h.signIn("Reel owner");
  beatOwner = await h.signIn("Beat owner");
  reel = await stationFixture(h, { callSign: "REEL", ownerId: reelOwner.id, marketId: m.id, tenths: 241, signedOn: true });
  beat = await stationFixture(h, { callSign: "BEAT", ownerId: beatOwner.id, marketId: m.id, tenths: 121, signedOn: true });
  const program = await reelOwner.post(`/v1/stations/${reel.id}/programs`, { title: "Saturday Reel", description: "Films from the archive." }).expect(201);
  programId = program.body.id;
  for (const n of [1, 2, 3]) await itemFixture(h, reel.id, { programId, episodeNumber: n, durationMs: 55 * 60_000, title: `Reel ${n}` });
}, 60_000);
afterAll(() => h.close());

const terms = {
  termsOffered: ["barter", "cash"],
  cashPriceMicros: 2_500_000,
  cashPriceUnit: "per_airing",
  barterMakerMsPerHour: 120_000,
  airingsPerEpisode: 2,
  windowDays: 7,
  liveOnly: false,
  noticeDays: 7,
  approval: "i_approve",
  radioBandAllowed: true
};

describe("offering a program", () => {
  it("a program with a link import can't be offered", async () => {
    const other = await reelOwner.post(`/v1/stations/${reel.id}/programs`, { title: "Borrowed" }).expect(201);
    await itemFixture(h, reel.id, { programId: other.body.id, source: "link" });
    const res = await reelOwner.post(`/v1/programs/${other.body.id}/offer`, terms).expect(422);
    expect(res.body.error.message).toMatch(/Link imports stay local/);
  });

  it("free is only the catalog's term", async () => {
    await reelOwner.post(`/v1/programs/${programId}/offer`, { ...terms, termsOffered: ["free"] }).expect(400);
  });

  it("offers it; other stations can browse it", async () => {
    const res = await reelOwner.post(`/v1/programs/${programId}/offer`, terms).expect(201);
    offerId = res.body.id;
    expect(res.body).toMatchObject({ maker: { callSign: "REEL" }, program: { title: "Saturday Reel", episodeCount: 3 }, carriers: 0 });
    const list = await beatOwner.get(`/v1/catalog/offers?forStation=${beat.id}`).expect(200);
    expect(list.body.map((o: { id: string }) => o.id)).toContain(offerId);
    expect(list.body[0].fitsYourSchedule).toBe(true);
  });
});

describe("carrying it", () => {
  let requestId: string;
  let agreementId: string;

  it("the carrier asks; the maker approves", async () => {
    const req = await beatOwner
      .post(`/v1/catalog/offers/${offerId}/requests`, { carrierStationId: beat.id, term: "barter", slots: [{ weekday: 6, time: "20:00" }], startsOn: "2026-10-01" })
      .expect(201);
    requestId = req.body.id;
    expect(req.body).toMatchObject({ status: "asked", maker: { callSign: "REEL" }, carrier: { callSign: "BEAT" } });
    await beatOwner.post(`/v1/carriage/requests/${requestId}/decision`, { decision: "approve" }).expect(404);
    const approved = await reelOwner.post(`/v1/carriage/requests/${requestId}/decision`, { decision: "approve" }).expect(200);
    expect(approved.body.status).toBe("approved");
    const agreements = await beatOwner.get(`/v1/stations/${beat.id}/carriage/agreements`).expect(200);
    agreementId = agreements.body.carrying[0].id;
    expect(agreements.body.carrying[0]).toMatchObject({ term: "barter", terms: { barterMakerMsPerHour: 120_000, airingsPerEpisode: 2 } });
  });

  it("places the next unaired episodes in the carrier's log, in order", async () => {
    const placed = await beatOwner.post(`/v1/carriage/agreements/${agreementId}/place`, { from: "2026-10-01", weeks: 2 }).expect(200);
    expect(placed.body).toMatchObject({ placed: 2, blockedByLimit: 0 });
    const log = await beatOwner.get(`/v1/stations/${beat.id}/log?from=2026-10-04T00:00:00.000Z&to=2026-10-05T00:00:00.000Z`).expect(200);
    expect(log.body.entries[0]).toMatchObject({ title: "Saturday Reel", carriedFrom: { callSign: "REEL" }, startsAt: "2026-10-04T03:00:00.000Z" });
    // Barter: the maker fills 2:00 an hour of the carrier's breaks inside its program.
    expect(log.body.breaks[0]).toMatchObject({ origin: "carried_barter", lengthMs: 300_000, producerShareMs: 120_000, openMs: 180_000 });
  });

  it("each episode airs at most twice under this deal", async () => {
    const [episode] = (await h.services.library.episodes(programId)).filter((e) => e.title === "Reel 1");
    const add = (startsAt: string) =>
      beatOwner.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt, itemId: episode.id, carriageAgreementId: agreementId });
    await add("2026-10-02T05:00:00.000Z").expect(201);
    const third = await add("2026-10-02T07:00:00.000Z").expect(422);
    expect(third.body.error.message).toBe("The agreement allows 2 airings of each episode.");
  });

  it("another station's program can't go on the log without an agreement", async () => {
    const [episode] = await h.services.library.episodes(programId);
    const res = await beatOwner.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-03T05:00:00.000Z", itemId: episode.id }).expect(422);
    expect(res.body.error.code).toBe("needs_agreement");
  });

  it("either side gives notice; it ends after the notice period", async () => {
    const ended = await reelOwner.post(`/v1/carriage/agreements/${agreementId}/end`).expect(200);
    expect(ended.body.endsAt).toBe("2026-10-08T19:00:00.000Z");
  });

  it("the maker's program page counts previews without saying who", async () => {
    await beatOwner.post(`/v1/catalog/offers/${offerId}/preview`).expect(200);
    const res = await beatOwner.post(`/v1/catalog/offers/${offerId}/preview`).expect(200);
    expect(res.body).toEqual({ previews: 2 });
  });
});

describe("the waitlist", () => {
  it("holds a call sign for a station; no one else can take it", async () => {
    const m = await market(h, "high-desert", "High Desert");
    const { schema } = await import("@opencast/db");
    await h.db.insert(schema.zipMarkets).values({ zip: "92392", marketId: m.id });
    const res = await anon(h).post("/v1/waitlist").send({ role: "station", email: "dana@example.com", zip: "92392", callSign: "HOOP" }).expect(201);
    expect(res.body).toMatchObject({ message: "HOOP is on hold for you.", heldCallSign: "HOOP", market: { slug: "high-desert" } });
    const check = await anon(h).get("/v1/call-signs/HOOP").expect(200);
    expect(check.body).toEqual({ callSign: "HOOP", valid: true, available: false });

    const stranger = await h.signIn();
    const station = await stranger.post("/v1/stations", { name: "Not Dana" }).expect(201);
    const taken = await stranger.patch(`/v1/stations/${station.body.station.id}/setup`, { callSign: "HOOP" }).expect(409);
    expect(taken.body.error.message).toBe("HOOP is held for someone else.");

    const dana = await h.signIn("Dana", { linked: [{ kind: "email", value: "dana@example.com" }] });
    const hers = await dana.post("/v1/stations", { name: "Hoops" }).expect(201);
    await dana.patch(`/v1/stations/${hers.body.station.id}/setup`, { callSign: "HOOP" }).expect(200);
  });

  it("producers and businesses get their own words", async () => {
    const res = await anon(h).post("/v1/waitlist").send({ role: "producer", email: "p@example.com", zip: "00000" }).expect(201);
    expect(res.body).toMatchObject({ message: "Your programs are on the list.", market: null, heldCallSign: null });
  });
});
