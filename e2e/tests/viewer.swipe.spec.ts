// The swipe home (A245; viewer/opencast-swipe-home.html), on a phone in mock mode: the app opens on
// the picture; swiping goes through the presets, then the dial (with the detent and "End of your
// presets" at the boundary), a ready station arriving with no static; a tap pauses, Back to live
// returns; next and previous are buttons for screen readers. The Tune pad: "18" is SAZN 18.1 with
// what's on, and tunes 2 seconds later with the full change (static); "45" says there's no station
// and names the nearest; from Guide, "90.8" opens Watch on HALL.

import { expect, test, type Page } from "@playwright/test";
import { useGround } from "../lib/a11y";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** BEAT 12.1 and SAZN 18.1 are this device's presets: the swipe goes BEAT, SAZN, then the dial from CIVC 7.1. */
const PRESETS = [uid(12), uid(18)];

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function seed(page: Page) {
  await page.addInitScript((presets) => {
    if (sessionStorage.getItem("oc-e2e-seeded")) return;
    sessionStorage.setItem("oc-e2e-seeded", "1");
    localStorage.setItem("oc-device", JSON.stringify({ marketSlug: "inland-empire", presets: presets.map((stationId, i) => ({ stationId, key: i + 1 })), reminders: [], settings: {}, lastStationId: null }));
  }, PRESETS);
  await useGround(page, "dark");
}

/**
 * A finger's drag on the picture, stopping before it lets go (so it isn't a flick): up from just
 * above the floating bar, or down from just under the top bar.
 */
async function drag(page: Page, dy: number, o: { release?: boolean } = {}) {
  const y = dy < 0 ? 740 : 150;
  await page.mouse.move(150, y);
  await page.mouse.down();
  await page.mouse.move(150, y + dy, { steps: Math.max(10, Math.round(Math.abs(dy) / 8)) });
  // A pause before letting go: the speed at the end is nothing.
  await page.waitForTimeout(150);
  if (o.release !== false) await page.mouse.up();
}

/** Records whether the tuning static ever appears from now on. */
async function watchForStatic(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __static: boolean };
    w.__static = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="tuning-static"]')) w.__static = true;
    }).observe(document.body, { subtree: true, childList: true });
  });
}
const sawStatic = (page: Page) => page.evaluate(() => (window as unknown as { __static: boolean }).__static);

test("swiping: presets first, then the detent into the dial; a ready picture arrives with no static", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  // The app opens straight onto preset 1, and the URL follows the channel.
  await expect(page).toHaveURL(/\/watch\/beat$/);
  const player = page.locator(".oc-player").first();
  await expect(player).toHaveAttribute("data-status", "playing");
  await expect(page.getByText("Preset 1 of 2", { exact: true })).toBeAttached();
  await expect(page.getByRole("navigation", { name: "Tabs" }).getByRole("link", { name: "Watch" })).toHaveAttribute("aria-current", "page");
  // The first tap gives the sound (Muted previews), and doesn't pause.
  await page.mouse.click(150, 400);
  await expect(player).toHaveAttribute("data-status", "playing");

  // The next preset is kept ready: the swipe shows its picture and lands without static.
  await page.waitForTimeout(2500);
  await watchForStatic(page);
  await drag(page, -320);
  await expect(page).toHaveURL(/\/watch\/sazn$/);
  await expect(page.getByText("Preset 2 of 2", { exact: true })).toBeAttached();
  await expect(player).toHaveAttribute("data-status", "playing");
  expect(await sawStatic(page)).toBe(false);

  // From the last preset into the dial: the detent says so, and a short pull springs back.
  await page.waitForTimeout(1200);
  await drag(page, -320, { release: false });
  await expect(page.locator(".vw-sw__detent")).toContainText("End of your presets");
  await expect(page.locator(".vw-sw__detent")).toContainText("The dial, in channel order");
  await page.mouse.up();
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/watch\/sazn$/);
  // A longer pull goes: the dial's first, CIVC 7.1.
  await drag(page, -700);
  await expect(page).toHaveURL(/\/watch\/civc$/);
  await expect(page.getByText(/^Dial, 1 of \d+$/)).toBeAttached();

  // Sideways does nothing.
  await page.mouse.move(80, 500);
  await page.mouse.down();
  await page.mouse.move(330, 520, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await expect(page).toHaveURL(/\/watch\/civc$/);

  // Down brings back the previous one: the last preset (the detent again, the other way).
  await drag(page, 650);
  await expect(page).toHaveURL(/\/watch\/sazn$/);
});

