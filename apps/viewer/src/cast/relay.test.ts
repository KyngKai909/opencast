// The relay sender (B2's remote relay for the Opencast TV app): reading the phone's event stream,
// reconnecting, commands, the remote ending, and dev:mock's bridge messages.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteState } from "@opencast/contracts";
import { ApiError } from "../api/client";
import { mockRelayLink, relayPhoneEvent } from "./mockRelay";
import { loadPairings, pairingFor, savePairing } from "./pairings";
import { createRelaySender, endedLine, reconnectDelay, type PhoneEvent, type RelayAuth, type RelayHandlers, type RelayLink } from "./relay";
import { apiRelayLink, createSseParser, phoneEvent, type SseMessage } from "./relayApi";
import type { CastTarget, ReceiverState } from "./types";

const DEN = "00000000-0000-4000-8000-0000000c0001";
const STATE: RemoteState = { stationId: "s1", paused: false, changedBy: "Kai's phone", sleepEndsAt: null };
const INTRO = { from: "Kai's phone", marketSlug: "inland-empire", othersCanChange: true };
const denApp: CastTarget = { id: DEN, name: "Den TV", kind: "tv_app", online: true, platformLabel: "Fire TV" };

beforeEach(() => localStorage.removeItem("oc-tv-pairings"));

describe("reading the phone's event stream", () => {
  const read = (chunks: string[]) => {
    const got: SseMessage[] = [];
    const retries: number[] = [];
    const feed = createSseParser((m) => got.push(m), (ms) => retries.push(ms));
    chunks.forEach(feed);
    return { got, retries };
  };

  it("makes a message of event and data lines up to a blank line, skipping pings", () => {
    const { got, retries } = read(["retry: 3000\n\n", ": ping\n\n", 'event: state\ndata: {"a":1}\n\n']);
    expect(got).toEqual([{ event: "state", data: '{"a":1}' }]);
    expect(retries).toEqual([3000]);
  });

  it("puts a message together across chunks, CRLF split between them too", () => {
    const { got } = read(["event: sta", "te\r", "\ndata: {\"a\"", ":1}\r\n", "\r\n", "event: ended\rdata: x\r\r"]);
    expect(got).toEqual([
      { event: "state", data: '{"a":1}' },
      { event: "ended", data: "x" }
    ]);
  });

  it("joins several data lines with newlines, and waits for the blank line", () => {
    const { got } = read(["data: one\ndata: two\n", "\n", "event: state\ndata: late"]);
    expect(got).toEqual([{ event: "message", data: "one\ntwo" }]);
  });

  it("keeps only events the contract knows, with data that matches it", () => {
    expect(phoneEvent({ event: "state", data: JSON.stringify(STATE) })).toEqual({ event: "state", data: STATE });
    expect(phoneEvent({ event: "ended", data: '{"reason":"unpaired"}' })).toEqual({ event: "ended", data: { reason: "unpaired" } });
    expect(phoneEvent({ event: "ended", data: '{"reason":"bored"}' })).toBeNull();
    expect(phoneEvent({ event: "state", data: "{not json" })).toBeNull();
    expect(phoneEvent({ event: "phones", data: "{}" })).toBeNull();
  });
});

