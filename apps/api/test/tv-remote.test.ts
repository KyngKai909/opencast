// The phone remote's relay over Server-Sent Events: a TV and phones on a real HTTP server. A phone
// on the TV's account drives it without pairing; a guest's phone pairs by code; anyone else is
// refused. Commands reach the TV with who sent them; the TV's state reaches every phone. Then the
// same across two API instances through the local Redis.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createV1 } from "../src/v1/index.js";
import { redisRelayBus } from "../src/v1/relay.js";
import { anon, createHarness, type Harness, type User } from "./harness.js";

interface Stream {
  status: number;
  body: unknown;
  events: Array<{ event: string; data: unknown }>;
  pings: number;
  ended: Promise<void>;
  isEnded(): boolean;
  /** The next event with this name not yet taken. */
  next(event: string, timeoutMs?: number): Promise<unknown>;
  /** No event with this name arrives within the time. */
  none(event: string, ms?: number): Promise<void>;
  close(): void;
}

async function openStream(base: string, path: string, token?: string): Promise<Stream> {
  const controller = new AbortController();
  const res = await fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: controller.signal });
  const events: Stream["events"] = [];
  const taken = new Set<number>();
  let ended = false;
  let pings = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  if (!res.headers.get("content-type")?.startsWith("text/event-stream")) {
    const body = await res.json();
    return { status: res.status, body, events, pings, ended: Promise.resolve(), isEnded: () => true, next: () => Promise.reject(new Error("not a stream")), none: async () => undefined, close: () => undefined };
  }
  const endedPromise = (async () => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          if (block.startsWith(": ping")) pings++;
          const event = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data) });
          notify();
        }
      }
    } catch {
      // Aborted.
    }
    ended = true;
    notify();
  })();
  const stream: Stream = {
    status: res.status,
    body: null,
    events,
    get pings() {
      return pings;
    },
    ended: endedPromise,
    isEnded: () => ended,
    next(event, timeoutMs = 3_000) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const i = events.findIndex((e, index) => e.event === event && !taken.has(index));
          if (i >= 0) {
            taken.add(i);
            listeners.delete(check);
            clearTimeout(timer);
            resolve(events[i].data);
          }
        };
        const timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error(`no ${event} event within ${timeoutMs} ms; had ${JSON.stringify(events.map((e) => e.event))}`));
        }, timeoutMs);
        listeners.add(check);
        check();
      });
    },
    async none(event, ms = 300) {
      await new Promise((r) => setTimeout(r, ms));
      const unseen = events.filter((e, index) => e.event === event && !taken.has(index));
      expect(unseen).toEqual([]);
    },
    close: () => controller.abort()
  };
  return stream;
}

const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms));

function listen(app: express.Express): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

async function stop(server: Server) {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}

const as = (h: Harness, token: string) => ({
  get: (url: string) => request(h.app).get(url).set("authorization", `Bearer ${token}`),
  post: (url: string, body?: object) => request(h.app).post(url).set("authorization", `Bearer ${token}`).send(body),
  delete: (url: string) => request(h.app).delete(url).set("authorization", `Bearer ${token}`)
});

async function signedInTv(h: Harness, person: User, name = "Den TV") {
  const reg = await anon(h).post("/v1/tv/devices").send({ platform: "android_tv", name }).expect(201);
  const code = await as(h, reg.body.deviceToken).post("/v1/tv/codes").expect(201);
  await person.post(`/v1/tv/codes/${code.body.code}/approve`).expect(200);
  const poll = await anon(h).get(`/v1/tv/codes/${code.body.pollToken}`).expect(200);
  return { tvId: reg.body.tvId as string, device: reg.body.deviceToken as string, session: poll.body.token as string };
}

