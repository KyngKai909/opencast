import { afterEach, describe, expect, it, vi } from "vitest";
import type { CastTarget } from "./types";

// Which build this is: the web, or an app with its plugins registered.
const native = vi.hoisted(() => ({ plugins: new Set<string>(), chrome: false }));
vi.mock("../native/platform", () => ({
  isNative: () => native.plugins.size > 0,
  nativePlatform: () => (native.plugins.size > 0 ? "ios" : null),
  hasPlugin: (name: string) => native.plugins.has(name)
}));
vi.mock("../../config", () => ({ config: { castAppId: "ABCD1234", tvUrl: "http://localhost:5175", apiBase: "", mirrorTv: "bundled" } }));
vi.mock("./googleSender", () => ({
  browserCanCast: () => native.chrome,
  createGoogleSender: () => ({ kind: "google" })
}));
vi.mock("./relay", () => ({ createRelaySender: () => ({ kind: "relay" }) }));
vi.mock("./relayApi", () => ({ apiRelayLink: () => ({}) }));

const { castOffered, resetSendersForTests, senderFor } = await import("./sender");

const chromecast: CastTarget = { id: "c", name: "Living room TV", kind: "chromecast" };
const tvApp: CastTarget = { id: "t", name: "Den TV", kind: "tv_app" };

describe("which sender reaches a TV", () => {
  afterEach(() => {
    native.plugins.clear();
    native.chrome = false;
    resetSendersForTests();
  });

  it("in the apps, casts through the Cast SDK plugin, even where the web view isn't Chrome (an iPhone)", async () => {
    native.plugins.add("OpencastCast");
    expect(castOffered()).toBe(true);
    expect((await senderFor(chromecast))?.kind).toBe("native");
  });

  it("in Chrome on the web, uses Google's Cast Web Sender", async () => {
    native.chrome = true;
    expect(castOffered()).toBe(true);
    expect((await senderFor(chromecast))?.kind).toBe("google");
  });

  it("elsewhere on the web, has no Cast sender", async () => {
    expect(castOffered()).toBe(false);
    expect(await senderFor(chromecast)).toBeNull();
  });

  it("reaches a TV with the Opencast app through the relay, app or web", async () => {
    native.plugins.add("OpencastCast");
    expect((await senderFor(tvApp))?.kind).toBe("relay");
    resetSendersForTests();
    native.plugins.clear();
    expect((await senderFor(tvApp))?.kind).toBe("relay");
  });
});
