// Opencast's HTTPS stream relay (A237, docs/stream-relay.md): an external station's plain-http stream
// link, relayed over HTTPS so Opencast's HTTPS apps can play it (browsers block http media on an
// https page as mixed content); and (A238) an https one whose server sends no CORS header, so
// browsers can't load it from Opencast's apps, relayed with this relay's own. Strictly pass-through: playlists are rewritten in memory and sent on,
// segments are streamed through as they arrive, and nothing is kept anywhere (no KV, R2, Durable
// Objects or Cache API; Cloudflare's edge cache only when RELAY_EDGE_CACHE_SECONDS asks for it).
//
//   GET|HEAD /v1/<sig>/<b64url(upstream URL)>             the address in full
//   GET|HEAD /v1/<sig>/<b64url(origin)>/<path>?<query>    the path kept (a DASH manifest's relative
//                                                         addresses resolve as at the source)
//   GET|HEAD /v2/…                                        A238's "all" mode, the same two forms
//   OPTIONS  (CORS preflight)                             GET /health
//
// `sig` is HMAC-SHA256 with STREAM_RELAY_SECRET, base64url: on /v1/ (A237, "http" mode) over the
// upstream's origin, on /v2/ (A238, "all" mode) over `<origin>|all`, so one mode's signature never
// works in the other. The API signs a stream link's origin, and any address on a signed origin is
// relayed, so its segments and variant playlists work. In playlists, /v1/ relays the http addresses
// (https ones stay direct); /v2/ relays every address, https too, for a server whose missing CORS
// header keeps browsers from loading it. When a playlist lists another origin, the relay signs that
// one itself, in the playlist's own mode, while rewriting (it's following the listed source's own
// playlist). Unsigned or badly signed: 403. Only http and https upstreams; never a private or local
// address (unless RELAY_ALLOW_PRIVATE=1, for `wrangler dev`).

import { rewriteHls, rewriteMpd } from "./playlists.js";
import { b64urlDecode, b64urlEncode, signOrigin, verifyOrigin, type RelayMode } from "./sign.js";

export interface Env {
  /** The same secret as the API's STREAM_RELAY_SECRET (`wrangler secret put STREAM_RELAY_SECRET`). */
  STREAM_RELAY_SECRET?: string;
  /** Seconds a segment may be kept at the edge and in browsers. 0 (default): `no-store`. */
  RELAY_EDGE_CACHE_SECONDS?: string;
  /** "1" lets local and private addresses through (local development only). */
  RELAY_ALLOW_PRIVATE?: string;
}

/** An upstream that hasn't answered by then has failed. */
export const UPSTREAM_TIMEOUT_MS = 10_000;
/** The biggest playlist rewritten; anything larger is refused. */
export const PLAYLIST_MAX_BYTES = 5 * 1024 * 1024;
export const USER_AGENT = "Opencast stream relay";
const MAX_REDIRECTS = 5;
const MAX_EDGE_CACHE_SECONDS = 3_600;

const HLS_TYPES = ["application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl", "audio/x-mpegurl"];
const DASH_TYPES = ["application/dash+xml"];
/** What a playlist may come back as besides its own type (servers often say less). */
const PLAYLIST_GENERIC_TYPES = ["", "text/plain", "application/octet-stream", "binary/octet-stream", "application/xml", "text/xml"];
/** Segments and keys the edge may keep when RELAY_EDGE_CACHE_SECONDS is set (never a playlist). */
const SEGMENT_PATH = /\.(ts|m4s|mp4|m4v|m4a|aac|mp3|ac3|ec3|cmfv|cmfa|cmft|fmp4|vtt|webvtt|key)$/i;

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type"
};
/** Nothing the relay sends is ever a page: no scripts, frames or plugins on its origin. */
const SAFE: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
  "referrer-policy": "no-referrer"
};

function text(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...CORS, ...SAFE, ...extra } });
}

/** Local, private, link-local and multicast hosts (by name or literal address). */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (h.includes(":")) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h)?.[1];
    if (mapped) return isPrivateHost(mapped);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(h)) return true;
    return h === "::" || h === "::1" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || /^ff/.test(h);
  }
  return false;
}

type Kind = "hls" | "dash" | "media";

function kindByPath(url: URL): Kind | null {
  if (/\.m3u8?$/i.test(url.pathname)) return "hls";
  if (/\.mpd$/i.test(url.pathname)) return "dash";
  return null;
}

