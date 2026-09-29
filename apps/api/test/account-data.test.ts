// The account's own data (added 2026-09-28): sign out everywhere (A1), watch history and the last
// channel (A2), download and delete (A3), the Opencast team (A6), and notification kinds and
// timing (O1, O2).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { anon, createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let marketId: string;
beforeAll(async () => {
  h = await createHarness();
  marketId = (await market(h)).id;
}, 60_000);
afterAll(() => h.close());

const as = (token: string) => ({
  get: (url: string) => request(h.app).get(url).set("authorization", `Bearer ${token}`),
  post: (url: string, body?: object) => request(h.app).post(url).set("authorization", `Bearer ${token}`).send(body),
  delete: (url: string) => request(h.app).delete(url).set("authorization", `Bearer ${token}`)
});

/** A TV signed in to this person, the way the app does it. */
async function signedInTv(person: User) {
  const tv = (await anon(h).post("/v1/tv/devices").send({ platform: "android_tv" }).expect(201)).body as { tvId: string; deviceToken: string };
  const code = await as(tv.deviceToken).post("/v1/tv/codes").expect(201);
  await person.post(`/v1/tv/codes/${code.body.code}/approve`).expect(200);
  const poll = await anon(h).get(`/v1/tv/codes/${code.body.pollToken}`).expect(200);
  return { ...tv, session: poll.body.token as string };
}

/** Two heartbeats a player sends, 30 seconds apart. */
async function watch(station: string, token: string | null, sessionId = randomUUID()) {
  for (const mediaTimeMs of [0, 30_000]) {
    const beat = request(h.app).post("/v1/heartbeat");
    if (token) beat.set("authorization", `Bearer ${token}`);
    await beat.send({ stationId: station, sessionId, platform: "web", mediaTimeMs, playing: true }).expect(200);
    h.clock.advance(30_000);
  }
  return sessionId;
}

describe("sign out everywhere (A1)", () => {
  it("refuses every token from before, ends TV sessions and drops the phones; a new sign-in works", async () => {
    const kai = await h.signIn("Kai M.");
    const tv = await signedInTv(kai);
    await as(tv.session).get("/v1/me").expect(200);

    await kai.post("/v1/me/sign-out-everywhere").expect(200, { ok: true });

    // This token, and the TV's session, are done.
    const refused = await kai.get("/v1/me").expect(401);
    expect(refused.body.error.code).toBe("signed_out");
    const tvRefused = await as(tv.session).get("/v1/me").expect(401);
    expect(tvRefused.body.error.code).toBe("tv_signed_out");
    const [session] = await h.db.select().from(schema.tvSessions).where(eq(schema.tvSessions.deviceId, tv.tvId));
    expect(session.endedBy).toBe("account");

    // Signing in again (a new Privy session) works, and it's the same account.
    const again = await h.token(kai.did);
    const me = await as(again).get("/v1/me").expect(200);
    expect(me.body.id).toBe(kai.id);
  });

  it("a public endpoint still answers a signed-out token, as anyone", async () => {
    const ana = await h.signIn();
    await ana.post("/v1/me/sign-out-everywhere").expect(200);
    await ana.get("/v1/markets").expect(200);
  });
});

