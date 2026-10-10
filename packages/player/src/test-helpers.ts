// Test stand-ins: jsdom has no media playback, so <video> play/pause are stubbed and each
// station's first frame arrives after a delay the test chooses.

import { vi } from "vitest";
import type { Channel } from "./types";
import type { AttachOptions, MediaDriver, PlaylistInfo, Quality } from "./engine/driver";
import { CLEAR_GAP_MS, MIN_STATIC_MS, ROLL_MS } from "./tuning/constants";

export const frameDelay: Record<string, number> = {};
/** Stations whose play() never settles and never plays (a playlist that never loaded, a stalled network). */
export const stalled = new Set<string>();

export function stubMedia() {
  Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get() { return (this as { _paused?: boolean })._paused ?? true; } });
  HTMLMediaElement.prototype.play = function (this: HTMLVideoElement & { _paused?: boolean }) {
    if (stalled.has(this.dataset.station ?? "")) return new Promise<void>(() => {});
    const wasPaused = this._paused !== false;
    this._paused = false;
    if (wasPaused) setTimeout(() => this.dispatchEvent(new Event("playing")), frameDelay[this.dataset.station ?? ""] ?? 0);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function (this: HTMLVideoElement & { _paused?: boolean }) {
    this._paused = true;
  };
  HTMLMediaElement.prototype.load = function () {};
}

export interface FakeHandle {
  url: string;
  buffer: number;
  captions: boolean;
  quality: Quality;
  destroyed: boolean;
  live: number | null;
  /** The program date-time of the picture (ms): set it to move the stream's clock. */
  programDate: number | null;
  /** The pre-warmed start the deck asked for. */
  start: AttachOptions["start"];
  /** Deliver a playlist load, as hls.js does on every reload. */
  playlist: (info: Partial<PlaylistInfo>) => void;
}

export function fakeDriver(o: { webAudio?: boolean; fails?: (url: string) => string | null } = {}): MediaDriver & { handles: FakeHandle[] } {
  const handles: FakeHandle[] = [];
  return {
    name: "fake",
    webAudio: o.webAudio,
    handles,
    attach(video, url, onFatal, options = {}) {
      // A playlist that won't load: the driver says so (as hls.js's manifest errors do), and the
      // element never gets anything to play.
      const failure = o.fails?.(url) ?? null;
      if (failure) setTimeout(() => onFatal(failure), 0);
      // A browser says it can play once the first segments are in.
      else setTimeout(() => video.dispatchEvent(new Event("canplay")), 0);
      const h: FakeHandle = {
        url,
        buffer: 0,
        captions: false,
        quality: "auto",
        destroyed: false,
        live: 30,
        programDate: null,
        start: options.start,
        playlist: (info) => options.onPlaylist?.({ ranges: [], ended: false, edge: null, ...info })
      };
      handles.push(h);
      return {
        liveSyncPosition: () => h.live,
        programDate: () => h.programDate,
        setBufferAhead: (s) => (h.buffer = s),
        setCaptions: (on) => (h.captions = on),
        setQuality: (q) => (h.quality = q),
        destroy: () => (h.destroyed = true)
      };
    }
  };
}

let n = 0;
export function station(callSign: string, channel: string, opts: Partial<{ band: "tv" | "radio"; onAir: boolean; kind: "hls" | "embed"; endsAt: string }> = {}): Channel {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  return {
    station: { id, kind: "station", callSign, handle: callSign.toLowerCase(), name: `${callSign} station`, colour: "#8C3B7A", band: opts.band ?? "tv", channel, marketSlug: "inland-empire", homeCity: "Redlands" },
    onAir: opts.onAir ?? true,
    now: { logEntryId: null, title: `${callSign} now`, episodeTitle: null, code: "PGM", kind: "program", startsAt: "2026-09-27T03:30:00Z", endsAt: opts.endsAt ?? "2026-09-27T04:00:00Z", live: false, carriedFrom: null, programId: null },
    next: null,
    playback: opts.onAir === false ? null : { kind: opts.kind ?? "hls", url: `/mock-hls/${callSign.toLowerCase()}/master.m3u8` }
  };
}

