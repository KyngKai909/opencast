// Canvases on the site (SITE-SPEC §8): each is sized to its box at devicePixelRatio (capped at 2)
// and draws in a fixed logical space (the reference's own canvas size), so pictures keep their
// proportions and stay sharp. Animation pauses off screen and in hidden tabs, and under reduced
// motion a canvas draws one still frame.

import { reducedMotion } from "./motion";

export const dpr = () => Math.min(2, window.devicePixelRatio || 1);

export interface Surface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Logical size the drawing uses. */
  w: number;
  h: number;
}

/**
 * Size `canvas` to its CSS box (or `box`, when the canvas isn't laid out by CSS) at DPR, with a
 * transform so drawing in `w`×`h` fills it. `w` is the logical width; the height follows the box.
 */
export function fit(canvas: HTMLCanvasElement, w: number, box?: { width: number; height: number }): Surface {
  // The layout size, not the drawn one: a scaled-up tile (Syndication's live carriers) would
  // otherwise get a backing store past DPR 2.
  const r = box ?? (canvas.clientWidth ? { width: canvas.clientWidth, height: canvas.clientHeight } : canvas.getBoundingClientRect());
  const bw = Math.max(1, r.width), bh = Math.max(1, r.height);
  const d = dpr();
  canvas.width = Math.round(bw * d);
  canvas.height = Math.round(bh * d);
  const h = (w * bh) / bw;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
  return { canvas, ctx, w, h };
}

/** Re-apply a surface's transform (after something reset it). */
export function reset(s: Surface): void {
  s.ctx.setTransform(s.canvas.width / s.w, 0, 0, s.canvas.height / s.h, 0, 0);
  s.ctx.globalAlpha = 1;
  s.ctx.globalCompositeOperation = "source-over";
}

export interface LoopOptions {
  /** Least milliseconds between frames (the reference's throttles: 33, 40, 50, 110). */
  every: number;
  /** Elements whose visibility gates the loop (any one on screen runs it). */
  watch: Element[];
  /** Extra gate, checked each frame. */
  when?: () => boolean;
}

/**
 * Run `frame(t)` (`t` in seconds since start) on animation frames, throttled, only while one of
 * `watch` is on screen and the tab is visible. Under reduced motion it never runs: callers draw
 * their still frame themselves.
 */
export function loop(frame: (t: number) => void, opts: LoopOptions): { stop(): void } {
  const t0 = performance.now();
  let visible = false, last = 0, id = 0, stopped = false;
  const seen = new Set<Element>();
  const io = new IntersectionObserver((es) => {
    for (const e of es) e.isIntersecting ? seen.add(e.target) : seen.delete(e.target);
    visible = seen.size > 0;
    if (visible) start();
  });
  opts.watch.forEach((el) => io.observe(el));
  const tick = (now: number) => {
    id = 0;
    if (stopped || !visible || document.hidden) return;
    id = requestAnimationFrame(tick);
    if (opts.when && !opts.when()) return;
    if (now - last < opts.every) return;
    last = now;
    frame((now - t0) / 1000);
  };
  function start() {
    if (!id && !stopped && !reducedMotion()) id = requestAnimationFrame(tick);
  }
  document.addEventListener("visibilitychange", () => !document.hidden && start());
  return {
    stop() {
      stopped = true;
      io.disconnect();
      if (id) cancelAnimationFrame(id);
    }
  };
}
