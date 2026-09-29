// Master control's helpers for its specs: who's signed in to the mock, and waiting for a page to
// settle (its data loaded, its animations done) before axe or an assertion reads it.

import { expect, type Page } from "@playwright/test";

/** The mock's people (README, Master control): kai owns BEAT, marcus operates it, jen hosts, sam runs a studio. */
export type Who = "kai" | "marcus" | "jen" | "sam" | "new" | null;

export const EMAIL: Record<Exclude<Who, null>, string> = {
  kai: "kai@example.com",
  marcus: "marcus@example.com",
  jen: "jen@example.com",
  sam: "sam@example.com",
  new: "new@example.com"
};

/** Signs the mock in as someone before the app's first script runs (a fresh context, so fresh mock data). */
export async function signInAs(page: Page, who: Who) {
  if (!who) return;
  await page.addInitScript((email) => {
    try {
      localStorage.setItem("oc-mock-control-signed-in", email);
    } catch {
      /* about:blank */
    }
  }, EMAIL[who]);
}

/**
 * Waits until the page has what it's going to show: no loading placeholders (`aria-busy`), no
 * requests in flight to the mock, and every finite animation finished (the tally's single
 * flicker, fades and slides), so axe reads colours as they rest.
 */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => {
      const t = a.effect?.getComputedTiming();
      return a.playState !== "running" || t?.iterations === Infinity;
    })
  );
}
