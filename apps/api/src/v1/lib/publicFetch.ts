// Fetches for addresses the Network desk types in (external stations' streams and embeds, their
// schedule feeds, IPTV lists): only to the public internet. The host must resolve to public
// addresses only, never loopback, private, link-local (cloud metadata) or Railway's internal
// network, and every redirect is checked the same way, so a listing can't point the worker at
// Postgres, Redis or the API. EXTERNAL_FETCH_ALLOW_PRIVATE=1 lifts it for local development.

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const MAX_REDIRECTS = 5;

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]
] as const) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) blocked.addSubnet(net, bits, "ipv6");

export class NotPublicError extends Error {
  constructor(url: string) {
    super(`Not a public address: ${url}`);
    this.name = "NotPublicError";
  }
}

/** Whether an IP address is on the public internet. */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return isPublicAddress(mapped);
  const family = isIP(address);
  if (!family) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** Throws unless the URL is http(s) to a host that resolves only to public addresses. */
export async function assertPublicUrl(raw: string, resolve: typeof lookup = lookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NotPublicError(raw);
  }
  if (process.env.EXTERNAL_FETCH_ALLOW_PRIVATE === "1") return url;
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new NotPublicError(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new NotPublicError(raw);
  const addresses = isIP(host) ? [{ address: host }] : await resolve(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) throw new NotPublicError(raw);
  return url;
}

/** `fetch`, to public addresses only, following redirects itself so each hop is checked. */
export const publicFetch: typeof fetch = async (input, init) => {
  let url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, { ...init, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location || init?.redirect === "manual") return res;
    await res.body?.cancel().catch(() => undefined);
    if (hop >= MAX_REDIRECTS) throw new TypeError("Too many redirects");
    url = new URL(location, url).href;
  }
};
