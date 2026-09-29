// Master control against the real API (playwright.real.config.ts): every route opens, as Kai (BEAT's
// owner), and shows its page, not an error. What the API doesn't answer yet (the proposed
// endpoints in apps/web/src/control/api/ext) is listed on each test as `api-miss` annotations, so the
// run says what still runs on mocks; a page error or a blank page fails the test.

import type { Page } from "@playwright/test";
import { api, expect, seed, signIn, test } from "../lib/real";

interface Route {
  name: string;
  path: () => Promise<string> | string;
  /** The page's heading, and its level (1 unless it says). */
  heading: string | RegExp;
  level?: number;
}

const beat = () => `/control/${seed.stations.beat.callSign.toLowerCase()}`;

const ROUTES: Route[] = [
  { name: `/beat/monitor`, path: () => `${beat()}/monitor`, heading: "Monitor" },
  { name: `/beat/monitor?switch=1`, path: () => `${beat()}/monitor?switch=1`, heading: "Monitor" },
  { name: `/beat/log`, path: () => `${beat()}/log`, heading: "Program log" },
  { name: `/beat/log?view=week`, path: () => `${beat()}/log?view=week`, heading: "Program log" },
  { name: `/beat/live-sources`, path: () => `${beat()}/live-sources`, heading: "Live sources" },
  { name: `/beat/live`, path: () => `${beat()}/live`, heading: /live/i },
  { name: `/beat/listings`, path: () => `${beat()}/listings`, heading: "Listings" },
  { name: `/beat/library`, path: () => `${beat()}/library`, heading: "Library" },
  {
    name: "/beat/live/:beatTapeLive",
    path: async () => {
      const t = Date.now();
      const log = await api<{ entries: { id: string; kind: string; title: string }[] }>(`/stations/${seed.stations.beat.id}/log?from=${new Date(t).toISOString()}&to=${new Date(t + 36 * 3600e3).toISOString()}`, { as: "kai" });
      const live = log.entries.find((e) => e.kind === "live") ?? log.entries.find((e) => e.title === "Beat Tape Live");
      return `${beat()}/live/${live!.id}`;
    },
    heading: /.+/
  },
  {
    name: "/beat/library/items/:first",
    path: async () => {
      const lib = await api<{ items: { id: string }[] }>(`/stations/${seed.stations.beat.id}/library`, { as: "kai" });
      return `${beat()}/library/items/${lib.items[0]!.id}`;
    },
    heading: /.+/
  },
  { name: `/beat/market`, path: () => `${beat()}/market`, heading: "Syndication market" },
  { name: `/beat/market/catalog`, path: () => `${beat()}/market/catalog`, heading: "Opencast catalog" },
  { name: `/beat/market/carried`, path: () => `${beat()}/market/carried`, heading: "Syndication market" },
  { name: `/beat/market/offered`, path: () => `${beat()}/market/offered`, heading: "Syndication market" },
  { name: `/beat/market/offers/:saturdayReel`, path: () => `${beat()}/market/offers/${seed.offers.saturdayReel}`, heading: "Saturday Reel" },
  { name: `/beat/market/offers/:saturdayReel/terms`, path: () => `${beat()}/market/offers/${seed.offers.saturdayReel}/terms`, heading: "Saturday Reel" },
  { name: `/beat/log/place/:saturdayReel?term=barter`, path: () => `${beat()}/log/place/${seed.offers.saturdayReel}?term=barter`, heading: "Place Saturday Reel" },
  { name: `/beat/breaks`, path: () => `${beat()}/breaks`, heading: "Breaks tonight" },
  { name: `/beat/spot-market`, path: () => `${beat()}/spot-market`, heading: "Spot market" },
  { name: `/beat/spot-market/rotation`, path: () => `${beat()}/spot-market/rotation`, heading: "Spot market" },
  { name: `/beat/spot-market/orders`, path: () => `${beat()}/spot-market/orders`, heading: "Spot market" },
  { name: `/beat/spot-market/:fallMenu`, path: () => `${beat()}/spot-market/${seed.spots.fallMenu}`, heading: "Spot market" },
  { name: `/beat/sponsors`, path: () => `${beat()}/sponsors`, heading: "Sponsors" },
  { name: `/beat/earnings`, path: () => `${beat()}/earnings`, heading: "Earnings" },
  { name: `/beat/earnings/statements`, path: () => `${beat()}/earnings/statements`, heading: /Statements|Earnings/ },
  { name: `/beat/audience`, path: () => `${beat()}/audience`, heading: "Audience" },
  ...["identity", "breaks", "sponsorship", "translators", "team", "notifications", "account", "ownership"].map((s) => ({ name: `/beat/settings/${s}`, path: () => `${beat()}/settings/${s}`, heading: "Settings", level: 2 })),
  { name: `/beat/translators`, path: () => `${beat()}/translators`, heading: "Translators" },
  { name: `/beat/rights`, path: () => `${beat()}/rights`, heading: "Rights" }
];

/** Opens a route, collecting the API's 404s and 5xxs and any page error, then checks the page drew. */
async function tour(page: Page, path: string, heading: string | RegExp, level = 1) {
  const misses: string[] = [];
  const errors: string[] = [];
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.port === "8788" && (r.status() === 404 || r.status() >= 500)) misses.push(`${r.request().method()} ${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")} ${r.status()}`);
  });
  page.on("pageerror", (e) => errors.push(e.message));
  // The client logs a response that doesn't match its contract (or its proposed extension) and shows an error.
  page.on("console", (m) => m.type() === "error" && /doesn't match its contract/.test(m.text()) && misses.push(`contract: ${m.text().slice(0, 120)}`));
  await page.goto(path);
  await expect(page.getByRole("heading", { level }).filter({ hasText: heading }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  for (const m of [...new Set(misses)]) test.info().annotations.push({ type: "api-miss", description: m });
  expect(errors, "page errors").toEqual([]);
  await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
}

for (const r of ROUTES) {
  test(r.name, async ({ page }) => {
    await signIn(page, "kai");
    await tour(page, await r.path(), r.heading, r.level);
  });
}

test("someone new, with no station, is asked to start one", async ({ page }) => {
  await signIn(page, "new-owner-routes");
  await page.goto("/control");
  await expect(page.getByRole("heading", { name: "Start a station" })).toBeVisible();
  await page.getByRole("link", { name: "Start a station" }).click();
  await expect(page.getByRole("heading", { name: "Your station" })).toBeVisible();
});

test("the unanswered sponsorship opens", async ({ page }) => {
  await signIn(page, "kai");
  const { sponsorships } = await api<{ sponsorships: { id: string; status: string }[] }>(`/stations/${seed.stations.beat.id}/sponsorships`, { as: "kai" });
  const one = sponsorships[0];
  test.skip(!one, "no sponsorship listed for BEAT");
  await tour(page, `${beat()}/sponsors/${one!.id}`, "Sponsors");
});

test("the creator's claim page, signed out", async ({ page }) => {
  // The claim page (N10, GET /claim/:token) is proposed: without it, the page says it wasn't found.
  await page.goto("/control/claim/not-a-real-token");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
});
