// The haptic tick (A245): a light impact in the apps, a short vibration in browsers that have one,
// and nothing with reduced motion.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const impact = vi.fn(() => Promise.resolve());
let native = false;
let reduced = false;
vi.mock("./platform", () => ({ isNative: () => native }));
vi.mock("@opencast/player", () => ({ prefersReducedMotion: () => reduced }));
vi.mock("@capacitor/haptics", () => ({ Haptics: { impact }, ImpactStyle: { Light: "LIGHT" } }));

const { tick, TICK_MS } = await import("./haptics");

let vibrate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  native = false;
  reduced = false;
  impact.mockClear();
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
});
afterEach(() => {
  // jsdom has no vibrate of its own.
  delete (navigator as { vibrate?: unknown }).vibrate;
});

describe("the haptic tick", () => {
  it("in the apps is Capacitor's light impact", async () => {
    native = true;
    tick();
    await vi.waitFor(() => expect(impact).toHaveBeenCalledWith({ style: "LIGHT" }));
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("in a browser that can vibrate (Android's) is a short vibration", () => {
    tick();
    expect(vibrate).toHaveBeenCalledWith(TICK_MS);
  });

  it("in a browser with no vibration (an iPhone's) is nothing, and no error", () => {
    delete (navigator as { vibrate?: unknown }).vibrate;
    expect(() => tick()).not.toThrow();
  });

  it("is off with reduced motion", () => {
    reduced = true;
    tick();
    native = true;
    tick();
    expect(vibrate).not.toHaveBeenCalled();
    expect(impact).not.toHaveBeenCalled();
  });
});
