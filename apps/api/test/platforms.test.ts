// Platform connections (follow-up Phase 3): YouTube and Twitch by signing in (fake providers: the
// real APIs are never called), anything else by address and key; keys and tokens sealed at rest and
// never logged; removed in one click with the tokens revoked; the relay service's seam; and the
// viewers each connected platform reports, every minute.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createHarness, market, stationFixture, type Harness, type User } from "./harness.js";
import { fakePlatforms, type FakePlatforms } from "../src/v1/modules/platforms/fake.js";
import { secretBox, secretBoxFromEnv } from "../src/v1/modules/platforms/secrets.js";
import { createHash, randomBytes } from "node:crypto";

let h: Harness;
let fake: FakePlatforms;
let kai: User; // BEAT's owner
let ops: User; // an operator
let beat: { id: string };
let marketId: string;

const logged: string[] = [];
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

/** Signs in to a platform the way a browser would: start, the platform's consent, the callback. */
async function signIn(provider: "youtube" | "twitch", account: string, accountId: string) {
  const start = await kai.post(`/v1/stations/${beat.id}/platforms/oauth/${provider}/start`, {}).expect(200);
  const url = new URL(start.body.url);
  const state = url.searchParams.get("state")!;
  const code = `code-${randomBytes(4).toString("hex")}`;
  fake.codes.set(code, { account, accountId });
  const back = await (await import("supertest")).default(h.app).get(`/v1/platforms/oauth/${provider}/callback?state=${encodeURIComponent(state)}&code=${code}`).expect(302);
  return { url, state, location: back.headers.location as string };
}

beforeAll(async () => {
  fake = fakePlatforms();
  h = await createHarness({ platforms: { providers: fake, secrets: secretBox({ id: "k1", key: randomBytes(32) }) }, publicBase: "https://api.opencast.test" });
  h.clock.set("2026-10-05T19:00:00.000Z");
  const m = await market(h);
  marketId = m.id;
  kai = await h.signIn("Kai");
  ops = await h.signIn("Ops");
  beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true });
  await h.db.insert(schema.stationMemberships).values({ stationId: beat.id, userId: ops.id, role: "operator" });
  // Everything written to the console from here on, to check no secret is ever logged.
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    spies.push(vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "))));
  }
}, 60_000);
afterEach(() => undefined);
afterAll(async () => {
  for (const spy of spies) spy.mockRestore();
  await h.close();
});

