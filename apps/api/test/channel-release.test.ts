// A223 (closed 2026-09-30): a full station that signs off for good keeps its channel 90 days, then
// the hourly pass frees the number, as an external station's is (A221). Only the channel goes: the
// call sign stays on the station's row (and held on the waitlist's side). A station back on air
// before then keeps it, a waitlist hold on the number still wins once it's free, and (A233) X.1
// whose call sign a station on the air still shares keeps its number until that one signs off too.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import { CHANNEL_HOLD_AFTER_SIGN_OFF_MS } from "@opencast/domain";
import { createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let sam: User;
let marketId: string;
const MIN = 60_000;

const activeChannel = async (stationId: string) =>
  (await h.db.select().from(schema.channels).where(and(eq(schema.channels.stationId, stationId), isNull(schema.channels.releasedAt))))[0] ?? null;
const pass = () => h.services.network.syncExternalSchedules({ fetch: (async () => new Response("")) as typeof fetch });
const signOffForGood = (id: string) => h.db.transaction((tx) => h.services.stations.markSignedOff(tx, id, true));

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-09-27T03:42:00.000Z");
  kai = await h.signIn("Kai");
  sam = await h.signIn("Sam");
  marketId = (await market(h)).id;
}, 60_000);
afterAll(() => h.close());

describe("a full station's channel after it signs off for good", () => {
  it("is freed at 90 days, not before, and only once", async () => {
    const gone = await stationFixture(h, { callSign: "GONE", name: "Gone TV", marketId, tenths: 411, signedOn: true, ownerId: kai.id });
    await signOffForGood(gone.id);
    h.clock.advance(CHANNEL_HOLD_AFTER_SIGN_OFF_MS - MIN);
    expect((await pass()).releasedStations).toBe(0);
    expect(await activeChannel(gone.id)).toMatchObject({ tenths: 411 });
    h.clock.advance(2 * MIN);
    expect((await pass()).releasedStations).toBe(1);
    expect(await activeChannel(gone.id)).toBeNull();
    // Only the channel: the call sign stays on its row.
    expect((await h.db.select().from(schema.stations).where(eq(schema.stations.id, gone.id)))[0]).toMatchObject({ callSign: "GONE", status: "signed_off" });
    expect((await pass()).releasedStations).toBe(0);
  });

  it("isn't freed when the station signed on again before then", async () => {
    const back = await stationFixture(h, { callSign: "BACK", name: "Back TV", marketId, tenths: 421, signedOn: true, ownerId: kai.id });
    await signOffForGood(back.id);
    h.clock.advance(10 * 86_400_000);
    await h.db.transaction((tx) => h.services.stations.markSignedOn(tx, back.id));
    h.clock.advance(CHANNEL_HOLD_AFTER_SIGN_OFF_MS);
    expect((await pass()).releasedStations).toBe(0);
    expect(await activeChannel(back.id)).toMatchObject({ tenths: 421 });
  });

  it("frees the number for a new station, and a waitlist hold on it still wins", async () => {
    const old = await stationFixture(h, { callSign: "OLDE", name: "Old TV", marketId, tenths: 431, signedOn: true, ownerId: kai.id });
    await signOffForGood(old.id);
    expect((await sam.get("/v1/markets/inland-empire/channels?band=tv").expect(200)).body.channels.find((c: { channel: string }) => c.channel === "43.1").state).toBe("taken");
    h.clock.advance(CHANNEL_HOLD_AFTER_SIGN_OFF_MS + MIN);
    await pass();
    expect((await sam.get("/v1/markets/inland-empire/channels?band=tv").expect(200)).body.channels.find((c: { channel: string }) => c.channel === "43.1").state).toBe("open");
    const fresh = (await sam.post("/v1/stations", { kind: "station", name: "New on 43" }).expect(201)).body.station.id;
    await sam.put(`/v1/stations/${fresh}/channel`, { marketId, band: "tv", channel: "43.1" }).expect(200);

    // Another freed number, held for the waitlist: only the hold's station can take it.
    const other = await stationFixture(h, { callSign: "OTHR", name: "Other TV", marketId, tenths: 441, signedOn: true, ownerId: kai.id });
    await signOffForGood(other.id);
    h.clock.advance(CHANNEL_HOLD_AFTER_SIGN_OFF_MS + MIN);
    await pass();
    const [reservation] = await h.db.insert(schema.callSignReservations).values({ callSign: "HELD", reason: "waitlist", marketId }).returning();
    await h.db.insert(schema.channelHolds).values({ reservationId: reservation.id, marketId, band: "tv", tenths: 441 });
    expect((await sam.get("/v1/markets/inland-empire/channels?band=tv").expect(200)).body.channels.find((c: { channel: string }) => c.channel === "44.1").state).toBe("held");
    const someone = (await sam.post("/v1/stations", { kind: "station", name: "Wants 44" }).expect(201)).body.station.id;
    expect((await sam.put(`/v1/stations/${someone}/channel`, { marketId, band: "tv", channel: "44.1" })).status).toBeGreaterThanOrEqual(400);
  });

  it("keeps X.1's number while a station sharing its call sign is on the air (A233)", async () => {
    const beat = await stationFixture(h, { callSign: "FAMX", name: "Family One", marketId, tenths: 451, signedOn: true, ownerId: kai.id });
    const tapes = (await kai.post("/v1/stations", { kind: "station", name: "Family Two" }).expect(201)).body.station.id;
    await kai.put(`/v1/stations/${tapes}/channel`, { marketId, band: "tv", channel: "45.2", shareCallSign: true }).expect(200);
    await h.db.update(schema.stations).set({ firstSignedOnAt: h.clock.now(), status: "on_air" }).where(eq(schema.stations.id, tapes));
    await signOffForGood(beat.id);
    h.clock.advance(CHANNEL_HOLD_AFTER_SIGN_OFF_MS + MIN);
    expect((await pass()).releasedStations).toBe(0);
    expect(await activeChannel(beat.id)).toMatchObject({ tenths: 451 });
    // The family's call sign stays with the one on air: nobody else takes it.
    expect((await sam.get("/v1/call-signs/FAMX").expect(200)).body.available).toBe(false);
    // Its last member signs off: X.1's number goes at the next pass; the member keeps its own 90 days.
    await signOffForGood(tapes);
    expect((await pass()).releasedStations).toBe(1);
    expect(await activeChannel(beat.id)).toBeNull();
    expect(await activeChannel(tapes)).toMatchObject({ tenths: 452 });
    h.clock.advance(CHANNEL_HOLD_AFTER_SIGN_OFF_MS + MIN);
    expect((await pass()).releasedStations).toBe(1);
    expect(await activeChannel(tapes)).toBeNull();
  });
});
