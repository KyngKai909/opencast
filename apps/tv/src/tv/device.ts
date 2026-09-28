// What this TV remembers, on the device: its sign-in (a TV session from the code sign-in), the
// last channel ("Start on: last channel"), whether first launch has been seen, presets and
// settings while signed out, and the TV-only settings (banner seconds, number wait…).
// A Cast receiver has no reliable storage: the same store runs in memory there.

import { useSyncExternalStore } from "react";

export interface TvSettings {
  captions: "off" | "on" | "muted_only";
  captionSize: "small" | "medium" | "large";
  /** Remote and phones: channel up goes up the dial, or down. */
  channelUp: "up_the_dial" | "down_the_dial";
  bannerSeconds: 3 | 5 | 8;
  /** After typing a number, tune in (seconds). */
  numberWaitSeconds: 1 | 1.5 | 2 | 3;
  includeRadioBand: boolean;
  startOn: "last_channel" | "dial";
  /** Picture and sound. */
  quality: "auto" | "data_saver" | "best";
  eveningOut: boolean;
}

export interface TvDevice {
  /** The TV session's token, once a phone approved the code (proposed B2). */
  token: string | null;
  /** Who's signed in, for "Signed in as Kai M." before the API answers. */
  signedInAs: string | null;
  welcomed: boolean;
  lastStationId: string | null;
  marketSlug: string | null;
  /** Presets while signed out: key → station id. */
  presets: Record<number, string>;
  settings: TvSettings;
}

export const DEFAULT_SETTINGS: TvSettings = {
  captions: "on",
  captionSize: "medium",
  channelUp: "up_the_dial",
  bannerSeconds: 5,
  numberWaitSeconds: 2,
  includeRadioBand: false,
  startOn: "last_channel",
  quality: "auto",
  eveningOut: true
};

const EMPTY: TvDevice = { token: null, signedInAs: null, welcomed: false, lastStationId: null, marketSlug: null, presets: {}, settings: DEFAULT_SETTINGS };
const KEY = "oc-tv-device";

let persist = true;
let state: TvDevice = read();
const listeners = new Set<() => void>();

function read(): TvDevice {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<TvDevice>) : {};
    return { ...EMPTY, ...v, settings: { ...DEFAULT_SETTINGS, ...(v.settings ?? {}) } };
  } catch {
    return EMPTY;
  }
}

/** The Cast receiver keeps nothing between sessions: call once at start. */
export function useMemoryOnly() {
  persist = false;
  state = { ...EMPTY, welcomed: true };
}

export function getDevice(): TvDevice {
  return state;
}

export function setDevice(patch: Partial<TvDevice> | ((d: TvDevice) => Partial<TvDevice>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p, settings: { ...state.settings, ...(p.settings ?? {}) } };
  if (persist) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage off */
    }
  }
  listeners.forEach((l) => l());
}

export function useDevice(): TvDevice {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => state
  );
}
