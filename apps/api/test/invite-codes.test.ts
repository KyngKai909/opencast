// Invite-only sign-ups (added 2026-10-07, the user's request): someone signed in waits until a code,
// a team invite or the desk lets them in; everyone in makes up to 10 one-use codes; the desk makes
// its own in batches. While invite-only is off, everyone is let in at once.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User; // admin
let kai: User; // already in

beforeAll(async () => {
  h = await createHarness({ inviteOnly: true });
  h.clock.set("2026-10-07T18:00:00.000Z");
  await market(h);
  dee = await h.signIn("Dee A.", { admin: true });
  kai = await h.signIn("Kai");
  // Kai was here before invite-only: in, as migration 0060 did for everyone.
  await h.db.update(schema.users).set({ admittedAt: new Date("2026-10-01T00:00:00Z"), admittedHow: "existing" }).where(eq(schema.users.id, kai.id));
}, 60_000);
afterAll(() => h.close());

describe("waiting to be let in", () => {
  it("can see their account, redeem, sign out or delete; everything else says invite_required", async () => {
    const newcomer = await h.signIn("New");
    expect((await newcomer.get("/v1/me").expect(200)).body).toMatchObject({ admitted: false });
    const refused = await newcomer.post("/v1/stations", { name: "Mine" }).expect(403);
    expect(refused.body.error.code).toBe("invite_required");
    await newcomer.get("/v1/me/invite-codes").expect(403);
    // An admin is let in when they sign in.
    expect((await dee.get("/v1/me").expect(200)).body).toMatchObject({ admitted: true });
  });
});

