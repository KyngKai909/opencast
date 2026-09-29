// TVs (B2): a TV registers, shows a code, a phone approves it, and the TV's session acts as the
// person on the account endpoints a TV uses, and nowhere else. TVs on the account: list, sign
// out remotely, remembered cast targets.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { anon, createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
}, 60_000);
afterAll(() => h.close());

const as = (token: string) => ({
  get: (url: string) => request(h.app).get(url).set("authorization", `Bearer ${token}`),
  post: (url: string, body?: object) => request(h.app).post(url).set("authorization", `Bearer ${token}`).send(body),
  patch: (url: string, body?: object) => request(h.app).patch(url).set("authorization", `Bearer ${token}`).send(body),
  put: (url: string, body?: object) => request(h.app).put(url).set("authorization", `Bearer ${token}`).send(body),
  delete: (url: string) => request(h.app).delete(url).set("authorization", `Bearer ${token}`)
});

async function registerTv(platform = "fire_tv", name?: string) {
  const res = await anon(h).post("/v1/tv/devices").send(name ? { platform, name } : { platform }).expect(201);
  return res.body as { tvId: string; deviceToken: string };
}

/** A TV signed in to this person, the way the app does it. */
async function signedInTv(person: User, platform = "android_tv") {
  const tv = await registerTv(platform);
  const code = await as(tv.deviceToken).post("/v1/tv/codes").expect(201);
  await person.post(`/v1/tv/codes/${code.body.code}/approve`).expect(200);
  const poll = await anon(h).get(`/v1/tv/codes/${code.body.pollToken}`).expect(200);
  return { ...tv, session: poll.body.token as string };
}

describe("TV sign-in by code", () => {
  it("registers, shows a code, and hands the session over once when a phone approves it", async () => {
    const tv = await registerTv("fire_tv");
    expect(tv.deviceToken).toMatch(/^tvd_/);
    const [stored] = await h.db.select().from(schema.tvDevices).where(eq(schema.tvDevices.id, tv.tvId));
    expect(stored.tokenHash).not.toContain(tv.deviceToken.slice(4));

    const code = await as(tv.deviceToken).post("/v1/tv/codes").expect(201);
    expect(code.body).toMatchObject({
      code: expect.stringMatching(/^[A-HJ-NP-Z2-9]{6}$/),
      enterAt: "app.opencast.test/tv",
      expiresAt: new Date(h.clock.now().getTime() + 10 * 60_000).toISOString(),
      pollSeconds: 3
    });
    expect(code.body.qrUrl).toBe(`https://app.opencast.test/tv?code=${code.body.code}`);

    await anon(h).get(`/v1/tv/codes/${code.body.pollToken}`).expect(200, { status: "pending" });

    const kai = await h.signIn("Kai M.");
    // Typed the way it's shown on the TV, in lower case.
    const typed = `${code.body.code.slice(0, 3)} ${code.body.code.slice(3)}`.toLowerCase();
    const approved = await kai.post(`/v1/tv/codes/${encodeURIComponent(typed)}/approve`).expect(200);
    expect(approved.body).toMatchObject({ id: tv.tvId, name: "Fire TV", kind: "tv_app", platform: "fire_tv", signedIn: true, online: false, castingNow: false });

    const poll = await anon(h).get(`/v1/tv/codes/${code.body.pollToken}`).expect(200);
    expect(poll.body).toEqual({ status: "approved", token: expect.stringMatching(/^tvs_/), signedInAs: "Kai M." });
    // Once: the next ask says expired, and the code can't be approved again.
    await anon(h).get(`/v1/tv/codes/${code.body.pollToken}`).expect(200, { status: "expired" });
    const again = await kai.post(`/v1/tv/codes/${code.body.code}/approve`).expect(409);
    expect(again.body.error.code).toBe("code_used");

    const me = await as(poll.body.token).get("/v1/me").expect(200);
    expect(me.body.id).toBe(kai.id);
  });

  it("codes run out after 10 minutes, and a new code replaces the last", async () => {
    const tv = await registerTv("google_tv");
    const kai = await h.signIn();
    const first = await as(tv.deviceToken).post("/v1/tv/codes").expect(201);
    const second = await as(tv.deviceToken).post("/v1/tv/codes").expect(201);
    expect(second.body.code).not.toBe(first.body.code);
    await anon(h).get(`/v1/tv/codes/${first.body.pollToken}`).expect(200, { status: "expired" });
    const replaced = await kai.post(`/v1/tv/codes/${first.body.code}/approve`).expect(404);
    expect(replaced.body.error.code).toBe("code_not_found");

    h.clock.advance(10 * 60_000 + 1_000);
    try {
      await anon(h).get(`/v1/tv/codes/${second.body.pollToken}`).expect(200, { status: "expired" });
      await kai.post(`/v1/tv/codes/${second.body.code}/approve`).expect(404);
    } finally {
      h.clock.advance(-(10 * 60_000 + 1_000));
    }
    await anon(h).get("/v1/tv/codes/not-a-poll-token").expect(404);
  });

  it("limits wrong codes per person", async () => {
    const tv = await registerTv();
    const code = await as(tv.deviceToken).post("/v1/tv/codes").expect(201);
    const guesser = await h.signIn();
    for (let i = 0; i < 10; i++) {
      const res = await guesser.post(`/v1/tv/codes/ZZZZZ${i + 2}/approve`).expect(404);
      expect(res.body.error.code).toBe("code_not_found");
    }
    // Even the right code, until the window passes.
    const limited = await guesser.post(`/v1/tv/codes/${code.body.code}/approve`).expect(429);
    expect(limited.body.error.code).toBe("too_many_tries");
    // Someone else isn't limited.
    const other = await h.signIn();
    await other.post("/v1/tv/codes/ZZZZZZ/approve").expect(404);
    h.clock.advance(15 * 60_000 + 1_000);
    try {
      const fresh = await as(tv.deviceToken).post("/v1/tv/codes").expect(201);
      await guesser.post(`/v1/tv/codes/${fresh.body.code}/approve`).expect(200);
    } finally {
      h.clock.advance(-(15 * 60_000 + 1_000));
    }
  });

  it("device endpoints take the device token or the TV's session, never a person's token", async () => {
    const tv = await registerTv();
    const kai = await h.signIn();
    await anon(h).post("/v1/tv/codes").expect(401);
    await kai.post("/v1/tv/codes").expect(401);
    await as("tvd_not-a-real-token").post("/v1/tv/codes").expect(401);
    await anon(h).post("/v1/tv/devices").send({ platform: "roku" }).expect(400);
    // A device token isn't a person.
    const notSignedIn = await as(tv.deviceToken).get("/v1/me").expect(401);
    expect(notSignedIn.body.error.message).toMatch(/Sign this TV in first/);
    const signed = await signedInTv(kai);
    await as(signed.session).post("/v1/tv/codes").expect(201);
  });
});

