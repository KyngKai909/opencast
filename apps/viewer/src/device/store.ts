// What's kept on this device: the market (the only thing first visit asks), and presets and
// reminders made before signing in (offered to the account afterwards). Settings live here while
// signed out. Each read and write survives a blocked localStorage.

import { useSyncExternalStore } from "react";
import type { ViewerSettings } from "@opencast/contracts";

export interface DeviceReminder {
  logEntryId?: string;
  listedAiringId?: string;
  switchMeOver: boolean;
  /** Enough to show it before the account has it. */
  title: string;
  startsAt: string;
  stationId: string;
}

export interface DeviceState {
  marketSlug: string | null;
  presets: Array<{ stationId: string; key: number | null }>;
  reminders: DeviceReminder[];
  settings: ViewerSettings;
  lastStationId: string | null;
}

const KEY = "oc-device";
const EMPTY: DeviceState = { marketSlug: null, presets: [], reminders: [], settings: {}, lastStationId: null };

function read(): DeviceState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as DeviceState) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

let state = read();
const listeners = new Set<() => void>();

export function getDevice(): DeviceState {
  return state;
}

export function setDevice(patch: Partial<DeviceState> | ((s: DeviceState) => Partial<DeviceState>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private windows: kept for this visit.
  }
  listeners.forEach((l) => l());
}

export function useDevice(): DeviceState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state
  );
}