const mediaType = (res: Response) => (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();

function kindByType(type: string): Kind | null {
  if (HLS_TYPES.includes(type)) return "hls";
  if (DASH_TYPES.includes(type)) return "dash";
  return null;
}

function edgeSeconds(env: Env): number {
  const n = Math.floor(Number(env.RELAY_EDGE_CACHE_SECONDS ?? "0"));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_EDGE_CACHE_SECONDS) : 0;
}

/** Up to `limit` bytes of a body; null when there's more. */
async function readCapped(res: Response, limit: number): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return all;
}

interface Target {
  upstream: URL;
  /** Requested on the path form (`/v1/<sig>/<b64url(origin)>/<path>`). */
  pathForm: boolean;
}

/** The mode a relay address's version stands for: /v1/ "http" (A237), /v2/ "all" (A238). */
const MODES: Record<string, RelayMode> = { v1: "http", v2: "all" };
const VERSION: Record<RelayMode, string> = { http: "v1", all: "v2" };

/** The upstream a request names, or the response refusing it. */
async function target(url: URL, env: Env, secret: string, mode: RelayMode): Promise<Target | Response> {
  const parts = url.pathname.slice(`/${VERSION[mode]}/`.length).split("/");
  const [sig, encoded] = parts;
  if (parts.length < 2 || !sig || !encoded) return text(403, "Not signed");
  const decoded = b64urlDecode(encoded);
  if (decoded === null) return text(400, "Not a relay address");
  let upstream: URL;
  const pathForm = parts.length > 2;
  try {
    if (pathForm) {
      const origin = new URL(decoded);
      if (origin.origin !== decoded) return text(400, "Not a relay address");
      upstream = new URL(`${origin.origin}/${parts.slice(2).join("/")}${url.search}`);
    } else {
      upstream = new URL(decoded);
    }
  } catch {
    return text(400, "Not a relay address");
  }
  if (upstream.protocol !== "http:" && upstream.protocol !== "https:") return text(400, "Only http and https streams are relayed");
  if (upstream.username || upstream.password) return text(400, "Addresses with a user name or password aren't relayed");
  if (!(await verifyOrigin(secret, upstream.origin, sig, mode))) return text(403, "Bad signature");
  if (env.RELAY_ALLOW_PRIVATE !== "1" && isPrivateHost(upstream.hostname)) return text(403, "Not a public address");
  upstream.hash = "";
  return { upstream, pathForm };
}

/** Builds relay addresses on this relay's own origin, in the request's own mode, signing each origin once per request. */
function addresses(relayOrigin: string, secret: string, mode: RelayMode) {
  const sigs = new Map<string, Promise<string>>();
  const sig = (origin: string) => {
    let s = sigs.get(origin);
    if (!s) {
      s = signOrigin(secret, origin, mode);
      sigs.set(origin, s);
    }
    return s;
  };
  const at = `${relayOrigin}/${VERSION[mode]}`;
  return {
    full: async (u: URL) => `${at}/${await sig(u.origin)}/${b64urlEncode(u.href)}`,
    prefix: async (origin: string) => `${at}/${await sig(origin)}/${b64urlEncode(origin)}`,
    pathForm: async (u: URL) => `${at}/${await sig(u.origin)}/${b64urlEncode(u.origin)}${u.pathname}${u.search}`
  };
}