describe("a TV session acts as the person where a TV needs it", () => {
  it("reads and changes the account: me, settings, presets, reminders, merging, pledges", async () => {
    const m = await market(h, "tv-session-market");
    const beat = await stationFixture(h, { callSign: "TVSA", marketId: m.id, tenths: 121 });
    const reel = await stationFixture(h, { callSign: "TVSB", marketId: m.id, tenths: 241 });
    const kai = await h.signIn("Kai");
    const { session } = await signedInTv(kai);
    const tv = as(session);

    const me = await tv.patch("/v1/me", { settings: { tv: { channelUp: "down_the_dial", bannerSeconds: 5, numberWaitSeconds: 1.5, includeRadioBand: true, quality: "data_saver", eveningOut: true } } }).expect(200);
    expect(me.body.settings.tv).toEqual({ channelUp: "down_the_dial", bannerSeconds: 5, numberWaitSeconds: 1.5, includeRadioBand: true, quality: "data_saver", eveningOut: true });
    // A7: typed now, so a value the TV can't show is refused.
    await tv.patch("/v1/me", { settings: { tv: { bannerSeconds: 4 } } }).expect(400);
    const phoneView = await kai.get("/v1/me").expect(200);
    expect(phoneView.body.settings.tv.quality).toBe("data_saver");

    await tv.post("/v1/me/presets", { stationId: beat.id, key: 1 }).expect(200);
    await tv.put("/v1/me/presets", [{ stationId: beat.id, key: 2 }]).expect(200);
    await tv.get("/v1/me/presets/suggested-key").expect(200);
    await tv.post("/v1/me/presets/keys/2/use").expect(200);
    const merged = await tv.post("/v1/me/merge-device", { presets: [{ stationId: reel.id, key: 3 }], reminders: [] }).expect(200);
    expect(merged.body.presets.map((p: { station: { callSign: string } }) => p.station.callSign)).toEqual(["TVSA", "TVSB"]);
    await tv.delete(`/v1/me/presets/${reel.id}`).expect(200);
    const presets = await kai.get("/v1/me/presets").expect(200);
    expect(presets.body.map((p: { station: { callSign: string }; key: number }) => [p.station.callSign, p.key])).toEqual([["TVSA", 2]]);
    await tv.get("/v1/me/reminders").expect(200, []);
    await tv.get("/v1/me/pledges").expect(200, []);
  });

  it("is refused everywhere else, and never counts as an admin", async () => {
    const admin = await h.signIn("Ada", { admin: true });
    const station = await stationFixture(h, { callSign: "TVSC", ownerId: admin.id });
    const { session, tvId } = await signedInTv(admin);
    const tv = as(session);
    for (const res of [
      await tv.get("/v1/me/tvs"),
      await tv.delete(`/v1/me/tvs/${tvId}`),
      await tv.post("/v1/me/clear"),
      await tv.get(`/v1/stations/${station.id}/team`),
      await tv.post("/v1/tv/codes/ABCDEF/approve"),
      await tv.get("/v1/admin/creators")
    ]) {
      expect([res.status, res.body.error?.code]).toEqual([403, "tv_not_allowed"]);
    }
    // The account is an admin's, and says so; the TV still can't use the desk.
    const me = await tv.get("/v1/me").expect(200);
    expect(me.body.isAdmin).toBe(true);
  });
});

