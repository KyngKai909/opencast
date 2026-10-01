// Changing channel in the engine (follow-up Phase 5): the corner number and the static on the
// press, the old picture muted under it, the swap and the roll, the banner after; Stand by at 8 s
// whatever kept the picture from coming (the playlist, a stalled play(), the network), and the old
// 15 s timeout gone from the way; repeated presses loading only the channel landed on; reduced
// motion; the radio band's sweep and hiss; and where the effect is never used.
// The clock is pinned to the reference's Saturday, 8:42 pm (Pacific).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerEngine, type EngineOptions } from "./PlayerEngine";
import { fakeDriver, flush, frameDelay, stalled, station, stubMedia, stubWebAudio, until } from "../test-helpers";
import { HISS_GAIN, HISS_MS, LAND_MS, MIN_STATIC_MS, REBUILD_AFTER_MS, RETRY_FIRST_MS, ROLL_MS, STANDBY_MS, SWEEP_MS, TUNING_IN_MS } from "../tuning/constants";

const SATURDAY_842PM = new Date("2026-09-27T03:42:00Z");

const CIVC = station("CIVC", "7.1");
const BEAT = station("BEAT", "12.1");
const SAZN = station("SAZN", "18.1");
const REEL = station("REEL", "24.1");
const LUPE = station("LUPE", "33.1");
const DARK = station("DARK", "40.1", { onAir: false });
const NITE = station("NITE", "88.3", { band: "radio" });
const SOLA = station("SOLA", "94.7", { band: "radio" });
const DUSK = station("DUSK", "99.5", { band: "radio" });
const tvDial = [CIVC, BEAT, SAZN, REEL, LUPE, DARK];

let engine: PlayerEngine;
let driver: ReturnType<typeof fakeDriver>;
let host: HTMLDivElement;
const visible = () => [...host.querySelectorAll("video.is-on")].map((v) => (v as HTMLVideoElement).dataset.station);
const videoOf = (c: typeof CIVC) => host.querySelector<HTMLVideoElement>(`video[data-station="${c.station.id}"]`);
const attached = (c: typeof CIVC) => driver.handles.filter((h) => h.url === c.playback!.url);

function make(o: EngineOptions = {}, channels = tvDial, d = fakeDriver()) {
  driver = d;
  engine = new PlayerEngine({ driver, warm: "none", bannerMs: 5000, reducedMotion: () => false, ...o });
  engine.attach(host);
  engine.setChannels(channels);
  return engine;
}
/** On air on a station, with its first launch done. */
async function onAir(c: typeof CIVC) {
  await until(engine.tune(c.station.id));
  await flush(1000); // well clear of the photosensitivity guard
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(SATURDAY_842PM);
  stubMedia();
  for (const k of Object.keys(frameDelay)) delete frameDelay[k];
  stalled.clear();
  host = document.createElement("div");
});
afterEach(() => {
  engine?.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a channel change", () => {
  it("shows the new number at once over static, the old picture muted beneath; the picture after 300 ms, the roll, then the banner", async () => {
    make();
    await onAir(CIVC);
    expect(videoOf(CIVC)!.muted).toBe(false);
    engine.handle({ type: "channel", dir: "up" });
    // On the press: BEAT's number, the static, no banner yet, CIVC's picture still under it but quiet.
    expect(engine.getState().tuning).toMatchObject({ stationId: BEAT.station.id, look: "static", phase: "static" });
    expect(engine.getState().banner).toBeNull();
    expect(engine.getState().pendingId).toBe(BEAT.station.id);
    expect(visible()).toEqual([CIVC.station.id]);
    expect(videoOf(CIVC)!.muted).toBe(true);
    // BEAT's first frame is there at once; the static holds its 300 ms.
    await flush(MIN_STATIC_MS - 10);
    expect(visible()).toEqual([CIVC.station.id]);
    await flush(10);
    expect(visible()).toEqual([BEAT.station.id]);
    expect(engine.getState()).toMatchObject({ currentId: BEAT.station.id, status: "playing" });
    expect(engine.getState().tuning?.phase).toBe("clearing");
    expect(engine.getState().banner).toBeNull();
    await flush(ROLL_MS);
    expect(engine.getState().tuning).toBeNull();
    expect(engine.getState().banner?.stationId).toBe(BEAT.station.id);
  });

  it("a slow channel: \"Tuning in\" at 800 ms, and the picture when it comes", async () => {
    make();
    await onAir(CIVC);
    frameDelay[BEAT.station.id] = 2000;
    engine.handle({ type: "channel", dir: "up" });
    await flush(TUNING_IN_MS - 1);
    expect(engine.getState().tuning?.phase).toBe("static");
    await flush(1);
    expect(engine.getState().tuning?.phase).toBe("tuning_in");
    await flush(2000 - TUNING_IN_MS - 10);
    expect(engine.getState().tuning?.phase).toBe("tuning_in");
    await flush(20);
    expect(engine.getState().tuning?.phase).toBe("clearing");
    expect(engine.getState().currentId).toBe(BEAT.station.id);
  });
});

