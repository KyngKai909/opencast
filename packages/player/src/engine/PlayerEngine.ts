// The player, without a framework: the one the viewer app, TV mode and the Cast receiver share.
//
// - Tuning joins live, mid-program. There's no seeking.
// - A channel change keeps the old picture (and sound) until the new one has a frame on screen.
// - The neighbouring channels are warm (their playlists and first segment), so up and down are quick.
// - The station's bug, lower thirds and a spot's code and QR are drawn over the picture, timed
//   from the playlist's DATERANGE tags against the media's program date-time (onScreen).
// - Items join without a glitch (hls.js's join settings, driver.ts). A playlist that ends after the
//   sign-off slate puts the station off air with its back time, and it tunes back in when a new
//   playlist appears.
// - Every change shows the banner for five seconds (a setting on TV).
// - Pause holds your place for up to 30 minutes, then offers Back to live.
// - Number entry: 1, 2 tunes 12.1 after a short wait, or at once on OK.
// - Captions, with the size setting; a sleep timer that fades the sound over its last minute.
// - Picture quality (auto, data saver, best) and evening out the sound, settings on TV.
//
// Surfaces read its state (subscribe/getState) and send it commands (handle).

import type { Channel, Command, CommandSource } from "../types";
import { findByChannel, neighbour, neighbours, type NeighbourOptions } from "../dial";
import { readEntry, typeKey, type NumberEntry } from "../numberEntry";
import { Deck, SignedOffError, type WarmMode } from "./Deck";
import { defaultDriver, type MediaDriver, type Quality } from "./driver";
import { AudioLevels } from "./meter";
import { isLive, Prefetch, type Fetch } from "./playlist";
import { onScreenKey, type OnScreen } from "./timeline";

export type CaptionMode = "off" | "on" | "muted_only";

export type CaptionSize = "small" | "medium" | "large";
export type Status = "idle" | "tuning" | "playing" | "paused" | "off_air" | "embed" | "error" | "stopped";

export interface TuneRecord {
  stationId: string;
  /** From the command to the new picture on screen. */
  ms: number;
  /** Whether the station was warm when it was asked for. */
  warm: boolean;
}

export interface PlayerState {
  channels: Channel[];
  currentId: string | null;
  /** The station being tuned to while the old picture holds. */
  pendingId: string | null;
  /** The channel before this one (Last, and Back on the picture). */
  lastId: string | null;
  status: Status;
  error: string | null;
  muted: boolean;
  /** Autoplay with sound was refused; it's playing muted until a tap. */
  mutedByBrowser: boolean;
  paused: { since: number; expired: boolean } | null;
  captions: CaptionMode;
  captionSize: CaptionSize;
  banner: { stationId: string; until: number } | null;
  entry: NumberEntry | null;
  /** Warm neighbours and how ready each is, for the demo and tests. */
  warm: Array<{ stationId: string; state: string }>;
  lastTune: TuneRecord | null;
  sleep: { endsAt: number; fading: boolean } | null;
  /** Who changed the channel last, when the input says (a Cast sender). */
  changedBy: string | null;
  /** What the station's playlist says is on screen now (the bug, a lower third, a code, the item), for the picture on screen. */
  onScreen: (OnScreen & { stationId: string }) | null;
  /** Signed off by its stream (the playlist ended after the sign-off slate): when it's back, if said. */
  offAir: { stationId: string; backAt: string | null } | null;
}

export interface EngineOptions {
  driver?: MediaDriver;
  /** How to warm the neighbours: their playlists and first segment (default), playlists only, buffering near live, playing them hidden, or not at all. */
  warm?: WarmMode | "none";
  /** For pre-warming and checking whether a signed-off station is back (defaults to the global fetch). */
  fetch?: Fetch;
  neighbours?: NeighbourOptions;
  /** How long the banner stays up. */
  bannerMs?: number;
  /** How long number entry waits before tuning. */
  numberWaitMs?: number;
  /** How long a pause holds its place. */
  pauseHoldMs?: number;
  presets?: Record<number, string>;
  /** Picture quality, for the picture on screen and the warm neighbours (auto by default). */
  quality?: Quality;
  /** Even out the sound, so one station isn't much louder than the next (off by default). */
  eveningOut?: boolean;
  now?: () => number;
  /** Commands the player doesn't act on itself (guide, menu, presets, focus…), for the surface. */
  onCommand?: (command: Command, source?: CommandSource) => void;
}

