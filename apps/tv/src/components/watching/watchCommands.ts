// What the watching screen ("/") does with a command before the player gets it, as a rule apart
// from the screen. In order: the sleep fade's notice takes OK ("30 more minutes"); after the
// sleep timer, OK starts again (TV app); the reminder card takes OK (switch) and Back (wave it
// away), except while a number is being typed; in the Android TV and Fire TV app, the remote's
// Back with no last channel to go back to leaves for the TV's home screen; a phone's "+" saves
// what's on to its key; off air and stand by take the arrows (◀ ▶ between the buttons, ▲ ▼
// still change channel) and OK. Null: the player's, as usual.

import type { Command } from "@opencast/player";

export interface WatchState {
  fading: boolean;
  stopped: boolean;
  tvApp: boolean;
  card: boolean;
  typing: boolean;
  airShown: boolean;
  currentId: string | null;
  /** Remote and phones: channel up goes down the dial (the TV remote's keys only). */
  flip: boolean;
  /**
   * The Android TV app's remote pressed Back and there's no last channel to go back to: Back
   * leaves the app, as Android TV and Fire TV apps do. Never from a phone, never in a browser.
   */
  exitable?: boolean;
}

export type WatchAction =
  | { do: "moreTime" }
  | { do: "exit" }
  | { do: "restart" }
  | { do: "switch" }
  | { do: "wave" }
  | { do: "savePreset"; key: number }
  | { do: "channel"; dir: "up" | "down" }
  | { do: "focus"; dir: "left" | "right" }
  | { do: "press" };

export function watchCommand(c: Command, s: WatchState): WatchAction | null {
  if (s.fading && c.type === "select") return { do: "moreTime" };
  if (s.stopped && s.tvApp && c.type === "select") return { do: "restart" };
  if (s.card && !s.typing) {
    if (c.type === "select") return { do: "switch" };
    if (c.type === "back") return { do: "wave" };
  }
  // Back on the picture arrives as "last" (or "back" while off air takes the arrows).
  if (s.exitable && !s.card && !s.typing && (c.type === "last" || c.type === "back")) return { do: "exit" };
  if (c.type === "savePreset" && s.currentId) return { do: "savePreset", key: c.key };
  if (s.airShown) {
    if (c.type === "focus") {
      if (c.dir === "up" || c.dir === "down") return { do: "channel", dir: s.flip ? (c.dir === "up" ? "down" : "up") : c.dir };
      return { do: "focus", dir: c.dir };
    }
    if (c.type === "select") return { do: "press" };
  }
  return null;
}
