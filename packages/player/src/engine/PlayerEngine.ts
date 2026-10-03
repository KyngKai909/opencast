// The player, without a framework: the one the viewer app, TV mode and the Cast receiver share.
//
// - Tuning joins live, mid-program. There's no seeking.
// - A channel change keeps the old picture (and sound) until the new one has a frame on screen.
//   Changing channel (follow-up Phase 5, tuning/): the new channel's number shows at once and soft
//   static covers the old picture (muted) for at least 300 ms and until the first frame, "Tuning
//   in" after 800 ms, Stand by with the colour bars after 8 s whatever the reason; then the
//   static rolls away and the banner slides in. Reduced motion: a crossfade. The radio band: the
//   needle sweeps, with a soft hiss. Repeated presses load only the channel the viewer lands on.
// - The neighbouring channels are warm (their playlists and first segment), so up and down are quick.
// - The station's bug, lower thirds and a spot's code and QR are drawn over the picture, timed
//   from the playlist's DATERANGE tags against the media's program date-time (onScreen).
// - Items join without a glitch (hls.js's join settings, driver.ts). A playlist that ends after the
//   sign-off slate puts the station off air with its back time, and it tunes back in when a new
//   playlist appears.
// - Every change shows the banner for five seconds (a setting on TV).
// - Pause holds your place for up to 30 minutes, then offers Back to live. From a pause until Back
//   to live (or a tune), the picture is behind live (behindLive), resumed or not.
// - Number entry: 1, 2 tunes 12.1 after a short wait, or at once on OK.
// - Captions, with the size setting; a sleep timer that fades the sound over its last minute.
// - Picture quality (auto, data saver, best) and evening out the sound, settings on TV.
// - AirPlay (Safari): offered while an AirPlay TV is around; the picture on screen plays on the TV
//   by itself (the stream, not the phone's screen). Only the deck on screen is ever a candidate.
// - DASH stream links (A201, dash.ts): dash.js, loaded only when one is tuned; never warmed. A
//   device that can't play DASH skips those stations in the swipe order, and says so on one tuned
//   directly (status "unplayable").
// - Direct mode (A239, the native apps only, direct.ts): an external stream link with
//   `playback.sourceUrl` is fetched with the device's own networking first (no Origin, cookies or
//   Referer; http allowed), and falls back to `playback.url` (the relay's, or the same address)
//   on an error or no first frame in DIRECT_FIRST_FRAME_MS. Stand by is still at 8 s.
// - The swipe home (A245, the phone and tablet app): channel up and down follow the swipe's order
//   (setOrder: presets, then the dial), the stations kept warm are its next and previous (and the
//   dial's first while in the presets), a swipe that showed a ready picture changes channel without
//   static (swipeTo), and the next picture can be shown beside this one while the finger drags (peek).
//
// Surfaces read its state (subscribe/getState) and send it commands (handle).

import type { Channel, Command, CommandSource } from "../types";
import { findByChannel, neighbour, neighbours, type NeighbourOptions } from "../dial";
import { preloadIds, stepId, type OrderIds } from "../order";
import { readEntry, typeKey, type NumberEntry } from "../numberEntry";
import { Deck, SignedOffError, type WarmMode } from "./Deck";
import { defaultDriver, hlsDriver, nativeDriver, type MediaDriver, type Quality } from "./driver";
import { dashSupport, defaultDashDriver, isDash, type DashSupport } from "./dash";
import { directLoader, directUrlOf, type DirectTransport } from "./direct";
import { AudioLevels } from "./meter";
import { isLive, Prefetch, type Fetch } from "./playlist";
import { onScreenKey, type OnScreen } from "./timeline";
import { ChannelChange, type TuningLook, type TuningState } from "../tuning/change";
import { DIRECT_FIRST_FRAME_MS, LAND_MS, REBUILD_AFTER_MS, RETRY_FIRST_MS, RETRY_MAX_MS } from "../tuning/constants";
import { Hiss, hissAllowed, pageHasBeenActive } from "../tuning/hiss";
import { frequencyOf } from "../tuning/sweep";

export type CaptionMode = "off" | "on" | "muted_only";

export type CaptionSize = "small" | "medium" | "large";
/**
 * `standby`: a channel change that got no picture in 8 s (the playlist, the network or the
 * browser), shown as Stand by with the colour bars; the player keeps trying and plays as soon as
 * a picture comes. `unplayable` (A201): a DASH stream link on a device that can't play DASH (an
 * iPhone before iOS 17.1); it says so, and nothing loads.
 */
