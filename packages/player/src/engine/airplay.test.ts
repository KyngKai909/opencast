// AirPlay (Safari): offered while WebKit says an AirPlay TV is around; only the picture on screen
// is ever a candidate; a picture on hls.js hands over to a fresh <video> on Safari's own HLS, where
// WebKit's list opens; the TV playing it is followed, and Stop takes it back.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerEngine } from "./PlayerEngine";
import { CHANGE_MS, fakeDriver, flush, station, stubMedia } from "../test-helpers";

const CIVC = station("CIVC", "7.1");
const BEAT = station("BEAT", "12.1");

type WebKitVideo = HTMLVideoElement & { webkitCurrentPlaybackTargetIsWireless?: boolean };
let picker: ReturnType<typeof vi.fn>;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  stubMedia();
  vi.stubGlobal("WebKitPlaybackTargetAvailabilityEvent", class {});
  picker = vi.fn();
  (HTMLMediaElement.prototype as unknown as { webkitShowPlaybackTargetPicker: () => void }).webkitShowPlaybackTargetPicker = function (this: HTMLVideoElement) {
    picker(this);
  };
  host = document.createElement("div");
});
afterEach(() => {
  delete (HTMLMediaElement.prototype as unknown as { webkitShowPlaybackTargetPicker?: unknown }).webkitShowPlaybackTargetPicker;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** An engine on `driver` (hls.js stands as "fake"), AirPlay handing over to a "native" stand-in. */
async function tuned(driverName = "fake") {
  const driver = { ...fakeDriver(), name: driverName };
  const native = { ...fakeDriver(), name: "native" };
  const engine = new PlayerEngine({ driver, airPlayDriver: native, warm: "buffer" });
  engine.attach(host);
  engine.setChannels([CIVC, BEAT]);
  const t = engine.tune(CIVC.station.id);
  await flush(10);
  await t;
  return engine;
}

const probe = () => host.querySelector("video.oc-player__probe") as HTMLVideoElement;
const say = (availability: "available" | "not-available") => probe().dispatchEvent(Object.assign(new Event("webkitplaybacktargetavailabilitychanged"), { availability }));
const pictures = () => [...host.querySelectorAll("video:not(.oc-player__probe)")] as WebKitVideo[];
const onScreen = () => pictures().find((v) => v.classList.contains("is-on"))!;
const goWireless = (v: WebKitVideo, on: boolean) => {
  v.webkitCurrentPlaybackTargetIsWireless = on;
  v.dispatchEvent(new Event("webkitcurrentplaybacktargetiswirelesschanged"));
};

describe("AirPlay", () => {
  it("is offered while WebKit says an AirPlay TV is around (never outside Safari)", async () => {
    const engine = await tuned();
    expect(engine.getState().airPlay).toEqual({ available: false, active: false });
    expect(probe().getAttribute("x-webkit-airplay")).toBe("allow");
    say("available");
    expect(engine.getState().airPlay.available).toBe(true);
    say("not-available");
    expect(engine.getState().airPlay.available).toBe(false);
    engine.destroy();

    vi.unstubAllGlobals();
    host = document.createElement("div");
    const chrome = await tuned();
    expect(probe()).toBeNull();
    chrome.destroy();
  });

  it("only the picture on screen is a candidate: warm neighbours are denied, with remote playback off", async () => {
    const engine = await tuned();
    const [civc, beat] = [pictures().find((v) => v.dataset.station === CIVC.station.id)!, pictures().find((v) => v.dataset.station === BEAT.station.id)!];
    expect(civc.getAttribute("x-webkit-airplay")).toBe("allow");
    expect(beat.getAttribute("x-webkit-airplay")).toBe("deny");
    expect(beat.disableRemotePlayback).toBe(true);
    engine.destroy();
  });

  it("a picture on Safari's own HLS opens WebKit's list itself", async () => {
    const engine = await tuned("native");
    say("available");
    const v = onScreen();
    expect(v.disableRemotePlayback).toBe(false);
    expect(engine.showAirPlayPicker()).toBe(true);
    expect(picker).toHaveBeenCalledWith(v);
    expect(pictures()).toHaveLength(2);
    engine.destroy();
  });

  it("a picture on hls.js hands over to a fresh native <video>: the list opens on it at once, the old picture stays until it has a frame", async () => {
    const engine = await tuned();
    say("available");
    const old = onScreen();
    engine.showAirPlayPicker();
    const twin = picker.mock.calls[0]![0] as WebKitVideo;
    expect(twin).not.toBe(old);
    expect(twin.dataset.station).toBe(CIVC.station.id);
    expect(twin.getAttribute("x-webkit-airplay")).toBe("allow");
    expect(onScreen()).toBe(old);
    await flush(10);
    expect(onScreen()).toBe(twin);
    expect(old.isConnected).toBe(false);
    engine.destroy();
  });

  it("follows the TV playing it, and Stop takes the picture back", async () => {
    const engine = await tuned("native");
    say("available");
    const v = onScreen();
    engine.showAirPlayPicker();
    goWireless(v, true);
    expect(engine.getState().airPlay).toEqual({ available: true, active: true });
    engine.stopAirPlay();
    expect(engine.getState().airPlay.active).toBe(false);
    expect(v.getAttribute("x-webkit-airplay")).toBe("deny");
    expect(v.disableRemotePlayback).toBe(true);
    // Asked again: allowed again.
    engine.showAirPlayPicker();
    expect(v.getAttribute("x-webkit-airplay")).toBe("allow");
    engine.destroy();
  });

  it("a channel change leaves AirPlay: the new picture isn't on the TV", async () => {
    const engine = await tuned("native");
    say("available");
    goWireless(onScreen(), true);
    expect(engine.getState().airPlay.active).toBe(true);
    const t = engine.tune(BEAT.station.id);
    await flush(CHANGE_MS);
    await t;
    expect(engine.getState().airPlay.active).toBe(false);
    engine.destroy();
  });
});
