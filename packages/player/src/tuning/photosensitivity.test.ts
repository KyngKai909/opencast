// The photosensitivity test (WCAG 2.3.1, a hard limit): no full-screen brightness change larger
// than 10% more than 3 times a second, and the static's own rules (grain within 15% of the
// ground's brightness, at a constant average brightness).
//
// The method (also in packages/player/README.md, "The photosensitivity test"):
// 1. The static's frames: the painter's field for a TV-sized picture (1920 × 1080 → 960 × 540
//    grains of 2 px), composed on the CPU with exactly the blits the canvas draws, for 10 seconds
//    at 24 frames a second. Each frame's average relative luminance (WCAG's formula) is the same,
//    to within floating-point error; every grain is within 0.15 of the ground's luminance; and the
//    frame-to-frame series has no transitions at all.
// 2. The whole screen over time: the real engine (fake media, frames arriving after a chosen
//    delay) is driven with the worst presses there are (holding the button, pressing as fast as
//    the static clears, random presses) between white pictures, as far from the static and the
//    dim as a picture can be, so every cover and every clear counts. The screen's luminance is sampled every 10 ms
//    from what the player draws (the picture, the static's average, the roll's progress, the
//    reduced-motion dim and crossfade, Stand by), transitions of 10% or more are counted (flash.ts),
//    and no one-second window may hold more than 3.
// 3. The detector itself catches a 4 Hz strobe, so a pass means something.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerEngine } from "../engine/PlayerEngine";
import { fakeDriver, frameDelay, station, stubMedia } from "../test-helpers";
import { CROSSFADE_DIM, CROSSFADE_MS, FLASH_MAX_CHANGES, FLASH_THRESHOLD, FLASH_WINDOW_MS, GRAIN_FPS, GRAIN_GROUND_TOLERANCE, ROLL_MS, SCREEN_GROUNDS } from "./constants";
import { mostInWindow, transitions } from "./flash";
import { composeFrame, frameLuminance, GRAIN_LUMINANCE, grainField, grainSize, hexLuminance, nextOffset, seededRandom, wrapBlits } from "./grain";

const SATURDAY_842PM = new Date("2026-09-27T03:42:00Z");

describe("the static's frames", () => {
  const { w, h } = grainSize(1920, 1080);
  const random = seededRandom(842);
  const field = grainField(w, h, random);
  const seconds = 10;
  const frames: number[] = [];
  const frame = new Uint8Array(w * h);
  for (let i = 0; i < seconds * GRAIN_FPS; i++) {
    const [ox, oy] = nextOffset(w, h, random);
    frames.push(frameLuminance(composeFrame(field, w, h, ox, oy, frame)));
  }

  it("is 2 px grain: a 1920 × 1080 picture has 960 × 540 grains", () => {
    expect({ w, h }).toEqual({ w: 960, h: 540 });
  });

  it("every frame is a new arrangement of the same grains, drawn with four blits that cover the frame once", () => {
    for (const [ox, oy] of [[0, 0], [1, 1], [480, 270], [959, 539], [123, 456]] as const) {
      const bl = wrapBlits(w, h, ox, oy);
      expect(bl.reduce((a, b) => a + b.w * b.h, 0)).toBe(w * h);
      expect(bl.length).toBeLessThanOrEqual(4);
    }
    const a = composeFrame(field, w, h, 100, 50);
    const b = composeFrame(field, w, h, 700, 300);
    // Different where each grain is...
    let moved = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) moved++;
    expect(moved / a.length).toBeGreaterThan(0.9);
    // ...and exactly the same grains.
    expect([...a].sort()).toEqual([...b].sort());
  });

  it("keeps a constant average brightness: every frame's average luminance is the same", () => {
    const min = Math.min(...frames);
    const max = Math.max(...frames);
    expect(max - min).toBeLessThan(1e-9);
  });

  it("has no brightness change at all from frame to frame, let alone one of 10%", () => {
    const series = frames.flatMap((l) => [l, l]); // 48 samples a second, each frame held twice
    expect(transitions(series, 1000 / 48)).toEqual([]);
  });

  it("stays within 15% of the ground's brightness, grain by grain, on both grounds", () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of new Set(field)) {
      lo = Math.min(lo, GRAIN_LUMINANCE[v]!);
      hi = Math.max(hi, GRAIN_LUMINANCE[v]!);
    }
    for (const ground of SCREEN_GROUNDS) {
      const g = hexLuminance(ground);
      expect(Math.abs(hi - g)).toBeLessThanOrEqual(GRAIN_GROUND_TOLERANCE);
      expect(Math.abs(lo - g)).toBeLessThanOrEqual(GRAIN_GROUND_TOLERANCE);
      // The static coming up over an empty screen is no flash either.
      expect(Math.abs(frames[0]! - g)).toBeLessThan(FLASH_THRESHOLD);
    }
  });
});

