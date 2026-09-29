// Which Cast sender this build has: dev:mock's stand-in (reaching TV mode's receiver.html), Google's
// Cast Web Sender in Chrome when a receiver application is configured, or none (casting isn't
// offered on the web elsewhere; the Phase 8 apps cast natively).

import { config } from "../config";
import { browserCanCast, createGoogleSender } from "./googleSender";
import type { CastSender } from "./types";

let sender: Promise<CastSender | null> | null = null;

/** Whether this browser can cast at all, without loading anything. */
export function castOffered(): boolean {
  // Written out in full so a production build drops the mock branch (and its chunk) entirely.
  if (import.meta.env.VITE_MOCK === "true") return true;
  return !!config.castAppId && browserCanCast();
}

export function getSender(): Promise<CastSender | null> {
  sender ??= (async () => {
    if (import.meta.env.VITE_MOCK === "true") {
      const m = await import("./mockSender");
      return m.createMockSender(() => m.iframeTransport(config.tvUrl));
    }
    if (config.castAppId && browserCanCast()) return createGoogleSender(config.castAppId);
    return null;
  })();
  return sender;
}
