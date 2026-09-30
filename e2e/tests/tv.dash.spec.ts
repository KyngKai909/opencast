// A DASH stream link on the TV (A201), on the mocks: 9 . 7 tunes LOMA, which plays the mock DASH
// stream in Opencast's player (dash.js, fetched only then), and ▼ from there is COLT 9.2's HLS.

import { expect, test } from "@playwright/test";
import { openTv, playing } from "./tv.helpers";

const LOMA_ID = "00000000-0000-4000-8000-000000000097";

test("tunes a DASH stream link by number, plays it, and changes channel back to HLS (A201)", async ({ page }) => {
  const dashJs: string[] = [];
  page.on("request", (r) => {
    if (/\/dashjs\.js|dash\.all\.min/.test(r.url())) dashJs.push(r.url());
  });
  await openTv(page, "/");
  await playing(page);
  expect(dashJs).toEqual([]);

  for (const k of ["9", ".", "7"]) await page.keyboard.press(k);
  await page.keyboard.press("Enter");
  const banner = page.locator(".oc-banner");
  await expect(banner.locator(".oc-banner__cs")).toHaveText("LOMA");
  await expect(banner).toContainText("External");
  await playing(page);
  const video = page.locator(`video[data-station="${LOMA_ID}"]`);
  await expect(video).toHaveClass(/is-on/);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth > 0 && v.currentTime > 0 && !v.paused)).toBe(true);
  expect(dashJs).toHaveLength(1);

  // ▼: COLT 9.2, an HLS stream link; LOMA's picture is let go.
  await page.keyboard.press("ArrowDown");
  await expect(banner.locator(".oc-banner__cs")).toHaveText("COLT");
  await playing(page);
  await expect(video).toHaveCount(0);
});
