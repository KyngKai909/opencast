// Changing channel on the surface (follow-up Phase 5): what's drawn for each look and phase, the
// corner number beside number entry, Stand by with the colour bars, the radio band's needle, and
// the painter's 24 frames a second of four blits each.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { PlayerEngine, type EngineOptions } from "../engine/PlayerEngine";
import { fakeDriver, flush, frameDelay, stalled, station, stubMedia, until } from "../test-helpers";
import { GRAIN_FPS, ROLL_MS, STANDBY_MS, TUNING_IN_MS } from "../tuning/constants";
import { GrainPainter } from "../tuning/grain";
import { PlayerProvider } from "./context";
import { PlayerSurface } from "./PlayerSurface";

const SATURDAY_842PM = new Date("2026-09-27T03:42:00Z");
const CIVC = station("CIVC", "7.1");
const BEAT = station("BEAT", "12.1");
const NITE = station("NITE", "88.3", { band: "radio" });
const sola = station("SOLA", "94.7", { band: "radio" });
const SOLA = { ...sola, station: { ...sola.station, colour: "#A3402A" } };

let engine: PlayerEngine;
let drawn: number;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(SATURDAY_842PM);
  stubMedia();
  for (const k of Object.keys(frameDelay)) delete frameDelay[k];
  stalled.clear();
  drawn = 0;
  // A 1920 × 1080 picture (jsdom lays nothing out).
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 1920, bottom: 1080, width: 1920, height: 1080, toJSON: () => ({}) } as DOMRect);
  // jsdom has no canvas: a 2D context that counts blits.
  HTMLCanvasElement.prototype.getContext = function () {
    return {
      imageSmoothingEnabled: true,
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: () => {},
      drawImage: () => void drawn++
    } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  engine.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function surface(o: EngineOptions = {}, channels = [CIVC, BEAT], first = CIVC, size: "web" | "tv" = "tv") {
  engine = new PlayerEngine({ driver: fakeDriver(), warm: "none", bannerMs: 5000, reducedMotion: () => false, ...o });
  engine.setChannels(channels);
  const r = render(
    <PlayerProvider engine={engine}>
      <PlayerSurface size={size} />
    </PlayerProvider>
  );
  await act(async () => {
    await until(engine.tune(first.station.id));
    await flush(1000);
  });
  return r;
}
const press = (dir: "up" | "down" = "up") => act(() => engine.handle({ type: "channel", dir }));
const advance = (ms: number) => act(() => flush(ms));

describe("the static look", () => {
  it("the corner number and the static on the press; the name and \"Tuning in\" at 800 ms; the roll; the banner after", async () => {
    const { container } = await surface();
    const root = container.querySelector(".oc-player") as HTMLElement;
    // The timings reach the CSS from the one constants file.
    expect(root.style.getPropertyValue("--oc-tune-roll")).toBe(`${ROLL_MS}ms`);
    // A slow BEAT.
    frameDelay[BEAT.station.id] = 1500;
    await act(async () => {
      engine.hideBanner();
    });
    await press();
    expect(root.dataset.tune).toBe("static");
    const osd = container.querySelector(".oc-tune__osd")!;
    expect(osd.textContent).toBe("12.1BEAT");
    expect(osd.getAttribute("aria-label")).toBe("Tuning to BEAT 12.1");
    expect(container.querySelector("[data-testid=tuning-static]")).not.toBeNull();
    expect(container.querySelector(".oc-banner")).toBeNull();
    expect(container.querySelector(".oc-tune__hold")).toBeNull();
    // The first frame was painted before the browser drew: four blits or fewer.
    expect(drawn).toBeGreaterThan(0);
    await advance(TUNING_IN_MS);
    expect(container.querySelector(".oc-tune__hold")?.textContent).toBe("BEAT nowTuning in");
    await advance(1500 - TUNING_IN_MS + 20);
    expect(container.querySelector(".oc-tune__static.is-rolling")).not.toBeNull();
    // The number goes as the static rolls away.
    expect(container.querySelector(".oc-tune__osd")).toBeNull();
    await advance(ROLL_MS);
    expect(container.querySelector("[data-testid=tuning]")).toBeNull();
    expect(root.dataset.tune).toBeUndefined();
    expect(container.querySelector(".oc-banner .oc-banner__cs")?.textContent).toBe("BEAT");
  });

  it("the number steps aside for number entry (its panel sits there)", async () => {
    const { container } = await surface();
    await press();
    expect(container.querySelector(".oc-tune__osd")).not.toBeNull();
    await act(() => engine.handle({ type: "digit", digit: 7 }));
    expect(container.querySelector(".oc-tune__osd")).toBeNull();
    expect(container.querySelector(".oc-numpad")).not.toBeNull();
    // The static is still up.
    expect(container.querySelector("[data-testid=tuning-static]")).not.toBeNull();
  });
});

describe("reduced motion", () => {
  it("no grain: a dim and a crossfade, with the same corner number through it", async () => {
    const { container } = await surface({ reducedMotion: () => true });
    await press();
    expect(container.querySelector("[data-testid=tuning-static]")).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector(".oc-tune__dim")).not.toBeNull();
    expect(container.querySelector(".oc-tune__osd")?.textContent).toBe("12.1BEAT");
    await advance(200);
    expect(container.querySelector(".oc-tune.is-clearing")).not.toBeNull();
    expect(container.querySelector(".oc-tune__osd")).not.toBeNull();
    await advance(200);
    expect(container.querySelector("[data-testid=tuning]")).toBeNull();
  });
});

