// Shared call signs (A229 to A232): one brand's streams on one channel's subchannels share a call
// sign, as real TV does (KCET, KCET-DT2). External stations: X.n beside an external X.1 in the same
// market and major. Full stations: an owner's own X.n beside their own X.1 (rule
// numbering.own_subchannels). Never mixed, and everywhere else a call sign stays unique, in the
// database as well as the API. Each family member has its own address (`/watch/sbco-15-2`), the old
// ones keep working, and only the call sign is shared: evidence, checks and outages stay per stream.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Fetch } from "../src/v1/modules/network/external.js";
import { anon, createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User; // an Opencast admin
let kai: User; // owns BEAT on 12.1
let sam: User; // owns nothing here
let marketId: string;
let desertId: string;
const ids: Record<string, string> = {};
const stationOf: Record<string, string> = {};

const URL = (n: string) => `https://county.example.gov/live/${n}/index.m3u8`;
const PUBLIC = { publicBasis: "County government, public" };
const playlist = () => new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nhd/index.m3u8\n");

const listing = async (id: string) => {
  const [listed, removed] = await Promise.all([dee.get(`/v1/admin/listed-sources?marketId=${marketId}`).expect(200), dee.get(`/v1/admin/listed-sources?marketId=${marketId}&show=removed`).expect(200)]);
  return [...listed.body, ...removed.body].find((s: { id: string }) => s.id === id);
};
type Row = { station: { callSign: string; channel: string; slug?: string; sharesCallSign?: boolean; name: string } };
const dial = async () => (await anon(h).get("/v1/markets/inland-empire/dial").expect(200)).body.rows as Row[];
const onDial = async () => (await dial()).map((r) => `${r.station.channel} ${r.station.callSign}`);
const station = (ref: string) => anon(h).get(`/v1/stations/${ref}`);

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-09-27T03:42:00.000Z");
  dee = await h.signIn("Dee A.", { admin: true });
  kai = await h.signIn("Kai");
  sam = await h.signIn("Sam");
  marketId = (await market(h)).id;
  desertId = (await market(h, "high-desert", "High Desert")).id;
  const beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", marketId, tenths: 121, signedOn: true, ownerId: kai.id });
  stationOf.BEAT = beat.id;
  const add = async (key: string, body: object) => {
    const res = await dee.post("/v1/admin/listed-sources", { band: "tv", marketId, plays: "stream_link", evidence: PUBLIC, ...body }).expect(201);
    ids[key] = res.body.id;
    stationOf[key] = res.body.station.id;
    return res.body;
  };
  await add("SBCO", { channel: "15.1", callSign: "SBCO", name: "San Bernardino County, Board of Supervisors", streamUrl: URL("board") });
  await add("DSRT", { marketId: desertId, channel: "15.1", callSign: "DSRT", name: "High Desert Access", streamUrl: URL("desert") });
}, 60_000);
afterAll(() => h.close());

