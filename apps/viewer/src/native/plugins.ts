// The app's own native plugins (Phase 8), as the web side sees them. Their code lives in the native
// projects, registered by the app itself rather than published as packages:
//   OpencastCast        Google Cast sender: iOS ios/App/App/OpencastCastPlugin.swift,
//                       Android android/app/src/main/java/org/useopencast/viewer/OpencastCastPlugin.kt
//   OpencastMirror      the iPhone's external display (Screen Mirroring): ios/App/App/OpencastMirrorPlugin.swift
//   OpencastNowPlaying  lock-screen controls: iOS OpencastNowPlayingPlugin.swift (MPRemoteCommandCenter),
//                       Android OpencastNowPlayingPlugin.kt (a MediaSession and its notification)
// On the web registerPlugin returns a stand-in whose calls reject, so every use checks hasPlugin first.

import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

// ---------- OpencastCast ----------

/** A Chromecast (or Google TV) the Cast SDK found on the network, with Opencast's receiver available. */
export interface NativeCastDevice {
  id: string;
  /** "Living room TV". */
  name: string;
}

export interface OpencastCastPlugin {
  /** Sets up the Cast SDK with the receiver application (VITE_CAST_APP_ID). Safe to call again. */
  setUp(o: { appId: string }): Promise<{ available: boolean }>;
  /** Starts looking for TVs (the first time, iOS asks for local network access), and says what's found now. */
  startDiscovery(): Promise<{ devices: NativeCastDevice[] }>;
  stopDiscovery(): Promise<void>;
  /** Starts a session with Opencast's receiver on that TV. Resolves once it's running, with the TV as the SDK names it. */
  startSession(o: { deviceId: string }): Promise<{ device: NativeCastDevice }>;
  /** A message on Opencast's namespace, as JSON text. */
  sendMessage(o: { namespace: string; message: string }): Promise<void>;
  /** Ends this phone's session; `stopCasting` stops the receiver on the TV too. */
  endSession(o: { stopCasting: boolean }): Promise<void>;
  addListener(event: "devicesChanged", cb: (d: { devices: NativeCastDevice[] }) => void): Promise<PluginListenerHandle>;
  addListener(event: "message", cb: (d: { namespace: string; message: string }) => void): Promise<PluginListenerHandle>;
  /** The session ended from the other side (the TV stopped, the network went), or failed after starting. */
  addListener(event: "sessionEnded", cb: (d: { error?: string }) => void): Promise<PluginListenerHandle>;
}

// ---------- OpencastMirror (iOS only) ----------

/** What the external display's web view loads TV mode with (`?mirror&device=&market=&station=`). */
export interface MirrorConfig {
  /** "Kai's iPhone", or null signed out (TV mode says "Mirrored from an iPhone"). */
  device: string | null;
  marketSlug: string | null;
  stationId: string | null;
  /** TV mode's page. Null: the copy bundled in the app (dist/tv, `build:native`). */
  tvUrl: string | null;
}

export type MirrorEvent = "displayConnected" | "displayDisconnected" | "battery" | "state";

export interface OpencastMirrorPlugin {
  /** What the next external display loads. Sent whenever it changes; a connected display keeps what it loaded with. */
  configure(o: MirrorConfig): Promise<void>;
  /** AirPlay TVs this phone has mirrored to before (their route names). */
  knownTvs(): Promise<{ names: string[] }>;
  /** A phone remote command, posted to TV mode on the external display (the bridge input). */
  send(o: { command: unknown }): Promise<void>;
  /** Stops drawing TV mode on the TV; the TV goes back to showing the phone's screen. */
  stop(): Promise<void>;
  /** displayConnected {tvName}; displayDisconnected {reason: "locked" | "ended", at}; battery {level, charging}; state {type:"state", ...}. */
  addListener(event: MirrorEvent, cb: (data: Record<string, unknown>) => void): Promise<PluginListenerHandle>;
}

// ---------- OpencastNowPlaying ----------

/** A lock-screen or headset button, as the native side reports it. */
export type LockScreenAction = "next" | "previous" | "play" | "pause" | "toggle";

export interface NowPlayingInfo {
  /** "BEAT 12.1". */
  title: string;
  /** What's on: "Saturday Reel". */
  subtitle: string | null;
  playing: boolean;
}

export interface OpencastNowPlayingPlugin {
  /** Shows the controls (channel up and down as next and previous, pause and play) with what's on. */
  update(o: NowPlayingInfo): Promise<void>;
  /** Takes the controls away (nothing is on). */
  clear(): Promise<void>;
  addListener(event: "action", cb: (d: { action: LockScreenAction }) => void): Promise<PluginListenerHandle>;
}

export const OpencastCast = registerPlugin<OpencastCastPlugin>("OpencastCast");
export const OpencastMirror = registerPlugin<OpencastMirrorPlugin>("OpencastMirror");
export const OpencastNowPlaying = registerPlugin<OpencastNowPlayingPlugin>("OpencastNowPlaying");
