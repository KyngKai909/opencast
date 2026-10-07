// The tuning sound, while changing channel (Web Audio, well below a program's level), for as long
// as the change's cover is up: from the press until the picture (or the station's sound) arrives,
// then a short fade. Two voices (2026-10-06, the user's picks):
// - "set", the TV band: an old TV set. A deep hiss, a soft low thump as the channel clicks over,
//   and a faint mains hum under it.
// - "dial", the radio band: the hiss through a band that rises as the needle travels and settles
//   lower while the station comes in, with faint whistles as the needle passes other stations, and
//   a soft click on the press.
// Both click as the station lands (the picture or the sound arrives; not on Stand by).
// Played only when all of these hold:
// - "Tuning sound" is on for the band (on for both by default);
// - the viewer has interacted with the page (browsers allow sound only then, and it's polite);
// - the player isn't muted, by the viewer or by the browser.
// One noise buffer is made once and looped; a press while it's playing keeps the one playing (and
// its TUNING_SOUND_MAX_MS counts again from that press).

import {
  CLICK_DIAL_HZ,
  CLICK_LANDED_GAIN,
  CLICK_MS,
  CLICK_PRESS_GAIN,
  CLICK_Q,
  CLICK_SET_HZ,
  DIAL_FROM_HZ,
  DIAL_NOISE_GAIN,
  DIAL_PEAK_HZ,
  DIAL_Q,
  DIAL_REST_HZ,
  DIAL_SETTLE_MS,
  DIAL_WHISTLE_GAIN,
  DIAL_WHISTLE_MS,
  DIAL_WHISTLES_AT_MS,
  SET_HIGHPASS_HZ,
  SET_HUM_GAIN,
  SET_HUM_HZ,
  SET_HUM_LOWPASS_HZ,
  SET_LOWPASS_HZ,
  SET_NOISE_GAIN,
  SET_THUMP_FROM_HZ,
  SET_THUMP_GAIN,
  SET_THUMP_MS,
  SET_THUMP_TO_HZ,
  SWEEP_MS,
  TUNING_SOUND_ATTACK_MS,
  TUNING_SOUND_MAX_MS,
  TUNING_SOUND_RELEASE_MS
} from "./constants";

/** Which band's sound: "set" for TV, "dial" for radio. */
export type TuningVoice = "set" | "dial";

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

interface Playing {
  voice: TuningVoice;
  volume: number;
  /** The sound's own gain: its envelope, and the fade on stop. */
  out: GainNode;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  stopTimer: ReturnType<typeof setTimeout>;
}

export class Hiss {
  private buffer: AudioBuffer | null = null;
  private playing: Playing | null = null;
  /** Sounds started, for tests and the recordings' notes. */
  played = 0;

  /** `context` gives the player's one AudioContext (unlocked on the first command), or null. */
  constructor(private context: () => AudioContext | null) {}

  /**
   * Starts the band's sound, at the player's volume (0 to 1), or keeps the one playing. Returns
   * whether one started (or will, once the context resumes).
   */
  play(volume = 1, voice: TuningVoice = "set"): boolean {
    const ctx = this.context();
    if (!ctx || volume <= 0) return false;
    if (this.playing) {
      this.keepFor(this.playing);
      return false;
    }
    if (ctx.state === "running") return this.start(ctx, volume, voice);
    // Suspended until a gesture resumes it: the page has had one (the caller checked), so resume now.
    try {
      void ctx
        .resume()
        .then(() => ctx.state === "running" && !this.playing && this.start(ctx, volume, voice))
        .catch(() => {});
    } catch {
      return false;
    }
    return true;
  }

  /**
   * The cover's gone: it fades out. `landed`: the picture (or the station's sound) arrived, and it
   * clicks; otherwise (Stand by, or nothing more to change to) it only fades.
   */
  stop(landed = false) {
    const p = this.playing;
    const ctx = this.context();
    if (!p || !ctx) return;
    this.playing = null;
    clearTimeout(p.stopTimer);
    try {
      const t = ctx.currentTime;
      const end = t + TUNING_SOUND_RELEASE_MS / 1000;
      p.out.gain.cancelScheduledValues(t);
      p.out.gain.setValueAtTime(p.out.gain.value, t);
      p.out.gain.linearRampToValueAtTime(0, end);
      for (const s of p.sources) s.stop(end + 0.05);
      if (landed) this.click(ctx, t, p.voice, CLICK_LANDED_GAIN * p.volume);
    } catch {
      // A context closed under it: nothing left to hear.
    }
  }

  private keepFor(p: Playing) {
    clearTimeout(p.stopTimer);
    p.stopTimer = setTimeout(() => this.playing === p && this.stop(), TUNING_SOUND_MAX_MS);
  }

