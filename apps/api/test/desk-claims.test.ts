// Network desk, Rights claims (follow-up Phase 0 item 11, desk-pages 01): every claim on every
// station for the desk, scoped to a market lead's markets; each claim's timeline and carriers (the
// stations it was pulled from, and carriers under an agreement with nothing scheduled); privacy
// complaints, which have no answer window and never count toward the repeat limit; and outcomes
// recorded by a rights reviewer.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { anon, createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User; // admin
let sam: User; // rights reviewer
let lee: User; // market lead, Inland Empire
let pat: User; // not on the team
let beatOwner: User;
let mojvOwner: User;
let ie: { id: string; slug: string };
let hd: { id: string; slug: string };
let beat: { id: string };
let reel: { id: string };
let prep: { id: string };
let mojv: { id: string };
let lateCrate: { id: string };
let copyrightId: string;
let privacyId: string;

const DAY = 86_400_000;
const email = (u: User, address: string) => h.db.update(schema.users).set({ email: address }).where(eq(schema.users.id, u.id));
const file = (itemId: string, extra: Record<string, unknown> = {}) =>
  anon(h)
    .post("/v1/claims")
    .send({ itemId, claimantName: "Northside Records", claimantContact: "legal@northside.example", workKind: "Two tracks in the second half", claimText: "Two of our tracks play from 31:00.", swornStatement: true, ...extra })
    .expect(201);
type Row = { id: string; kind: string; phase: string; carriers: Array<{ station: { callSign: string }; airingsPulled: number; pulledAt: string | null }>; timeline: Array<{ step: string; state: string; at: string | null }> };
const claimIn = (body: { claims: Row[] }, id: string) => body.claims.find((c) => c.id === id)!;

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-01T19:00:00.000Z");
  ie = await market(h);
  hd = await market(h, "high-desert", "High Desert");
  dee = await h.signIn("Dee A.", { admin: true });
  sam = await h.signIn("Sam K.");
  lee = await h.signIn("Lee R.");
  pat = await h.signIn("Pat O.");
  beatOwner = await h.signIn("Kai");
  const reelOwner = await h.signIn("Reel owner");
  const prepOwner = await h.signIn("Prep owner");
  await email(sam, "sam@opencast.test");
  await email(lee, "lee@opencast.test");
  await email(beatOwner, "kai@inlandbeat.example");
  await dee.post("/v1/admin/desk/team", { email: "sam@opencast.test", roles: [{ role: "rights_reviewer" }] }).expect(200);
  await dee.post("/v1/admin/desk/team", { email: "lee@opencast.test", roles: [{ role: "market_lead", marketId: ie.id }] }).expect(200);

  beat = await stationFixture(h, { callSign: "BEAT", ownerId: beatOwner.id, marketId: ie.id, tenths: 121, signedOn: true, colour: "#8C3B7A" });
  reel = await stationFixture(h, { callSign: "REEL", ownerId: reelOwner.id, marketId: ie.id, tenths: 241, signedOn: true });
  prep = await stationFixture(h, { callSign: "PREP", ownerId: prepOwner.id, marketId: ie.id, tenths: 311, signedOn: true });
  mojvOwner = await h.signIn("Mojave owner");
  mojv = await stationFixture(h, { callSign: "MOJV", ownerId: mojvOwner.id, marketId: hd.id, tenths: 141, signedOn: true });

  // BEAT makes Late Crate; REEL and PREP carry it. REEL has an airing scheduled, PREP nothing yet.
  const program = await beatOwner.post(`/v1/stations/${beat.id}/programs`, { title: "Late Crate", description: "Records from the crate." }).expect(201);
  lateCrate = await itemFixture(h, beat.id, { programId: program.body.id, episodeNumber: 9, title: "Late Crate, ep. 9", durationMs: 55 * 60_000 });
  const offer = await beatOwner
    .post(`/v1/programs/${program.body.id}/offer`, {
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
    })
    .expect(201);
  const agreements: Record<string, string> = {};
  for (const [carrier, owner] of [
    [reel, reelOwner],
    [prep, prepOwner]
  ] as const) {
    const req = await owner.post(`/v1/catalog/offers/${offer.body.id}/requests`, { carrierStationId: carrier.id, term: "barter", slots: [{ weekday: 6, time: "20:00" }], startsOn: "2026-10-01" }).expect(201);
    await beatOwner.post(`/v1/carriage/requests/${req.body.id}/decision`, { decision: "approve" }).expect(200);
    agreements[carrier.id] = (await owner.get(`/v1/stations/${carrier.id}/carriage/agreements`).expect(200)).body.carrying[0].id;
  }
  await beatOwner.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-02T03:00:00.000Z", itemId: lateCrate.id }).expect(201);
  await reelOwner.post(`/v1/stations/${reel.id}/log`, { kind: "program", startsAt: "2026-10-04T03:00:00.000Z", itemId: lateCrate.id, carriageAgreementId: agreements[reel.id] }).expect(201);
}, 90_000);
afterAll(() => h.close());

