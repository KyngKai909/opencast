import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerEngine, TUNING_SOUND_DEFAULTS, tuningSoundFrom } from "./PlayerEngine";
import { CHANGE_MS, fakeDriver, flush, frameDelay, station, stubMedia, stubWebAudio } from "../test-helpers";
import { startHeartbeat } from "../heartbeat";
import { bestLevel, dataSaverLevel, nativeDriver, QualityRules, type LevelControl } from "./driver";
import { LEVELLER, samplesReachWebAudio } from "./meter";

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
  // These tests warm neighbours with a hidden <video> ("buffer"); pre-warming by playlists and a
  // first segment (the default) has its own tests (warming.test.ts).
  engine = new PlayerEngine({ driver, warm: "buffer", bannerMs: 5000, numberWaitMs: 2000, pauseHoldMs: 30 * 60_000 });
  engine.attach(host);
  engine.setChannels(dial);
});
afterEach(() => {
  engine.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
    await flush(CHANGE_MS);
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
    await flush(CHANGE_MS);
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
    await flush(CHANGE_MS);
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

describe("behind live", () => {
  const tuned = async (c = CIVC) => {
    const t = engine.tune(c.station.id);
    await flush(CHANGE_MS);
    await t;
  };
  const handleOf = (c: typeof CIVC) => driver.handles.filter((h) => h.url === c.playback!.url).at(-1)!;
  /** Paused for a while: the stream's live edge moves on (the fake's live sync point, in seconds). */
  const pauseFor = async (s: number, c = CIVC) => {
    engine.pause();
    await flush(s * 1000);
    handleOf(c).live! += s;
  };

  it("from a pause, and still after play resumes behind live, until Back to live", async () => {
    await tuned();
    expect(engine.getState().behindLive).toBe(false);
    engine.handle({ type: "pause" });
    expect(engine.getState()).toMatchObject({ status: "paused", behindLive: true });
    await flush(60_000);
    handleOf(CIVC).live! += 60;
    engine.handle({ type: "play" });
    await flush(1000);
    expect(engine.getState()).toMatchObject({ status: "playing", behindLive: true });
    engine.handle({ type: "backToLive" });
    expect(engine.getState()).toMatchObject({ status: "playing", behindLive: false, paused: null });
  });

  it("Back to live straight from the pause plays at the live edge", async () => {
    await tuned();
    engine.pause();
    engine.backToLive();
    expect(engine.getState()).toMatchObject({ status: "playing", behindLive: false, paused: null });
  });

  it("ends with a channel change or a tune", async () => {
    await tuned();
    await pauseFor(20);
    engine.play();
    expect(engine.getState().behindLive).toBe(true);
    engine.handle({ type: "channel", dir: "up" });
    expect(engine.getState().behindLive).toBe(false);
    await flush(CHANGE_MS);
    expect(engine.getState().currentId).toBe(BEAT.station.id);
    engine.pause();
    expect(engine.getState().behindLive).toBe(true);
    await tuned(REEL);
    expect(engine.getState()).toMatchObject({ currentId: REEL.station.id, status: "playing", behindLive: false });
  });

  it("ends when the picture catches up to the live edge by itself; not while paused", async () => {
    await tuned();
    const h = handleOf(CIVC);
    const at = h.live!;
    // Paused a moment, near the edge: still paused, still behind.
    engine.pause();
    await flush(1000);
    expect(engine.getState().behindLive).toBe(true);
    h.live = at + 60;
    engine.play();
    await flush(1000);
    expect(engine.getState().behindLive).toBe(true);
    // The driver says it's within a few seconds of the live sync point now.
    h.live = at + 3;
    await flush(300);
    expect(engine.getState().behindLive).toBe(false);
  });

  it("stays when the driver can't tell where the edge is", async () => {
    await tuned();
    const h = handleOf(CIVC);
    await pauseFor(20);
    engine.play();
    h.live = null;
    await flush(5000);
    expect(engine.getState().behindLive).toBe(true);
  });

  it("the backToLive command does nothing at the live edge (no jump, no banner)", async () => {
    await tuned();
    await flush(6000);
    expect(engine.getState().banner).toBeNull();
    engine.handle({ type: "backToLive" });
    expect(engine.getState().banner).toBeNull();
  });

  it("holding OK on the picture goes back to live while behind; otherwise it's OK", async () => {
    await tuned();
    await flush(6000);
    // At the live edge a held OK is OK: the banner.
    engine.handle({ type: "select", hold: true });
    expect(engine.getState().banner).not.toBeNull();
    engine.hideBanner();
    await pauseFor(20);
    engine.play();
    expect(engine.getState().behindLive).toBe(true);
    engine.handle({ type: "select", hold: true });
    expect(engine.getState()).toMatchObject({ status: "playing", behindLive: false });
    // Paused: the same.
    engine.pause();
    engine.handle({ type: "select", hold: true });
    expect(engine.getState()).toMatchObject({ status: "playing", behindLive: false, paused: null });
  });

  it("a held OK while typing a number tunes it, as OK does", async () => {
    await tuned();
    engine.pause();
    engine.handle({ type: "digit", digit: 2 });
    engine.handle({ type: "digit", digit: 4 });
    engine.handle({ type: "select", hold: true });
    await flush(CHANGE_MS);
    expect(engine.getState()).toMatchObject({ currentId: REEL.station.id, behindLive: false });
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

  it("stops during a station's planned off air (offAirUntil), even across tuning away and back, until nextInMs has passed", async () => {
    const offFor = 10 * 60_000;
    const send = vi.fn(async (b: { stationId: string }) => (b.stationId === BEAT.station.id ? { nextInMs: offFor, offAirUntil: "2026-09-27T13:00:00Z" } : { nextInMs: 30_000 }));
    const stop = startHeartbeat(engine, send, "tv_app", "11111111-1111-4111-8111-111111111111");
    const t = engine.tune(BEAT.station.id);
    await flush(10);
    await t;
    await flush(0);
    expect(send).toHaveBeenCalledTimes(1);
    await flush(5 * 60_000);
    expect(send).toHaveBeenCalledTimes(1);
    // Away and back: CIVC beats; BEAT stays quiet until its time.
    const a = engine.tune(CIVC.station.id);
    await flush(CHANGE_MS);
    await a;
    await flush(0);
    expect(send.mock.calls.at(-1)![0].stationId).toBe(CIVC.station.id);
    const b = engine.tune(BEAT.station.id);
    await flush(CHANGE_MS);
    await b;
    await flush(0);
    const beatsToBeat = () => send.mock.calls.filter((c) => c[0].stationId === BEAT.station.id).length;
    expect(beatsToBeat()).toBe(1);
    await flush(5 * 60_000);
    expect(beatsToBeat()).toBe(2);
    stop();
  });
});

void byId;

describe("tuning sound", () => {
  const KOSP = station("KOSP", "88.3", { band: "radio" });

  it("is on for the radio band and off for video by default", () => {
    expect(TUNING_SOUND_DEFAULTS).toEqual({ video: false, radio: true });
    engine.setChannels([...dial, KOSP]);
    expect(engine.getTuningSound()).toEqual({ video: false, radio: true });
    expect(engine.tuningSoundOn(BEAT.station.id)).toBe(false);
    expect(engine.tuningSoundOn(KOSP.station.id)).toBe(true);
  });

  it("follows the settings, per band, from the options and later changes", () => {
    const e = new PlayerEngine({ driver: fakeDriver(), tuningSound: { video: true } });
    e.setChannels([...dial, KOSP]);
    expect(e.getTuningSound()).toEqual({ video: true, radio: true });
    e.setOptions({ tuningSound: { radio: false, video: undefined } });
    expect(e.getTuningSound()).toEqual({ video: true, radio: false });
    expect(e.tuningSoundOn(KOSP.station.id)).toBe(false);
    expect(e.tuningSoundOn(CIVC.station.id)).toBe(true);
    e.destroy();
  });

  it("reads the account's watching settings, with the defaults where they're absent", () => {
    expect(tuningSoundFrom(undefined)).toEqual({ video: false, radio: true });
    expect(tuningSoundFrom({ tuningSound: true })).toEqual({ video: true, radio: true });
    expect(tuningSoundFrom({ radioTuningSound: false })).toEqual({ video: false, radio: false });
  });
});

describe("the caption setting", () => {
  it("on shows the stream's captions, off hides them, and muted only shows them while the sound is off", async () => {
    const t = engine.tune(BEAT.station.id);
    await flush(10);
    await t;
    const active = () => driver.handles.filter((h) => !h.destroyed && h.url.includes("/beat/")).pop()!;
    engine.setCaptions("on", "large");
    expect(active().captions).toBe(true);
    expect(engine.getState().captionSize).toBe("large");
    engine.setCaptions("off");
    expect(active().captions).toBe(false);
    engine.setCaptions("muted_only");
    engine.setMuted(false);
    expect(active().captions).toBe(false);
    engine.setMuted(true);
    expect(active().captions).toBe(true);
  });
});

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

describe("picture quality", () => {
  // As hls.js sorts them: by height, then bitrate.
  const ladder = [
    { height: 240, bitrate: 400_000 },
    { height: 360, bitrate: 800_000 },
    { height: 480, bitrate: 1_200_000 },
    { height: 480, bitrate: 1_600_000 },
    { height: 720, bitrate: 3_000_000 },
    { height: 1080, bitrate: 6_000_000 }
  ];
  /** hls.js's level controls, as the rules see them. */
  class FakeHls implements LevelControl {
    autoLevelCapping = -1;
    startLevel = -1;
    manualLevel = -1;
    sets: number[] = [];
    constructor(public levels: LevelControl["levels"] = []) {}
    set loadLevel(l: number) {
      this.manualLevel = l;
      this.sets.push(l);
    }
    get loadLevel() {
      return this.manualLevel;
    }
  }
  const fakeHls = (levels: LevelControl["levels"] = []) => new FakeHls(levels);

  it("data saver allows the tallest picture up to 480 lines, at its lowest bitrate", () => {
    expect(dataSaverLevel(ladder)).toBe(2);
    // Every level taller: the smallest picture there is.
    expect(dataSaverLevel([{ height: 720, bitrate: 3e6 }, { height: 1080, bitrate: 6e6 }])).toBe(0);
    // Audio only (no height): the lowest bitrate.
    expect(dataSaverLevel([{ bitrate: 128_000 }, { bitrate: 64_000 }])).toBe(1);
    expect(dataSaverLevel([])).toBe(-1);
    expect(bestLevel(ladder)).toBe(5);
  });

  it("auto leaves ABR uncapped, as it always was", () => {
    const hls = fakeHls(ladder);
    const q = new QualityRules(hls);
    q.onLevels();
    expect(hls).toMatchObject({ autoLevelCapping: -1, manualLevel: -1, startLevel: -1 });
    expect(hls.sets).toEqual([]);
  });

  it("data saver caps ABR at 480 lines, from the start", () => {
    const hls = fakeHls([]);
    const q = new QualityRules(hls);
    q.set("data_saver"); // Before the manifest: waits for the levels.
    expect(hls.autoLevelCapping).toBe(-1);
    hls.levels = ladder;
    q.onLevels();
    expect(hls).toMatchObject({ autoLevelCapping: 2, manualLevel: -1 });
    q.set("auto");
    expect(hls.autoLevelCapping).toBe(-1);
  });

  it("best starts at and holds the top level; a stall hands it to ABR until it climbs back", () => {
    const hls = fakeHls([]);
    const q = new QualityRules(hls);
    q.set("best");
    hls.levels = ladder;
    q.onLevels();
    expect(hls).toMatchObject({ startLevel: 5, manualLevel: 5, autoLevelCapping: -1 });
    q.onStall();
    expect(hls.manualLevel).toBe(-1); // ABR may drop.
    q.onLevelSwitched(3);
    expect(hls.manualLevel).toBe(-1);
    q.onLevelSwitched(5); // Back at the top: held again.
    expect(hls.manualLevel).toBe(5);
    // Saying best again doesn't undo a stall's hand-over; leaving best lets go of the hold.
    q.onStall();
    q.set("best");
    expect(hls.manualLevel).toBe(-1);
    q.set("data_saver");
    expect(hls).toMatchObject({ manualLevel: -1, autoLevelCapping: 2 });
    q.set("best");
    expect(hls).toMatchObject({ manualLevel: 5, autoLevelCapping: -1 });
    q.set("auto");
    expect(hls).toMatchObject({ manualLevel: -1, autoLevelCapping: -1 });
  });

  it("applies to the picture on screen and the warm neighbours at once", async () => {
    const e = new PlayerEngine({ driver, warm: "buffer", quality: "data_saver" });
    e.attach(document.createElement("div"));
    e.setChannels(dial);
    const t = e.tune(BEAT.station.id);
    await flush(10);
    await t;
    const live = () => driver.handles.filter((h) => !h.destroyed);
    expect(live().length).toBe(2); // BEAT, and CIVC warm.
    expect(live().map((h) => h.quality)).toEqual(["data_saver", "data_saver"]);
    e.setOptions({ quality: "best" });
    expect(live().map((h) => h.quality)).toEqual(["best", "best"]);
    // A neighbour warmed later starts at the setting too.
    const t2 = e.tune(REEL.station.id);
    await flush(CHANGE_MS);
    await t2;
    expect(live().map((h) => h.quality).every((q) => q === "best")).toBe(true);
    e.destroy();
  });

  it("the browser's own HLS stays on auto: it can't choose levels", () => {
    const d = nativeDriver();
    const handle = d.attach(document.createElement("video"), "/x/master.m3u8", () => {});
    expect(() => handle.setQuality("data_saver")).not.toThrow();
    expect(d.webAudio).toBe(false);
    handle.destroy();
  });
});

describe("evening out the sound", () => {
  const video = (id: string) => host.querySelector<HTMLVideoElement>(`video[data-station="${id}"]`)!;
  const tuned = async (e: PlayerEngine, id: string) => {
    const t = e.tune(id);
    await flush(CHANGE_MS);
    await t;
  };

  it("puts a gentle compressor and a make-up gain in the sound's path when on", async () => {
    const audio = stubWebAudio();
    engine.setOptions({ eveningOut: true });
    await tuned(engine, CIVC.station.id);
    engine.handle({ type: "info" }); // A command: the sound may run through Web Audio now.
    await flush(0);
    expect(engine.soundRouted()).toBe(true);
    expect(audio.paths(video(CIVC.station.id)).sort()).toEqual([
      ["source", "compressor", "gain", "gain", "analyser", "destination"],
      ["source", "gain", "analyser", "destination"]
    ]);
    const c = audio.chain(video(CIVC.station.id))!;
    expect(Object.fromEntries(Object.entries(c.compressor.params).map(([k, v]) => [k, v.value]))).toEqual({ threshold: -24, ratio: 4, knee: 12, attack: 0.01, release: 0.25 });
    expect(c.makeUp.params.gain!.value).toBeCloseTo(Math.pow(10, LEVELLER.makeUpDb / 20));
    expect(c.wet.params.gain!.value).toBe(1);
    expect(c.dry.params.gain!.value).toBe(0);
    expect(engine.audioLevels(4)).not.toBeNull();
  });

  it("off, the sound goes straight past it; switching crossfades rather than clicks", async () => {
    const audio = stubWebAudio();
    await tuned(engine, CIVC.station.id);
    engine.handle({ type: "info" });
    await flush(0);
    const c = audio.chain(video(CIVC.station.id))!;
    expect([c.dry.params.gain, c.wet.params.gain]).toEqual([{ value: 1, ramped: false }, { value: 0, ramped: false }]);
    engine.setOptions({ eveningOut: true });
    expect([c.dry.params.gain, c.wet.params.gain]).toEqual([{ value: 0, ramped: true }, { value: 1, ramped: true }]);
    engine.setOptions({ eveningOut: false });
    expect([c.dry.params.gain, c.wet.params.gain]).toEqual([{ value: 1, ramped: true }, { value: 0, ramped: true }]);
  });

  it("a station back on screen takes the current setting", async () => {
    const audio = stubWebAudio();
    await tuned(engine, CIVC.station.id);
    engine.handle({ type: "info" });
    await flush(0);
    await tuned(engine, BEAT.station.id);
    engine.setOptions({ eveningOut: true }); // While CIVC is warm (and silent).
    await tuned(engine, CIVC.station.id);
    const c = audio.chain(video(CIVC.station.id))!;
    expect([c.dry.params.gain!.value, c.wet.params.gain!.value]).toEqual([0, 1]);
  });

  it("without Web Audio, the sound is left alone", async () => {
    // jsdom has no AudioContext, like a browser without Web Audio.
    engine.setOptions({ eveningOut: true });
    await tuned(engine, CIVC.station.id);
    engine.handle({ type: "info" });
    await flush(0);
    expect(engine.soundRouted()).toBe(false);
    expect(engine.audioLevels(4)).toBeNull();
    expect(video(CIVC.station.id).muted).toBe(false);
  });

  it("never routes sound Web Audio would only get silence from", async () => {
    const audio = stubWebAudio();
    // The browser's own HLS (Safari).
    const e = new PlayerEngine({ driver: fakeDriver({ webAudio: false }), eveningOut: true });
    e.attach(host);
    e.setChannels(dial);
    await tuned(e, CIVC.station.id);
    e.handle({ type: "info" });
    await flush(0);
    expect(e.soundRouted()).toBe(false);
    expect(audio.nodes.some((n) => n.kind === "source")).toBe(false);
    e.destroy();
    // Cross-origin without CORS.
    const v = document.createElement("video");
    v.src = "https://elsewhere.example/live.mp4";
    expect(samplesReachWebAudio(v)).toBe(false);
    v.crossOrigin = "anonymous";
    expect(samplesReachWebAudio(v)).toBe(true);
    const mse = document.createElement("video");
    mse.src = "blob:http://localhost/1234";
    expect(samplesReachWebAudio(mse)).toBe(true);
  });
});

describe("sound before the viewer has clicked", () => {
  it("plays on muted with the tap-for-sound prompt when unmuting pauses the picture (Chrome)", async () => {
    // Chrome's rule: unmuting a video with no click on the page yet pauses it, and says nothing else.
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "muted")!;
    Object.defineProperty(HTMLMediaElement.prototype, "muted", {
      configurable: true,
      get() { return desc.get!.call(this); },
      set(this: HTMLVideoElement & { _paused?: boolean }, value: boolean) {
        desc.set!.call(this, value);
        if (!value && this._paused === false) {
          this._paused = true;
          this.dispatchEvent(new Event("pause"));
        }
      }
    });
    try {
      const done = engine.tune(CIVC.station.id);
      await flush(50);
      await done;
      const v = host.querySelector("video.is-on") as HTMLVideoElement;
      expect(engine.getState().status).toBe("playing");
      expect(v.paused).toBe(false);
      expect(v.muted).toBe(true);
      expect(engine.getState().mutedByBrowser).toBe(true);
    } finally {
      Object.defineProperty(HTMLMediaElement.prototype, "muted", desc);
    }
  });
});

describe("the banner while paused", () => {
  it("shows on pause and stays until play, then goes after the usual time", async () => {
    const done = engine.tune(CIVC.station.id);
    await flush(50);
    await done;
    await flush(6000);
    expect(engine.getState().banner).toBeNull();
    engine.pause();
    expect(engine.getState().banner?.stationId).toBe(CIVC.station.id);
    await flush(60_000);
    expect(engine.getState().banner?.stationId).toBe(CIVC.station.id);
    engine.play();
    expect(engine.getState().banner?.stationId).toBe(CIVC.station.id);
    await flush(5001);
    expect(engine.getState().banner).toBeNull();
  });
});
