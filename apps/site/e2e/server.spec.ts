// What scripts/serve.mjs answers (SITE-SPEC §1 redirects, clean URLs, the 404, robots and the
// sitemap, cache and security headers): the production server, the one Railway runs.
import { expect, test } from "@playwright/test";

test("old paths redirect permanently", async ({ request }) => {
  for (const [from, to] of [["/spot-market", "/spots"], ["/about", "/network"], ["/stations", "/run"], ["/about/", "/network"]]) {
    const r = await request.get(from!, { maxRedirects: 0 });
    expect(r.status(), from).toBe(301);
    expect(r.headers().location, from).toBe(to);
  }
});

test("URLs are clean: no trailing slash, no .html", async ({ request }) => {
  for (const [from, to] of [["/run/", "/run"], ["/run.html", "/run"], ["/run/index.html", "/run"], ["/spots/?x=1", "/spots?x=1"]]) {
    const r = await request.get(from!, { maxRedirects: 0 });
    expect(r.status(), from).toBe(301);
    expect(r.headers().location, from).toBe(to);
  }
  expect((await request.get("/run", { maxRedirects: 0 })).status()).toBe(200);
});

test("an unknown path is a 404 with the Off the air page", async ({ request }) => {
  const r = await request.get("/no-such-page");
  expect(r.status()).toBe(404);
  expect(await r.text()).toContain("Off the air.");
  expect(r.headers()["cache-control"]).toBe("no-store");
});

test("robots keeps crawlers off the kit and points at the sitemap", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /_kit");
  expect(robots).toContain("Sitemap: https://usedial.com/sitemap-index.xml");
  const map = await (await request.get("/sitemap-0.xml")).text();
  for (const p of ["/", "/run", "/syndication", "/spots", "/network", "/contact"]) expect(map).toContain(`<loc>https://usedial.com${p}</loc>`);
  expect(map).not.toContain("_kit");
  expect(map).not.toContain("404");
});

test("pages send security headers; hashed assets cache for a year", async ({ request }) => {
  const r = await request.get("/");
  const h = r.headers();
  expect(h["content-security-policy"]).toContain("script-src 'self'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["cache-control"]).toContain("max-age=60");
  const asset = (await r.text()).match(/\/_astro\/[^"]+\.js/)![0];
  expect((await request.get(asset)).headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect((await request.get("/healthz")).status()).toBe(200);
});
