// A237 (2026-10-01, the user's decision over Phase 6's "never proxied"): an external station's
// `http://` stream link reaches Opencast's HTTPS apps either over https from the source itself (the
// same address answers there) or through Opencast's HTTPS relay, a Cloudflare Worker
// (apps/stream-relay, docs/stream-relay.md). Everything else (https stream links, official embeds,
// DASH over https) still plays straight from the source.
//
// A238 (the user's decision, extending A237): an https stream link (or an http one's https address)
// whose server sends no CORS header for Opencast's apps can't be loaded by browsers either, so it's
// relayed too, in "all" mode: every address in its playlists through the relay, https included.
//
// A relay address carries a signature over the upstream's origin (scheme, host and port): HMAC-SHA256
// with STREAM_RELAY_SECRET, base64url. The Worker relays any address on a signed origin, so a
// playlist's segments and variants on the same origin work without the API signing each one. The
// mode is inside what's signed (`<origin>|all` for /v2/), so an http-only address can't be turned
// into one that relays everything.
//
//   https://<relay>/v1/<sig>/<b64url(upstream URL)>          the address in full (HLS), "http" mode
//   https://<relay>/v1/<sig>/<b64url(origin)>/<path>?<query> the path kept (DASH: a manifest's
//                                                            relative addresses resolve as they would)
//   https://<relay>/v2/…                                     the same two forms, "all" mode (A238)

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

/**
 * What a relay address may relay. `http` (/v1/, A237): an http stream link; its playlists' https
 * addresses stay direct. `all` (/v2/, A238): a stream whose server browsers can't load from (no CORS
 * header); every address in its playlists is relayed, https too.
 */
export type RelayMode = "http" | "all";

/** The signature for one origin (`http://host[:port]`, as `URL.origin` writes it), in one mode: the origin alone for /v1/, `<origin>|all` for /v2/. */
export function relaySignature(secret: string, origin: string, mode: RelayMode = "http"): string {
  return createHmac("sha256", secret)
    .update(mode === "all" ? `${origin}|all` : origin)
    .digest("base64url");
}

/** An address as a relay address: HLS in full, DASH with its path kept; /v1/ for `http` mode, /v2/ for `all`. */
export function relayUrl(relay: StreamRelay, upstream: string, format: "hls" | "dash" = "hls", mode: RelayMode = "http"): string {
  const url = new URL(upstream);
  url.hash = "";
  const sig = relaySignature(relay.secret, url.origin, mode);
  const at = `${relay.base}/${mode === "all" ? "v2" : "v1"}/${sig}`;
  if (format === "dash") return `${at}/${b64url(url.origin)}${url.pathname}${url.search}`;
  return `${at}/${b64url(url.href)}`;
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