const THIRTY_MINUTES = 30 * 60 * 1000;
/** How often what's on screen is checked against the playlist's tags. */
const ON_SCREEN_TICK_MS = 250;
/** After the back time, how often to look for the new playlist (doubling up to a minute). */
const BACK_RETRY_MS = 5_000;
const BACK_RETRY_MAX_MS = 60_000;
const SLEEP_FADE_MS = 60 * 1000;

/** Caption type as a share of the picture's width, per caption size (the player's --oc-cue). */
export const CAPTION_SCALE: Record<CaptionSize, number> = { small: 0.034, medium: 0.042, large: 0.054 };

/**
 * The caption line, counted from the bottom (negative), whose cue sits above the bottom
 * `liftPercent` of the picture: one caption line is the type size × 1.3 line height.
 */
export function captionLineFor(liftPercent: number, scale: number, aspect: number): number {
  const linePercent = scale * aspect * 1.3 * 100;
  return -(Math.ceil(liftPercent / linePercent) + 1);
}

export class PlayerEngine {
  private state: PlayerState;
  private listeners = new Set<() => void>();
  private decks = new Map<string, Deck>();
  private host: HTMLElement | null = null;
  private driver: MediaDriver;
  private o: Required<Omit<EngineOptions, "driver" | "onCommand" | "presets" | "fetch">> & Pick<EngineOptions, "onCommand">;
  private fetch: Fetch;
  private prefetches = new Map<string, Prefetch>();
  private presets: Record<number, string>;
  private timers = {
    banner: 0 as ReturnType<typeof setTimeout> | 0,
    entry: 0 as ReturnType<typeof setTimeout> | 0,
    pause: 0 as ReturnType<typeof setTimeout> | 0,
    sleep: 0 as ReturnType<typeof setInterval> | 0,
    onScreen: 0 as ReturnType<typeof setInterval> | 0,
    back: 0 as ReturnType<typeof setTimeout> | 0
  };
  private onScreenKey = "";
  private tuneSeq = 0;
  /** A tune asked for before the surface attached: it runs on attach. */
  private queuedTune: { stationId: string; source?: CommandSource } | null = null;
  private volume = 1;
  private audio = new AudioLevels();

  constructor(options: EngineOptions = {}) {
    this.driver = options.driver ?? defaultDriver();
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.o = {
      warm: options.warm ?? "prefetch",
      neighbours: options.neighbours ?? {},
      bannerMs: options.bannerMs ?? 5000,
      numberWaitMs: options.numberWaitMs ?? 2000,
      pauseHoldMs: options.pauseHoldMs ?? THIRTY_MINUTES,
      quality: options.quality ?? "auto",
      eveningOut: options.eveningOut ?? false,
      now: options.now ?? (() => Date.now()),
      onCommand: options.onCommand
    };
    this.presets = options.presets ?? {};
    this.audio.setEvenOut(this.o.eveningOut);
    this.state = {
      channels: [],
      currentId: null,
      pendingId: null,
      lastId: null,
      status: "idle",
      error: null,
      muted: false,
      mutedByBrowser: false,
      paused: null,
      captions: "off",
      captionSize: "medium",
      banner: null,
      entry: null,
      warm: [],
      lastTune: null,
      sleep: null,
      changedBy: null,
      onScreen: null,
      offAir: null
    };
  }

  // ---------- Store ----------

