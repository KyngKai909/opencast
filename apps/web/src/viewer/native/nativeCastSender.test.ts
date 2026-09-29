import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginListenerHandle } from "@capacitor/core";
import { parseCastCommand } from "@opencast/player";
import { CAST_NAMESPACE } from "../cast/messages";
import type { ReceiverState } from "../cast/types";
import { createNativeCastSender } from "./nativeCastSender";
import type { NativeCastDevice, OpencastCastPlugin } from "./plugins";

type Listener = (d: never) => void;

/** The OpencastCast plugin as the native side behaves: events fired by hand, calls recorded. */
function fakePlugin(o: { available?: boolean; devices?: NativeCastDevice[]; failStart?: boolean } = {}) {
  const listeners = new Map<string, Set<Listener>>();
  const sent: Array<{ namespace: string; message: string }> = [];
  const plugin = {
    setUp: vi.fn(async () => ({ available: o.available ?? true })),
    startDiscovery: vi.fn(async () => ({ devices: o.devices ?? [] })),
    stopDiscovery: vi.fn(async () => {}),
    startSession: vi.fn(async ({ deviceId }: { deviceId: string }) => {
      if (o.failStart) throw new Error("GCKError 2");
      return { device: { id: deviceId, name: "Living room TV" } };
    }),
    sendMessage: vi.fn(async (m: { namespace: string; message: string }) => void sent.push(m)),
    endSession: vi.fn(async () => {}),
    addListener: vi.fn(async (event: string, cb: Listener): Promise<PluginListenerHandle> => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return { remove: async () => void listeners.get(event)!.delete(cb) };
    })
  };
  const fire = (event: string, data: unknown) => listeners.get(event)?.forEach((l) => l(data as never));
  const receiver = (data: unknown) => fire("message", { namespace: CAST_NAMESPACE, message: JSON.stringify(data) });
  return { plugin: plugin as unknown as OpencastCastPlugin & typeof plugin, fire, receiver, sent, parsed: () => sent.map((m) => JSON.parse(m.message)) };
}

const intro = { from: "Kai's phone", marketSlug: "inland-empire", othersCanChange: true };
const living: NativeCastDevice = { id: "cast-1", name: "Living room TV" };

