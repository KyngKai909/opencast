// Master control: axe on every route (apps/web/src/control/routes.tsx and each pages/<area>/routes.tsx)
// and the overlays the address opens (?switch=1, ?modal=sign-off, ?rights=), on both grounds, at
// 1280 and in the phone layout (under 768). Ids are the mock's fixtures (apps/web/src/control/mocks).

import { expect, test, type Page } from "@playwright/test";
import { checkA11y, useGround, type Ground } from "../lib/a11y";
import { settle, signInAs, type Who } from "./control.support";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface Route {
  path: string;
  as: Who;
  /** What has to be on the page before axe reads it. */
  shows?: string | RegExp;
}

const kai = (path: string, shows?: string | RegExp): Route => ({ path: `/control/beat${path}`, as: "kai", shows });
const sam = (path: string, shows?: string | RegExp): Route => ({ path: `/control/inland-sound-lab${path}`, as: "sam", shows });

const ROUTES: Route[] = [
  // Outside a station.
  { path: "/control", as: null, shows: "Sign in to Opencast" },
  { path: "/control", as: "new", shows: "Start a station" },
  { path: "/control/new", as: "new", shows: "Your station" },
  { path: "/control/claim/crat-101-9-ready", as: null },
  { path: "/control/claim/crat-101-9-ready", as: "marcus" },
  { path: "/control/nowhere/at/all", as: "kai" },
  // On air.
  kai("/monitor", "Master control"),
  kai("/monitor?switch=1"),
  kai("/monitor?modal=sign-off"),
  // A246: the Schedule, a tab per route.
  kai("/schedule"),
  kai("/schedule?view=week"),
  kai("/schedule/templates"),
  kai("/schedule/blocks"),
  kai("/schedule/blocks/new"),
  kai("/schedule/blocks/00000000-0000-4000-8000-0000000b1001"),
  // A246 phase 4: a block not on the log (its sample preview), a template, a template and the day
  // being edited (block handles, the template's rundown), the dead-air warning's link.
  kai("/schedule/blocks/00000000-0000-4000-8000-0000000b1002"),
  kai(`/schedule/templates/${uid(447002)}`),
  kai(`/schedule/templates/${uid(447001)}?edit=1`),
  kai("/schedule?edit=1"),
  kai("/schedule?day=2026-09-26&fill=2026-09-27T06:40:00.000Z"),
  kai("/schedule/rules"),
  { path: "/control/hall/monitor", as: "kai" },
  // Live and programming.
  kai(`/live-sources`),
  kai(`/live-sources/${uid(260001)}`),
  kai(`/live-sources/${uid(260002)}/rehearse`),
  kai(`/live`),
  kai(`/live/${uid(430002)}`),
  { path: "/control/beat/live", as: "jen" },
  kai(`/listings`),
  kai(`/listings?range=today`),
  kai(`/listings/${uid(430006)}`),
  kai(`/library`),
  kai(`/library/${uid(290001)}`),
  kai(`/library/items/${uid(300015)}`),
  kai(`/library/items/${uid(300015)}?rights=${uid(300015)}`),
  // Market.
  kai(`/market`),
  kai(`/market/catalog`),
  kai(`/market/carried`),
  kai(`/market/offers/${uid(600001)}`),
  kai(`/market/offers/${uid(600001)}/terms`),
  kai(`/market/offers/${uid(600001)}/preview/${uid(610010)}`),
  kai(`/market/offers/${uid(600009)}/carriers`),
  kai(`/market/offered`),
  kai(`/market/offered/requests/${uid(620001)}`),
  kai(`/market/offered/${uid(280002)}/offer`),
  kai(`/schedule/place/${uid(600001)}`),
  // Money.
  kai(`/spot-market`),
  kai(`/spot-market/rotation`),
  kai(`/spot-market/${uid(520001)}`),
  kai(`/spot-market/orders`),
  kai(`/spot-market/orders/${uid(530001)}`),
  kai(`/sponsors`),
  kai(`/sponsors/${uid(540001)}`),
  kai(`/earnings`),
  kai(`/earnings/statements`),
  kai(`/earnings/statements/${uid(630000)}`),
  kai(`/audience`),
  // Station.
  kai(`/settings`),
  ...["identity", "breaks", "sponsorship", "translators", "team", "notifications", "account", "ownership"].map((s) => kai(`/settings/${s}`)),
  kai(`/settings/team/invite`),
  kai(`/translators`),
  kai(`/rights`),
  kai(`/rights/${uid(7_000_001)}`),
  kai(`/rights/${uid(7_000_001)}/answer`),
  // A studio.
  sam(`/programs`),
  sam(`/carriers`),
  sam(`/spot-rotation`),
  sam(`/library`),
  sam(`/market`),
  sam(`/earnings`),
  sam(`/rights`),
  sam(`/settings/identity`)
];