export type Status = "idle" | "tuning" | "playing" | "paused" | "off_air" | "embed" | "standby" | "unplayable" | "error" | "stopped";

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
  /**
   * Behind live: from a pause until Back to live, a tune or a channel change, paused or playing
   * again (play resumes where it paused). Cleared too if the picture catches up to the live edge
   * by itself (where the driver knows the edge).
   */
  behindLive: boolean;
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
  /**
   * AirPlay (Safari only): an AirPlay TV is around to offer (`available`), and the picture is
   * playing on one now (`active`). WebKit doesn't say which TV.
   */
  airPlay: { available: boolean; active: boolean };
  /** Changing channel: the static (or the crossfade, or the radio band's needle) and the corner number, or null. */
  tuning: TuningState | null;
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
  /** AirPlay: the driver a picture on hls.js switches to (the browser's own HLS, by default). */
  airPlayDriver?: MediaDriver;
  /** DASH stream links (A201): the driver (dash.js loaded on demand, or the browser's own DASH where it truly has it). */
  dashDriver?: MediaDriver;
  /** Whether this device can play DASH (detected by default). */
  dashSupport?: () => DashSupport;
  /**
   * A239, direct mode: how the native app fetches an address with the device's own networking
   * (the Android apps give one; browsers, Cast and the iPhone don't). With it, an external stream
   * link's `playback.sourceUrl` is tried first, and `playback.url` is the fallback.
   */
  direct?: DirectTransport | null;
  /** The driver for direct mode's pictures (tests); hls.js loading through `direct` by default. */
  directDriver?: MediaDriver;
  /**
   * "Tuning sound": a soft hiss while changing channel, per band. On for the radio band and off for
   * video unless the viewer changes it. It plays only after the viewer has interacted, and not while muted.
   */
  tuningSound?: Partial<TuningSound>;
  /**
   * Reduced motion: the channel change crossfades instead of showing static, and the needle jumps.
   * Defaults to the system setting (prefers-reduced-motion) or the app's "Reduce motion"
   * (data-motion="reduce" on <html>), read at each press.
   */
  reducedMotion?: () => boolean;
}

