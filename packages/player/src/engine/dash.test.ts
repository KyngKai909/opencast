// DASH stream links in the player (A201): dash.js loads only when a DASH station is tuned (never
// for HLS, never for a neighbour), plays through the same deck lifecycle as HLS (the static until
// the first frame, Stand by on errors, teardown on a channel change, the heartbeat), maps picture
// quality onto dash.js's ABR, and a device that can't play DASH says so and skips it when swiping.
// dash.js itself is mocked: jsdom has no Media Source.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerEngine } from "./PlayerEngine";
import { dashAbr, dashJsDriver, dashJsLoads, isDash, type DashEvent, type DashJsModule, type DashPlayer } from "./dash";
import { CHANGE_MS, fakeDriver, fakeFetch, flush, station, stubMedia, until } from "../test-helpers";
import { startHeartbeat, type HeartbeatBody } from "../heartbeat";
import { neighbour } from "../dial";
import { STANDBY_MS } from "../tuning/constants";
import type { Channel } from "../types";

const imports = vi.hoisted(() => ({ count: 0 }));

/** A stand-in for dash.js's MediaPlayer: records what the driver asks, and plays like a browser would. */
class FakeDashPlayer implements DashPlayer {
  static all: FakeDashPlayer[] = [];
  listeners = new Map<string, Array<(e: DashEvent) => void>>();
  settings: Array<Record<string, unknown>> = [];
  view: HTMLMediaElement | null = null;
  url = "";
  autoPlay = false;
  destroyed = false;
  text: boolean | null = null;
  textTrack = -1;
  held: number[] = [];
  clearedTiming = false;
  reps = [
    { bandwidth: 110_000, height: 216 },
    { bandwidth: 220_000, height: 360 },
    { bandwidth: 400_000, height: 540 }
  ];
  constructor() {
    FakeDashPlayer.all.push(this);
  }
  initialize(view: HTMLMediaElement, url: string, autoPlay: boolean) {
    this.view = view;
    this.url = url;
    this.autoPlay = autoPlay;
    if (url.includes("broken")) {
      setTimeout(() => this.emit("error", { error: { code: 25, message: "The manifest didn't load." } }), 0);
      return;
    }
    setTimeout(() => this.emit("streamInitialized", {}), 0);
    // Handing dash.js the element resets a play() asked for earlier; dash.js plays it itself.
    (view as HTMLMediaElement & { _paused?: boolean })._paused = true;
    if (autoPlay) void view.play();
  }
  updateSettings(s: object) {
    this.settings.push(s as Record<string, unknown>);
  }
  on(type: string, listener: (e: DashEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, e: DashEvent) {
    for (const l of this.listeners.get(type) ?? []) l(e);
  }
  getRepresentationsByType() {
    return this.reps;
  }
  setRepresentationForTypeByIndex(_type: "video", index: number) {
    this.held.push(index);
  }
  enableText(on: boolean) {
    this.text = on;
    return on;
  }
  setTextTrack(i: number) {
    this.textTrack = i;
  }
  getTargetLiveDelay() {
    return 6;
  }
  timeAsUTC() {
    return 1_790_000_000;
  }
  clearDefaultUTCTimingSources() {
    this.clearedTiming = true;
  }
  destroy() {
    this.destroyed = true;
  }
  /** The last ABR settings sent. */
  abr() {
    const last = [...this.settings].reverse().find((s) => (s.streaming as { abr?: unknown } | undefined)?.abr);
    return (last?.streaming as { abr: { autoSwitchBitrate: { video: boolean }; maxBitrate: { video: number }; initialBitrate: { video: number } } }).abr;
  }
}

const fakeModule: DashJsModule = { MediaPlayer: () => ({ create: () => new FakeDashPlayer() }) };

vi.mock("dashjs", () => {
  imports.count++;
  return fakeModule_();
});
// (vi.mock's factory is hoisted above the class; it reaches it through this function.)
function fakeModule_() {
  return { MediaPlayer: () => ({ create: () => new FakeDashPlayer() }), default: {} };
}

const CIVC = station("CIVC", "7.1");
const BEAT = station("BEAT", "12.1");

function external(callSign: string, channel: string, format: "hls" | "dash", url: string): Channel {
  const base = station(callSign, channel);
  return {
    ...base,
    station: { ...base.station, kind: "listed", name: `${callSign} channel` },
    now: null,
    next: null,
    playback: { kind: "hls", url, ...(format === "dash" ? { format: "dash" as const } : {}) },
    external: { source: `${callSign} public access`, plays: "stream_link", schedule: "none" }
  };
}

const COLT = external("COLT", "9.2", "hls", "https://colton.example.gov/live/council.m3u8");
const LOMA = external("LOMA", "9.7", "dash", "https://lomalinda.example.gov/live/manifest.mpd");
const BROKEN = external("BRKN", "9.8", "dash", "https://broken.example.gov/live/manifest.mpd");
const BRKH = external("BRKH", "9.9", "hls", "https://broken.example.gov/live/master.m3u8");

let engine: PlayerEngine;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  stubMedia();
  FakeDashPlayer.all = [];
  host = document.createElement("div");
});
afterEach(() => {
  engine?.destroy();
  vi.useRealTimers();
});