describe("external stations sharing X.1's call sign", () => {
  it("lists X.2 and X.3 as the same brand as X.1, each with its own address", async () => {
    const pw = await dee.post("/v1/admin/listed-sources", { band: "tv", marketId, channel: "15.2", shareCallSign: true, name: "San Bernardino County, Public Works", streamUrl: URL("works"), plays: "stream_link", evidence: PUBLIC }).expect(201);
    ids.WORKS = pw.body.id;
    stationOf.WORKS = pw.body.station.id;
    expect(pw.body.station).toMatchObject({ callSign: "SBCO", channel: "15.2", slug: "sbco-15-2", sharesCallSign: true });
    expect(pw.body.family).toMatchObject({ role: "member", head: { callSign: "SBCO", channel: "15.1", slug: "sbco" }, members: [{ channel: "15.2" }] });
    // Its call sign can be given too, as long as it's X.1's.
    const lib = await dee.post("/v1/admin/listed-sources", { band: "tv", marketId, channel: "15.3", callSign: "SBCO", shareCallSign: true, name: "San Bernardino County Library Live", streamUrl: URL("library"), plays: "stream_link", evidence: PUBLIC }).expect(201);
    ids.LIB = lib.body.id;
    stationOf.LIB = lib.body.station.id;

    const rows = (await dial()).filter((r) => r.station.callSign === "SBCO");
    expect(rows.map((r) => [r.station.channel, r.station.slug, r.station.sharesCallSign, r.station.name])).toEqual([
      ["15.1", "sbco", true, "San Bernardino County, Board of Supervisors"],
      ["15.2", "sbco-15-2", true, "San Bernardino County, Public Works"],
      ["15.3", "sbco-15-3", true, "San Bernardino County Library Live"]
    ]);
    // Anyone who shares nothing is as before.
    expect((await dial()).find((r) => r.station.callSign === "BEAT")?.station).toMatchObject({ slug: "beat" });
    expect((await dial()).find((r) => r.station.callSign === "BEAT")?.station.sharesCallSign).toBeUndefined();
    expect((await listing(ids.SBCO)).family).toMatchObject({ role: "head", members: [{ channel: "15.2" }, { channel: "15.3" }] });
  });

  it("finds each by its address, and the call sign alone is X.1's", async () => {
    expect((await station("sbco").expect(200)).body.station).toMatchObject({ channel: "15.1" });
    expect((await station("SBCO").expect(200)).body.station).toMatchObject({ channel: "15.1" });
    expect((await station("sbco-15-2").expect(200)).body.station).toMatchObject({ channel: "15.2", name: "San Bernardino County, Public Works" });
    expect((await station("sbco-15-3").expect(200)).body.station).toMatchObject({ channel: "15.3" });
    expect((await station(stationOf.WORKS).expect(200)).body.station).toMatchObject({ slug: "sbco-15-2" });
    await station("sbco-15-9").expect(404);
    // Addresses that worked before still do: a station alone, with or without its channel.
    expect((await station("beat").expect(200)).body.station).toMatchObject({ channel: "12.1" });
    expect((await station("beat-12-1").expect(200)).body.station).toMatchObject({ callSign: "BEAT" });
    // Search finds all three, told apart by their channels.
    const found = await anon(h).get("/v1/search?q=SBCO&market=inland-empire").expect(200);
    expect(found.body.stations.map((s: { channel: string; slug: string }) => `${s.channel} ${s.slug}`).sort()).toEqual(["15.1 sbco", "15.2 sbco-15-2", "15.3 sbco-15-3"]);
  });

  it("is refused anywhere but X.n beside an external X.1 in the same market and major", async () => {
    const base = { band: "tv", marketId, shareCallSign: true, name: "Elsewhere", streamUrl: URL("elsewhere"), plays: "stream_link", evidence: PUBLIC };
    // X.1 itself.
    expect((await dee.post("/v1/admin/listed-sources", { ...base, channel: "16.1" }).expect(422)).body.error.code).toBe("cannot_share");
    // Beside a full station (external stations never sit beside one).
    await dee.post("/v1/admin/listed-sources", { ...base, channel: "12.2" }).expect(409);
    // A major with nothing on its .1.
    await dee.post("/v1/admin/listed-sources", { ...base, channel: "17.2" }).expect(400);
    // Another market's 15.1 is another brand: 15.2 there shares DSRT's, never SBCO's.
    const desert = await dee.post("/v1/admin/listed-sources", { ...base, marketId: desertId, channel: "15.2" }).expect(201);
    expect(desert.body.station).toMatchObject({ callSign: "DSRT", slug: "dsrt-15-2" });
    await dee.post("/v1/admin/listed-sources", { ...base, channel: "15.4", callSign: "DSRT" }).expect(400);
    // Without sharing, a call sign is unique as ever: SBCO on 15.4, or in another market.
    expect((await dee.post("/v1/admin/listed-sources", { ...base, shareCallSign: false, channel: "15.4", callSign: "SBCO" }).expect(409)).body.error.code).toBe("call_sign_taken");
    expect((await dee.post("/v1/admin/listed-sources", { ...base, shareCallSign: false, marketId: desertId, channel: "16.1", callSign: "SBCO" }).expect(409)).body.error.code).toBe("call_sign_taken");
    // No call sign and no sharing: one is needed.
    await dee.post("/v1/admin/listed-sources", { ...base, shareCallSign: undefined, channel: "15.4" }).expect(400);
  });

  it("is refused by the database outside a family, whatever the API does", async () => {
    const why = (p: Promise<unknown>) => p.then(() => "accepted", (e: Error & { cause?: Error & { constraint?: string } }) => `${e.cause?.constraint ?? ""} ${e.cause?.message ?? e.message}`);
    expect(await why(h.db.insert(schema.stations).values({ kind: "listed", callSign: "SBCO", name: "Impostor" }))).toMatch(/stations_call_sign/);
    // A full station can't join an external family, even written straight to the database.
    const full = await stationFixture(h, { callSign: "FULL", name: "Full", marketId, tenths: 221 });
    expect(await why(h.db.update(schema.stations).set({ callSign: "SBCO", sharesCallSignWith: stationOf.SBCO }).where(eq(schema.stations.id, full.id)))).toMatch(/never mixed/);
  });

  it("keeps evidence and checks per stream: a shared call sign shares nothing else", async () => {
    const waiting = await dee.post("/v1/admin/listed-sources", { band: "tv", marketId, channel: "15.4", shareCallSign: true, name: "San Bernardino County Parks", streamUrl: URL("parks"), plays: "stream_link" }).expect(201);
    ids.PARKS = waiting.body.id;
    expect(waiting.body).toMatchObject({ onDial: false, waiting: "needs_permission", station: { callSign: "SBCO", slug: "sbco-15-4" } });
    expect(await onDial()).not.toContain("15.4 SBCO");
    // One stream down: only it leaves the dial.
    const fn = (async (input: RequestInfo | globalThis.URL) => (String(input) === URL("works") ? new Response("", { status: 503 }) : playlist())) as Fetch;
    h.clock.set("2026-09-27T03:50:00.000Z");
    await h.services.network.checkExternalStations({ fetch: fn });
    h.clock.set("2026-09-27T03:56:00.000Z");
    await h.services.network.checkExternalStations({ fetch: fn });
    expect((await listing(ids.WORKS)).health.state).toBe("hidden");
    expect((await listing(ids.SBCO)).health.state).toBe("up");
    expect((await listing(ids.LIB)).health.state).toBe("up");
    expect(await onDial()).toEqual(expect.arrayContaining(["15.1 SBCO", "15.3 SBCO"]));
    expect(await onDial()).not.toContain("15.2 SBCO");
    h.clock.set("2026-09-27T03:57:00.000Z");
    await h.services.network.checkExternalStations({ fetch: playlist as unknown as Fetch });
    expect(await onDial()).toContain("15.2 SBCO");
    await dee.post(`/v1/admin/listed-sources/${ids.PARKS}/remove`).expect(200);
  });
});

