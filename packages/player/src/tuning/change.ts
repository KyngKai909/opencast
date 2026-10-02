// Changing channel, as a timing state machine (follow-up Phase 5). The engine drives it: a press,
// the first frame of the channel it lands on, and the swap; it keeps the time.
//
//   press ──► static ──(800 ms, no frame)──► tuning in ──(8 s, no frame)──► Stand by
//               │                                │                            │
//               └──── first frame, and at least 300 ms since the static came up ──► clearing (160 ms roll) ──► done, banner
//                                                                               ◄── (a frame at last)
//
// - Every press shows the new channel's number at once; a press while the static is up keeps it
//   up (only the number changes), and a press during the roll brings it back.
// - The 800 ms and 8 s count from the latest press: that's the channel loading.
// - Clears are at least CLEAR_GAP_MS apart (the photosensitivity guard): with the static up
//   between them, no second can hold more than three big brightness changes.
// - Looks: "static" (grain), "fade" (reduced motion: a dim and a crossfade), "sweep" (the radio
//   band's needle), and "none" (first launch, or a station coming back on air): nothing is drawn,
//   but the Stand by at 8 s still applies, whatever kept the picture from coming.

import { CLEAR_GAP_MS, CROSSFADE_MS, MIN_STATIC_MS, ROLL_MS, STANDBY_MS, SWEEP_MS, TUNING_IN_MS } from "./constants";
import { needleAt, sweep as makeSweep, type Sweep } from "./sweep";

export type TuningLook = "static" | "fade" | "sweep" | "none";
export type TuningPhase = "static" | "tuning_in" | "clearing";

/** What the player draws while changing channel (none for the "none" look). */
export interface TuningState {
  /** The channel the viewer is going to: its number and call sign in the corner. */
  stationId: string;
  look: Exclude<TuningLook, "none">;
  phase: TuningPhase;
  /** When the static (or dim) came up, and the latest press. */
  since: number;
  pressedAt: number;
  /** Presses in this change. */
  presses: number;
  /** The radio band's needle, for the latest press. */
  sweep: Sweep | null;
}

export interface ChangeEvents {
  /** The drawn state changed (null: nothing drawn). */
  onChange: (state: TuningState | null) => void;
  /** 8 s without a first frame: Stand by, for this station. */
  onStandby: (stationId: string) => void;
  /** The roll (or crossfade) has finished, or a picture replaced Stand by: the banner's turn. */
  onCleared: (stationId: string, look: TuningLook, fromStandby: boolean) => void;
}

/** How long each look's cover stays at least, and how long it takes to clear. */
export function minimumFor(look: TuningLook): number {
  return look === "static" ? MIN_STATIC_MS : look === "fade" ? CROSSFADE_MS : look === "sweep" ? SWEEP_MS : 0;
}
export function clearingFor(look: TuningLook): number {
  return look === "static" ? ROLL_MS : look === "fade" || look === "sweep" ? CROSSFADE_MS : 0;
}

type Timer = ReturnType<typeof setTimeout>;

interface Changing {
  kind: "changing";
  stationId: string;
  look: TuningLook;
  phase: TuningPhase;
  since: number;
  pressedAt: number;
  presses: number;
  sweep: Sweep | null;
}

export class ChannelChange {
  private s: Changing | { kind: "standby"; stationId: string } | null = null;
  private timers: { tuningIn?: Timer; standby?: Timer; ready?: Timer; clear?: Timer } = {};
  /** Bumped on every press: a wait for the swap that's outlived its press gives up. */
  private gen = 0;
  private waiting: ((ok: boolean) => void) | null = null;
  /** When the cover last cleared (or turned into Stand by), for the photosensitivity guard. */
  private lastClearAt = -Infinity;
  /** Every cover change (up, clearing), for the tests. */
  readonly changes: Array<{ at: number; kind: "up" | "clear" | "standby" }> = [];
  private now: () => number;

  constructor(
    private events: ChangeEvents,
    o: { now?: () => number } = {}
  ) {
    this.now = o.now ?? (() => Date.now());
  }

  /** What's drawn now (null when nothing is). */
  get state(): TuningState | null {
    const s = this.s;
    if (!s || s.kind !== "changing" || s.look === "none") return null;
    return { stationId: s.stationId, look: s.look, phase: s.phase, since: s.since, pressedAt: s.pressedAt, presses: s.presses, sweep: s.sweep };
  }

  /** A change is in progress with something drawn (the static, the dim or the needle). */
  get covering(): boolean {
    const s = this.s;
    return !!s && s.kind === "changing" && s.look !== "none";
  }

  /** Waiting at Stand by for this station's picture. */
  get standingBy(): string | null {
    return this.s?.kind === "standby" ? this.s.stationId : null;
  }

