// Real sound levels for the level meter (the radio screen's "moves with the sound"), from the
// playing <video> through Web Audio. The device playing the sound is the one measuring: the TV
// app, the Cast receiver, or the phone.
//
// - A media element can be routed into Web Audio only once, so each keeps its source node.
// - Audio only flows through the graph while the AudioContext is running, which most browsers
//   allow after a gesture: the engine unlocks it on the first command someone gives.
// - Where the browser gives no samples (native HLS on iPhone), levels() returns null and the
//   meter falls back to its rhythm.
//
// The same graph evens out the sound when that setting is on: a gentle compressor and a make-up
// gain between the element and the meter, so a quiet station comes up and a loud one comes
// down. Off, the sound takes a straight path past them; switching crossfades the two paths.
// An element Web Audio would only get silence from (the browser's own HLS, or cross-origin
// without CORS) is never routed: once routed, an element plays only through the graph, so its
// sound would be lost. Such an element keeps its sound as it is, not evened out and not measured.

type Ctx = AudioContext;

/** The leveller: gentle enough for speech and music alike. */
export const LEVELLER = {
  thresholdDb: -24,
  ratio: 4,
  kneeDb: 12,
  attack: 0.01,
  release: 0.25,
  /**
   * The compressor already applies its own make-up gain (part of Web Audio's compressor
   * processing: about +8 dB on quiet sound at these settings), so the make-up gain after it only
   * trims 1 dB for headroom. Measured in Chrome with pink noise (RMS, dBFS, in → out): -40 → -33,
   * -30 → -23, -18 → -16.6, -14 → -15.3, -10 → -13.9, -6 → -12.8, with peaks staying under 0.
   */
  makeUpDb: -1
} as const;

/** Time constant of the crossfade between the straight and levelled paths (about 0.15 s in all). */
const CROSSFADE_SECONDS = 0.03;

interface Chain {
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
  /** The straight path (evening out off) and the levelled one (on): one is at 1, the other 0. */
  dry: GainNode;
  wet: GainNode;
}

/**
 * Whether Web Audio gets this element's samples. Media Source (hls.js) and same-origin sources
 * do; a cross-origin one only when it was loaded with CORS (crossorigin set, or it wouldn't load).
 */
export function samplesReachWebAudio(el: HTMLMediaElement): boolean {
  if (el.srcObject) return true;
  const src = el.currentSrc || el.src;
  if (!src || src.startsWith("blob:") || src.startsWith("data:")) return true;
  try {
    if (new URL(src, location.href).origin === location.origin) return true;
  } catch {
    return false;
  }
  return el.crossOrigin !== null;
}

export class AudioLevels {
  private ctx: Ctx | null = null;
  private sources = new WeakMap<HTMLMediaElement, Chain>();
  /** Elements Web Audio would get silence from: left alone. */
  private unroutable = new WeakSet<HTMLMediaElement>();
  private current: HTMLMediaElement | null = null;
  private silentSince: number | null = null;
  private evenOut = false;

