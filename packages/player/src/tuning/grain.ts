// The static: soft grey grain, 2 px, 24 new frames a second, at a constant average brightness.
//
// How it's drawn, cheaply enough for a TV (Android TV's WebView, Chromium 113):
// - One field of grain values is made when the picture's size is known: a canvas at half the
//   picture's CSS size (2 px grain), stretched with image-rendering: pixelated. Half of its
//   values sit above the base by some amount and half below by the same amounts, shuffled, so
//   the field's average is the base exactly.
// - Each frame shows that field shifted by a random offset, wrapping at the edges (four blits of
//   the one field, drawImage on the GPU): every grain moves somewhere new, so it reads as fresh
//   static, and every frame holds exactly the same values, so the average brightness is the same
//   in every frame by construction, not by chance. No per-frame allocation, no per-pixel work
//   on the CPU.
// composeFrame does the same blits on the CPU for the photosensitivity test.

import { GRAIN_AMPLITUDE, GRAIN_BASE, GRAIN_FPS, GRAIN_PX, GRAIN_TINT } from "./constants";

// ---------- Luminance (WCAG 2.x relative luminance) ----------

function channel(v8: number): number {
  const c = v8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an 8-bit sRGB colour, 0 (black) to 1 (white). */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function hexLuminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  return relativeLuminance((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** A grain's colour for grain value v: v, v + 2, v + 10 (the reference's grey on the navy ground). */
export function grainColour(v: number): [number, number, number] {
  const clamp = (x: number) => Math.max(0, Math.min(255, x));
  return [clamp(v + GRAIN_TINT[0]), clamp(v + GRAIN_TINT[1]), clamp(v + GRAIN_TINT[2])];
}

/** Relative luminance of every grain value 0 to 255 (a lookup for the tests' per-frame averages). */
export const GRAIN_LUMINANCE: Float64Array = (() => {
  const t = new Float64Array(256);
  for (let v = 0; v < 256; v++) t[v] = relativeLuminance(...grainColour(v));
  return t;
})();

// ---------- The field ----------

/** A small, fast, seedable random source (mulberry32), so a field can be made again in a test. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A w × h field of grain values: pairs at base + k and base - k (k up to the amplitude), shuffled,
 * so its average is exactly the base (with an odd count, one grain sits at the base itself).
 */
export function grainField(w: number, h: number, random: () => number = Math.random): Uint8Array {
  const n = w * h;
  const f = new Uint8Array(n);
  let i = 0;
  for (; i + 1 < n; i += 2) {
    const k = Math.round(random() * GRAIN_AMPLITUDE);
    f[i] = GRAIN_BASE + k;
    f[i + 1] = GRAIN_BASE - k;
  }
  if (i < n) f[i] = GRAIN_BASE;
  // Fisher–Yates, so the pairs don't sit side by side.
  for (let j = n - 1; j > 0; j--) {
    const r = Math.floor(random() * (j + 1));
    const t = f[j]!;
    f[j] = f[r]!;
    f[r] = t;
  }
  return f;
}

/** One blit: a rectangle of the field (s) drawn at (dx, dy) in the frame. */
export interface Blit {
  sx: number;
  sy: number;
  w: number;
  h: number;
  dx: number;
  dy: number;
}

/**
 * The blits that show the field shifted by (ox, oy), wrapping at the edges: the frame's (x, y)
 * shows the field's ((x + ox) mod w, (y + oy) mod h). Empty rectangles are left out.
 */
export function wrapBlits(w: number, h: number, ox: number, oy: number): Blit[] {
  const x = ((ox % w) + w) % w;
  const y = ((oy % h) + h) % h;
  const all: Blit[] = [
    { sx: x, sy: y, w: w - x, h: h - y, dx: 0, dy: 0 },
    { sx: 0, sy: y, w: x, h: h - y, dx: w - x, dy: 0 },
    { sx: x, sy: 0, w: w - x, h: y, dx: 0, dy: h - y },
    { sx: 0, sy: 0, w: x, h: y, dx: w - x, dy: h - y }
  ];
  return all.filter((b) => b.w > 0 && b.h > 0);
}

/** A random offset that moves every grain well away from where it was (never a small slide). */
export function nextOffset(w: number, h: number, random: () => number): [number, number] {
  return [Math.floor(w / 4 + random() * (w / 2)), Math.floor(h / 4 + random() * (h / 2))];
}

/** The frame the canvas shows for an offset, composed on the CPU with the same blits (for the tests). */
export function composeFrame(field: Uint8Array, w: number, h: number, ox: number, oy: number, out: Uint8Array = new Uint8Array(w * h)): Uint8Array {
  for (const b of wrapBlits(w, h, ox, oy)) {
    for (let r = 0; r < b.h; r++) {
      const from = (b.sy + r) * w + b.sx;
      out.set(field.subarray(from, from + b.w), (b.dy + r) * w + b.dx);
    }
  }
  return out;
}

/** A frame's average relative luminance (what a whole-screen flash is measured on). */
export function frameLuminance(frame: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += GRAIN_LUMINANCE[frame[i]!]!;
  return s / frame.length;
}

/** The grain canvas's size for a picture of this CSS size: 2 px grain, within a ceiling for very large screens. */
export function grainSize(cssWidth: number, cssHeight: number): { w: number; h: number } {
  const w = Math.max(1, Math.ceil(cssWidth / GRAIN_PX));
  const h = Math.max(1, Math.ceil(cssHeight / GRAIN_PX));
  const scale = Math.min(1, 1280 / w, 720 / h);
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

// ---------- The painter ----------

/** The last field made, as a canvas, kept between channel changes. */
let fieldCache: { w: number; h: number; canvas: HTMLCanvasElement } | null = null;

/**
 * Paints the static onto a canvas: the field once (putImageData into a canvas of its own), then
 * four drawImage blits a frame at 24 frames a second.
 */
export class GrainPainter {
  private ctx: CanvasRenderingContext2D | null;
  private source: HTMLCanvasElement | null = null;
  private w = 0;
  private h = 0;
  private raf = 0;
  private last = -Infinity;
  private random: () => number;
  /** Frames painted, for the CPU measurement and tests. */
  frames = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    o: { random?: () => number } = {}
  ) {
    this.random = o.random ?? Math.random;
    this.ctx = canvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D | null;
  }

  /** The picture's CSS size: makes the field (only when the grain size changes) and paints a frame. */
  resize(cssWidth: number, cssHeight: number) {
    const { w, h } = grainSize(cssWidth, cssHeight);
    if (w === this.w && h === this.h && this.source) return;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    // The field is made once per size and kept for the next channel change (making it takes a
    // few tens of milliseconds on a TV; drawing a frame from it, a fraction of one).
    if (fieldCache && fieldCache.w === w && fieldCache.h === h) {
      this.source = fieldCache.canvas;
      this.paint();
      return;
    }
    const field = grainField(w, h, this.random);
    const src = document.createElement("canvas");
    src.width = w;
    src.height = h;
    const sctx = src.getContext("2d");
    if (!sctx) return;
    const img = sctx.createImageData(w, h);
    const px = new Uint32Array(img.data.buffer);
    // Little-endian RGBA: 0xAABBGGRR.
    const lut = new Uint32Array(256);
    for (let v = 0; v < 256; v++) {
      const [r, g, b] = grainColour(v);
      lut[v] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
    for (let i = 0; i < field.length; i++) px[i] = lut[field[i]!]!;
    sctx.putImageData(img, 0, 0);
    this.source = src;
    fieldCache = { w, h, canvas: src };
    this.paint();
  }

  /** One frame: the field at a new random offset. */
  paint() {
    const ctx = this.ctx;
    const src = this.source;
    if (!ctx || !src) return;
    const [ox, oy] = nextOffset(this.w, this.h, this.random);
    for (const b of wrapBlits(this.w, this.h, ox, oy)) ctx.drawImage(src, b.sx, b.sy, b.w, b.h, b.dx, b.dy, b.w, b.h);
    this.frames++;
  }

  /** Redraw 24 times a second until stopped (paused with the page, as requestAnimationFrame is). */
  start() {
    if (this.raf || typeof requestAnimationFrame !== "function") return;
    const every = 1000 / GRAIN_FPS;
    const tick = (t: number) => {
      // Within a couple of ms of the next 24th of a second counts (a 60 Hz display's frames land
      // on 16.7 ms steps), so the rate holds at 24 rather than dropping to 20.
      if (t - this.last >= every - 2) {
        this.last = t - this.last < every * 2 ? this.last + every : t;
        this.paint();
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