const videos = (id: string) => [...host.querySelectorAll("video")].filter((v) => (v as HTMLVideoElement).dataset.station === id) as HTMLVideoElement[];

function make(o: ConstructorParameters<typeof PlayerEngine>[0] = {}) {
  engine = new PlayerEngine({ driver: fakeDriver({ fails: (u) => (u.includes("broken") ? "manifestLoadError" : null) }), dashSupport: () => "mse", warm: "buffer", bannerMs: 5000, numberWaitMs: 2000, reducedMotion: () => false, ...o });
  engine.attach(host);
  engine.setChannels([CIVC, COLT, LOMA, BEAT]);
  return engine;
}

describe("dash.js, on demand", () => {
  it("is never loaded for HLS rows or a DASH neighbour, and loads once a DASH row is tuned", async () => {
    const { fetch, urls } = fakeFetch(() => "#EXTM3U\n");
    // The real driver (dash.js from `import("dashjs")`), prefetching neighbours as the web does.
    make({ warm: "prefetch", fetch });
    await until(engine.tune(CIVC.station.id));
    // COLT (HLS) is 9.2, LOMA (DASH) 9.7: tune COLT, whose neighbour up is LOMA.
    await until(engine.tune(COLT.station.id));
    await flush(CHANGE_MS);
    expect(engine.getState()).toMatchObject({ currentId: COLT.station.id, status: "playing" });
    expect(imports.count).toBe(0);
    expect(dashJsLoads()).toBe(0);
    // The DASH neighbour isn't warmed: no manifest fetched, no deck.
    expect(urls.some((u) => u.endsWith(".mpd"))).toBe(false);
    expect(engine.getState().warm.map((w) => w.stationId)).not.toContain(LOMA.station.id);
    expect(videos(LOMA.station.id)).toHaveLength(0);

    await until(engine.tune(LOMA.station.id));
    await flush(CHANGE_MS);
    expect(imports.count).toBe(1);
    expect(dashJsLoads()).toBe(1);
    expect(engine.getState()).toMatchObject({ currentId: LOMA.station.id, status: "playing" });
    expect(FakeDashPlayer.all).toHaveLength(1);
    expect(FakeDashPlayer.all[0]).toMatchObject({ url: LOMA.playback!.url, autoPlay: true, clearedTiming: true });
    // Straight from the source's address: the player fetched nothing itself.
    expect(urls.some((u) => u.endsWith(".mpd"))).toBe(false);
  });
});