  private noise(ctx: AudioContext): AudioBufferSourceNode {
    if (!this.buffer || this.buffer.sampleRate !== ctx.sampleRate) {
      const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const ch = b.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      this.buffer = b;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    return src;
  }

  private filter(ctx: AudioContext, type: BiquadFilterType, hz: number, q = 0.7): BiquadFilterNode {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    return f;
  }

  /** A click: a short burst of noise through a band, falling away in CLICK_MS. */
  private click(ctx: AudioContext, at: number, voice: TuningVoice, gain: number) {
    const len = Math.ceil((ctx.sampleRate * CLICK_MS) / 1000);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = b.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 6));
    const src = ctx.createBufferSource();
    src.buffer = b;
    const band = this.filter(ctx, "bandpass", voice === "dial" ? CLICK_DIAL_HZ : CLICK_SET_HZ, CLICK_Q);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(band);
    band.connect(g);
    g.connect(ctx.destination);
    src.onended = () => {
      src.disconnect();
      band.disconnect();
      g.disconnect();
    };
    src.start(at);
  }

  private start(ctx: AudioContext, volume: number, voice: TuningVoice): boolean {
    try {
      const t = ctx.currentTime;
      const sources: AudioScheduledSourceNode[] = [];
      const nodes: AudioNode[] = [];
      const add = <N extends AudioNode>(n: N): N => (nodes.push(n), n);
      // Silence, up to full over the attack: no click as it comes in (stop() fades it out).
      const out = add(ctx.createGain());
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(volume, t + TUNING_SOUND_ATTACK_MS / 1000);
      out.connect(ctx.destination);
      const level = (gain: number) => {
        const g = add(ctx.createGain());
        g.gain.value = gain;
        g.connect(out);
        return g;
      };
      const noise = this.noise(ctx);
      sources.push(noise);
      if (voice === "set") {
        // The hiss, deep: low-passed, and clear of the rumble.
        const low = add(this.filter(ctx, "lowpass", SET_LOWPASS_HZ));
        const high = add(this.filter(ctx, "highpass", SET_HIGHPASS_HZ));
        noise.connect(low);
        low.connect(high);
        high.connect(level(SET_NOISE_GAIN));
        // The thump: the channel clicking over.
        const thump = ctx.createOscillator();
        thump.type = "sine";
        thump.frequency.setValueAtTime(SET_THUMP_FROM_HZ, t);
        thump.frequency.exponentialRampToValueAtTime(SET_THUMP_TO_HZ, t + 0.15);
        const tg = add(ctx.createGain());
        tg.gain.setValueAtTime(SET_THUMP_GAIN, t);
        tg.gain.exponentialRampToValueAtTime(0.001, t + SET_THUMP_MS / 1000);
        thump.connect(tg);
        tg.connect(out);
        thump.start(t);
        thump.stop(t + SET_THUMP_MS / 1000 + 0.02);
        nodes.push(thump);
        // The hum: mains, its low harmonics only.
        const hum = ctx.createOscillator();
        hum.type = "sawtooth";
        hum.frequency.value = SET_HUM_HZ;
        const hl = add(this.filter(ctx, "lowpass", SET_HUM_LOWPASS_HZ));
        hum.connect(hl);
        hl.connect(level(SET_HUM_GAIN));
        hum.start(t);
        sources.push(hum);
      } else {
        // The band rises as the needle travels, then settles lower while the station comes in.
        const band = add(this.filter(ctx, "bandpass", DIAL_FROM_HZ, DIAL_Q));
        band.frequency.setValueAtTime(DIAL_FROM_HZ, t);
        band.frequency.linearRampToValueAtTime(DIAL_PEAK_HZ, t + SWEEP_MS / 1000);
        band.frequency.linearRampToValueAtTime(DIAL_REST_HZ, t + (SWEEP_MS + DIAL_SETTLE_MS) / 1000);
        noise.connect(band);
        band.connect(level(DIAL_NOISE_GAIN));
        // A soft click as the dial turns.
        this.click(ctx, t, "dial", CLICK_PRESS_GAIN * volume);
        // Faint whistles as it passes other stations on the way.
        for (const ms of DIAL_WHISTLES_AT_MS) {
          const at = t + ms / 1000;
          const len = DIAL_WHISTLE_MS / 1000;
          const w = ctx.createOscillator();
          w.frequency.setValueAtTime(1000 + Math.random() * 800, at);
          w.frequency.exponentialRampToValueAtTime(250 + Math.random() * 200, at + len);
          const wg = add(ctx.createGain());
          wg.gain.setValueAtTime(0, at);
          wg.gain.linearRampToValueAtTime(DIAL_WHISTLE_GAIN, at + 0.04);
          wg.gain.linearRampToValueAtTime(0, at + len);
          w.connect(wg);
          wg.connect(out);
          w.start(at);
          w.stop(at + len + 0.02);
          nodes.push(w);
        }
      }
      noise.start(t);
      noise.onended = () => {
        for (const n of nodes) n.disconnect();
        for (const s of sources) s.disconnect();
      };
      const p: Playing = { voice, volume, out, sources, nodes, stopTimer: setTimeout(() => {}, 0) };
      this.playing = p;
      this.keepFor(p);
      this.played++;
      return true;
    } catch {
      return false;
    }
  }
}