describe("the desk's list of claims", () => {
  it("files a copyright claim and a privacy complaint; the list shows both, newest first", async () => {
    copyrightId = (await file(lateCrate.id)).body.claimId;
    h.clock.advance(60_000);
    const council = await itemFixture(h, mojv.id, { title: "Council Watch, Sept 22" });
    const privacy = await file(council.id, { kind: "privacy", claimantName: "A resident", workKind: "Their face shown without consent", claimText: "I'm shown at 04:10 without my consent." });
    privacyId = privacy.body.claimId;

    const list = await dee.get("/v1/admin/claims").expect(200);
    expect(list.body.claims.map((c: Row) => [c.id, c.kind, c.phase])).toEqual([
      [privacyId, "privacy", "open"],
      [copyrightId, "copyright", "open"]
    ]);
    // The desk sees the claimant's contact; stations never do.
    expect(claimIn(list.body, copyrightId)).toMatchObject({ claimantContact: "legal@northside.example", market: { slug: "inland-empire" }, station: { callSign: "BEAT" }, stationEmail: "kai@inlandbeat.example" });
    expect(list.body.rules).toEqual({ repeatLimit: 3, answerDays: 14, counterNoticeBusinessDays: 10 });
    expect(list.body.canResolve).toBe(true);
  });

  it("counts every carrier: pulled from REEL's log, and PREP under its agreement with nothing scheduled", async () => {
    const list = await dee.get("/v1/admin/claims").expect(200);
    const c = claimIn(list.body, copyrightId);
    expect(c.carriers.map((k) => [k.station.callSign, k.airingsPulled, k.pulledAt !== null])).toEqual([
      ["REEL", 1, true],
      ["PREP", 0, false]
    ]);
    // Pulled from every log at once: BEAT's own airing too.
    expect((await beatOwner.get(`/v1/stations/${beat.id}/claims`).expect(200)).body.claims[0].takedowns.map((t: { station: { callSign: string } }) => t.station.callSign).sort()).toEqual(["BEAT", "REEL"]);
    expect(list.body.stats).toMatchObject({ open: 2, offAir: 2, carryingStations: 2, nearRepeatLimit: 0 });
  });

  it("builds a copyright claim's timeline: received, off air, the answer's deadline", async () => {
    const c = claimIn((await dee.get("/v1/admin/claims").expect(200)).body, copyrightId);
    expect(c.timeline).toEqual([
      { step: "received", state: "done", at: "2026-10-01T19:00:00.000Z" },
      { step: "off_air", state: "done", at: "2026-10-01T19:00:00.000Z" },
      { step: "answer_due", state: "current", at: "2026-10-15T19:00:00.000Z" }
    ]);
    expect(c).toMatchObject({ next: { kind: "answer", at: "2026-10-15T19:00:00.000Z" }, daysToAnswer: 14 });
  });

  it("counts an answer due soon", async () => {
    h.clock.advance(12 * DAY);
    const list = await dee.get("/v1/admin/claims").expect(200);
    expect(list.body.stats).toMatchObject({ answersDue: 1, soonestAnswerDays: 2 });
    h.clock.advance(-12 * DAY);
  });
});