describe("a DASH stream link in the player", () => {
  let loads: number;
  const dashDriver = () => {
    loads = 0;
    return dashJsDriver(async () => {
      loads++;
      return fakeModule;
    });
  };

  it("changes channel like HLS: the static until the first frame, then the picture", async () => {
    make({ dashDriver: dashDriver() });
    await until(engine.tune(CIVC.station.id));
    const t = engine.tune(LOMA.station.id);
    expect(engine.getState().tuning).toMatchObject({ stationId: LOMA.station.id, look: "static" });
    await until(t);
    await flush(CHANGE_MS);
    expect(engine.getState()).toMatchObject({ currentId: LOMA.station.id, status: "playing", tuning: null });
    expect(loads).toBe(1);
    const v = videos(LOMA.station.id)[0]!;
    expect(v.classList.contains("is-on")).toBe(true);
  });

  it("shows Tuning in, then Stand by, when the picture is slow, and plays when it comes", async () => {
    make({ dashDriver: dashDriver() });
    await until(engine.tune(CIVC.station.id));
    // The picture takes 10 s.
    const { frameDelay } = await import("../test-helpers");
    frameDelay[LOMA.station.id] = 10_000;
    const t = engine.tune(LOMA.station.id);
    await flush(1000);
    expect(engine.getState().tuning?.phase).toBe("tuning_in");
    await flush(STANDBY_MS);
    expect(engine.getState()).toMatchObject({ currentId: LOMA.station.id, status: "standby" });
    await until(t);
    await flush(CHANGE_MS);
    expect(engine.getState().status).toBe("playing");
    delete frameDelay[LOMA.station.id];
  });

  it("goes to Stand by on errors, exactly as an HLS stream link that fails, and keeps trying", async () => {
    const at = async (row: Channel) => {
      make({ dashDriver: dashDriver() });
      engine.setChannels([CIVC, COLT, LOMA, BROKEN, BRKH, BEAT]);
      await until(engine.tune(CIVC.station.id));
      void engine.tune(row.station.id);
      const seen: string[] = [];
      for (let ms = 0; ms <= STANDBY_MS + 100; ms += 100) {
        await flush(100);
        const s = engine.getState();
        if (seen.at(-1) !== s.status) seen.push(s.status);
      }
      const s = engine.getState();
      engine.destroy();
      return { seen, status: s.status, error: s.error };
    };
    const dash = await at(BROKEN);
    const hls = await at(BRKH);
    expect(dash.status).toBe("standby");
    expect(dash.seen).toEqual(hls.seen);
    expect(dash.error).toBe("The manifest didn't load.");
    // Loaded afresh after each failure (a new dash.js player each time), with the module loaded once.
    expect(FakeDashPlayer.all.length).toBeGreaterThan(1);
    expect(FakeDashPlayer.all.slice(0, -1).every((p) => p.destroyed)).toBe(true);
  });

  it("tears down on a channel change: the dash.js player destroyed, its video gone", async () => {
    make({ dashDriver: dashDriver() });
    await until(engine.tune(CIVC.station.id));
    await until(engine.tune(LOMA.station.id));
    await flush(CHANGE_MS);
    const p = FakeDashPlayer.all[0]!;
    expect(videos(LOMA.station.id)).toHaveLength(1);
    // Up to BEAT (12.1): LOMA is BEAT's neighbour, but a DASH neighbour is never kept warm.
    await until(engine.tune(BEAT.station.id));
    await flush(CHANGE_MS);
    expect(engine.getState()).toMatchObject({ currentId: BEAT.station.id, status: "playing" });
    expect(p.destroyed).toBe(true);
    expect(videos(LOMA.station.id)).toHaveLength(0);
    expect(FakeDashPlayer.all).toHaveLength(1);
    // Again and back: one dash.js player at a time, the module loaded once.
    await until(engine.tune(LOMA.station.id));
    await flush(CHANGE_MS);
    await until(engine.tune(COLT.station.id));
    await flush(CHANGE_MS);
    expect(FakeDashPlayer.all.map((x) => x.destroyed)).toEqual([true, true]);
    expect(videos(LOMA.station.id)).toHaveLength(0);
    expect(loads).toBe(2);
  });

  it("mutes and unmutes, and plays on muted with Tap for sound when sound isn't allowed", async () => {
    make({ dashDriver: dashDriver() });
    await until(engine.tune(LOMA.station.id));
    await flush(CHANGE_MS);
    const v = videos(LOMA.station.id)[0]!;
    expect(v.muted).toBe(false);
    engine.setMuted(true);
    expect(v.muted).toBe(true);
    engine.setMuted(false);
    expect(v.muted).toBe(false);
    // Chrome pausing a picture unmuted before any click on the page: it plays on muted, with "Tap for sound".
    await until(engine.tune(CIVC.station.id));
    await flush(CHANGE_MS);
    await until(engine.tune(LOMA.station.id));
    const again = videos(LOMA.station.id)[0]!;
    expect(again.muted).toBe(false);
    (again as HTMLVideoElement & { _paused?: boolean })._paused = true;
    again.dispatchEvent(new Event("pause"));
    expect(again.muted).toBe(true);
    expect(engine.getState()).toMatchObject({ status: "playing", mutedByBrowser: true });
    engine.setMuted(false);
    expect(again.muted).toBe(false);
    expect(engine.getState().mutedByBrowser).toBe(false);
  });

  it("counts in the heartbeat as an HLS stream link does", async () => {
    make({ dashDriver: dashDriver() });
    const beats: HeartbeatBody[] = [];
    const stop = startHeartbeat(engine, async (b) => void beats.push(b), "web", "session-1");
    await until(engine.tune(LOMA.station.id));
    await flush(CHANGE_MS);
    await until(engine.tune(COLT.station.id));
    await flush(CHANGE_MS);
    stop();
    expect(beats.map((b) => [b.stationId, b.playing])).toEqual([
      [LOMA.station.id, true],
      [COLT.station.id, true]
    ]);
  });

  it("maps captions and picture quality onto dash.js", async () => {
    make({ dashDriver: dashDriver(), quality: "data_saver" });
    await until(engine.tune(LOMA.station.id));
    await flush(CHANGE_MS);
    const p = FakeDashPlayer.all[0]!;
    // Data saver: capped at 360 lines (220 kbps), starting low.
    expect(p.abr()).toEqual({ autoSwitchBitrate: { video: true }, maxBitrate: { video: 220 }, initialBitrate: { video: 1 } });
    engine.setOptions({ quality: "best" });
    expect(p.abr()).toEqual({ autoSwitchBitrate: { video: false }, maxBitrate: { video: -1 }, initialBitrate: { video: 400 } });
    expect(p.held.at(-1)).toBe(2);
    // A stall hands it to ABR; back at the top, it's held again.
    p.emit("bufferStalled", { mediaType: "video" });
    expect(p.abr().autoSwitchBitrate.video).toBe(true);
    p.emit("qualityChangeRendered", { mediaType: "video", newRepresentation: { index: 2 } });
    expect(p.abr().autoSwitchBitrate.video).toBe(false);
    engine.setOptions({ quality: "auto" });
    expect(p.abr()).toEqual({ autoSwitchBitrate: { video: true }, maxBitrate: { video: -1 }, initialBitrate: { video: -1 } });
    engine.setCaptions("on");
    expect(p).toMatchObject({ text: true, textTrack: 0 });
    engine.setCaptions("off");
    expect(p.text).toBe(false);
  });
});

