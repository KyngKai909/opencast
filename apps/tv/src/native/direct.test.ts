// A239: direct mode in the Android TV app. The Capacitor bridge is a stand-in: the plugin's info()
// and the web view's fetch to the app's own path are both fakes (no native side, no network).
import { describe, expect, it, vi } from "vitest";
import { nativeDirect } from "./direct";

const SOURCE = "http://n3.toonami.example:1934/live/chunklist.m3u8";

function env(o: { native?: boolean; available?: boolean; info?: () => Promise<{ version: number; path: string; userAgent: string }> } = {}) {
  const asked: string[] = [];
  const fetchFn = vi.fn(async (url: string) => {
    asked.push(url);
    return new Response("#EXTM3U\n", { headers: { "x-opencast-url": SOURCE } });
  });
  const info = vi.fn(o.info ?? (async () => ({ version: 1, path: "/_opencast/direct/abc123", userAgent: "Opencast TV (Android)" })));
  return { asked, info, e: { native: o.native ?? true, available: () => o.available ?? true, plugin: { info }, fetch: fetchFn as unknown as typeof fetch } };
}

describe("direct mode in the TV app", () => {
  it("is on in the Android app with the OpencastDirect plugin, fetching through the path it gives", async () => {
    const { asked, info, e } = env();
    const t = nativeDirect(e);
    expect(t).not.toBeNull();
    const got = await t!.load(SOURCE, {});
    await t!.load(SOURCE, {});
    expect(asked[0]).toBe(`/_opencast/direct/abc123?u=${encodeURIComponent(SOURCE)}`);
    expect(got.url).toBe(SOURCE);
    // The path is asked for once.
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("is off in a TV browser, on Cast and the iPhone's display (not the Android app), and in an app without the plugin", () => {
    expect(nativeDirect(env({ native: false }).e)).toBeNull();
    expect(nativeDirect(env({ available: false }).e)).toBeNull();
    expect(nativeDirect({ native: false, available: () => true, plugin: { info: async () => ({ version: 1, path: "/x", userAgent: "" }) } })).toBeNull();
  });

  it("fails each direct load (so the player falls back) when the plugin can't say, or speaks another version", async () => {
    for (const info of [async () => Promise.reject(new Error("not implemented")), async () => ({ version: 2, path: "/_opencast/direct/x", userAgent: "" })]) {
      const { asked, e } = env({ info });
      await expect(nativeDirect(e)!.load(SOURCE, {})).rejects.toThrow("Direct mode isn't available");
      expect(asked).toEqual([]);
    }
  });
});
