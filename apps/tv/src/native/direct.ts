// A239, direct mode (the user's decision): in the Android TV and Fire TV app, external stations'
// stream links are fetched with the TV's own networking, as VLC would (no Origin, cookies or
// Referer; http allowed; the viewer's own connection). The app says it can by registering the
// OpencastDirect plugin (packages/player/native/android, MainActivity), whose `info()` gives the path
// on the app's own origin that its web view client answers. The player tries a row's
// `playback.sourceUrl` there first and falls back to `playback.url` (packages/player, direct.ts).
// In a TV browser, on Cast and on the iPhone's external display there's no plugin: nothing changes.

import { Capacitor, registerPlugin } from "@capacitor/core";
import { interceptTransport, type DirectTransport } from "@opencast/player";
import { isAndroidApp } from "./plugin";

/** OpencastDirectPlugin.java. */
export interface OpencastDirectPlugin {
  info(): Promise<{ version: number; path: string; userAgent: string }>;
}

export const OpencastDirect = registerPlugin<OpencastDirectPlugin>("OpencastDirect");

/** The version of the path and headers this page speaks (OpencastDirectPlugin.VERSION). */
const VERSION = 1;

export interface DirectEnv {
  native: boolean;
  available: () => boolean;
  plugin: Pick<OpencastDirectPlugin, "info">;
  fetch?: typeof fetch;
}

/** Direct mode's transport, when the app says it has it; null anywhere else (direct mode off). */
export function nativeDirect(env: DirectEnv = { native: isAndroidApp(), available: () => Capacitor.isPluginAvailable("OpencastDirect"), plugin: OpencastDirect }): DirectTransport | null {
  if (!env.native || !env.available()) return null;
  // Asked once, on the first direct load. A plugin that can't answer turns direct mode off (the
  // player then falls back to each row's playback.url, as in a browser).
  let path: Promise<string | null> | null = null;
  const base = () =>
    (path ??= env.plugin.info().then(
      (i) => (i?.version === VERSION && typeof i.path === "string" && i.path.startsWith("/") ? i.path : null),
      () => null
    ));
  return interceptTransport(base, env.fetch);
}
