// One station's picture: a <video> element with its stream. The engine keeps a few: the one on
// screen, and warm ones for the neighbouring channels, so up and down switch in well under a
// second. A warm deck is hidden and silent; "buffer" keeps a few seconds near the live edge,
// "play" keeps it decoding.

import type { MediaDriver, MediaHandle, Quality } from "./driver";

export type WarmMode = "buffer" | "play";
export type DeckState = "loading" | "ready" | "playing" | "error";

export interface DeckOptions {
  stationId: string;
  url: string;
  host: HTMLElement;
  driver: MediaDriver;
  /** Seconds to keep buffered while warm. */
  warmBuffer?: number;
  /** Seconds to keep buffered while on screen. */
  activeBuffer?: number;
  /** Picture quality (auto by default). */
  quality?: Quality;
  onChange: () => void;
  now?: () => number;
}

const WARM_KEEPER_MS = 4000;

export class Deck {
  readonly stationId: string;
  readonly url: string;
  readonly video: HTMLVideoElement;
  state: DeckState = "loading";
  error: string | null = null;
  role: "active" | "warm" = "warm";
  /** When loading started, and when the first frame was on screen (ms), for tune timing. */
  readonly createdAt: number;
  firstFrameAt: number | null = null;
  private handle: MediaHandle;
  private keeper: ReturnType<typeof setInterval> | null = null;
  private frameWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private opts: Required<Omit<DeckOptions, "host" | "driver" | "onChange" | "now" | "quality">> & Pick<DeckOptions, "onChange">;
  private now: () => number;

  constructor(o: DeckOptions) {
    this.stationId = o.stationId;
    this.url = o.url;
    this.now = o.now ?? (() => performance.now());
    this.createdAt = this.now();
    this.opts = { stationId: o.stationId, url: o.url, warmBuffer: o.warmBuffer ?? 6, activeBuffer: o.activeBuffer ?? 20, onChange: o.onChange };
    const v = document.createElement("video");
    v.className = "oc-player__video";
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    v.dataset.station = o.stationId;
    v.addEventListener("canplay", () => this.set(this.state === "loading" ? "ready" : this.state));
    v.addEventListener("playing", () => {
      this.set("playing");
      this.watchFrame();
    });
    this.video = v;
    // Captions arrive cue by cue on a live stream: each new one takes the current lift.
    v.textTracks?.addEventListener?.("addtrack", (e) => (e as TrackEvent).track?.addEventListener("cuechange", this.applyCueLine));
    o.host.appendChild(v);
    this.handle = o.driver.attach(v, o.url, (message) => {
      this.error = message;
      this.set("error");
    });
    this.handle.setBufferAhead(this.opts.warmBuffer);
    this.handle.setQuality(o.quality ?? "auto");
  }

  private set(s: DeckState) {
    if (this.state === s) return;
    this.state = s;
    this.opts.onChange();
  }

  /** Resolves once a frame from this deck has been presented (or audio is running, for radio). */
  private watchFrame() {
    if (this.firstFrameAt !== null) return;
    const done = () => {
      if (this.firstFrameAt !== null) return;
      this.firstFrameAt = this.now();
      const waiters = this.frameWaiters;
      this.frameWaiters = [];
      waiters.forEach((w) => w.resolve());
      this.opts.onChange();
    };
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (typeof v.requestVideoFrameCallback === "function" && v.videoWidth > 0) v.requestVideoFrameCallback(done);
    else {
      const start = v.currentTime;
      const onTime = () => {
        if (v.currentTime !== start) {
          v.removeEventListener("timeupdate", onTime);
          done();
        }
      };
      v.addEventListener("timeupdate", onTime);
      // Audio-only streams have no frames; the first timeupdate after playing is enough.
      if (v.videoWidth === 0) setTimeout(done, 0);
    }
  }