describe("changing a family's call sign", () => {
  it("changes the whole family's on X.1, holds the old one for it, and keeps the old addresses", async () => {
    const res = await dee.patch(`/v1/admin/listed-sources/${ids.SBCO}`, { callSign: "SBCN" }).expect(200);
    expect(res.body.family.members.map((m: { callSign: string; slug: string }) => `${m.callSign} ${m.slug}`)).toEqual(["SBCN sbcn-15-2", "SBCN sbcn-15-3"]);
    expect((await listing(ids.WORKS)).station).toMatchObject({ callSign: "SBCN", slug: "sbcn-15-2" });
    // Each member's history says so.
    const history = (await dee.get(`/v1/admin/listed-sources/${ids.WORKS}/changes`).expect(200)).body;
    expect(history[0]).toMatchObject({ action: "changed", fields: [{ field: "callSign", from: "SBCO", to: "SBCN" }] });
    // Old addresses find their stations through the hold.
    expect((await station("sbco").expect(200)).body.station).toMatchObject({ callSign: "SBCN", channel: "15.1" });
    expect((await station("sbco-15-2").expect(200)).body.station).toMatchObject({ callSign: "SBCN", channel: "15.2" });
    expect((await station("sbcn-15-3").expect(200)).body.station).toMatchObject({ channel: "15.3" });
    // The old one is held for the family: nobody else gets it, the family can take it back.
    const hold = await h.db.select().from(schema.callSignReservations).where(eq(schema.callSignReservations.callSign, "SBCO"));
    expect(hold.filter((r) => !r.releasedAt)).toEqual([expect.objectContaining({ stationId: stationOf.SBCO, reason: "signed_off" })]);
    await dee.post("/v1/admin/listed-sources", { band: "tv", marketId, channel: "18.1", callSign: "SBCO", name: "Someone else", streamUrl: URL("else"), plays: "stream_link", evidence: PUBLIC }).expect(409);
    const back = await dee.patch(`/v1/admin/listed-sources/${ids.SBCO}`, { callSign: "SBCO" }).expect(200);
    expect(back.body.family.members.map((m: { callSign: string }) => m.callSign)).toEqual(["SBCO", "SBCO"]);
  });

  it("still respects a waitlist hold for anyone else", async () => {
    await h.db.insert(schema.callSignReservations).values({ callSign: "HOLD", reason: "waitlist" });
    expect((await dee.patch(`/v1/admin/listed-sources/${ids.SBCO}`, { callSign: "HOLD" }).expect(409)).body.error.code).toBe("call_sign_taken");
    expect((await dee.patch(`/v1/admin/listed-sources/${ids.LIB}`, { callSign: "HOLD" }).expect(409)).body.error.code).toBe("call_sign_taken");
  });

  it("lets a member leave by taking its own call sign, and come back", async () => {
    const left = await dee.patch(`/v1/admin/listed-sources/${ids.LIB}`, { callSign: "SBLL" }).expect(200);
    expect(left.body.station).toMatchObject({ callSign: "SBLL", slug: "sbll" });
    expect(left.body.station.sharesCallSign).toBeUndefined();
    expect(left.body.family).toBeNull();
    expect((await listing(ids.SBCO)).family.members.map((m: { channel: string }) => m.channel)).toEqual(["15.2"]);
    // The family's name isn't held for it: the family keeps it.
    expect((await h.db.select().from(schema.callSignReservations).where(eq(schema.callSignReservations.stationId, stationOf.LIB))).filter((r) => !r.releasedAt)).toEqual([]);
    // Sharing needs its own call sign given to stop.
    await dee.patch(`/v1/admin/listed-sources/${ids.WORKS}`, { shareCallSign: false }).expect(400);
    const back = await dee.patch(`/v1/admin/listed-sources/${ids.LIB}`, { shareCallSign: true }).expect(200);
    expect(back.body.station).toMatchObject({ callSign: "SBCO", slug: "sbco-15-3" });
    // Its own name while it had one is held for it, so /watch/sbll still finds it.
    expect((await station("sbll").expect(200)).body.station).toMatchObject({ callSign: "SBCO", channel: "15.3" });
  });

  it("keeps X.1 where it is while a family shares its call sign; a member moves within the major", async () => {
    expect((await dee.patch(`/v1/admin/listed-sources/${ids.SBCO}`, { channel: "19.1" }).expect(409)).body.error.code).toBe("family_channel");
    const moved = await dee.patch(`/v1/admin/listed-sources/${ids.LIB}`, { channel: "15.5" }).expect(200);
    expect(moved.body.station).toMatchObject({ callSign: "SBCO", slug: "sbco-15-5" });
    // To another major it can't keep X.1's call sign: its own, or nothing moves.
    await dee.patch(`/v1/admin/listed-sources/${ids.LIB}`, { channel: "19.1" }).expect(400);
    await dee.patch(`/v1/admin/listed-sources/${ids.LIB}`, { channel: "15.3" }).expect(200);
  });
});

