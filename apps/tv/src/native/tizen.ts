// The Samsung TV app: TV mode packaged as a Tizen web app (`npm run build:tizen`, tizen/config.xml).
// Tizen gives a packaged app only the arrows, OK (Enter) and Back by itself; every other key on the
// remote has to be registered (tizen.tvinputdevice), and a page in Samsung's browser can't do that.
// Registered keys arrive as KeyboardEvents with Samsung's key codes (ChannelUp 427, Back 10009…)
// and `key` names of their own ("XF86RaiseChannel"); they're renamed here, before anything else
// sees them, to the keys packages/player's keyboard adapter already maps, as native/keys.ts does
// for Android's. So the remote's keys mean the same on Samsung, Android TV and a computer.
//
// Not registered: Exit (Samsung's rule: it leaves the app at once, the TV's own handling), Menu,
// Home, Source, volume and mute (the TV's), and the colour keys (TV mode has no use for them).
//
// Back at the root (the picture, with no last channel): the app exits, as in the Android app.
// Samsung's FAQ lets Return at an app's first screen exit or hide it.

import type { AndroidTvProps, AppStateSource } from "./AndroidTv";

interface TizenKey {
  name: string;
  code: number;
}

/** What TV mode uses of `window.tizen` (the platform's Web Device API, in packaged apps only). */
export interface TizenApi {
  tvinputdevice?: {
    getSupportedKeys(): TizenKey[];
    registerKey(name: string): void;
    unregisterKey(name: string): void;
  };
  application?: { getCurrentApplication(): { exit(): void } };
}

/** Samsung's product API (webapis.js, loaded by index.html in the Tizen build). */
interface WebApis {
  appcommon?: { setScreenSaver(state: number): void; AppCommonScreenSaverState?: { SCREEN_SAVER_OFF: number; SCREEN_SAVER_ON: number } };
}

export type TizenWindow = Pick<Window, "addEventListener" | "removeEventListener"> & { tizen?: TizenApi; webapis?: WebApis };

interface Key {
  /** Samsung's documented key code, for a TV that can't list its keys. */
  code: number;
  /** The KeyboardEvent key the page sees: a name keyboard.ts maps. */
  key: string;
  /** Its legacy keyCode, as in native/keys.ts. */
  keyCode: number;
}

const digits = Object.fromEntries(Array.from({ length: 10 }, (_, d) => [String(d), { code: 48 + d, key: String(d), keyCode: 48 + d }]));

/**
 * The keys registered, by Tizen's name (tvinputdevice.getSupportedKeys), and the key each becomes:
 * the same as Android TV's (native/keys.ts) where Android has the key.
 */
export const TIZEN_KEYS: Record<string, Key> = {
  ChannelUp: { code: 427, key: "ChannelUp", keyCode: 427 },
  ChannelDown: { code: 428, key: "ChannelDown", keyCode: 428 },
  ...digits,
  // The remote's "-", for sub-channels ("18-2" is 18.2).
  Minus: { code: 189, key: ".", keyCode: 189 },
  Info: { code: 457, key: "Info", keyCode: 457 },
  Guide: { code: 458, key: "Guide", keyCode: 458 },
  // Samsung's channel list: TV mode's is the guide.
  ChannelList: { code: 10073, key: "Guide", keyCode: 458 },
  // PRE-CH: the last channel.
  PreviousChannel: { code: 10190, key: "MediaLast", keyCode: 0 },
  // Older remotes' TOOLS: the menu, as Fire TV's ≡ key.
  Tools: { code: 10135, key: "ContextMenu", keyCode: 93 },
  MediaPlayPause: { code: 10252, key: "MediaPlayPause", keyCode: 179 },
  MediaPlay: { code: 415, key: "MediaPlay", keyCode: 250 },
  MediaPause: { code: 19, key: "MediaPause", keyCode: 19 },
  // Stop on live TV is pause (nothing to stop to).
  MediaStop: { code: 413, key: "MediaPause", keyCode: 19 },
  // As on Fire TV: ⏩ back to live on the picture, ⏪ nothing yet; next and previous change channel.
  MediaRewind: { code: 412, key: "MediaRewind", keyCode: 227 },
  MediaFastForward: { code: 417, key: "MediaFastForward", keyCode: 228 },
  MediaTrackNext: { code: 10233, key: "ChannelUp", keyCode: 427 },
  MediaTrackPrevious: { code: 10232, key: "ChannelDown", keyCode: 428 }
};

