// Network desk: axe on every route (routes.tsx), both grounds, at 1280. The overlays reached from
// the address (?add=1 on the pipeline and listed sources, ?ch= on the board, ?stage= on the
// pipeline) count as routes. Signed out it's the sign-in page; signed in off the team, the
// not-on-the-team page. Each test has its own browser context, so its own fresh mock database.

import { expect, test, type Page } from "@playwright/test";
import { checkA11y, useGround, type Ground } from "../lib/a11y";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IE = "/desk/markets/inland-empire";
const SKATE = U(202); // Desert Skate Films: Found, works catalogued
const LUPE = U(201); // Tía Lupe's Kitchen: set up, signs on later
const MARIACHI = U(217); // Moreno Valley Mariachi: said yes, not set up

/** Signed in as the admin, as the mock's sign-in leaves it. */
async function signedInAsAdmin(page: Page) {
  await page.addInitScript(() => localStorage.setItem("oc-mock-signed-in", "dee@opencast.example"));
}

/** No finite animation still running (fades, the modal's rise): axe measures what stays on screen. */
async function settled(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity)
  );
}

interface Route {
  path: string;
  /** What the page says once it's loaded. */
  ready: (page: Page) => Promise<void>;
}

const h1 = (name: string | RegExp) => async (page: Page) => {
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
};

const ROUTES: Route[] = [
  { path: `${IE}/board`, ready: async (p) => { await h1("Inland Empire")(p); await expect(p.getByRole("heading", { name: "TV band" })).toBeVisible(); } },
  { path: `${IE}/board?ch=33`, ready: async (p) => { await h1("Inland Empire")(p); await expect(p.getByRole("button", { pressed: true }).first()).toBeVisible(); } },
  { path: `${IE}/board?ch=92.0`, ready: async (p) => { await h1("Inland Empire")(p); await expect(p.getByRole("heading", { name: "Radio band" })).toBeVisible(); } },
  { path: `${IE}/pipeline`, ready: async (p) => { await h1("Creator pipeline")(p); await expect(p.getByRole("table", { name: "Creators" })).toBeVisible(); } },
  { path: `${IE}/pipeline?stage=said_yes`, ready: async (p) => { await h1("Creator pipeline")(p); await expect(p.getByRole("group", { name: "Stages" }).getByRole("button", { pressed: true })).toContainText("Said yes"); } },
  { path: `${IE}/pipeline?add=1`, ready: async (p) => { await expect(p.getByRole("dialog", { name: "Add a creator" })).toBeVisible(); } },
  { path: `${IE}/pipeline/${SKATE}/ask`, ready: h1("Ask Desert Skate Films") },
  { path: `${IE}/pipeline/${LUPE}/setup`, ready: async (p) => { await h1("Set up LUPE 33.1")(p); await expect(p.getByText("Sign-on scheduled")).toBeVisible(); } },
  { path: `${IE}/pipeline/${MARIACHI}/setup`, ready: async (p) => { await h1(/^Set up \w+ 27\.1$/)(p); await expect(p.getByRole("button", { name: "Schedule sign-on" })).toBeEnabled(); } },
  { path: `${IE}/listed`, ready: async (p) => { await h1("External sources")(p); await expect(p.getByRole("heading", { name: "Opencast catalog station" })).toBeVisible(); } },
  { path: `${IE}/listed?add=1`, ready: async (p) => { await expect(p.getByRole("dialog", { name: "List a source" })).toBeVisible(); } },
  { path: `${IE}/catalog`, ready: async (p) => { await h1("Catalog")(p); await expect(p.getByRole("grid", { name: "Catalog series" })).toBeVisible(); } },
  // A251: the analytics tabs built so far (Ref. 12d), and one still to come.
  { path: "/desk/analytics/overview", ready: async (p) => { await h1("Analytics")(p); await expect(p.getByRole("heading", { name: "Tuned in at once" })).toBeVisible(); } },
  { path: "/desk/analytics/stations", ready: async (p) => { await h1("Analytics")(p); await expect(p.getByRole("table", { name: "Every station's span" })).toBeVisible(); } },
  { path: "/desk/analytics/stations/00000000-0000-4000-8000-000000097001", ready: async (p) => { await h1("Analytics")(p); await expect(p.getByRole("heading", { name: "Saturday night" })).toBeVisible(); } },
  { path: "/desk/analytics/audience", ready: async (p) => { await h1("Analytics")(p); await expect(p.getByRole("table", { name: "Average tuned in by weekday and hour" })).toBeVisible(); } },
  { path: "/desk/analytics/programs", ready: async (p) => { await h1("Analytics")(p); await expect(p.getByRole("heading", { name: "Late Crate, still watching" })).toBeVisible(); } },
  { path: "/desk/analytics/money", ready: async (p) => { await h1("Analytics")(p); await expect(p.getByRole("heading", { name: "Money" })).toBeVisible(); } },
  { path: "/desk/held-earnings", ready: async (p) => { await h1("Held earnings")(p); await expect(p.getByRole("heading", { name: "Where held money can go" })).toBeVisible(); } },
  { path: "/desk/reserved-call-signs", ready: async (p) => { await h1("Reserved call signs")(p); await expect(p.getByRole("table", { name: "Reserved call signs" })).toBeVisible(); } },
  { path: "/desk/rights-claims", ready: async (p) => { await h1("Rights claims")(p); await expect(p.getByRole("grid", { name: "Open claims" })).toBeVisible(); } },
  { path: "/desk/catalog-sponsors", ready: async (p) => { await h1("Catalog sponsors")(p); await expect(p.getByRole("grid", { name: "Catalog sponsors" })).toBeVisible(); } },
  { path: "/desk/settings", ready: async (p) => { await h1("Settings")(p); await expect(p.getByRole("heading", { name: "Rules" })).toBeVisible(); } },
  { path: "/desk/settings/you", ready: async (p) => { await h1("Settings")(p); await expect(p.getByRole("heading", { name: "Appearance" })).toBeVisible(); } },
  { path: "/desk/no-such-page", ready: h1("There's nothing here.") }
];