describe("Stand by after 8 s, whatever the reason", () => {
  it("a playlist that fails to load: Stand by at 8 s (the old picture let go), still trying, and the picture once it loads", async () => {
    let broken = true;
    make({}, tvDial, fakeDriver({ fails: (url) => (broken && url === BEAT.playback!.url ? "manifestLoadError" : null) }));
    await onAir(CIVC);
    engine.handle({ type: "channel", dir: "up" });
    await flush(STANDBY_MS - 1);
    expect(engine.getState().status).toBe("playing");
    expect(engine.getState().tuning?.phase).toBe("tuning_in");
    // Tried again meanwhile (2 s, then 4 s after that).
    expect(attached(BEAT).length).toBeGreaterThanOrEqual(3);
    await flush(1);
    expect(engine.getState()).toMatchObject({ status: "standby", currentId: BEAT.station.id, pendingId: null, tuning: null, lastId: CIVC.station.id });
    expect(engine.getState().error).toBe("manifestLoadError");
    expect(videoOf(CIVC)).toBeNull();
    // The old 15 s timeout doesn't end it: still Stand by at 15 s and after, still trying.
    await flush(15_000 - STANDBY_MS);
    expect(engine.getState().status).toBe("standby");
    const tries = attached(BEAT).length;
    await flush(30_000);
    expect(attached(BEAT).length).toBeGreaterThan(tries);
    expect(engine.getState().status).toBe("standby");
    // The playlist is back: the next try plays, with no static, and the banner.
    broken = false;
    for (let i = 0; i < 40 && engine.getState().status !== "playing"; i++) await flush(1000);
    expect(engine.getState()).toMatchObject({ status: "playing", currentId: BEAT.station.id, tuning: null, error: null });
    expect(visible()).toEqual([BEAT.station.id]);
    expect(engine.getState().banner?.stationId).toBe(BEAT.station.id);
  });

  it("a play() that never settles (the bug: tune waited on it before any timeout started)", async () => {
    make();
    await onAir(CIVC);
    stalled.add(BEAT.station.id);
    engine.handle({ type: "channel", dir: "up" });
    await flush(STANDBY_MS);
    expect(engine.getState()).toMatchObject({ status: "standby", currentId: BEAT.station.id });
    // A load that still has nothing is loaded afresh (never ends the tune).
    const before = attached(BEAT).length;
    await flush(REBUILD_AFTER_MS + RETRY_FIRST_MS);
    expect(attached(BEAT).length).toBeGreaterThan(before);
    expect(engine.getState().status).toBe("standby");
    stalled.delete(BEAT.station.id);
    await flush(REBUILD_AFTER_MS + 2 * RETRY_FIRST_MS * 2);
    expect(engine.getState()).toMatchObject({ status: "playing", currentId: BEAT.station.id });
  });

  it("a network that never delivers a frame (no error at all)", async () => {
    make();
    await onAir(CIVC);
    frameDelay[BEAT.station.id] = 60_000;
    engine.handle({ type: "channel", dir: "up" });
    await flush(STANDBY_MS);
    expect(engine.getState().status).toBe("standby");
  });

  it("on first launch too (nothing drawn before it)", async () => {
    make({}, tvDial, fakeDriver({ fails: () => "manifestLoadError" }));
    void engine.tune(CIVC.station.id);
    expect(engine.getState().tuning).toBeNull();
    await flush(STANDBY_MS);
    expect(engine.getState()).toMatchObject({ status: "standby", currentId: CIVC.station.id });
  });

  it("from Stand by, channel up and down work as ever", async () => {
    make({}, tvDial, fakeDriver({ fails: (url) => (url === BEAT.playback!.url ? "manifestLoadError" : null) }));
    await onAir(CIVC);
    engine.handle({ type: "channel", dir: "up" });
    await flush(STANDBY_MS);
    expect(engine.getState().status).toBe("standby");
    engine.handle({ type: "channel", dir: "up" });
    expect(engine.getState().tuning).toMatchObject({ stationId: SAZN.station.id, look: "static" });
    await flush(1200);
    expect(engine.getState()).toMatchObject({ status: "playing", currentId: SAZN.station.id, lastId: BEAT.station.id });
  });
});

