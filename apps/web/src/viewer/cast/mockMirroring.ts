// dev:mock's mirroring seam: Bedroom TV, AirPlay, as a TV this phone has mirrored to before. There's
// no external display, so the phone's own player stands in for TV mode (CastSync applies the
// commands to it). A few seconds after the one-time guide shows, "mirroring starts"; the console
// can drive it too:
//   __ocMirror.connect("Bedroom TV")   Screen Mirroring connects: the phone switches to the remote
//   __ocMirror.lock()                  the phone locks: the TV picture stops ("Mirroring stopped")
//   __ocMirror.battery(0.64, false)    a battery reading

import { now } from "../../lib/clock";
import type { BatteryReading, MirroringSeam, MirrorStatus } from "./mirroring";
import type { RemoteCommand } from "./types";

/** How long after the guide shows the mock's "Screen Mirroring" connects. */
export const MOCK_CONNECT_AFTER_MS = 6000;

declare global {
  interface Window {
    __ocMirror?: { connect(tvName?: string): void; lock(): void; battery(level: number, charging?: boolean): void; disconnect(): void };
  }
}

export function mockMirroring(): MirroringSeam {
  let status: MirrorStatus = { connected: false, tvName: null, lockedAt: null };
  let readings: BatteryReading[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const commands = new Set<(c: RemoteCommand) => void>();
  const emit = () => listeners.forEach((l) => l());

  const connect = (tvName = "Bedroom TV") => {
    if (timer) clearTimeout(timer);
    timer = null;
    const t = now().getTime();
    // Ten minutes of readings, falling at a rate that leaves about three hours (the frame's 64%).
    readings = [
      { level: 0.676, charging: false, at: t - 10 * 60e3 },
      { level: 0.64, charging: false, at: t }
    ];
    status = { connected: true, tvName, lockedAt: null };
    emit();
  };
  const lock = () => {
    if (!status.connected) return;
    status = { connected: false, tvName: status.tvName, lockedAt: now().getTime() };
    emit();
  };

  if (typeof window !== "undefined") {
    window.__ocMirror = {
      connect,
      lock,
      disconnect: () => {
        status = { connected: false, tvName: status.tvName, lockedAt: null };
        emit();
      },
      battery: (level, charging = false) => {
        readings = [...readings, { level, charging, at: now().getTime() }];
        emit();
      }
    };
  }

  return {
    kind: "mock",
    knownTvs: () => ["Bedroom TV"],
    status: () => status,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    expect(tvName) {
      if (status.connected || timer) return;
      timer = setTimeout(() => connect(tvName), MOCK_CONNECT_AFTER_MS);
    },
    send(command) {
      if (status.connected) commands.forEach((l) => l(command));
    },
    onCommand(l) {
      commands.add(l);
      return () => commands.delete(l);
    },
    battery: () => readings,
    keepAwake() {},
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      status = { connected: false, tvName: status.tvName, lockedAt: null };
      emit();
    }
  };
}
