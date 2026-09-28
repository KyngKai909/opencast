// Test stand-ins: jsdom has no media playback, so <video> play/pause are stubbed and each
// station's first frame arrives after a delay the test chooses.

import { vi } from "vitest";
import type { Channel } from "./types";
import type { MediaDriver } from "./engine/driver";

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
  destroyed: boolean;
  live: number | null;
}

export function fakeDriver(): MediaDriver & { handles: FakeHandle[] } {
  const handles: FakeHandle[] = [];
  return {
    name: "fake",
    handles,
    attach(video, url) {
      // A browser says it can play once the first segments are in.
      setTimeout(() => video.dispatchEvent(new Event("canplay")), 0);
      const h: FakeHandle = { url, buffer: 0, captions: false, destroyed: false, live: 30 };
      handles.push(h);
      return {
        liveSyncPosition: () => h.live,
        setBufferAhead: (s) => (h.buffer = s),
        setCaptions: (on) => (h.captions = on),
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
