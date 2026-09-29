// Shared by the business app's specs (apps/business on its mock, :5181): who signs in, the mock's
// ids, and waiting for a screen to settle before axe reads it.

import { expect, type Page } from "@playwright/test";
import { checkA11y, useGround, type A11yOptions, type Ground } from "../lib/a11y";

export const PEOPLE = {
  owner: "jess@orangestreet.example",
  manager: "tomas@orangestreet.example",
  viewer: "ana@ledgerline.example"
} as const;
export type Role = keyof typeof PEOPLE;

/** The mock's ids (apps/business/src/mocks/fixtures). */
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const OSC = `/${uid(60001)}`;
export const IDS = {
  spots: { fall: uid(64001), pumpkin: uid(64002), colton: uid(64003), summer: uid(64004) },
  sponsorship: uid(66001),
  orders: { giftCards: uid(67001), brunch: uid(67002), colton: uid(67003), fallMenu: uid(67004) },
  airing: uid(700001),
  statement: uid(66001),
  invite: uid(65001)
};

export const WIDTHS = { web: { width: 1280, height: 900 }, phone: { width: 406, height: 880 } } as const;
export type Width = keyof typeof WIDTHS;

/** Signs in the way the mock remembers it (the sign-in screen itself is covered by the flow). */
export async function signInAs(page: Page, email: string) {
  await page.addInitScript((e) => {
    if (!sessionStorage.getItem("oc-e2e-signed")) {
      localStorage.setItem("oc-mock-spots-signed-in", e);
      sessionStorage.setItem("oc-e2e-signed", "1");
    }
  }, email);
}

/** Waits for the page to stop loading and every finite animation to finish. */
export async function settle(page: Page) {
  await expect(page.locator("#root > *").first()).toBeAttached();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => {
      const t = a.effect?.getComputedTiming();
      return a.playState !== "running" || t?.iterations === Infinity;
    })
  );
}

/** axe on the current screen in both grounds; returns the failures instead of stopping. */
export async function axeBothGrounds(page: Page, label: string, o?: A11yOptions): Promise<string[]> {
  const failures: string[] = [];
  for (const ground of ["dark", "light"] as Ground[]) {
    await useGround(page, ground);
    await settle(page);
    try {
      await checkA11y(page, `${label}, ${ground}`, o);
    } catch (e) {
      // eslint-disable-next-line no-control-regex
      const text = (e as Error).message.replace(/\u001b\[[0-9;]*m/g, "");
      failures.push(text.split("\n").filter((l) => /axe on|^\s*\+\s+"/.test(l)).join("\n"));
    }
  }
  return failures;
}

export async function reducedMotion(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
}