describe("signing in to YouTube and Twitch", () => {
  it("only an owner starts a sign-in; operators see the list", async () => {
    await ops.post(`/v1/stations/${beat.id}/platforms/oauth/youtube/start`, {}).expect(403);
    const list = await ops.get(`/v1/stations/${beat.id}/platforms`).expect(200);
    expect(list.body).toEqual({ platforms: [], signIn: { youtube: true, twitch: true, facebook: false }, canStoreKeys: true });
  });

  it("YouTube: Google's consent with the scopes, then back to the Translators page, connected", async () => {
    const { url, location } = await signIn("youtube", "Inland Beat channel", "UC-beat");
    expect(url.searchParams.get("redirect_uri")).toBe("https://api.opencast.test/v1/platforms/oauth/youtube/callback");
    expect(url.searchParams.get("scope")).toContain("youtube.force-ssl");
    expect(url.searchParams.get("scope")).toContain("yt-analytics.readonly");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location).toBe("https://app.opencast.test/control/beat/translators?platform=youtube&connected=1");
    // Opencast made the relay's live stream and the first broadcast, bound to it, titled for the station.
    expect(fake.calls.filter((c) => c.provider === "youtube").map((c) => c.op)).toEqual(["exchangeCode", "createStream", "createBroadcast"]);
    expect(fake.calls.find((c) => c.op === "createBroadcast")!.args).toMatchObject({ title: "BEAT: Inland Beat", description: expect.stringContaining("Inland Beat, live on Opencast") });
    const list = await kai.get(`/v1/stations/${beat.id}/platforms`).expect(200);
    expect(list.body.platforms).toEqual([
      expect.objectContaining({
        kind: "youtube",
        method: "signed_in",
        name: "Inland Beat channel",
        account: "Inland Beat channel",
        rtmpUrl: "rtmps://a.rtmps.youtube.test/live2",
        hasStreamKey: true,
        status: "connected",
        countsViewers: true,
        reportsLocation: true,
        paidPromotion: "automatic",
        broadcast: expect.objectContaining({ id: "yt-video-1", title: "BEAT: Inland Beat" })
      })
    ]);
  });

  it("Twitch: signed in, its stream key read", async () => {
    const { url, location } = await signIn("twitch", "InlandBeat", "tw-42");
    expect(url.searchParams.get("scope")).toBe("channel:read:stream_key channel:manage:broadcast");
    expect(location).toContain("platform=twitch&connected=1");
    const list = await kai.get(`/v1/stations/${beat.id}/platforms`).expect(200);
    expect(list.body.platforms[1]).toMatchObject({ kind: "twitch", account: "inlandbeat", rtmpUrl: "rtmp://live.twitch.test/app", hasStreamKey: true, countsViewers: true, reportsLocation: false, paidPromotion: "automatic" });
  });

  it("a state works once, expires, and a refusal comes back as one", async () => {
    const request = (await import("supertest")).default;
    const start = await kai.post(`/v1/stations/${beat.id}/platforms/oauth/youtube/start`, {}).expect(200);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const denied = await request(h.app).get(`/v1/platforms/oauth/youtube/callback?state=${state}&error=access_denied`).expect(302);
    expect(denied.headers.location).toBe("https://app.opencast.test/control/beat/translators?platform=youtube&error=denied");
    const again = await request(h.app).get(`/v1/platforms/oauth/youtube/callback?state=${state}&code=whatever`).expect(302);
    expect(again.headers.location).toContain("error=expired");
    const forged = await request(h.app).get(`/v1/platforms/oauth/youtube/callback?state=forged&code=whatever`).expect(302);
    expect(forged.headers.location).toContain("error=expired");
    // Past 15 minutes the state is gone.
    const late = await kai.post(`/v1/stations/${beat.id}/platforms/oauth/twitch/start`, {}).expect(200);
    h.clock.advance(16 * 60_000);
    const expired = await request(h.app).get(`/v1/platforms/oauth/twitch/callback?state=${new URL(late.body.url).searchParams.get("state")}&code=x`).expect(302);
    expect(expired.headers.location).toContain("error=expired");
    expect((await kai.get(`/v1/stations/${beat.id}/platforms`).expect(200)).body.platforms).toHaveLength(2);
  });

  it("without the platform's client set up, it says to add it by hand", async () => {
    const plain = await createHarness({ platforms: { providers: { youtube: null, twitch: null }, secrets: secretBox({ id: "k", key: randomBytes(32) }) } });
    try {
      const owner = await plain.signIn("Owner");
      const s = await stationFixture(plain, { callSign: "SOLO", ownerId: owner.id });
      const res = await owner.post(`/v1/stations/${s.id}/platforms/oauth/youtube/start`, {}).expect(409);
      expect(res.body.error.code).toBe("sign_in_not_set_up");
      expect((await owner.get(`/v1/stations/${s.id}/platforms`).expect(200)).body.signIn).toEqual({ youtube: false, twitch: false, facebook: false });
    } finally {
      await plain.close();
    }
  });
});

describe("anything else, by address and key", () => {
  it("adds Facebook and a custom RTMPS address; only rtmp:// and rtmps:// addresses", async () => {
    await kai.post(`/v1/stations/${beat.id}/platforms`, { kind: "facebook", name: "Inland Beat on Facebook", rtmpUrl: "https://live-api-s.facebook.com/rtmp/", streamKey: "FB-1" }).expect(400);
    await ops.post(`/v1/stations/${beat.id}/platforms`, { kind: "facebook", name: "Inland Beat on Facebook", rtmpUrl: "rtmps://live-api-s.facebook.com:443/rtmp/", streamKey: "FB-key-secret" }).expect(403);
    const fb = await kai.post(`/v1/stations/${beat.id}/platforms`, { kind: "facebook", name: "Inland Beat on Facebook", rtmpUrl: "rtmps://live-api-s.facebook.com:443/rtmp/", streamKey: "FB-key-secret" }).expect(201);
    expect(fb.body).toMatchObject({ kind: "facebook", method: "manual", account: null, hasStreamKey: true, countsViewers: false, reportsLocation: false, paidPromotion: "remind", broadcast: null });
    expect(JSON.stringify(fb.body)).not.toContain("FB-key-secret");
    await kai.post(`/v1/stations/${beat.id}/platforms`, { kind: "custom", name: "Our own server", rtmpUrl: "rtmp://relay.example.org/live", streamKey: "custom-key-secret" }).expect(201);
    expect((await kai.get(`/v1/stations/${beat.id}/platforms`).expect(200)).body.platforms.map((p: { kind: string }) => p.kind)).toEqual(["youtube", "twitch", "facebook", "custom"]);
  });
});