describe("watch history (A2)", () => {
  it("keeps signed-in viewing only, never links the anonymous session, and gives the last channel", async () => {
    const beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", marketId, tenths: 121, signedOn: true });
    const civc = await stationFixture(h, { callSign: "CIVC", name: "Civic", marketId, tenths: 71, signedOn: true });
    const kai = await h.signIn("Kai M.");

    await watch(beat.id, null);
    expect((await kai.get("/v1/me/watch-history").expect(200)).body).toEqual({ keep: true, lastChannel: null, items: [] });

    const sessionId = await watch(beat.id, kai.token);
    await watch(civc.id, kai.token);
    const history = await kai.get("/v1/me/watch-history").expect(200);
    expect(history.body.keep).toBe(true);
    expect(history.body.lastChannel.station.callSign).toBe("CIVC");
    expect(history.body.items.map((i: { station: { callSign: string } }) => i.station.callSign)).toEqual(["CIVC", "BEAT"]);
    // Two beats a stretch, a minute apart at most: one stretch each.
    expect(Date.parse(history.body.items[1].endedAt) - Date.parse(history.body.items[1].startedAt)).toBe(30_000);

    // The tuned-in session is still anonymous: nothing on it names the person.
    const [row] = await h.db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
    expect(Object.values(row)).not.toContain(kai.id);

    // A TV signed in to the account keeps history too.
    const tv = await signedInTv(kai);
    await watch(beat.id, tv.session);
    expect((await as(tv.session).get("/v1/me/watch-history").expect(200)).body.lastChannel.station.callSign).toBe("BEAT");

    await kai.delete("/v1/me/watch-history").expect(200, { ok: true });
    expect((await kai.get("/v1/me/watch-history").expect(200)).body.items).toEqual([]);
  });

  it("isn't kept while the setting is off, and turning it off forgets what was kept", async () => {
    const beat = await stationFixture(h, { callSign: "REEL", name: "Reel", marketId, tenths: 241, signedOn: true });
    const ana = await h.signIn();
    await watch(beat.id, ana.token);
    expect((await ana.get("/v1/me/watch-history").expect(200)).body.items).toHaveLength(1);

    await ana.patch("/v1/me", { settings: { privacy: { keepWatchHistory: false } } }).expect(200);
    expect((await ana.get("/v1/me/watch-history").expect(200)).body).toEqual({ keep: false, lastChannel: null, items: [] });
    await watch(beat.id, ana.token);
    expect((await ana.get("/v1/me/watch-history").expect(200)).body.items).toEqual([]);
  });
});

describe("your data (A3)", () => {
  it("emails a link, and downloads everything the account holds", async () => {
    const station = await stationFixture(h, { callSign: "SAZN", name: "Sazón", marketId, tenths: 181, signedOn: true });
    const lupe = await h.signIn("Lupe O.", { linked: [{ kind: "email", value: "lupe@example.com" }] });
    await lupe.post("/v1/me/presets", { stationId: station.id, key: 1 }).expect(200);
    await lupe.post(`/v1/stations/${station.id}/pledges`, { cadence: "monthly", amountMicros: 5_000_000 }).expect(201);

    const sent = await lupe.post("/v1/me/export").expect(200);
    expect(sent.body).toEqual({ email: "lupe@example.com", readyBy: h.clock.now().toISOString() });
    expect(h.sent.at(-1)).toMatchObject({ channel: "email", to: "lupe@example.com", title: "Your Opencast data" });

    const data = await lupe.get("/v1/me/export").expect(200);
    expect(data.body.account).toMatchObject({ id: lupe.id, displayName: "Lupe O.", email: "lupe@example.com" });
    expect(data.body.presets.map((p: { station: { callSign: string } }) => p.station.callSign)).toEqual(["SAZN"]);
    expect(data.body.pledges).toHaveLength(1);
    expect(data.body.pledges[0].receipts.items).toHaveLength(1);
    expect(data.body).toHaveProperty("watchHistory");
    expect(data.body).toHaveProperty("notices");
    expect(data.body).toHaveProperty("tvs");
  });

  it("without an email, there's nowhere to send the link", async () => {
    const someone = await h.signIn();
    const res = await someone.post("/v1/me/export").expect(409);
    expect(res.body.error.code).toBe("no_email");
  });

  it("a station owner hands the station over first", async () => {
    const owner = await h.signIn("Owner");
    await stationFixture(h, { ownerId: owner.id, name: "Mine" });
    const res = await owner.delete("/v1/me").expect(409);
    expect(res.body.error.code).toBe("owns_station");
  });

  it("deletes the account: pledges stop after this month, TVs sign out, old tokens are refused, and signing in again starts afresh", async () => {
    const station = await stationFixture(h, { callSign: "PREP", name: "Prep", marketId, tenths: 311, signedOn: true });
    const ren = await h.signIn("Ren", { linked: [{ kind: "email", value: "ren@example.com" }] });
    await ren.post("/v1/me/presets", { stationId: station.id, key: 2 }).expect(200);
    const pledged = await ren.post(`/v1/stations/${station.id}/pledges`, { cadence: "monthly", amountMicros: 3_000_000 }).expect(201);
    const tv = await signedInTv(ren);

    await ren.delete("/v1/me").expect(200, { ok: true });

    const refused = await ren.get("/v1/me").expect(401);
    expect(refused.body.error.code).toBe("account_deleted");
    await as(tv.session).get("/v1/me").expect(401);
    const [pledge] = await h.db.select().from(schema.pledges).where(eq(schema.pledges.id, pledged.body.pledge.id));
    expect(pledge.endsAfter).toBe("2026-10-31");
    const [tombstone] = await h.db.select().from(schema.users).where(eq(schema.users.id, ren.id));
    expect(tombstone).toMatchObject({ displayName: null, email: null, settings: {} });
    expect(tombstone.deletedAt).not.toBeNull();
    expect(await h.db.select().from(schema.presets).where(eq(schema.presets.userId, ren.id))).toEqual([]);
    expect(await h.db.select().from(schema.identities).where(eq(schema.identities.userId, ren.id))).toEqual([]);

    // A new sign-in with the same Privy account, a moment later: a new, empty account.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const fresh = await as(await h.token(ren.did)).get("/v1/me").expect(200);
    expect(fresh.body.id).not.toBe(ren.id);
    expect(fresh.body.displayName).toBeNull();
  });
});

