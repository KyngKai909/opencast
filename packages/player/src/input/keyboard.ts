// Keys, for two places:
// - "tv": a TV's remote (Android TV, Google TV, Fire TV, TV browsers). On the picture, ▲ ▼ change
//   channel, ◀ opens presets, ▶ the guide, OK the banner (OK again the guide), numbers tune.
//   In the guide and menus, the arrows move focus. OK and Back act when they're let go, so they
//   can be held: hold OK is OK with `hold` (replace a full preset slot), hold Back opens the menu
//   rail (a basic remote has no Menu key, and Home never reaches apps).
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
  // Numbers mean something in overlays too (presets 1 to 6, jumping in the guide): the app decides.
  if (/^[0-9]$/.test(key)) return { type: "digit", digit: Number(key) };
  if (key === "." || key === "Decimal") return { type: "dot" };
  const arrows: Record<string, "up" | "down" | "left" | "right"> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
  if (arrows[key]) {
    if (where === "overlay") return { type: "focus", dir: arrows[key] };
    if (key === "ArrowUp") return { type: "channel", dir: "up" };
    if (key === "ArrowDown") return { type: "channel", dir: "down" };
    if (key === "ArrowLeft") return { type: "presets" };
    return { type: "guide" };
  }
  // A computer's keyboard in TV mode: the space bar (or k) pauses and resumes, on the picture only.
  if ((key === " " || key === "k") && where === "picture") return { type: "togglePlay" };
  const mapped = TV_KEYS[key];
  if (mapped === "ok") return { type: "select" };
  if (mapped && where === "overlay" && mapped.type === "back") return mapped;
  if (mapped && where === "picture" && mapped.type === "back") return { type: "last" };
  return mapped ?? null;
}

/** How long OK or Back is held before it counts as a hold (Android TV's long press). */
export const HOLD_MS = 500;

/** TV: what holding the key sends instead, for the keys that can be held (OK, Back). */
export function holdFor(cmd: Command): Command | null {
  if (cmd.type === "select") return { type: "select", hold: true };
  if (cmd.type === "back" || cmd.type === "last") return { type: "menu" };
  return null;
}

export function keyboardInput(o: KeyboardOptions): InputAdapter {
  return {
    name: o.profile === "tv" ? "remote" : "keyboard",
    start(dispatch: Dispatch) {
      const target = o.target ?? window;
      const source = { input: o.profile === "tv" ? "remote" : "keyboard" };
      // The key being held (OK or Back): it acts when let go, or as a hold after HOLD_MS.
      let held: { key: string; press: Command; timer: ReturnType<typeof setTimeout>; fired: boolean } | null = null;
      const letGo = () => {
        if (held) clearTimeout(held.timer);
        held = null;
      };
      const onKey = (e: Event) => {
        const k = e as KeyboardEvent;
        if (k.defaultPrevented || k.altKey || k.ctrlKey || k.metaKey || typing(k)) return;
        const cmd = commandForKey(k, o.profile, o.context?.() ?? "picture");
        if (!cmd) return;
        k.preventDefault();
        const hold = o.profile === "tv" ? holdFor(cmd) : null;
        if (hold) {
          // Key repeat while it's held down: the hold timer is already running.
          if (k.repeat || held?.key === k.key) return;
          letGo();
          const h = { key: k.key, press: cmd, fired: false, timer: setTimeout(() => {
            h.fired = true;
            dispatch(hold, source);
          }, HOLD_MS) };
          held = h;
          return;
        }
        dispatch(cmd, source);
      };
      const onUp = (e: Event) => {
        const k = e as KeyboardEvent;
        if (!held || k.key !== held.key) return;
        const { press, fired } = held;
        letGo();
        k.preventDefault();
        if (!fired) dispatch(press, source);
      };
      target.addEventListener("keydown", onKey);
      target.addEventListener("keyup", onUp);
      // Focus leaving the page mid-press: no key-up will come, so nothing is sent.
      target.addEventListener("blur", letGo);
      return () => {
        letGo();
        target.removeEventListener("keydown", onKey);
        target.removeEventListener("keyup", onUp);
        target.removeEventListener("blur", letGo);
      };
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