describe("repeated presses", () => {
  it("update the number each time and load only the channel the viewer lands on", async () => {
    make();
    await onAir(CIVC);
    const seen: string[] = [];
    const off = engine.subscribe(() => {
      const t = engine.getState().tuning;
      if (t && seen.at(-1) !== t.stationId) seen.push(t.stationId);
    });
    for (let i = 0; i < 4; i++) {
      engine.handle({ type: "channel", dir: "up" });
      await flush(100);
    }
    off();
    // BEAT, SAZN, REEL, LUPE: the number followed every press.
    expect(seen).toEqual([BEAT, SAZN, REEL, LUPE].map((c) => c.station.id));
    // The first press started BEAT loading and the second let it go; SAZN and REEL never loaded.
    expect(attached(BEAT).every((h) => h.destroyed)).toBe(true);
    expect(attached(SAZN)).toEqual([]);
    expect(attached(REEL)).toEqual([]);
    // LUPE loads once the presses have stopped for a moment.
    expect(attached(LUPE)).toEqual([]);
    await flush(LAND_MS);
    expect(attached(LUPE)).toHaveLength(1);
    await flush(1000);
    expect(engine.getState()).toMatchObject({ currentId: LUPE.station.id, status: "playing", tuning: null, lastId: CIVC.station.id });
    expect(visible()).toEqual([LUPE.station.id]);
  });

  it("number entry during the static tunes what's typed, and the static carries on for it", async () => {
    make();
    await onAir(CIVC);
    frameDelay[BEAT.station.id] = 5000;
    engine.handle({ type: "channel", dir: "up" });
    await flush(200);
    engine.handle({ type: "digit", digit: 2 });
    engine.handle({ type: "digit", digit: 4 });
    expect(engine.getState().entry?.match?.station.id).toBe(REEL.station.id);
    engine.handle({ type: "select" });
    expect(engine.getState().entry).toBeNull();
    expect(engine.getState().tuning).toMatchObject({ stationId: REEL.station.id, presses: 2 });
    await flush(1200);
    expect(engine.getState().currentId).toBe(REEL.station.id);
    expect(attached(BEAT).every((h) => h.destroyed)).toBe(true);
  });
});

