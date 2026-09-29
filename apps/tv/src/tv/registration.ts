// This TV's identity (B2): on first launch the TV app registers itself and keeps the device token
// it's given (shown once). A Cast receiver and an iPhone's second screen never register: they
// keep nothing and use no TV endpoints.

import { tvApi, type RegisteredTv, type TvPlatform } from "@opencast/contracts";
import { call } from "../api/client";
import { deviceKind } from "../components/settings/about";
import { getDevice, isMemoryOnly, setDevice } from "./device";

/** The platform to register as, from what the About section says this TV is. */
export function platformFor(ua: string): TvPlatform {
  switch (deviceKind(ua)) {
    case "Fire TV":
      return "fire_tv";
    case "Google TV":
      return "google_tv";
    case "Android TV":
      return "android_tv";
    case "TV browser":
      return "tv_browser";
    default:
      return "web";
  }
}

export type Register = (platform: TvPlatform) => Promise<RegisteredTv>;
const viaApi: Register = (platform) => call(tvApi.registerTv, { body: { platform } });

let pending: Promise<boolean> | null = null;

/**
 * Registers this TV unless it already has its token. Several callers at once share one request.
 * Resolves true once the TV has a device token, false where TV mode never registers; rejects when
 * the API can't be reached (callers try again later).
 */
export function ensureRegistered(register: Register = viaApi, ua = typeof navigator === "undefined" ? "" : navigator.userAgent): Promise<boolean> {
  if (isMemoryOnly()) return Promise.resolve(false);
  if (getDevice().deviceToken) return Promise.resolve(true);
  pending ??= (async () => {
    try {
      const r = await register(platformFor(ua));
      setDevice({ tvId: r.tvId, deviceToken: r.deviceToken });
      return true;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** The API didn't know this TV's token (its record is gone): forget it and register again. */
export function registerAgain(register?: Register): Promise<boolean> {
  setDevice({ tvId: null, deviceToken: null });
  return ensureRegistered(register).catch(() => false);
}