/** A fetch whose event stream the test writes to. */
function fakeApi() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let push: ((s: string) => void) | null = null;
  let finish: (() => void) | null = null;
  let next: Response | null = null;
  const fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    if (next) {
      const r = next;
      next = null;
      return r;
    }
    if (init.method === "POST") return new Response(JSON.stringify({ ok: true }), { status: 202 });
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        push = (s) => c.enqueue(enc.encode(s));
        finish = () => c.close();
        init.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
      }
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof globalThis.fetch;
  return {
    fetch,
    calls,
    push: (s: string) => push!(s),
    finish: () => finish!(),
    answer: (status: number, code: string, message: string) => (next = new Response(JSON.stringify({ error: { code, message } }), { status }))
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the relay over the API", () => {
  it("opens the phone's stream with the account's token and reads state and ended", async () => {
    const api = fakeApi();
    const link = apiRelayLink({ fetch: api.fetch, token: async () => "privy-token", base: "http://api.test" });
    const events: PhoneEvent[] = [];
    const drop = vi.fn();
    await link.open(DEN, { kind: "account" }, { event: (e) => events.push(e), drop }, "Kai's phone");
    expect(api.calls[0]!.url).toBe(`http://api.test/v1/tv/remote/${DEN}/events`);
    expect((api.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer privy-token");
    api.push(`retry: 3000\n\nevent: state\ndata: ${JSON.stringify(STATE)}\n\n`);
    api.push('event: ended\ndata: {"reason":"tv_ended"}\n\n');
    await flush();
    expect(events).toEqual([
      { event: "state", data: STATE },
      { event: "ended", data: { reason: "tv_ended" } }
    ]);
    api.finish();
    await flush();
    expect(drop).toHaveBeenCalledWith(3000);
  });

  it("doesn't report a drop when the phone closed the stream itself", async () => {
    const api = fakeApi();
    const drop = vi.fn();
    const close = await apiRelayLink({ fetch: api.fetch, token: async () => null, base: "" }).open(DEN, { kind: "account" }, { event: () => {}, drop }, "Kai's phone");
    close();
    await flush();
    expect(drop).not.toHaveBeenCalled();
  });

  it("sends a guest's phone token, and the command with the phone's name", async () => {
    const api = fakeApi();
    const link = apiRelayLink({ fetch: api.fetch, token: async () => "privy-token", base: "" });
    await link.send(DEN, { kind: "paired", phoneToken: "tvp_abc" }, { type: "channel", dir: "up" }, "a phone");
    const { url, init } = api.calls[0]!;
    expect(url).toBe(`/v1/tv/remote/${DEN}/commands`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tvp_abc");
    expect(JSON.parse(String(init.body))).toEqual({ command: { type: "channel", dir: "up" }, name: "a phone" });
  });

  it("refuses in the API's words", async () => {
    const api = fakeApi();
    const link = apiRelayLink({ fetch: api.fetch, token: async () => null, base: "" });
    api.answer(409, "tv_not_connected", "The TV isn't connected. Check that Opencast is open on it.");
    await expect(link.send(DEN, { kind: "account" }, { type: "info" }, "Kai's phone")).rejects.toMatchObject({ status: 409, code: "tv_not_connected" });
    api.answer(403, "not_paired", "Pair this phone with the TV first: enter the code the TV shows.");
    await expect(link.open(DEN, { kind: "account" }, { event: () => {}, drop: () => {} }, "Kai's phone")).rejects.toMatchObject({ status: 403, code: "not_paired" });
  });
});

/** A link the test drives: it records opens and sends, and hands back each stream's handlers. */
function fakeLink() {
  const opens: Array<{ tvId: string; auth: RelayAuth; on: RelayHandlers; closed: boolean }> = [];
  const sends: Array<{ tvId: string; auth: RelayAuth; command: unknown; name: string }> = [];
  let refuseOpen: unknown = null;
  let refuseSend: unknown = null;
  const link: RelayLink = {
    async open(tvId, auth, on) {
      if (refuseOpen) {
        const e = refuseOpen;
        refuseOpen = null;
        throw e;
      }
      const o = { tvId, auth, on, closed: false };
      opens.push(o);
      return () => (o.closed = true);
    },
    async send(tvId, auth, command, name) {
      sends.push({ tvId, auth, command, name });
      if (refuseSend) throw refuseSend;
    }
  };
  return { link, opens, sends, refuseOpen: (e: unknown) => (refuseOpen = e), refuseSend: (e: unknown) => (refuseSend = e) };
}

describe("the relay sender", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("connects as the account, passes the TV's state on, and sends commands with the phone's name", async () => {
    const f = fakeLink();
    const sender = createRelaySender(f.link);
    const states: ReceiverState[] = [];
    sender.onState((s) => states.push(s));
    expect(sender.kind).toBe("relay");
    await expect(sender.connect(denApp, INTRO)).resolves.toBe(denApp);
    expect(f.opens[0]).toMatchObject({ tvId: DEN, auth: { kind: "account" } });
    f.opens[0]!.on.event({ event: "state", data: STATE });
    expect(states).toEqual([STATE]);
    sender.send({ type: "tune", channel: "24.1" });
    expect(f.sends).toEqual([{ tvId: DEN, auth: { kind: "account" }, command: { type: "tune", channel: "24.1" }, name: "Kai's phone" }]);
    expect(sender.connected()).toBe(denApp);
    sender.disconnect();
    expect(f.opens[0]!.closed).toBe(true);
    expect(sender.connected()).toBeNull();
  });

  it("uses the pairing's phone token for a TV paired by code", async () => {
    savePairing({ tvId: DEN, tvName: "Den TV", phoneToken: "tvp_1" });
    const f = fakeLink();
    const sender = createRelaySender(f.link);
    await sender.connect({ id: DEN, name: "Den TV", kind: "tv_app", paired: true }, { ...INTRO, from: "a phone" });
    expect(f.opens[0]!.auth).toEqual({ kind: "paired", phoneToken: "tvp_1" });
    sender.send({ type: "info" });
    expect(f.sends[0]).toMatchObject({ auth: { kind: "paired", phoneToken: "tvp_1" }, name: "a phone" });
  });

  it("won't connect to a TV app that isn't on, and says so", async () => {
    const f = fakeLink();
    await expect(createRelaySender(f.link).connect({ ...denApp, online: false }, INTRO)).rejects.toThrow("Den TV isn't on. Open Opencast on the TV and try again.");
    expect(f.opens).toHaveLength(0);
  });

  it("says why a refused connection was refused, in the API's words", async () => {
    const f = fakeLink();
    f.refuseOpen(new ApiError(403, "not_paired", "Pair this phone with the TV first: enter the code the TV shows."));
    await expect(createRelaySender(f.link).connect(denApp, INTRO)).rejects.toThrow("Pair this phone with the TV first");
  });

  it("reconnects after the stream drops, waiting longer each time, and keeps its listeners", async () => {
    const f = fakeLink();
    const sender = createRelaySender(f.link);
    const states: ReceiverState[] = [];
    sender.onState((s) => states.push(s));
    await sender.connect(denApp, INTRO);
    f.opens[0]!.on.drop();
    await vi.advanceTimersByTimeAsync(999);
    expect(f.opens).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.opens).toHaveLength(2);
    // Refused by the network (not the API) on the way: keep trying, a little later.
    f.opens[1]!.on.drop();
    f.refuseOpen(new TypeError("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.opens).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.opens).toHaveLength(3);
    f.opens[2]!.on.event({ event: "state", data: STATE });
    expect(states).toEqual([STATE]);
    expect(sender.connected()).toBe(denApp);
  });

  it("stops reconnecting once disconnected", async () => {
    const f = fakeLink();
    const sender = createRelaySender(f.link);
    await sender.connect(denApp, INTRO);
    f.opens[0]!.on.drop();
    sender.disconnect();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.opens).toHaveLength(1);
  });

  it("waits 1, 2, 4, 8 then 15 seconds, or the server's retry if longer", () => {
    expect([0, 1, 2, 3, 4, 9].map((n) => reconnectDelay(n))).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000]);
    expect(reconnectDelay(0, 3000)).toBe(3000);
  });

  it("ends when the relay says so: unpaired forgets the pairing and says why", async () => {
    savePairing({ tvId: DEN, tvName: "Den TV", phoneToken: "tvp_1" });
    const f = fakeLink();
    const sender = createRelaySender(f.link);
    const ended = vi.fn();
    sender.onEnded(ended);
    await sender.connect({ id: DEN, name: "Den TV", kind: "tv_app", paired: true }, INTRO);
    f.opens[0]!.on.event({ event: "ended", data: { reason: "unpaired" } });
    expect(ended).toHaveBeenCalledWith("Den TV unpaired this phone. Use a code from the TV to pair again.");
    expect(pairingFor(DEN)).toBeNull();
    expect(f.opens[0]!.closed).toBe(true);
    expect(sender.connected()).toBeNull();
    // A drop after the end isn't a reason to reconnect.
    f.opens[0]!.on.drop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.opens).toHaveLength(1);
  });

  it("ends quietly when the TV ended it (its sleep timer), as Cast does", async () => {
    const f = fakeLink();
    const sender = createRelaySender(f.link);
    const ended = vi.fn();
    sender.onEnded(ended);
    await sender.connect(denApp, INTRO);
    f.opens[0]!.on.event({ event: "ended", data: { reason: "tv_ended" } });
    expect(ended).toHaveBeenCalledWith(undefined);
    expect(endedLine("signed_out", "Den TV")).toBe("Den TV was signed out.");
  });

  it("ends with the offline words when a command finds the TV not listening", async () => {
    const f = fakeLink();
    const sender = createRelaySender(f.link);
    const ended = vi.fn();
    sender.onEnded(ended);
    await sender.connect(denApp, INTRO);
    f.refuseSend(new ApiError(409, "tv_not_connected", "The TV isn't connected. Check that Opencast is open on it."));
    sender.send({ type: "channel", dir: "up" });
    await vi.advanceTimersByTimeAsync(0);
    expect(ended).toHaveBeenCalledWith("Den TV isn't on. Open Opencast on the TV and try again.");
  });

  it("forgets a pairing the API no longer knows (401 on the phone token)", async () => {
    savePairing({ tvId: DEN, tvName: "Den TV", phoneToken: "tvp_gone" });
    const f = fakeLink();
    f.refuseOpen(new ApiError(401, "unauthorized", "This phone isn't paired any more."));
    await expect(createRelaySender(f.link).connect({ id: DEN, name: "Den TV", kind: "tv_app", paired: true }, INTRO)).rejects.toThrow("This phone isn't paired any more.");
    expect(loadPairings()).toEqual([]);
  });
});