describe("the apps' Cast sender over the OpencastCast plugin", () => {
  afterEach(() => vi.useRealTimers());

  it("sets up the SDK with the receiver application and lists TVs by name", async () => {
    const f = fakePlugin({ devices: [living] });
    const sender = createNativeCastSender(f.plugin, "ABCD1234");
    expect(sender.kind).toBe("native");
    expect(await sender.targets()).toEqual([{ id: "cast-1", name: "Living room TV", kind: "chromecast" }]);
    expect(f.plugin.setUp).toHaveBeenCalledWith({ appId: "ABCD1234" });
    // Once, however often "Watch on" opens.
    await sender.targets();
    expect(f.plugin.setUp).toHaveBeenCalledTimes(1);
  });

  it("waits a little for the first TV when discovery has just started", async () => {
    vi.useFakeTimers();
    const f = fakePlugin();
    const sender = createNativeCastSender(f.plugin, "ABCD1234", { waitMs: 2000 });
    const found = sender.targets();
    await vi.advanceTimersByTimeAsync(500);
    f.fire("devicesChanged", { devices: [living] });
    expect((await found).map((t) => t.name)).toEqual(["Living room TV"]);

    const none = createNativeCastSender(fakePlugin().plugin, "ABCD1234", { waitMs: 2000 }).targets();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await none).toEqual([]);
  });

  it("offers nothing when the SDK isn't available", async () => {
    const f = fakePlugin({ available: false, devices: [living] });
    const sender = createNativeCastSender(f.plugin, "ABCD1234");
    expect(await sender.targets()).toEqual([]);
    await expect(sender.connect({ id: "cast-1", name: "Living room TV", kind: "chromecast" }, intro)).rejects.toThrow("isn't available");
  });

  it("introduces the phone, then sends commands as JSON text the receiver's parser accepts", async () => {
    const f = fakePlugin({ devices: [living] });
    const sender = createNativeCastSender(f.plugin, "ABCD1234");
    const t = await sender.connect({ id: "cast-1", name: "Living room TV", kind: "chromecast" }, intro);
    expect(t).toEqual({ id: "cast-1", name: "Living room TV", kind: "chromecast" });
    expect(sender.connected()).toEqual(t);
    expect(f.plugin.startSession).toHaveBeenCalledWith({ deviceId: "cast-1" });
    sender.send({ type: "channel", dir: "up" });
    sender.send({ type: "tune", channel: "24.1" });
    expect(f.sent.every((m) => m.namespace === CAST_NAMESPACE)).toBe(true);
    const [session, up, tune] = f.parsed();
    expect(session).toEqual({ type: "session", from: "Kai's phone", marketSlug: "inland-empire", othersCanChange: true });
    expect(up).toEqual({ type: "channel", dir: "up", from: "Kai's phone" });
    expect(parseCastCommand(up)).not.toBeNull();
    expect(parseCastCommand(tune)).toMatchObject({ type: "tune", channel: "24.1" });
  });

  it("says plainly when the session doesn't start", async () => {
    const f = fakePlugin({ failStart: true });
    const sender = createNativeCastSender(f.plugin, "ABCD1234");
    await expect(sender.connect({ id: "cast-1", name: "Living room TV", kind: "chromecast" }, intro)).rejects.toThrow("Couldn't start casting to Living room TV.");
    expect(sender.connected()).toBeNull();
  });

  it("passes the receiver's state on, introduces the phone again when the receiver restarts, and ignores other namespaces", async () => {
    const f = fakePlugin();
    const sender = createNativeCastSender(f.plugin, "ABCD1234");
    const states: ReceiverState[] = [];
    sender.onState((s) => states.push(s));
    await sender.connect({ id: "cast-1", name: "Living room TV", kind: "chromecast" }, intro);
    f.receiver({ type: "state", stationId: "beat", paused: false, changedBy: "Dana's phone", sleepEndsAt: null });
    f.fire("message", { namespace: "urn:x-cast:com.google.cast.media", message: JSON.stringify({ type: "state", stationId: "x" }) });
    f.fire("message", { namespace: CAST_NAMESPACE, message: "not json" });
    expect(states).toEqual([{ stationId: "beat", paused: false, changedBy: "Dana's phone", sleepEndsAt: null }]);
    f.receiver({ type: "receiver-ready" });
    await Promise.resolve();
    expect(f.parsed().filter((m) => m.type === "session")).toHaveLength(2);
  });

  it("ends when the receiver ends the session or the SDK says it ended, and stops the TV when the phone stops", async () => {
    const f = fakePlugin();
    const sender = createNativeCastSender(f.plugin, "ABCD1234");
    const ended = vi.fn();
    sender.onEnded(ended);
    const tv = { id: "cast-1", name: "Living room TV", kind: "chromecast" as const };

    await sender.connect(tv, intro);
    f.receiver({ type: "session-ended" });
    expect(ended).toHaveBeenCalledTimes(1);
    expect(sender.connected()).toBeNull();

    await sender.connect(tv, intro);
    f.fire("sessionEnded", {});
    expect(ended).toHaveBeenCalledTimes(2);
    // A second report of the same end says nothing more.
    f.fire("sessionEnded", {});
    expect(ended).toHaveBeenCalledTimes(2);

    await sender.connect(tv, intro);
    sender.disconnect();
    expect(f.plugin.endSession).toHaveBeenCalledWith({ stopCasting: true });
    expect(sender.connected()).toBeNull();
    const before = f.sent.length;
    sender.send({ type: "pause" });
    expect(f.sent).toHaveLength(before);
  });
});
