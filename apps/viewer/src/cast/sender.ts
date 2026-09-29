// Which senders this build has. Cast: dev:mock's stand-in (reaching TV mode's receiver.html), Google's
// Cast Web Sender in Chrome when a receiver application is configured, or none (casting isn't
// offered on the web elsewhere; the Phase 8 apps cast natively). The relay, for the Opencast TV
// app: over the API, or in dev:mock over TV mode's bridge page.

import { config } from "../config";
import { browserCanCast, createGoogleSender } from "./googleSender";
import { createRelaySender } from "./relay";
import { apiRelayLink } from "./relayApi";
import type { CastSender, CastTarget } from "./types";

let sender: Promise<CastSender | null> | null = null;
let relay: Promise<CastSender> | null = null;

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

/** The relay sender, for TVs with the Opencast app. Every browser has it. */
export function getRelaySender(): Promise<CastSender> {
  relay ??= (async () => {
    if (import.meta.env.VITE_MOCK === "true") {
      const m = await import("./mockRelay");
      return createRelaySender(m.sharedMockRelay(config.tvUrl));
    }
    return createRelaySender(apiRelayLink());
  })();
  return relay;
}

/** The sender that reaches this TV: the relay for the TV app, Cast otherwise. */
export function senderFor(target: CastTarget): Promise<CastSender | null> {
  return target.kind === "tv_app" ? getRelaySender() : getSender();
}
