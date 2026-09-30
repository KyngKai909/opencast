// DASH stream links (A201): an external station whose stream link is the source's DASH manifest
// (`playback.format: "dash"`), played in Opencast's player straight from the source, like an HLS
// stream link (never proxied, cached or re-served).
//
// - dash.js is loaded on demand: a dynamic import (its own chunk) the first time a DASH station is
//   tuned, never before. HLS viewers download nothing extra, and a DASH neighbour is never warmed
//   (no prefetch, no hidden deck), so the chunk only comes when a DASH station is on screen.
// - The browser's own DASH is used only where it says "probably" (rare: some TV browsers). Anywhere
//   else with Media Source Extensions (or Safari's ManagedMediaSource, iPhone from iOS 17.1) it's
//   dash.js. With neither (an iPhone before iOS 17.1), the device can't play DASH: the engine skips
//   such stations in the swipe order and says so if one is tuned directly (status "unplayable").
// - It's a MediaDriver like hls.js's, so the deck's lifecycle is the same: the static until the
//   first frame, Tuning in, Stand by at 8 s, errors loading it afresh, teardown on a channel change.
// - Picture quality maps onto dash.js's ABR with the same rules as hls.js (dataSaverLevel, bestLevel).
// - Captions: a text track in the manifest shows and hides with the caption setting.
// - Clock (A228): the manifest's own UTCTiming, else the device clock (and the manifest's Date header).
//   Never dash.js's default third-party time server.

import type { Channel } from "../types";
import { bestLevel, dataSaverLevel, nativeDriver, type MediaDriver, type MediaHandle, type Quality } from "./driver";

/** How this device can play DASH: the browser's own, dash.js on Media Source, or not at all. */
export type DashSupport = "native" | "mse" | "none";

/** A row whose picture is a DASH stream (A201). */
export function isDash(c: Pick<Channel, "playback"> | null | undefined): boolean {
  return c?.playback?.kind === "hls" && c.playback.format === "dash";
}

/** A baseline H.264 and AAC picture, the least a DASH stream link needs. */
const BASELINE = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';

/** What this device can do with DASH. */
export function dashSupport(): DashSupport {
  if (typeof window === "undefined" || typeof document === "undefined") return "none";
  try {
    if (document.createElement("video").canPlayType?.("application/dash+xml") === "probably") return "native";
  } catch {
    // No media elements here.
  }
  const g = globalThis as { ManagedMediaSource?: { isTypeSupported?: (t: string) => boolean }; MediaSource?: { isTypeSupported?: (t: string) => boolean }; WebKitMediaSource?: { isTypeSupported?: (t: string) => boolean } };
  for (const mse of [g.ManagedMediaSource, g.MediaSource, g.WebKitMediaSource]) {
    try {
      if (mse && typeof mse.isTypeSupported === "function" && mse.isTypeSupported(BASELINE)) return "mse";
    } catch {
      // Try the next.
    }
  }
  return "none";
}

// ---------- dash.js, on demand ----------

/** The part of a dash.js MediaPlayer the driver uses (a fake in tests). */
export interface DashPlayer {
  initialize(view: HTMLMediaElement, source: string, autoPlay: boolean): void;
  updateSettings(settings: object): void;
  on(type: string, listener: (e: DashEvent) => void): void;
  getRepresentationsByType(type: "video"): ReadonlyArray<{ bandwidth: number; height?: number }>;
  setRepresentationForTypeByIndex(type: "video", index: number, forceReplace?: boolean): void;
  enableText(on: boolean): boolean;
  setTextTrack(index: number): void;
  getTargetLiveDelay(): number;
  timeAsUTC(): number;
  clearDefaultUTCTimingSources(): void;
  destroy(): void;
}

export interface DashEvent {
  mediaType?: string;
  error?: { code?: number; message?: string } | string;
  newRepresentation?: { index?: number; bandwidth?: number; height?: number };
  tracks?: unknown[];
}

/** The module's shape, as `import("dashjs")` gives it. */
export interface DashJsModule {
  MediaPlayer(): { create(): unknown };
}

/** dash.js's event names (MediaPlayer.events), as strings so the driver needn't load it to name them. */
export const DASH_EVENTS = {
  error: "error",
  playbackError: "playbackError",
  playbackEnded: "playbackEnded",
  streamInitialized: "streamInitialized",
  textTracksAdded: "allTextTracksAdded",
  bufferEmpty: "bufferStalled",
  qualityRendered: "qualityChangeRendered"
} as const;

