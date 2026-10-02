// The real Cast sender on the web: Google's Cast Web Sender SDK, which only Chrome has. It's loaded
// when "Watch on" first opens, with Opencast's receiver application (VITE_CAST_APP_ID). The web SDK
// can't list TVs by name: Chrome shows its own list when casting starts, so "Watch on" offers one
// row for it. Elsewhere on the web casting isn't offered (the Phase 8 apps cast natively).

import { CAST_NAMESPACE, commandMessage, parseState, sessionMessage } from "./messages";
import type { CastSender, CastTarget, ReceiverState, RemoteCommand, SessionIntro } from "./types";

const SDK_URL = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

interface CafSession {
  getCastDevice(): { friendlyName: string; deviceId?: string };
  addMessageListener(namespace: string, listener: (namespace: string, message: string) => void): void;
  removeMessageListener(namespace: string, listener: (namespace: string, message: string) => void): void;
  sendMessage(namespace: string, data: unknown): Promise<unknown>;
}
interface CafContext {
  setOptions(o: { receiverApplicationId: string; autoJoinPolicy: string }): void;
  getCastState(): string;
  requestSession(): Promise<unknown>;
  getCurrentSession(): CafSession | null;
  endCurrentSession(stopCasting: boolean): void;
  addEventListener(type: string, listener: (e: { sessionState?: string }) => void): void;
}
interface CastGlobal {
  framework: {
    CastContext: { getInstance(): CafContext };
    CastState: Record<string, string>;
    CastContextEventType: Record<string, string>;
    SessionState: Record<string, string>;
  };
}
declare global {
  interface Window {
    __onGCastApiAvailable?: (available: boolean) => void;
    cast?: CastGlobal;
    chrome?: { cast?: { AutoJoinPolicy: Record<string, string> } };
  }
}

/** Chrome on a computer or Android: the only browsers with the Cast sender. */
export function browserCanCast(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Chrome\//.test(ua) && !/Edg\/|OPR\/|SamsungBrowser|CriOS|Firefox/.test(ua) && !/iPhone|iPad/.test(ua);
}

let loading: Promise<CafContext | null> | null = null;

function loadSdk(appId: string): Promise<CafContext | null> {
  loading ??= new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 10_000);
    window.__onGCastApiAvailable = (available) => {
      clearTimeout(timer);
      if (!available || !window.cast?.framework || !window.chrome?.cast) return resolve(null);
      const ctx = window.cast.framework.CastContext.getInstance();
      ctx.setOptions({ receiverApplicationId: appId, autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED });
      resolve(ctx);
    };
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    document.head.appendChild(s);
  });
  return loading;
}

const PICKER: CastTarget = { id: "chrome-cast-picker", name: "A TV with Chromecast", kind: "chromecast", picker: true };

export function createGoogleSender(appId: string): CastSender {
  const stateListeners = new Set<(s: ReceiverState) => void>();
  const endedListeners = new Set<() => void>();
  let session: CafSession | null = null;
  let intro: SessionIntro | null = null;
  let current: CastTarget | null = null;
  let watching = false;

  const onMessage = (_ns: string, message: string) => {
    const state = parseState(message);
    if (state) stateListeners.forEach((l) => l(state));
  };
  const detach = () => {
    session?.removeMessageListener(CAST_NAMESPACE, onMessage);
    session = null;
    current = null;
  };

  return {
    kind: "google",
    async targets() {
      const ctx = await loadSdk(appId);
      if (!ctx || !window.cast) return [];
      return ctx.getCastState() === window.cast.framework.CastState.NO_DEVICES_AVAILABLE ? [] : [PICKER];
    },
    async connect(_target, i) {
      const ctx = await loadSdk(appId);
      if (!ctx || !window.cast) throw new Error("Casting isn't available in this browser.");
      if (!watching) {
        watching = true;
        const fw = window.cast.framework;
        ctx.addEventListener(fw.CastContextEventType.SESSION_STATE_CHANGED, (e) => {
          if (e.sessionState === fw.SessionState.SESSION_ENDED && current) {
            detach();
            endedListeners.forEach((l) => l());
          }
        });
      }
      // Rejoins a session this origin already has, or opens Chrome's list of TVs.
      if (!ctx.getCurrentSession()) await ctx.requestSession();
      const s = ctx.getCurrentSession();
      if (!s) throw new Error("Casting didn't start.");
      session = s;
      intro = i;
      s.addMessageListener(CAST_NAMESPACE, onMessage);
      const device = s.getCastDevice();
      current = { id: device.deviceId ?? device.friendlyName, name: device.friendlyName, kind: "chromecast" };
      await s.sendMessage(CAST_NAMESPACE, sessionMessage(i));
      return current;
    },
    send(command: RemoteCommand) {
      if (!session || !intro) return;
      void session.sendMessage(CAST_NAMESPACE, commandMessage(command, intro.from)).catch(() => {});
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
      const ctx = window.cast?.framework.CastContext.getInstance();
      detach();
      intro = null;
      // Stopping from the phone stops Opencast on the TV too.
      ctx?.endCurrentSession(true);
    },
    connected: () => current
  };
}
