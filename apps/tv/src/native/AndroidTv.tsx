// The Android TV and Fire TV app's wiring inside TV mode (main.tsx mounts it only there): keeps
// the screen on while the picture plays, goes back to the TV's home screen when the sleep timer
// ends, and pauses in the background. The rules are in lifecycle.ts; the remote's keys come in
// through keys.ts (startNativeKeys), and Back with nothing to go back to is the watching screen's.

import { useEffect, useRef } from "react";
import { App } from "@capacitor/app";
import { usePlayer } from "@opencast/player";
import { deliverKey } from "./keys";
import { keepAwake, onAppState, sleepEnded } from "./lifecycle";
import { OpencastTv, type OpencastTvPlugin } from "./plugin";

/** Calls back with whether the app is in front; returns a function that stops. */
export type AppStateSource = (fn: (active: boolean) => void) => () => void;

const appState: AppStateSource = (fn) => {
  const handle = App.addListener("appStateChange", ({ isActive }) => fn(isActive));
  return () => void handle.then((h) => h.remove());
};

export interface AndroidTvProps {
  tv?: Pick<OpencastTvPlugin, "setKeepScreenOn" | "exitToHome">;
  appStates?: AppStateSource;
}

export function AndroidTv({ tv = OpencastTv, appStates = appState }: AndroidTvProps) {
  const [s, engine] = usePlayer();

  const awake = keepAwake(s.status);
  useEffect(() => {
    void tv.setKeepScreenOn({ on: awake }).catch(() => undefined);
  }, [tv, awake]);

  const before = useRef(s.status);
  useEffect(() => {
    if (sleepEnded(before.current, s.status)) void tv.exitToHome().catch(() => undefined);
    before.current = s.status;
  }, [tv, s.status]);

  useEffect(() => {
    let pausedOnLeaving = false;
    return appStates((active) => {
      const act = onAppState(active, engine.getState().status, pausedOnLeaving);
      pausedOnLeaving = !active && act === "pause";
      if (act === "pause") engine.handle({ type: "pause" }, { input: "app" });
      if (act === "backToLive") engine.handle({ type: "backToLive" }, { input: "app" });
    });
  }, [engine, appStates]);

  return null;
}

/** The remote's keys from MainActivity into the page. Returns a function that stops. */
export function startNativeKeys(tv: Pick<OpencastTvPlugin, "addListener"> = OpencastTv): () => void {
  const handle = tv.addListener("key", (k) => void deliverKey(k));
  return () => void handle.then((h) => h.remove());
}
