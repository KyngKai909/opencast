// Lock-screen controls in the iPhone and Android apps (the reference's "On the lock screen": channel
// up, down and pause). The OpencastNowPlaying plugin shows them (iOS: Now Playing and
// MPRemoteCommandCenter; Android: a MediaSession and its notification) and reports each press; this
// turns presses into the player's commands, as mediaSessionInput does for the web's Media Session.
// Next and previous track are channel up and down.
//
// While casting, the phone's player follows the TV (CastSync), so a channel press here tunes the
// phone and CastSync sends the tune to the TV. On Android that works from the notification. On iOS
// it works only while the app is the Now Playing app, which needs sound playing on the phone, and
// the phone is quiet while a TV plays: expect no controls on an iPhone's lock screen while casting
// (inventory raise 15). docs/apps/native.md says the same.

import { mediaSessionInput, type Command, type InputAdapter } from "@opencast/player";
import type { DialRow } from "@opencast/contracts";
import { hasPlugin } from "./platform";
import type { LockScreenAction, NowPlayingInfo, OpencastNowPlayingPlugin } from "./plugins";

/** A lock-screen press as a player command. */
export function lockScreenCommand(action: LockScreenAction): Command | null {
  switch (action) {
    case "next":
      return { type: "channel", dir: "up" };
    case "previous":
      return { type: "channel", dir: "down" };
    case "pause":
      return { type: "pause" };
    case "play":
      return { type: "play" };
    case "toggle":
      return { type: "togglePlay" };
    default:
      return null;
  }
}

type Load = () => Promise<Pick<OpencastNowPlayingPlugin, "addListener">>;

const loadPlugin: Load = () => import("./plugins").then((m) => m.OpencastNowPlaying);

/** The plugin's presses as an input, beside the player's others. */
export function nativeLockScreenInput(load: Load = loadPlugin): InputAdapter {
  return {
    name: "lock-screen",
    start(dispatch) {
      let stopped = false;
      let remove: (() => void) | null = null;
      void load()
        .then((plugin) =>
          plugin.addListener("action", (d) => {
            const command = lockScreenCommand(d.action);
            if (command && !stopped) dispatch(command, { input: "media-session" });
          })
        )
        .then((handle) => {
          remove = () => void handle.remove();
          if (stopped) remove();
        })
        .catch(() => {});
      return () => {
        stopped = true;
        remove?.();
      };
    }
  };
}

/** The apps use their plugin (the web view's own Media Session would answer the same buttons twice); the web, Media Session. */
export function lockScreenInput(): InputAdapter {
  return hasPlugin("OpencastNowPlaying") ? nativeLockScreenInput() : mediaSessionInput();
}

/** What the lock screen shows: "BEAT 12.1", what's on, and whether it's playing. Null: nothing tuned. */
export function nowPlayingInfo(row: DialRow | null, playing: boolean): NowPlayingInfo | null {
  if (!row) return null;
  const s = row.station;
  const title = [s.callSign ?? s.name, s.channel].filter(Boolean).join(" ");
  const subtitle = row.now && row.now.kind !== "off_air" ? row.now.title : row.onAir ? null : "Off air";
  return { title, subtitle, playing };
}
