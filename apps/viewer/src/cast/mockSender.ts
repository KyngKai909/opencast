// dev:mock's Cast sender. There is no Chromecast: TV mode's receiver.html (the TV app's dev server,
// VITE_TV_URL) listens on a BroadcastChannel, and a channel can't cross origins. So the TV's dev
// server serves a bridge page in mock mode only (apps/tv vite.config.ts, /mock-cast-bridge.html);
// this sender embeds it in a hidden iframe and relays the mock channel's messages through it.
// Never in a production build: sender.ts imports this only when VITE_MOCK is "true".

import { CAST_NAMESPACE, commandMessage, isReceiverReady, isSessionEnded, parseState, sessionMessage, type MockCastMessage } from "./messages";
import type { CastSender, CastTarget, ReceiverState, RemoteCommand, SessionIntro } from "./types";

/** The mock's TVs: the Chromecast in 06.2. (Bedroom TV, AirPlay, is the mock mirroring seam's.) */
export const MOCK_CHROMECASTS: CastTarget[] = [{ id: "mock-chromecast-living-room", name: "Living room TV", kind: "chromecast" }];

/** Carries mock channel messages to and from the receiver. */
export interface BridgeTransport {
  ready(): Promise<void>;
  post(message: MockCastMessage): void;
  listen(listener: (message: MockCastMessage) => void): () => void;
  close(): void;
}

/** The bridge page in a hidden iframe. Only messages from the TV's origin, from that iframe, count. */
export function iframeTransport(tvUrl: string): BridgeTransport {
  const origin = new URL(tvUrl).origin;
  const frame = document.createElement("iframe");
  frame.src = `${origin}/mock-cast-bridge.html`;
  frame.title = "Mock Cast bridge";
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
  const loaded = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The TV didn't answer. Is TV mode running?")), 8000);
    frame.addEventListener("load", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  document.body.appendChild(frame);
  return {
    ready: () => loaded,
    post(message) {
      frame.contentWindow?.postMessage(message, origin);
    },
    listen(listener) {
      const on = (e: MessageEvent) => {
        if (e.origin !== origin || e.source !== frame.contentWindow) return;
        const m = e.data as MockCastMessage | null;
        if (m && typeof m === "object" && m.to === "sender") listener(m);
      };
      window.addEventListener("message", on);
      return () => window.removeEventListener("message", on);
    },
    close() {
      frame.remove();
    }
  };
}

export function createMockSender(open: () => BridgeTransport, targets: CastTarget[] = MOCK_CHROMECASTS): CastSender {
  const senderId = `phone-${Math.random().toString(36).slice(2, 10)}`;
  const stateListeners = new Set<(s: ReceiverState) => void>();
  const endedListeners = new Set<() => void>();
  let transport: BridgeTransport | null = null;
  let stopListening: (() => void) | null = null;
  let intro: SessionIntro | null = null;
  let current: CastTarget | null = null;

  const end = () => {
    current = null;
    intro = null;
    stopListening?.();
    stopListening = null;
    transport?.close();
    transport = null;
  };
  const post = (data: unknown) => transport?.post({ to: "receiver", senderId, namespace: CAST_NAMESPACE, data });
  const introduce = () => {
    if (!intro) return;
    transport?.post({ to: "receiver", senderId, kind: "connect", name: intro.from });
    post(sessionMessage(intro));
  };

  return {
    kind: "mock",
    async targets() {
      return targets;
    },
    async connect(target, i) {
      if (!transport) {
        transport = open();
        stopListening = transport.listen((m) => {
          if (m.to !== "sender" || !("namespace" in m) || m.namespace !== CAST_NAMESPACE) return;
          if (m.senderId !== null && m.senderId !== senderId) return;
          if (!current) return;
          // The receiver started again: introduce this phone again, as the Cast SDK would rejoin.
          if (isReceiverReady(m.data)) return introduce();
          // The receiver ended the session (its sleep timer ran out): as the real SDK's SESSION_ENDED.
          if (isSessionEnded(m.data)) {
            end();
            return endedListeners.forEach((l) => l());
          }
          const state = parseState(m.data);
          if (state) stateListeners.forEach((l) => l(state));
        });
      }
      await transport.ready();
      intro = i;
      current = target;
      introduce();
      return target;
    },
    send(command: RemoteCommand) {
      if (!current || !intro) return;
      post(commandMessage(command, intro.from));
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
      if (current) transport?.post({ to: "receiver", senderId, kind: "disconnect" });
      end();
    },
    connected: () => current
  };
}