describe("TVs on the account", () => {
  it("lists the TV app and remembered cast targets, signs a TV out remotely, and forgets a target", async () => {
    const kai = await h.signIn("Kai");
    const den = await signedInTv(kai, "google_tv");
    const room = await registerTv("fire_tv", "Living room TV");
    const code = await as(room.deviceToken).post("/v1/tv/codes").expect(201);
    await kai.post(`/v1/tv/codes/${code.body.code}/approve`).expect(200);
    const roomPoll = await anon(h).get(`/v1/tv/codes/${code.body.pollToken}`).expect(200);

    const cast = await kai.post("/v1/me/tvs/cast-targets", { kind: "chromecast", name: "Bedroom TV" }).expect(201);
    expect(cast.body).toMatchObject({ kind: "chromecast", name: "Bedroom TV", platform: null, signedIn: false, online: false, castingNow: false });
    // The same TV again (any case) is the same row, marked used.
    const again = await kai.post("/v1/me/tvs/cast-targets", { kind: "chromecast", name: "bedroom tv" }).expect(201);
    expect(again.body.id).toBe(cast.body.id);
    await kai.post("/v1/me/tvs/cast-targets", { kind: "airplay", name: "Office" }).expect(201);

    const list = await kai.get("/v1/me/tvs").expect(200);
    expect(list.body.map((t: { name: string; kind: string }) => [t.kind, t.name]).sort()).toEqual(
      [
        ["airplay", "Office"],
        ["chromecast", "bedroom tv"],
        ["tv_app", "Google TV"],
        ["tv_app", "Living room TV"]
      ].sort()
    );
    expect(list.body.find((t: { id: string }) => t.id === den.tvId)).toMatchObject({ platform: "google_tv", signedIn: true, online: false, lastUsedAt: expect.any(String) });

    // Someone else can't sign Kai's TV out.
    const stranger = await h.signIn();
    await stranger.delete(`/v1/me/tvs/${den.tvId}`).expect(404);

    const after = await kai.delete(`/v1/me/tvs/${den.tvId}`).expect(200);
    expect(after.body.map((t: { id: string }) => t.id)).not.toContain(den.tvId);
    const out = await as(den.session).get("/v1/me").expect(401);
    expect(out.body.error.code).toBe("tv_signed_out");
    // The TV itself is still registered: it can show a new code.
    await as(den.deviceToken).post("/v1/tv/codes").expect(201);

    const forgot = await kai.delete(`/v1/me/tvs/${cast.body.id}`).expect(200);
    expect(forgot.body.map((t: { id: string }) => t.id)).not.toContain(cast.body.id);
    await kai.delete(`/v1/me/tvs/${cast.body.id}`).expect(404);

    // The TV signs itself out.
    await as(roomPoll.body.token).delete("/v1/tv/session").expect(200, { ok: true });
    await as(roomPoll.body.token).get("/v1/me/presets").expect(401);
    const last = await kai.get("/v1/me/tvs").expect(200);
    expect(last.body.map((t: { kind: string }) => t.kind)).toEqual(["airplay"]);
  });

  it("signing a TV in again replaces its session", async () => {
    const kai = await h.signIn();
    const dee = await h.signIn();
    const tv = await signedInTv(kai);
    const code = await as(tv.deviceToken).post("/v1/tv/codes").expect(201);
    await dee.post(`/v1/tv/codes/${code.body.code}/approve`).expect(200);
    const poll = await anon(h).get(`/v1/tv/codes/${code.body.pollToken}`).expect(200);
    await as(tv.session).get("/v1/me").expect(401);
    const me = await as(poll.body.token).get("/v1/me").expect(200);
    expect(me.body.id).toBe(dee.id);
    expect((await kai.get("/v1/me/tvs").expect(200)).body).toEqual([]);
  });
});
