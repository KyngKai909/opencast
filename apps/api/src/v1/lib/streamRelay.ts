// A237 (2026-10-01, the user's decision over Phase 6's "never proxied"): an external station's
// `http://` stream link reaches Opencast's HTTPS apps either over https from the source itself (the
// same address answers there) or through Opencast's HTTPS relay, a Cloudflare Worker
// (apps/stream-relay, docs/stream-relay.md). Everything else (https stream links, official embeds,
// DASH over https) still plays straight from the source.
//
// A relay address carries a signature over the upstream's origin (scheme, host and port): HMAC-SHA256
// with STREAM_RELAY_SECRET, base64url. The Worker relays any address on a signed origin, so a
// playlist's segments and variants on the same origin work without the API signing each one.
//
//   https://<relay>/v1/<sig>/<b64url(upstream URL)>          the address in full (HLS)
//   https://<relay>/v1/<sig>/<b64url(origin)>/<path>?<query> the path kept (DASH: a manifest's
//                                                            relative addresses resolve as they would)

import { createHmac } from "node:crypto";

export interface StreamRelay {
  /** The relay's public origin, e.g. `https://stream-relay.<account>.workers.dev`. */
  base: string;
  secret: string;
}

/** The relay from STREAM_RELAY_BASE and STREAM_RELAY_SECRET; null unless both are set. */
export function streamRelayFromEnv(env: NodeJS.ProcessEnv): StreamRelay | null {
  const base = env.STREAM_RELAY_BASE?.trim().replace(/\/+$/, "");
  const secret = env.STREAM_RELAY_SECRET?.trim();
  if (!base || !secret) return null;
  return { base, secret };
}

const b64url = (text: string) => Buffer.from(text, "utf8").toString("base64url");

/** The signature for one origin (`http://host[:port]`, as `URL.origin` writes it). */
export function relaySignature(secret: string, origin: string): string {
  return createHmac("sha256", secret).update(origin).digest("base64url");
}

/** An `http://` address, as a relay address: HLS in full, DASH with its path kept. */
export function relayUrl(relay: StreamRelay, upstream: string, format: "hls" | "dash" = "hls"): string {
  const url = new URL(upstream);
  url.hash = "";
  const sig = relaySignature(relay.secret, url.origin);
  if (format === "dash") return `${relay.base}/v1/${sig}/${b64url(url.origin)}${url.pathname}${url.search}`;
  return `${relay.base}/v1/${sig}/${b64url(url.href)}`;
}

/** Whether an address is plain `http://` (what the relay is for). */
export function isPlainHttp(url: string): boolean {
  return /^http:\/\//i.test(url.trim());
}

/**
 * The https address to try for an `http://` one: the same host, path and query; port 443, or its
 * own port when it names one other than 80 (`URL` already drops an explicit `:80`).
 */
export function httpsVariant(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:") return null;
    u.protocol = "https:";
    return u.href;
  } catch {
    return null;
  }
}
