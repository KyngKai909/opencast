// Opencast for business against the real API (playwright.real.config.ts): every route opens, as
// Maya (Orange Street Coffee's owner), and shows its page, not an error. What the API doesn't
// answer yet (the proposed endpoints in apps/business/src/api/ext) is listed on each test as
// `api-miss` annotations, so the run says what still runs on mocks; a page error, a blank page or a
// response that fails its contract fails the test.

import type { Page } from "@playwright/test";
import { api, expect, seed, signIn, test } from "../lib/real";

interface Route {
  path: (b: string) => Promise<string> | string;
  /** The page's heading (level 1 unless it says). */
  heading: string | RegExp;
  level?: number;
  /** An overlay the route opens, by its name. */
  dialog?: string | RegExp;
}

const orange = () => seed.businesses.orange;

const ROUTES: Record<string, Route> = {
  "/:b/spots": { path: (b) => `/${b}/spots`, heading: "Spots" },
  "/:b/spots?switch=1": { path: (b) => `/${b}/spots?switch=1`, heading: "Spots" },
  "/:b/spots/new": { path: (b) => `/${b}/spots/new`, heading: "New spot" },
  "/:b/spots/:fallMenu": { path: (b) => `/${b}/spots/${seed.spots.fallMenu}`, heading: "Fall menu" },
  "/:b/spots/:nightOwl": { path: (b) => `/${b}/spots/${seed.spots.nightOwl}`, heading: "Night owl" },
  "/:b/sponsorships": { path: (b) => `/${b}/sponsorships`, heading: "Sponsorships" },
  "/:b/sponsorships?modal=sponsorship": {
    path: async (b) => {
      const list = await api<Array<{ id: string }>>(`/businesses/${b}/sponsorships`, { as: "maya" });
      return `/${b}/sponsorships?modal=sponsorship&id=${list[0]!.id}`;
    },
    heading: "Sponsorships",
    dialog: /Late Crate/
  },
  "/:b/sponsorships/new": { path: (b) => `/${b}/sponsorships/new`, heading: "Sponsor a station or program" },
  "/:b/orders": { path: (b) => `/${b}/orders`, heading: "Made for you" },
  "/:b/orders/new": { path: (b) => `/${b}/orders/new`, heading: "Order a spot" },
  "/:b/results": { path: (b) => `/${b}/results`, heading: "Where it aired" },
  "/:b/results/airings": { path: (b) => `/${b}/results/airings`, heading: "Airings" },
  "/:b/results/codes/:fallMenu": {
    path: async (b) => {
      const s = await api<{ code: { code: string } | null }>(`/spots/${seed.spots.fallMenu}`, { as: "maya" });
      return `/${b}/results/codes/${s.code?.code ?? "NONE"}`;
    },
    heading: /.+/
  },
  "/:b/balance": { path: (b) => `/${b}/balance`, heading: "Balance" },
  "/:b/balance?modal=add": { path: (b) => `/${b}/balance?modal=add`, heading: "Balance", dialog: "Add money" },
  "/:b/balance?modal=withdraw": { path: (b) => `/${b}/balance?modal=withdraw`, heading: "Balance", dialog: "Take money out" },
  "/:b/balance/statements": { path: (b) => `/${b}/balance/statements`, heading: /Statements|Balance/ },
  "/:b/redeem": { path: (b) => `/${b}/redeem`, heading: /Redeem/ },
  ...Object.fromEntries(
    ["business", "team", "money", "notifications", "connections", "close"].map((s) => [`/:b/settings/${s}`, { path: (b: string) => `/${b}/settings/${s}`, heading: "Settings", level: 2 }])
  ),
  "/:b/settings/business?modal=location": { path: (b) => `/${b}/settings/business?modal=location`, heading: "Settings", level: 2, dialog: "Add a location" },
  "/:b/settings/team?modal=invite": { path: (b) => `/${b}/settings/team?modal=invite`, heading: "Settings", level: 2, dialog: "Invite someone" }
};

/** Opens a route, collecting the API's 404s and 5xxs and any page error, then checks the page drew. */
async function tour(page: Page, path: string, r: Pick<Route, "heading" | "level" | "dialog">) {
  const misses: string[] = [];
  const errors: string[] = [];
  page.on("response", (res) => {
    const u = new URL(res.url());
    if (u.port === "8788" && (res.status() === 404 || res.status() >= 500)) misses.push(`${res.request().method()} ${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")} ${res.status()}`);
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /contract|schema|invalid_type|ZodError/i.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: r.level ?? 1 }).filter({ hasText: r.heading }).first()).toBeVisible();
  if (r.dialog) await expect(page.getByRole("dialog", { name: r.dialog })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  for (const m of [...new Set(misses)]) test.info().annotations.push({ type: "api-miss", description: m });
  expect(errors, "page errors").toEqual([]);
  await expect(page.getByText(/Something went wrong|doesn't match/)).toHaveCount(0);
}

for (const [name, r] of Object.entries(ROUTES)) {
  test(name, async ({ page }) => {
    await signIn(page, "maya");
    await tour(page, await r.path(orange()), r);
  });
}

test("Redlands Bikes: a spot in review", async ({ page }) => {
  await signIn(page, "omar");
  await tour(page, `/${seed.businesses.bikes}/spots/${seed.spots.rideSeason}`, { heading: "Ride season" });
  await expect(page.getByText("In review", { exact: true })).toBeVisible();
});

test("someone new starts a business", async ({ page }) => {
  await signIn(page, "new-business-routes");
  await tour(page, "/", { heading: "Your business" });
});
