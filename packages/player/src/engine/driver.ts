// How a deck gets HLS into a <video>: hls.js where Media Source Extensions exist, the browser's
// own HLS where they don't (Safari on iPhone). Behind one interface so the engine is the same
// either way, and tests can use a fake.

import Hls from "hls.js";
import { parseDateRanges, type HlsDateRange } from "@opencast/contracts";
import { isMaster, mediaPlaylist, variants, type Fetch } from "./playlist";

/**
 * Picture quality (TV settings, "Picture and sound"): "auto" follows the connection (hls.js's
 * ABR), "data_saver" caps the picture at 480 lines, "best" starts at and holds the top level.
 */
export type Quality = "auto" | "data_saver" | "best";

/** What a playlist load says besides its segments. */
export interface PlaylistInfo {
  /** Its `#EXT-X-DATERANGE` tags, read with the contract's parser. */
  ranges: HlsDateRange[];
  /** `#EXT-X-ENDLIST`: the station signed off (or the stream ended). */
  ended: boolean;
  /** The program date-time at the end of its last segment (ms), when it has one. */
  edge: number | null;
}

export interface AttachOptions {
  /** Every playlist load (hls.js) or poll (the browser's own HLS). */
  onPlaylist?: (info: PlaylistInfo) => void;
  /** A pre-warmed start: the rendition to start at, and how many target durations from the end to join. */
  start?: { bandwidth: number | null; syncCount: number } | null;
  /** For polling playlists where the driver can't read them itself (the browser's own HLS). */
  fetch?: Fetch;
}

export interface MediaHandle {
  /** The live edge to join at (the playlist's sync point), in media seconds; null until known. */
  liveSyncPosition(): number | null;
  /** The program date-time (ms since the epoch) of the picture on screen, from `#EXT-X-PROGRAM-DATE-TIME`; null when the stream has none. */
  programDate(): number | null;
  /** How much to keep buffered ahead: small while warm, normal while on screen. */
  setBufferAhead(seconds: number): void;
  /** Captions from the stream's subtitle rendition. */
  setCaptions(on: boolean): void;
  /** Which levels the stream may play at. Applies from the next segments, without a flush. */
  setQuality(quality: Quality): void;
  destroy(): void;
}

export interface MediaDriver {
  readonly name: string;
  /**
   * False where Web Audio only gets silence from this driver's elements (the browser's own HLS
   * on Safari): the engine then never routes them into its graph, so their sound is left alone.
   */
  readonly webAudio?: boolean;
  attach(video: HTMLVideoElement, url: string, onFatal: (message: string) => void, options?: AttachOptions): MediaHandle;
}

/** A playlist's text as PlaylistInfo. */
export function playlistInfo(text: string, url: string): PlaylistInfo {
  const media = mediaPlaylist(text, url);
  return { ranges: parseDateRanges(text), ended: media.ended, edge: media.edge };
}

/**
 * hls.js settings for joins: between items (each prepared on its own, so every item starts a new
 * discontinuity with its own timestamps) and into and out of live blocks.
 * - A short video track at the end of an item is stretched to its audio (the last frame holds,
 *   never black), and holes up to half a second are jumped rather than stalled on.
 * - Gaps in the sound are filled with silent frames (maxAudioFramesDrift 1), so it doesn't pop.
 * - A stall at a join is nudged past quickly (checked every second, five tries).
 * - Every discontinuity starts on a keyframe.
 */
export const JOIN_CONFIG = {
  stretchShortVideoTrack: true,
  maxBufferHole: 0.5,
  maxAudioFramesDrift: 1,
  forceKeyFrameOnDiscontinuity: true,
  highBufferWatchdogPeriod: 1,
  nudgeMaxRetry: 5,
  nudgeOnVideoHole: true
} as const;

// ---------- Picture quality ----------

/** Data saver's ceiling, in picture lines. */
export const DATA_SAVER_LINES = 480;