describe("taking a family off the dial (A231)", () => {
  it("takes X.1 off only with its family, named, and puts them back together", async () => {
    const refused = await dee.post(`/v1/admin/listed-sources/${ids.SBCO}/remove`).expect(409);
    expect(refused.body.error).toMatchObject({ code: "family" });
    expect(refused.body.error.message).toContain("15.2 SBCO, 15.3 SBCO");
    await dee.post(`/v1/admin/listed-sources/${ids.SBCO}/remove`, { withFamily: true }).expect(200);
    expect((await onDial()).filter((s) => s.endsWith("SBCO"))).toEqual([]);
    expect(await listing(ids.WORKS)).toMatchObject({ listingState: "not_listed", removed: { channel: "15.2", withListing: ids.SBCO } });
    await station("sbco-15-2").expect(404);
    // One held for X.1, the family's.
    const holds = (await h.db.select().from(schema.callSignReservations).where(eq(schema.callSignReservations.callSign, "SBCO"))).filter((r) => !r.releasedAt);
    expect(holds.map((r) => r.stationId)).toEqual([stationOf.SBCO]);
    // A member comes back after X.1.
    expect((await dee.post(`/v1/admin/listed-sources/${ids.WORKS}/restore`, {}).expect(409)).body.error.code).toBe("family_removed");
    await dee.post(`/v1/admin/listed-sources/${ids.SBCO}/restore`, {}).expect(200);
    expect(await listing(ids.WORKS)).toMatchObject({ listingState: "listed", removed: null, station: { callSign: "SBCO", channel: "15.2" } });
    expect(await onDial()).toEqual(expect.arrayContaining(["15.1 SBCO", "15.2 SBCO", "15.3 SBCO"]));
    // Parks was taken off alone before: it stays off.
    expect(await listing(ids.PARKS)).toMatchObject({ listingState: "not_listed" });
  });

  it("takes a member off alone, leaving the name with its family", async () => {
    await dee.post(`/v1/admin/listed-sources/${ids.LIB}/remove`).expect(200);
    expect((await listing(ids.SBCO)).family.members.map((m: { channel: string }) => m.channel)).toEqual(["15.2"]);
    const holds = (await h.db.select().from(schema.callSignReservations).where(eq(schema.callSignReservations.callSign, "SBCO"))).filter((r) => !r.releasedAt);
    expect(holds).toEqual([]);
    await dee.post(`/v1/admin/listed-sources/${ids.LIB}/restore`, {}).expect(200);
    expect((await listing(ids.SBCO)).family.members.map((m: { channel: string }) => m.channel)).toEqual(["15.2", "15.3"]);
  });
});

