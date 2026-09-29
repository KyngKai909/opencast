// The Android TV and Fire TV app's rules around the picture, apart from the screen (AndroidTv.tsx):
// - the screen stays on while the picture plays (FLAG_KEEP_SCREEN_ON), and the TV's own screen
//   saver may come back once it's paused, off air, or stopped;
// - the sleep timer's end stops Opencast, not the TV: the app goes back to the TV's home screen;
// - leaving the app (Home, which never reaches it, or another app starting) pauses the picture,
//   and coming back returns to live (Android TV apps don't play on behind the home screen).

import type { Status } from "@opencast/player";

/** Whether the screen stays on: while a station plays or is tuning. */
export function keepAwake(status: Status): boolean {
  return status === "playing" || status === "tuning" || status === "embed";
}

/** The sleep timer just stopped Opencast (engine.stop() is only the sleep timer's). */
export function sleepEnded(before: Status, now: Status): boolean {
  return before !== "stopped" && now === "stopped";
}

/**
 * The app went to the background or came back. Leaving pauses what plays; coming back goes back
 * to live, but only if leaving paused it (someone who paused first finds it still paused).
 */
export function onAppState(active: boolean, status: Status, pausedOnLeaving: boolean): "pause" | "backToLive" | null {
  if (!active) return status === "playing" ? "pause" : null;
  return pausedOnLeaving && status === "paused" ? "backToLive" : null;
}
