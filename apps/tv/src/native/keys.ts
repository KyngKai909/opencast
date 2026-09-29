// The remote's keys on Android TV and Fire TV. MainActivity takes the TV's own keys from the
// WebView (which doesn't pass them on reliably) and sends each press and release here, as
// Android's key code; they go into the page as the KeyboardEvents packages/player's keyboard
// adapter already maps (keyboard.ts: ChannelUp 427, Guide 458, GoBack 461…), so the Android app,
// a TV browser and a computer's keyboard all run the same key handling, holds included.
//
// The D-pad's arrows aren't here: the WebView delivers them as ArrowUp and the rest by itself.

import { HOLD_MS } from "@opencast/player";

/** One key from MainActivity (OpencastTvPlugin.sendKey). */
export interface NativeKey {
  type: "down" | "up";
  /** Android's KeyEvent key code. */
  code: number;
  /** A key-down repeated while the key is held. */
  repeat?: boolean;
  /** The system took the press (a key-up that mustn't act). */
  canceled?: boolean;
}

interface Key {
  /** Android's KeyEvent.KEYCODE_… value. */
  code: number;
  /** The KeyboardEvent key the page sees: a name keyboard.ts maps. */
  key: string;
  /** Its legacy keyCode (TV browsers' values for the TV keys). */
  keyCode: number;
}

const digits = (prefix: "KEYCODE_" | "KEYCODE_NUMPAD_", first: number, firstKeyCode: number) =>
  Object.fromEntries(Array.from({ length: 10 }, (_, d) => [`${prefix}${d}`, { code: first + d, key: String(d), keyCode: firstKeyCode + d }]));

/**
 * The keys MainActivity forwards (TvKeys.java lists the same names; a test holds them in step),
 * and the key each becomes.
 */
export const ANDROID_KEYS: Record<string, Key> = {
  // Back: on the picture the last channel, in overlays close; held, the menu (keyboard.ts).
  KEYCODE_BACK: { code: 4, key: "GoBack", keyCode: 461 },
  // OK. Held, OK with `hold` (replace a full preset slot).
  KEYCODE_DPAD_CENTER: { code: 23, key: "Enter", keyCode: 13 },
  KEYCODE_ENTER: { code: 66, key: "Enter", keyCode: 13 },
  KEYCODE_NUMPAD_ENTER: { code: 160, key: "Enter", keyCode: 13 },
  KEYCODE_CHANNEL_UP: { code: 166, key: "ChannelUp", keyCode: 427 },
  KEYCODE_CHANNEL_DOWN: { code: 167, key: "ChannelDown", keyCode: 428 },
  KEYCODE_PAGE_UP: { code: 92, key: "PageUp", keyCode: 33 },
  KEYCODE_PAGE_DOWN: { code: 93, key: "PageDown", keyCode: 34 },
  KEYCODE_GUIDE: { code: 172, key: "Guide", keyCode: 458 },
  KEYCODE_INFO: { code: 165, key: "Info", keyCode: 457 },
  // Fire TV's ≡ key, and Menu on remotes that have one.
  KEYCODE_MENU: { code: 82, key: "ContextMenu", keyCode: 93 },
  KEYCODE_LAST_CHANNEL: { code: 229, key: "MediaLast", keyCode: 0 },
  KEYCODE_MEDIA_PLAY_PAUSE: { code: 85, key: "MediaPlayPause", keyCode: 179 },
  KEYCODE_MEDIA_PLAY: { code: 126, key: "MediaPlay", keyCode: 250 },
  KEYCODE_MEDIA_PAUSE: { code: 127, key: "MediaPause", keyCode: 19 },
  // Next and previous change channel, as the phone's lock screen does.
  KEYCODE_MEDIA_NEXT: { code: 87, key: "ChannelUp", keyCode: 427 },
  KEYCODE_MEDIA_PREVIOUS: { code: 88, key: "ChannelDown", keyCode: 428 },
  // Fire TV's ⏪ ⏩: live TV has nothing to seek, and keyboard.ts maps neither (an open question
  // whether they should change channel). Taken so they don't reach Android's media session.
  KEYCODE_MEDIA_REWIND: { code: 89, key: "MediaRewind", keyCode: 227 },
  KEYCODE_MEDIA_FAST_FORWARD: { code: 90, key: "MediaFastForward", keyCode: 228 },
  ...digits("KEYCODE_", 7, 48),
  ...digits("KEYCODE_NUMPAD_", 144, 96),
  KEYCODE_PERIOD: { code: 56, key: ".", keyCode: 190 },
  KEYCODE_NUMPAD_DOT: { code: 158, key: ".", keyCode: 110 },
  // US remotes' dash, for sub-channels ("12-1" is 12.1).
  KEYCODE_MINUS: { code: 69, key: ".", keyCode: 189 }
};

/** Keys down now: when each went down, and whether Android has reported it as a long press. */
const presses = new Map<number, { at: number; longPress: boolean }>();

const byCode = new Map(Object.values(ANDROID_KEYS).map((k) => [k.code, k]));

/** The page's key for an Android key code, or null for a key MainActivity doesn't forward. */
export function domKeyFor(code: number): { key: string; keyCode: number } | null {
  const k = byCode.get(code);
  return k ? { key: k.key, keyCode: k.keyCode } : null;
}

/**
 * Puts a native key into the page as a keydown or keyup on whatever has focus (bubbling to the
 * window, where the keyboard adapter listens). A canceled release lets go without acting, as
 * focus leaving the page does. Returns false for a key it doesn't know.
 */
export function deliverKey(k: NativeKey, doc: Document = document, now: () => number = () => Date.now()): boolean {
  const dom = domKeyFor(k.code);
  const win = doc.defaultView;
  if (!dom || !win) return false;
  // Android's long press: its first repeat comes at the system's long-press time (400 ms on
  // Android TV), and a remote let go soon after can release before the page's HOLD_MS. A release
  // after that repeat waits until HOLD_MS has passed, so the hold still counts as a hold.
  if (k.type === "down" && !k.repeat) presses.set(k.code, { at: now(), longPress: false });
  if (k.type === "down" && k.repeat) {
    const p = presses.get(k.code);
    if (p) p.longPress = true;
  }
  if (k.type === "up") {
    const p = presses.get(k.code);
    presses.delete(k.code);
    const wait = p?.longPress && !k.canceled ? HOLD_MS + 20 - (now() - p.at) : 0;
    if (wait > 0) {
      win.setTimeout(() => deliverKey({ ...k }, doc, now), wait);
      return true;
    }
  }
  if (k.type === "up" && k.canceled) {
    win.dispatchEvent(new win.Event("blur"));
    return true;
  }
  const e = new win.KeyboardEvent(k.type === "down" ? "keydown" : "keyup", {
    key: dom.key,
    keyCode: dom.keyCode,
    which: dom.keyCode,
    repeat: k.type === "down" && !!k.repeat,
    bubbles: true,
    cancelable: true
  });
  // Older WebViews ignore keyCode in the init; keyboard.ts reads it for the TV keys.
  if (e.keyCode !== dom.keyCode) Object.defineProperty(e, "keyCode", { value: dom.keyCode });
  (doc.activeElement ?? doc.body).dispatchEvent(e);
  return true;
}
