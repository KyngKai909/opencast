import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerEngine } from "./PlayerEngine";
import { fakeDriver, flush, frameDelay, station, stubMedia } from "../test-helpers";
import { startHeartbeat } from "../heartbeat";

const CIVC = station("CIVC", "7.1");
const BEAT = station("BEAT", "12.1");
const REEL = station("REEL", "24.1");
const SAZN = station("SAZN", "18.1", { onAir: false });
const dial = [CIVC, BEAT, SAZN, REEL];

let engine: PlayerEngine;
let driver: ReturnType<typeof fakeDriver>;
let host: HTMLDivElement;
const visible = () => [...host.querySelectorAll("video.is-on")].map((v) => (v as HTMLVideoElement).dataset.station);
const byId = (c: { station: { id: string } }) => c.station.id;

beforeEach(() => {
  vi.useFakeTimers();
  stubMedia();
  for (const k of Object.keys(frameDelay)) delete frameDelay[k];
  driver = fakeDriver();
  host = document.createElement("div");
  engine = new PlayerEngine({ driver, bannerMs: 5000, numberWaitMs: 2000, pauseHoldMs: 30 * 60_000 });
  engine.attach(host);
  engine.setChannels(dial);
});
afterEach(() => {
  engine.destroy();
  vi.useRealTimers();
});

describe("tuning", () => {
  it("joins and shows the picture once its first frame is on screen", async () => {
    frameDelay[CIVC.station.id] = 300;
    const done = engine.tune(CIVC.station.id);
    await flush(100);
    expect(engine.getState().pendingId).toBe(CIVC.station.id);
    expect(visible()).toEqual([]);
    await flush(300);
    await done;
    expect(engine.getState().currentId).toBe(CIVC.station.id);
    expect(engine.getState().status).toBe("playing");
    expect(visible()).toEqual([CIVC.station.id]);
  });

  it("keeps the old picture until the new one is ready", async () => {
    const first = engine.tune(CIVC.station.id);
    await flush(10);
    await first;
    frameDelay[REEL.station.id] = 800;
    const t = engine.tune(REEL.station.id);
    await flush(400);
    expect(visible()).toEqual([CIVC.station.id]);
    expect(engine.getState().pendingId).toBe(REEL.station.id);
    await flush(500);
    await t;
    expect(visible()).toEqual([REEL.station.id]);
    expect(engine.getState().lastId).toBe(CIVC.station.id);
  });

  it("warms both neighbours, skipping one that's off air, and lets go of the rest", async () => {
    const t = engine.tune(BEAT.station.id);
    await flush(10);
    await t;
    const warm = engine.getState().warm.map((w) => w.stationId).sort();
    // Up from BEAT is SAZN (off air, nothing to warm), down is CIVC.
    expect(warm).toEqual([CIVC.station.id].sort());
    const t2 = engine.tune(REEL.station.id);
    await flush(10);
    await t2;
    const warm2 = engine.getState().warm.map((w) => w.stationId).sort();
    expect(warm2).toEqual([CIVC.station.id, SAZN.station.id].filter((id) => id !== SAZN.station.id).sort());
    expect(driver.handles.filter((h) => !h.destroyed).length).toBeLessThanOrEqual(3);
  });

  it("switches from a warm neighbour and says it was warm", async () => {
    const t = engine.tune(BEAT.station.id);
    await flush(10);
    await t;
    const t2 = engine.tune(CIVC.station.id);
    await flush(10);
    await t2;
    expect(engine.getState().lastTune).toMatchObject({ stationId: CIVC.station.id, warm: true });
  });

  it("a newer channel change wins over one still arriving", async () => {
    frameDelay[BEAT.station.id] = 1000;
    const a = engine.tune(BEAT.station.id);
    await flush(50);
    const b = engine.tune(REEL.station.id);
    await flush(1100);
    await Promise.all([a, b]);
    expect(engine.getState().currentId).toBe(REEL.station.id);
    expect(visible()).toEqual([REEL.station.id]);
  });

  it("an off-air station is a place on the dial, not a dead end", async () => {
    await engine.tune(SAZN.station.id);
    expect(engine.getState()).toMatchObject({ currentId: SAZN.station.id, status: "off_air" });
    engine.handle({ type: "channel", dir: "up" });
    await flush(10);
    expect(engine.getState().currentId).toBe(REEL.station.id);
  });

  it("shows the banner on every change for five seconds", async () => {
    const t = engine.tune(CIVC.station.id);
    expect(engine.getState().banner?.stationId).toBe(CIVC.station.id);
    await flush(10);
    await t;
    await flush(4900);
    expect(engine.getState().banner).not.toBeNull();
    await flush(200);
    expect(engine.getState().banner).toBeNull();
  });
});

describe("attaching", () => {
  it("a tune asked for before the surface attaches runs once it does", async () => {
    const e = new PlayerEngine({ driver: fakeDriver() });
    e.setChannels(dial);
    void e.tune(BEAT.station.id);
    expect(e.getState().pendingId).toBe(BEAT.station.id);
    e.attach(document.createElement("div"));
    await flush(10);
    expect(e.getState()).toMatchObject({ currentId: BEAT.station.id, status: "playing" });
    e.destroy();
  });
});

