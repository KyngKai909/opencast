// The mirroring seam (tv-update 02): in the iPhone app, the OpencastMirror plugin
// (ios/App/App/OpencastMirrorPlugin.swift) notices Screen Mirroring, draws TV mode on the external
// display (apps/tv with ?mirror, the bridge input) and passes the phone remote's commands to it.
// The app can't start mirroring itself, can't list AirPlay TVs (only ones remembered from earlier
// sessions, raise 6) and stops drawing when the phone locks.
// dev:mock stands in with mockMirroring.ts; on the web without the plugin there's no mirroring.

import { hasPlugin } from "../native/platform";
import type { MirrorConfig, MirrorEvent, OpencastMirrorPlugin } from "../native/plugins";
import { parseState } from "./messages";
import type { ReceiverState, RemoteCommand } from "./types";

export interface MirrorStatus {
  /** The external display is showing TV mode. */
  connected: boolean;
  /** The AirPlay route's name ("Bedroom TV"). */
  tvName: string | null;
  /** When the phone locked and the picture stopped (ms since the epoch), until mirroring starts again. */
  lockedAt: number | null;
  /** TV mode's state on the external display, relayed by the plugin (dev:mock's comes from the stand-in). */
  receiver?: ReceiverState | null;
}

export interface BatteryReading {
  /** 0 to 1. iOS reports 5% steps (raise 16). */
  level: number;
  charging: boolean;
  /** ms since the epoch. */
  at: number;
}

export interface MirroringSeam {
  readonly kind: "native" | "mock";
  /** AirPlay TVs this phone has mirrored to before. */
  knownTvs(): string[];
  status(): MirrorStatus;
  subscribe(listener: () => void): () => void;
  /** The guide is showing for this TV. The plugin watches anyway; dev:mock's stand-in connects a little later. */
  expect(tvName: string): void;
  /** What the next external display loads TV mode with (the plugin only: the phone's name, market and station). */
  configure?(o: MirrorConfig): void;
  /** The phone remote's command, to TV mode on the external display. */
  send(command: RemoteCommand): void;
  /** dev:mock only: there's no external display, so the phone's own player stands in for it and takes the commands. */
  onCommand?(listener: (command: RemoteCommand) => void): () => void;
  /** Battery readings since mirroring started, oldest first. */
  battery(): BatteryReading[];
  /** Keeps the screen from dimming while mirroring. */
  keepAwake(on: boolean): void;
  /** Stops drawing TV mode on the TV (the phone can't end Screen Mirroring itself). */
  stop(): void;
}

/** The plugin's calls and events (native/plugins.ts, ios/App/App/OpencastMirrorPlugin.swift). */
export type NativeMirrorPlugin = Pick<OpencastMirrorPlugin, "addListener" | "configure" | "knownTvs" | "send" | "stop">;

export interface NativeMirrorDeps {
  /** Keeps the screen from dimming (the keep-awake plugin). */
  keepAwake(on: boolean): void;
  now?: () => number;
}