/** The source's answer, following up to 5 redirects (each checked like the first); the URL it came from. */
async function fetchUpstream(fetchFn: typeof fetch, upstream: URL, init: RequestInit, env: Env): Promise<{ res: Response; url: URL }> {
  let url = upstream;
  for (let hop = 0; ; hop++) {
    const res = await fetchFn(url.href, { ...init, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return { res, url };
    await res.body?.cancel().catch(() => undefined);
    if (hop >= MAX_REDIRECTS) throw new RelayError(502, "Too many redirects at the source");
    const next = new URL(location, url);
    if (next.protocol !== "http:" && next.protocol !== "https:") throw new RelayError(502, "The source redirected away from http");
    if (env.RELAY_ALLOW_PRIVATE !== "1" && isPrivateHost(next.hostname)) throw new RelayError(502, "The source redirected to a private address");
    next.hash = "";
    url = next;
  }
}

class RelayError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export async function handle(request: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...CORS, "access-control-allow-methods": "GET, HEAD, OPTIONS", "access-control-allow-headers": "Range", "access-control-max-age": "86400" }
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") return text(405, "Method not allowed", { allow: "GET, HEAD, OPTIONS" });
  if (url.pathname === "/" || url.pathname === "/health") return text(200, "Opencast stream relay");
  const mode = MODES[/^\/(v\d+)\//.exec(url.pathname)?.[1] ?? ""];
  if (!mode) return text(404, "Not found");
  const secret = env.STREAM_RELAY_SECRET;
  if (!secret) return text(503, "The relay isn't configured");

  const found = await target(url, env, secret, mode);
  if (found instanceof Response) return found;
  const { upstream, pathForm } = found;
  const relay = addresses(url.origin, secret, mode);
  const head = request.method === "HEAD";
  const byPath = kindByPath(upstream);
  // A DASH manifest is served on the path form, so its relative addresses resolve against the relay.
  if (byPath === "dash" && !pathForm) return text(302, "", { location: await relay.pathForm(upstream) });

  const seconds = edgeSeconds(env);
  const keep = seconds > 0 && byPath === null && SEGMENT_PATH.test(upstream.pathname);
  // Never the viewer's cookies, authorization or anything else of theirs: only a range, for segments.
  const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "*/*" };
  const range = request.headers.get("range");
  if (range && byPath === null) headers.range = range;
  if (byPath === null) headers["accept-encoding"] = "identity";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const init: RequestInit = keep
    ? ({ method: head ? "HEAD" : "GET", headers, signal: controller.signal, cf: { cacheTtl: seconds, cacheEverything: true } } as RequestInit)
    : { method: head ? "HEAD" : "GET", headers, signal: controller.signal, cache: "no-store" };

  let res: Response;
  let from: URL;
  try {
    ({ res, url: from } = await fetchUpstream(fetchFn, upstream, init, env));
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof RelayError) return text(error.status, error.message);
    if (controller.signal.aborted) return text(504, `The source didn't answer in ${UPSTREAM_TIMEOUT_MS / 1000} seconds`);
    return text(502, "Couldn't reach the source");
  }

  if (res.status >= 400) {
    clearTimeout(timer);
    await res.body?.cancel().catch(() => undefined);
    return text(res.status, `The source answered ${res.status}`);
  }

  const type = mediaType(res);
  const kind: Kind = byPath ?? kindByType(type) ?? "media";
  if (kind !== "media") {
    if (byPath && kindByType(type) === null && !PLAYLIST_GENERIC_TYPES.includes(type)) {
      clearTimeout(timer);
      await res.body?.cancel().catch(() => undefined);
      return text(502, `Not a playlist (${type})`);
    }
    // Redirected, or found by its type on the full form: the manifest's own path form, afresh.
    if (kind === "dash" && (!pathForm || from.href !== upstream.href)) {
      clearTimeout(timer);
      await res.body?.cancel().catch(() => undefined);
      return text(302, "", { location: await relay.pathForm(from) });
    }
    const out = { "content-type": res.headers.get("content-type") ?? (kind === "hls" ? "application/vnd.apple.mpegurl" : "application/dash+xml"), "cache-control": "no-store", ...CORS, ...SAFE };
    if (head) {
      clearTimeout(timer);
      await res.body?.cancel().catch(() => undefined);
      return new Response(null, { status: 200, headers: out });
    }
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > PLAYLIST_MAX_BYTES) {
      clearTimeout(timer);
      await res.body?.cancel().catch(() => undefined);
      return text(502, "The playlist is too large");
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await readCapped(res, PLAYLIST_MAX_BYTES);
    } catch {
      return text(controller.signal.aborted ? 504 : 502, "The source stopped answering");
    } finally {
      clearTimeout(timer);
    }
    if (!bytes) return text(502, "The playlist is too large");
    const body = new TextDecoder().decode(bytes);
    const start = body.replace(/^﻿/, "").trimStart();
    if (kind === "hls" ? !start.startsWith("#EXTM3U") : !/<MPD[\s>]/.test(body)) return text(502, "Not a playlist");
    // A238: in "all" mode (/v2/) https addresses are relayed too.
    const all = mode === "all";
    const rewritten = kind === "hls" ? await rewriteHls(body, from, relay.full, all) : await rewriteMpd(body, from, relay.prefix, all);
    return new Response(rewritten, { status: 200, headers: out });
  }

  // Segments and keys: streamed through as they arrive, never buffered. The timeout was for the
  // answer to start; a long segment then takes as long as it takes.
  clearTimeout(timer);
  const out: Record<string, string> = { ...CORS, ...SAFE, "cache-control": keep ? `public, max-age=${seconds}` : "no-store" };
  for (const name of ["content-type", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = res.headers.get(name);
    if (value) out[name] = value;
  }
  // A body the fetch decompressed has another length: then the length is left to the runtime.
  const encoding = (res.headers.get("content-encoding") ?? "identity").toLowerCase();
  const length = res.headers.get("content-length");
  if (length && encoding === "identity") out["content-length"] = length;
  return new Response(head ? null : res.body, { status: res.status, headers: out });
}
