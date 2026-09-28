// How a deck gets HLS into a <video>: hls.js where Media Source Extensions exist, the browser's
// own HLS where they don't (Safari on iPhone). Behind one interface so the engine is the same
// either way, and tests can use a fake.

import Hls from "hls.js";

export interface MediaHandle {
  /** The live edge to join at (the playlist's sync point), in media seconds; null until known. */
  liveSyncPosition(): number | null;
  /** How much to keep buffered ahead: small while warm, normal while on screen. */
  setBufferAhead(seconds: number): void;
  /** Captions from the stream's subtitle rendition. */
  setCaptions(on: boolean): void;
  destroy(): void;
}

export interface MediaDriver {
  readonly name: string;
  attach(video: HTMLVideoElement, url: string, onFatal: (message: string) => void): MediaHandle;
}

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
      let recoveries = 0;
      hls.on(Hls.Events.ERROR, (_e, data) => {
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
        destroy: () => hls.destroy()
      };
    }
  };
}

/** The browser's own HLS (Safari): it joins live by itself. */
export function nativeDriver(): MediaDriver {
  return {
    name: "native",
    attach(video, url, onFatal) {
      const onError = () => onFatal(video.error?.message || "media error");
      video.addEventListener("error", onError);
      video.src = url;
      return {
        liveSyncPosition: () => (video.seekable.length ? Math.max(0, video.seekable.end(video.seekable.length - 1) - 6) : null),
        setBufferAhead: () => {},
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
