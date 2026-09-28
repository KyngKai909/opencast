// Real sound levels for the level meter (the radio screen's "moves with the sound"), from the
// playing <video> through Web Audio. The device playing the sound is the one measuring: the TV
// app, the Cast receiver, or the phone.
//
// - A media element can be routed into Web Audio only once, so each keeps its source node.
// - Audio only flows through the graph while the AudioContext is running, which most browsers
//   allow after a gesture: the engine unlocks it on the first command someone gives.
// - Where the browser gives no samples (native HLS on iPhone), levels() returns null and the
//   meter falls back to its rhythm.

type Ctx = AudioContext;

export class AudioLevels {
  private ctx: Ctx | null = null;
  private sources = new WeakMap<HTMLMediaElement, { analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> }>();
  private current: HTMLMediaElement | null = null;
  private silentSince: number | null = null;

  private context(): Ctx | null {
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

  /** Measures this element from now on (the one on screen). Only once the context runs. */
  measure(el: HTMLMediaElement) {
    this.current = el;
    this.silentSince = null;
    if (this.ctx?.state === "running") this.connect(el);
  }

  private connect(el: HTMLMediaElement) {
    if (!this.ctx || this.sources.has(el)) return;
    try {
      const source = this.ctx.createMediaElementSource(el);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      analyser.connect(this.ctx.destination);
      this.sources.set(el, { analyser, data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)) });
    } catch {
      // Already routed, or the browser refuses (cross-origin without CORS): no real levels.
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
