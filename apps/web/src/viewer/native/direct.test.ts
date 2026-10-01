// A239: direct mode in the Opencast app on Android. The Capacitor bridge is a stand-in: the plugin's
// info() and the web view's fetch to the app's own path are both fakes (no native side, no network).
import { describe, expect, it, vi } from "vitest";
import { nativeDirect } from "./direct";

const SOURCE = "https://api.toonami.example/est/playlist.m3u8";

function env(o: { android?: boolean; available?: boolean; info?: () => Promise<{ version: number; path: string; userAgent: string }> } = {}) {
  const asked: string[] = [];
  const fetchFn = vi.fn(async (url: string) => {
    asked.push(url);
    return new Response("#EXTM3U\n");
  });
  const info = vi.fn(o.info ?? (async () => ({ version: 1, path: "/_opencast/direct/t0k", userAgent: "Opencast (Android)" })));
  return { asked, info, e: { android: o.android ?? true, available: o.available ?? true, plugin: { info }, fetch: fetchFn as unknown as typeof fetch } };
}

describe("direct mode in the Opencast app", () => {
  it("is on in the Android app with the OpencastDirect plugin, fetching through the path it gives", async () => {
    const { asked, info, e } = env();
    const t = nativeDirect(e)!;
    const got = await t.load(SOURCE, { range: "bytes=0-1" });
    expect(asked).toEqual([`/_opencast/direct/t0k?u=${encodeURIComponent(SOURCE)}`]);
    // No redirect header: the address asked for.
    expect(got.url).toBe(SOURCE);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("is off on the web, on the iPhone, and in an app without the plugin", () => {
    expect(nativeDirect(env({ android: false }).e)).toBeNull();
    expect(nativeDirect(env({ available: false }).e)).toBeNull();
    // The web build itself (no Capacitor native platform).
    expect(nativeDirect()).toBeNull();
  });

  it("fails each direct load (so the player falls back) when the plugin can't say", async () => {
    const { asked, e } = env({ info: async () => Promise.reject(new Error("not implemented")) });
    await expect(nativeDirect(e)!.load(SOURCE, {})).rejects.toThrow("Direct mode isn't available");
    expect(asked).toEqual([]);
  });
});
