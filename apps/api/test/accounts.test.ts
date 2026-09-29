import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { anon, createHarness, market, stationFixture, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
}, 60_000);
afterAll(() => h.close());

describe("sign-in", () => {
  it("needs a valid Privy token for /me", async () => {
    await anon(h).get("/v1/me").expect(401);
    await anon(h).get("/v1/me").set("authorization", "Bearer not-a-jwt").expect(401);
    const kai = await h.signIn("Kai");
    const me = await kai.get("/v1/me").expect(200);
    expect(me.body).toMatchObject({ id: kai.id, displayName: "Kai", isAdmin: false, memberships: [] });
  });

  it("rejects a token for another app", async () => {
    const { SignJWT, generateKeyPair } = await import("jose");
    const other = await generateKeyPair("ES256");
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("privy.io")
      .setAudience("test-app")
      .setSubject("did:privy:forged")
      .setExpirationTime("1h")
      .sign(other.privateKey);
    await anon(h).get("/v1/me").set("authorization", `Bearer ${forged}`).expect(401);
  });

  it("matches an owner from before Privy by the wallet they link", async () => {
    const [legacy] = await h.db.insert(schema.users).values({}).returning();
    await h.db.insert(schema.identities).values({ userId: legacy.id, kind: "wallet", value: "0xabc0000000000000000000000000000000000001" });
    const owner = await h.signIn(undefined, { linked: [{ kind: "wallet", value: "0xabc0000000000000000000000000000000000001" }] });
    expect(owner.id).toBe(legacy.id);
  });

  it("merges settings section by section", async () => {
    const kai = await h.signIn("Kai");
    await kai.patch("/v1/me", { settings: { watching: { captions: "on" } } }).expect(200);
    const me = await kai.patch("/v1/me", { settings: { appearance: { ground: "light" } } }).expect(200);
    expect(me.body.settings).toMatchObject({ watching: { captions: "on" }, appearance: { ground: "light" } });
  });
});

describe("presets", () => {
  it("keys 1 to 6; saving over a key moves the old station to More presets", async () => {
    const m = await market(h, "presets-market");
    const beat = await stationFixture(h, { callSign: "BEAT", marketId: m.id, tenths: 121 });
    const reel = await stationFixture(h, { callSign: "REEL", marketId: m.id, tenths: 241 });
    const civc = await stationFixture(h, { callSign: "CIVC", marketId: m.id, tenths: 71 });
    const kai = await h.signIn("Kai");

    await kai.post("/v1/me/presets", { stationId: beat.id, key: 1 }).expect(200);
    await kai.post("/v1/me/presets", { stationId: reel.id, key: 2 }).expect(200);
    const replaced = await kai.post("/v1/me/presets", { stationId: civc.id, key: 1 }).expect(200);
    expect(replaced.body.map((p: { station: { callSign: string }; key: number | null }) => [p.station.callSign, p.key])).toEqual([
      ["CIVC", 1],
      ["REEL", 2],
      ["BEAT", null]
    ]);
    expect(replaced.body[0].station).toMatchObject({ channel: "7.1", marketSlug: "presets-market" });
  });

  it("suggests the least-used key when all six are full", async () => {
    const m = await market(h, "six-market");
    const stations = await Promise.all(
      ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"].map((cs, i) => stationFixture(h, { callSign: cs, marketId: m.id, tenths: 21 + i * 10 }))
    );
    const kai = await h.signIn();
    for (const [i, s] of stations.entries()) await kai.post("/v1/me/presets", { stationId: s.id, key: i + 1 }).expect(200);
    for (const key of [1, 1, 2, 3, 4, 6]) await kai.post(`/v1/me/presets/keys/${key}/use`).expect(200);
    const suggestion = await kai.get("/v1/me/presets/suggested-key").expect(200);
    expect(suggestion.body).toEqual({ key: 5 });
  });

  it("refuses the same key twice when reordering", async () => {
    const m = await market(h, "reorder-market");
    const a = await stationFixture(h, { callSign: "RRA", marketId: m.id, tenths: 31 });
    const b = await stationFixture(h, { callSign: "RRB", marketId: m.id, tenths: 41 });
    const kai = await h.signIn();
    const bad = await kai.put("/v1/me/presets", [{ stationId: a.id, key: 1 }, { stationId: b.id, key: 1 }]).expect(400);
    expect(bad.body.error.message).toMatch(/Key 1 is used twice/);
  });
});