  firstFrame(timeoutMs = 15000): Promise<void> {
    if (this.firstFrameAt !== null) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("The picture didn't arrive in time.")), timeoutMs);
      this.frameWaiters.push({
        resolve: () => {
          clearTimeout(t);
          resolve();
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        }
      });
    });
  }

  /** Keep this deck ready for a quick switch. */
  warm(mode: WarmMode) {
    this.role = "warm";
    this.video.muted = true;
    this.video.classList.remove("is-on");
    this.video.setAttribute("aria-hidden", "true");
    this.handle.setBufferAhead(this.opts.warmBuffer);
    this.handle.setCaptions(false);
    if (mode === "play") {
      void this.video.play().catch(() => {});
      this.stopKeeper();
    } else {
      this.video.pause();
      if (this.state === "playing") this.set("ready");
      this.startKeeper();
    }
  }

  /** Start playing (still hidden and silent) so the first frame can be waited for. */
  async start(): Promise<void> {
    this.stopKeeper();
    // A deck warmed by playing already has live frames; any other waits for a fresh one, so a
    // paused picture from earlier never stands in for the live one.
    if (this.video.paused) this.firstFrameAt = null;
    this.handle.setBufferAhead(this.opts.activeBuffer);
    this.joinLive();
    this.video.muted = true;
    await this.video.play();
  }

  /** On screen: visible, and audible unless muted. */
  show(muted: boolean) {
    this.role = "active";
    this.video.muted = muted;
    this.video.classList.add("is-on");
    this.video.removeAttribute("aria-hidden");
  }

  setCaptions(on: boolean) {
    this.handle.setCaptions(on);
  }

  /** Picture quality, on screen or warm alike. */
  setQuality(quality: Quality) {
    this.handle.setQuality(quality);
  }

  private cueLine: number | null = null;

  /**
   * Which caption line the cues sit on, counted up from the bottom (-1 is the bottom line), or
   * null for the stream's own placement. The TV lifts them above the banner while it's up.
   * (Line numbers, not percentages: Chromium ignores lineAlign, so a percentage can only place a
   * cue's top edge.)
   */
  setCueLine(line: number | null) {
    this.cueLine = line;
    this.applyCueLine();
  }

  private applyCueLine = () => {
    const tracks = this.video.textTracks;
    if (!tracks || typeof VTTCue === "undefined") return;
    // Every cue still to come, not just the ones showing: a cue is laid out as it becomes active,
    // so the line has to be set before then (hls.js adds cues ahead, from the buffered segments).
    const now = this.video.currentTime;
    for (const t of Array.from(tracks)) {
      for (const c of Array.from(t.cues ?? [])) {
        if (c.endTime < now) continue;
        if (!(c instanceof VTTCue)) continue;
        c.snapToLines = true;
        c.line = this.cueLine ?? "auto";
      }
    }
  };

  /** Seconds behind the live edge, or null when not known. */
  behindLive(): number | null {
    const live = this.handle.liveSyncPosition();
    return live === null ? null : Math.max(0, live - this.video.currentTime);
  }

  /** Jump to the live edge if it has fallen behind (a warm deck paused, or a long pause). */
  joinLive(toleranceSeconds = 4) {
    const live = this.handle.liveSyncPosition();
    if (live !== null && live - this.video.currentTime > toleranceSeconds) this.video.currentTime = live;
  }

  private startKeeper() {
    this.stopKeeper();
    // A paused warm deck drifts behind live as the playlist moves on; keep it near the edge so
    // its buffer is what a switch will play.
    this.keeper = setInterval(() => this.joinLive(), WARM_KEEPER_MS);
  }

  private stopKeeper() {
    if (this.keeper) clearInterval(this.keeper);
    this.keeper = null;
  }

  destroy() {
    this.stopKeeper();
    // A tune still waiting on this deck ends now (a newer channel change let go of it).
    const waiters = this.frameWaiters;
    this.frameWaiters = [];
    const gone = Object.assign(new Error("Tuned away."), { name: "AbortError" });
    waiters.forEach((w) => w.reject(gone));
    this.handle.destroy();
    this.video.remove();
  }
}