describe("number entry", () => {
  it("1, 2 tunes 12.1 after the wait", async () => {
    engine.handle({ type: "digit", digit: 1 });
    engine.handle({ type: "digit", digit: 2 });
    expect(engine.getState().entry?.match?.station.callSign).toBe("BEAT");
    await flush(1900);
    expect(engine.getState().currentId).toBeNull();
    await flush(200);
    expect(engine.getState().currentId).toBe(BEAT.station.id);
    expect(engine.getState().entry).toBeNull();
  });
  it("OK tunes at once", async () => {
    engine.handle({ type: "digit", digit: 7 });
    engine.handle({ type: "select" });
    await flush(10);
    expect(engine.getState().currentId).toBe(CIVC.station.id);
  });
  it("a number with no station stays on the current channel", async () => {
    const t = engine.tune(CIVC.station.id);
    await flush(10);
    await t;
    engine.handle({ type: "digit", digit: 1 });
    engine.handle({ type: "digit", digit: 3 });
    await flush(2100);
    expect(engine.getState().currentId).toBe(CIVC.station.id);
    expect(engine.getState().entry?.match).toBeNull();
    expect(engine.getState().entry?.nearest.map((c) => c.station.callSign)).toEqual(["BEAT", "SAZN"]);
  });
});

describe("pause", () => {
  it("holds for 30 minutes, then offers Back to live", async () => {
    const t = engine.tune(CIVC.station.id);
    await flush(10);
    await t;
    engine.handle({ type: "pause" });
    expect(engine.getState().status).toBe("paused");
    await flush(29 * 60_000);
    expect(engine.getState().paused?.expired).toBe(false);
    await flush(60_000 + 10);
    expect(engine.getState().paused?.expired).toBe(true);
    engine.handle({ type: "play" }); // Play after the hold is Back to live.
    expect(engine.getState()).toMatchObject({ status: "playing", paused: null });
  });
});

describe("OK and Back on the picture", () => {
  it("OK shows the banner; OK again opens the guide", async () => {
    const onCommand = vi.fn();
    const e = new PlayerEngine({ driver: fakeDriver(), onCommand });
    e.attach(document.createElement("div"));
    e.setChannels(dial);
    const t = e.tune(CIVC.station.id);
    await flush(10);
    await t;
    e.hideBanner();
    e.handle({ type: "select" });
    expect(e.getState().banner).not.toBeNull();
    e.handle({ type: "select" });
    expect(onCommand).toHaveBeenCalledWith({ type: "guide" }, undefined);
    e.destroy();
  });
});

describe("sleep timer", () => {
  it("fades over the last minute, then stops Opencast", async () => {
    const t = engine.tune(CIVC.station.id);
    await flush(10);
    await t;
    engine.sleep(2);
    await flush(61_000);
    expect(engine.getState().sleep?.fading).toBe(true);
    await flush(60_000);
    expect(engine.getState().status).toBe("stopped");
    // Watching again tunes the same station from scratch.
    const again = engine.tune(CIVC.station.id);
    await flush(10);
    await again;
    expect(engine.getState().status).toBe("playing");
    expect(engine.getState().currentId).toBe(CIVC.station.id);
  });
  it("any press during the fade cancels it", async () => {
    const t = engine.tune(CIVC.station.id);
    await flush(10);
    await t;
    engine.sleep(1);
    await flush(2000);
    expect(engine.getState().sleep?.fading).toBe(true);
    engine.handle({ type: "info" });
    expect(engine.getState().sleep).toBeNull();
  });
});

describe("the heartbeat", () => {
  it("beats when a picture arrives, then every 30 seconds, with station and session", async () => {
    const send = vi.fn().mockResolvedValue({ nextInMs: 30_000 });
    const stop = startHeartbeat(engine, send, "web", "11111111-1111-4111-8111-111111111111");
    const t = engine.tune(BEAT.station.id);
    await flush(10);
    await t;
    await flush(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ stationId: BEAT.station.id, sessionId: "11111111-1111-4111-8111-111111111111", platform: "web", playing: true });
    await flush(30_000);
    expect(send).toHaveBeenCalledTimes(2);
    engine.handle({ type: "pause" });
    await flush(30_000);
    expect(send.mock.calls[2][0].playing).toBe(false);
    stop();
    await flush(60_000);
    expect(send).toHaveBeenCalledTimes(3);
  });
});

void byId;

describe("captions above the banner", () => {
  it("counts enough caption lines up from the bottom to clear the lift, at each size", async () => {
    const { captionLineFor, CAPTION_SCALE } = await import("./PlayerEngine");
    // Medium at 16:9: a line is about 9.7% of the height; clearing 36% takes line -5.
    expect(captionLineFor(36, CAPTION_SCALE.medium, 16 / 9)).toBe(-5);
    expect(captionLineFor(45, CAPTION_SCALE.medium, 16 / 9)).toBe(-6);
    expect(captionLineFor(36, CAPTION_SCALE.large, 16 / 9)).toBe(-4);
    expect(captionLineFor(36, CAPTION_SCALE.small, 16 / 9)).toBe(-6);
  });
});