/**
 * Left out of axe, each for its reason (kept in the Phase 9 report):
 * - `.cc-mon__pv`: the Monitor's "Preview, next up" is the next spot's picture (in mock mode a
 *   stand-in card with the business's line on it). Text inside a picture is part of the picture
 *   (WCAG 1.4.3's incidental text), as the player is left out elsewhere.
 * - `.cc-mk-offered__tc--no`: on Offered by BEAT, the faded title card of a program that can't be
 *   offered: decorative (aria-hidden, its title is the row's own text) and part of an inactive row
 *   (1.4.3's inactive component and pure decoration).
 */
const EXCLUDE = [".cc-mon__pv", ".cc-mk-offered__tc--no"];

const SIZES = { web: { width: 1280, height: 820 }, phone: { width: 406, height: 860 } } as const;

async function open(page: Page, r: Route, ground: Ground, size: keyof typeof SIZES) {
  await page.setViewportSize(SIZES[size]);
  await useGround(page, ground);
  await signInAs(page, r.as);
  await page.goto(r.path);
  await expect(page.locator("#root")).not.toBeEmpty();
  if (r.shows) await expect(page.getByText(r.shows).first()).toBeVisible();
  await settle(page);
}

for (const size of ["web", "phone"] as const) {
  for (const ground of ["dark", "light"] as const) {
    test.describe(`${size}, ${ground}`, () => {
      for (const r of ROUTES) {
        test(`${r.path} as ${r.as ?? "nobody"}`, async ({ page }) => {
          await open(page, r, ground, size);
          await checkA11y(page, `${r.path} as ${r.as ?? "nobody"}, ${size}, ${ground}`, { exclude: EXCLUDE });
        });
      }

      // Signing in: the code step (the email step is `/control` as nobody).
      test("signing in, the code", async ({ page }) => {
        await open(page, { path: "/control", as: null, shows: "Sign in to Opencast" }, ground, size);
        await page.getByLabel("Email").fill("kai@example.com");
        await page.getByRole("button", { name: "Email me a code" }).click();
        await expect(page.getByText("We sent a code to kai@example.com.")).toBeVisible();
        await settle(page);
        await checkA11y(page, `sign-in code, ${size}, ${ground}`, { exclude: EXCLUDE });
      });

      // A246: Break rules with unsaved changes (the preview rebuilt), and the question on leaving.
      // On the phone the tab says it's desk work (phase 4), so this is the web's.
      test("/schedule/rules with unsaved changes, and leaving them", async ({ page }) => {
        test.skip(size === "phone", "Break rules are desk work on the phone");
        await open(page, kai("/schedule/rules"), ground, size);
        await page.getByRole("radiogroup", { name: "How often: Thank-you credit" }).getByRole("radio", { name: "Once an hour" }).click();
        await expect(page.getByText("Rebuilt with the rules as set. Nothing is saved yet")).toBeVisible();
        await settle(page);
        await checkA11y(page, `/schedule/rules unsaved, ${size}, ${ground}`, { exclude: EXCLUDE });
        await page.getByRole("tab", { name: "Log" }).click();
        await expect(page.getByRole("dialog", { name: "Leave without saving?" })).toBeVisible();
        await settle(page);
        await checkA11y(page, `/schedule/rules leaving, ${size}, ${ground}`, { exclude: EXCLUDE });
      });

      // A246 phase 4: the block page with a change unsaved and its "Place on the log" menu open (the
      // web), and a break opened as a bottom sheet (the phone).
      test("a block with unsaved changes and its Place on the log menu, or a break as a sheet", async ({ page }) => {
        if (size === "web") {
          await open(page, kai("/schedule/blocks/00000000-0000-4000-8000-0000000b1001", "What it airs"), ground, size);
          await page.getByRole("switch", { name: "Outro" }).click();
          await expect(page.getByText("Unsaved changes. Save keeps them; leaving drops them.")).toBeVisible();
          await page.getByRole("button", { name: "Place Late Crate Nights on the log" }).click();
          await expect(page.getByRole("menu")).toBeVisible();
        } else {
          await open(page, kai("/schedule"), ground, size);
          await page.getByRole("list", { name: "The rundown" }).getByRole("button", { name: /Spots placed at 9:09 pm/ }).click();
          await expect(page.getByRole("dialog", { name: "Break, 9:29:00 pm" })).toBeVisible();
        }
        await settle(page);
        await checkA11y(page, `block page or break sheet, ${size}, ${ground}`, { exclude: EXCLUDE });
      });

      // Setting up a station: someone new starts one on /control/new, then each setup step.
      for (const step of ["station", "library", "log", "translators", "sign-on"]) {
        test(`/setup/:id/${step} as new`, async ({ page }) => {
          await open(page, { path: "/control/new", as: "new", shows: "Your station" }, ground, size);
          await page.getByLabel("Station name").fill("Redlands Tapes");
          await page.getByLabel("Station name").blur();
          await page.waitForURL(/\/setup\/[^/]+\/station/);
          const id = page.url().match(/setup\/([^/]+)/)![1]!;
          await page.goto(`/control/setup/${id}/${step}`);
          await settle(page);
          await checkA11y(page, `/setup/:id/${step}, ${size}, ${ground}`, { exclude: EXCLUDE });
        });
      }
    });
  }
}