type LevelInfo = { height?: number; bitrate: number; videoCodec?: string };

/**
 * The levels a picture mustn't play: the audio-only rendition of a TV ladder (no height and no
 * video codec, next to levels that have pictures). hls.js leaves it out itself when the master
 * says its CODECS, as the API's does; this covers a master that doesn't. A radio ladder (sound
 * only throughout) keeps every level.
 */
export function audioOnlyLevels(levels: readonly LevelInfo[]): number[] {
  const picture = (l: LevelInfo) => !!l.height || !!l.videoCodec;
  if (!levels.some(picture)) return [];
  return levels.flatMap((l, i) => (picture(l) ? [] : [i]));
}

/**
 * The highest level data saver allows: the tallest picture up to 480 lines, at the lowest
 * bitrate offered at that height. A level without a height (audio only, or a playlist that
 * doesn't say) counts as 0 lines. When every level is taller, the smallest picture there is.
 * (hls.js sorts levels by height, then bitrate, so capping at this index leaves ABR the levels
 * at or below it.)
 */
export function dataSaverLevel(levels: readonly LevelInfo[]): number {
  if (!levels.length) return -1;
  const heights = levels.map((l) => l.height || 0);
  const fitting = heights.filter((h) => h <= DATA_SAVER_LINES);
  const height = fitting.length ? Math.max(...fitting) : Math.min(...heights);
  let pick = -1;
  levels.forEach((l, i) => {
    if (heights[i] === height && (pick < 0 || l.bitrate < levels[pick]!.bitrate)) pick = i;
  });
  return pick;
}

/** The top level: the tallest picture at its highest bitrate. */
export function bestLevel(levels: readonly LevelInfo[]): number {
  let pick = -1;
  levels.forEach((l, i) => {
    const p = pick < 0 ? null : levels[pick]!;
    if (!p || (l.height || 0) > (p.height || 0) || ((l.height || 0) === (p.height || 0) && l.bitrate > p.bitrate)) pick = i;
  });
  return pick;
}

/** The part of hls.js the quality rules drive (a fake in tests). */
export interface LevelControl {
  readonly levels: readonly LevelInfo[];
  /** The highest level ABR may choose, or -1 for no cap. */
  autoLevelCapping: number;
  /** The level the first segment loads at. */
  startLevel: number;
  /** Set: a level to hold (-1 hands the choice back to ABR), taking effect after the buffer. */
  loadLevel: number;
  /** The level held, or -1 while ABR chooses. */
  readonly manualLevel: number;
}

/**
 * Picture quality on one hls.js instance.
 * - auto: hls.js's ABR, uncapped (as it always was).
 * - data_saver: ABR capped at dataSaverLevel (480 lines, lowest bitrate at that height).
 * - best: starts at and holds the top level. If playback stalls, ABR takes over (and may drop);
 *   once ABR has climbed back to the top, it's held there again.
 */
export class QualityRules {
  private quality: Quality = "auto";
  /** best: held at the top rather than handed to ABR after a stall. */
  private holding = false;

  constructor(private hls: LevelControl) {}

  get current(): Quality {
    return this.quality;
  }

  set(quality: Quality) {
    if (quality === this.quality) return;
    this.quality = quality;
    this.holding = quality === "best";
    this.apply();
  }

  /** The levels are known (the manifest was parsed, or levels were dropped): before the first segment. */
  onLevels() {
    if (this.quality === "best") {
      const top = bestLevel(this.hls.levels);
      if (top >= 0) this.hls.startLevel = top;
    }
    this.apply();
  }

  /** Playback stalled: while holding the top, let ABR choose (it may drop). */
  onStall() {
    if (this.quality !== "best" || !this.holding) return;
    this.holding = false;
    this.hls.loadLevel = -1;
  }

  /** ABR moved to a level: back at the top after a stall, hold it again. */
  onLevelSwitched(level: number) {
    if (this.quality === "best" && !this.holding && level === bestLevel(this.hls.levels)) {
      this.holding = true;
      this.apply();
    }
  }

