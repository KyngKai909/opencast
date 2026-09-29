// How a deck gets HLS into a <video>: hls.js where Media Source Extensions exist, the browser's
// own HLS where they don't (Safari on iPhone). Behind one interface so the engine is the same
// either way, and tests can use a fake.

import Hls from "hls.js";

/**
 * Picture quality (TV settings, "Picture and sound"): "auto" follows the connection (hls.js's
 * ABR), "data_saver" caps the picture at 480 lines, "best" starts at and holds the top level.
 */
export type Quality = "auto" | "data_saver" | "best";

export interface MediaHandle {
  /** The live edge to join at (the playlist's sync point), in media seconds; null until known. */
  liveSyncPosition(): number | null;
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
  attach(video: HTMLVideoElement, url: string, onFatal: (message: string) => void): MediaHandle;
}

// ---------- Picture quality ----------

/** Data saver's ceiling, in picture lines. */
export const DATA_SAVER_LINES = 480;

type LevelInfo = { height?: number; bitrate: number };

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

/** hls.js, tuned for joining live: start at the sync point three segments from the edge. */
export function hlsDriver(): MediaDriver {
  return {
    name: "hls.js",
    attach(video, url, onFatal) {
      const hls = new Hls({
        liveSyncDurationCount: 3,
        maxBufferLength: 8,
        backBufferLength: 10,
        enableWebVTT: true,
        renderTextTracksNatively: true
      });
      const quality = new QualityRules(hls);
      // Before the first segment loads (the autostart runs after MANIFEST_PARSED's listeners).
      hls.on(Hls.Events.MANIFEST_PARSED, () => quality.onLevels());
      hls.on(Hls.Events.LEVELS_UPDATED, () => quality.onLevels());
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => quality.onLevelSwitched(data.level));
      let recoveries = 0;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) quality.onStall();
        if (!data.fatal) return;
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
        setBufferAhead: (s) => {
          hls.config.maxBufferLength = s;
          hls.config.maxMaxBufferLength = Math.max(s, 30);
        },
        setCaptions: (on) => {
          hls.subtitleDisplay = on;
          if (on && hls.subtitleTrack < 0 && hls.subtitleTracks.length) hls.subtitleTrack = 0;
          for (const t of Array.from(video.textTracks)) if (t.kind === "subtitles" || t.kind === "captions") t.mode = on ? "showing" : "hidden";
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
    attach(video, url, onFatal) {
      const onError = () => onFatal(video.error?.message || "media error");
      video.addEventListener("error", onError);
      video.src = url;
      return {
        liveSyncPosition: () => (video.seekable.length ? Math.max(0, video.seekable.end(video.seekable.length - 1) - 6) : null),
        setBufferAhead: () => {},
        // Native HLS has no way to choose or cap levels: always auto.
        setQuality: () => {},
        setCaptions: (on) => {
          for (const t of Array.from(video.textTracks)) if (t.kind === "subtitles" || t.kind === "captions") t.mode = on ? "showing" : "hidden";
        },
        destroy: () => {
          video.removeEventListener("error", onError);
          video.removeAttribute("src");
          video.load();
        }
      };
    }
  };
}

/** hls.js where it's supported, the browser's own HLS otherwise. */
export function defaultDriver(): MediaDriver {
  if (typeof window !== "undefined" && Hls.isSupported()) return hlsDriver();
  return nativeDriver();
}