describe("keys and tokens at rest", () => {
  it("are sealed (AES-256-GCM), never stored or returned in the clear", async () => {
    const rows = await h.db.select().from(schema.platformConnections).where(eq(schema.platformConnections.stationId, beat.id));
    for (const row of rows) {
      for (const sealed of [row.streamKeyEnc, row.accessTokenEnc, row.refreshTokenEnc].filter(Boolean) as string[]) {
        expect(sealed).toMatch(/^v1\.k1\.[\w-]+\.[\w-]+\.[\w-]+$/);
        expect(sealed).not.toMatch(/secret/);
      }
    }
    const dump = JSON.stringify(await h.db.execute(sql`select * from broadcast.platform_connections`));
    for (const plain of ["FB-key-secret", "custom-key-secret", "yt-key-", "twitch-key-secret", "-access-", "-refresh-"]) expect(dump).not.toContain(plain);
    const list = JSON.stringify((await kai.get(`/v1/stations/${beat.id}/platforms`).expect(200)).body);
    expect(list).not.toMatch(/secret|access|refresh/);
  });

  it("a sealed value opens only for its own row and field, and the key rotates", () => {
    const oldKey = { id: "old", key: randomBytes(32) };
    const newKey = { id: "new", key: randomBytes(32) };
    const before = secretBox(oldKey);
    const sealed = before.seal("rtmp-key", "platform_connections:a:stream_key");
    expect(() => before.open(sealed, "platform_connections:b:stream_key")).toThrow("didn't open");
    expect(() => before.open(sealed, "platform_connections:a:access_token")).toThrow("didn't open");
    const after = secretBox(newKey, [oldKey]);
    expect(after.needsRotation(sealed)).toBe(true);
    expect(after.open(sealed, "platform_connections:a:stream_key")).toBe("rtmp-key");
    const resealed = after.seal("rtmp-key", "platform_connections:a:stream_key");
    expect(resealed.startsWith("v1.new.")).toBe(true);
    expect(() => secretBox(newKey).open(sealed, "platform_connections:a:stream_key")).toThrow('No key "old"');
    // From the environment: a named key, old keys to open; production without one can't store keys.
    const hex = randomBytes(32).toString("hex");
    const env = secretBoxFromEnv({ PLATFORM_SECRETS_KEY: `v2:${hex}`, PLATFORM_SECRETS_OLD_KEYS: `old:${oldKey.key.toString("base64")}` } as NodeJS.ProcessEnv);
    expect(env.keyId).toBe("v2");
    expect(env.open(sealed, "platform_connections:a:stream_key")).toBe("rtmp-key");
    const prod = secretBoxFromEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
    expect(prod.usable).toBe(false);
    expect(() => prod.seal("x", "y")).toThrow("PLATFORM_SECRETS_KEY");
    expect(createHash("sha256").update(env.keyId).digest("hex")).toBeTruthy();
  });

  it("re-seals everything under an old key with the current one", async () => {
    const oldKey = { id: "k0", key: randomBytes(32) };
    const box0 = secretBox(oldKey);
    // A server whose current key is k9, with k0 among its old keys.
    const second = await createHarness({ platforms: { providers: fake, secrets: secretBox({ id: "k9", key: randomBytes(32) }, [oldKey]) } });
    try {
      const owner = await second.signIn("Owner");
      const s2 = await stationFixture(second, { callSign: "ROTB", ownerId: owner.id });
      const id = crypto.randomUUID();
      await second.db.insert(schema.platformConnections).values({ id, stationId: s2.id, kind: "kick", method: "manual", name: "Kick", rtmpUrl: "rtmps://kick.test/app", streamKeyEnc: box0.seal("kick2-key-secret", `platform_connections:${id}:stream_key`) });
      expect(await second.services.platforms.resealSecrets()).toBe(1);
      const [row] = await second.db.select().from(schema.platformConnections).where(eq(schema.platformConnections.id, id));
      expect(row.streamKeyEnc!.startsWith("v1.k9.")).toBe(true);
      expect((await second.services.platforms.destinationsFor(s2.id))[0].streamKey).toBe("kick2-key-secret");
      expect(await second.services.platforms.resealSecrets()).toBe(0);
    } finally {
      await second.close();
    }
  });
});

