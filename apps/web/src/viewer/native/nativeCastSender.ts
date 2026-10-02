// The Cast sender in the iPhone and Android apps: Google's Cast SDK through the app's OpencastCast
// plugin, so an iPhone casts to a Chromecast too (Safari can't). Unlike the web sender it lists TVs
// by name, and it speaks the same messages on the same namespace, as JSON text (the receiver reads
// the namespace as JSON, as it does from the web sender).

import { CAST_NAMESPACE, commandMessage, isReceiverReady, isSessionEnded, parseState, sessionMessage } from "../cast/messages";
import type { CastSender, CastTarget, ReceiverState, RemoteCommand, SessionIntro } from "../cast/types";
import type { NativeCastDevice, OpencastCastPlugin } from "./plugins";

/** How long "Watch on" waits for the first TV when discovery has just started. */
export const DISCOVERY_WAIT_MS = 2000;

const toTarget = (d: NativeCastDevice): CastTarget => ({ id: d.id, name: d.name, kind: "chromecast" });

function parse(message: string): unknown {
  try {
    return JSON.parse(message);
  } catch {
    return null;
  }
}

export function createNativeCastSender(plugin: OpencastCastPlugin, appId: string, o: { waitMs?: number } = {}): CastSender {
  const waitMs = o.waitMs ?? DISCOVERY_WAIT_MS;
  const stateListeners = new Set<(s: ReceiverState) => void>();
  const endedListeners = new Set<(message?: string) => void>();
  const deviceListeners = new Set<() => void>();
  let devices: NativeCastDevice[] = [];
  let intro: SessionIntro | null = null;
  let current: CastTarget | null = null;
  let ready: Promise<boolean> | null = null;

  const end = () => {
    current = null;
    intro = null;
  };
  const post = (data: unknown) => plugin.sendMessage({ namespace: CAST_NAMESPACE, message: JSON.stringify(data) });
  const introduce = () => (intro ? post(sessionMessage(intro)) : Promise.resolve());

  const setUp = () =>
    (ready ??= (async () => {
      await Promise.all([
        plugin.addListener("devicesChanged", (d) => {
          devices = d.devices ?? [];
          deviceListeners.forEach((l) => l());
        }),
        plugin.addListener("message", (m) => {
          if (m.namespace !== CAST_NAMESPACE || !current) return;
          const data = parse(m.message);
          // The receiver started again: introduce this phone again, as the web SDK's rejoin does.
          if (isReceiverReady(data)) return void introduce().catch(() => {});
          // The receiver ended the session (its sleep timer ran out).
          if (isSessionEnded(data)) {
            end();
            return endedListeners.forEach((l) => l());
          }
          const state = parseState(data);
          if (state) stateListeners.forEach((l) => l(state));
        }),
        plugin.addListener("sessionEnded", () => {
          if (!current) return;
          end();
          endedListeners.forEach((l) => l());
        })
      ]);
      const r = await plugin.setUp({ appId });
      return r.available;
    })().catch(() => false));

  /** The TVs found so far, waiting a little for the first one. */
  const found = () =>
    new Promise<NativeCastDevice[]>((resolve) => {
      if (devices.length) return resolve(devices);
      const done = () => {
        clearTimeout(timer);
        deviceListeners.delete(onChange);
        resolve(devices);
      };
      const onChange = () => devices.length && done();
      const timer = setTimeout(done, waitMs);
      deviceListeners.add(onChange);
    });

  return {
    kind: "native",
    async targets() {
      if (!(await setUp())) return [];
      try {
        const r = await plugin.startDiscovery();
        if (r.devices?.length) devices = r.devices;
      } catch {
        return [];
      }
      return (await found()).map(toTarget);
    },
    async connect(target, i) {
      if (!(await setUp())) throw new Error("Casting isn't available on this phone.");
      let device: NativeCastDevice;
      try {
        device = (await plugin.startSession({ deviceId: target.id })).device;
      } catch {
        throw new Error(`Couldn't start casting to ${target.name}. Check that the TV is on and on the same Wi-Fi.`);
      }
      current = toTarget(device);
      intro = i;
      await introduce();
      return current;
    },
    send(command: RemoteCommand) {
      if (!current || !intro) return;
      void post(commandMessage(command, intro.from)).catch(() => {});
    },
    onState(l) {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
    onEnded(l) {
      endedListeners.add(l);
      return () => endedListeners.delete(l);
    },
    disconnect() {
      // Stopping from the phone stops Opencast on the TV too, as on the web.
      if (current) void plugin.endSession({ stopCasting: true }).catch(() => {});
      end();
    },
    connected: () => current
  };
}
