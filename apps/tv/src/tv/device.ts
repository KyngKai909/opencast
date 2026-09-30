// What this TV remembers, on the device: who it is (registerTv's tvId and device token), its
// sign-in (a TV session from the code sign-in), the
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
  /** "Tuning sound": a soft hiss when changing channel, on video (the account's `watching.tuningSound`). Off by default. */
  tuningSound: boolean;
  /** The radio band's own tuning sound (the account's `watching.radioTuningSound`), turned off on the radio band. On by default. */
  radioTuningSound: boolean;
  /** After typing a number, tune in (seconds). */
  numberWaitSeconds: 1 | 1.5 | 2 | 3;
  includeRadioBand: boolean;
  startOn: "last_channel" | "dial";
  /** Picture and sound. */
  quality: "auto" | "data_saver" | "best";
  eveningOut: boolean;
  /** Remote and phones: while a phone plays to this TV, any phone on the Wi-Fi can change the channel. */
  othersOnWifiCanChange: boolean;
}

export interface TvDevice {
  /** This TV, from registerTv on first launch (B2). Never set on a Cast receiver or an iPhone's second screen. */
  tvId: string | null;
  /** The TV's own token (`device` endpoints), shown once by registerTv. */
  deviceToken: string | null;
  /** The TV session's token, once a phone approved the code (B2): `tvSession` endpoints, and `device` ones too. */
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
  tuningSound: false,
  radioTuningSound: true,
  numberWaitSeconds: 2,
  includeRadioBand: false,
  startOn: "last_channel",
  quality: "auto",
  eveningOut: true,
  othersOnWifiCanChange: true
};

const EMPTY: TvDevice = { tvId: null, deviceToken: null, token: null, signedInAs: null, welcomed: false, lastStationId: null, marketSlug: null, presets: {}, settings: DEFAULT_SETTINGS };
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

/** Whether this is a receiver or a second screen (nothing kept, never registered). */
export function isMemoryOnly(): boolean {
  return !persist;
}

export function getDevice(): TvDevice {
  return state;
}

/** A change to the device: settings merge into the current ones. */
export type DevicePatch = Omit<Partial<TvDevice>, "settings"> & { settings?: Partial<TvSettings> };

export function setDevice(patch: DevicePatch | ((d: TvDevice) => DevicePatch)) {
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
