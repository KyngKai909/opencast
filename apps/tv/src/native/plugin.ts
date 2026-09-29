// The Android TV and Fire TV app's native side (android/…/OpencastTvPlugin.java), and whether
// TV mode is running in it. Everywhere else (a browser, the Cast receiver, an iPhone's second
// screen) none of this is called.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { NativeKey } from "./keys";
import type { NativeTvInfo } from "./platform";

export interface OpencastTvPlugin {
  getInfo(): Promise<NativeTvInfo>;
  /** FLAG_KEEP_SCREEN_ON while the picture plays. */
  setKeepScreenOn(o: { on: boolean }): Promise<void>;
  /** Back to the TV's home screen (the activity finishes). */
  exitToHome(): Promise<void>;
  addListener(event: "key", fn: (k: NativeKey) => void): Promise<PluginListenerHandle>;
}

export const OpencastTv = registerPlugin<OpencastTvPlugin>("OpencastTv");

/** TV mode inside the Android TV and Fire TV app. */
export function isAndroidApp(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

let info: NativeTvInfo | null = null;

/** Asks the app what kind of TV this is, once at start (null outside the app, or if it can't say). */
export async function loadNativeInfo(tv: Pick<OpencastTvPlugin, "getInfo"> = OpencastTv, native = isAndroidApp()): Promise<NativeTvInfo | null> {
  if (!native) return null;
  try {
    info = await tv.getInfo();
  } catch {
    info = null;
  }
  return info;
}

/** What loadNativeInfo found: null in a browser. */
export function nativeInfo(): NativeTvInfo | null {
  return info;
}