describe("the Opencast team (A6)", () => {
  it("lists the admins, for admins", async () => {
    const dee = await h.signIn("Dee A.", { admin: true });
    await h.db.update(schema.users).set({ email: "dee@opencast.test" }).where(eq(schema.users.id, dee.id));
    const team = await dee.get("/v1/admin/team").expect(200);
    expect(team.body).toContainEqual({ id: dee.id, name: "Dee A.", email: "dee@opencast.test" });
    await (await h.signIn()).get("/v1/admin/team").expect(403);
  });
});

describe("notification kinds and timing (O1, O2)", () => {
  it("the viewer's new kinds are off until turned on; the station's signed on or off is on", async () => {
    const kai = await h.signIn();
    const viewer = await kai.get("/v1/me/notification-prefs?scope=viewer").expect(200);
    expect(viewer.body.prefs).toMatchObject({ preset_live: { push: false, email: false }, station_news: { push: false, email: false } });
    await kai.put("/v1/me/notification-prefs", { scope: "viewer", scopeId: null, prefs: { preset_live: { push: true, email: false } } }).expect(200);
    expect((await kai.get("/v1/me/notification-prefs?scope=viewer").expect(200)).body.prefs.preset_live).toEqual({ push: true, email: false });

    const owner = await h.signIn("Owner");
    const station = await stationFixture(h, { ownerId: owner.id, callSign: "HOOP", name: "Hoop", marketId, tenths: 521 });
    h.deps.bus.emit("station.signed_on", { stationId: station.id, first: true });
    await h.deps.bus.settle();
    const notices = await owner.get("/v1/me/notices").expect(200);
    expect(notices.body[0]).toMatchObject({ kind: "signed_on_off", title: "HOOP 52.1 signed on" });
    expect(h.sent.at(-1)).toMatchObject({ channel: "push", to: owner.id, title: "HOOP 52.1 signed on" });
  });

  it("types the timing, and quiet hours hold back viewer pushes (notices still land)", async () => {
    const ana = await h.signIn();
    await ana.patch("/v1/me", { settings: { notifications: { quietHours: true, leadMinutes: 15, emailWhen: "evening_before" } } }).expect(200);
    const bad = await ana.patch("/v1/me", { settings: { notifications: { quietFrom: "10pm" } } }).expect(400);
    expect(bad.body.error.code).toBe("bad_request");

    // 11:30 pm in Los Angeles: quiet.
    h.clock.set("2026-10-02T06:30:00.000Z");
    const before = h.sent.length;
    await h.services.notifications.notify([ana.id], { kind: "reminder", title: "Late show starts soon", body: "Tune in", scope: { kind: "viewer", id: null } });
    expect(h.sent.slice(before).filter((s) => s.channel === "push")).toEqual([]);
    expect((await ana.get("/v1/me/notices").expect(200)).body[0].title).toBe("Late show starts soon");

    // Turned off: it comes through.
    await ana.patch("/v1/me", { settings: { notifications: { quietHours: false } } }).expect(200);
    await h.services.notifications.notify([ana.id], { kind: "reminder", title: "Later show starts soon", body: "Tune in", scope: { kind: "viewer", id: null } });
    expect(h.sent.at(-1)).toMatchObject({ channel: "push", to: ana.id, title: "Later show starts soon" });
    h.clock.set("2026-10-01T19:00:00.000Z");
  });
});
