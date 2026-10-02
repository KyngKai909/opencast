// The tuning sound: a short, soft hiss while changing channel (Web Audio: band-passed noise with a
// quick rise and a gentle fall, well below a program's level). Played only when all of these hold:
// - "Tuning sound" is on for the band (on for the radio band and off for video by default);
// - the viewer has interacted with the page (browsers allow sound only then, and it's polite);
// - the player isn't muted, by the viewer or by the browser.
// One noise buffer is made once and reused; a press while a hiss is still playing doesn't start
// another on top of it.

import { HISS_ATTACK_MS, HISS_CENTRE_HZ, HISS_GAIN, HISS_MS, HISS_Q, HISS_RELEASE_MS } from "./constants";

export interface HissGate {
  /** "Tuning sound" for the band of the channel being tuned. */
  setting: boolean;
  /** The viewer has pressed, clicked or tapped something (or the browser says the page has had a gesture). */
  interacted: boolean;
  /** Muted by the viewer, or waiting for a tap because the browser refused sound. */
  muted: boolean;
}

/** Whether the hiss may play. */
export function hissAllowed(g: HissGate): boolean {
  return g.setting && g.interacted && !g.muted;
}

/** Whether the page has had a user gesture, where the browser says (navigator.userActivation). */
export function pageHasBeenActive(): boolean {
  const ua = typeof navigator !== "undefined" ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation : undefined;
  return !!ua?.hasBeenActive;
}

export class Hiss {
  private buffer: AudioBuffer | null = null;
  private playingUntil = 0;
  /** Hisses started, for tests and the recordings' notes. */
  played = 0;

  /** `context` gives the player's one AudioContext (unlocked on the first command), or null. */
  constructor(private context: () => AudioContext | null) {}

  /** Plays one hiss, at the player's volume (0 to 1). Returns whether it started (or will, once the context resumes). */
  play(volume = 1): boolean {
    const ctx = this.context();
    if (!ctx || volume <= 0) return false;
    if (ctx.state === "running") return this.start(ctx, volume);
    // Suspended until a gesture resumes it: the page has had one (the caller checked), so resume now.
    try {
      void ctx
        .resume()
        .then(() => ctx.state === "running" && this.start(ctx, volume))
        .catch(() => {});
    } catch {
      return false;
    }
    return true;
  }

  private start(ctx: AudioContext, volume: number): boolean {
    try {
      const t = ctx.currentTime;
      if (t < this.playingUntil) return false;
      const seconds = HISS_MS / 1000;
      if (!this.buffer || this.buffer.sampleRate !== ctx.sampleRate) {
        const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
        const ch = b.getChannelData(0);
        for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
        this.buffer = b;
      }
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = HISS_CENTRE_HZ;
      filter.Q.value = HISS_Q;
      const gain = ctx.createGain();
      const peak = HISS_GAIN * volume;
      // Silence, up to the peak, hold, then down to silence by the end: no click at either end.
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak, t + HISS_ATTACK_MS / 1000);
      gain.gain.setValueAtTime(peak, t + seconds - HISS_RELEASE_MS / 1000);
      gain.gain.linearRampToValueAtTime(0, t + seconds);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start(t);
      src.stop(t + seconds);
      src.onended = () => {
        src.disconnect();
        filter.disconnect();
        gain.disconnect();
      };
      this.playingUntil = t + seconds;
      this.played++;
      return true;
    } catch {
      return false;
    }
  }
}
