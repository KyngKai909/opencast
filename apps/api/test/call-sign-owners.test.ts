// A234 (b): a full-station family whose owners later differ. An owner's own stations can share X.1's
// call sign (12.1 BEAT, 12.2 BEAT), checked when the link is made. When owners change later and
// nobody owns both, nothing changes on air (the call sign is fixed); the Network desk is told once
// per split (in the app, by push and by email), sees it on the market board, and is told again only
// after the owners have had someone in common and split again. External families are the desk's own.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User; // an Opencast admin
let kai: User; // owns 12.1 BEAT and, at first, 12.2 BEAT
let jen: User;
let sam: User;
let marketId: string;
let beat: string;
let tapes: string;

type Notice = { kind: string; title: string; body: string; link: string | null };
const deskNotices = async () => ((await dee.get("/v1/me/notices").expect(200)).body as Notice[]).filter((n) => n.kind === "call_sign_owners");
const board = async (band = "tv") => (await dee.get(`/v1/admin/markets/inland-empire/board?band=${band}`).expect(200)).body;
const splitAt = async (id: string) => (await h.db.select({ at: schema.stations.ownersSplitAt }).from(schema.stations).where(eq(schema.stations.id, id)))[0]?.at ?? null;
const join = (stationId: string, user: User, role: "operator" | "owner" = "operator") => h.db.insert(schema.stationMemberships).values({ stationId, userId: user.id, role });
const transfer = async (by: User, stationId: string, to: User) => {
  await by.post(`/v1/stations/${stationId}/team/transfer`, { toUserId: to.id }).expect(200);
  await h.deps.bus.settle();
};

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-09-30T18:00:00.000Z");
  dee = await h.signIn("Dee A.", { admin: true });
  await h.db.update(schema.users).set({ email: "dee@opencast.example" }).where(eq(schema.users.id, dee.id));
  kai = await h.signIn("Kai");
  jen = await h.signIn("Jen");
  sam = await h.signIn("Sam");
  marketId = (await market(h)).id;
  beat = (await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", marketId, tenths: 121, signedOn: true, ownerId: kai.id })).id;
  tapes = (await kai.post("/v1/stations", { kind: "station", name: "Beat Tapes" }).expect(201)).body.station.id;
  await kai.put(`/v1/stations/${tapes}/channel`, { marketId, band: "tv", channel: "12.2", shareCallSign: true }).expect(200);
  // Signed on (as sign-on would): its call sign is fixed.
  await h.db.update(schema.stations).set({ firstSignedOnAt: h.clock.now(), status: "on_air" }).where(eq(schema.stations.id, tapes));
  await join(tapes, jen);
  await join(beat, sam);
}, 60_000);
afterAll(() => h.close());

