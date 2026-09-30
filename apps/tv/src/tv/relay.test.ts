import { describe, expect, it, vi } from "vitest";
import type { RemotePhone } from "@opencast/contracts";
import type { Command, CommandSource, PlayerEngine } from "@opencast/player";
import { clearLayers, dispatch as route, type Ui } from "./commands";
import { CHIP_MS, relayInput, type RelayOptions } from "./relay";

const KAI = { phoneId: "00000000-0000-4000-8000-00000000a001", name: "Kai's phone" };
const SAM = { phoneId: "00000000-0000-4000-8000-00000000a002", name: "Sam's phone" };
const AT = "2026-09-27T03:42:00.000Z";

/** A stream the test writes events into, as the API would. */
function stream() {
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
  return {
    res: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    event(name: string, data: unknown) {
      ctl.enqueue(enc.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
    },
    raw(text: string) {
      ctl.enqueue(enc.encode(text));
    },
    close: () => ctl.close()
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const command = (from: typeof KAI, c: object) => ({ command: c, from, at: AT });

function setup(o: Partial<RelayOptions> = {}) {
  const s = stream();
  const got: Array<{ c: Command; s: CommandSource }> = [];
  const relay = relayInput({ open: async () => s.res, othersCanChange: () => true, wait: () => new Promise(() => undefined), ...o });
  const stop = relay.start((c, src) => got.push({ c, s: src }));
  return { s, got, relay, stop };
}

describe("the relay as an input", () => {
  it("feeds phones' commands into the command stream, saying who sent them", async () => {
    const { s, got, stop } = setup();
    await flush();
    s.event("command", command(KAI, { type: "channel", dir: "up" }));
    s.event("command", command(KAI, { type: "tune", channel: "12.1" }));
    s.event("command", command(KAI, { type: "sleep", until: 30 }));
    await flush();
    expect(got).toEqual([
      { c: { type: "channel", dir: "up" }, s: { input: "relay", who: "Kai's phone" } },
      { c: { type: "tune", channel: "12.1" }, s: { input: "relay", who: "Kai's phone" } },
      { c: { type: "sleep", until: 30 }, s: { input: "relay", who: "Kai's phone" } }
    ]);
    stop();
  });

  it("takes a phone's Back to live", async () => {
    const { s, got, stop } = setup();
    await flush();
    s.event("command", command(KAI, { type: "backToLive" }));
    await flush();
    expect(got).toEqual([{ c: { type: "backToLive" }, s: { input: "relay", who: "Kai's phone" } }]);
    stop();
  });

  it("ignores what isn't a command, and the API's ping", async () => {
    const { s, got, stop } = setup();
    await flush();
    s.raw(": ping\n\n");
    s.event("command", command(KAI, { type: "explode" }));
    s.event("command", { command: { type: "info" } });
    s.raw("event: command\ndata: not json\n\n");
    await flush();
    expect(got).toEqual([]);
    stop();
  });

  it("reaches the player through the one dispatcher, with who changed it", async () => {
    clearLayers();
    const handle = vi.fn();
    const engine = { handle } as unknown as PlayerEngine;
    const ui: Ui = { path: () => "/", go: vi.fn(), close: vi.fn() };
    const s = stream();
    const relay = relayInput({ open: async () => s.res, othersCanChange: () => true, wait: () => new Promise(() => undefined) });
    const stop = relay.start((c, src) => route(c, src, ui, engine));
    await flush();
    s.event("command", command(KAI, { type: "preset", key: 2 }));
    await flush();
    expect(handle).toHaveBeenCalledWith({ type: "preset", key: 2 }, { input: "relay", who: "Kai's phone" });
    stop();
  });

  it("a phone's Guide opens the TV's guide, and its arrows, OK and Back then drive it there", async () => {
    clearLayers();
    vi.resetModules();
    vi.doMock("./focus", () => ({ moveFocus: vi.fn(), pressFocused: vi.fn() }));
    const focus = await import("./focus");
    const { dispatch: routeNow } = await import("./commands");
    const { PlayerEngine } = await import("@opencast/player");
    let path = "/";
    const ui: Ui = { path: () => path, go: vi.fn((to: string) => void (path = to)), close: vi.fn(() => void (path = "/")) };
    // The player passes the guide on to TV mode (TvApp's onCommand).
    const engine = new PlayerEngine({ onCommand: (c) => c.type === "guide" && ui.go("/guide") });
    const s = stream();
    const relay = relayInput({ open: async () => s.res, othersCanChange: () => true, wait: () => new Promise(() => undefined) });
    const stop = relay.start((c, src) => routeNow(c, src, ui, engine));
    await flush();
    s.event("command", command(KAI, { type: "guide" }));
    await flush();
    expect(ui.go).toHaveBeenCalledWith("/guide");
    s.event("command", command(KAI, { type: "focus", dir: "down" }));
    s.event("command", command(KAI, { type: "select" }));
    s.event("command", command(KAI, { type: "back" }));
    await flush();
    expect(focus.moveFocus).toHaveBeenCalledWith("down");
    expect(focus.pressFocused).toHaveBeenCalledOnce();
    expect(ui.close).toHaveBeenCalledOnce();
    stop();
    engine.destroy();
    vi.doUnmock("./focus");
  });

  it("lets only the phone that started change the channel when that's the setting", async () => {
    let others = false;
    const { s, got, relay, stop } = setup({ othersCanChange: () => others });
    await flush();
    s.event("command", command(KAI, { type: "channel", dir: "up" }));
    s.event("command", command(SAM, { type: "channel", dir: "down" }));
    s.event("command", command(KAI, { type: "info" }));
    await flush();
    expect(got.map((g) => g.s.who)).toEqual(["Kai's phone", "Kai's phone"]);
    // Any phone: Sam's commands count too.
    others = true;
    s.event("command", command(SAM, { type: "channel", dir: "down" }));
    await flush();
    expect(got.at(-1)).toEqual({ c: { type: "channel", dir: "down" }, s: { input: "relay", who: "Sam's phone" } });
    // A new session (the sleep timer ended it): the next phone to send a command starts it.
    others = false;
    relay.reset();
    s.event("command", command(SAM, { type: "info" }));
    s.event("command", command(KAI, { type: "info" }));
    await flush();
    expect(got.slice(-1).map((g) => g.s.who)).toEqual(["Sam's phone"]);
    stop();
  });

  it("forgets the phone that started once it's removed", async () => {
    const phones: RemotePhone[][] = [];
    const { s, got, stop } = setup({ othersCanChange: () => false, onPhones: (p) => phones.push(p) });
    await flush();
    s.event("command", command(KAI, { type: "info" }));
    const sam: RemotePhone = { id: SAM.phoneId, name: "Sam's phone", kind: "guest", connected: true, pairedAt: AT, lastCommandAt: null };
    s.event("phones", { phones: [sam] });
    s.event("command", command(SAM, { type: "info" }));
    await flush();
    expect(phones).toEqual([[sam]]);
    expect(got.map((g) => g.s.who)).toEqual(["Kai's phone", "Sam's phone"]);
    stop();
  });

  it("says when the account signed this TV out", async () => {
    const onSignedOut = vi.fn();
    const { s, stop } = setup({ onSignedOut });
    await flush();
    s.event("signed_out", {});
    await flush();
    expect(onSignedOut).toHaveBeenCalledOnce();
    stop();
  });

  it("names the phone in the hint row only while it's been driving in the last few minutes", async () => {
    let t = 1_000_000;
    const { s, relay, stop } = setup({ now: () => t });
    expect(relay.hints!()).toEqual([]);
    await flush();
    s.event("command", command(KAI, { type: "info" }));
    await flush();
    expect(relay.hints!()).toEqual([{ kind: "chip", label: "Playing from Kai's phone" }]);
    t += CHIP_MS - 1;
    expect(relay.hints!()).toHaveLength(1);
    t += 1;
    expect(relay.hints!()).toEqual([]);
    stop();
  });
});

describe("staying connected", () => {
  it("reconnects when the stream ends, after the server's retry, and waits longer after each failure", async () => {
    const waits: number[] = [];
    const first = stream();
    const opens = [async () => first.res, async () => Promise.reject(new TypeError("offline")), async () => new Response("no", { status: 502 }), async () => stream().res];
    let n = 0;
    const open = vi.fn(async () => opens[n++]!());
    const connection: boolean[] = [];
    const relay = relayInput({
      open,
      othersCanChange: () => true,
      backoff: (f) => f * 1000,
      wait: async (ms) => void waits.push(ms),
      onConnection: (o) => connection.push(o)
    });
    const stop = relay.start(() => undefined);
    await flush();
    first.raw("retry: 3000\n\n");
    first.close();
    for (let i = 0; i < 5; i++) await flush();
    expect(open).toHaveBeenCalledTimes(4);
    // Open, then dropped: back after the server's 3 s; then 2 s and 3 s after two failures in a row.
    expect(waits).toEqual([3000, 2000, 3000]);
    expect(connection).toEqual([true, false, true]);
    stop();
  });

  it("closes the stream and stops reconnecting when it's stopped", async () => {
    let signal!: AbortSignal;
    const open = vi.fn(async (sig: AbortSignal) => {
      signal = sig;
      return stream().res;
    });
    const relay = relayInput({ open, othersCanChange: () => true, wait: async () => undefined });
    const stop = relay.start(() => undefined);
    await flush();
    stop();
    await flush();
    expect(signal.aborted).toBe(true);
    expect(open).toHaveBeenCalledOnce();
  });
});
