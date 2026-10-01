// A239: direct mode in the native apps. An external stream link with `playback.sourceUrl` is fetched
// with the device's own networking (the app's DirectTransport) first, and falls back to
// `playback.url` (the relay's, or the same address) on an error or no first frame in
// DIRECT_FIRST_FRAME_MS, with Stand by still at 8 s. Only rows with `sourceUrl` in an app with a
// transport go direct: Opencast's own stations, browsers (no transport) and the API's calls are
// untouched. The Capacitor bridge is a stand-in throughout (no native side, no network).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HlsConfig, LoaderCallbacks, LoaderConfiguration, LoaderContext } from "hls.js";
import { PlayerEngine } from "./PlayerEngine";
import { directLoader, directUrlOf, interceptTransport, type DirectTransport } from "./direct";
import { fakeDriver, fakeFetch, flush, station, stubMedia } from "../test-helpers";
import { DIRECT_FIRST_FRAME_MS, RETRY_FIRST_MS, STANDBY_MS } from "../tuning/constants";
import type { Channel } from "../types";

const RELAYED = "https://stream-relay.opencast.test/v2/sig/aHR0cHM6Ly9hcGkudG9vbmFtaS5leGFtcGxlL2VzdC9wbGF5bGlzdC5tM3U4";
const SOURCE = "https://api.toonami.example/est/playlist.m3u8";

function external(callSign: string, channel: string, playback: Channel["playback"]): Channel {
  const base = station(callSign, channel);
  return { ...base, station: { ...base.station, kind: "listed", name: `${callSign} channel` }, now: null, next: null, playback, external: { source: `${callSign} source`, plays: "stream_link", schedule: "none" } };
}

const CIVC = station("CIVC", "7.1");
const TOON = external("TOON", "9.1", { kind: "hls", url: RELAYED, sourceUrl: SOURCE });
const BEAT = station("BEAT", "12.1");

/** The Capacitor bridge's side, as a stand-in: what the app's transport was asked for. */
function fakeTransport(): DirectTransport & { asked: string[] } {
  const asked: string[] = [];
  return {
    name: "fake",
    asked,
    async load(url) {
      asked.push(url);
      return { response: new Response("#EXTM3U\n"), url };
    }
  };
}