describe("the desk's codes", () => {
  it("makes a batch, each good for its number of people; anyone can check one first", async () => {
    const made = (await dee.post("/v1/admin/invite-codes", { count: 2, maxUses: 2, note: "First batch", expiresAt: null }).expect(201)).body;
    expect(made).toHaveLength(2);
    expect(made[0]).toMatchObject({ kind: "internal", maxUses: 2, uses: 0, note: "First batch" });
    expect(made[0].code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    const code: string = made[0].code;

    const check = await request(h.app).get(`/v1/invite-codes/${code.toLowerCase()}`).expect(200);
    expect(check.body).toEqual({ usable: true, reason: null, from: "Opencast" });

    const one = await h.signIn("One");
    const two = await h.signIn("Two");
    const three = await h.signIn("Three");
    expect((await one.post(`/v1/invite-codes/${code}/redeem`).expect(200)).body).toMatchObject({ admitted: true });
    await one.get("/v1/me/invite-codes").expect(200);
    // Spaces, dashes and case don't matter.
    await two.post(`/v1/invite-codes/${code.replace("-", "").toLowerCase()}/redeem`).expect(200);
    const used = await three.post(`/v1/invite-codes/${code}/redeem`).expect(409);
    expect(used.body.error.code).toBe("invite_used");
    // Redeeming again once in spends nothing.
    await one.post(`/v1/invite-codes/${made[1].code}/redeem`).expect(200);
    const desk = (await dee.get("/v1/admin/invite-codes").expect(200)).body;
    expect(desk.internal.find((c: { code: string }) => c.code === made[1].code).uses).toBe(0);
    expect(desk.internal.find((c: { code: string }) => c.code === code)).toMatchObject({ uses: 2, joined: expect.arrayContaining([expect.objectContaining({ name: "Two" }), expect.objectContaining({ name: "One" })]) });

    await h.signIn("Market lead").then((u) => u.get("/v1/admin/invite-codes").expect(403));
  });

  it("refuses unknown, taken back and expired codes", async () => {
    const someone = await h.signIn("Someone");
    expect((await someone.post("/v1/invite-codes/AAAA-AAAA/redeem").expect(404)).body.error.code).toBe("not_found");
    const [late, revoked] = (await dee.post("/v1/admin/invite-codes", { count: 2, maxUses: null, note: null, expiresAt: "2026-10-07T17:00:00.000Z" }).expect(201)).body;
    expect((await someone.post(`/v1/invite-codes/${late.code}/redeem`).expect(422)).body.error.code).toBe("invite_expired");
    await dee.delete(`/v1/admin/invite-codes/${revoked.code}`).expect(200);
    expect((await someone.post(`/v1/invite-codes/${revoked.code}/redeem`).expect(409)).body.error.code).toBe("invite_revoked");
  });
});

describe("a person's own codes", () => {
  it("makes up to their allowance, one person each; a code taken back unused goes back", async () => {
    const mine = (await kai.get("/v1/me/invite-codes").expect(200)).body;
    expect(mine).toMatchObject({ inviteOnly: true, allowance: 10, left: 10, codes: [] });
    const code = (await kai.post("/v1/me/invite-codes").expect(201)).body;
    expect(code).toMatchObject({ kind: "personal", maxUses: 1, uses: 0 });

    const friend = await h.signIn("Friend");
    await friend.post(`/v1/invite-codes/${code.code}/redeem`).expect(200);
    const after = (await kai.get("/v1/me/invite-codes").expect(200)).body;
    expect(after.left).toBe(9);
    expect(after.codes[0]).toMatchObject({ uses: 1, joined: [expect.objectContaining({ name: "Friend" })] });
    expect((await kai.delete(`/v1/me/invite-codes/${code.code}`).expect(409)).body.error.code).toBe("invite_used");

    const spare = (await kai.post("/v1/me/invite-codes").expect(201)).body;
    expect((await kai.delete(`/v1/me/invite-codes/${spare.code}`).expect(200)).body.left).toBe(9);
    expect((await request(h.app).get(`/v1/invite-codes/${code.code}`).expect(200)).body).toEqual({ usable: false, reason: "used", from: "Kai" });

    // The friend is in and gets their own.
    expect((await friend.get("/v1/me/invite-codes").expect(200)).body.left).toBe(10);
  });

  it("stops at the allowance", async () => {
    await h.db.insert(schema.rules).values({ key: "signups.codes_per_person", value: { codes: 1 }, effectiveFrom: new Date("2026-10-07T00:00:00Z"), note: "Test" });
    const pat = await h.signIn("Pat");
    await h.db.update(schema.users).set({ admittedAt: new Date(), admittedHow: "desk" }).where(eq(schema.users.id, pat.id));
    await pat.post("/v1/me/invite-codes").expect(201);
    expect((await pat.post("/v1/me/invite-codes").expect(409)).body.error.code).toBe("no_invites_left");
    await h.db.delete(schema.rules).where(eq(schema.rules.note, "Test"));
  });
});

describe("other ways in", () => {
  it("a team invite lets someone in", async () => {
    const station = await stationFixture(h, { callSign: "BEAT", ownerId: kai.id });
    const invite = (await kai.post(`/v1/stations/${station.id}/team/invites`, { email: "op@example.test", role: "operator" }).expect(200)).body;
    const op = await h.signIn("Op", { linked: [{ kind: "email", value: "op@example.test" }] });
    expect((await op.post(`/v1/invites/${invite.id}/accept`).expect(200)).body).toMatchObject({ admitted: true });
  });

  it("the desk sees who's waiting and lets them in; how everyone came in", async () => {
    const waiting = await h.signIn("Waiting");
    const before = (await dee.get("/v1/admin/invite-codes").expect(200)).body;
    expect(before.waiting.map((w: { name: string }) => w.name)).toContain("Waiting");
    const after = (await dee.post("/v1/admin/invite-codes/let-in", { userId: waiting.id }).expect(200)).body;
    expect(after.waiting.map((w: { name: string }) => w.name)).not.toContain("Waiting");
    expect(after.counts).toMatchObject({ byInternalCode: 2, byPersonalCode: 1, byTeamInvite: 1, byDesk: 2 });
    expect(after.topInviters).toEqual([{ name: "Kai", email: null, joined: 1 }]);
    expect((await waiting.get("/v1/me").expect(200)).body.admitted).toBe(true);
  });

  it("with invite-only off, everyone signing in is let in", async () => {
    await h.db.insert(schema.rules).values({ key: "signups.invite_only", value: { on: false }, effectiveFrom: new Date("2026-10-07T00:00:00Z"), note: "Off" });
    const open = await h.signIn("Open");
    expect((await open.get("/v1/me").expect(200)).body.admitted).toBe(true);
    const [row] = await h.db.select({ how: schema.users.admittedHow }).from(schema.users).where(eq(schema.users.id, open.id));
    expect(row?.how).toBe("open");
  });
});