  private apply() {
    const levels = this.hls.levels;
    if (!levels.length) return; // Applied once the manifest is parsed.
    const hold = (level: number) => {
      if (this.hls.manualLevel !== level) this.hls.loadLevel = level;
    };
    switch (this.quality) {
      case "auto":
        this.hls.autoLevelCapping = -1;
        hold(-1);
        break;
      case "data_saver":
        this.hls.autoLevelCapping = dataSaverLevel(levels);
        hold(-1);
        break;
      case "best":
        this.hls.autoLevelCapping = -1;
        hold(this.holding ? bestLevel(levels) : -1);
        break;
    }
  }
}

// ---------- Drivers ----------

/** Shows or hides the video's caption and subtitle tracks (metadata tracks are left alone). */
function showTextTracks(video: HTMLVideoElement, on: boolean) {
  for (const t of Array.from(video.textTracks ?? [])) if (t.kind === "subtitles" || t.kind === "captions") t.mode = on ? "showing" : "hidden";
}

/** Fatal errors about the master playlist itself, which hls.js's startLoad() can't recover from. */
const MANIFEST_ERRORS = new Set<string>([Hls.ErrorDetails.MANIFEST_LOAD_ERROR, Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT, Hls.ErrorDetails.MANIFEST_PARSING_ERROR, Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR]);

/** hls.js, tuned for joining live: start at the sync point three segments from the edge. */
export function hlsDriver(): MediaDriver {
  return {
    name: "hls.js",
    attach(video, url, onFatal, options = {}) {
      const hls = new Hls({
        // A pre-warmed start joins on the segment already fetched (3, or more if the playlist moved on).
        liveSyncDurationCount: options.start?.syncCount ?? 3,
        maxBufferLength: 8,
        backBufferLength: 10,
        enableWebVTT: true,
        renderTextTracksNatively: true,
        // The overlays read the DATERANGE tags from the playlist text; no metadata cues needed.
        enableDateRangeMetadataCues: false,
        ...JOIN_CONFIG
      });
      const quality = new QualityRules(hls);
      // Captions as last asked. The channel's subtitle rendition (X2) is known only once the master
      // is parsed, and its text track only once hls.js makes it: each time, it's asked again.
      let captions = false;
      const applyCaptions = () => {
        hls.subtitleDisplay = captions;
        if (captions && hls.subtitleTrack < 0 && hls.subtitleTracks?.length) hls.subtitleTrack = 0;
        showTextTracks(video, captions);
      };
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, applyCaptions);
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, () => showTextTracks(video, captions));
      // Before the first segment loads (the autostart runs after MANIFEST_PARSED's listeners).
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Pictures only: never the TV ladder's audio-only rendition (ABR mustn't drop to it).
        for (const i of audioOnlyLevels(hls.levels).reverse()) hls.removeLevel(i);
        const bw = options.start?.bandwidth;
        if (bw) {
          const i = hls.levels.findIndex((l) => l.bitrate === bw);
          if (i >= 0) hls.startLevel = i;
        }
        quality.onLevels();
        applyCaptions();
      });
      hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => {
        if (options.onPlaylist && data.details?.m3u8) options.onPlaylist(playlistInfo(data.details.m3u8, data.details.url));
      });
      hls.on(Hls.Events.LEVELS_UPDATED, () => quality.onLevels());
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => quality.onLevelSwitched(data.level));
      let recoveries = 0;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) quality.onStall();
        if (!data.fatal) return;
        // The master playlist never loaded: startLoad() wouldn't fetch it again (there are no
        // levels to load), so a tune would wait for ever. Say so at once; the engine loads the
        // station afresh, and its Stand by (8 s) tells the viewer.
        if (MANIFEST_ERRORS.has(data.details)) return onFatal(data.details);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && recoveries < 3) {
          recoveries++;
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recoveries < 3) {
          recoveries++;
          hls.recoverMediaError();
        } else onFatal(data.details);
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      return {
        liveSyncPosition: () => hls.liveSyncPosition ?? null,
        programDate: () => hls.playingDate?.getTime() ?? null,
        setBufferAhead: (s) => {
          hls.config.maxBufferLength = s;
          hls.config.maxMaxBufferLength = Math.max(s, 30);
        },
        setCaptions: (on) => {
          captions = on;
          applyCaptions();
        },
        setQuality: (q) => quality.set(q),
        destroy: () => hls.destroy()
      };
    }
  };
}