describe("station teams", () => {
  it("owner invites; the invitee accepts and becomes an operator; operators can't invite", async () => {
    const owner = await h.signIn("Owner");
    const station = await stationFixture(h, { callSign: "TEAM", ownerId: owner.id });
    const invite = await owner.post(`/v1/stations/${station.id}/team/invites`, { email: "dee@example.com", role: "operator" }).expect(200);
    expect(invite.body).toMatchObject({ role: "operator", email: "dee@example.com", acceptedAt: null });

    const dee = await h.signIn("Dee");
    const me = await dee.post(`/v1/invites/${invite.body.id}/accept`).expect(200);
    expect(me.body.memberships).toEqual([expect.objectContaining({ kind: "station", role: "operator" })]);

    await dee.post(`/v1/stations/${station.id}/team/invites`, { email: "x@example.com", role: "host" }).expect(403);
    const team = await dee.get(`/v1/stations/${station.id}/team`).expect(200);
    expect(team.body.members.map((m: { role: string }) => m.role)).toEqual(["owner", "operator"]);
  });

  it("an expired invite can't be accepted", async () => {
    const owner = await h.signIn();
    const station = await stationFixture(h, { callSign: "EXPR", ownerId: owner.id });
    const invite = await owner.post(`/v1/stations/${station.id}/team/invites`, { email: "late@example.com", role: "host" }).expect(200);
    h.clock.advance(8 * 86_400_000);
    const late = await h.signIn();
    const res = await late.post(`/v1/invites/${invite.body.id}/accept`).expect(422);
    expect(res.body.error.code).toBe("invite_expired");
    h.clock.advance(-8 * 86_400_000);
  });

  it("strangers can't see a station's team, or whether it exists", async () => {
    const owner = await h.signIn();
    const station = await stationFixture(h, { callSign: "PRIV", ownerId: owner.id });
    const stranger = await h.signIn();
    await stranger.get(`/v1/stations/${station.id}/team`).expect(404);
  });

  it("the owner can't be removed; ownership moves to a member", async () => {
    const owner = await h.signIn();
    const station = await stationFixture(h, { callSign: "MOVE", ownerId: owner.id });
    await owner.delete(`/v1/stations/${station.id}/team/${owner.id}`).expect(422);
    const op = await h.signIn();
    await h.db.insert(schema.stationMemberships).values({ stationId: station.id, userId: op.id, role: "operator" });
    const team = await owner.post(`/v1/stations/${station.id}/team/transfer`, { toUserId: op.id }).expect(200);
    const roles = Object.fromEntries(team.body.members.map((m: { userId: string; role: string }) => [m.userId, m.role]));
    expect(roles).toEqual({ [op.id]: "owner", [owner.id]: "operator" });
  });
});

describe("admins", () => {
  it("act as owner of stations Opencast runs, and nowhere else", async () => {
    const admin = await h.signIn("Dee A.", { admin: true });
    const claimable = await stationFixture(h, { callSign: "LUPE", kind: "claimable" });
    const independent = await stationFixture(h, { callSign: "INDY", ownerId: (await h.signIn()).id });
    await admin.get(`/v1/stations/${claimable.id}/team`).expect(200);
    await admin.get(`/v1/stations/${independent.id}/team`).expect(404);
    const [row] = await h.db.select().from(schema.users).where(eq(schema.users.id, admin.id));
    expect(row.isAdmin).toBe(true);
  });
});

describe("Opencast admins by email (OPENCAST_ADMIN_EMAILS)", () => {
  it("makes whoever signs in with a listed email an admin, by email, Google or Apple, and nobody else", async () => {
    const before = process.env.OPENCAST_ADMIN_EMAILS;
    process.env.OPENCAST_ADMIN_EMAILS = " Boss@Example.test , other@example.test";
    try {
      const byEmail = await h.signIn(undefined, { linked: [{ kind: "email", value: "boss@example.test" }] });
      const byGoogle = await h.signIn(undefined, { linked: [{ kind: "google", value: "Other@Example.test" }] });
      const someone = await h.signIn(undefined, { linked: [{ kind: "email", value: "someone@example.test" }] });
      const admin = async (id: string) => (await h.db.select({ isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.id, id)))[0]!.isAdmin;
      expect(await admin(byEmail.id)).toBe(true);
      expect(await admin(byGoogle.id)).toBe(true);
      expect(await admin(someone.id)).toBe(false);
      await byEmail.get("/v1/admin/team").expect(200);
      await someone.get("/v1/admin/team").expect(403);
    } finally {
      process.env.OPENCAST_ADMIN_EMAILS = before;
      if (before === undefined) delete process.env.OPENCAST_ADMIN_EMAILS;
    }
  });
});
