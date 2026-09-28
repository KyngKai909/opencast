// The Cast receiver's message channel. On a Chromecast: Google's Cast Application Framework
// (loaded by receiver.tsx), with Opencast's custom namespace. In dev:mock there's no Chromecast:
// a stand-in carries the same messages over a BroadcastChannel, so the viewer app's phone remote
// in another tab (or any page on this origin) can drive the receiver.

import { CAST_NAMESPACE, type CastContextLike } from "@opencast/player";

/** The mock's channel name; the viewer's mock sender uses the same (apps/viewer/src/cast/mockCast.ts). */
export const MOCK_CAST_CHANNEL = "opencast-cast-mock";

/** A message on the mock channel. */
export type MockCastMessage =
  | { to: "receiver"; senderId: string; namespace: string; data: unknown }
  | { to: "sender"; senderId: string | null; namespace: string; data: unknown }
  | { to: "receiver"; senderId: string; kind: "connect" | "disconnect"; name?: string };

interface CafContext extends CastContextLike {
  start(options?: unknown): void;
}

declare global {
  interface Window {
    cast?: { framework?: { CastReceiverContext: { getInstance(): CafContext }; system: { MessageType: { JSON: string } } } };
  }
}

export const CAF_URL = "https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js";

/** Loads Google's Cast Application Framework (on a Cast device). Resolves false if it can't. */
export function loadCaf(): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = CAF_URL;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

/** Google's receiver context, started with Opencast's namespace; null where CAF isn't loaded. */
export function cafContext(): CastContextLike | null {
  const fw = typeof window !== "undefined" ? window.cast?.framework : undefined;
  if (!fw) return null;
  const ctx = fw.CastReceiverContext.getInstance();
  ctx.start({ customNamespaces: { [CAST_NAMESPACE]: fw.system.MessageType.JSON }, disableIdleTimeout: false });
  return ctx;
}

/** The dev:mock stand-in: phones are other tabs on the same origin. */
export function mockCastContext(): CastContextLike & { senders: Map<string, string> } {
  const channel = new BroadcastChannel(MOCK_CAST_CHANNEL);
  const listeners = new Map<string, Set<(e: { senderId: string; data: unknown }) => void>>();
  const senders = new Map<string, string>();
  channel.onmessage = (ev: MessageEvent<MockCastMessage>) => {
    const m = ev.data;
    if (!m || m.to !== "receiver") return;
    if ("kind" in m) {
      if (m.kind === "connect") senders.set(m.senderId, m.name ?? "");
      else senders.delete(m.senderId);
      return;
    }
    senders.set(m.senderId, senders.get(m.senderId) ?? "");
    listeners.get(m.namespace)?.forEach((l) => l({ senderId: m.senderId, data: m.data }));
  };
  // Tell phones already open that a receiver is here.
  channel.postMessage({ to: "sender", senderId: null, namespace: CAST_NAMESPACE, data: { type: "receiver-ready" } } satisfies MockCastMessage);
  return {
    senders,
    addCustomMessageListener(ns, l) {
      if (!listeners.has(ns)) listeners.set(ns, new Set());
      listeners.get(ns)!.add(l);
    },
    removeCustomMessageListener(ns, l) {
      listeners.get(ns)?.delete(l);
    },
    sendCustomMessage(ns, senderId, message) {
      channel.postMessage({ to: "sender", senderId: senderId ?? null, namespace: ns, data: message } satisfies MockCastMessage);
    },
    getSenders() {
      return [...senders.keys()].map((id) => ({ id }));
    }
  };
}
