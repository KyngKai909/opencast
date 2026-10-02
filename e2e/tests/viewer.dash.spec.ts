// A DASH stream link in the viewer (A201), on the mocks: LOMA 9.7 plays the mock DASH stream
// (packages/player/mock/live-dash.mjs) in Opencast's player, from COLT 9.2 (an HLS stream link) and
// back; dash.js is fetched only once LOMA is tuned. And a device with no Media Source (an iPhone
// before iOS 17.1) skips LOMA when changing channel and says so when it's tuned directly.

import { expect, test, type Page } from "@playwright/test";
import { useGround } from "../lib/a11y";

const LOMA_ID = "00000000-0000-4000-8000-000000000097";
const COLT_ID = "00000000-0000-4000-8000-000000000092";

async function start(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await useGround(page, "dark");
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("oc-device", JSON.stringify({ marketSlug: "inland-empire", presets: [], reminders: [], settings: {}, lastStationId: null }));
    localStorage.removeItem("oc-mock-dash-stream-links");
  });
}

/** A picture on screen for the station: its video shown, a frame decoded, and time moving. */
async function pictureOf(page: Page, stationId: string) {
  const video = page.locator(`video[data-station="${stationId}"]`);
  await expect(video).toHaveClass(/is-on/);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth > 0 && v.readyState >= 2 && v.currentTime > 0 && !v.paused)).toBe(true);
}

test("a DASH stream link plays in Opencast's player, and dash.js loads only when it's tuned (A201)", async ({ page }) => {
  const dashJs: string[] = [];
  page.on("request", (r) => {
    // The dash.js chunk: node_modules/.vite/deps/dashjs.js in dev, assets/dash.all.min-*.js built.
    if (/\/dashjs\.js|dash\.all\.min/.test(r.url())) dashJs.push(r.url());
  });
  await start(page);
  const player = page.locator(".oc-player").first();

  // COLT 9.2, an HLS stream link: no dash.js.
  await page.goto("/watch/colt");
  await expect(player).toHaveAttribute("data-status", "playing");
  await pictureOf(page, COLT_ID);
  expect(dashJs).toEqual([]);

  // Up to LOMA 9.7: the static and its number at once, then the DASH picture and the banner.
  await page.getByRole("button", { name: "Channel up to 9.7" }).first().click();
  await expect(page.locator(".oc-tune__osd")).toHaveText("9.7LOMA");
  await expect(page.locator(".oc-banner .oc-banner__cs")).toHaveText("LOMA");
  await expect(player).toHaveAttribute("data-status", "playing");
  await expect(player).toHaveAttribute("aria-busy", "false");
  await pictureOf(page, LOMA_ID);
  expect(dashJs).toHaveLength(1);
  await expect(page.locator(".oc-banner")).toContainText("External");

  // Back down to COLT: HLS again, and LOMA's picture is gone (dash.js torn down).
  await page.getByRole("button", { name: "Channel down to 9.2" }).first().click();
  await expect(page.locator(".oc-banner .oc-banner__cs")).toHaveText("COLT");
  await pictureOf(page, COLT_ID);
  await expect(page.locator(`video[data-station="${LOMA_ID}"]`)).toHaveCount(0);
  expect(dashJs).toHaveLength(1);
});

test("a device that can't play DASH skips it when changing channel, and says so when it's tuned (A201)", async ({ page }) => {
  // No Media Source at all, as on an iPhone before iOS 17.1.
  await page.addInitScript(() => {
    for (const k of ["MediaSource", "ManagedMediaSource", "WebKitMediaSource"]) delete (window as unknown as Record<string, unknown>)[k];
  });
  await start(page);
  await page.goto("/watch/colt");
  // Up from COLT 9.2 skips LOMA 9.7 for BEAT 12.1.
  await expect(page.getByRole("button", { name: "Channel up to 12.1" }).first()).toBeVisible();
  await page.goto("/watch/loma");
  const player = page.locator(".oc-player").first();
  await expect(player).toHaveAttribute("data-status", "unplayable");
  await expect(page.getByTestId("unplayable")).toContainText("Not on this device");
  await expect(page.getByTestId("unplayable")).toContainText("LOMA 9.7's stream is in a format this device can't play. Watch it on a computer or a TV.");
  await expect(page.locator(`video[data-station="${LOMA_ID}"]`)).toHaveCount(0);
});