describe("the remote relay", () => {
  let h: Harness;
  let base: string;
  let server: Server;
  const open: Stream[] = [];
  const stream = async (path: string, token?: string) => {
    const s = await openStream(base, path, token);
    open.push(s);
    return s;
  };

  beforeAll(async () => {
    h = await createHarness({ sseHeartbeatMs: 200 });
    ({ server, base } = await listen(h.app));
  }, 60_000);
  afterAll(async () => {
    open.forEach((s) => s.close());
    await stop(server);
    // Streams write their last presence as they close: let them before the database goes.
    await settle(300);
    await h.close();
  });

  it("a TV, a phone on its account and a paired guest: commands with who sent them, state to every phone", async () => {
    const kai = await h.signIn("Kai M.");
    const dee = await h.signIn("Dee");
    const den = await signedInTv(h, kai);

    // The TV's stream (its device token), with the phones list first, and heartbeats.
    const tv = await stream("/v1/tv/remote/events", den.device);
    expect(tv.status).toBe(200);
    expect(await tv.next("phones")).toEqual({ phones: [] });
    const tvs = await kai.get("/v1/me/tvs").expect(200);
    expect(tvs.body[0]).toMatchObject({ id: den.tvId, online: true, castingNow: false });

    // Nobody who isn't on the account or paired.
    const stranger = await stream(`/v1/tv/remote/${den.tvId}/events`, dee.token);
    expect([stranger.status, (stranger.body as { error: { code: string } }).error.code]).toEqual([403, "not_paired"]);
    const nobody = await stream(`/v1/tv/remote/${den.tvId}/events`);
    expect(nobody.status).toBe(403);
    const refused = await dee.post(`/v1/tv/remote/${den.tvId}/commands`, { command: { type: "channel", dir: "up" }, name: "Dee's phone" }).expect(403);
    expect(refused.body.error.code).toBe("not_paired");
    await dee.post(`/v1/tv/remote/${randomUUID()}/commands`, { command: { type: "info" }, name: "Dee's phone" }).expect(404);
    // The TV's own session can't drive it as a phone.
    await as(h, den.session).post(`/v1/tv/remote/${den.tvId}/commands`, { command: { type: "info" }, name: "TV" }).expect(403);

    // Kai's phone: same account, no pairing.
    const kaiPhone = await stream(`/v1/tv/remote/${den.tvId}/events`, kai.token);
    expect(kaiPhone.status).toBe(200);
    const listed = (await tv.next("phones")) as { phones: Array<{ id: string; name: string; kind: string; connected: boolean }> };
    expect(listed.phones).toEqual([expect.objectContaining({ name: "Kai's phone", kind: "account", connected: true })]);
    const kaiPhoneId = listed.phones[0].id;
    expect((await kai.get("/v1/me/tvs").expect(200)).body[0]).toMatchObject({ online: true, castingNow: true });

    await kai.post(`/v1/tv/remote/${den.tvId}/commands`, { command: { type: "channel", dir: "up" }, name: "Kai's phone" }).expect(202);
    expect(await tv.next("command")).toEqual({ command: { type: "channel", dir: "up" }, from: { phoneId: kaiPhoneId, name: "Kai's phone" }, at: h.clock.now().toISOString() });
    // Only the command set parseCastCommand accepts.
    await kai.post(`/v1/tv/remote/${den.tvId}/commands`, { command: { type: "channel", dir: "sideways" }, name: "Kai's phone" }).expect(400);
    await kai.post(`/v1/tv/remote/${den.tvId}/commands`, { command: { type: "selfDestruct" }, name: "Kai's phone" }).expect(400);
    await kai.post(`/v1/tv/remote/${den.tvId}/commands`, { command: { type: "sleep", until: 500 }, name: "Kai's phone" }).expect(400);
    await kai.post(`/v1/tv/remote/${den.tvId}/commands`, { command: { type: "sleep", until: "end_of_program" }, name: "Kai's phone" }).expect(202);
    expect(await tv.next("command")).toMatchObject({ command: { type: "sleep", until: "end_of_program" } });

    const state = { stationId: randomUUID(), paused: false, changedBy: "Kai's phone", sleepEndsAt: null };
    await as(h, den.device).post("/v1/tv/remote/state", state).expect(200);
    expect(await kaiPhone.next("state")).toEqual(state);

    // A guest pairs with the code on the TV.
    const pairCode = await as(h, den.device).post("/v1/tv/remote/pair-code").expect(201);
    expect(pairCode.body.code).toMatch(/^\d{4}$/);
    expect(pairCode.body.expiresAt).toBe(new Date(h.clock.now().getTime() + 5 * 60_000).toISOString());
    const paired = await anon(h).post("/v1/tv/remote/pair").send({ code: pairCode.body.code, name: "Dee's phone" }).expect(201);
    expect(paired.body).toEqual({ tvId: den.tvId, tvName: "Den TV", phoneToken: expect.stringMatching(/^tvp_/) });
    const afterPair = (await tv.next("phones")) as { phones: Array<{ id: string; name: string; kind: string }> };
    expect(afterPair.phones.map((p) => [p.kind, p.name])).toEqual([
      ["account", "Kai's phone"],
      ["guest", "Dee's phone"]
    ]);
    const deeId = afterPair.phones[1].id;

    // Its stream starts with what the TV is showing.
    const deePhone = await stream(`/v1/tv/remote/${den.tvId}/events`, paired.body.phoneToken);
    expect(await deePhone.next("state")).toEqual(state);
    await request(h.app).post(`/v1/tv/remote/${den.tvId}/commands`).set("authorization", `Bearer ${paired.body.phoneToken}`).send({ command: { type: "tune", channel: "7.1" }, name: "Dee's phone" }).expect(202);
    expect(await tv.next("command")).toMatchObject({ command: { type: "tune", channel: "7.1" }, from: { phoneId: deeId, name: "Dee's phone" } });

    // The TV applies "who can change the channel" itself; its new state reaches both phones.
    const changed = { ...state, changedBy: "Dee's phone", paused: true };
    await as(h, den.device).post("/v1/tv/remote/state", changed).expect(200);
    expect(await kaiPhone.next("state")).toEqual(changed);
    expect(await deePhone.next("state")).toEqual(changed);

    // A phone token is for its TV's remote only.
    await as(h, paired.body.phoneToken).get("/v1/me").expect(401);
    const other = await signedInTv(h, kai, "Office TV");
    const wrongTv = await stream(`/v1/tv/remote/${other.tvId}/events`, paired.body.phoneToken);
    expect(wrongTv.status).toBe(403);

    // Heartbeats keep the streams alive.
    await settle(450);
    expect(tv.pings).toBeGreaterThan(0);
    expect(kaiPhone.pings).toBeGreaterThan(0);

    // Unpairing: Dee's phone is told and cut off; its token stops working.
    const phonesLeft = await as(h, den.device).delete(`/v1/tv/remote/phones/${deeId}`).expect(200);
    expect(phonesLeft.body.map((p: { kind: string }) => p.kind)).toEqual(["account"]);
    expect(await deePhone.next("ended")).toEqual({ reason: "unpaired" });
    await deePhone.ended;
    await kaiPhone.none("ended");
    await request(h.app).post(`/v1/tv/remote/${den.tvId}/commands`).set("authorization", `Bearer ${paired.body.phoneToken}`).send({ command: { type: "info" }, name: "Dee's phone" }).expect(403);
    await as(h, den.device).delete(`/v1/tv/remote/phones/${deeId}`).expect(404);

    // The TV ends the session (the sleep timer): every phone is told.
    await as(h, den.device).post("/v1/tv/remote/end").expect(200);
    expect(await kaiPhone.next("ended")).toEqual({ reason: "tv_ended" });
    await kaiPhone.ended;

    // Online: a closed TV stream stays online for a short grace, then isn't; commands then fail.
    tv.close();
    await tv.ended;
    await settle();
    expect((await kai.get("/v1/me/tvs").expect(200)).body.find((t: { id: string }) => t.id === den.tvId).online).toBe(true);
    h.clock.advance(11_000);
    try {
      expect((await kai.get("/v1/me/tvs").expect(200)).body.find((t: { id: string }) => t.id === den.tvId).online).toBe(false);
      const offline = await kai.post(`/v1/tv/remote/${den.tvId}/commands`, { command: { type: "info" }, name: "Kai's phone" }).expect(409);
      expect(offline.body.error.code).toBe("tv_not_connected");
    } finally {
      h.clock.advance(-11_000);
    }
  });

  it("pair codes run out after 5 minutes, a new one replaces the last, and wrong codes are limited", async () => {
    const kai = await h.signIn();
    const den = await signedInTv(h, kai);
    const first = await as(h, den.device).post("/v1/tv/remote/pair-code").expect(201);
    const second = await as(h, den.device).post("/v1/tv/remote/pair-code").expect(201);
    if (first.body.code !== second.body.code) {
      const stale = await anon(h).post("/v1/tv/remote/pair").send({ code: first.body.code, name: "Late phone" }).expect(404);
      expect(stale.body.error.code).toBe("code_not_found");
    }
    h.clock.advance(5 * 60_000 + 1_000);
    try {
      await anon(h).post("/v1/tv/remote/pair").send({ code: second.body.code, name: "Late phone" }).expect(404);
    } finally {
      h.clock.advance(-(5 * 60_000 + 1_000));
    }

    // Guessing: a signed-in phone is limited by its account...
    const guesser = await h.signIn();
    const fresh = await as(h, den.device).post("/v1/tv/remote/pair-code").expect(201);
    const wrong = fresh.body.code === "0000" ? "0001" : "0000";
    for (let i = 0; i < 10; i++) await guesser.post("/v1/tv/remote/pair", { code: wrong, name: "Guesser" }).expect(404);
    const limited = await guesser.post("/v1/tv/remote/pair", { code: fresh.body.code, name: "Guesser" }).expect(429);
    expect(limited.body.error.code).toBe("too_many_tries");
    // ...and one that isn't, by its connection (the address the edge proxy added).
    const neighbour = () => anon(h).post("/v1/tv/remote/pair").set("x-forwarded-for", "192.0.2.50, 198.51.100.7");
    await neighbour().send({ code: fresh.body.code, name: "Neighbour" }).expect(201);
    for (let i = 0; i < 10; i++) await neighbour().send({ code: wrong, name: "Neighbour" }).expect(404);
    await neighbour().send({ code: fresh.body.code, name: "Neighbour" }).expect(429);
    // A different first entry (which the client can make up) is the same connection.
    await anon(h).post("/v1/tv/remote/pair").set("x-forwarded-for", "203.0.113.1, 198.51.100.7").send({ code: fresh.body.code, name: "Neighbour" }).expect(429);
    // Another connection isn't limited.
    await anon(h).post("/v1/tv/remote/pair").set("x-forwarded-for", "198.51.100.8").send({ code: wrong, name: "Other" }).expect(404);
    h.clock.advance(10 * 60_000 + 1_000);
    try {
      const again = await as(h, den.device).post("/v1/tv/remote/pair-code").expect(201);
      await neighbour().send({ code: again.body.code, name: "Neighbour" }).expect(201);
    } finally {
      h.clock.advance(-(10 * 60_000 + 1_000));
    }
    const phones = await as(h, den.device).get("/v1/tv/remote/phones").expect(200);
    expect(phones.body.map((p: { name: string; connected: boolean }) => [p.name, p.connected])).toEqual([
      ["Neighbour", false],
      ["Neighbour", false]
    ]);
  });

  it("signing the TV out from the account ends the account's phones and tells the TV", async () => {
    const kai = await h.signIn("Kai");
    const den = await signedInTv(h, kai);
    const tv = await stream("/v1/tv/remote/events", den.session);
    await tv.next("phones");
    const code = await as(h, den.device).post("/v1/tv/remote/pair-code").expect(201);
    const guest = await anon(h).post("/v1/tv/remote/pair").set("x-forwarded-for", "198.51.100.20").send({ code: code.body.code, name: "Guest" }).expect(201);
    const kaiPhone = await stream(`/v1/tv/remote/${den.tvId}/events`, kai.token);
    const guestPhone = await stream(`/v1/tv/remote/${den.tvId}/events`, guest.body.phoneToken);
    await settle();

    await kai.delete(`/v1/me/tvs/${den.tvId}`).expect(200);
    expect(await kaiPhone.next("ended")).toEqual({ reason: "signed_out" });
    expect(await tv.next("signed_out")).toEqual({});
    await guestPhone.none("ended");
    // The guest's pairing is with the TV, not the account: it still drives it.
    await request(h.app).post(`/v1/tv/remote/${den.tvId}/commands`).set("authorization", `Bearer ${guest.body.phoneToken}`).send({ command: { type: "last" }, name: "Guest" }).expect(202);
    expect(await tv.next("command")).toMatchObject({ command: { type: "last" }, from: { name: "Guest" } });
    // Kai's phone can't, now the TV isn't on Kai's account.
    await kai.post(`/v1/tv/remote/${den.tvId}/commands`, { command: { type: "info" }, name: "Kai's phone" }).expect(403);
  });
});

