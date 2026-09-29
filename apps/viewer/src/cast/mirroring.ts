// The mirroring seam (tv-update 02): on an iPhone, Phase 8's Swift plugin notices Screen Mirroring,
// draws TV mode on the external display (apps/tv with ?mirror, the bridge input) and passes the
// phone remote's commands to it. The app can't start mirroring itself, can't list AirPlay TVs
// (only ones remembered from earlier sessions, raise 6) and stops drawing when the phone locks.
// dev:mock stands in with mockMirroring.ts; on the web without the plugin there's no mirroring.

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

/** The plugin's events and calls, as Phase 8 will register them (Capacitor). */
interface NativePlugin {
  addListener(event: "displayConnected" | "displayDisconnected" | "battery" | "state", cb: (data: Record<string, unknown>) => void): unknown;
  knownTvs(): Promise<{ names: string[] }>;
  send(o: { command: RemoteCommand }): Promise<void>;
  keepAwake(o: { on: boolean }): Promise<void>;
  stop(): Promise<void>;
}
declare global {
  interface Window {
    Capacitor?: { Plugins?: { OpencastMirroring?: NativePlugin } };
  }
}

function nativeMirroring(plugin: NativePlugin): MirroringSeam {
  let status: MirrorStatus = { connected: false, tvName: null, lockedAt: null };
  let known: string[] = [];
  let readings: BatteryReading[] = [];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  void plugin.knownTvs().then((r) => ((known = r.names), emit()), () => {});
  plugin.addListener("displayConnected", (d) => {
    readings = [];
    status = { connected: true, tvName: typeof d.tvName === "string" ? d.tvName : status.tvName, lockedAt: null };
    if (status.tvName && !known.includes(status.tvName)) known = [...known, status.tvName];
    emit();
  });
  plugin.addListener("displayDisconnected", (d) => {
    status = { connected: false, tvName: status.tvName, lockedAt: d.reason === "locked" ? Number(d.at) || Date.now() : null };
    emit();
  });
  // TV mode's {type:"state"} from the external display's web view, passed back by the plugin.
  plugin.addListener("state", (d) => {
    status = { ...status, receiver: parseState(d) };
    emit();
  });
  plugin.addListener("battery", (d) => {
    readings = [...readings, { level: Number(d.level), charging: d.charging === true, at: Date.now() }].slice(-120);
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
    expect: () => {},
    send: (command) => void plugin.send({ command }),
    battery: () => readings,
    keepAwake: (on) => void plugin.keepAwake({ on }),
    stop() {
      void plugin.stop();
      status = { connected: false, tvName: status.tvName, lockedAt: null };
      emit();
    }
  };
}

let seam: Promise<MirroringSeam | null> | null = null;

/** The mirroring seam: the plugin in the iPhone app, dev:mock's stand-in, or none. */
export function getMirroring(): Promise<MirroringSeam | null> {
  seam ??= (async () => {
    // Written out in full so a production build drops the mock (and its chunk).
    if (import.meta.env.VITE_MOCK === "true") return (await import("./mockMirroring")).mockMirroring();
    const plugin = typeof window !== "undefined" ? window.Capacitor?.Plugins?.OpencastMirroring : undefined;
    return plugin ? nativeMirroring(plugin) : null;
  })();
  return seam;
}

/** Whether this build can mirror, without loading anything. */
export function mirroringOffered(): boolean {
  if (import.meta.env.VITE_MOCK === "true") return true;
  return typeof window !== "undefined" && !!window.Capacitor?.Plugins?.OpencastMirroring;
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
