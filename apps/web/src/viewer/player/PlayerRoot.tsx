// The one player, for the whole app: it keeps playing as you move between pages (the player bar
// or the mini player shows it, with the tally lit), and the tuned-in page shows its picture.

import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { audienceApi } from "@opencast/contracts";
import { PlayerProvider, startHeartbeat, tuningSoundFrom, usePlayer, type EngineOptions, type InputAdapter } from "@opencast/player";
import { call } from "../../api/client";
import { setDevice } from "../device/store";
import { useChannels, usePresets } from "../data/viewer";
import { useNotForMeFlag } from "../data/notForMe";
import { useSavedSettings } from "../layout/SettingsSync";
import { lockScreenInput, nowPlayingInfo } from "../native/lockScreen";
import { hasPlugin } from "../native/platform";

// Neighbours are pre-warmed by their playlists and first segment (no hidden <video>).
const OPTIONS: EngineOptions = { warm: "prefetch", neighbours: { sameBand: true }, bannerMs: 5000, numberWaitMs: 2000 };
// The lock screen and headset buttons: the web's Media Session, or the apps' own plugin.
const INPUTS: InputAdapter[] = [lockScreenInput()];

function isPhone() {
  return typeof window !== "undefined" && (window.matchMedia?.("(max-width: 767px)").matches || /iPhone|Android.+Mobile/.test(navigator.userAgent));
}

/** Keeps the engine's dial, presets and settings current, and runs the heartbeat. */
function PlayerSync() {
  const [, engine] = usePlayer();
  const channels = useChannels();
  const { presets } = usePresets();
  const settings = useSavedSettings();

  useEffect(() => engine.setChannels(channels), [engine, channels]);
  useEffect(() => engine.setPresets(Object.fromEntries(presets.filter((p) => p.key !== null).map((p) => [p.key, p.station.id]))), [engine, presets]);
  useEffect(() => {
    // The account's, or this device's when signed out.
    const w = settings?.watching;
    if (w?.captions) engine.setCaptions(w.captions, w.captionSize);
    // "Tuning sound", per band (on for radio, off for video unless set): kept for Phase 5's tuning.
    engine.setOptions({ tuningSound: tuningSoundFrom(w) });
  }, [engine, settings?.watching]);
  useEffect(() => startHeartbeat(engine, (body) => call(audienceApi.heartbeat, { body }), isPhone() ? "phone" : "web"), [engine]);
  // The apps' switches ("Not for me"): read at start, then every few minutes (data/notForMe.ts).
  useNotForMeFlag();
  return null;
}

/** The apps: the lock screen shows the station and what's on, with channel up, down and pause. */
function NowPlayingSync() {
  const np = useNowPlaying();
  const info = nowPlayingInfo(np.row, np.status === "playing");
  const key = info ? `${info.title}|${info.subtitle ?? ""}|${info.playing}` : "";
  useEffect(() => {
    void import("../native/plugins").then(({ OpencastNowPlaying }) => (info ? OpencastNowPlaying.update(info) : OpencastNowPlaying.clear())).catch(() => {});
  }, [key]); // `key` stands for `info`'s contents
  return null;
}

const NATIVE_NOW_PLAYING = hasPlugin("OpencastNowPlaying");

export function PlayerRoot({ children }: { children: ReactNode }) {
  return (
    <PlayerProvider options={OPTIONS} inputs={INPUTS}>
      <PlayerSync />
      {NATIVE_NOW_PLAYING && <NowPlayingSync />}
      {children}
    </PlayerProvider>
  );
}

/** Tunes the player (and remembers the channel on this device for "Start on: Last channel"). */
export function useTune() {
  const [, engine] = usePlayer();
  return useCallback(
    (stationId: string) => {
      setDevice({ lastStationId: stationId });
      return engine.tune(stationId, { input: "app" });
    },
    [engine]
  );
}

/** What's playing, for the player bar and mini player. */
export function useNowPlaying() {
  const [s] = usePlayer();
  return useMemo(() => {
    const row = s.channels.find((c) => c.station.id === (s.pendingId ?? s.currentId));
    return { row: row ?? null, playing: s.status === "playing" && s.pendingId === null, status: s.status };
  }, [s]);
}
