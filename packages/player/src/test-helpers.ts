// Test stand-ins: jsdom has no media playback, so <video> play/pause are stubbed and each
// station's first frame arrives after a delay the test chooses.

import { vi } from "vitest";
import type { Channel } from "./types";
import type { MediaDriver, Quality } from "./engine/driver";

export const frameDelay: Record<string, number> = {};

export function stubMedia() {
  Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get() { return (this as { _paused?: boolean })._paused ?? true; } });
  HTMLMediaElement.prototype.play = function (this: HTMLVideoElement & { _paused?: boolean }) {
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
}

export function fakeDriver(o: { webAudio?: boolean } = {}): MediaDriver & { handles: FakeHandle[] } {
  const handles: FakeHandle[] = [];
  return {
    name: "fake",
    webAudio: o.webAudio,
    handles,
    attach(video, url) {
      // A browser says it can play once the first segments are in.
      setTimeout(() => video.dispatchEvent(new Event("canplay")), 0);
      const h: FakeHandle = { url, buffer: 0, captions: false, quality: "auto", destroyed: false, live: 30 };
      handles.push(h);
      return {
        liveSyncPosition: () => h.live,
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
    currentTime = 0;
    destination = node("destination");
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
