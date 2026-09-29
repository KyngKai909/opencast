// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { RemotePairCode, RemotePhone, TvRemoteEvents } from "@opencast/contracts";
import { z } from "zod";
import { sseParser, type SseEvent } from "../../api/sse";
import { MOCK_TV_ID } from "../db";
import { MOCK_DEVICE_TOKEN } from "../respond";
import { createRemoteMock, type MockChannel } from "./remote";

/** The BroadcastChannel, as the test sees it: what the mock posted, and a way to post to it. */
function fakeChannel() {
  const listeners: Array<(e: MessageEvent) => void> = [];
  const posted: Array<Record<string, unknown>> = [];
  const channel: MockChannel = {
    postMessage: (m) => void posted.push(m as Record<string, unknown>),
    addEventListener: (_t, l) => void listeners.push(l)
  };
  return { channel, posted, send: (data: unknown) => listeners.forEach((l) => l({ data } as MessageEvent)) };
}

let t = Date.parse("2026-09-27T03:42:00Z");
const ch = fakeChannel();
const mock = createRemoteMock(ch.channel, { now: () => t });
const server = setupServer(...mock.handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => (ch.posted.length = 0));

const KAI = "00000000-0000-4000-8000-00000000a001";
const SAM = "00000000-0000-4000-8000-00000000a002";
const auth = { authorization: `Bearer ${MOCK_DEVICE_TOKEN}` };
const flush = () => new Promise((r) => setTimeout(r, 10));

async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`http://localhost/v1${path}`, { method, headers: { ...auth, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

/** Opens the TV's stream and collects its events. */
async function openStream() {
  const ctl = new AbortController();
  const res = await fetch("http://localhost/v1/tv/remote/events", { headers: auth, signal: ctl.signal });
  const events: SseEvent[] = [];
  const parser = sseParser((e) => events.push(e));
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(dec.decode(value, { stream: true }));
      }
    } catch {
      /* aborted */
    }
  })();
  return { res, events, parser, close: () => ctl.abort(), data: (name: string) => events.filter((e) => e.event === name).map((e) => JSON.parse(e.data)) };
}

describe("the relay, mocked", () => {
  it("refuses the TV's stream without its token", async () => {
    expect((await fetch("http://localhost/v1/tv/remote/events")).status).toBe(401);
  });

  it("opens the TV's stream with the phones, and turns relay-tv messages into commands", async () => {
    const s = await openStream();
    expect(s.res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    await flush();
    expect(s.parser.retryMs()).toBe(3000);
    expect(s.data("phones")).toEqual([{ phones: [] }]);
    expect(mock.streams()).toBe(1);

    ch.send({ to: "relay-tv", tvId: MOCK_TV_ID, phoneId: KAI, name: "Kai's phone", command: { type: "channel", dir: "up" } });
    ch.send({ to: "relay-tv", tvId: "someone-else", phoneId: KAI, name: "Kai's phone", command: { type: "info" } });
    ch.send({ to: "relay-tv", tvId: MOCK_TV_ID, phoneId: KAI, name: "Kai's phone", command: { type: "explode" } });
    await flush();
    const commands = s.data("command").map((d) => TvRemoteEvents.command.parse(d));
    expect(commands).toEqual([{ command: { type: "channel", dir: "up" }, from: { phoneId: KAI, name: "Kai's phone" }, at: "2026-09-27T03:42:00.000Z" }]);
    // The phone that drove it is on the list now, as the account's.
    const last = z.array(RemotePhone).parse(s.data("phones").at(-1).phones);
    expect(last).toMatchObject([{ id: KAI, kind: "account", lastCommandAt: "2026-09-27T03:42:00.000Z" }]);
    s.close();
    await flush();
    expect(mock.streams()).toBe(0);
  });

  it("posts the TV's state and the end of the session back to phones", async () => {
    const state = { stationId: "civc", paused: false, changedBy: "Kai's phone", sleepEndsAt: null };
    expect((await api("/tv/remote/state", "POST", state)).body).toEqual({ ok: true });
    expect(ch.posted).toEqual([{ to: "relay-phone", tvId: MOCK_TV_ID, state }]);
    // A phone that connects hears what's on at once.
    ch.send({ to: "relay-tv", tvId: MOCK_TV_ID, phoneId: KAI, name: "Kai's phone", connected: true });
    expect(ch.posted.at(-1)).toEqual({ to: "relay-phone", tvId: MOCK_TV_ID, phoneId: KAI, state });
    expect((await api("/tv/remote/end", "POST")).body).toEqual({ ok: true });
    expect(ch.posted.at(-1)).toEqual({ to: "relay-phone", tvId: MOCK_TV_ID, ended: "tv_ended" });
  });

  it("pairs a guest's phone with the code on screen, lists it, and removes it", async () => {
    const created = await api("/tv/remote/pair-code", "POST");
    expect(created.status).toBe(201);
    const code = RemotePairCode.parse(created.body);
    expect(code).toEqual({ code: "4821", expiresAt: "2026-09-27T03:47:00.000Z" });

    ch.send({ to: "relay-tv", phoneId: SAM, name: "Sam's phone", pairCode: "0000" });
    expect(ch.posted.at(-1)).toMatchObject({ to: "relay-phone", tvId: null, phoneId: SAM, error: { code: "code_not_found" } });
    ch.send({ to: "relay-tv", phoneId: SAM, name: "Sam's phone", pairCode: "4821" });
    expect(ch.posted.at(-1)).toEqual({ to: "relay-phone", tvId: MOCK_TV_ID, phoneId: SAM, paired: { tvId: MOCK_TV_ID, tvName: "Den TV", phoneToken: `mock-phone-token-${SAM}` } });

    const listed = z.array(RemotePhone).parse((await api("/tv/remote/phones")).body);
    expect(listed.find((p) => p.id === SAM)).toMatchObject({ kind: "guest", name: "Sam's phone" });

    const removed = z.array(RemotePhone).parse((await api(`/tv/remote/phones/${SAM}`, "DELETE")).body);
    expect(removed.some((p) => p.id === SAM)).toBe(false);
    expect(ch.posted.at(-1)).toEqual({ to: "relay-phone", tvId: MOCK_TV_ID, phoneId: SAM, ended: "unpaired" });
    expect((await api(`/tv/remote/phones/${SAM}`, "DELETE")).status).toBe(404);

    // A code that has run out pairs nobody.
    t += 5 * 60_000;
    ch.send({ to: "relay-tv", phoneId: SAM, name: "Sam's phone", pairCode: "4821" });
    expect(ch.posted.at(-1)).toMatchObject({ error: { code: "code_not_found" } });
  });

  it("tells the TV when the account signs it out, and ends the account's phones", async () => {
    const s = await openStream();
    await flush();
    mock.signOutRemotely();
    await flush();
    expect(s.data("signed_out")).toEqual([{}]);
    expect(ch.posted.at(-1)).toEqual({ to: "relay-phone", tvId: MOCK_TV_ID, ended: "signed_out", kind: "account" });
    expect(s.data("phones").at(-1).phones.some((p: RemotePhone) => p.kind === "account")).toBe(false);
    s.close();
  });
});