let loading: Promise<DashJsModule> | null = null;
let loads = 0;

/**
 * dash.js, fetched the first time a DASH station is tuned (a chunk of its own; see the report in
 * docs/open-decisions.md A201 for its size). A failed fetch (offline) is tried again next time.
 */
export function loadDashJs(): Promise<DashJsModule> {
  if (!loading) {
    loads++;
    loading = (import("dashjs") as Promise<unknown> as Promise<DashJsModule>).catch((e: unknown) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

/** How many times dash.js has been asked for (tests, and the recordings' log): 0 until a DASH station is tuned. */
export function dashJsLoads(): number {
  return loads;
}

// ---------- Picture quality on dash.js ----------

/** What dash.js's ABR is told for a quality setting. Bitrates in kbps; -1 for no limit. */
export interface DashAbr {
  autoSwitch: boolean;
  maxKbps: number;
  initialKbps: number;
  /** A representation to hold (best, until a stall hands it to ABR), by index in the video list. */
  hold: number | null;
}

/**
 * The quality rules of the hls.js driver (QualityRules), for dash.js's ABR:
 * - auto: dash.js's ABR, uncapped.
 * - data_saver: ABR capped at the tallest picture up to 480 lines (its lowest bitrate), starting low.
 * - best: starts at and holds the top representation; after a stall ABR chooses, until it's back at the top.
 * Before the manifest is read (`reps` empty) only the start is set: low for data saver, the top for best.
 */
export function dashAbr(quality: Quality, reps: ReadonlyArray<{ bandwidth: number; height?: number }>, holding = true): DashAbr {
  const levels = reps.map((r) => ({ bitrate: r.bandwidth, height: r.height }));
  const kbps = (i: number) => Math.ceil(levels[i]!.bitrate / 1000);
  switch (quality) {
    case "auto":
      return { autoSwitch: true, maxKbps: -1, initialKbps: -1, hold: null };
    case "data_saver": {
      const cap = dataSaverLevel(levels);
      return { autoSwitch: true, maxKbps: cap >= 0 ? kbps(cap) : -1, initialKbps: 1, hold: null };
    }
    case "best": {
      const top = bestLevel(levels);
      if (top < 0) return { autoSwitch: false, maxKbps: -1, initialKbps: 1_000_000, hold: null };
      return holding ? { autoSwitch: false, maxKbps: -1, initialKbps: kbps(top), hold: top } : { autoSwitch: true, maxKbps: -1, initialKbps: kbps(top), hold: null };
    }
  }
}

function abrSettings(a: DashAbr) {
  return { streaming: { abr: { autoSwitchBitrate: { video: a.autoSwitch }, maxBitrate: { video: a.maxKbps }, initialBitrate: { video: a.initialKbps } } } };
}

/** How much to keep buffered ahead (and behind: 10 s, as hls.js's back buffer). */
function bufferSettings(seconds: number) {
  return { streaming: { buffer: { bufferTimeDefault: seconds, bufferTimeAtTopQuality: seconds, bufferTimeAtTopQualityLongForm: seconds, bufferToKeep: 10 } } };
}

/** Shows or hides the video's caption and subtitle tracks (as the hls.js driver does). */
function showTextTracks(video: HTMLVideoElement, on: boolean) {
  for (const t of Array.from(video.textTracks ?? [])) if (t.kind === "subtitles" || t.kind === "captions") t.mode = on ? "showing" : "hidden";
}

const messageOf = (e: DashEvent) => (typeof e.error === "string" ? e.error : e.error?.message) || `dash.js error${typeof e.error === "object" && e.error?.code !== undefined ? ` ${e.error.code}` : ""}`;

/**
 * dash.js on Media Source. `attach` is synchronous like the other drivers; dash.js arrives a moment
 * later (at once once it's been loaded). The deck has already asked the picture to play by then,
 * and handing dash.js the element resets that request, so dash.js is told to play it itself.
 */
export function dashJsDriver(load: () => Promise<DashJsModule> = loadDashJs): MediaDriver {
  return {
    name: "dash.js",
    attach(video, url, onFatal) {
      let player: DashPlayer | null = null;
      let gone = false;
      let failed = false;
      let quality: Quality = "auto";
      let bufferAhead = 6;
      let captions = false;
      /** best: held at the top, rather than handed to ABR after a stall. */
      let holding = true;

      const fail = (message: string) => {
        if (gone || failed) return;
        failed = true;
        onFatal(message);
      };
      const reps = () => (player ? player.getRepresentationsByType("video") : []);
      const applyQuality = () => {
        if (!player) return;
        const a = dashAbr(quality, reps(), holding);
        player.updateSettings(abrSettings(a));
        if (a.hold !== null) player.setRepresentationForTypeByIndex("video", a.hold, false);
      };
      const applyCaptions = () => {
        if (player) {
          player.enableText(captions);
          if (captions) player.setTextTrack(0);
        }
        showTextTracks(video, captions);
      };

      void load().then(
        (mod) => {
          if (gone) return;
          const p = mod.MediaPlayer().create() as DashPlayer;
          player = p;
          p.updateSettings({
            debug: { logLevel: 1 },
            streaming: {
              ...bufferSettings(bufferAhead).streaming,
              ...abrSettings(dashAbr(quality, [], holding)).streaming,
              text: { defaultEnabled: false },
              // Join live a few segments from the edge, as the HLS driver does.
              delay: { liveDelayFragmentCount: 3, useSuggestedPresentationDelay: true }
            }
          });
          p.on(DASH_EVENTS.error, (e) => fail(messageOf(e)));
          p.on(DASH_EVENTS.playbackError, (e) => fail(messageOf(e)));
          // A live stream that ends (its manifest turned static and ran out): as a stream link that fails.
          p.on(DASH_EVENTS.playbackEnded, () => fail("The stream ended."));
          p.on(DASH_EVENTS.streamInitialized, () => {
            applyQuality();
            applyCaptions();
          });
          p.on(DASH_EVENTS.textTracksAdded, applyCaptions);
          p.on(DASH_EVENTS.bufferEmpty, (e) => {
            // A stall while holding the top: let ABR choose (it may drop).
            if (quality !== "best" || !holding || (e.mediaType && e.mediaType !== "video")) return;
            holding = false;
            applyQuality();
          });
          p.on(DASH_EVENTS.qualityRendered, (e) => {
            if (e.mediaType !== "video" || quality !== "best" || holding) return;
            // ABR has climbed back to the top: hold it there again.
            const top = bestLevel(reps().map((r) => ({ bitrate: r.bandwidth, height: r.height })));
            if (top >= 0 && e.newRepresentation?.index === top) {
              holding = true;
              applyQuality();
            }
          });
          p.initialize(video, url, !video.paused);
          // The manifest's UTCTiming, else the device clock: never dash.js's default time server.
          p.clearDefaultUTCTimingSources();
        },
        () => fail("The DASH player didn't load.")
      );

      const handle: MediaHandle = {
        // The live edge less dash.js's target delay, on the element's timeline (dash.js sets the
        // live seekable range), for Back to live and the warm keeper.
        liveSyncPosition: () => {
          const s = video.seekable;
          if (!player || !s || !s.length) return null;
          const end = s.end(s.length - 1);
          if (!Number.isFinite(end)) return null;
          const delay = player.getTargetLiveDelay();
          return Math.max(s.start(0), end - (Number.isFinite(delay) && delay > 0 ? delay : 6));
        },
        programDate: () => {
          const t = player?.timeAsUTC();
          return typeof t === "number" && Number.isFinite(t) && t > 0 ? Math.round(t * 1000) : null;
        },
        setBufferAhead: (s) => {
          bufferAhead = s;
          player?.updateSettings(bufferSettings(s));
        },
        setCaptions: (on) => {
          captions = on;
          applyCaptions();
        },
        setQuality: (q) => {
          if (q === quality) return;
          quality = q;
          holding = q === "best";
          applyQuality();
        },
        destroy: () => {
          gone = true;
          try {
            player?.destroy();
          } catch {
            // Already torn down.
          }
          player = null;
          video.removeAttribute("src");
          try {
            video.load();
          } catch {
            // jsdom.
          }
        }
      };
      return handle;
    }
  };
}

/** The browser's own DASH (where it says "probably"): no playlist polling, no quality control. */
export function nativeDashDriver(): MediaDriver {
  const native = nativeDriver();
  return { name: "native-dash", webAudio: false, attach: (video, url, onFatal) => native.attach(video, url, onFatal) };
}

/** The DASH driver for this device: the browser's own where it truly has one, else dash.js. */
export function defaultDashDriver(support: DashSupport = dashSupport()): MediaDriver {
  return support === "native" ? nativeDashDriver() : dashJsDriver();
}