  /**
   * A press: the channel to go to, the look, and on the radio band the frequencies (the needle
   * starts from wherever it is if it's still moving).
   */
  press(stationId: string, look: TuningLook, band?: { from: number | null; to: number; reduced?: boolean }) {
    const now = this.now();
    this.gen++;
    this.giveUpWaiting();
    this.clearTimer("ready");
    this.clearTimer("clear");
    const was = this.s?.kind === "changing" ? this.s : null;
    const continuing = !!was && was.look !== "none" && look !== "none";
    // Still up (static, tuning in): it's the same change, and the cover stays; clearing, it comes back.
    const sameLook = continuing && was!.look === look;
    const covered = sameLook && was!.phase !== "clearing";
    // The cover changes its look (the radio band's screen to static, say): as far as brightness
    // goes that's a clear and a new cover, and the guard counts it so.
    if (continuing && !sameLook && was!.phase !== "clearing") {
      this.lastClearAt = now;
      this.changes.push({ at: now, kind: "clear" });
    }
    if (look !== "none" && !covered) this.changes.push({ at: now, kind: "up" });
    let sw: Sweep | null = null;
    if (look === "sweep" && band) {
      const from = was?.sweep ? needleAt(was.sweep, now) : band.from;
      sw = from === null ? null : makeSweep(from, band.to, now, band.reduced);
    }
    this.s = {
      kind: "changing",
      stationId,
      look,
      phase: "static",
      since: covered ? was!.since : now,
      pressedAt: now,
      presses: continuing ? was!.presses + 1 : 1,
      sweep: sw
    };
    this.clearTimer("tuningIn");
    this.clearTimer("standby");
    if (look !== "none") {
      this.timers.tuningIn = setTimeout(() => {
        const s = this.s;
        if (s?.kind === "changing" && s.phase === "static") {
          s.phase = "tuning_in";
          this.publish();
        }
      }, TUNING_IN_MS);
    }
    this.timers.standby = setTimeout(() => this.standBy(), STANDBY_MS);
    this.publish();
  }

  private standBy() {
    const s = this.s;
    if (!s || s.kind !== "changing" || s.phase === "clearing") return;
    this.clearTimer("tuningIn");
    this.giveUpWaiting();
    const now = this.now();
    // Static to the bars is a change too: the next clear keeps its distance from it.
    this.lastClearAt = now;
    this.changes.push({ at: now, kind: "standby" });
    this.s = { kind: "standby", stationId: s.stationId };
    this.publish();
    this.events.onStandby(s.stationId);
  }

  /**
   * The first frame of the channel it landed on is on screen. Resolves true when the new picture
   * may be put on screen (at least the look's minimum since the cover came up, and CLEAR_GAP_MS
   * since the last clear), or false if a press came first (that press has its own change).
   */
  ready(): Promise<boolean> {
    const s = this.s;
    if (!s) return Promise.resolve(true);
    // The picture's here: no "Tuning in", no Stand by.
    this.clearTimer("tuningIn");
    this.clearTimer("standby");
    const now = this.now();
    let at = now;
    if (s.kind === "changing" && s.look !== "none") at = Math.max(at, s.since + minimumFor(s.look), this.lastClearAt + CLEAR_GAP_MS);
    if (s.kind === "standby") at = Math.max(at, this.lastClearAt + CLEAR_GAP_MS);
    if (at <= now) return Promise.resolve(true);
    const gen = this.gen;
    this.giveUpWaiting();
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.timers.ready = setTimeout(() => {
        this.waiting = null;
        resolve(gen === this.gen);
      }, at - now);
    });
  }

  /**
   * The new picture is on screen: the static rolls away (or the dim crossfades, or the name fades
   * up on the radio band), then it's done and the banner has its turn.
   */
  clear() {
    const s = this.s;
    if (!s) return;
    const now = this.now();
    if (s.kind === "standby" || s.look === "none") {
      if (s.kind === "standby") {
        this.lastClearAt = now;
        this.changes.push({ at: now, kind: "clear" });
      }
      this.end();
      this.events.onCleared(s.stationId, s.kind === "standby" ? "none" : s.look, s.kind === "standby");
      return;
    }
    if (s.phase === "clearing") return;
    this.clearTimer("tuningIn");
    this.clearTimer("standby");
    s.phase = "clearing";
    this.lastClearAt = now;
    this.changes.push({ at: now, kind: "clear" });
    this.publish();
    const { stationId, look } = s;
    this.timers.clear = setTimeout(() => {
      if (this.s !== s) return;
      this.end();
      this.events.onCleared(stationId, look, false);
    }, clearingFor(look));
  }

  /** Ends at once, drawing nothing more (the engine stopped, or went somewhere with no change). */
  cancel() {
    if (!this.s) return;
    this.gen++;
    this.giveUpWaiting();
    this.end();
  }

  private end() {
    for (const k of Object.keys(this.timers) as Array<keyof typeof this.timers>) this.clearTimer(k);
    this.s = null;
    this.publish();
  }

  private giveUpWaiting() {
    const w = this.waiting;
    this.waiting = null;
    this.clearTimer("ready");
    w?.(false);
  }

  private clearTimer(k: keyof typeof this.timers) {
    const t = this.timers[k];
    if (t) clearTimeout(t);
    delete this.timers[k];
  }

  private lastPublished: TuningState | null = null;
  private publish() {
    const st = this.state;
    const a = this.lastPublished;
    if (a === st || (a && st && a.stationId === st.stationId && a.phase === st.phase && a.presses === st.presses && a.look === st.look && a.sweep === st.sweep)) return;
    this.lastPublished = st;
    this.events.onChange(st);
  }

  destroy() {
    this.cancel();
  }
}