describe("the relay service's seam", () => {
  it("destinationsFor: each destination with its key, decrypted in memory; connected means signed in", async () => {
    const destinations = await h.services.platforms.destinationsFor(beat.id);
    expect(destinations).toEqual([
      expect.objectContaining({ kind: "youtube", rtmpUrl: "rtmps://a.rtmps.youtube.test/live2", streamKey: expect.stringMatching(/^yt-key-/), connected: true, name: "Inland Beat channel" }),
      expect.objectContaining({ kind: "twitch", rtmpUrl: "rtmp://live.twitch.test/app", streamKey: "live_tw-42_twitch-key-secret", connected: true }),
      expect.objectContaining({ kind: "facebook", streamKey: "FB-key-secret", connected: false }),
      expect.objectContaining({ kind: "custom", streamKey: "custom-key-secret", connected: false })
    ]);
  });

  it("prepareNextBroadcast: YouTube's next broadcast, title and description carried over, on the same key", async () => {
    const [yt, tw, fb] = await h.services.platforms.destinationsFor(beat.id);
    const next = await h.services.platforms.prepareNextBroadcast(yt.platformId);
    expect(next).toEqual({ rtmpUrl: yt.rtmpUrl, streamKey: yt.streamKey, broadcastId: "yt-video-2" });
    const created = fake.calls.filter((c) => c.op === "createBroadcast");
    expect(created.at(-1)!.args).toMatchObject({ title: created[0].args.title, description: created[0].args.description, streamId: created[0].args.streamId });
    // Asked again before the restart: the same one.
    expect(await h.services.platforms.prepareNextBroadcast(yt.platformId)).toEqual(next);
    expect(fake.calls.filter((c) => c.op === "createBroadcast")).toHaveLength(created.length);
    // Twitch starts a broadcast by itself; a pasted key is the station's to restart (reminded).
    expect(await h.services.platforms.prepareNextBroadcast(tw.platformId)).toBeNull();
    expect(await h.services.platforms.prepareNextBroadcast(fb.platformId)).toBeNull();
    const reminders = await h.db.select().from(schema.platformEvents).where(eq(schema.platformEvents.platformId, fb.platformId));
    expect(reminders.map((e) => e.kind)).toContain("remind_restart");
  });

  it("endBroadcast: ends the current one and moves on to the prepared one", async () => {
    const [yt, , fb] = await h.services.platforms.destinationsFor(beat.id);
    await h.services.platforms.endBroadcast(yt.platformId);
    expect(fake.calls.filter((c) => c.op === "endBroadcast").at(-1)!.args).toEqual({ broadcastId: "yt-video-1" });
    const list = await kai.get(`/v1/stations/${beat.id}/platforms`).expect(200);
    expect(list.body.platforms[0].broadcast.id).toBe("yt-video-2");
    await h.services.platforms.endBroadcast(fb.platformId);
    const events = await h.db.select().from(schema.platformEvents).where(eq(schema.platformEvents.platformId, fb.platformId));
    expect(events.map((e) => e.kind)).toContain("remind_end");
  });

  it("setPaidPromotion: YouTube's paid product placement, Twitch's branded content, a reminder for the rest", async () => {
    const [yt, tw, fb] = await h.services.platforms.destinationsFor(beat.id);
    expect(await h.services.platforms.setPaidPromotion(yt.platformId, true)).toEqual({ applied: true });
    expect(fake.calls.filter((c) => c.op === "setPaidPromotion").at(-1)!.args).toEqual({ videoId: "yt-video-2", on: true });
    expect(await h.services.platforms.setPaidPromotion(tw.platformId, true)).toEqual({ applied: true });
    expect(fake.calls.filter((c) => c.op === "setBrandedContent").at(-1)!.args).toEqual({ broadcasterId: "tw-42", on: true });
    expect(await h.services.platforms.setPaidPromotion(fb.platformId, true)).toEqual({ applied: false });
    const events = await h.db.select().from(schema.platformEvents).where(eq(schema.platformEvents.platformId, fb.platformId));
    expect(events.map((e) => e.kind)).toContain("remind_paid_promotion");
    const list = (await kai.get(`/v1/stations/${beat.id}/platforms`).expect(200)).body.platforms;
    expect(list.map((p: { paidPromotionOn: boolean }) => p.paidPromotionOn)).toEqual([true, true, true, false]);
    // Off after the break.
    expect(await h.services.platforms.setPaidPromotion(yt.platformId, false)).toEqual({ applied: true });
    expect(fake.calls.filter((c) => c.op === "setPaidPromotion").at(-1)!.args).toEqual({ videoId: "yt-video-2", on: false });
  });
});

