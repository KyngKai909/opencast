// Which senders this build has. Cast: dev:mock's stand-in (reaching TV mode's receiver.html), the
// Cast SDK through the app's plugin in the iPhone and Android apps, Google's Cast Web Sender in
// Chrome, each when a receiver application is configured; or none (casting isn't offered in other
// browsers). The relay, for the Opencast TV app: over the API, or in dev:mock over TV mode's bridge page.

import { config } from "../config";
import { hasPlugin } from "../native/platform";
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
  if (!config.castAppId) return false;
  return hasPlugin("OpencastCast") || browserCanCast();
}

export function getSender(): Promise<CastSender | null> {
  sender ??= (async () => {
    if (import.meta.env.VITE_MOCK === "true") {
      const m = await import("./mockSender");
      return m.createMockSender(() => m.iframeTransport(config.tvUrl));
    }
    if (!config.castAppId) return null;
    // The apps: the Cast SDK, in its own chunk (the web build never loads it).
    if (hasPlugin("OpencastCast")) {
      const [{ createNativeCastSender }, { OpencastCast }] = await Promise.all([import("../native/nativeCastSender"), import("../native/plugins")]);
      return createNativeCastSender(OpencastCast, config.castAppId);
    }
    if (browserCanCast()) return createGoogleSender(config.castAppId);
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

/** The sender that reaches this TV: the relay for the TV app, Cast otherwise (natively in the apps). AirPlay TVs aren't cast to: they mirror (mirroring.ts). */
export function senderFor(target: CastTarget): Promise<CastSender | null> {
  return target.kind === "tv_app" ? getRelaySender() : getSender();
}

/** Tests only: forget the senders chosen so far. */
export function resetSendersForTests() {
  sender = null;
  relay = null;
}
