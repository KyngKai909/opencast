// A238 (the user's decision, extending A237): a stream link browsers can't load because its server
// sends no CORS header. Opencast's players fetch playlists and segments with XHR/fetch (hls.js,
// dash.js), so a server without `Access-Control-Allow-Origin` for the app's origin plays nowhere in a
// browser, https or not. This is the server-side check: as light as the minute's check (a ranged GET,
// a 5 s timeout, the public internet only), with the web app's origin as `Origin`.
//
// - The playlist first: blocked when its answer has no `Access-Control-Allow-Origin` of `*` or the
//   app's origin.
// - Allowed, then the first variant playlist (for an HLS master) and the first segment (its init
//   section, EXT-X-MAP, when it names one), the same light way: many CDNs allow playlists but not
//   segments.
// - DASH: the MPD, then the first segment or init it names when that's simple to work out (a
//   SegmentTemplate's `initialization` with only $RepresentationID$ or $Bandwidth$ in it, an
//   Initialization's `sourceURL`, or the first SegmentURL, with no BaseURL to follow); otherwise the
//   MPD only, and the result says so.
//
// `unknown` when something couldn't be checked (no answer, an error, not a playlist): it then plays
// as it did before A238, straight from the source.

import { publicFetch } from "./publicFetch.js";

export type CorsState = "ok" | "blocked" | "unknown";

export interface CorsCheck {
  state: CorsState;
  /** What was found, in the desk's words; null when everything checked allowed it. */
  detail: string | null;
}

/** The first bytes of a playlist are enough to find its first variant and segment. */
const PLAYLIST_BYTES = 64 * 1024;
/** A segment's first bytes: only its headers matter. */
const SEGMENT_RANGE = "bytes=0-1023";
export const CORS_TIMEOUT_MS = 5_000;

type Fetch = typeof fetch;

/** Whether an answer lets a page on `origin` read it. */
export function allowsOrigin(res: Response, origin: string): boolean {
  const value = res.headers.get("access-control-allow-origin")?.trim();
  if (!value) return false;
  return value === "*" || value.toLowerCase() === origin.toLowerCase().replace(/\/+$/, "");
}

async function readSome(res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const all = new Uint8Array(Math.min(size, limit));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.min(c.byteLength, all.byteLength - at));
    all.set(part, at);
    at += part.byteLength;
    if (at >= all.byteLength) break;
  }
  return new TextDecoder().decode(all);
}

/**
 * A239: the detail kept when a stream's server refuses a web page's request (with the app's `Origin`)
 * but answers the same request without one, as Opencast's native apps send it: it plays in the native
 * apps only (`ListedSource.nativeOnly`). The state stays `unknown`, so browsers play it as before.
 */
export const ORIGIN_REFUSED_DETAIL = "Its server refuses web pages' requests (it answers only without an Origin header), so it plays in the TV app only";

/**
 * One light request with the app's origin (none: as a native app asks); the answer, or null when
 * there was none or it was an error status (`refused` says which: the server answered with an error).
 */
async function askFully(url: string, origin: string | null, range: string, fetchFn: Fetch, timeoutMs: number): Promise<{ res: Response | null; refused: boolean }> {
  try {
    const res = await fetchFn(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: origin ? { origin, range } : { range } });
    if (res.status >= 400) {
      await res.body?.cancel().catch(() => undefined);
      return { res: null, refused: true };
    }
    return { res, refused: false };
  } catch {
    return { res: null, refused: false };
  }
}

async function ask(url: string, origin: string | null, range: string, fetchFn: Fetch, timeoutMs: number): Promise<Response | null> {
  return (await askFully(url, origin, range, fetchFn, timeoutMs)).res;
}