describe("an owner's own stations sharing a call sign (A230)", () => {
  let tapes: string;

  it("offers the owner their own subchannel, and it shares X.1's call sign", async () => {
    tapes = (await kai.post("/v1/stations", { kind: "station", name: "Beat Tapes" }).expect(201)).body.station.id;
    const open = await kai.get("/v1/markets/inland-empire/channels?band=tv").expect(200);
    expect(open.body.ownSubchannels).toEqual([{ channel: "12.2", beside: expect.objectContaining({ callSign: "BEAT", channel: "12.1" }) }]);
    expect((await sam.get("/v1/markets/inland-empire/channels?band=tv").expect(200)).body.ownSubchannels).toEqual([]);
    const chosen = await kai.put(`/v1/stations/${tapes}/channel`, { marketId, band: "tv", channel: "12.2", shareCallSign: true }).expect(200);
    expect(chosen.body.station).toMatchObject({ callSign: "BEAT", channel: "12.2", slug: "beat-12-2", sharesCallSign: true });
    expect(chosen.body.sharesCallSignWith).toMatchObject({ callSign: "BEAT", channel: "12.1" });
    expect((await kai.get(`/v1/stations/${stationOf.BEAT}/setup`).expect(200)).body.callSignFamily).toEqual([expect.objectContaining({ channel: "12.2", slug: "beat-12-2" })]);
  });

  it("is refused beside someone else's X.1, beside an external one, and when the desk turns it off", async () => {
    const theirs = (await sam.post("/v1/stations", { kind: "station", name: "Not Beat" }).expect(201)).body.station.id;
    expect((await sam.put(`/v1/stations/${theirs}/channel`, { marketId, band: "tv", channel: "12.3", shareCallSign: true }).expect(409)).body.error.code).toBe("not_your_subchannel");
    expect((await sam.put(`/v1/stations/${theirs}/channel`, { marketId, band: "tv", channel: "12.3" }).expect(409)).body.error.code).toBe("not_your_subchannel");
    const kais = (await kai.post("/v1/stations", { kind: "station", name: "Beat County" }).expect(201)).body.station.id;
    expect((await kai.put(`/v1/stations/${kais}/channel`, { marketId, band: "tv", channel: "15.6", shareCallSign: true }).expect(409)).body.error.code).toBe("not_your_subchannel");
    // A subchannel already taken.
    expect((await kai.put(`/v1/stations/${kais}/channel`, { marketId, band: "tv", channel: "12.2" }).expect(409)).body.error.code).toBe("channel_taken");
    await h.db.insert(schema.rules).values({ key: "numbering.own_subchannels", value: { allowed: false }, effectiveFrom: new Date("2026-09-01T00:00:00Z"), note: "test" });
    await kai.put(`/v1/stations/${kais}/channel`, { marketId, band: "tv", channel: "12.3" }).expect(400);
    expect((await kai.get("/v1/markets/inland-empire/channels?band=tv").expect(200)).body.ownSubchannels).toEqual([]);
    await h.db.delete(schema.rules).where(eq(schema.rules.key, "numbering.own_subchannels"));
  });

  it("keeps X.1 put, and lets a member take its own call sign before it signs on, never after", async () => {
    // BEAT has signed on: its call sign was fixed anyway; its channel is too.
    const second = (await kai.post("/v1/stations", { kind: "station", name: "Beat Radio Hour" }).expect(201)).body.station.id;
    await kai.put(`/v1/stations/${second}/channel`, { marketId, band: "tv", channel: "12.3", shareCallSign: true }).expect(200);
    const own = await kai.patch(`/v1/stations/${second}/setup`, { callSign: "BRHR" }).expect(200);
    expect(own.body.station).toMatchObject({ callSign: "BRHR", slug: "brhr" });
    expect(own.body.sharesCallSignWith).toBeNull();
    // Sign Beat Tapes on (as sign-on would), then its call sign is fixed.
    await h.db.update(schema.stations).set({ firstSignedOnAt: h.clock.now(), status: "on_air" }).where(eq(schema.stations.id, tapes));
    expect((await kai.patch(`/v1/stations/${tapes}/setup`, { callSign: "TAPE" }).expect(422)).body.error.code).toBe("fixed_after_sign_on");
    // Its address, and BEAT's, on the dial and the station page.
    expect((await station("beat-12-2").expect(200)).body.station).toMatchObject({ name: "Beat Tapes", callSign: "BEAT" });
    expect((await station("beat").expect(200)).body.station).toMatchObject({ name: "Inland Beat", channel: "12.1" });
    expect((await dial()).filter((r) => r.station.callSign === "BEAT").map((r) => r.station.slug)).toEqual(["beat", "beat-12-2"]);
  });

  it("links master control's emails to the family member's own address", async () => {
    await h.db.update(schema.users).set({ email: "kai@example.com" }).where(eq(schema.users.id, kai.id));
    const gap = new Date(h.clock.now().getTime() + 30 * 60_000).toISOString();
    h.deps.bus.emit("station.dead_air_warning", { stationId: tapes, gapStartsAt: gap, minutesBefore: 30 });
    await h.deps.bus.settle();
    const dead = h.sent.filter((s) => s.channel === "email" && s.to === "kai@example.com" && s.title === "Dead air in 30 minutes");
    // A246: straight to the gap on the Schedule (Saturday night's broadcast day).
    expect(dead.map((d) => d.link)).toEqual([`https://app.opencast.test/control/beat-12-2/schedule?day=2026-09-26&fill=${gap}`]);
  });
});