describe("reduced motion", () => {
  it("is a crossfade, not static: the same corner number, 200 ms", async () => {
    make({ reducedMotion: () => true });
    await onAir(CIVC);
    engine.handle({ type: "channel", dir: "up" });
    expect(engine.getState().tuning).toMatchObject({ stationId: BEAT.station.id, look: "fade" });
    await flush(200);
    expect(engine.getState().tuning?.phase).toBe("clearing");
    expect(engine.getState().currentId).toBe(BEAT.station.id);
    await flush(200);
    expect(engine.getState().tuning).toBeNull();
  });

  it("reads the system or app setting at each press", async () => {
    let reduce = false;
    make({ reducedMotion: () => reduce });
    await onAir(CIVC);
    engine.handle({ type: "channel", dir: "up" });
    expect(engine.getState().tuning?.look).toBe("static");
    await flush(1200);
    reduce = true;
    engine.handle({ type: "channel", dir: "up" });
    expect(engine.getState().tuning?.look).toBe("fade");
  });

  it("follows prefers-reduced-motion and data-motion by default", async () => {
    const { prefersReducedMotion } = await import("./PlayerEngine");
    expect(prefersReducedMotion()).toBe(false);
    document.documentElement.dataset.motion = "reduce";
    expect(prefersReducedMotion()).toBe(true);
    delete document.documentElement.dataset.motion;
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe("the radio band", () => {
  const radio = [NITE, SOLA, DUSK];

  it("sweeps the needle from frequency to frequency in 400 ms; the sound takes over after it", async () => {
    make({}, radio);
    await onAir(NITE);
    engine.handle({ type: "channel", dir: "up" });
    const t = engine.getState().tuning!;
    expect(t).toMatchObject({ look: "sweep", stationId: SOLA.station.id });
    expect(t.sweep).toMatchObject({ from: 88.3, to: 94.7, ms: SWEEP_MS });
    await flush(SWEEP_MS - 10);
    expect(engine.getState().currentId).toBe(NITE.station.id);
    await flush(10);
    expect(engine.getState().currentId).toBe(SOLA.station.id);
  });

  it("wrapping round the band, the needle travels back along it: the real distance", async () => {
    make({}, radio);
    await onAir(DUSK);
    engine.handle({ type: "channel", dir: "up" });
    expect(engine.getState().tuning?.sweep).toMatchObject({ from: 99.5, to: 88.3 });
  });

  describe("the hiss", () => {
    const hisses = (audio: ReturnType<typeof stubWebAudio>) => audio.nodes.filter((n) => n.kind === "bufferSource" && n.started !== undefined);

    it("is on by default for the radio band, but only after the listener has done something", async () => {
      const audio = stubWebAudio();
      make({}, radio);
      await onAir(NITE);
      // No gesture yet (tuned by the app on start): silent.
      await until(engine.tune(SOLA.station.id));
      await flush(1000);
      expect(hisses(audio)).toHaveLength(0);
      // A press: now it plays, 250 ms of band-passed noise, soft, with no click at either end.
      engine.handle({ type: "channel", dir: "up" });
      await flush(0);
      expect(engine.hissesPlayed()).toBe(1);
      const [src] = hisses(audio);
      expect(src!.stopped! - src!.started!).toBeCloseTo(HISS_MS / 1000);
      const filter = audio.nodes.find((n) => n.kind === "biquad")!;
      const gain = filter.to[0]!;
      expect(gain.ramps!.map((r) => r.value)).toEqual([HISS_GAIN, 0]);
      expect(gain.to[0]!.kind).toBe("destination");
    });

    it("is off by default for video, and plays there when Tuning sound is on", async () => {
      stubWebAudio();
      make();
      await onAir(CIVC);
      engine.handle({ type: "channel", dir: "up" });
      await flush(1200);
      expect(engine.hissesPlayed()).toBe(0);
      engine.setOptions({ tuningSound: { video: true } });
      engine.handle({ type: "channel", dir: "up" });
      await flush(0);
      expect(engine.hissesPlayed()).toBe(1);
    });

    it("follows the radio band's own switch, and never plays while muted", async () => {
      stubWebAudio();
      make({ tuningSound: { radio: false } }, radio);
      await onAir(NITE);
      engine.handle({ type: "channel", dir: "up" });
      await flush(1200);
      expect(engine.hissesPlayed()).toBe(0);
      engine.setOptions({ tuningSound: { radio: true } });
      engine.setMuted(true);
      engine.handle({ type: "channel", dir: "up" });
      await flush(1200);
      expect(engine.hissesPlayed()).toBe(0);
      engine.setMuted(false);
      engine.handle({ type: "channel", dir: "up" });
      await flush(0);
      expect(engine.hissesPlayed()).toBe(1);
    });

    it("waits for a tap when the browser refused sound", async () => {
      stubWebAudio();
      make({}, radio);
      await onAir(NITE);
      (engine as unknown as { patch(p: object): void }).patch({ mutedByBrowser: true });
      engine.handle({ type: "channel", dir: "up" });
      await flush(0);
      expect(engine.hissesPlayed()).toBe(0);
    });

    it("counts a gesture the browser saw (a click on the dial), not only the player's commands", async () => {
      stubWebAudio();
      make({}, radio);
      await onAir(NITE);
      vi.stubGlobal("navigator", { ...navigator, userActivation: { hasBeenActive: true, isActive: false } });
      await until(engine.tune(SOLA.station.id));
      expect(engine.hissesPlayed()).toBe(1);
    });
  });
});

describe("never used for", () => {
  it("first launch: nothing drawn, the banner at once", async () => {
    make();
    void engine.tune(CIVC.station.id);
    expect(engine.getState().tuning).toBeNull();
    expect(engine.getState().banner?.stationId).toBe(CIVC.station.id);
  });

  it("off air: a press to an off-air station still shows the static, like a TV, then off air", async () => {
    make();
    await onAir(LUPE);
    engine.handle({ type: "channel", dir: "up" });
    // The change is drawn like any other: the static over the old picture, the new number in the corner.
    expect(engine.getState().tuning).toMatchObject({ stationId: DARK.station.id, look: "static" });
    await flush(MIN_STATIC_MS + ROLL_MS + 500);
    expect(engine.getState()).toMatchObject({ currentId: DARK.station.id, status: "off_air", tuning: null });
  });

  it("pausing and playing", async () => {
    make();
    await onAir(CIVC);
    engine.pause();
    expect(engine.getState().tuning).toBeNull();
    engine.play();
    expect(engine.getState().tuning).toBeNull();
    engine.backToLive();
    expect(engine.getState().tuning).toBeNull();
  });

  it("Stand by itself, and a station coming back on air: no static, the picture replaces the screen", async () => {
    make({}, tvDial, fakeDriver({ fails: () => "manifestLoadError" }));
    void engine.tune(CIVC.station.id);
    await flush(STANDBY_MS);
    expect(engine.getState()).toMatchObject({ status: "standby", tuning: null });
    // Stand by's own tries never bring static up.
    const seen: string[] = [];
    const off = engine.subscribe(() => engine.getState().tuning && seen.push(engine.getState().tuning!.look));
    await flush(40_000);
    off();
    expect(seen).toEqual([]);
  });

  it("the same channel again (OK on the number of the channel on screen): the banner, nothing else", async () => {
    make();
    await onAir(CIVC);
    engine.hideBanner();
    engine.handle({ type: "digit", digit: 7 });
    engine.handle({ type: "select" });
    expect(engine.getState().tuning).toBeNull();
    expect(engine.getState().banner?.stationId).toBe(CIVC.station.id);
  });
});