  /** The player's one AudioContext (made on first use), shared with the tuning hiss. */
  context(): Ctx | null {
    if (this.ctx) return this.ctx;
    const AC = typeof window !== "undefined" ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!AC) return null;
    try {
      this.ctx = new AC();
    } catch {
      return null;
    }
    return this.ctx;
  }

  /** Call from a gesture (a key, a tap): lets the graph run, then measures the current element. */
  unlock() {
    const ctx = this.context();
    if (!ctx) return;
    const run = ctx.state === "running" ? Promise.resolve() : ctx.resume();
    void run.then(() => this.current && this.connect(this.current)).catch(() => {});
  }

  /**
   * Measures this element from now on (the one on screen), and evens it out if that's on. Only
   * once the context runs. `routable` false: Web Audio gets only silence from how it plays.
   */
  measure(el: HTMLMediaElement, routable = true) {
    this.current = el;
    this.silentSince = null;
    if (!routable) this.unroutable.add(el);
    const chain = this.sources.get(el);
    // It was on screen before: its paths may be as an earlier setting left them. (It was silent
    // until now, so no ramp is needed.)
    if (chain) this.setPaths(chain, false);
    else if (this.ctx?.state === "running") this.connect(el);
  }

  /** Evening out the sound, on or off: crossfades the element on screen at once, without a click. */
  setEvenOut(on: boolean) {
    if (on === this.evenOut) return;
    this.evenOut = on;
    const chain = this.current && this.sources.get(this.current);
    if (chain) this.setPaths(chain, true);
  }

  /** Whether this element runs through the graph (then it plays only through it, never to AirPlay). */
  isRouted(el: HTMLMediaElement): boolean {
    return this.sources.has(el);
  }

  /** Whether the element on screen is running through the graph (and evened out, if that's on). */
  routed(): boolean {
    return !!this.current && this.sources.has(this.current);
  }

  private setPaths(chain: Chain, ramp: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [gain, value] of [
      [chain.dry, this.evenOut ? 0 : 1],
      [chain.wet, this.evenOut ? 1 : 0]
    ] as const) {
      gain.gain.cancelScheduledValues(t);
      if (ramp) gain.gain.setTargetAtTime(value, t, CROSSFADE_SECONDS);
      else gain.gain.setValueAtTime(value, t);
    }
  }

  private connect(el: HTMLMediaElement) {
    const ctx = this.ctx;
    if (!ctx || this.sources.has(el)) return;
    // Routing an element Web Audio gets silence from would silence it: leave it alone.
    if (this.unroutable.has(el) || !samplesReachWebAudio(el)) return;
    try {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      // source → dry ─────────────────────────────→ analyser → speakers
      // source → compressor → make-up gain → wet ──↗
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = LEVELLER.thresholdDb;
      compressor.ratio.value = LEVELLER.ratio;
      compressor.knee.value = LEVELLER.kneeDb;
      compressor.attack.value = LEVELLER.attack;
      compressor.release.value = LEVELLER.release;
      const makeUp = ctx.createGain();
      makeUp.gain.value = Math.pow(10, LEVELLER.makeUpDb / 20);
      // Last: from here the element plays only through the graph.
      const source = ctx.createMediaElementSource(el);
      source.connect(dry);
      dry.connect(analyser);
      source.connect(compressor);
      compressor.connect(makeUp);
      makeUp.connect(wet);
      wet.connect(analyser);
      analyser.connect(ctx.destination);
      const chain: Chain = { analyser, data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)), dry, wet };
      this.setPaths(chain, false);
      this.sources.set(el, chain);
    } catch {
      // Already routed, or the browser refuses: no real levels, and the sound as it was.
    }
  }

  /**
   * `bars` levels from 0 to 1 across the voice and music bands, or null when there's nothing to
   * measure (not unlocked, muted, or no samples from this browser).
   */
  levels(bars: number): number[] | null {
    const el = this.current;
    const node = el && this.sources.get(el);
    if (!el || !node || el.muted || el.paused || this.ctx?.state !== "running") return null;
    node.analyser.getByteFrequencyData(node.data);
    // Skip the lowest bin (hum) and the top third (little energy in speech and most music).
    const usable = Math.floor(node.data.length * 0.66);
    const per = Math.max(1, Math.floor((usable - 1) / bars));
    const out: number[] = [];
    let total = 0;
    for (let b = 0; b < bars; b++) {
      let sum = 0;
      for (let i = 1 + b * per; i < 1 + (b + 1) * per; i++) sum += node.data[i];
      const v = Math.min(1, sum / per / 200);
      total += v;
      out.push(v);
    }
    // Silence for two seconds while playing: this browser isn't handing over samples.
    if (total === 0) {
      const now = performance.now();
      this.silentSince ??= now;
      if (now - this.silentSince > 2000) return null;
    } else this.silentSince = null;
    return out;
  }
}