/**
 * The browser's own HLS (Safari): it joins live by itself. It chooses levels itself too, so
 * picture quality stays on auto here; and Web Audio gets only silence from it, so the level meter
 * and evening out the sound leave its sound alone.
 */
export function nativeDriver(): MediaDriver {
  return {
    name: "native",
    webAudio: false,
    attach(video, url, onFatal, options = {}) {
      const onError = () => onFatal(video.error?.message || "media error");
      video.addEventListener("error", onError);
      // Safari makes the subtitle rendition's text track when it reads the master (X2): it takes
      // the caption setting as it arrives.
      let captions = false;
      const onTrack = () => showTextTracks(video, captions);
      video.textTracks?.addEventListener?.("addtrack", onTrack);
      video.src = url;
      const stopPolling = options.onPlaylist ? pollPlaylist(url, options.fetch ?? ((u, i) => fetch(u, i)), options.onPlaylist) : () => {};
      return {
        liveSyncPosition: () => (video.seekable.length ? Math.max(0, video.seekable.end(video.seekable.length - 1) - 6) : null),
        // Safari maps the stream's program date-time onto the timeline: its start date plus the time.
        programDate: () => {
          const start = (video as HTMLVideoElement & { getStartDate?: () => Date }).getStartDate?.().getTime();
          return start !== undefined && !Number.isNaN(start) ? start + video.currentTime * 1000 : null;
        },
        setBufferAhead: () => {},
        // Native HLS has no way to choose or cap levels: always auto.
        setQuality: () => {},
        setCaptions: (on) => {
          captions = on;
          showTextTracks(video, on);
        },
        destroy: () => {
          stopPolling();
          video.removeEventListener("error", onError);
          video.textTracks?.removeEventListener?.("addtrack", onTrack);
          video.removeAttribute("src");
          video.load();
        }
      };
    }
  };
}

/**
 * The browser's own HLS doesn't hand its playlists to the page (its DATERANGE metadata cues carry
 * one attribute each, with no END or SCTE-35 to merge them by), so the tags are read from the
 * playlist itself: the first variant's, every target duration, until it ends.
 */
function pollPlaylist(url: string, fetchFn: Fetch, onPlaylist: (info: PlaylistInfo) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let mediaUrl: string | null = null;
  const abort = new AbortController();
  const poll = async () => {
    let next = 4000;
    try {
      if (!mediaUrl) {
        const first = await (await fetchFn(url, { signal: abort.signal })).text();
        mediaUrl = isMaster(first) ? (variants(first, url)[0]?.url ?? url) : url;
      }
      const text = await (await fetchFn(mediaUrl, { signal: abort.signal })).text();
      if (stopped) return;
      const info = playlistInfo(text, mediaUrl);
      onPlaylist(info);
      next = info.ended ? 0 : Math.max(1, mediaPlaylist(text, mediaUrl).targetDuration) * 1000;
    } catch {
      // Try again at the next poll.
    }
    if (!stopped && next) timer = setTimeout(() => void poll(), next);
  };
  void poll();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    abort.abort();
  };
}

/** hls.js where it's supported, the browser's own HLS otherwise. */
export function defaultDriver(): MediaDriver {
  if (typeof window !== "undefined" && Hls.isSupported()) return hlsDriver();
  return nativeDriver();
}
