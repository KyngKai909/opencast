// Which build this is: the web app (PWA) or the iPhone and Android apps (Capacitor, Phase 8). Asked
// in one place so tests can stand in for either.

import { Capacitor } from "@capacitor/core";

export type NativePlatform = "ios" | "android";

/** The app's native platform, or null on the web. */
export function nativePlatform(): NativePlatform | null {
  if (!Capacitor.isNativePlatform()) return null;
  const p = Capacitor.getPlatform();
  return p === "ios" || p === "android" ? p : null;
}

export function isNative(): boolean {
  return nativePlatform() !== null;
}

/** Whether the app registered this native plugin (the local plugins in ios/ and android/). */
export function hasPlugin(name: string): boolean {
  return isNative() && Capacitor.isPluginAvailable(name);
}