describe("the relay across two API instances (Redis)", () => {
  const url = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:63799";
  let available = false;
  let h: Harness;
  let a: { server: Server; base: string };
  let b: { server: Server; base: string };
  const prefix = `opencast-test:${randomUUID()}:`;
  const busB = redisRelayBus(url, prefix);
  const open: Stream[] = [];

  beforeAll(async () => {
    const probe = createClient({ url, socket: { connectTimeout: 1_000, reconnectStrategy: false } });
    probe.on("error", () => undefined);
    available = await probe
      .connect()
      .then(() => probe.ping())
      .then(() => true)
      .catch(() => false);
    await probe.quit().catch(() => undefined);
    if (!available) return;
    h = await createHarness({ relay: redisRelayBus(url, prefix) });
    a = await listen(h.app);
    // A second instance: the same database, its own services and its own Redis connections.
    const second = express();
    second.use("/v1", createV1({ ...h.deps, relay: busB }).router);
    b = await listen(second);
  }, 60_000);
  afterAll(async () => {
    open.forEach((s) => s.close());
    if (!available) return;
    await stop(a.server);
    await stop(b.server);
    await settle(300);
    await busB.close();
    await h.close();
  });

  it("a command sent through one instance reaches the TV on the other, and its state comes back", async (ctx) => {
    if (!available) ctx.skip();
    const kai = await h.signIn("Kai");
    const den = await signedInTv(h, kai);
    const tv = await openStream(a.base, "/v1/tv/remote/events", den.device);
    open.push(tv);
    await tv.next("phones");
    const phone = await openStream(b.base, `/v1/tv/remote/${den.tvId}/events`, kai.token);
    open.push(phone);
    // The TV hears of the phone connecting on the other instance.
    expect(await tv.next("phones")).toMatchObject({ phones: [{ name: "Kai's phone", connected: true }] });

    const res = await fetch(`${b.base}/v1/tv/remote/${den.tvId}/commands`, {
      method: "POST",
      headers: { authorization: `Bearer ${kai.token}`, "content-type": "application/json" },
      body: JSON.stringify({ command: { type: "preset", key: 3 }, name: "Kai's phone" })
    });
    expect(res.status).toBe(202);
    expect(await tv.next("command")).toMatchObject({ command: { type: "preset", key: 3 }, from: { name: "Kai's phone" } });

    const state = { stationId: null, paused: false, changedBy: "Kai's phone", sleepEndsAt: 1_790_000_000_000 };
    await as(h, den.device).post("/v1/tv/remote/state", state).expect(200);
    expect(await phone.next("state")).toEqual(state);
  });
});