/** Back (Return): delivered without registering. keyboard.ts knows 10009; named here as well. */
const BACK: Key = { code: 10009, key: "GoBack", keyCode: 461 };

/** TV mode in the Samsung TV app (never in Samsung's browser, which has no `tizen`). */
export function isTizenApp(w: TizenWindow | undefined = typeof window === "undefined" ? undefined : (window as TizenWindow)): boolean {
  return !!w?.tizen?.tvinputdevice;
}

/**
 * Registers the remote's keys and renames them as they arrive. Key codes come from the TV
 * (getSupportedKeys), as Samsung advises; the documented ones stand in when it can't say. Returns
 * a function that stops; nothing happens off Tizen.
 */
export function startTizenKeys(w: TizenWindow = window as TizenWindow): () => void {
  const input = w.tizen?.tvinputdevice;
  if (!input) return () => undefined;
  let supported: TizenKey[] | null = null;
  try {
    supported = input.getSupportedKeys();
  } catch {
    supported = null;
  }
  const codeOf = new Map((supported ?? []).map((k) => [k.name, k.code]));
  const byCode = new Map<number, Key>([[BACK.code, BACK]]);
  const registered: string[] = [];
  for (const [name, k] of Object.entries(TIZEN_KEYS)) {
    if (supported && !codeOf.has(name)) continue;
    try {
      input.registerKey(name);
      registered.push(name);
      byCode.set(codeOf.get(name) ?? k.code, k);
    } catch {
      /* this TV doesn't have it */
    }
  }
  const rename = (e: Event) => {
    const k = e as KeyboardEvent;
    const to = byCode.get(k.keyCode);
    if (!to || k.key === to.key) return;
    Object.defineProperty(k, "key", { value: to.key });
    Object.defineProperty(k, "keyCode", { value: to.keyCode });
  };
  // Capture on the window: before the keyboard adapter (and anything else) reads the event.
  w.addEventListener("keydown", rename, true);
  w.addEventListener("keyup", rename, true);
  return () => {
    w.removeEventListener("keydown", rename, true);
    w.removeEventListener("keyup", rename, true);
    for (const name of registered) {
      try {
        input.unregisterKey(name);
      } catch {
        /* gone already */
      }
    }
  };
}

/** Leaves the app (back to the TV's home). */
export function exitTizenApp(w: TizenWindow = window as TizenWindow) {
  try {
    w.tizen?.application?.getCurrentApplication().exit();
  } catch {
    /* not a packaged app */
  }
}

/**
 * The Android app's rules (AndroidTv.tsx) on Samsung: the screen saver stays off while the
 * picture plays, the sleep timer's end leaves the app, and leaving it (Home, another app) pauses.
 */
export function tizenTv(w: TizenWindow = window as TizenWindow): Required<AndroidTvProps> {
  const doc = typeof document === "undefined" ? null : document;
  const appStates: AppStateSource = (fn) => {
    if (!doc) return () => undefined;
    const on = () => fn(doc.visibilityState !== "hidden");
    doc.addEventListener("visibilitychange", on);
    return () => doc.removeEventListener("visibilitychange", on);
  };
  return {
    tv: {
      setKeepScreenOn: async ({ on }) => {
        const common = w.webapis?.appcommon;
        if (!common) return;
        const states = common.AppCommonScreenSaverState ?? { SCREEN_SAVER_OFF: 0, SCREEN_SAVER_ON: 1 };
        common.setScreenSaver(on ? states.SCREEN_SAVER_OFF : states.SCREEN_SAVER_ON);
      },
      exitToHome: async () => exitTizenApp(w)
    },
    appStates
  };
}
