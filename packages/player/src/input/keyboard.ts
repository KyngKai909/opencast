// Keys, for two places:
// - "tv": a TV's remote (Android TV, Google TV, Fire TV, TV browsers). On the picture, ▲ ▼ change
//   channel, ◀ opens presets, ▶ the guide, OK the banner (OK again the guide), numbers tune.
//   In the guide and menus, the arrows move focus.
// - "web": the viewer app on a computer. Digits 1 to 6 tune presets from anywhere; arrows change
//   channel on the tuned-in page (enable the adapter there); "/" belongs to search, not here.
// Keys typed into a text field are never taken.

import type { Command } from "../types";
import type { Dispatch, Hint, InputAdapter } from "./types";

export interface KeyboardOptions {
  profile: "tv" | "web";
  /** TV: whether focus is on the picture or inside an overlay (guide, menu, presets, settings). */
  context?: () => "picture" | "overlay";
  target?: Pick<Window, "addEventListener" | "removeEventListener">;
}

function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t || !t.tagName) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

/** Key names TVs send for their channel, info, guide and back buttons (plus common keyCodes). */
const TV_KEYS: Record<string, Command | "ok"> = {
  ChannelUp: { type: "channel", dir: "up" },
  ChannelDown: { type: "channel", dir: "down" },
  PageUp: { type: "channel", dir: "up" },
  PageDown: { type: "channel", dir: "down" },
  Info: { type: "info" },
  Guide: { type: "guide" },
  ContextMenu: { type: "menu" },
  Menu: { type: "menu" },
  GoBack: { type: "back" },
  BrowserBack: { type: "back" },
  Backspace: { type: "back" },
  Escape: { type: "back" },
  MediaPlayPause: { type: "togglePlay" },
  MediaPlay: { type: "play" },
  MediaPause: { type: "pause" },
  MediaLast: { type: "last" },
  Enter: "ok"
};
const TV_KEYCODES: Record<number, string> = { 427: "ChannelUp", 428: "ChannelDown", 33: "PageUp", 34: "PageDown", 457: "Info", 458: "Guide", 461: "GoBack", 10009: "GoBack" };

export function commandForKey(e: Pick<KeyboardEvent, "key" | "keyCode">, profile: "tv" | "web", where: "picture" | "overlay" = "picture"): Command | null {
  const key = TV_KEYCODES[e.keyCode] && !TV_KEYS[e.key] ? TV_KEYCODES[e.keyCode] : e.key;
  if (profile === "web") {
    if (/^[1-6]$/.test(key)) return { type: "preset", key: Number(key) };
    if (key === "ArrowUp") return { type: "channel", dir: "up" };
    if (key === "ArrowDown") return { type: "channel", dir: "down" };
    if (key === "PageUp" || key === "ChannelUp") return { type: "channel", dir: "up" };
    if (key === "PageDown" || key === "ChannelDown") return { type: "channel", dir: "down" };
    if (key === " " || key === "k" || key === "MediaPlayPause") return { type: "togglePlay" };
    if (key === "i") return { type: "info" };
    return null;
  }
  if (/^[0-9]$/.test(key)) return where === "picture" ? { type: "digit", digit: Number(key) } : null;
  if (key === "." || key === "Decimal") return where === "picture" ? { type: "dot" } : null;
  const arrows: Record<string, "up" | "down" | "left" | "right"> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
  if (arrows[key]) {
    if (where === "overlay") return { type: "focus", dir: arrows[key] };
    if (key === "ArrowUp") return { type: "channel", dir: "up" };
    if (key === "ArrowDown") return { type: "channel", dir: "down" };
    if (key === "ArrowLeft") return { type: "presets" };
    return { type: "guide" };
  }
  const mapped = TV_KEYS[key];
  if (mapped === "ok") return { type: "select" };
  if (mapped && where === "overlay" && mapped.type === "back") return mapped;
  if (mapped && where === "picture" && mapped.type === "back") return { type: "last" };
  return mapped ?? null;
}

export function keyboardInput(o: KeyboardOptions): InputAdapter {
  return {
    name: o.profile === "tv" ? "remote" : "keyboard",
    start(dispatch: Dispatch) {
      const target = o.target ?? window;
      const onKey = (e: Event) => {
        const k = e as KeyboardEvent;
        if (k.defaultPrevented || k.altKey || k.ctrlKey || k.metaKey || typing(k)) return;
        const cmd = commandForKey(k, o.profile, o.context?.() ?? "picture");
        if (!cmd) return;
        k.preventDefault();
        dispatch(cmd, { input: o.profile === "tv" ? "remote" : "keyboard" });
      };
      target.addEventListener("keydown", onKey);
      return () => target.removeEventListener("keydown", onKey);
    },
    hints(): Hint[] {
      if (o.profile !== "tv") return [];
      return [
        { kind: "key", key: "▲▼", label: "Channels" },
        { kind: "key", key: "OK", label: "Guide" },
        { kind: "key", key: "◀", label: "Presets" }
      ];
    }
  };
}
