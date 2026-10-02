// What kind of TV the Android app runs on, from what OpencastTvPlugin.getInfo reports: the
// platform registerTv records, and "This TV" in About this TV. In a browser TV mode guesses from
// the user agent instead (components/settings/about.ts).

import type { TvPlatform } from "@opencast/contracts";

/** OpencastTvPlugin.getInfo. */
export interface NativeTvInfo {
  /** Build.MANUFACTURER ("Amazon", "Google", "Sony"). */
  manufacturer: string;
  /** Build.MODEL (Fire TV models start "AFT"). */
  model: string;
  /** The system feature amazon.hardware.fire_tv. */
  fireTv: boolean;
  /** Google TV's home screen (com.google.android.apps.tv.launcherx) is installed. */
  googleTv: boolean;
  /** The system feature android.software.leanback (every TV the app installs on has it). */
  leanback: boolean;
}

export type NativePlatform = Extract<TvPlatform, "fire_tv" | "google_tv" | "android_tv">;

/** Fire TV by Amazon's feature (or maker and model), Google TV by its home screen, else Android TV. */
export function platformFromNative(i: NativeTvInfo): NativePlatform {
  if (i.fireTv || /^amazon$/i.test(i.manufacturer.trim()) || /^AFT/.test(i.model)) return "fire_tv";
  if (i.googleTv) return "google_tv";
  return "android_tv";
}

/** "Fire TV", "Google TV" or "Android TV", as About this TV words it. */
export function nativeKind(i: NativeTvInfo): string {
  return { fire_tv: "Fire TV", google_tv: "Google TV", android_tv: "Android TV" }[platformFromNative(i)];
}