let host: HTMLDivElement;
let engine: PlayerEngine | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  stubMedia();
  host = document.createElement("div");
});
afterEach(() => {
  engine?.destroy();
  engine = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function make(o: { direct?: DirectTransport | null; directDriver?: ReturnType<typeof fakeDriver>; driver?: ReturnType<typeof fakeDriver>; warm?: "buffer" | "prefetch"; fetch?: (url: string, init?: RequestInit) => Promise<Response> } = {}) {
  const driver = o.driver ?? fakeDriver();
  const directDriver = o.directDriver ?? fakeDriver();
  engine = new PlayerEngine({ driver, directDriver, direct: o.direct === undefined ? fakeTransport() : o.direct, warm: o.warm ?? "buffer", fetch: o.fetch, bannerMs: 5000, numberWaitMs: 2000 });
  engine.attach(host);
  engine.setChannels([CIVC, TOON, BEAT]);
  return { engine, driver, directDriver };
}

/** A driver whose pictures never get a frame (a load that stalls): play() never settles. */
function stallingDriver() {
  const d = fakeDriver();
  const attach = d.attach.bind(d);
  d.attach = (video, url, onFatal, options) => {
    video.play = () => new Promise<void>(() => {});
    return attach(video, url, onFatal, options);
  };
  return d;
}

describe("which rows go direct", () => {
  it("only an external stream link's own address, and never DASH", () => {
    expect(directUrlOf(TOON)).toBe(SOURCE);
    expect(directUrlOf(CIVC)).toBeNull();
    expect(directUrlOf(external("OLD", "9.2", { kind: "hls", url: SOURCE }))).toBeNull();
    expect(directUrlOf(external("LOMA", "9.3", { kind: "hls", url: RELAYED, format: "dash", sourceUrl: "http://loma.example/live.mpd" }))).toBeNull();
    expect(directUrlOf(external("RDLS", "9.4", { kind: "embed", url: "https://city.example/player" }))).toBeNull();
    expect(directUrlOf(external("ODD", "9.5", { kind: "hls", url: RELAYED, sourceUrl: "rtmp://odd.example/live" }))).toBeNull();
  });
});

describe("direct mode in the player", () => {
  it("in a native app, plays an external row's sourceUrl through the native transport's driver", async () => {
    const { engine, driver, directDriver } = make();
    const t = engine.tune(TOON.station.id);
    await flush(10);
    await t;
    expect(engine.getState()).toMatchObject({ currentId: TOON.station.id, status: "playing" });
    expect(directDriver.handles.map((h) => h.url)).toEqual([SOURCE]);
    // The relay's address was never loaded.
    expect(driver.handles.map((h) => h.url)).not.toContain(RELAYED);
  });

  it("leaves Opencast's own stations (and everything else) on the web view's own loading", async () => {
    const { engine, driver, directDriver } = make();
    const t = engine.tune(CIVC.station.id);
    await flush(10);
    await t;
    expect(engine.getState().status).toBe("playing");
    expect(driver.handles.map((h) => h.url)).toContain(CIVC.playback!.url);
    // Warm neighbours too: TOON is warm through direct mode, BEAT through the web view.
    expect(directDriver.handles.map((h) => h.url)).toEqual([SOURCE]);
    expect(driver.handles.map((h) => h.url)).toContain(BEAT.playback!.url);
  });

  it("in a browser (no transport), plays playback.url as before, sourceUrl or not", async () => {
    const { engine, driver, directDriver } = make({ direct: null });
    const t = engine.tune(TOON.station.id);
    await flush(10);
    await t;
    expect(engine.getState().status).toBe("playing");
    expect(directDriver.handles).toHaveLength(0);
    expect(driver.handles.map((h) => h.url)).toContain(RELAYED);
  });

  it("falls back to playback.url at once when the direct load fails, well before Stand by", async () => {
    const { engine, driver, directDriver } = make({ directDriver: fakeDriver({ fails: () => "manifestLoadError" }) });
    const t = engine.tune(TOON.station.id);
    // No retry wait between the two: the listed address loads straight after the failure.
    await flush(50);
    await t;
    expect(RETRY_FIRST_MS).toBeGreaterThan(50);
    expect(engine.getState()).toMatchObject({ currentId: TOON.station.id, status: "playing" });
    expect(directDriver.handles.map((h) => h.url)).toEqual([SOURCE]);
    expect(driver.handles.map((h) => h.url)).toContain(RELAYED);
    expect(directDriver.handles[0]!.destroyed).toBe(true);
  });

  it("falls back when the direct picture has no first frame in DIRECT_FIRST_FRAME_MS, and Stand by stays at 8 s", async () => {
    const { engine, driver } = make({ directDriver: stallingDriver() });
    // A channel change (from CIVC), so the tuning's Stand by timer runs.
    const first = engine.tune(CIVC.station.id);
    await flush(10);
    await first;
    const t = engine.tune(TOON.station.id);
    await flush(DIRECT_FIRST_FRAME_MS - 100);
    expect(engine.getState().pendingId).toBe(TOON.station.id);
    expect(driver.handles.map((h) => h.url)).not.toContain(RELAYED);
    await flush(200);
    await t;
    expect(DIRECT_FIRST_FRAME_MS).toBeLessThan(STANDBY_MS);
    expect(engine.getState()).toMatchObject({ currentId: TOON.station.id, status: "playing" });
    expect(driver.handles.map((h) => h.url)).toContain(RELAYED);
  });

  it("with both failing, is on Stand by at 8 s, and the next round tries the source's own address first again", async () => {
    const { engine, directDriver } = make({ driver: fakeDriver({ fails: (u) => (u === RELAYED ? "manifestLoadError" : null) }), directDriver: fakeDriver({ fails: () => "manifestLoadError" }) });
    const first = engine.tune(CIVC.station.id);
    await flush(10);
    await first;
    void engine.tune(TOON.station.id);
    await flush(50);
    expect(directDriver.handles).toHaveLength(1);
    expect(engine.getState().status).not.toBe("standby");
    await flush(STANDBY_MS);
    expect(engine.getState()).toMatchObject({ currentId: TOON.station.id, status: "standby" });
    // After the wait between rounds (RETRY_FIRST_MS, doubling), direct again first.
    expect(directDriver.handles.length).toBeGreaterThanOrEqual(2);
    expect(directDriver.handles.every((h) => h.url === SOURCE)).toBe(true);
  });

  it("tries direct again on the next tune after a fallback (as the TV app warms: prefetch, no hidden decks)", async () => {
    const fails = { now: true };
    const served = fakeFetch(() => null);
    const { engine, directDriver } = make({ warm: "prefetch", fetch: served.fetch, directDriver: fakeDriver({ fails: () => (fails.now ? "manifestLoadError" : null) }) });
    let t = engine.tune(TOON.station.id);
    await flush(50);
    await t;
    expect(directDriver.handles).toHaveLength(1);
    fails.now = false;
    t = engine.tune(BEAT.station.id);
    await flush(2000);
    await t;
    t = engine.tune(TOON.station.id);
    await flush(2000);
    await t;
    expect(engine.getState()).toMatchObject({ currentId: TOON.station.id, status: "playing" });
    expect(directDriver.handles.at(-1)!.url).toBe(SOURCE);
    expect(directDriver.handles.at(-1)!.destroyed).toBe(false);
  });

  it("doesn't prefetch a neighbour that goes direct (the web view's cache can't help a native fetch)", async () => {
    const served = fakeFetch(() => "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nseg_1.ts\n");
    const { engine } = make({ warm: "prefetch", fetch: served.fetch });
    const t = engine.tune(CIVC.station.id);
    await flush(10);
    await t;
    await flush(10);
    expect(served.urls.some((u) => u.startsWith(BEAT.playback!.url.replace("master.m3u8", "")))).toBe(true);
    expect(served.urls.some((u) => u === RELAYED || u === SOURCE)).toBe(false);
  });

  it("never patches the page's fetch or XHR (the API's calls are untouched)", async () => {
    const before = { fetch: globalThis.fetch, xhr: globalThis.XMLHttpRequest };
    const transport = fakeTransport();
    const { engine } = make({ direct: transport });
    const t = engine.tune(TOON.station.id);
    await flush(10);
    await t;
    expect(globalThis.fetch).toBe(before.fetch);
    expect(globalThis.XMLHttpRequest).toBe(before.xhr);
  });
});

// ---------- The transport and the hls.js loader ----------

const POLICY: LoaderConfiguration = {
  loadPolicy: { maxTimeToFirstByteMs: 5000, maxLoadTimeMs: 20000, timeoutRetry: null, errorRetry: null },
  maxRetry: 0,
  timeout: 0,
  retryDelay: 0,
  maxRetryDelay: 0
};

function callbacks() {
  const got: { success?: { url: string; data: unknown; code?: number }; error?: { code: number; text: string }; timeout?: boolean; abort?: boolean; progress?: number } = {};
  const cb: LoaderCallbacks<LoaderContext> = {
    onSuccess: (r) => (got.success = { url: r.url, data: r.data, code: r.code }),
    onError: (e) => (got.error = e),
    onTimeout: () => (got.timeout = true),
    onAbort: () => (got.abort = true),
    onProgress: () => (got.progress = (got.progress ?? 0) + 1)
  };
  return { cb, got };
}

describe("the intercept transport (the Android apps)", () => {
  it("asks the app's own path for the address, with no cookies or referrer, and reads where it ended up", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return new Response("#EXTM3U\n", { headers: { "x-opencast-url": "http://n3.toonami.example:1934/live/chunklist.m3u8" } });
    }) as typeof fetch;
    const t = interceptTransport(() => "/_opencast/direct/tok3n", fetchFn);
    const got = await t.load(SOURCE, { range: "bytes=0-99" });
    expect(seen[0]!.url).toBe(`/_opencast/direct/tok3n?u=${encodeURIComponent(SOURCE)}`);
    expect(seen[0]!.init).toMatchObject({ method: "GET", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", headers: { range: "bytes=0-99" } });
    expect(got.url).toBe("http://n3.toonami.example:1934/live/chunklist.m3u8");
  });

  it("refuses when the app has no direct path after all", async () => {
    const t = interceptTransport(async () => null, vi.fn() as unknown as typeof fetch);
    await expect(t.load(SOURCE, {})).rejects.toThrow("Direct mode isn't available");
  });
});

describe("directLoader (hls.js's loader in direct mode)", () => {
  const ctx = (url: string, responseType = "text", range?: [number, number]): LoaderContext => ({ url, responseType, ...(range ? { rangeStart: range[0], rangeEnd: range[1] } : {}) });

  it("loads a playlist as text, giving hls.js the address after redirects so relative addresses resolve there", async () => {
    const asked: Array<{ url: string; range?: string }> = [];
    const transport: DirectTransport = {
      name: "t",
      load: async (url, init) => {
        asked.push({ url, range: init.range });
        return { response: new Response("#EXTM3U\nchunk.m3u8\n"), url: "http://n3.toonami.example:1934/live/master.m3u8" };
      }
    };
    const Loader = directLoader(transport);
    const loader = new Loader({} as HlsConfig);
    const { cb, got } = callbacks();
    loader.load(ctx(SOURCE), POLICY, cb);
    await vi.waitFor(() => expect(got.success).toBeDefined());
    expect(asked).toEqual([{ url: SOURCE, range: undefined }]);
    expect(got.success).toEqual({ url: "http://n3.toonami.example:1934/live/master.m3u8", data: "#EXTM3U\nchunk.m3u8\n", code: 200 });
    expect(loader.stats.loaded).toBe(19);
    expect(loader.stats.loading.end).toBeGreaterThanOrEqual(loader.stats.loading.first);
  });

  it("loads a segment as bytes, with a byte range when hls.js asks for one", async () => {
    const asked: Array<string | undefined> = [];
    const Loader = directLoader({ name: "t", load: async (url, init) => (asked.push(init.range), { response: new Response(new Uint8Array([1, 2, 3, 4])), url }) });
    const loader = new Loader({} as HlsConfig);
    const { cb, got } = callbacks();
    loader.load(ctx("http://n3.toonami.example:1934/live/media_1.ts", "arraybuffer", [100, 200]), POLICY, cb);
    await vi.waitFor(() => expect(got.success).toBeDefined());
    expect(asked).toEqual(["bytes=100-199"]);
    expect((got.success!.data as ArrayBuffer).byteLength).toBe(4);
    expect(got.progress).toBe(1);
  });

  it("reports the source's error status to hls.js", async () => {
    const Loader = directLoader({ name: "t", load: async (url) => ({ response: new Response("no", { status: 404, statusText: "Not Found" }), url }) });
    const loader = new Loader({} as HlsConfig);
    const { cb, got } = callbacks();
    loader.load(ctx(SOURCE), POLICY, cb);
    await vi.waitFor(() => expect(got.error).toBeDefined());
    expect(got.error).toEqual({ code: 404, text: "Not Found" });
    expect(got.success).toBeUndefined();
  });

  it("reports a network failure as code 0", async () => {
    const Loader = directLoader({ name: "t", load: async () => Promise.reject(new TypeError("Failed to fetch")) });
    const loader = new Loader({} as HlsConfig);
    const { cb, got } = callbacks();
    loader.load(ctx(SOURCE), POLICY, cb);
    await vi.waitFor(() => expect(got.error).toBeDefined());
    expect(got.error).toEqual({ code: 0, text: "Failed to fetch" });
  });

  it("times out when the source doesn't start answering, and aborts the native fetch", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const Loader = directLoader({ name: "t", load: (_url, init) => ((signal = init.signal), new Promise(() => {})) });
    const loader = new Loader({} as HlsConfig);
    const { cb, got } = callbacks();
    loader.load(ctx(SOURCE), POLICY, cb);
    await vi.advanceTimersByTimeAsync(4999);
    expect(got.timeout).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    expect(got.timeout).toBe(true);
    expect(signal?.aborted).toBe(true);
  });

  it("aborts on hls.js's word, and says nothing more after", async () => {
    let signal: AbortSignal | undefined;
    let answer: (v: { response: Response; url: string }) => void = () => {};
    const Loader = directLoader({ name: "t", load: (_url, init) => ((signal = init.signal), new Promise((r) => (answer = r))) });
    const loader = new Loader({} as HlsConfig);
    const { cb, got } = callbacks();
    loader.load(ctx(SOURCE), POLICY, cb);
    loader.abort();
    expect(signal?.aborted).toBe(true);
    expect(got.abort).toBe(true);
    answer({ response: new Response("#EXTM3U\n"), url: SOURCE });
    await flush(0);
    expect(got.success).toBeUndefined();
    expect(got.error).toBeUndefined();
  });
});