describe("Stand by", () => {
  it("after 8 s: the colour bars, Please stand by, and what's happening", async () => {
    const { container } = await surface();
    stalled.add(BEAT.station.id);
    await press();
    await advance(STANDBY_MS);
    const sb = container.querySelector("[data-testid=standby]")!;
    expect(sb.querySelector(".oc-bars")).not.toBeNull();
    expect(sb.querySelector(".oc-slate__big")?.textContent).toBe("Please stand by");
    expect(sb.textContent).toContain("The signal from BEAT 12.1 isn't coming through. Trying again.");
    expect(container.querySelector("[data-testid=tuning]")).toBeNull();
    stalled.clear();
  });
});

describe("the radio band", () => {
  it("the new frequency at once, over the old station's colour, with the band and its needle; \"Tuning in\" after 800 ms", async () => {
    frameDelay[SOLA.station.id] = 1500;
    const { container } = await surface({}, [NITE, SOLA], NITE);
    await press();
    const radio = container.querySelector(".oc-radio") as HTMLElement;
    expect(radio.classList.contains("oc-radio--tuning")).toBe(true);
    expect(container.querySelector(".oc-radio__f")?.textContent).toBe("94.7");
    expect(container.querySelector(".oc-radio__cs")?.textContent).toBe("SOLA");
    // NITE's colour until SOLA's sound is there.
    expect(radio.style.background).toBe("rgb(140, 59, 122)");
    const needle = container.querySelector(".oc-radio__needle-track") as HTMLElement;
    expect(needle.style.transform).toBe(`translateX(${((94.7 - 88) / 20) * 100}%)`);
    // No static on the radio band.
    expect(container.querySelector("[data-testid=tuning-static]")).toBeNull();
    await advance(TUNING_IN_MS);
    expect(container.querySelector(".oc-radio__hold")?.textContent).toBe("Tuning in");
    await advance(1000);
    expect(container.querySelector("[data-testid=radio-band]")).toBeNull();
    // SOLA's sound is there: its colour, once.
    expect((container.querySelector(".oc-radio") as HTMLElement).style.background).toBe("rgb(163, 64, 42)");
  });
});

describe("the painter", () => {
  it("draws a frame with four blits at most, and 24 frames a second on a 60 Hz display", () => {
    const canvas = document.createElement("canvas");
    const p = new GrainPainter(canvas);
    p.resize(1920, 1080);
    expect([canvas.width, canvas.height]).toEqual([960, 540]);
    const first = drawn;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(4);
    // A 60 Hz requestAnimationFrame for 3 seconds.
    let cb: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => ((cb = f), 1));
    vi.stubGlobal("cancelAnimationFrame", () => (cb = null));
    p.start();
    const before = p.frames;
    for (let i = 1; i <= 180; i++) cb!(i * (1000 / 60));
    p.stop();
    const perSecond = (p.frames - before) / 3;
    expect(perSecond).toBeGreaterThanOrEqual(GRAIN_FPS - 1);
    expect(perSecond).toBeLessThanOrEqual(GRAIN_FPS + 1);
    // No new field while the size stays the same.
    p.resize(1920, 1080);
    expect(canvas.width).toBe(960);
    vi.unstubAllGlobals();
  });
});