describe("who sees what", () => {
  it("shows a market lead their own market's claims only", async () => {
    const mine = await lee.get("/v1/admin/claims").expect(200);
    expect(mine.body.claims.map((c: Row) => c.id)).toEqual([copyrightId]);
    expect(mine.body.canResolve).toBe(false);
    expect((await lee.get(`/v1/admin/claims?marketId=${ie.id}`).expect(200)).body.claims).toHaveLength(1);
    const other = await lee.get(`/v1/admin/claims?marketId=${hd.id}`).expect(403);
    expect(other.body.error.code).toBe("desk_role");
    // A rights reviewer sees every market, and can narrow to one.
    expect((await sam.get("/v1/admin/claims").expect(200)).body.claims).toHaveLength(2);
    expect((await sam.get(`/v1/admin/claims?marketId=${hd.id}`).expect(200)).body.claims.map((c: Row) => c.id)).toEqual([privacyId]);
    // Off the team: nothing.
    await pat.get("/v1/admin/claims").expect(403);
    await anon(h).get("/v1/admin/claims").expect(401);
  });

  it("lets a rights reviewer or an admin record an outcome, not a market lead or a station", async () => {
    const lead = await lee.post(`/v1/claims/${copyrightId}/resolve`, { outcome: "withdrawn" }).expect(403);
    expect(lead.body.error.code).toBe("desk_role");
    await beatOwner.post(`/v1/claims/${copyrightId}/resolve`, { outcome: "withdrawn" }).expect(403);
  });
});

describe("a privacy complaint", () => {
  it("has no answer window: Opencast reviews it", async () => {
    const c = claimIn((await dee.get("/v1/admin/claims").expect(200)).body, privacyId);
    expect(c).toMatchObject({ daysToAnswer: null, next: { kind: "review", at: null } });
    expect(c.timeline.map((s) => [s.step, s.state])).toEqual([
      ["received", "done"],
      ["off_air", "done"],
      ["review", "current"]
    ]);
  });

  it("is refused as an answer", async () => {
    await mojvOwner.patch(`/v1/stations/${mojv.id}/setup`, { legalName: "Mojave TV", legalContact: "legal@mojave.example" }).expect(200);
    const res = await mojvOwner.post(`/v1/claims/${privacyId}/answer`, { basis: "made_it", attest: true }).expect(422);
    expect(res.body.error.code).toBe("privacy_claim");
  });

  it("upheld, stays off and doesn't count toward the repeat limit", async () => {
    const resolved = await sam.post(`/v1/claims/${privacyId}/resolve`, { outcome: "upheld" }).expect(200);
    expect(resolved.body).toMatchObject({ kind: "privacy", state: "upheld" });
    const list = await dee.get("/v1/admin/claims").expect(200);
    const c = claimIn(list.body, privacyId);
    expect(c.phase).toBe("closed");
    expect(c.timeline.map((s) => s.step)).toEqual(["received", "off_air", "upheld"]);
    expect(list.body.stations.find((s: { station: { callSign: string } }) => s.station.callSign === "MOJV")).toMatchObject({ open: 0, closed: 1, upheldLast12Months: 0, standing: "good" });
  });
});