  getState = (): PlayerState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private patch(p: Partial<PlayerState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  private refreshWarm() {
    const warm = [
      ...[...this.decks.values()].filter((d) => d.role === "warm").map((d) => ({ stationId: d.stationId, state: d.state as string })),
      ...[...this.prefetches].map(([stationId, p]) => ({ stationId, state: p.state === "ready" ? "prefetched" : p.state }))
    ];
    this.patch({ warm });
  }

  // ---------- Setup ----------

  isAttached(): boolean {
    return this.host !== null;
  }

  /** Where the video elements live: the surface's picture box (or the provider's dock). */
  attach(host: HTMLElement) {
    this.host = host;
    for (const d of this.decks.values()) host.appendChild(d.video);
    if (this.queuedTune) {
      const { stationId, source } = this.queuedTune;
      this.queuedTune = null;
      void this.tune(stationId, source);
    }
  }

  setChannels(channels: Channel[]) {
    this.patch({ channels });
    const id = this.state.currentId;
    if (!id) return;
    // Off air by the dial, and the dial now says it's on: tune back in.
    const c = this.channel(id);
    if (this.state.status === "off_air" && !this.state.offAir && !this.state.pendingId && c?.onAir && c.playback?.kind === "hls") {
      void this.tune(id, { input: "return" }, true);
      return;
    }
    this.rewarm(id);
  }

  setPresets(presets: Record<number, string>) {
    this.presets = presets;
  }

  setOptions(p: Partial<Pick<EngineOptions, "bannerMs" | "numberWaitMs" | "warm" | "neighbours" | "quality" | "eveningOut">>) {
    const quality = p.quality !== undefined && p.quality !== this.o.quality;
    Object.assign(this.o, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
    // The picture on screen and the warm neighbours at once.
    if (quality) {
      for (const d of this.decks.values()) d.setQuality(this.o.quality);
      for (const p of this.prefetches.values()) p.setQuality(this.o.quality);
    }
    this.audio.setEvenOut(this.o.eveningOut);
    if (this.state.currentId) this.rewarm(this.state.currentId);
  }

  private channel(id: string | null): Channel | undefined {
    return id ? this.state.channels.find((c) => c.station.id === id) : undefined;
  }

  private deckFor(c: Channel): Deck | null {
    if (!this.host || c.playback?.kind !== "hls") return null;
    let d = this.decks.get(c.station.id);
    if (!d) {
      // A pre-warmed station starts on the segment already fetched, at its rendition.
      const start = this.prefetches.get(c.station.id)?.startHint() ?? null;
      d = new Deck({
        stationId: c.station.id,
        url: c.playback.url,
        host: this.host,
        driver: this.driver,
        quality: this.o.quality,
        start,
        fetch: this.fetch,
        onChange: () => this.refreshWarm(),
        onSignOff: (deck) => this.deckSignedOff(deck)
      });
      this.decks.set(c.station.id, d);
    }
    return d;
  }

  // ---------- Tuning ----------

  /** Tune to a station by id. The old picture stays until the new one has a frame on screen. */
  async tune(stationId: string, source?: CommandSource, again = false): Promise<void> {
    const c = this.channel(stationId);
    if (!c) return;
    this.clearEntry();
    if (source?.who) this.patch({ changedBy: source.who });
    // After stop() (the sleep timer), the same station tunes again from scratch; `again` is a
    // station coming back on air.
    if (!again && stationId === this.state.currentId && !this.state.pendingId && this.state.status !== "stopped") {
      this.showBanner();
      return;
    }
    const seq = ++this.tuneSeq;
    const t0 = performance.now();
    const previous = again ? this.state.lastId : this.state.currentId;
    this.showBanner(stationId);
    this.clearPause();
    this.clearBack();

    if (!c.onAir || !c.playback) {
      this.settle(stationId, previous, "off_air");
      return;
    }
    if (c.playback.kind === "embed") {
      this.settle(stationId, previous, "embed");
      return;
    }
    if (!this.host) {
      // The surface hasn't attached yet (its effect runs after the caller's): tune once it does.
      this.queuedTune = { stationId, source };
      this.patch({ pendingId: stationId });
      return;
    }
    const prefetched = this.prefetches.get(stationId);
    const deck = this.deckFor(c);
    if (!deck) return;
    const wasWarm = deck.state === "ready" || deck.state === "playing" || prefetched?.state === "ready";
    // On screen now, it's a deck of its own: the prefetch has done its job.
    if (prefetched) {
      prefetched.stop();
      this.prefetches.delete(stationId);
    }
    // The picture (or the off-air screen) on now stays until the new one is ready.
    this.patch({ pendingId: stationId, status: this.state.currentId ? this.state.status : "tuning", error: null });
    try {
      await deck.start();
      await deck.firstFrame();
    } catch (e) {
      if (seq !== this.tuneSeq) return;
      const err = e as Error;
      if (err instanceof SignedOffError) {
        // Its playlist had already ended: off air, with the back time the stream gives.
        this.dropDeck(stationId);
        this.settle(stationId, previous, "off_air");
        this.signedOff(stationId, err.backAt, deck.signedOff?.at ?? null);
        return;
      }
      if (err.name === "NotAllowedError") {
        // Autoplay with sound refused: it can still play muted until someone taps.
        this.patch({ mutedByBrowser: true });
      } else {
        this.patch({ pendingId: null, status: this.state.currentId ? this.state.status : "error", error: deck.error ?? err.message });
        // Coming back didn't work this time: keep looking.
        if (again && this.state.offAir?.stationId === stationId) this.signedOff(stationId, this.state.offAir.backAt, null);
        return;
      }
    }
    if (seq !== this.tuneSeq) return; // A newer tune took over.
    for (const d of this.decks.values()) if (d !== deck && d.role === "active") d.warm(this.o.warm === "play" ? "play" : "buffer");
    // A browser that only allows sound after a click on the page doesn't refuse the unmute: Chrome
    // just pauses the picture. That pause is undone: it plays on muted, with the "tap for sound"
    // prompt. (TVs' web views allow sound, so they're never muted for this.)
    deck.show(this.state.muted || this.state.mutedByBrowser);
    this.audio.measure(deck.video, this.driver.webAudio !== false);
    this.applyCaptions(deck);
    this.patch({ lastTune: { stationId, ms: Math.round(performance.now() - t0), warm: wasWarm } });
    this.settle(stationId, previous, "playing");
    if (!deck.video.muted) this.keepPlayingIfUnmutePaused(deck);
    this.watchOnScreen();
    this.mediaSession();
  }

  /** If unmuting paused it (no click on the page yet), play on muted with the prompt. */
  private keepPlayingIfUnmutePaused(deck: Deck) {
    const v = deck.video;
    const check = () => {
      if (!v.paused || v.muted || this.state.status === "paused" || this.active() !== deck) return;
      v.muted = true;
      void v.play().catch(() => {});
      this.patch({ mutedByBrowser: true });
    };
    v.addEventListener("pause", check, { once: true });
    setTimeout(() => v.removeEventListener("pause", check), 2000);
    check();
  }

  private settle(stationId: string, previous: string | null, status: Status) {
    if (status !== "playing") for (const d of this.decks.values()) if (d.role === "active") d.warm("buffer");
    if (status !== "playing") this.stopOnScreen();
    this.patch({
      currentId: stationId,
      pendingId: null,
      lastId: previous && previous !== stationId ? previous : this.state.lastId,
      status,
      offAir: null
    });
    this.rewarm(stationId);
  }

  /** Keep the neighbours warm; let go of every other deck. */
  private rewarm(currentId: string) {
    const keep = new Set<string>([currentId]);
    if (this.state.pendingId) keep.add(this.state.pendingId);
    const mode = this.o.warm;
    const warmable = mode === "none" ? [] : neighbours(this.state.channels, currentId, this.o.neighbours).filter((n) => n.onAir && n.playback?.kind === "hls");
    if (mode === "buffer" || mode === "play") {
      for (const n of warmable) {
        keep.add(n.station.id);
        const d = this.deckFor(n);
        if (d && d.role !== "active") d.warm(mode);
      }
    }
    for (const [id, d] of this.decks) {
      if (!keep.has(id)) {
        d.destroy();
        this.decks.delete(id);
      }
    }
    // Playlists and a first segment only: no <video> until it's tuned.
    const prefetch = new Set<string>();
    if (mode === "prefetch" || mode === "playlists") {
      for (const n of warmable) {
        const id = n.station.id;
        if (this.decks.has(id) || n.playback?.kind !== "hls") continue;
        prefetch.add(id);
        if (!this.prefetches.has(id)) {
          this.prefetches.set(id, new Prefetch({ url: n.playback.url, quality: this.o.quality, fetch: this.fetch, segment: mode === "prefetch", onChange: () => this.refreshWarm() }));
        }
      }
    }
    for (const [id, p] of this.prefetches) {
      if (!prefetch.has(id)) {
        p.stop();
        this.prefetches.delete(id);
      }
    }
    this.refreshWarm();
  }

  private dropDeck(stationId: string) {
    const d = this.decks.get(stationId);
    if (!d) return;
    d.destroy();
    this.decks.delete(stationId);
  }

  // ---------- What's on screen (the playlist's tags) ----------

  /** Follows the tags for the picture on screen: patches onScreen when anything drawn changes. */
  private watchOnScreen() {
    this.stopOnScreen();
    const tick = () => {
      const d = this.active();
      if (!d || d.role !== "active") return;
      const os = d.onScreen();
      const key = `${d.stationId}|${onScreenKey(os)}`;
      if (key === this.onScreenKey) return;
      this.onScreenKey = key;
      this.patch({ onScreen: { ...os, stationId: d.stationId } });
    };
    tick();
    this.timers.onScreen = setInterval(tick, ON_SCREEN_TICK_MS);
  }

  private stopOnScreen() {
    if (this.timers.onScreen) clearInterval(this.timers.onScreen);
    this.timers.onScreen = 0;
    this.onScreenKey = "";
    if (this.state.onScreen) this.patch({ onScreen: null });
  }

  // ---------- Sign-off (the playlist ends after the slate) and coming back ----------

  private deckSignedOff(d: Deck) {
    // A tune still waiting on it hears through firstFrame (SignedOffError).
    if (d.stationId !== this.state.currentId || d.stationId === this.state.pendingId) return;
    if (this.state.status !== "playing" && this.state.status !== "paused") return;
    this.dropDeck(d.stationId);
    this.clearPause();
    this.patch({ status: "off_air" });
    this.stopOnScreen();
    this.signedOff(d.stationId, d.signedOff?.backAt ?? null, d.signedOff?.at ?? null);
    this.rewarm(d.stationId);
  }

  /**
   * Off air until the back time, then look for the new playlist and tune back in. The wait is
   * counted on the stream's own clock (its program date-time when it signed off), so a device
   * clock that's off doesn't move it; after the back time it looks again every few seconds.
   */
  private signedOff(stationId: string, backAt: string | null, streamNow: number | null) {
    this.patch({ offAir: { stationId, backAt } });
    const back = backAt ? Date.parse(backAt) : NaN;
    const wait = Number.isNaN(back) ? BACK_RETRY_MAX_MS : Math.max(0, back - (streamNow ?? this.o.now()));
    let retry = BACK_RETRY_MS;
    const look = async () => {
      if (!this.stillOffAir(stationId)) return;
      const url = this.channel(stationId)?.playback?.url;
      const live = url ? await isLive(this.fetch, url) : false;
      if (!this.stillOffAir(stationId)) return;
      if (live) void this.tune(stationId, { input: "return" }, true);
      else {
        this.timers.back = setTimeout(() => void look(), retry);
        retry = Math.min(retry * 2, BACK_RETRY_MAX_MS);
      }
    };
    this.clearBack();
    this.timers.back = setTimeout(() => void look(), wait);
  }

  private stillOffAir(stationId: string) {
    return this.state.currentId === stationId && this.state.status === "off_air" && this.state.offAir?.stationId === stationId && !this.state.pendingId;
  }

  private clearBack() {
    if (this.timers.back) clearTimeout(this.timers.back);
    this.timers.back = 0;
  }

  channelStep(dir: "up" | "down", source?: CommandSource) {
    const from = this.state.pendingId ?? this.state.currentId;
    const next = neighbour(this.state.channels, from, dir, this.o.neighbours);
    if (next) void this.tune(next.station.id, source);
  }

  last(source?: CommandSource) {
    if (this.state.lastId) void this.tune(this.state.lastId, source);
  }

  // ---------- Banner ----------

  showBanner(stationId = this.state.pendingId ?? this.state.currentId ?? undefined) {
    if (!stationId) return;
    if (this.timers.banner) clearTimeout(this.timers.banner);
    const until = this.o.now() + this.o.bannerMs;
    this.patch({ banner: { stationId, until } });
    this.timers.banner = setTimeout(() => this.patch({ banner: null }), this.o.bannerMs);
  }

  /** Paused: the banner shows, as it does on tuning in, and stays until playing again. */
  private holdBanner() {
    const stationId = this.state.currentId;
    if (!stationId) return;
    if (this.timers.banner) clearTimeout(this.timers.banner);
    this.timers.banner = 0;
    this.patch({ banner: { stationId, until: this.o.now() + this.o.bannerMs } });
  }

  hideBanner() {
    if (this.timers.banner) clearTimeout(this.timers.banner);
    this.patch({ banner: null });
  }

  // ---------- Number entry ----------

  private typeInto(key: number | ".") {
    const typed = typeKey(this.state.entry?.typed ?? "", key);
    if (typed === null) return;
    const entry = readEntry(typed, this.state.channels);
    this.patch({ entry });
    if (this.timers.entry) clearTimeout(this.timers.entry);
    this.timers.entry = setTimeout(() => this.commitEntry(), this.o.numberWaitMs);
  }

  /** Tune what's typed now (OK), or leave it on screen saying there's no station. */
  commitEntry(source?: CommandSource) {
    const entry = this.state.entry;
    if (!entry) return;
    if (this.timers.entry) clearTimeout(this.timers.entry);
    if (entry.match) void this.tune(entry.match.station.id, source);
    else {
      // "No station on 13", with the nearest two, then it goes and the channel stays.
      this.timers.entry = setTimeout(() => this.clearEntry(), this.o.bannerMs);
    }
  }

  clearEntry() {
    if (this.timers.entry) clearTimeout(this.timers.entry);
    if (this.state.entry) this.patch({ entry: null });
  }

  // ---------- Pause ----------

  private active(): Deck | undefined {
    return this.state.currentId ? this.decks.get(this.state.currentId) : undefined;
  }

  pause() {
    const d = this.active();
    if (!d || this.state.status !== "playing") return;
    d.video.pause();
    this.patch({ status: "paused", paused: { since: this.o.now(), expired: false } });
    this.holdBanner();
    if (this.timers.pause) clearTimeout(this.timers.pause);
    // After the hold the player offers Back to live rather than piling up a delay.
    this.timers.pause = setTimeout(() => this.state.paused && this.patch({ paused: { ...this.state.paused, expired: true } }), this.o.pauseHoldMs);
    this.mediaSession();
  }

  play() {
    const d = this.active();
    if (!d) return;
    if (this.state.paused?.expired) return this.backToLive();
    this.clearPause();
    // If the paused moment has scrolled out of what the stream still keeps, move forward to the
    // oldest moment it has: as close to where you paused as the stream allows.
    const v = d.video;
    if (v.seekable.length) {
      const oldest = v.seekable.start(0);
      if (v.currentTime < oldest + 1) v.currentTime = oldest + 2;
    }
    void v.play().catch(() => {});
    this.patch({ status: "playing" });
    // The banner held while paused goes after the usual time.
    if (this.state.banner) this.showBanner();
    this.mediaSession();
  }

  togglePlay() {
    if (this.state.status === "paused") this.play();
    else this.pause();
  }

  backToLive() {
    const d = this.active();
    if (!d) return;
    this.clearPause();
    d.joinLive(0);
    void d.video.play().catch(() => {});
    this.patch({ status: "playing" });
    this.showBanner();
  }

  private clearPause() {
    if (this.timers.pause) clearTimeout(this.timers.pause);
    if (this.state.paused) this.patch({ paused: null });
  }

  // ---------- Sound and captions ----------

  setMuted(muted: boolean) {
    if (!muted) this.audio.unlock();
    const d = this.active();
    if (d) d.video.muted = muted;
    this.patch({ muted, mutedByBrowser: false });
    if (d) this.applyCaptions(d);
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    const d = this.active();
    if (d) d.video.volume = this.volume;
  }

  setCaptions(mode: CaptionMode, size?: CaptionSize) {
    this.patch({ captions: mode, captionSize: size ?? this.state.captionSize });
    const d = this.active();
    if (d) this.applyCaptions(d);
  }

  private captionLift: number | null = null;

  /**
   * Lift the captions clear of whatever covers the bottom `percent` of the picture (the TV's
   * banner, the presets strip), or null for the stream's own place.
   */
  setCaptionLift(percent: number | null) {
    this.captionLift = percent;
    const d = this.active();
    if (d) d.setCueLine(this.cueLine(d));
  }

  private graphicsLift: number | null = null;

  /**
   * Lift the captions clear of the station's graphics at the bottom of the picture (a lower third,
   * or a spot's code) while they show: the bottom `percent` they cover, or null. The surface
   * measures it; the higher of this and setCaptionLift's wins.
   */
  setGraphicsLift(percent: number | null) {
    const p = percent === null ? null : Math.round(percent);
    if (p === this.graphicsLift) return;
    this.graphicsLift = p;
    const d = this.active();
    if (d) d.setCueLine(this.cueLine(d));
  }

  /** What the captions clear now: the higher of the surface's lift and the graphics', or null. */
  captionLiftNow(): number | null {
    if (this.captionLift === null && this.graphicsLift === null) return null;
    return Math.max(this.captionLift ?? 0, this.graphicsLift ?? 0);
  }

  /** The caption line (from the bottom) that clears the lift, at the caption size in use. */
  private cueLine(d: Deck): number | null {
    const lift = this.captionLiftNow();
    if (lift === null) return null;
    const v = d.video;
    const aspect = v.clientWidth && v.clientHeight ? v.clientWidth / v.clientHeight : 16 / 9;
    return captionLineFor(lift, CAPTION_SCALE[this.state.captionSize], aspect);
  }

  private applyCaptions(d: Deck) {
    d.setCueLine(this.cueLine(d));
    const { captions, muted, mutedByBrowser } = this.state;
    d.setCaptions(captions === "on" || (captions === "muted_only" && (muted || mutedByBrowser)));
  }

  // ---------- Sleep timer ----------

  /** Stop at a time: "end_of_program" (the default people mean), minutes from now, or null to cancel. */
  sleep(until: "end_of_program" | number | null) {
    if (this.timers.sleep) clearInterval(this.timers.sleep);
    const d = this.active();
    if (d) d.video.volume = this.volume;
    if (until === null) return this.patch({ sleep: null });
    const now = this.o.now();
    const endsAt = until === "end_of_program" ? Date.parse(this.channel(this.state.currentId)?.now?.endsAt ?? "") || now : now + until * 60_000;
    this.patch({ sleep: { endsAt, fading: false } });
    this.timers.sleep = setInterval(() => {
      const left = endsAt - this.o.now();
      const deck = this.active();
      if (left <= 0) {
        clearInterval(this.timers.sleep as ReturnType<typeof setInterval>);
        this.stop();
      } else if (left <= SLEEP_FADE_MS) {
        // The sound fades over the last minute, with a notice offering 30 more minutes.
        if (deck) deck.video.volume = this.volume * (left / SLEEP_FADE_MS);
        if (!this.state.sleep?.fading) this.patch({ sleep: { endsAt, fading: true } });
      }
    }, 1000);
  }

  /** The app stops itself: on a TV app it returns to the TV's home; casting, the stream ends. */
  stop() {
    for (const d of this.decks.values()) d.destroy();
    this.decks.clear();
    for (const p of this.prefetches.values()) p.stop();
    this.prefetches.clear();
    this.stopOnScreen();
    this.clearBack();
    this.patch({ status: "stopped", sleep: null, banner: null, warm: [], offAir: null });
  }

  // ---------- Commands ----------

  /** Acts on a command from any input. Commands the player doesn't own go to onCommand. */
  handle(command: Command, source?: CommandSource): void {
    // A command means someone's there: let sound run through the level meter.
    this.audio.unlock();
    // Any press during the sleep fade cancels the timer.
    if (this.state.sleep?.fading && command.type !== "sleep") this.sleep(null);
    switch (command.type) {
      case "channel":
        return this.channelStep(command.dir, source);
      case "digit":
        return this.typeInto(command.digit);
      case "dot":
        return this.typeInto(".");
      case "select":
        if (this.state.entry) return this.commitEntry(source);
        // On the picture, OK shows the banner; OK again (while it's up) opens the guide.
        if (!this.state.banner) return this.showBanner();
        this.hideBanner();
        return this.o.onCommand?.({ type: "guide" }, source);
      case "tune": {
        const c = findByChannel(this.state.channels, command.channel);
        if (c) void this.tune(c.station.id, source);
        return;
      }
      case "preset": {
        const id = this.presets[command.key];
        if (id) void this.tune(id, source);
        return;
      }
      case "last":
        return this.last(source);
      case "back":
        if (this.state.entry) return this.clearEntry();
        break;
      case "info":
        return this.showBanner();
      case "pause":
        return this.pause();
      case "play":
        return this.play();
      case "togglePlay":
        return this.togglePlay();
      case "backToLive":
        return this.backToLive();
      case "sleep":
        return this.sleep(command.until);
    }
    this.o.onCommand?.(command, source);
  }

  // ---------- Lock screen ----------

  private mediaSession() {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const c = this.channel(this.state.currentId);
    if (!c) return;
    const ident = [c.station.callSign, c.station.channel].filter(Boolean).join(" ");
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: c.now?.title ?? c.station.name, artist: ident, album: c.station.name });
      navigator.mediaSession.playbackState = this.state.status === "paused" ? "paused" : "playing";
    } catch {
      // Some browsers have mediaSession without MediaMetadata.
    }
  }

  /** Real sound levels for the meter (0 to 1 each), or null where they can't be measured. */
  audioLevels(bars: number): number[] | null {
    return this.state.status === "playing" ? this.audio.levels(bars) : null;
  }

  /** Whether the sound on screen runs through Web Audio (measured, and evened out when that's on). */
  soundRouted(): boolean {
    return this.audio.routed();
  }

  /** The <video> on screen, for the heartbeat's media time. */
  mediaTimeMs(): number {
    const d = this.active();
    return d ? Math.round(d.video.currentTime * 1000) : 0;
  }

  destroy() {
    Object.values(this.timers).forEach((t) => t && clearTimeout(t as ReturnType<typeof setTimeout>));
    if (this.timers.sleep) clearInterval(this.timers.sleep);
    if (this.timers.onScreen) clearInterval(this.timers.onScreen);
    for (const d of this.decks.values()) d.destroy();
    this.decks.clear();
    for (const p of this.prefetches.values()) p.stop();
    this.prefetches.clear();
    this.listeners.clear();
  }
}
