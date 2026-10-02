// The site: one page, axe on all of it, in both grounds, at 1280 and 390. (Replaces the starter
// smoke spec.) The hero's tally switches on with its single flicker (1.6 s) when the page loads;
// axe waits for it to hold, rather than measuring the unlit frames of the flicker.
//
// Both ways of choosing the ground: the system's (no saved choice) and the header's own toggle,
// saved as oc-ground (the toggle sets data-theme, a different path through the tokens).

import { expect, test, type Page } from "@playwright/test";
import { checkA11y, useGround, type Ground } from "../lib/a11y";

/** The tally holds, and nothing else is mid-animation. */
async function settled(page: Page) {
  await expect(page.locator(".oc-tally--switching")).toHaveCount(0);
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity)
  );
}

async function opened(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Television, run by your neighbors." })).toBeVisible();
  await expect(page.getByRole("group", { name: "A sample of the Opencast dial" })).toBeVisible();
  await expect(page.getByRole("img", { name: "On air" })).toBeVisible();
  await settled(page);
}

for (const ground of ["dark", "light"] as Ground[]) {
  for (const width of [1280, 390]) {
    test(`the whole page, ${ground} ground, ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
      await useGround(page, ground);
      await opened(page);
      await expect(page.locator("html")).not.toHaveAttribute("data-theme");
      // The whole page: header, every section, the waitlist form, the FAQ and the footer.
      await expect(page.getByRole("heading", { name: "Questions." })).toBeAttached();
      await checkA11y(page, `site, ${ground}, ${width}`);
    });
  }
}

test("the header's toggle switches the ground, saves it as oc-ground, and the page passes in each", async ({ page }) => {
  await useGround(page, "light");
  await opened(page);
  const toggle = page.getByRole("button", { name: "Dark ground" });
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Light ground" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("oc-ground"))).toBe("dark");
  await settled(page);
  await checkA11y(page, "site, toggled to dark over a light system");

  // Kept across a reload, over the system's light.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Light ground" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("oc-ground"))).toBe("light");
  await settled(page);
  await checkA11y(page, "site, toggled to light");
});

test("under 900px the nav and the toggle go; the waitlist button stays", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await opened(page);
  await expect(page.getByRole("navigation", { name: "Sections" })).toBeHidden();
  await expect(page.getByRole("button", { name: /ground$/ })).toBeHidden();
  await expect(page.getByRole("banner").getByRole("link", { name: "Join the waitlist" })).toBeVisible();
  // No sideways scroll at phone width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