describe("relay viewers, every minute", () => {
  it("reads each connected YouTube and Twitch's concurrent viewers; pasted keys aren't counted", async () => {
    h.clock.set("2026-10-06T03:00:10.000Z");
    fake.youtubeViewers.set("yt-video-2", 212);
    fake.twitchViewers.set("tw-42", 48);
    expect(await h.services.platforms.pollViewers()).toEqual({ polled: 2, samples: 2, failed: 0 });
    h.clock.set("2026-10-06T03:01:10.000Z");
    fake.youtubeViewers.set("yt-video-2", 188);
    fake.twitchViewers.set("tw-42", null); // Twitch went offline
    expect(await h.services.platforms.pollViewers()).toEqual({ polled: 2, samples: 1, failed: 0 });
    const samples = await h.db.select().from(schema.platformViewerSamples).where(eq(schema.platformViewerSamples.stationId, beat.id)).orderBy(schema.platformViewerSamples.minute, schema.platformViewerSamples.kind);
    expect(samples.map((s) => [s.kind, s.minute.toISOString(), s.viewers, s.broadcastRef])).toEqual([
      ["youtube", "2026-10-06T03:00:00.000Z", 212, "yt-video-2"],
      ["twitch", "2026-10-06T03:00:00.000Z", 48, "tw-stream-tw-42"],
      ["youtube", "2026-10-06T03:01:00.000Z", 188, "yt-video-2"]
    ]);
  });

  it("attributes them to whatever aired: a spot inside one minute, a program across both", async () => {
    const [yt, tw] = await h.services.platforms.destinationsFor(beat.id);
    const spot = await h.services.platforms.viewersDuring(yt.platformId, new Date("2026-10-06T03:00:30Z"), new Date("2026-10-06T03:01:00Z"));
    expect(spot).toEqual({ viewers: 212, samples: 1, broadcasts: [{ ref: "yt-video-2", day: "2026-10-06", weight: 1 }] });
    const program = await h.services.platforms.viewersDuring(yt.platformId, new Date("2026-10-06T03:00:00Z"), new Date("2026-10-06T03:02:00Z"));
    expect(program.viewers).toBe(200);
    // Twitch reported nothing in the second minute: none there.
    expect((await h.services.platforms.viewersDuring(tw.platformId, new Date("2026-10-06T03:00:00Z"), new Date("2026-10-06T03:02:00Z"))).viewers).toBe(24);
    // Audience shows the latest count from each, apart from Opencast's viewers.
    const report = await kai.get(`/v1/stations/${beat.id}/audience?from=2026-10-06T02:00:00.000Z&to=2026-10-06T04:00:00.000Z`).expect(200);
    expect(report.body.translators).toEqual([
      { translatorId: yt.platformId, name: "Inland Beat channel", viewers: 188 },
      { translatorId: tw.platformId, name: "inlandbeat on Twitch", viewers: 48 }
    ]);
  });

  it("a platform that refuses Opencast's sign-in asks to sign in again, and isn't polled", async () => {
    fake.refuseAccess = true;
    h.clock.set("2026-10-06T03:02:10.000Z");
    expect(await h.services.platforms.pollViewers()).toEqual({ polled: 2, samples: 0, failed: 2 });
    const list = (await kai.get(`/v1/stations/${beat.id}/platforms`).expect(200)).body.platforms;
    expect(list.slice(0, 2).map((p: { status: string }) => p.status)).toEqual(["needs_sign_in", "needs_sign_in"]);
    expect((await h.services.platforms.destinationsFor(beat.id)).slice(0, 2).map((d) => d.connected)).toEqual([false, false]);
    expect(await h.services.platforms.pollViewers()).toEqual({ polled: 0, samples: 0, failed: 0 });
    fake.refuseAccess = false;
    // Signing in again reconnects the same account, with the same stream and key.
    const before = (await h.services.platforms.destinationsFor(beat.id))[0];
    await signIn("youtube", "Inland Beat channel", "UC-beat");
    const after = (await h.services.platforms.destinationsFor(beat.id))[0];
    expect(after).toMatchObject({ platformId: before.platformId, streamKey: before.streamKey, connected: true });
  });
});

