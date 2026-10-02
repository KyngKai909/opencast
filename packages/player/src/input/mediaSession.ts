// The lock screen and headphone buttons: channel up and down, and pause (the reference's
// lock-screen controls). Where the browser supports Media Session; the native builds add more.

import type { Dispatch, InputAdapter } from "./types";

export function mediaSessionInput(): InputAdapter {
  return {
    name: "media-session",
    start(dispatch: Dispatch) {
      if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return () => {};
      const ms = navigator.mediaSession;
      const set = (action: MediaSessionAction, fn: (() => void) | null) => {
        try {
          ms.setActionHandler(action, fn);
        } catch {
          // Not every browser supports every action.
        }
      };
      const src = { input: "media-session" };
      set("nexttrack", () => dispatch({ type: "channel", dir: "up" }, src));
      set("previoustrack", () => dispatch({ type: "channel", dir: "down" }, src));
      set("pause", () => dispatch({ type: "pause" }, src));
      set("play", () => dispatch({ type: "play" }, src));
      return () => (["nexttrack", "previoustrack", "pause", "play"] as MediaSessionAction[]).forEach((a) => set(a, null));
    }
  };
}
