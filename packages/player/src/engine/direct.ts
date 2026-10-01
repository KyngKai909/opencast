// A239 (2026-10-01, the user's decision): direct mode in Opencast's native apps. An external
// station's stream link is fetched with the device's own networking, as VLC would: no `Origin`, no
// cookies, no `Referer`, cleartext http allowed, from the viewer's own connection. That plays what
// browsers can't: an http address (A237), a server with no CORS header (A238), a server that
// refuses any request carrying a web page's `Origin`, and a session tied to the viewer's own IP
// (which the relay can't carry).
//
// - Only for rows that carry `playback.sourceUrl` (external stream links), and only where the app
//   gives the engine a DirectTransport (the Android apps, which say they support it). Everything
//   else, API calls included, goes through the web view as before: nothing global is patched.
// - hls.js loads everything (playlists, segments, keys, subtitles) through `directLoader`, so the
//   addresses a playlist names are fetched the same way, wherever they point.
// - The engine tries `sourceUrl` first and falls back to `playback.url` on an error or no first
//   frame within DIRECT_FIRST_FRAME_MS (PlayerEngine.picture). Stand by stays at 8 s.
// - Browsers, Cast and the iPhone are unchanged (no transport). DASH stream links play their
//   `playback.url` (dash.js has no loader hook here yet).
//
// The Android side (native/android-direct/…/DirectStreams.java) serves the fetch at a path on the
// app's own origin (`/_opencast/direct/<token>`), filled by `shouldInterceptRequest` with the real
// address fetched natively and streamed through: no base64 over the bridge, nothing buffered whole.

import type { HlsConfig, Loader, LoaderCallbacks, LoaderConfiguration, LoaderContext, LoaderStats } from "hls.js";
import type { Channel } from "../types";

/** A load through the device's own networking: the answer, and the address it finally came from (after redirects). */
export interface DirectLoad {
  response: Response;
  url: string;
}

/** How a native app fetches an address directly. */
export interface DirectTransport {
  readonly name: string;
  load(url: string, init: { signal?: AbortSignal; range?: string }): Promise<DirectLoad>;
}

/** The header the native side names the final address in (after its redirects). */
export const DIRECT_URL_HEADER = "x-opencast-url";

/** A row's own address for direct mode: an external station's stream link (HLS) with `sourceUrl`. */
export function directUrlOf(c: Pick<Channel, "station" | "playback"> | null | undefined): string | null {
  if (!c || c.station.kind !== "listed" || c.playback?.kind !== "hls" || c.playback.format === "dash") return null;
  const url = c.playback.sourceUrl;
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/**
 * The Android apps' transport: a GET to `<base>?u=<address>` on the app's own origin, which the
 * native side intercepts and fills by fetching the address itself. `base` is the path the app's
 * plugin hands out (it carries a per-launch token); null when direct mode isn't available after all.
 */
export function interceptTransport(base: () => Promise<string | null> | string | null, fetchFn: typeof fetch = (u, i) => fetch(u, i)): DirectTransport {
  return {
    name: "intercept",
    async load(url, { signal, range }) {
      const at = await base();
      if (!at) throw Object.assign(new Error("Direct mode isn't available"), { code: 0 });
      const response = await fetchFn(`${at}?u=${encodeURIComponent(url)}`, {
        method: "GET",
        signal,
        // Same origin (the app's own); nothing of the page's goes to the source anyway (the native side sends none of it).
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        headers: range ? { range } : {}
      });
      return { response, url: response.headers.get(DIRECT_URL_HEADER) || url };
    }
  };
}

function newStats(): LoaderStats {
  return {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 }
  };
}

/** An hls.js loader over a DirectTransport (hls.js's `loader` config): playlists, segments, keys and subtitles alike. */
export function directLoader(transport: DirectTransport): new (config: HlsConfig) => Loader<LoaderContext> {
  return class DirectLoader implements Loader<LoaderContext> {
    context: LoaderContext | null = null;
    stats: LoaderStats = newStats();
    private controller = new AbortController();
    private callbacks: LoaderCallbacks<LoaderContext> | null = null;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private headers: Headers | null = null;

    // hls.js passes its config; nothing in it is needed here.
    constructor(_config?: HlsConfig) {}

    destroy() {
      this.callbacks = null;
      this.abortInternal();
      this.context = null;
      this.headers = null;
    }

    private abortInternal() {
      clearTimeout(this.timer);
      if (!this.stats.loading.end) {
        this.stats.aborted = true;
        this.controller.abort();
      }
    }

    abort() {
      this.abortInternal();
      if (this.callbacks?.onAbort && this.context) this.callbacks.onAbort(this.stats, this.context, null);
    }

    private arm(ms: number, context: LoaderContext) {
      clearTimeout(this.timer);
      if (!Number.isFinite(ms)) return;
      this.timer = setTimeout(() => {
        const callbacks = this.callbacks;
        if (!callbacks) return;
        this.abortInternal();
        callbacks.onTimeout(this.stats, context, null);
      }, Math.max(0, ms));
    }

    load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>) {
      const stats = this.stats;
      if (stats.loading.start) throw new Error("Loader can only be used once.");
      stats.loading.start = performance.now();
      this.context = context;
      this.callbacks = callbacks;
      const { maxTimeToFirstByteMs, maxLoadTimeMs } = config.loadPolicy;
      this.arm(maxTimeToFirstByteMs && Number.isFinite(maxTimeToFirstByteMs) ? maxTimeToFirstByteMs : maxLoadTimeMs, context);
      const range = context.rangeEnd ? `bytes=${context.rangeStart ?? 0}-${context.rangeEnd - 1}` : undefined;
      transport
        .load(context.url, { signal: this.controller.signal, range })
        .then(async ({ response, url }) => {
          // Let go of (aborted, or destroyed) while the answer was on its way.
          if (stats.aborted || !this.callbacks) {
            await response.body?.cancel().catch(() => undefined);
            return;
          }
          this.headers = response.headers;
          const first = Math.max(performance.now(), stats.loading.start);
          this.arm(maxLoadTimeMs - (first - stats.loading.start), context);
          if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            throw Object.assign(new Error(response.statusText || `HTTP ${response.status}`), { code: response.status });
          }
          stats.loading.first = first;
          const data = context.responseType === "arraybuffer" ? await response.arrayBuffer() : await response.text();
          const callbacks = this.callbacks;
          if (!callbacks) return;
          clearTimeout(this.timer);
          stats.loading.end = Math.max(performance.now(), stats.loading.first);
          stats.loaded = stats.total = typeof data === "string" ? data.length : data.byteLength;
          stats.bwEstimate = (stats.total * 8000) / Math.max(1, stats.loading.end - stats.loading.first);
          // As hls.js's own XHR loader: the whole payload through onProgress too, when it's asked for.
          callbacks.onProgress?.(stats, context, data, null);
          // The address it came from after any redirect: a playlist's relative addresses resolve against it.
          callbacks.onSuccess({ url, data, code: response.status }, stats, context, null);
        })
        .catch((e: { code?: number; message?: string } | undefined) => {
          clearTimeout(this.timer);
          if (stats.aborted || !this.callbacks) return;
          this.callbacks.onError({ code: typeof e?.code === "number" ? e.code : 0, text: e?.message ?? "Direct load failed" }, context, null, stats);
        });
    }

    getResponseHeader(name: string): string | null {
      return this.headers?.get(name) ?? null;
    }

    getCacheAge(): number | null {
      const age = this.headers?.get("age");
      return age ? parseFloat(age) : null;
    }
  };
}