describe("answered, then resolved", () => {
  it("answered: the counter-notice, back on air everywhere, and the claimant's time", async () => {
    await beatOwner.patch(`/v1/stations/${beat.id}/setup`, { legalName: "Inland Beat LLC", legalContact: "rights@inlandbeat.example" }).expect(200);
    h.clock.advance(DAY);
    await beatOwner.post(`/v1/claims/${copyrightId}/answer`, { basis: "owner_permission", note: "The label licensed both tracks.", attest: true }).expect(200);
    const list = await dee.get("/v1/admin/claims").expect(200);
    const c = claimIn(list.body, copyrightId);
    expect(c.timeline).toEqual([
      { step: "received", state: "done", at: "2026-10-01T19:00:00.000Z" },
      { step: "off_air", state: "done", at: "2026-10-01T19:00:00.000Z" },
      { step: "answered", state: "done", at: "2026-10-02T19:01:00.000Z" },
      { step: "counter_notice", state: "done", at: "2026-10-02T19:01:00.000Z" },
      { step: "back_on_air", state: "done", at: "2026-10-02T19:01:00.000Z" },
      { step: "reply_due", state: "current", at: "2026-10-16T19:01:00.000Z" }
    ]);
    expect(c).toMatchObject({ state: "answered", phase: "open", next: { kind: "reply", at: "2026-10-16T19:01:00.000Z" }, stationEmail: "rights@inlandbeat.example" });
    expect(list.body.stats).toMatchObject({ open: 1, offAir: 0, answersDue: 0, soonestAnswerDays: null });
  });

  it("restored by a rights reviewer: closed, and only once", async () => {
    await sam.post(`/v1/claims/${copyrightId}/resolve`, { outcome: "restored" }).expect(200);
    const c = claimIn((await sam.get("/v1/admin/claims").expect(200)).body, copyrightId);
    expect(c).toMatchObject({ phase: "closed", next: null });
    expect(c.timeline.map((s) => s.step)).toEqual(["received", "off_air", "answered", "counter_notice", "back_on_air", "restored"]);
    // Closed claims keep only the stations it was pulled from.
    expect(c.carriers.map((k) => k.station.callSign)).toEqual(["REEL"]);
    const again = await sam.post(`/v1/claims/${copyrightId}/resolve`, { outcome: "upheld" }).expect(409);
    expect(again.body.error.code).toBe("not_open");
  });
});

describe("the repeat limit", () => {
  it("marks a station one upheld claim from the limit, from the rules registry", async () => {
    const tape = await stationFixture(h, { callSign: "TAPE", marketId: ie.id, tenths: 451, signedOn: true });
    for (const n of [1, 2]) {
      const item = await itemFixture(h, tape.id, { title: `Borrowed ${n}` });
      const filed = await file(item.id);
      await dee.post(`/v1/claims/${filed.body.claimId}/resolve`, { outcome: "upheld" }).expect(200);
    }
    const list = await dee.get("/v1/admin/claims").expect(200);
    expect(list.body.stations[0]).toMatchObject({ station: { callSign: "TAPE" }, closed: 2, upheldLast12Months: 2, standing: "near_limit" });
    expect(list.body.stats.nearRepeatLimit).toBe(1);
    // The station's own standing counts the same claims.
    expect((await h.services.trust.standing(tape.id)).upheldLast12Months).toBe(2);
    // The limit comes from Settings: at 2, TAPE is at it.
    await dee.post("/v1/admin/rules/rights.repeat_limit/versions", { value: { upheldIn12Months: 2 }, effectiveFrom: new Date(h.clock.now().getTime()).toISOString() }).expect(200);
    const after = await dee.get("/v1/admin/claims").expect(200);
    expect(after.body.rules.repeatLimit).toBe(2);
    expect(after.body.stations[0]).toMatchObject({ station: { callSign: "TAPE" }, standing: "offers_paused" });
  });
});

describe("no answer window for privacy", () => {
  it("never expires a privacy complaint: it waits for Opencast's review", async () => {
    const item = await itemFixture(h, mojv.id, { title: "Council Watch, Sept 29" });
    const filed = await file(item.id, { kind: "privacy", claimantName: "A resident" });
    h.clock.advance(30 * DAY);
    expect(await h.services.trust.expireOverdue()).toBe(0);
    const c = claimIn((await dee.get("/v1/admin/claims").expect(200)).body, filed.body.claimId);
    expect(c).toMatchObject({ state: "open", phase: "open", next: { kind: "review" } });
    h.clock.advance(-30 * DAY);
  });
});