/**
 * A fetch stand-in serving playlists and segments by URL (a function of the URL, so a live
 * playlist can change between calls), recording every URL asked for.
 */
export function fakeFetch(serve: (url: string) => string | null) {
  const urls: string[] = [];
  const fn = vi.fn(async (input: string) => {
    const url = String(input);
    urls.push(url);
    const body = serve(url);
    return new Response(body ?? "not found", { status: body === null ? 404 : 200 });
  });
  return { fetch: fn as unknown as (url: string, init?: RequestInit) => Promise<Response>, urls };
}

/** A live media playlist: `count` segments from `first`, 2 seconds each, program date-time from `pdt`. */
export function livePlaylist(o: { first: number; count?: number; pdt?: number; ended?: boolean; extra?: string[] }): string {
  const count = o.count ?? 6;
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:2", `#EXT-X-MEDIA-SEQUENCE:${o.first}`];
  if (o.pdt !== undefined) lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(o.pdt).toISOString()}`);
  lines.push(...(o.extra ?? []));
  for (let k = o.first; k < o.first + count; k++) lines.push("#EXTINF:2.000,", `seg_${k}.ts`);
  if (o.ended) lines.push("#EXT-X-ENDLIST");
  return lines.join("\n") + "\n";
}

/**
 * A TV station's master playlist, as a ladder: 720p, 360p and the audio-only rendition (the
 * lowest bandwidth, which a picture never starts on).
 */
export const MASTER = [
  "#EXTM3U",
  '#EXT-X-STREAM-INF:BANDWIDTH=2400000,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=1280x720',
  "hi.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=650000,CODECS="avc1.64001e,mp4a.40.2",RESOLUTION=640x360',
  "live.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=140000,CODECS="mp4a.40.2"',
  "audio.m3u8",
  ""
].join("\n");

/** A radio station's master playlist: AAC 128k (listed first, the reference) and 64k. */
export const RADIO_MASTER = ["#EXTM3U", '#EXT-X-STREAM-INF:BANDWIDTH=140000,CODECS="mp4a.40.2"', "a128.m3u8", '#EXT-X-STREAM-INF:BANDWIDTH=72000,CODECS="mp4a.40.2"', "a64.m3u8", ""].join("\n");

/**
 * Long enough for any channel change to finish with a picture ready at once: the static's
 * minimum or the photosensitivity guard's gap since the last clear, whichever is longer, and the
 * roll (tuning/constants.ts), and a little over.
 */
export const CHANGE_MS = Math.max(MIN_STATIC_MS, CLEAR_GAP_MS) + ROLL_MS + 40;

/**
 * Moves the fake clock on in small steps until the promise settles (a tune: at once on first
 * launch, after the static's minimum on a channel change), so the time a test's clock has moved
 * is no more than the tune needed.
 */
export async function until<T>(p: Promise<T>, stepMs = 10, maxMs = 20_000): Promise<T> {
  let done = false;
  const q = p.finally(() => (done = true));
  for (let t = 0; t < maxMs && !done; t += stepMs) await vi.advanceTimersByTimeAsync(stepMs);
  return q;
}

/** Lets pending promises and zero-delay timers run under fake timers. */
export async function flush(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
}

/** A Web Audio stand-in (jsdom has none): records the nodes, their connections and gain moves. */
export interface FakeNode {
  kind: string;
  to: FakeNode[];
  /** The last value each AudioParam was set or ramped to, and whether it ramped. */
  params: Record<string, { value: number; ramped: boolean }>;
  element?: HTMLMediaElement;
  /** Linear ramps, in order (the hiss's envelope). */
  ramps?: Array<{ param: string; value: number }>;
  /** A buffer source or oscillator: when it was started and stopped (context seconds; the last call). */
  started?: number;
  stopped?: number;
}

export function stubWebAudio() {
  const nodes: FakeNode[] = [];
  const param = (n: FakeNode, name: string, initial: number) => {
    n.params[name] = { value: initial, ramped: false };
    return {
      get value() {
        return n.params[name]!.value;
      },
      set value(v: number) {
        n.params[name] = { value: v, ramped: false };
      },
      cancelScheduledValues() {},
      setValueAtTime(v: number) {
        n.params[name] = { value: v, ramped: false };
      },
      setTargetAtTime(v: number) {
        n.params[name] = { value: v, ramped: true };
      },
      linearRampToValueAtTime(v: number) {
        n.params[name] = { value: v, ramped: true };
        n.ramps = [...(n.ramps ?? []), { param: name, value: v }];
      },
      exponentialRampToValueAtTime(v: number) {
        n.params[name] = { value: v, ramped: true };
        n.ramps = [...(n.ramps ?? []), { param: name, value: v }];
      }
    };
  };
  const node = (kind: string, params: Record<string, number> = {}) => {
    const n: FakeNode = { kind, to: [], params: {} };
    const api: Record<string, unknown> = { connect: (other: { __node: FakeNode }) => n.to.push(other.__node), disconnect: () => (n.to = []), __node: n };
    for (const [k, v] of Object.entries(params)) api[k] = param(n, k, v);
    nodes.push(n);
    return api;
  };
  class FakeAudioContext {
    state = "suspended";
    sampleRate = 48000;
    private born = Date.now();
    /** Context time follows the (fake) clock. */
    get currentTime() {
      return (Date.now() - this.born) / 1000;
    }
    destination = node("destination");
    createBuffer(_channels: number, length: number, sampleRate: number) {
      const data = new Float32Array(length);
      return { length, sampleRate, getChannelData: () => data };
    }
    createBufferSource() {
      const s = node("bufferSource");
      const n = s.__node as FakeNode;
      return Object.assign(s, { buffer: null as unknown, onended: null as unknown, start: (t = 0) => (n.started = t), stop: (t = 0) => (n.stopped = t) });
    }
    createOscillator() {
      const o = node("oscillator", { frequency: 440 });
      const n = o.__node as FakeNode;
      return Object.assign(o, { type: "sine", onended: null as unknown, start: (t = 0) => (n.started = t), stop: (t = 0) => (n.stopped = t) });
    }
    createBiquadFilter() {
      return Object.assign(node("biquad", { frequency: 350, Q: 1 }), { type: "lowpass" });
    }
    resume() {
      this.state = "running";
      return Promise.resolve();
    }
    createMediaElementSource(el: HTMLMediaElement) {
      const s = node("source");
      (s.__node as FakeNode).element = el;
      return s;
    }
    createAnalyser() {
      return Object.assign(node("analyser"), { fftSize: 2048, frequencyBinCount: 128, smoothingTimeConstant: 0.8, getByteFrequencyData: (a: Uint8Array) => a.fill(120) });
    }
    createGain() {
      return node("gain", { gain: 1 });
    }
    createDynamicsCompressor() {
      return node("compressor", { threshold: -24, ratio: 12, knee: 30, attack: 0.003, release: 0.25 });
    }
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  /** Every node the element's sound passes through, in order along each path, to the speakers. */
  const paths = (el: HTMLMediaElement): string[][] => {
    const source = nodes.find((n) => n.kind === "source" && n.element === el);
    if (!source) return [];
    const out: string[][] = [];
    const walk = (n: FakeNode, path: string[]) => (n.to.length ? n.to.forEach((m) => walk(m, [...path, m.kind])) : out.push(path));
    walk(source, ["source"]);
    return out;
  };
  /** The leveller's nodes for an element: the straight path's gain, the compressor, make-up, and the levelled path's gain. */
  const chain = (el: HTMLMediaElement) => {
    const source = nodes.find((n) => n.kind === "source" && n.element === el);
    const dry = source?.to.find((n) => n.kind === "gain");
    const compressor = source?.to.find((n) => n.kind === "compressor");
    const makeUp = compressor?.to[0];
    const wet = makeUp?.to[0];
    return source ? { dry: dry!, compressor: compressor!, makeUp: makeUp!, wet: wet! } : null;
  };
  return { nodes, paths, chain };
}