describe("dev:mock's relay over TV mode's bridge", () => {
  function fakeFrame() {
    const posted: unknown[] = [];
    const listeners = new Set<(m: unknown) => void>();
    const frame = {
      ready: async () => {},
      post: (m: unknown) => posted.push(m),
      listen: (l: (m: unknown) => void) => (listeners.add(l), () => listeners.delete(l)),
      close: vi.fn()
    };
    return { frame, posted, deliver: (m: unknown) => listeners.forEach((l) => l(m)) };
  }

  it("sends commands to the TV as relay-tv messages, naming this phone", async () => {
    const b = fakeFrame();
    const link = mockRelayLink("http://localhost:5175", () => b.frame);
    await link.send(DEN, { kind: "account" }, { type: "channel", dir: "down" }, "Kai's phone");
    expect(b.posted).toEqual([{ to: "relay-tv", tvId: DEN, phoneId: expect.stringMatching(/^[0-9a-f-]{36}$/), name: "Kai's phone", command: { type: "channel", dir: "down" } }]);
  });

  it("tells the TV the remote opened and closed, as the account's phone or a guest's", async () => {
    vi.useFakeTimers();
    const b = fakeFrame();
    const link = mockRelayLink("http://localhost:5175", () => b.frame);
    const close = await link.open(DEN, { kind: "paired", phoneToken: "t" }, { event: () => {}, drop: () => {} }, "a phone");
    expect(b.posted).toEqual([{ to: "relay-tv", tvId: DEN, phoneId: expect.any(String), name: "a phone", connected: true, kind: "guest" }]);
    close();
    expect(b.posted[1]).toMatchObject({ to: "relay-tv", tvId: DEN, name: "a phone", connected: false, kind: "guest" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(b.frame.close).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("takes this phone's state and endings from relay-phone messages, and nothing else", async () => {
    const b = fakeFrame();
    const link = mockRelayLink("http://localhost:5175", () => b.frame);
    const events: PhoneEvent[] = [];
    await link.open(DEN, { kind: "account" }, { event: (e) => events.push(e), drop: () => {} }, "Kai's phone");
    const me = (b.posted[0] as { phoneId: string }).phoneId;
    b.deliver({ to: "relay-phone", tvId: DEN, state: STATE });
    b.deliver({ to: "relay-phone", tvId: DEN, phoneId: me, state: { ...STATE, stationId: "s2" } });
    b.deliver({ to: "relay-phone", tvId: DEN, phoneId: "someone-else", state: STATE });
    b.deliver({ to: "relay-phone", tvId: "another", state: STATE });
    b.deliver({ to: "sender", senderId: null, namespace: "x", data: {} });
    b.deliver({ to: "relay-phone", tvId: DEN, ended: "signed_out", kind: "guest" });
    b.deliver({ to: "relay-phone", tvId: DEN, ended: "signed_out", kind: "account" });
    b.deliver({ to: "relay-phone", tvId: DEN, ended: { reason: "tv_ended" } });
    expect(events).toEqual([
      { event: "state", data: STATE },
      { event: "state", data: { ...STATE, stationId: "s2" } },
      { event: "ended", data: { reason: "signed_out" } },
      { event: "ended", data: { reason: "tv_ended" } }
    ]);
    expect(relayPhoneEvent({ to: "relay-phone", tvId: DEN, state: { stationId: 3 } }, { tvId: DEN })).toBeNull();
  });

  it("pairs through the TV's mock as this phone, with its answer or its refusal", async () => {
    const b = fakeFrame();
    const link = mockRelayLink("http://localhost:5175", () => b.frame);
    const asked = link.pair("4821", "a phone");
    await flush();
    const ask = b.posted[0] as { phoneId: string };
    expect(ask).toEqual({ to: "relay-tv", phoneId: expect.any(String), name: "a phone", pairCode: "4821" });
    b.deliver({ to: "relay-phone", tvId: DEN, phoneId: "someone-else", paired: { tvId: DEN, tvName: "Den TV", phoneToken: "x" } });
    b.deliver({ to: "relay-phone", tvId: DEN, phoneId: ask.phoneId, paired: { tvId: DEN, tvName: "Den TV", phoneToken: `mock-phone-token-${ask.phoneId}` } });
    expect(await asked).toEqual({ tvId: DEN, tvName: "Den TV", phoneToken: `mock-phone-token-${ask.phoneId}` });

    const wrong = link.pair("1111", "a phone");
    await flush();
    b.deliver({ to: "relay-phone", tvId: null, phoneId: ask.phoneId, error: { code: "code_not_found", message: "That code isn't right, or it's run out. Check the code on the TV." } });
    expect(await wrong).toEqual({ status: 404, code: "code_not_found", message: "That code isn't right, or it's run out. Check the code on the TV." });
    // The same phone drives the TV afterwards.
    await link.send(DEN, { kind: "paired", phoneToken: "t" }, { type: "info" }, "a phone");
    expect((b.posted[b.posted.length - 1] as { phoneId: string }).phoneId).toBe(ask.phoneId);
  });

  it("says nothing came back when TV mode doesn't answer", async () => {
    const b = fakeFrame();
    expect(await mockRelayLink("http://localhost:5175", () => b.frame).pair("4821", "a phone", 20)).toBeNull();
  });
});
