// How the site is served (SITE-SPEC §1 redirects, clean URLs, the 404, robots and the sitemap,
// cache and security headers), by scripts/serve.mjs locally or by Vercel with SITE_URL set. Both
// read scripts/http.mjs. Vercel's permanent redirects are 308s where serve.mjs sends 301s.
import { expect, test } from "@playwright/test";

const deployed = !!process.env.SITE_URL;
const PERMANENT = [301, 308];

test("old paths redirect permanently", async ({ request }) => {
  for (const [from, to] of [["/spot-market", "/spots"], ["/about", "/network"], ["/stations", "/run"]]) {
    const r = await request.get(from!, { maxRedirects: 0 });
    expect(PERMANENT, from).toContain(r.status());
    expect(r.headers().location, from).toBe(to);
  }
  // With a trailing slash it lands in the same place (on Vercel in two hops: the slash, then the redirect).
  expect(new URL((await request.get("/about/")).url()).pathname).toBe("/network");
});

test("URLs are clean: no trailing slash, no .html", async ({ request }) => {
  for (const [from, to] of [["/run/", "/run"], ["/run.html", "/run"], ["/run/index.html", "/run"], ["/spots/?x=1", "/spots?x=1"]]) {
    const r = await request.get(from!, { maxRedirects: 0 });
    expect(PERMANENT, from).toContain(r.status());
    expect(r.headers().location, from).toBe(to);
  }
  expect((await request.get("/run", { maxRedirects: 0 })).status()).toBe(200);
});

test("an unknown path is a 404 with the Off the air page", async ({ request }) => {
  const r = await request.get("/no-such-page");
  expect(r.status()).toBe(404);
  expect(await r.text()).toContain("Off the air.");
  if (!deployed) expect(r.headers()["cache-control"]).toBe("no-store");
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
  if (!deployed) expect((await request.get("/healthz")).status()).toBe(200);
});
