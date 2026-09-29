import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginListenerHandle } from "@capacitor/core";
import { batteryLine, getMirroring, mirroringOffered, nativeMirroring, resetMirroringForTests, type NativeMirrorPlugin } from "./mirroring";
import { mirrorDeviceName } from "./messages";
import { applyMirrorStatus, getCastSession, resetCastSessionForTests } from "./session";
import { mirrorConfig } from "./useCast";

const native = vi.hoisted(() => ({ plugins: new Set<string>() }));
vi.mock("../native/platform", () => ({
  isNative: () => native.plugins.size > 0,
  nativePlatform: () => (native.plugins.size > 0 ? "ios" : null),
  hasPlugin: (name: string) => native.plugins.has(name)
}));

/** The OpencastMirror plugin: events fired by hand, calls recorded. */
function fakePlugin(known: string[] = []) {
  const listeners = new Map<string, Set<(d: Record<string, unknown>) => void>>();
  const plugin = {
    configure: vi.fn(async () => {}),
    knownTvs: vi.fn(async () => ({ names: known })),
    send: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    addListener: vi.fn(async (event: string, cb: (d: Record<string, unknown>) => void): Promise<PluginListenerHandle> => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return { remove: async () => void listeners.get(event)!.delete(cb) };
    })
  };
  const fire = (event: string, data: Record<string, unknown>) => listeners.get(event)?.forEach((l) => l(data));
  return { plugin: plugin as NativeMirrorPlugin & typeof plugin, fire };
}

describe("the mirroring seam over the iPhone app's plugin", () => {
  let t = Date.parse("2026-09-27T03:50:00Z");
  const now = () => t;
  beforeEach(() => {
    t = Date.parse("2026-09-27T03:50:00Z");
    resetCastSessionForTests();
  });

  it("knows the TVs mirrored to before, and adds a new one when it connects", async () => {
    const f = fakePlugin(["Bedroom TV"]);
    const m = nativeMirroring(f.plugin, { keepAwake: () => {}, now });
    await new Promise((r) => setTimeout(r, 0));
    expect(m.knownTvs()).toEqual(["Bedroom TV"]);
    f.fire("displayConnected", { tvName: "Den TV" });
    expect(m.knownTvs()).toEqual(["Bedroom TV", "Den TV"]);
    expect(m.status()).toEqual({ connected: true, tvName: "Den TV", lockedAt: null });
  });

  it("names the TV from the guide when the route has no name (the Simulator's external display)", () => {
    const f = fakePlugin();
    const m = nativeMirroring(f.plugin, { keepAwake: () => {}, now });
    m.expect("Bedroom TV");
    f.fire("displayConnected", {});
    expect(m.status().tvName).toBe("Bedroom TV");
  });

  it("turns the plugin's events into the session: connected is the remote, a lock is 'Mirroring stopped' with its time, turning mirroring off is neither", () => {
    const f = fakePlugin();
    const m = nativeMirroring(f.plugin, { keepAwake: () => {}, now });
    m.subscribe(() => applyMirrorStatus(m.status()));

    f.fire("displayConnected", { tvName: "Bedroom TV" });
    expect(getCastSession()).toMatchObject({ status: "mirroring", target: { name: "Bedroom TV", kind: "airplay" } });

    const lockedAt = Date.parse("2026-09-27T04:08:00Z");
    f.fire("displayDisconnected", { reason: "locked", at: lockedAt });
    expect(getCastSession()).toMatchObject({ status: "mirror_stopped", lockedAt });

    // Screen Mirroring back on: the remote again.
    f.fire("displayConnected", { tvName: "Bedroom TV" });
    expect(getCastSession().status).toBe("mirroring");

    f.fire("displayDisconnected", { reason: "ended", at: lockedAt });
    expect(m.status().lockedAt).toBeNull();
    expect(getCastSession().status).toBe("idle");
  });

  it("keeps TV mode's state from the external display while connected", () => {
    const f = fakePlugin();
    const m = nativeMirroring(f.plugin, { keepAwake: () => {}, now });
    f.fire("state", { type: "state", stationId: "ignored" });
    expect(m.status().receiver).toBeUndefined();
    f.fire("displayConnected", { tvName: "Bedroom TV" });
    f.fire("state", { type: "state", stationId: "beat", paused: true, changedBy: null, sleepEndsAt: null });
    expect(m.status().receiver).toEqual({ stationId: "beat", paused: true, changedBy: null, sleepEndsAt: null });
  });

  it("collects battery readings from the connection on, for the battery line", () => {
    const f = fakePlugin();
    const m = nativeMirroring(f.plugin, { keepAwake: () => {}, now });
    f.fire("battery", { level: 0.9, charging: false });
    f.fire("displayConnected", { tvName: "Bedroom TV" });
    expect(m.battery()).toEqual([]);
    f.fire("battery", { level: 0.7, charging: false });
    t += 10 * 60e3;
    f.fire("battery", { level: 0.65, charging: false });
    // The Simulator's -1 ("unknown") is dropped.
    f.fire("battery", { level: -1, charging: false });
    expect(m.battery().map((r) => r.level)).toEqual([0.7, 0.65]);
    expect(batteryLine(m.battery())).toBe("Battery: 65%, about 2 hours at this rate.");
    f.fire("battery", { level: 0.65, charging: true });
    expect(batteryLine(m.battery())).toBe("Battery: 65%, charging.");
  });

  it("passes commands, the phone's details, keep-awake (once per change) and stop to the plugin", () => {
    const f = fakePlugin();
    const awake = vi.fn();
    const m = nativeMirroring(f.plugin, { keepAwake: awake, now });
    m.send({ type: "channel", dir: "up" });
    expect(f.plugin.send).toHaveBeenCalledWith({ command: { type: "channel", dir: "up" } });
    const o = { device: "Kai's iPhone", marketSlug: "inland-empire", stationId: "beat", tvUrl: null };
    m.configure!(o);
    expect(f.plugin.configure).toHaveBeenCalledWith(o);
    m.keepAwake(true);
    m.keepAwake(true);
    m.keepAwake(false);
    m.keepAwake(false);
    expect(awake.mock.calls).toEqual([[true], [false]]);
    f.fire("displayConnected", { tvName: "Bedroom TV" });
    m.stop();
    expect(f.plugin.stop).toHaveBeenCalled();
    expect(m.status()).toMatchObject({ connected: false, lockedAt: null });
  });
});

describe("which mirroring this build has", () => {
  afterEach(() => {
    native.plugins.clear();
    resetMirroringForTests();
  });

  it("is none on the web", async () => {
    expect(mirroringOffered()).toBe(false);
    expect(await getMirroring()).toBeNull();
  });

  it("is the plugin in the iPhone app", async () => {
    native.plugins.add("OpencastMirror");
    expect(mirroringOffered()).toBe(true);
    expect((await getMirroring())?.kind).toBe("native");
  });
});

describe("what TV mode on the external display opens with", () => {
  it("names the iPhone from the account, never the device", () => {
    expect(mirrorDeviceName("Kai M.")).toBe("Kai's iPhone");
    expect(mirrorDeviceName(null)).toBeNull();
    expect(mirrorConfig({ signedIn: true, displayName: "Kai M.", marketSlug: "inland-empire", stationId: "beat" })).toEqual({
      device: "Kai's iPhone",
      marketSlug: "inland-empire",
      stationId: "beat",
      tvUrl: null
    });
    // Signed out, TV mode says "Mirrored from an iPhone".
    expect(mirrorConfig({ signedIn: false, displayName: "Kai M.", marketSlug: null, stationId: null }).device).toBeNull();
  });
});
