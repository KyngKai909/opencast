// Where a request comes from, for the market from the connection (S10). The address is looked up
// and forgotten: never stored, never logged. The lookup is pluggable: GEOIP_URL is a URL with
// `{ip}` in it (an ip-to-postal service), answering a ZIP as plain text or JSON with a ZIP
// (`postal`, `zip`, `postal_code`, `zip_code`) and/or coordinates (`latitude`/`lat`,
// `longitude`/`lon`/`lng`). With nothing configured there's no lookup. Programming Phase 6: the same
// answer's country, when it has one (`country_code`, `countryCode`, or a two-letter `country`), for
// the territories a network licence clears other apps in (`countryOf`).

import { isIP } from "node:net";
import type { Request } from "express";

export interface GeoResult {
  zip: string | null;
  point: { lat: number; lng: number } | null;
  /** ISO 3166-1 alpha-2, upper case, when the lookup says (added 2026-10-10). */
  country?: string;
}

export interface GeoLookup {
  readonly configured: boolean;
  lookup(ip: string): Promise<GeoResult | null>;
}

export const noGeoLookup: GeoLookup = { configured: false, lookup: async () => null };

export function geoLookupFromUrl(template: string, timeoutMs = 1_500): GeoLookup {
  return {
    configured: true,
    async lookup(ip) {
      try {
        const response = await fetch(template.replace("{ip}", encodeURIComponent(ip)), { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json, text/plain" } });
        if (!response.ok) return null;
        const text = (await response.text()).trim();
        return parseGeo(text);
      } catch {
        return null;
      }
    }
  };
}

/** Reads a lookup's answer: a bare ZIP, or JSON with a ZIP and/or coordinates. */
export function parseGeo(text: string): GeoResult | null {
  const zipOf = (value: unknown) => {
    const match = typeof value === "string" || typeof value === "number" ? String(value).match(/^(\d{5})(?:-\d{4})?$/) : null;
    return match ? match[1] : null;
  };
  if (!text.startsWith("{")) {
    const zip = zipOf(text);
    return zip ? { zip, point: null } : null;
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const zip = zipOf(body.postal ?? body.zip ?? body.postal_code ?? body.zip_code ?? body.postalCode);
  const lat = Number(body.latitude ?? body.lat);
  const lng = Number(body.longitude ?? body.lon ?? body.lng);
  const point = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  const code = [body.country_code, body.countryCode, body.country].find((v) => typeof v === "string" && /^[A-Za-z]{2}$/.test(v)) as string | undefined;
  const country = code?.toUpperCase();
  return zip || point || country ? { zip, point, ...(country ? { country } : {}) } : null;
}

/** How long a connection's country is remembered (in memory only), and for how many connections. */
const COUNTRY_KEPT_MS = 10 * 60_000;
const COUNTRIES_KEPT = 20_000;
const countries = new WeakMap<GeoLookup, Map<string, { at: number; country: Promise<string | null> }>>();

/**
 * Programming Phase 6: the connection's country (ISO 3166-1 alpha-2), or null when it can't be told
 * (no lookup configured, a private address, or an answer without one). Remembered in memory for ten
 * minutes, so a player polling its playlist every few seconds is looked up once; never stored.
 */
export function countryOf(geo: GeoLookup, ip: string | null, now = Date.now()): Promise<string | null> {
  if (!ip || isPrivateAddress(ip) || !geo.configured) return Promise.resolve(null);
  let kept = countries.get(geo);
  if (!kept) countries.set(geo, (kept = new Map()));
  const hit = kept.get(ip);
  if (hit && now - hit.at < COUNTRY_KEPT_MS) return hit.country;
  const country = geo
    .lookup(ip)
    .then((found) => found?.country ?? null)
    .catch(() => null);
  if (kept.size >= COUNTRIES_KEPT) kept.clear();
  kept.set(ip, { at: now, country });
  return country;
}

export function geoFromEnv(env: NodeJS.ProcessEnv): GeoLookup {
  const url = env.GEOIP_URL?.trim();
  if (!url) return noGeoLookup;
  if (!url.includes("{ip}")) {
    console.warn("[v1] GEOIP_URL has no {ip} in it: the market from the connection is off.");
    return noGeoLookup;
  }
  return geoLookupFromUrl(url);
}

/**
 * The client's address. Behind Railway's edge the last `X-Forwarded-For` entry is the one the edge
 * added (earlier ones are whatever the client sent); TRUST_PROXY_HOPS says how many proxies to
 * count back from the end (default 1). With no header, the socket's address.
 */
export function clientIp(req: Pick<Request, "headers" | "socket">, hops = Number(process.env.TRUST_PROXY_HOPS ?? 1)): string | null {
  const header = req.headers["x-forwarded-for"];
  const list = (Array.isArray(header) ? header.join(",") : (header ?? ""))
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const raw = list.length ? list[Math.max(0, list.length - Math.max(1, hops))] : (req.socket?.remoteAddress ?? null);
  if (!raw) return null;
  const ip = raw.startsWith("::ffff:") && isIP(raw.slice(7)) === 4 ? raw.slice(7) : raw;
  return isIP(ip) ? ip : null;
}

/** Loopback, private, link-local, carrier-grade NAT and unique-local addresses: nothing to look up. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return true;
}