describe("removing a destination", () => {
  it("one click: its key and tokens are erased and the tokens revoked", async () => {
    const [yt] = await h.services.platforms.destinationsFor(beat.id);
    const [row] = await h.db.select().from(schema.platformConnections).where(eq(schema.platformConnections.id, yt.platformId));
    const revokedBefore = fake.revoked.size;
    await ops.delete(`/v1/stations/${beat.id}/platforms/${yt.platformId}`).expect(403);
    await kai.delete(`/v1/stations/${beat.id}/platforms/${yt.platformId}`).expect(200);
    expect(fake.revoked.size).toBe(revokedBefore + 2); // the refresh token and the access token
    const [gone] = await h.db.select().from(schema.platformConnections).where(eq(schema.platformConnections.id, yt.platformId));
    expect(gone).toMatchObject({ streamKeyEnc: null, accessTokenEnc: null, refreshTokenEnc: null });
    expect(gone.removedAt).not.toBeNull();
    expect(row.accessTokenEnc).not.toBeNull();
    const events = await h.db.select().from(schema.platformEvents).where(eq(schema.platformEvents.platformId, yt.platformId));
    expect(events.map((e) => e.kind).slice(-2)).toEqual(["revoked", "removed"]);
    expect((await h.services.platforms.destinationsFor(beat.id)).map((d) => d.kind)).toEqual(["twitch", "facebook", "custom"]);
    await kai.delete(`/v1/stations/${beat.id}/platforms/${yt.platformId}`).expect(404);
  });

  it("is removed even when the platform can't revoke, and says so in its history", async () => {
    const [tw] = await h.services.platforms.destinationsFor(beat.id);
    fake.failRevoke = true;
    await kai.delete(`/v1/stations/${beat.id}/platforms/${tw.platformId}`).expect(200);
    fake.failRevoke = false;
    const events = await h.db.select().from(schema.platformEvents).where(eq(schema.platformEvents.platformId, tw.platformId));
    expect(events.map((e) => e.kind).slice(-2)).toEqual(["revoke_failed", "removed"]);
    // A pasted key: nothing to revoke, just erased.
    const [fb] = await h.services.platforms.destinationsFor(beat.id);
    await kai.delete(`/v1/stations/${beat.id}/platforms/${fb.platformId}`).expect(200);
    expect((await kai.get(`/v1/stations/${beat.id}/platforms`).expect(200)).body.platforms.map((p: { kind: string }) => p.kind)).toEqual(["custom"]);
  });
});

describe("nothing secret is logged", () => {
  it("no key, token or code reached the console", async () => {
    const rows = await h.db.select().from(schema.platformConnections);
    expect(rows.length).toBeGreaterThan(0);
    const text = logged.join("\n");
    for (const plain of ["FB-key-secret", "custom-key-secret", "twitch-key-secret", "yt-key-", "-access-", "-refresh-", "kick2-key-secret"]) expect(text).not.toContain(plain);
    void marketId;
  });
});
