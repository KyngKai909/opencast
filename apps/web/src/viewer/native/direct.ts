// A239, direct mode (the user's decision): in the Opencast app on Android, external stations'
// stream links are fetched with the phone's own networking, as VLC would (no Origin, cookies or
// Referer; http allowed; the viewer's own connection). The app says it can by registering the
// OpencastDirect plugin (packages/player/native/android, MainActivity), whose `info()` gives the path
// on the app's own origin that its web view client answers. The player tries a row's
// `playback.sourceUrl` there first and falls back to `playback.url` (packages/player, direct.ts).
// On the web and on the iPhone (no plugin yet: docs/open-decisions.md A239) nothing changes.

import { registerPlugin } from "@capacitor/core";
import { interceptTransport, type DirectTransport } from "@opencast/player";
import { hasPlugin, nativePlatform } from "./platform";

/** OpencastDirectPlugin.java. */
export interface OpencastDirectPlugin {
  info(): Promise<{ version: number; path: string; userAgent: string }>;
}

/** The version of the path and headers this page speaks (OpencastDirectPlugin.VERSION). */
const VERSION = 1;

export interface DirectEnv {
  android: boolean;
  available: boolean;
  plugin: Pick<OpencastDirectPlugin, "info">;
  fetch?: typeof fetch;
}

/** Direct mode's transport, when the app says it has it; null anywhere else (direct mode off). */
export function nativeDirect(env?: DirectEnv): DirectTransport | null {
  const e = env ?? { android: nativePlatform() === "android", available: hasPlugin("OpencastDirect"), plugin: registerPlugin<OpencastDirectPlugin>("OpencastDirect") };
  if (!e.android || !e.available) return null;
  // Asked once, on the first direct load. A plugin that can't answer turns direct mode off (the
  // player then falls back to each row's playback.url, as on the web).
  let path: Promise<string | null> | null = null;
  const base = () =>
    (path ??= e.plugin.info().then(
      (i) => (i?.version === VERSION && typeof i.path === "string" && i.path.startsWith("/") ? i.path : null),
      () => null
    ));
  return interceptTransport(base, e.fetch);
}