/** The seam over the iPhone app's plugin: its events become the status the remote and CastSync read. */
export function nativeMirroring(plugin: NativeMirrorPlugin, deps: NativeMirrorDeps): MirroringSeam {
  const now = deps.now ?? Date.now;
  let status: MirrorStatus = { connected: false, tvName: null, lockedAt: null };
  let known: string[] = [];
  let readings: BatteryReading[] = [];
  /** The TV the guide is showing for: the name when the plugin can't read the AirPlay route's (the Simulator's external display). */
  let expected: string | null = null;
  let awake = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const remember = (name: string | null) => {
    if (name && !known.includes(name)) known = [...known, name];
  };
  const on = (event: MirrorEvent, cb: (d: Record<string, unknown>) => void) => void plugin.addListener(event, cb).catch(() => {});
  void plugin.knownTvs().then(
    (r) => {
      known = [...new Set([...(r.names ?? []), ...known])];
      emit();
    },
    () => {}
  );
  on("displayConnected", (d) => {
    readings = [];
    const tvName = typeof d.tvName === "string" && d.tvName ? d.tvName : expected ?? status.tvName;
    status = { connected: true, tvName, lockedAt: null };
    remember(tvName);
    emit();
  });
  // "locked": the phone locked and Screen Mirroring stopped ("Mirroring stopped" says when); "ended":
  // Screen Mirroring was turned off with Opencast in front, and the phone just goes back to itself.
  on("displayDisconnected", (d) => {
    const at = Number(d.at);
    status = { connected: false, tvName: status.tvName, lockedAt: d.reason === "locked" ? (Number.isFinite(at) && at > 0 ? at : now()) : null };
    emit();
  });
  // TV mode's {type:"state"} from the external display's web view, passed back by the plugin.
  on("state", (d) => {
    if (!status.connected) return;
    status = { ...status, receiver: parseState(d) };
    emit();
  });
  on("battery", (d) => {
    const level = Number(d.level);
    if (!Number.isFinite(level) || level < 0 || level > 1) return;
    readings = [...readings, { level, charging: d.charging === true, at: now() }].slice(-120);
    emit();
  });
  return {
    kind: "native",
    knownTvs: () => known,
    status: () => status,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    expect(tvName) {
      expected = tvName;
    },
    configure: (o) => void plugin.configure(o).catch(() => {}),
    send: (command) => void plugin.send({ command }).catch(() => {}),
    battery: () => readings,
    keepAwake(on) {
      if (on === awake) return;
      awake = on;
      deps.keepAwake(on);
    },
    stop() {
      void plugin.stop().catch(() => {});
      status = { connected: false, tvName: status.tvName, lockedAt: null };
      emit();
    }
  };
}

function nativeKeepAwake(on: boolean) {
  void import("@capacitor-community/keep-awake")
    .then(({ KeepAwake }) => (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()))
    .catch(() => {});
}

let seam: Promise<MirroringSeam | null> | null = null;

/** The mirroring seam: the plugin in the iPhone app, dev:mock's stand-in, or none. */
export function getMirroring(): Promise<MirroringSeam | null> {
  seam ??= (async () => {
    // Written out in full so a production build drops the mock (and its chunk).
    if (import.meta.env.VITE_MOCK === "true") return (await import("./mockMirroring")).mockMirroring();
    if (!hasPlugin("OpencastMirror")) return null;
    const { OpencastMirror } = await import("../native/plugins");
    return nativeMirroring(OpencastMirror, { keepAwake: nativeKeepAwake });
  })();
  return seam;
}

/** Whether this build can mirror, without loading anything. */
export function mirroringOffered(): boolean {
  if (import.meta.env.VITE_MOCK === "true") return true;
  return hasPlugin("OpencastMirror");
}

/** Tests only. */
export function resetMirroringForTests() {
  seam = null;
}

// ---------- The battery line (02.2) ----------

/** Minutes left at the rate the battery has been falling, or null until there's a rate (5 minutes of falling readings). */
export function minutesLeft(readings: BatteryReading[]): number | null {
  const last = readings[readings.length - 1];
  if (!last || last.charging) return null;
  // Since the last time it was charging, within the last half hour.
  let i = readings.length - 1;
  while (i > 0 && !readings[i - 1].charging && last.at - readings[i - 1].at <= 30 * 60e3) i--;
  const first = readings[i];
  const span = last.at - first.at;
  const drop = first.level - last.level;
  if (span < 5 * 60e3 || drop <= 0) return null;
  return last.level / (drop / span) / 60e3;
}

/** "3 hours", "1 hour", "40 minutes". */
export function aboutTime(minutes: number): string {
  if (minutes < 50) return `${Math.max(5, Math.round(minutes / 5) * 5)} minutes`;
  const hours = Math.max(1, Math.round(minutes / 60));
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/** "Battery: 64%, about 3 hours at this rate." Nothing until there's a rate (raise 16). */
export function batteryLine(readings: BatteryReading[]): string | null {
  const last = readings[readings.length - 1];
  if (!last) return null;
  const pct = Math.round(last.level * 100);
  if (last.charging) return `Battery: ${pct}%, charging.`;
  const m = minutesLeft(readings);
  return m === null ? null : `Battery: ${pct}%, about ${aboutTime(m)} at this rate.`;
}