describe("a family whose owners split (A234)", () => {
  it("tells the Network desk once, by name and channel, and shows it on the board", async () => {
    expect(await deskNotices()).toEqual([]);
    expect((await board()).ownersApart).toEqual([]);
    const sentBefore = h.sent.length;
    await transfer(kai, tapes, jen);

    const notices = await deskNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      title: "12.2 BEAT Beat Tapes no longer shares an owner with 12.1 BEAT Inland Beat",
      link: "/desk/markets/inland-empire/board?ch=12"
    });
    expect(notices[0]!.body).toBe(
      "Ownership of 12.2 BEAT moved from Kai to Jen. Jen owns 12.2 BEAT. Kai owns 12.1 BEAT. BEAT is fixed on air, so nothing changes by itself. Whether 12.2 keeps it is for you and the owners to decide."
    );
    // Push and email to the desk, the email opening the board on channel 12; nothing to the stations' teams.
    const sent = h.sent.slice(sentBefore).filter((s) => s.title === notices[0]!.title);
    expect(sent.map((s) => [s.channel, s.to])).toEqual([
      ["push", dee.id],
      ["email", "dee@opencast.example"]
    ]);
    expect(sent[1]!.link).toBe("https://app.opencast.test/desk/markets/inland-empire/board?ch=12");
    for (const u of [kai, jen, sam]) expect(((await u.get("/v1/me/notices").expect(200)).body as Notice[]).some((n) => n.kind === "call_sign_owners")).toBe(false);

    const tv = await board();
    expect(tv.ownersApart).toEqual([
      {
        head: expect.objectContaining({ id: beat, callSign: "BEAT", channel: "12.1" }),
        member: expect.objectContaining({ id: tapes, callSign: "BEAT", channel: "12.2", slug: "beat-12-2" }),
        since: "2026-09-30T18:00:00.000Z",
        headOwners: ["Kai"],
        memberOwners: ["Jen"],
        fixed: true
      }
    ]);
    expect((await board("radio")).ownersApart).toEqual([]);
    // Nothing changed on air: still sharing, the same call sign.
    const setup = (await jen.get(`/v1/stations/${tapes}/setup`).expect(200)).body;
    expect(setup.station).toMatchObject({ callSign: "BEAT", slug: "beat-12-2", sharesCallSign: true });
    expect(setup.sharesCallSignWith).toMatchObject({ id: beat });
  });

  it("doesn't tell it again on a later change while they're still apart", async () => {
    await join(tapes, sam);
    h.clock.set("2026-09-30T19:00:00.000Z");
    await transfer(jen, tapes, sam);
    expect(await deskNotices()).toHaveLength(1);
    const [apart] = (await board()).ownersApart;
    expect(apart).toMatchObject({ since: "2026-09-30T18:00:00.000Z", memberOwners: ["Sam"], headOwners: ["Kai"] });
  });

  it("clears it once they have an owner in common again", async () => {
    // Kai is still on 12.2's team (an operator since handing it over).
    await transfer(sam, tapes, kai);
    expect(await splitAt(tapes)).toBeNull();
    expect((await board()).ownersApart).toEqual([]);
    expect(await deskNotices()).toHaveLength(1);
  });

  it("tells it again when they split again, from X.1's side this time", async () => {
    h.clock.set("2026-09-30T20:00:00.000Z");
    await transfer(kai, beat, sam);
    const notices = await deskNotices();
    expect(notices).toHaveLength(2);
    expect(notices[0]).toMatchObject({ title: "12.2 BEAT Beat Tapes no longer shares an owner with 12.1 BEAT Inland Beat" });
    expect(notices[0]!.body).toContain("Ownership of 12.1 BEAT moved from Kai to Sam. Kai owns 12.2 BEAT. Sam owns 12.1 BEAT.");
    expect((await board()).ownersApart).toEqual([expect.objectContaining({ since: "2026-09-30T20:00:00.000Z", headOwners: ["Sam"], memberOwners: ["Kai"] })]);
    // Back to Kai (an operator on 12.1 since handing it over): together, cleared.
    await transfer(sam, beat, kai);
    expect((await board()).ownersApart).toEqual([]);
  });

  it("says a member that hasn't signed on can still take its own call sign, and doing so clears it", async () => {
    const hour = (await kai.post("/v1/stations", { kind: "station", name: "Beat Radio Hour" }).expect(201)).body.station.id;
    await kai.put(`/v1/stations/${hour}/channel`, { marketId, band: "tv", channel: "12.3", shareCallSign: true }).expect(200);
    await join(hour, jen);
    await transfer(kai, hour, jen);
    const [latest] = await deskNotices();
    expect(latest).toMatchObject({ title: "12.3 BEAT Beat Radio Hour no longer shares an owner with 12.1 BEAT Inland Beat" });
    expect(latest!.body).toBe("Ownership of 12.3 BEAT moved from Kai to Jen. Jen owns 12.3 BEAT. Kai owns 12.1 BEAT. Nothing changes by itself. Before 12.3 signs on, its owner can give it a call sign of its own.");
    expect((await board()).ownersApart).toEqual([expect.objectContaining({ member: expect.objectContaining({ id: hour }), fixed: false })]);
    await jen.patch(`/v1/stations/${hour}/setup`, { callSign: "BRHR" }).expect(200);
    expect(await splitAt(hour)).toBeNull();
    expect((await board()).ownersApart).toEqual([]);
  });

  it("hears an owner who takes an invite to their own station's team (and so stops owning it)", async () => {
    const before = (await deskNotices()).length;
    h.clock.set("2026-09-30T21:00:00.000Z");
    await h.db.update(schema.users).set({ email: "kai@example.com" }).where(eq(schema.users.id, kai.id));
    await h.db.insert(schema.identities).values({ userId: kai.id, kind: "email", value: "kai@example.com", verifiedAt: h.clock.now() });
    const invite = await kai.post(`/v1/stations/${tapes}/team/invites`, { email: "kai@example.com", role: "operator" }).expect(200);
    await kai.post(`/v1/invites/${invite.body.id}/accept`).expect(200);
    await h.deps.bus.settle();
    const notices = await deskNotices();
    expect(notices).toHaveLength(before + 1);
    expect(notices[0]!.body).toMatch(/^Kai no longer owns 12\.2 BEAT\. Nobody owns 12\.2 BEAT\. Kai owns 12\.1 BEAT\./);
    // Put back as it was, by hand (nobody can transfer a station without an owner).
    const m = schema.stationMemberships;
    await h.db.update(m).set({ role: "owner" }).where(and(eq(m.stationId, tapes), eq(m.userId, kai.id)));
    await h.services.stations.checkCallSignOwners(tapes);
    expect((await board()).ownersApart).toEqual([]);
  });
});

describe("what A234 leaves alone", () => {
  it("never marks an external family, or a station that shares nothing", async () => {
    const before = (await deskNotices()).length;
    const evidence = { publicBasis: "County government, public" };
    const add = (body: object) => dee.post("/v1/admin/listed-sources", { band: "tv", marketId, plays: "stream_link", evidence, ...body }).expect(201);
    await add({ channel: "15.1", callSign: "SBCO", name: "San Bernardino County", streamUrl: "https://county.example.gov/live/board/index.m3u8" });
    const member = (await add({ channel: "15.2", shareCallSign: true, name: "San Bernardino County, Public Works", streamUrl: "https://county.example.gov/live/works/index.m3u8" })).body.station.id;
    // Nobody owns an external station: as a full station that would be a split.
    await h.services.stations.checkCallSignOwners(member, { before: [], after: [] });
    expect(await splitAt(member)).toBeNull();

    const alone = await stationFixture(h, { callSign: "SOLO", name: "Solo", marketId, tenths: 221, signedOn: true, ownerId: jen.id });
    await join(alone.id, sam);
    await transfer(jen, alone.id, sam);
    await h.deps.bus.settle();
    expect(await deskNotices()).toHaveLength(before);
    expect((await board()).ownersApart).toEqual([]);
  });
});