/** The system's or the app's "Reduce motion". */
export function prefersReducedMotion(): boolean {
  if (typeof document !== "undefined" && document.documentElement?.dataset?.motion === "reduce") return true;
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Whether changing channel makes the soft hiss, on the video (TV) band and on the radio band. */
export interface TuningSound {
  video: boolean;
  radio: boolean;
}

/** The hiss is on by default for the radio band, off for video (style guide, "Tuning the radio band"). */
// On for both bands by default (the user's decision, 2026-10-01; Phase 5 had video off).
export const TUNING_SOUND_DEFAULTS: Readonly<TuningSound> = Object.freeze({ video: true, radio: true });

/**
 * The account's watching settings as the player's option: `tuningSound` is the row in Watching
 * settings and TV settings (video), `radioTuningSound` the radio band's own switch. Absent: the defaults.
 */
export function tuningSoundFrom(w: { tuningSound?: boolean; radioTuningSound?: boolean } | null | undefined): TuningSound {
  return {
    video: w?.tuningSound ?? TUNING_SOUND_DEFAULTS.video,
    radio: w?.radioTuningSound ?? TUNING_SOUND_DEFAULTS.radio
  };
}

const THIRTY_MINUTES = 30 * 60 * 1000;

/** A partial option without its undefined keys, so they don't overwrite what's set. */
function definedOnly<T extends object>(o: T | undefined): Partial<T> {
  return o ? (Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>) : {};
}
/** How often what's on screen is checked against the playlist's tags. */
const ON_SCREEN_TICK_MS = 250;
/** After the back time, how often to look for the new playlist (doubling up to a minute). */
const BACK_RETRY_MS = 5_000;
const BACK_RETRY_MAX_MS = 60_000;
const SLEEP_FADE_MS = 60 * 1000;
/** Within this many seconds of the live sync point, a resumed picture counts as live again. */
const NEAR_LIVE_S = 4;

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
  private o: Required<Omit<EngineOptions, "driver" | "onCommand" | "presets" | "fetch" | "airPlayDriver" | "tuningSound" | "dashDriver" | "dashSupport" | "direct" | "directDriver">> & Pick<EngineOptions, "onCommand"> & { tuningSound: TuningSound };
  /** DASH (A201): made the first time a DASH station is tuned, so an HLS viewer never loads it. */
  private dashDriver: MediaDriver | null;
  private dashSupportFn: () => DashSupport;
  private dashSupportNow: DashSupport | null = null;
  /** A239: the native app's direct transport, and the driver over it (made on first use). */
  private direct: DirectTransport | null;
  private directDriver: MediaDriver | null;
  /**
   * A239: stations whose direct attempt failed in this round of loading: their next picture loads
   * the listed address. Cleared by a new tune and after each wait between rounds, so every round
   * tries the source's own address first.
   */
  private viaListed = new Set<string>();
  /** Changing channel: the static's timing, Stand by at 8 s, and the photosensitivity guard. */
  private change: ChannelChange;
  private hiss: Hiss;
  /** Someone has pressed, clicked or tapped (a command, or sound turned on): the hiss may play. */
  private interacted = false;
  /** The banner waits for the static to clear (it comes after, sliding in). */
  private bannerAfterChange = false;
  private airPlayDriver: MediaDriver;
  /** A video element with no stream, listening for AirPlay TVs coming and going (Safari). */
  private airPlayProbe: HTMLVideoElement | null = null;
  private wirelessOff: (() => void) | null = null;
  private fetch: Fetch;
  private prefetches = new Map<string, Prefetch>();
  private presets: Record<number, string>;
  private timers = {
    banner: 0 as ReturnType<typeof setTimeout> | 0,
    entry: 0 as ReturnType<typeof setTimeout> | 0,
    pause: 0 as ReturnType<typeof setTimeout> | 0,
    sleep: 0 as ReturnType<typeof setInterval> | 0,
    onScreen: 0 as ReturnType<typeof setInterval> | 0,
    back: 0 as ReturnType<typeof setTimeout> | 0,
    /** Repeated presses: the wait before loading the channel landed on, and a retry after a failure. */
    land: 0 as ReturnType<typeof setTimeout> | 0
  };
  private onScreenKey = "";
  private tuneSeq = 0;
  /** swipe home 08: the phone and tablet app's order, per band (null: channel order). */
  private orders: OrderIds[] | null = null;
  /** swipe home 08: the next tune is a swipe that already showed this station's picture. */
  private swiped: string | null = null;
  /** A tune asked for before the surface attached: it runs on attach. */
  private queuedTune: { stationId: string; source?: CommandSource } | null = null;
  /**
   * An external station on screen whose stream went down (follow-up Phase 6): it left the dial, or
   * its row says it isn't playable. It's on Stand by until it's back, then it tunes in again.
   */
  private downId: string | null = null;
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
      tuningSound: { ...TUNING_SOUND_DEFAULTS, ...definedOnly(options.tuningSound) },
      reducedMotion: options.reducedMotion ?? prefersReducedMotion,
      now: options.now ?? (() => Date.now()),
      onCommand: options.onCommand
    };
    this.presets = options.presets ?? {};
    this.airPlayDriver = options.airPlayDriver ?? nativeDriver();
    this.dashDriver = options.dashDriver ?? null;
    this.dashSupportFn = options.dashSupport ?? dashSupport;
    this.direct = options.direct ?? null;
    this.directDriver = options.directDriver ?? null;
    this.audio.setEvenOut(this.o.eveningOut);
    this.hiss = new Hiss(() => this.audio.context());
    this.change = new ChannelChange({
      onChange: (tuning) => this.patch({ tuning }),
      onStandby: (stationId) => this.standBy(stationId),
      onCleared: (stationId, _look, fromStandby) => {
        // The banner slides in once the static has cleared (or a picture replaced Stand by).
        if ((this.bannerAfterChange || fromStandby) && stationId === this.state.currentId) this.showBanner(stationId);
        this.bannerAfterChange = false;
      }
    });
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
      behindLive: false,
      captions: "off",
      captionSize: "medium",
      banner: null,
      entry: null,
      warm: [],
      lastTune: null,
      sleep: null,
      changedBy: null,
      onScreen: null,
      offAir: null,
      airPlay: { available: false, active: false },
      tuning: null
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
    this.probeAirPlay(host);
    if (this.queuedTune) {
      const { stationId, source } = this.queuedTune;
      this.queuedTune = null;
      void this.tune(stationId, source);
    }
  }

  setChannels(channels: Channel[]) {
    const id = this.state.currentId;
    const showing = this.channel(id);
    const watching = this.state.status !== "idle" && this.state.status !== "stopped";
    if (id && showing && watching && showing.station.kind === "listed" && !channels.some((c) => c.station.id === id)) {
      // An external station left the dial while it's on (its stream is down): it stays on the
      // player's list only while you're on it (for its Stand by, and to change channel from), and
      // is on Stand by until the dial has it again.
      this.patch({ channels: [...channels, { ...showing, onAir: false, playback: null }] });
      this.externalDown(id);
      return;
    }
    this.patch({ channels });
    if (!id) return;
    // Off air by the dial, and the dial now says it's on: tune back in.
    const c = this.channel(id);
    if (c?.station.kind === "listed") {
      const playable = c.onAir && !!c.playback;
      if (!playable && watching) return this.externalDown(id);
      if (playable && this.downId === id) {
        // Back: it tunes in again, as a station coming back does (no static).
        this.downId = null;
        void this.tune(id, { input: "return" }, true);
        return;
      }
    }
    if (this.state.status === "off_air" && !this.state.offAir && !this.state.pendingId && c?.onAir && c.playback?.kind === "hls") {
      void this.tune(id, { input: "return" }, true);
      return;
    }
    this.rewarm(id);
  }

  /**
   * Whether changing channel to this station makes the tuning hiss: its band's "Tuning sound"
   * (a station with no band counts as video).
   */
  tuningSoundOn(stationId: string | null = this.state.pendingId ?? this.state.currentId): boolean {
    const band = this.channel(stationId)?.station.band;
    return band === "radio" ? this.o.tuningSound.radio : this.o.tuningSound.video;
  }

  /** The "Tuning sound" settings the player has, per band. */
  getTuningSound(): TuningSound {
    return { ...this.o.tuningSound };
  }

  setPresets(presets: Record<number, string>) {
    this.presets = presets;
  }

  /**
   * swipe home 08, "Order": the phone and tablet app's order, one per band (presets in preset
   * order, then the rest of the band in channel order). Channel up and down and the warm stations
   * follow it; with none (the web, TV mode, the Cast receiver) they follow channel order.
   */
  setOrder(orders: OrderIds[] | null) {
    this.orders = orders && orders.length ? orders : null;
    const id = this.state.currentId;
    if (id) this.rewarm(id);
  }

  private orderOf(id: string | null): OrderIds | null {
    return (id && this.orders?.find((o) => o.ids.includes(id))) || null;
  }

  /** In the order, the stations this device leaves out (DASH where it can't play it, A226), as in channel order. */
  private skipInOrder = (id: string): boolean => {
    const c = this.channel(id);
    if (!c) return true;
    const o = this.swipe();
    return (!!o.skipDash && c.playback?.format === "dash") || (!!o.skipListed && c.playback?.kind === "embed");
  };

  /** The station one step up (next) or down (previous): along the swipe's order where there is one, else in channel order. */
  stepFrom(from: string | null, dir: "up" | "down"): Channel | null {
    const o = this.orderOf(from);
    if (!o) return neighbour(this.state.channels, from, dir, this.swipe());
    const id = stepId(o, from, dir === "up" ? "next" : "prev", this.skipInOrder);
    return id ? (this.channel(id) ?? null) : null;
  }

  /** The stations to keep warm around this one. */
  private warmAround(currentId: string): Channel[] {
    const o = this.orderOf(currentId);
    if (!o) return neighbours(this.state.channels, currentId, this.swipe());
    return preloadIds(o, currentId, this.skipInOrder).flatMap((id) => this.channel(id) ?? []);
  }

  /**
   * swipe home 08: whether a swipe to this station can show it at once: its warm picture has a
   * frame, or it's off air (its off-air screen is what shows).
   */
  swipeReady(stationId: string): boolean {
    const c = this.channel(stationId);
    if (!c) return false;
    if (!c.onAir || !c.playback) return c.station.kind !== "listed";
    const d = this.decks.get(stationId);
    return !!d && d.role === "warm" && (d.state === "ready" || d.state === "playing");
  }

  /**
   * swipe home 01: while the finger drags, the next station's warm picture shows beside the one on
   * screen (the surface places it with --oc-peek-y). Null puts it away. True when there's a picture.
   */
  peek(stationId: string | null): boolean {
    for (const d of this.decks.values()) if (d.stationId !== stationId) d.setPeek(false);
    if (!stationId || !this.swipeReady(stationId)) return false;
    const d = this.decks.get(stationId);
    d?.setPeek(true);
    return !!d;
  }

  /**
   * swipe home 08, "Static on a swipe": a swipe that already showed the station's picture changes
   * channel without the static and its 300 ms minimum (the 300 ms is for buttons, remotes and
   * number entry); the banner follows. One that wasn't ready changes channel as usual, the static
   * staying until its first frame. Reduced motion keeps its crossfade, the radio band its needle.
   */
  swipeTo(stationId: string, source?: CommandSource): Promise<void> {
    this.swiped = this.swipeReady(stationId) ? stationId : null;
    return this.tune(stationId, source);
  }

  /**
   * swipe home 08, "Sound" (Muted previews): plays on muted, with "Tap for sound", until the first
   * tap, as when a browser refuses sound.
   */
  holdSound() {
    if (this.state.muted || this.state.mutedByBrowser) return;
    const d = this.active();
    if (d) d.video.muted = true;
    this.patch({ mutedByBrowser: true });
  }

  setOptions(p: Partial<Pick<EngineOptions, "bannerMs" | "numberWaitMs" | "warm" | "neighbours" | "quality" | "eveningOut" | "tuningSound">>) {
    const quality = p.quality !== undefined && p.quality !== this.o.quality;
    const { tuningSound, ...rest } = p;
    Object.assign(this.o, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
    if (tuningSound) this.o.tuningSound = { ...this.o.tuningSound, ...definedOnly(tuningSound) };
    // The picture on screen and the warm neighbours at once.
    if (quality) {
      for (const d of this.decks.values()) d.setQuality(this.o.quality);
      for (const p of this.prefetches.values()) p.setQuality(this.o.quality);
    }
    this.audio.setEvenOut(this.o.eveningOut);
    // Tuning sound alone changes nothing that's warm.
    if (this.state.currentId && Object.keys(rest).length) this.rewarm(this.state.currentId);
  }

  private channel(id: string | null): Channel | undefined {
    return id ? this.state.channels.find((c) => c.station.id === id) : undefined;
  }

  /** Whether this device can play DASH at all (asked once). */
  canPlayDash(): boolean {
    this.dashSupportNow ??= this.dashSupportFn();
    return this.dashSupportNow !== "none";
  }

  /** The swipe order's options: DASH stations are skipped where they can't play (A226). */
  private swipe(): NeighbourOptions {
    return this.canPlayDash() ? this.o.neighbours : { ...this.o.neighbours, skipDash: true };
  }

  /** The driver for a station's picture: DASH through dash.js (made on first use), else HLS. */
  private driverFor(c: Channel): MediaDriver {
    if (!isDash(c)) return this.driver;
    this.dashDriver ??= defaultDashDriver(this.dashSupportNow ?? this.dashSupportFn());
    return this.dashDriver;
  }

  /**
   * A239: the address direct mode loads for this station now (its stream link's own, `sourceUrl`),
   * or null: no transport (a browser), not an external stream link, DASH, or its direct attempt
   * failed this round.
   */
  private directAddress(c: Channel): string | null {
    if (!this.direct || this.viaListed.has(c.station.id)) return null;
    return directUrlOf(c);
  }

  private directDriverNow(): MediaDriver {
    this.directDriver ??= hlsDriver({ loader: directLoader(this.direct!), name: "hls.js direct" });
    return this.directDriver;
  }

  private deckFor(c: Channel): Deck | null {
    if (!this.host || c.playback?.kind !== "hls") return null;
    let d = this.decks.get(c.station.id);
    if (!d) {
      const direct = this.directAddress(c);
      // A pre-warmed station starts on the segment already fetched, at its rendition.
      const start = direct ? null : (this.prefetches.get(c.station.id)?.startHint() ?? null);
      d = new Deck({
        stationId: c.station.id,
        url: direct ?? c.playback.url,
        host: this.host,
        driver: direct ? this.directDriverNow() : this.driverFor(c),
        direct: !!direct,
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

  /**
   * Tune to a station by id. The old picture stays (muted, under the static) until the new one has
   * a frame on screen; with no frame in 8 s, whatever the reason, it's Stand by, and the player
   * keeps trying.
   */
  async tune(stationId: string, source?: CommandSource, again = false): Promise<void> {
    const c = this.channel(stationId);
    if (!c) return;
    this.clearEntry();
    if (stationId !== this.downId) this.downId = null;
    // A239: a new tune tries the source's own address first again (direct mode).
    if (!again) this.viaListed.delete(stationId);
    if (source?.who) this.patch({ changedBy: source.who });
    // After stop() (the sleep timer), the same station tunes again from scratch; `again` is a
    // station coming back on air (or Stand by trying again).
    if (!again && stationId === this.state.currentId && !this.state.pendingId && this.state.status !== "stopped" && this.state.status !== "standby" && !this.change.covering) {
      this.showBanner();
      return;
    }
    const seq = ++this.tuneSeq;
    const t0 = performance.now();
    const previous = again ? this.state.lastId : this.state.currentId;
    this.clearPause();
    this.clearBehind();
    this.clearBack();
    this.clearLand();

    // Changing channel: the corner number and the static at once (not on first launch, for a
    // station coming back, or going straight to off air).
    const swiped = this.swiped === stationId;
    this.swiped = null;
    const look = this.lookFor(c, again, swiped);
    // A press while the static is up: only the channel the viewer lands on loads.
    const repeat = look !== "none" && this.change.covering;
    this.change.press(stationId, look, look === "sweep" ? { from: frequencyOf(this.channel(this.state.currentId)?.station.channel), to: frequencyOf(c.station.channel)!, reduced: this.o.reducedMotion() } : undefined);
    if (look !== "none") {
      this.bannerAfterChange = true;
      if (this.state.banner) this.hideBanner();
      this.muteOnScreen();
      this.playHiss(c);
    } else {
      this.bannerAfterChange = false;
      // A swipe moved the old picture away: its sound goes with it.
      if (swiped) this.muteOnScreen();
      this.showBanner(stationId);
    }

    if (!c.onAir || !c.playback) {
      // An external station whose stream is down is on Stand by, never "off air" (Phase 6).
      if (c.station.kind === "listed") {
        this.downId = stationId;
        this.settle(stationId, previous, "standby");
      } else this.settle(stationId, previous, "off_air");
      return this.endWithoutPicture(seq);
    }
    if (c.playback.kind === "embed") {
      this.settle(stationId, previous, "embed");
      return this.endWithoutPicture(seq);
    }
    if (isDash(c) && !this.canPlayDash()) {
      // A DASH stream link on a device that can't play DASH: it says so, and nothing loads.
      this.settle(stationId, previous, "unplayable");
      return this.endWithoutPicture(seq);
    }
    if (!this.host) {
      // The surface hasn't attached yet (its effect runs after the caller's): tune once it does.
      this.queuedTune = { stationId, source };
      this.patch({ pendingId: stationId });
      return;
    }
    // The picture (or the off-air screen) on now stays until the new one is ready.
    this.patch({ pendingId: stationId, status: this.state.currentId ? this.state.status : "tuning", error: null });
    if (repeat) {
      // Let go of a picture still loading for an earlier press, and wait for the presses to stop.
      if (this.state.currentId) this.rewarm(this.state.currentId);
      await new Promise<void>((resolve) => (this.timers.land = setTimeout(resolve, LAND_MS)));
      if (seq !== this.tuneSeq) return;
    }
    const prefetched = this.prefetches.get(stationId);
    const first = this.deckFor(c);
    if (!first) return;
    const wasWarm = first.state === "ready" || first.state === "playing" || prefetched?.state === "ready";
    // On screen now, it's a deck of its own: the prefetch has done its job.
    if (prefetched) {
      prefetched.stop();
      this.prefetches.delete(stationId);
    }
    const got = await this.picture(c, first, seq, again, previous);
    if (!got || seq !== this.tuneSeq) return;
    const { deck, outcome } = got;
    // Autoplay with sound refused: it can still play muted until someone taps.
    if (outcome === "notAllowed") this.patch({ mutedByBrowser: true });
    // The static stays at least 300 ms (and keeps its distance from the last clear).
    if (!(await this.change.ready()) || seq !== this.tuneSeq) return;
    if (this.decks.get(stationId) !== deck) return;
    for (const d of this.decks.values()) if (d !== deck && d.role === "active") d.warm(this.o.warm === "play" ? "play" : "buffer");
    // A browser that only allows sound after a click on the page doesn't refuse the unmute: Chrome
    // just pauses the picture. That pause is undone: it plays on muted, with the "tap for sound"
    // prompt. (TVs' web views allow sound, so they're never muted for this.)
    deck.show(this.state.muted || this.state.mutedByBrowser);
    this.watchWireless(deck);
    this.audio.measure(deck.video, this.driver.webAudio !== false);
    this.applyCaptions(deck);
    this.patch({ lastTune: { stationId, ms: Math.round(performance.now() - t0), warm: wasWarm }, error: null });
    this.settle(stationId, previous, "playing");
    // The static rolls away over the new picture; the banner follows.
    this.change.clear();
    if (!deck.video.muted) this.keepPlayingIfUnmutePaused(deck);
    this.watchOnScreen();
    this.mediaSession();
  }

  /**
   * How this change looks: static over the old picture (a crossfade with reduced motion, the
   * needle on the radio band), on every channel change, like a TV: to an off-air station, one on
   * Stand by or a city's player too, where the static runs its minimum and then clears to that
   * screen. Nothing only on first launch and for a station coming back.
   */
  private lookFor(c: Channel, again: boolean, swiped = false): TuningLook {
    if (again) return "none";
    const covering = this.change.state;
    const s = this.state.status;
    if (!this.state.currentId || s === "stopped" || s === "idle") return "none";
    const fromRadio = frequencyOf(this.channel(this.state.currentId)?.station.channel) !== null && this.channel(this.state.currentId)?.station.band === "radio";
    const toRadio = c.station.band === "radio" && frequencyOf(c.station.channel) !== null;
    // The radio band, station to station (from its own screen, not from off air or Stand by).
    if (toRadio && fromRadio && s !== "off_air" && s !== "standby" && (!covering || covering.look === "sweep")) return "sweep";
    if (this.o.reducedMotion()) return "fade";
    // A swipe that showed the picture already: no static (unless a change is still covering).
    return swiped && !covering ? "none" : "static";
  }

  /** Landed with no picture to wait for (off air, a city's player): the static clears, or nothing was drawn. */
  private async endWithoutPicture(seq: number) {
    if (!this.change.covering) return this.change.cancel();
    if ((await this.change.ready()) && seq === this.tuneSeq) this.change.clear();
  }

  /**
   * Waits for the picture's first frame. A failure (the playlist, the network, play()) or a load
   * that stalls loads it afresh after a pause that grows; the Stand by at 8 s says so meanwhile.
   * Null when a newer tune took over, or the station turned out to be off air.
   */
  private async picture(c: Channel, first: Deck, seq: number, again: boolean, previous: string | null): Promise<{ deck: Deck; outcome: "frame" | "notAllowed" } | null> {
    const stationId = c.station.id;
    let deck = first;
    let wait = RETRY_FIRST_MS;
    for (;;) {
      try {
        return { deck, outcome: await this.firstPicture(deck) };
      } catch (e) {
        if (seq !== this.tuneSeq) return null;
        const err = e as Error;
        if (err instanceof SignedOffError) {
          // Its playlist had already ended: off air, with the back time the stream gives.
          this.dropDeck(stationId);
          this.settle(stationId, previous, "off_air");
          this.signedOff(stationId, err.backAt, deck.signedOff?.at ?? null);
          void this.endWithoutPicture(seq);
          return null;
        }
        // Let go of (a newer change, or stop): nothing more to do here.
        if (err.name === "AbortError") return null;
        this.patch({ error: deck.error ?? err.message });
        if (again && this.state.offAir?.stationId === stationId) {
          // Coming back didn't work this time: off air as it was, and keep looking.
          this.change.cancel();
          this.patch({ pendingId: null });
          this.signedOff(stationId, this.state.offAir.backAt, null);
          return null;
        }
        if (deck.direct) {
          // A239: the source's own address didn't play in direct mode: its listed address (the
          // relay's, or the same address through the web view) at once, with no wait.
          this.viaListed.add(stationId);
          this.dropDeck(stationId);
          const listed = this.deckFor(c);
          if (!listed) return null;
          deck = listed;
          continue;
        }
        await new Promise<void>((resolve) => (this.timers.land = setTimeout(resolve, wait)));
        wait = Math.min(wait * 2, RETRY_MAX_MS);
        if (seq !== this.tuneSeq) return null;
        this.dropDeck(stationId);
        // A239: each round after a wait tries the source's own address first again.
        this.viaListed.delete(stationId);
        const fresh = this.deckFor(c);
        if (!fresh) return null;
        deck = fresh;
      }
    }
  }

  /**
   * The deck's first frame, starting it without waiting on play(): a play() that never settles (a
   * playlist that never loaded) can't hold the tune up. A load with no frame after
   * REBUILD_AFTER_MS rejects, to be loaded afresh (by then it's Stand by already).
   */
  private firstPicture(deck: Deck): Promise<"frame" | "notAllowed"> {
    return new Promise((resolve, reject) => {
      deck.start().catch((e: Error) => {
        // Refused autoplay plays muted with "Tap for sound"; any other refusal leaves it to the
        // frame, which comes or doesn't (Stand by, then a fresh load).
        if (e?.name === "NotAllowedError") resolve("notAllowed");
      });
      // A239: direct mode gives up sooner, so the listed address has time before Stand by (8 s).
      deck.firstFrame(deck.direct ? DIRECT_FIRST_FRAME_MS : REBUILD_AFTER_MS).then(() => resolve("frame"), reject);
    });
  }

  /** An external station on screen whose stream is down: Stand by, until the dial has it back. */
  private externalDown(stationId: string) {
    if (this.downId === stationId && this.state.status === "standby") return;
    this.downId = stationId;
    this.bannerAfterChange = false;
    this.hideBanner();
    this.settle(stationId, this.state.lastId, "standby");
  }

  /** 8 s without a picture: Stand by for this station (the old picture goes), still trying. */
  private standBy(stationId: string) {
    if (stationId !== (this.state.pendingId ?? this.state.currentId)) return;
    if (this.state.offAir?.stationId === stationId && this.state.status === "off_air") {
      // A station coming back that didn't in time: it's still off air, and keeps looking.
      this.change.cancel();
      this.patch({ pendingId: null });
      this.signedOff(stationId, this.state.offAir.backAt, null);
      return;
    }
    const previous = this.state.currentId !== stationId ? this.state.currentId : this.state.lastId;
    this.bannerAfterChange = false;
    this.hideBanner();
    this.settle(stationId, previous, "standby");
  }

  /** The picture on screen goes quiet while the static covers it. */
  private muteOnScreen() {
    const d = this.active();
    if (d && d.role === "active") d.video.muted = true;
  }

  /** The tuning hiss, when the band's "Tuning sound" is on, someone has interacted, and it isn't muted. */
  private playHiss(c: Channel) {
    const setting = this.tuningSoundOn(c.station.id);
    if (!hissAllowed({ setting, interacted: this.interacted || pageHasBeenActive(), muted: this.state.muted || this.state.mutedByBrowser })) return;
    this.hiss.play(this.volume);
  }

  /** Hisses played so far (tests, and the recordings). */
  hissesPlayed(): number {
    return this.hiss.played;
  }

  private clearLand() {
    if (this.timers.land) clearTimeout(this.timers.land);
    this.timers.land = 0;
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
      offAir: null,
      // A new picture joins live.
      behindLive: false
    });
    this.rewarm(stationId);
  }

  /** Keep the neighbours warm; let go of every other deck. */
  private rewarm(currentId: string) {
    const keep = new Set<string>([currentId]);
    if (this.state.pendingId) keep.add(this.state.pendingId);
    const mode = this.o.warm;
    // A DASH neighbour is never warmed (A227): no dash.js, no manifest, until it's tuned.
    const warmable = mode === "none" ? [] : this.warmAround(currentId).filter((n) => n.onAir && n.playback?.kind === "hls" && !isDash(n));
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
        // A239: a neighbour going direct isn't prefetched: the web view's cache is no help to the
        // native fetch, and an IP-bound session shouldn't start before it's tuned.
        if (this.decks.has(id) || n.playback?.kind !== "hls" || this.directAddress(n)) continue;
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
      this.checkCaughtUp(d);
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
    this.clearBehind();
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
    const next = this.stepFrom(from, dir);
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
    this.patch({ status: "paused", paused: { since: this.o.now(), expired: false }, behindLive: true });
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
    this.patch({ status: "playing", behindLive: false });
    this.showBanner();
    this.mediaSession();
  }

  private clearPause() {
    if (this.timers.pause) clearTimeout(this.timers.pause);
    if (this.state.paused) this.patch({ paused: null });
  }

  private clearBehind() {
    if (this.state.behindLive) this.patch({ behindLive: false });
  }

  /** Playing behind live, and the picture has caught up to the live edge by itself: live again. */
  private checkCaughtUp(d: Deck) {
    if (!this.state.behindLive || this.state.status !== "playing" || this.state.pendingId) return;
    const behind = d.behindLive();
    if (behind !== null && behind <= NEAR_LIVE_S) this.patch({ behindLive: false });
  }

  // ---------- AirPlay (Safari) ----------

  private probeAirPlay(host: HTMLElement) {
    if (typeof window === "undefined" || !("WebKitPlaybackTargetAvailabilityEvent" in window)) return;
    if (!this.airPlayProbe) {
      const v = document.createElement("video");
      v.className = "oc-player__probe";
      v.setAttribute("aria-hidden", "true");
      v.setAttribute("x-webkit-airplay", "allow");
      v.muted = true;
      // WebKit says when a listener is added, and whenever an AirPlay TV comes or goes.
      v.addEventListener("webkitplaybacktargetavailabilitychanged", (e) => {
        const available = (e as Event & { availability?: string }).availability === "available";
        if (available !== this.state.airPlay.available) this.patch({ airPlay: { ...this.state.airPlay, available } });
      });
      this.airPlayProbe = v;
    }
    host.appendChild(this.airPlayProbe);
  }

  /** Follows whether the picture on screen is playing on an AirPlay TV. */
  private watchWireless(d: Deck) {
    this.wirelessOff?.();
    const v = d.video as HTMLVideoElement & { webkitCurrentPlaybackTargetIsWireless?: boolean };
    const check = () => {
      const active = !!v.webkitCurrentPlaybackTargetIsWireless && this.decks.get(d.stationId) === d;
      if (active !== this.state.airPlay.active) this.patch({ airPlay: { ...this.state.airPlay, active } });
    };
    v.addEventListener("webkitcurrentplaybacktargetiswirelesschanged", check);
    this.wirelessOff = () => v.removeEventListener("webkitcurrentplaybacktargetiswirelesschanged", check);
    check();
  }

  /**
   * Opens Safari's AirPlay list for the picture on screen (from a click or tap: WebKit asks for
   * one). The stream plays on the TV itself. A picture on hls.js can't go to AirPlay (Media Source
   * isn't a stream the TV can fetch, and one already running through Web Audio plays only there),
   * so a fresh <video> on Safari's own HLS takes its place first, starting at live: the list opens
   * on it at once, and the old picture stays on screen until the new one has a frame.
   */
  showAirPlayPicker(): boolean {
    const d = this.active();
    if (!d || d.role !== "active" || !this.host) return false;
    // A DASH stream link has no HLS for the TV to fetch (A201): not offered.
    if (isDash(this.channel(d.stationId))) return false;
    const deck = d.native && !this.audio.isRouted(d.video) ? d : this.nativeTwin(d);
    deck.setRemote(true);
    const v = deck.video as HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void };
    v.webkitShowPlaybackTargetPicker?.();
    return true;
  }

  /** Stops playing on the AirPlay TV: the picture comes back to this screen. */
  stopAirPlay() {
    const d = this.active();
    // Remote playback off takes the picture back from the TV; showAirPlayPicker allows it again.
    if (d) d.setRemote(false);
    if (this.state.airPlay.active) this.patch({ airPlay: { ...this.state.airPlay, active: false } });
  }

  /** A deck on Safari's own HLS for the station on screen, taking the old one's place once it has a frame. */
  private nativeTwin(old: Deck): Deck {
    const id = old.stationId;
    const twin = new Deck({
      stationId: id,
      url: old.url,
      host: this.host!,
      driver: this.airPlayDriver,
      quality: this.o.quality,
      fetch: this.fetch,
      onChange: () => this.refreshWarm(),
      onSignOff: (deck) => this.deckSignedOff(deck)
    });
    this.decks.set(id, twin);
    this.watchWireless(twin);
    const settle = (ok: boolean) => {
      const current = this.decks.get(id) === twin;
      if (ok && current) {
        twin.show(this.state.muted || this.state.mutedByBrowser);
        // Never through Web Audio: its sound goes to the TV as it is.
        this.audio.measure(twin.video, false);
        this.applyCaptions(twin);
        // It started at live: a pause (and being behind live) ended with it.
        if (this.state.status === "paused") {
          this.clearPause();
          this.patch({ status: "playing" });
          if (this.state.banner) this.showBanner();
        }
        this.clearBehind();
      } else if (current) {
        // It didn't start: the old picture carries on.
        twin.destroy();
        this.decks.set(id, old);
        this.watchWireless(old);
        return;
      }
      // Done with the old picture (or a tune took over while this one started).
      if (this.decks.get(id) !== old) old.destroy();
    };
    void (async () => {
      try {
        await twin.start();
        await twin.firstFrame().catch((e: Error) => {
          // Playing on the TV, a frame may never be drawn here.
          if (!(twin.video as HTMLVideoElement & { webkitCurrentPlaybackTargetIsWireless?: boolean }).webkitCurrentPlaybackTargetIsWireless) throw e;
        });
        settle(true);
      } catch {
        settle(false);
      }
    })();
    return twin;
  }

  // ---------- Sound and captions ----------

  setMuted(muted: boolean) {
    if (!muted) {
      this.interacted = true;
      this.audio.unlock();
    }
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
    this.change.cancel();
    this.clearLand();
    for (const d of this.decks.values()) d.destroy();
    this.decks.clear();
    for (const p of this.prefetches.values()) p.stop();
    this.prefetches.clear();
    this.stopOnScreen();
    this.clearBack();
    this.patch({ status: "stopped", sleep: null, banner: null, warm: [], offAir: null, behindLive: false });
  }

  // ---------- Commands ----------

  /** Acts on a command from any input. Commands the player doesn't own go to onCommand. */
  handle(command: Command, source?: CommandSource): void {
    // A command means someone's there: let sound run through the level meter (and the tuning hiss play).
    this.interacted = true;
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
        // Held OK while behind live: Back to live (the remote's way, with ▲ ▼ ◀ ▶ and Back taken).
        if (command.hold && this.state.behindLive) return this.backToLive();
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
        // Only from behind live: at the live edge already, the key does nothing (no jump, no banner).
        if (this.state.behindLive || this.state.status === "paused") this.backToLive();
        return;
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
    this.change.destroy();
    this.wirelessOff?.();
    this.airPlayProbe?.remove();
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
