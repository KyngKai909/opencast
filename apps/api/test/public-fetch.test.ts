// External stations' fetches reach only the public internet: a listing, a feed or a redirect can't
// point the worker at Postgres, Redis, the API or cloud metadata.

import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPublicUrl, isPublicAddress, publicFetch } from "../src/v1/lib/publicFetch.js";

const resolvesTo = (...addresses: string[]) => (async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }))) as never;

describe("public addresses only", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tells public addresses from private, loopback, link-local and mapped ones", () => {
    for (const a of ["8.8.8.8", "104.16.1.1", "2606:4700::1111"]) expect(isPublicAddress(a)).toBe(true);
    for (const a of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "100.100.1.1", "0.0.0.0", "::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "not an ip"]) expect(isPublicAddress(a)).toBe(false);
  });

  it("refuses internal hosts, other schemes, and names that resolve inside", async () => {
    await expect(assertPublicUrl("http://localhost:8787/health")).rejects.toThrow("Not a public address");
    await expect(assertPublicUrl("http://postgres.railway.internal:5432/")).rejects.toThrow("Not a public address");
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow("Not a public address");
    await expect(assertPublicUrl("http://[::1]/")).rejects.toThrow("Not a public address");
    await expect(assertPublicUrl("https://sneaky.example/", resolvesTo("93.184.216.34", "10.0.0.7"))).rejects.toThrow("Not a public address");
    await expect(assertPublicUrl("https://city.example/live.m3u8", resolvesTo("93.184.216.34"))).resolves.toBeInstanceOf(URL);
  });

  it("checks every redirect: a public address that redirects inside is refused", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    });
    await expect(publicFetch("http://93.184.216.34/stream.m3u8")).rejects.toThrow("Not a public address");
    expect(calls).toEqual(["http://93.184.216.34/stream.m3u8"]);
  });
});