for (const ground of ["dark", "light"] as Ground[]) {
  test.describe(`${ground} ground`, () => {
    test("sign-in page, and a wrong code", async ({ page }) => {
      await useGround(page, ground);
      await page.goto("/desk");
      await h1("Sign in to Network desk")(page);
      await settled(page);
      await checkA11y(page, `desk sign-in, ${ground}`);
      await page.getByLabel("Email").fill("dee@opencast.example");
      await page.getByRole("button", { name: "Email me a code" }).click();
      await expect(page.getByText("We sent a code to dee@opencast.example.")).toBeVisible();
      await page.getByLabel("Code").fill("000000");
      await expect(page.getByRole("alert")).toHaveText("That code isn't right. Check the email and try again.");
      await settled(page);
      await checkA11y(page, `desk sign-in with a wrong code, ${ground}`);
    });

    test("not on the team", async ({ page }) => {
      // Signed in as the mock leaves it (signing in through the page has a known bug: see
      // desk.flow.spec.ts, the last test).
      await page.addInitScript(() => localStorage.setItem("oc-mock-signed-in", "sam@example.com"));
      await useGround(page, ground);
      await page.goto("/desk");
      await h1("This desk is for the Opencast team.")(page);
      await expect(page.getByText("You're signed in as sam@example.com, but that account isn't on the team.")).toBeVisible();
      await settled(page);
      await checkA11y(page, `desk not-on-the-team, ${ground}`);
    });

    for (const r of ROUTES) {
      test(r.path, async ({ page }) => {
        await signedInAsAdmin(page);
        await useGround(page, ground);
        await page.goto(r.path);
        await r.ready(page);
        // The rail's counts come in last; the header's avatar says who's signed in.
        await expect(page.getByRole("navigation", { name: "Network desk" })).toBeVisible();
        await settled(page);
        await checkA11y(page, `desk ${r.path}, ${ground}`);
      });
    }
  });
}
