// axe on every route of Opencast for business (apps/spots), both grounds, at 1280 and at 406
// wide, including the overlays reached by ?modal= / ?sheet= / ?switch=1, for each role where the
// screens differ. The setup steps and the screens only a flow reaches (a new spot's checks and
// rate, the code modal, raising a budget, accepting a fresh quote) are checked in spots.flow.spec.ts.

import { expect, test } from "@playwright/test";
import { IDS, OSC, PEOPLE, WIDTHS, axeBothGrounds, reducedMotion, signInAs, type Role, type Width } from "./spots.support";

test.use({ actionTimeout: 20_000 });

const B = OSC;
const S = IDS.spots;
const O = IDS.orders;

/** Every screen the owner reaches with the seeded mock. `{o}` is modal on the web, sheet on the phone. */
const OWNER: string[] = [
  `${B}/spots`,
  `${B}/spots?switch=1`,
  `${B}/spots/new`,
  `${B}/spots/${S.fall}`,
  `${B}/spots/${S.pumpkin}`,
  `${B}/spots/${S.colton}`,
  `${B}/spots/${S.summer}`,
  `${B}/sponsorships`,
  `${B}/sponsorships?{o}=sponsorship&id=${IDS.sponsorship}`,
  `${B}/sponsorships/new`,
  `${B}/orders`,
  `${B}/orders/new`,
  `${B}/orders/${O.giftCards}`,
  `${B}/orders/${O.giftCards}?{o}=accept`,
  `${B}/orders/${O.brunch}`,
  `${B}/orders/${O.colton}`,
  `${B}/orders/${O.fallMenu}`,
  `${B}/results`,
  `${B}/results/airings`,
  `${B}/results/airings/${IDS.airing}`,
  `${B}/results/codes/ORANGE10`,
  `${B}/balance`,
  `${B}/balance?{o}=add`,
  `${B}/balance?{o}=withdraw`,
  `${B}/balance/statements`,
  `${B}/balance/statements/${IDS.statement}`,
  `${B}/redeem`,
  `${B}/settings`,
  `${B}/settings/business`,
  `${B}/settings/business?{o}=location`,
  `${B}/settings/team`,
  `${B}/settings/team?{o}=invite`,
  `${B}/settings/money`,
  `${B}/settings/notifications`,
  `${B}/settings/connections`,
  `${B}/settings/close`,
  `${B}/nothing-here`,
  `/nothing-here`
];

/** Where a manager's screens differ from the owner's: money and settings they read, not change. */
const MANAGER: string[] = [
  `${B}/spots`,
  `${B}/orders/${O.giftCards}?{o}=accept`,
  `${B}/balance`,
  `${B}/balance?{o}=add`,
  `${B}/settings`,
  `${B}/settings/business`,
  `${B}/settings/team`,
  `${B}/settings/money`,
  `${B}/settings/connections`
];

/** A viewer (the bookkeeper): results and statements; the rest is closed to them. */
const VIEWER: string[] = [
  `${B}/results`,
  `${B}/results/airings`,
  `${B}/results/codes/ORANGE10`,
  `${B}/spots`,
  `${B}/spots/${S.fall}`,
  `${B}/sponsorships`,
  `${B}/orders`,
  `${B}/orders/${O.giftCards}`,
  `${B}/redeem`,
  `${B}/balance`,
  `${B}/balance/statements`,
  `${B}/settings`,
  `${B}/settings/business`,
  `${B}/settings/team`,
  `${B}/settings/money`,
  `${B}/settings/notifications`
];

const ROUTES: Record<Role, string[]> = { owner: OWNER, manager: MANAGER, viewer: VIEWER };

for (const role of Object.keys(ROUTES) as Role[]) {
  for (const width of Object.keys(WIDTHS) as Width[]) {
    test(`axe: ${role} at ${WIDTHS[width].width} wide`, async ({ page }) => {
      test.setTimeout(ROUTES[role].length * 12_000);
      await page.setViewportSize(WIDTHS[width]);
      await reducedMotion(page);
      await signInAs(page, PEOPLE[role]);
      const failures: string[] = [];
      for (const route of ROUTES[role]) {
        const url = route.replace("{o}", width === "phone" ? "sheet" : "modal");
        await page.goto(url);
        failures.push(...(await axeBothGrounds(page, `${role} ${width} ${url}`)));
      }
      expect(failures, failures.join("\n\n")).toEqual([]);
    });
  }
}

test("axe: signing in, both widths", async ({ page }) => {
  await reducedMotion(page);
  const failures: string[] = [];
  for (const width of Object.keys(WIDTHS) as Width[]) {
    await page.setViewportSize(WIDTHS[width]);
    await page.goto("/");
    await expect(page.getByLabel("Email")).toBeVisible();
    failures.push(...(await axeBothGrounds(page, `sign in ${width}`)));
    await page.getByLabel("Email").fill(PEOPLE.owner);
    await page.getByLabel("Email").press("Enter");
    await expect(page.getByLabel("Code").first()).toBeVisible();
    failures.push(...(await axeBothGrounds(page, `sign in, the code ${width}`)));
  }
  expect(failures, failures.join("\n\n")).toEqual([]);
});

test("axe: someone new accepting an invite, both widths", async ({ page }) => {
  await reducedMotion(page);
  await signInAs(page, "sam@orangestreet.example");
  const failures: string[] = [];
  for (const width of Object.keys(WIDTHS) as Width[]) {
    await page.setViewportSize(WIDTHS[width]);
    await page.goto(`/invites/${IDS.invite}`);
    failures.push(...(await axeBothGrounds(page, `invite ${width}`)));
  }
  expect(failures, failures.join("\n\n")).toEqual([]);
});

test("axe: the phone's menu, owner and viewer", async ({ page }) => {
  await page.setViewportSize(WIDTHS.phone);
  await reducedMotion(page);
  const failures: string[] = [];
  for (const role of ["owner", "viewer"] as Role[]) {
    await page.context().clearCookies();
    await page.addInitScript((e) => localStorage.setItem("oc-mock-spots-signed-in", e), PEOPLE[role]);
    await page.goto(`${B}/results`);
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("link", { name: "Balance" })).toBeVisible();
    failures.push(...(await axeBothGrounds(page, `${role} phone menu`)));
  }
  expect(failures, failures.join("\n\n")).toEqual([]);
});