describe("the whole screen while changing channel", () => {
  // Six channels, every picture white: the static (and the dim) are as far from every picture
  // as they can be, so every cover coming up and every clear is a change of 10% and more.
  const chans = ["WHTA", "WHTB", "WHTC", "WHTD", "WHTE", "WHTF"].map((cs, i) => station(cs, `${i + 2}.1`));
  const pictureOf = (id: string | null) => (chans.some((c) => c.station.id === id) ? 1 : hexLuminance(SCREEN_GROUNDS[0]!));
  const ground = hexLuminance(SCREEN_GROUNDS[0]!);
  // The static's average (the painter's grain, measured as above).
  const staticLum = (() => {
    const f = grainField(480, 270, seededRandom(1));
    return frameLuminance(f);
  })();
  const dimmed = (p: number) => p * CROSSFADE_DIM + ground * (1 - CROSSFADE_DIM);

  let engine: PlayerEngine;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SATURDAY_842PM);
    stubMedia();
    for (const k of Object.keys(frameDelay)) delete frameDelay[k];
  });
  afterEach(() => {
    engine.destroy();
    vi.useRealTimers();
  });

  /**
   * Runs presses (ms from the start: "up" or "down") with frames arriving `latency` ms after a
   * deck starts, sampling the screen's luminance every 10 ms for `ms`. Returns the samples.
   */
  async function run(o: { presses: Array<[number, "up" | "down"]>; latency: number | ((id: string) => number); ms: number; reduced?: boolean }) {
    engine = new PlayerEngine({ driver: fakeDriver(), warm: "none", reducedMotion: () => !!o.reduced });
    engine.attach(document.createElement("div"));
    engine.setChannels(chans);
    for (const c of chans) frameDelay[c.station.id] = typeof o.latency === "number" ? o.latency : o.latency(c.station.id);
    // On air on the first channel before anything starts.
    const first = engine.tune(chans[0]!.station.id);
    await vi.advanceTimersByTimeAsync(o.latency === 0 ? 10 : 2000);
    await first;
    const start = Date.now();
    const step = 10;
    const samples: number[] = [];
    let queue = [...o.presses].sort((a, b) => a[0] - b[0]);
    // The screen just before the cover came up (what dims, with reduced motion), and the screen
    // when it started clearing, and when.
    let lastSince = -1;
    let coverUnder = pictureOf(engine.getState().currentId);
    let clearFrom: number | null = null;
    let clearAt = 0;
    let last = coverUnder;
    for (let t = 0; t <= o.ms; t += step) {
      while (queue.length && queue[0]![0] <= t) {
        engine.handle({ type: "channel", dir: queue[0]![1] });
        queue = queue.slice(1);
      }
      const s = engine.getState();
      const tu = s.tuning;
      const now = Date.now();
      let lum: number;
      if (s.status === "standby") lum = ground + 0.02; // the Slate, with its bars across the top 12%
      else if (!tu) {
        lum = pictureOf(s.currentId);
        clearFrom = null;
      } else if (tu.phase !== "clearing") {
        clearFrom = null;
        if (tu.since !== lastSince) {
          lastSince = tu.since;
          coverUnder = last;
        }
        if (tu.look === "fade") {
          // The old picture dims over the crossfade's length.
          const q = Math.min(1, (now - tu.since) / CROSSFADE_MS);
          lum = coverUnder + (dimmed(coverUnder) - coverUnder) * q;
        } else lum = staticLum; // the static covers it at once
      } else {
        if (clearFrom === null) {
          clearFrom = last;
          clearAt = now;
        }
        // The roll (or the crossfade) is linear.
        const p = Math.min(1, (now - clearAt) / (tu.look === "fade" ? CROSSFADE_MS : ROLL_MS));
        lum = clearFrom + (pictureOf(s.currentId) - clearFrom) * p;
      }
      samples.push(lum);
      last = lum;
      await vi.advanceTimersByTimeAsync(step);
    }
    expect(Date.now() - start).toBeGreaterThanOrEqual(o.ms);
    return samples;
  }

  const every = (gap: number, until: number, dir: "up" | "down" = "up") => Array.from({ length: Math.floor(until / gap) + 1 }, (_, i) => [i * gap, dir] as [number, "up" | "down"]);
  const check = (samples: number[]) => {
    const ts = transitions(samples, 10);
    const most = mostInWindow(ts, FLASH_WINDOW_MS);
    return { most, count: ts.length };
  };

  it("holding the button down (a press every 50 ms for 3 s): the static stays up, one change in and one out", async () => {
    const r = check(await run({ presses: every(50, 3000), latency: 0, ms: 6000 }));
    expect(r.most).toBeLessThanOrEqual(FLASH_MAX_CHANGES);
    expect(r.count).toBeLessThanOrEqual(3);
  });

  for (const gap of [150, 250, 300, 350, 400, 460, 480, 500, 600, 700, 800, 1000, 1200]) {
    it(`a press every ${gap} ms for 6 s, pictures arriving at once: at most ${FLASH_MAX_CHANGES} changes in any second`, async () => {
      const r = check(await run({ presses: every(gap, 6000), latency: 0, ms: 9000 }));
      expect(r.most).toBeLessThanOrEqual(FLASH_MAX_CHANGES);
      expect(r.count).toBeGreaterThan(0);
    });
  }

  for (const latency of [50, 200, 700, 1500]) {
    it(`presses every 400 to 900 ms with pictures taking ${latency} ms`, async () => {
      const rnd = seededRandom(latency);
      const presses: Array<[number, "up" | "down"]> = [];
      for (let t = 0; t < 8000; t += 400 + Math.floor(rnd() * 500)) presses.push([t, rnd() < 0.7 ? "up" : "down"]);
      const r = check(await run({ presses, latency, ms: 11_000 }));
      expect(r.most).toBeLessThanOrEqual(FLASH_MAX_CHANGES);
    });
  }

  it("random presses for 20 s (seeded), with bursts, and one channel slow to arrive", async () => {
    const rnd = seededRandom(20260927);
    const presses: Array<[number, "up" | "down"]> = [];
    for (let t = 0; t < 20_000; ) {
      presses.push([t, rnd() < 0.6 ? "up" : "down"]);
      t += rnd() < 0.3 ? 30 + Math.floor(rnd() * 120) : 150 + Math.floor(rnd() * 1200);
    }
    const r = check(await run({ presses, latency: (id) => (id.endsWith("3") ? 900 : 60), ms: 23_000 }));
    expect(r.most).toBeLessThanOrEqual(FLASH_MAX_CHANGES);
  });

  for (const gap of [210, 300, 450, 600]) {
    it(`reduced motion (the dim and crossfade), a press every ${gap} ms`, async () => {
      const r = check(await run({ presses: every(gap, 6000), latency: 0, ms: 9000, reduced: true }));
      expect(r.most).toBeLessThanOrEqual(FLASH_MAX_CHANGES);
    });
  }

  it("a change that reaches Stand by and then comes back", async () => {
    const r = check(await run({ presses: [[0, "up"], [9500, "up"], [9700, "down"]], latency: (id) => (id === chans[1]!.station.id ? 9000 : 0), ms: 12_000 }));
    expect(r.most).toBeLessThanOrEqual(FLASH_MAX_CHANGES);
  });

  it("the detector catches a strobe (4 Hz between white and black), so passing means something", () => {
    const strobe = Array.from({ length: 200 }, (_, i) => (Math.floor(i / 12.5) % 2 ? 1 : 0));
    expect(mostInWindow(transitions(strobe, 10))).toBeGreaterThan(FLASH_MAX_CHANGES);
    // A change under 10% never counts, however often.
    const wobble = Array.from({ length: 200 }, (_, i) => (i % 2 ? 0.5 : 0.45));
    expect(transitions(wobble, 10)).toEqual([]);
  });
});