test("a tap pauses and resumes; Back to live counts how far behind and goes back", async ({ page }) => {
  await seed(page);
  await page.goto("/watch/beat");
  const player = page.locator(".oc-player").first();
  await expect(player).toHaveAttribute("data-status", "playing");
  await page.mouse.click(150, 400); // the sound
  await page.mouse.click(150, 400);
  await expect(player).toHaveAttribute("data-status", "paused");
  await expect(page.getByText(/^Paused at \d+:\d\d [ap]m$/)).toBeVisible();
  const live = page.getByRole("button", { name: /^Back to live, \d+:\d\d behind$/ });
  await expect(live).toBeVisible();
  // The tally goes unlit while paused.
  await expect(page.locator(".oc-banner")).toBeVisible();
  // Taps on the buttons never pause or resume.
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("dialog", { name: "Share" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(player).toHaveAttribute("data-status", "paused");
  await live.click();
  await expect(player).toHaveAttribute("data-status", "playing");
  await expect(page.getByRole("button", { name: /^Back to live/ })).toHaveCount(0);
});

test("next and previous are there for screen readers, named for where they go", async ({ page }) => {
  await seed(page);
  await page.goto("/watch/beat");
  await expect(page.locator(".oc-player").first()).toHaveAttribute("data-status", "playing");
  // From preset 1 the previous wraps to the dial's last.
  await expect(page.getByRole("button", { name: "Previous channel: PREP 31.1" })).toHaveCount(1);
  const next = page.getByRole("button", { name: "Next channel: SAZN 18.1" });
  await next.focus();
  await expect(next).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/watch\/sazn$/);
});

test("the Tune pad: 18 is SAZN 18.1 with what's on, 45 has no station and names the nearest; from Guide, 90.8 opens Watch on HALL", async ({ page }) => {
  await seed(page);
  await page.goto("/watch/beat");
  await expect(page.locator(".oc-player").first()).toHaveAttribute("data-status", "playing");
  await page.mouse.click(150, 400); // the sound

  await page.getByRole("button", { name: "Tune by number" }).click();
  const pad = page.getByRole("dialog", { name: "Tune by number" });
  await expect(pad).toContainText("Type a channel or frequency. It tunes 2 seconds after you stop, or press Tune.");
  await pad.getByRole("button", { name: "4", exact: true }).click();
  await pad.getByRole("button", { name: "5", exact: true }).click();
  await expect(pad).toContainText("No station on 45.1");
  await expect(pad).toContainText("Nearest is PREP 31.1.");
  await expect(pad.getByRole("button", { name: "Tune", exact: true })).toBeDisabled();
  await pad.getByRole("button", { name: "Delete" }).click();
  await pad.getByRole("button", { name: "Delete" }).click();
  await pad.getByRole("button", { name: "1", exact: true }).click();
  await pad.getByRole("button", { name: "8", exact: true }).click();
  await expect(pad).toContainText("SAZN 18.1");
  await expect(pad).toContainText(/Now: Tamales for forty, \d+ min left/);
  // It tunes by itself 2 seconds after the last key, with the full change: the static and the number.
  await expect(page.getByTestId("tuning-static")).toBeVisible({ timeout: 4000 });
  await expect(pad).toBeHidden();
  await expect(page).toHaveURL(/\/watch\/sazn$/);

  // From another tab: the pad tunes and opens Watch on it. A frequency needs no band switch.
  await page.getByRole("link", { name: "Guide" }).click();
  await expect(page.getByRole("heading", { name: "Tonight" })).toBeVisible();
  await page.getByRole("button", { name: "Tune by number" }).click();
  await expect(pad).toBeFocused();
  await page.keyboard.type("90.8");
  await expect(pad).toContainText("HALL 90.8");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/watch\/hall$/);
  await expect(page.getByRole("button", { name: "Radio", pressed: true })).toBeVisible();
});

test("the guide matches the swipe: presets first, then the dial; the old home's sections are under it", async ({ page }) => {
  await seed(page);
  await page.goto("/watch/beat");
  await expect(page.locator(".oc-player").first()).toHaveAttribute("data-status", "playing");
  await page.getByRole("link", { name: "Guide" }).click();
  const heads = page.locator(".oc-guide__sec");
  await expect(heads).toHaveText(["Your presets", "The dial"]);
  const ids = await page.locator(".oc-guide__row").evaluateAll((rows) => rows.slice(0, 3).map((r) => r.getAttribute("aria-label")));
  // (BEAT shares its call sign with 12.2, so its stream's name is in it: A229.)
  expect(ids).toEqual(["BEAT 12.1, Inland Beat", "SAZN 18.1", "CIVC 7.1"]);
  // The station being watched is tinted; the mini player carries on above the bar.
  await expect(page.locator(".oc-guide__row--tuned")).toHaveAttribute("aria-label", "BEAT 12.1, Inland Beat");
  await expect(page.getByRole("region", { name: "Player" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coming up live" })).toBeAttached();
  await expect(page.getByRole("heading", { name: "Radio band" })).toBeAttached();
  // A station's column tunes it in, and Watch opens on it.
  await page.getByRole("button", { name: "Tune in to SAZN 18.1" }).click();
  await expect(page).toHaveURL(/\/watch\/sazn$/);
});