describe("picture quality for dash.js's ABR", () => {
  const reps = [
    { bandwidth: 5_000_000, height: 1080 },
    { bandwidth: 2_400_000, height: 720 },
    { bandwidth: 1_200_000, height: 480 },
    { bandwidth: 900_000, height: 480 },
    { bandwidth: 600_000, height: 360 }
  ];
  it("auto is dash.js's own ABR, uncapped", () => {
    expect(dashAbr("auto", reps)).toEqual({ autoSwitch: true, maxKbps: -1, initialKbps: -1, hold: null });
  });
  it("data saver caps at 480 lines, at that height's lowest bitrate", () => {
    expect(dashAbr("data_saver", reps)).toEqual({ autoSwitch: true, maxKbps: 900, initialKbps: 1, hold: null });
    // Every picture taller: the smallest there is.
    expect(dashAbr("data_saver", [{ bandwidth: 3_000_000, height: 1080 }, { bandwidth: 1_500_000, height: 720 }]).maxKbps).toBe(1500);
    // Before the manifest: start low, cap once it's read.
    expect(dashAbr("data_saver", [])).toEqual({ autoSwitch: true, maxKbps: -1, initialKbps: 1, hold: null });
  });
  it("best holds the top, and hands it to ABR after a stall", () => {
    expect(dashAbr("best", reps)).toEqual({ autoSwitch: false, maxKbps: -1, initialKbps: 5000, hold: 0 });
    expect(dashAbr("best", reps, false)).toEqual({ autoSwitch: true, maxKbps: -1, initialKbps: 5000, hold: null });
    expect(dashAbr("best", []).initialKbps).toBe(1_000_000);
  });
});

describe("a device that can't play DASH", () => {
  it("skips DASH stations when swiping, and says so if one is tuned directly, loading nothing", async () => {
    const driver = { name: "dash-spy", attach: vi.fn() };
    make({ dashSupport: () => "none", dashDriver: driver as never });
    await until(engine.tune(COLT.station.id));
    await flush(CHANGE_MS);
    // Up from COLT 9.2 skips LOMA 9.7 to BEAT 12.1.
    engine.channelStep("up");
    await flush(CHANGE_MS + 500);
    expect(engine.getState().currentId).toBe(BEAT.station.id);
    engine.channelStep("down");
    await flush(CHANGE_MS + 500);
    expect(engine.getState().currentId).toBe(COLT.station.id);
    // By number (or the guide): it says it can't play here.
    await until(engine.tune(LOMA.station.id));
    await flush(CHANGE_MS);
    expect(engine.getState()).toMatchObject({ currentId: LOMA.station.id, status: "unplayable", pendingId: null });
    expect(driver.attach).not.toHaveBeenCalled();
    expect(videos(LOMA.station.id)).toHaveLength(0);
  });

  it("the swipe order skips DASH where asked (the Cast receiver)", () => {
    const list = [CIVC, COLT, LOMA, BEAT];
    expect(neighbour(list, COLT.station.id, "up")?.station.callSign).toBe("LOMA");
    expect(neighbour(list, COLT.station.id, "up", { skipDash: true })?.station.callSign).toBe("BEAT");
    expect(isDash(LOMA)).toBe(true);
    expect(isDash(COLT)).toBe(false);
  });
});