/** An address a playlist names, resolved against where the playlist came from; null for anything but http(s). */
function resolve(raw: string, base: string): string | null {
  try {
    const u = new URL(raw.trim().replace(/&amp;/g, "&"), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

/** An HLS master's first variant playlist. */
export function firstVariant(text: string, base: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const at = lines.findIndex((l) => l.startsWith("#EXT-X-STREAM-INF"));
  if (at < 0) return null;
  const next = lines.slice(at + 1).find((l) => l && !l.startsWith("#"));
  return next ? resolve(next, base) : null;
}

/** An HLS media playlist's first segment (its init section when it names one). */
export function firstSegment(text: string, base: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const map = lines.find((l) => l.startsWith("#EXT-X-MAP"));
  const mapUri = map ? /URI="([^"]*)"/.exec(map)?.[1] : undefined;
  if (mapUri) return resolve(mapUri, base);
  const segment = lines.find((l) => l && !l.startsWith("#"));
  return segment ? resolve(segment, base) : null;
}

/**
 * A DASH manifest's first segment or init, when that's simple to work out; null otherwise (a BaseURL
 * to follow, or a template with $Number$ or $Time$ in it).
 */
export function firstDashSegment(text: string, base: string): string | null {
  if (/<BaseURL\b/.test(text)) return null;
  const init = /<Initialization\b[^>]*\bsourceURL=(["'])(.*?)\1/.exec(text)?.[2];
  if (init) return resolve(init, base);
  const tpl = /<SegmentTemplate\b[^>]*\binitialization=(["'])(.*?)\1/.exec(text);
  if (tpl) {
    let value = tpl[2] ?? "";
    const after = text.slice(tpl.index ?? 0);
    const before = text.slice(0, tpl.index ?? 0);
    const reps = [...after.matchAll(/<Representation\b([^>]*)>?/g), ...[...before.matchAll(/<Representation\b([^>]*)>?/g)].reverse()];
    const rep = reps[0]?.[1] ?? "";
    const id = /\bid=(["'])(.*?)\1/.exec(rep)?.[2];
    const bandwidth = /\bbandwidth=(["'])(.*?)\1/.exec(rep)?.[2];
    if (value.includes("$RepresentationID$")) {
      if (!id) return null;
      value = value.split("$RepresentationID$").join(id);
    }
    if (value.includes("$Bandwidth$")) {
      if (!bandwidth) return null;
      value = value.split("$Bandwidth$").join(bandwidth);
    }
    if (value.includes("$")) return null;
    return resolve(value, base);
  }
  const segment = /<SegmentURL\b[^>]*\bmedia=(["'])(.*?)\1/.exec(text)?.[2];
  return segment ? resolve(segment, base) : null;
}

/**
 * A238: whether browsers on `appOrigin` can load a stream link (see above). `ok`, `blocked` (with
 * what was blocked), or `unknown` (what couldn't be checked).
 */
export async function probeCors(streamUrl: string, appOrigin: string, fetchFn: Fetch = publicFetch, timeoutMs = CORS_TIMEOUT_MS): Promise<CorsCheck> {
  const origin = appOrigin.replace(/\/+$/, "");
  const { res: playlist, refused } = await askFully(streamUrl, origin, `bytes=0-${PLAYLIST_BYTES - 1}`, fetchFn, timeoutMs);
  if (!playlist) {
    // A239: an error status (not silence) is asked again without an Origin, as the native apps ask.
    // A playlist then: the server refuses web pages only (the native apps play it straight from the
    // source; browsers can't).
    const bare = refused ? await ask(streamUrl, null, `bytes=0-${PLAYLIST_BYTES - 1}`, fetchFn, timeoutMs) : null;
    const head = bare ? (await readSome(bare, 1024).catch(() => "")).trimStart() : "";
    if (head.startsWith("#EXTM3U") || /<MPD[\s>]/.test(head)) return { state: "unknown", detail: ORIGIN_REFUSED_DETAIL };
    return { state: "unknown", detail: "Its playlist didn't answer the check" };
  }
  const allowed = allowsOrigin(playlist, origin);
  const text = allowed ? await readSome(playlist, PLAYLIST_BYTES).catch(() => "") : "";
  if (!allowed) {
    await playlist.body?.cancel().catch(() => undefined);
    return { state: "blocked", detail: "Its playlist has no CORS header for Opencast's apps" };
  }
  const at = playlist.url || streamUrl;
  const head = text.trimStart();
  if (/<MPD[\s>]/.test(head)) {
    const segment = firstDashSegment(head, at);
    if (!segment) return { state: "ok", detail: "Checked its MPD only (its segments' addresses aren't simple to work out)" };
    const res = await ask(segment, origin, SEGMENT_RANGE, fetchFn, timeoutMs);
    if (!res) return { state: "unknown", detail: "Its MPD allows Opencast's apps; its segments couldn't be checked" };
    await res.body?.cancel().catch(() => undefined);
    return allowsOrigin(res, origin) ? { state: "ok", detail: null } : { state: "blocked", detail: "Its segments have no CORS header for Opencast's apps" };
  }
  if (!head.startsWith("#EXTM3U")) return { state: "unknown", detail: "Not a stream playlist" };

  let media = head;
  let mediaAt = at;
  const variant = firstVariant(head, at);
  if (variant) {
    const res = await ask(variant, origin, `bytes=0-${PLAYLIST_BYTES - 1}`, fetchFn, timeoutMs);
    if (!res) return { state: "unknown", detail: "Its playlist allows Opencast's apps; its variant playlists couldn't be checked" };
    if (!allowsOrigin(res, origin)) {
      await res.body?.cancel().catch(() => undefined);
      return { state: "blocked", detail: "Its variant playlists have no CORS header for Opencast's apps" };
    }
    media = (await readSome(res, PLAYLIST_BYTES).catch(() => "")).trimStart();
    mediaAt = res.url || variant;
    if (!media.startsWith("#EXTM3U")) return { state: "unknown", detail: "Its variant playlists couldn't be checked" };
  }
  const segment = firstSegment(media, mediaAt);
  if (!segment) return { state: "ok", detail: null };
  const res = await ask(segment, origin, SEGMENT_RANGE, fetchFn, timeoutMs);
  if (!res) return { state: "unknown", detail: "Its playlists allow Opencast's apps; its segments couldn't be checked" };
  await res.body?.cancel().catch(() => undefined);
  return allowsOrigin(res, origin) ? { state: "ok", detail: null } : { state: "blocked", detail: "Its segments have no CORS header for Opencast's apps" };
}
