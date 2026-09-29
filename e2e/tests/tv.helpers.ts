// TV mode's test helpers (tv.*.spec.ts): the device store (localStorage "oc-tv-device"), the
// picture being up, and the mock relay's BroadcastChannel (apps/tv/src/mocks/handlers/remote.ts).

import { expect, type Page } from "@playwright/test";

export const TV_ID = "00000000-0000-4000-8000-0000000c0001";
export const MOCK_CHANNEL = "opencast-cast-mock";
/** The reference frames' moment (VITE_MOCK_CLOCK): Saturday, September 26, 8:42 pm in the Inland Empire. */
export const REFERENCE = "2026-09-27T03:42:00Z";

export interface Start {
  signedIn?: boolean;
  /** First launch: not yet welcomed. */
  firstLaunch?: boolean;
  /** Anything else in the device store (lastStationId, settings…). */
  device?: Record<string, unknown>;
}

/** Opens TV mode at `path` as a TV that's past first launch (or not), signed in (or not). */
export async function openTv(page: Page, path = "/", o: Start = {}) {
  await page.goto("/mock-cast-bridge.html");
  await page.evaluate(
    ({ signedIn, first, device }) => {
      localStorage.clear();
      const d = { welcomed: !first, token: signedIn ? "mock-access-token" : null, signedInAs: signedIn ? "Kai M." : null, ...device };
      localStorage.setItem("oc-tv-device", JSON.stringify(d));
    },
    { signedIn: !!o.signedIn, first: !!o.firstLaunch, device: o.device ?? {} }
  );
  await page.goto(path);
}

/** The picture is up and playing a station. */
export async function playing(page: Page) {
  await expect(page.locator(".oc-player")).toHaveAttribute("data-status", "playing");
}

/** Every web font in, and no running CSS animation or transition (axe reads colours mid-fade otherwise). */
export async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity)).length))
    .toBe(0);
}
