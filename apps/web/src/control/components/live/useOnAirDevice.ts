// While a block is on air from this device: keep the screen awake, watch the connection, and warn
// at 20% battery with the minutes left at the current rate (live-listings 05). The Battery Status
// API exists only in Chromium browsers; elsewhere there's no warning (inventory worth raising 14).

import { useEffect, useState } from "react";

interface BatteryLike extends EventTarget {
  level: number;
  charging: boolean;
  dischargingTime: number;
}

export interface OnAirDevice {
  online: boolean;
  /** Set when the battery is at 20% or less and not charging. */
  battery: { level: number; minutesLeft: number | null } | null;
}

export const BATTERY_WARNING = 0.2;

export function batteryWarning(b: { level: number; charging: boolean; dischargingTime: number } | null): OnAirDevice["battery"] {
  if (!b || b.charging || b.level > BATTERY_WARNING) return null;
  return { level: b.level, minutesLeft: Number.isFinite(b.dischargingTime) && b.dischargingTime > 0 ? Math.floor(b.dischargingTime / 60) : null };
}

export function useOnAirDevice(onAir: boolean): OnAirDevice {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const [battery, setBattery] = useState<OnAirDevice["battery"]>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // The screen stays awake on air (Wake Lock; iOS 16.4 and later).
  useEffect(() => {
    if (!onAir) return;
    const wl = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (!wl) return;
    let lock: { release(): Promise<void> } | null = null;
    let gone = false;
    const take = () => {
      if (document.visibilityState !== "visible") return;
      wl.request("screen")
        .then((l) => {
          if (gone) void l.release();
          else lock = l;
        })
        .catch(() => {});
    };
    take();
    document.addEventListener("visibilitychange", take);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", take);
      void lock?.release().catch(() => {});
    };
  }, [onAir]);

  useEffect(() => {
    if (!onAir) {
      setBattery(null);
      return;
    }
    const get = (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }).getBattery;
    if (!get) return;
    let b: BatteryLike | null = null;
    const read = () => setBattery(batteryWarning(b));
    get.call(navigator)
      .then((x) => {
        b = x;
        read();
        for (const ev of ["levelchange", "chargingchange", "dischargingtimechange"]) x.addEventListener(ev, read);
      })
      .catch(() => {});
    return () => {
      if (b) for (const ev of ["levelchange", "chargingchange", "dischargingtimechange"]) b.removeEventListener(ev, read);
    };
  }, [onAir]);

  return { online, battery };
}
