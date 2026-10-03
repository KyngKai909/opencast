// The swipe home in the engine (A245; swipe home 08): channel up and down along the swipe's order
// (presets, then the dial), the next and previous kept warm with the dial's first while in the
// presets, a swipe that showed a ready picture changing channel with no static, one that wasn't
// ready getting the usual static, the peek, and sound held until the first tap (Muted previews).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerEngine, type EngineOptions } from "./PlayerEngine";
import { orderIds, swipeOrder } from "../order";
import { fakeDriver, flush, frameDelay, stalled, station, stubMedia, until } from "../test-helpers";
import { MIN_STATIC_MS } from "../tuning/constants";

const CIVC = station("CIVC", "7.1");
const CITY = station("CITY", "9.1");
const BEAT = station("BEAT", "12.1");
const SAZN = station("SAZN", "18.1");
const REEL = station("REEL", "24.1");
const DARK = station("DARK", "40.1", { onAir: false });
const NITE = station("NITE", "88.4", { band: "radio" });
const HALL = station("HALL", "90.8", { band: "radio" });
const dial = [CIVC, CITY, BEAT, SAZN, REEL, DARK, NITE, HALL];
const id = (c: typeof CIVC) => c.station.id;

let engine: PlayerEngine;
let host: HTMLDivElement;
const visible = () => [...host.querySelectorAll("video.is-on")].map((v) => (v as HTMLVideoElement).dataset.station);
const videoOf = (c: typeof CIVC) => host.querySelector<HTMLVideoElement>(`video[data-station="${c.station.id}"]`);

/** Presets BEAT and SAZN: TV is BEAT, SAZN, then CIVC, CITY, REEL, DARK. */
function make(o: EngineOptions = {}) {
  engine = new PlayerEngine({ driver: fakeDriver(), warm: "buffer", bannerMs: 5000, reducedMotion: () => false, ...o });
  engine.attach(host);
  engine.setChannels(dial);
  const presets = [id(BEAT), id(SAZN)];
  engine.setOrder([orderIds(swipeOrder(dial, presets, "tv")), orderIds(swipeOrder(dial, presets, "radio"))]);
  return engine;
}

beforeEach(() => {
  vi.useFakeTimers();
  stubMedia();
  for (const k of Object.keys(frameDelay)) delete frameDelay[k];
  stalled.clear();
  host = document.createElement("div");
});
afterEach(() => {
  engine?.destroy();
  vi.useRealTimers();
});

describe("the order", () => {
  it("channel up and down go along it, from the last preset into the dial and wrapping back to preset 1", async () => {
    make();
    await until(engine.tune(id(SAZN)));
    expect(engine.stepFrom(id(SAZN), "up")?.station.callSign).toBe("CIVC");
    expect(engine.stepFrom(id(SAZN), "down")?.station.callSign).toBe("BEAT");
    expect(engine.stepFrom(id(DARK), "up")?.station.callSign).toBe("BEAT");
    expect(engine.stepFrom(id(NITE), "down")?.station.callSign).toBe("HALL");
    engine.handle({ type: "channel", dir: "up" });
    expect(engine.getState().pendingId).toBe(id(CIVC));
  });

  it("without one (the web, TV mode), they follow channel order", async () => {
    make();
    engine.setOrder(null);
    expect(engine.stepFrom(id(SAZN), "up")?.station.callSign).toBe("REEL");
    expect(engine.stepFrom(id(BEAT), "down")?.station.callSign).toBe("CITY");
  });

  it("keeps the next and previous warm, and the dial's first while in the presets", async () => {
    make();
    await until(engine.tune(id(BEAT)));
    await flush(10);
    const warm = engine.getState().warm.map((w) => w.stationId).sort();
    // Next is SAZN, previous wraps to DARK (off air, so nothing to warm), and CIVC starts the dial.
    expect(warm).toEqual([id(SAZN), id(CIVC)].sort());
  });
});

describe("a swipe", () => {
  it("to a ready picture changes channel with no static, the old picture quiet at once, the banner straight away", async () => {
    make();
    await until(engine.tune(id(BEAT)));
    await flush(1000);
    expect(engine.swipeReady(id(SAZN))).toBe(true);
    const t = engine.swipeTo(id(SAZN));
    expect(engine.getState().tuning).toBeNull();
    expect(videoOf(BEAT)!.muted).toBe(true);
    expect(engine.getState().banner?.stationId).toBe(id(SAZN));
    await flush(20);
    await t;
    // No 300 ms minimum: the new picture is on as soon as it has a frame.
    expect(visible()).toEqual([id(SAZN)]);
    expect(engine.getState()).toMatchObject({ currentId: id(SAZN), status: "playing" });
  });

  it("to one that isn't ready yet gets the usual static, which stays until its first frame", async () => {
    make();
    await until(engine.tune(id(BEAT)));
    await flush(1000);
    // REEL is two away: nothing warm for it.
    expect(engine.swipeReady(id(REEL))).toBe(false);
    frameDelay[id(REEL)] = 600;
    void engine.swipeTo(id(REEL));
    expect(engine.getState().tuning).toMatchObject({ stationId: id(REEL), look: "static" });
    await flush(MIN_STATIC_MS + 100);
    expect(engine.getState().tuning).not.toBeNull();
    expect(visible()).toEqual([id(BEAT)]);
    await flush(400);
    expect(visible()).toEqual([id(REEL)]);
  });

  it("to an off-air station is ready (it shows its off-air screen)", async () => {
    make();
    await until(engine.tune(id(BEAT)));
    expect(engine.swipeReady(id(DARK))).toBe(true);
    await engine.swipeTo(id(DARK));
    expect(engine.getState()).toMatchObject({ currentId: id(DARK), status: "off_air", tuning: null });
  });

  it("with reduced motion is the 200 ms crossfade", async () => {
    make({ reducedMotion: () => true });
    await until(engine.tune(id(BEAT)));
    await flush(1000);
    void engine.swipeTo(id(SAZN));
    expect(engine.getState().tuning?.look).toBe("fade");
  });

  it("on the radio band keeps the needle sweep", async () => {
    make();
    await until(engine.tune(id(NITE)));
    await flush(1000);
    void engine.swipeTo(id(HALL));
    expect(engine.getState().tuning?.look).toBe("sweep");
  });
});

describe("the peek", () => {
  it("shows the next station's warm picture beside this one, and puts it away", async () => {
    make();
    await until(engine.tune(id(BEAT)));
    await flush(10);
    expect(engine.peek(id(SAZN))).toBe(true);
    expect(videoOf(SAZN)!.classList.contains("is-peek")).toBe(true);
    expect(videoOf(SAZN)!.muted).toBe(true);
    expect(engine.peek(id(REEL))).toBe(false);
    expect(videoOf(SAZN)!.classList.contains("is-peek")).toBe(false);
    engine.peek(null);
    expect(host.querySelectorAll("video.is-peek")).toHaveLength(0);
  });
});

describe("Muted previews", () => {
  it("plays on muted with Tap for sound until the first tap", async () => {
    make();
    await until(engine.tune(id(BEAT)));
    engine.holdSound();
    expect(engine.getState().mutedByBrowser).toBe(true);
    expect(videoOf(BEAT)!.muted).toBe(true);
    engine.setMuted(false);
    expect(engine.getState().mutedByBrowser).toBe(false);
    expect(videoOf(BEAT)!.muted).toBe(false);
  });
});
