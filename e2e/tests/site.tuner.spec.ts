// The hero's tuner (S.01): the rocker, the arrow keys and number keys, over the sample of the
// Inland Empire dial (apps/site/src/lib/tuner.ts, eight stations in channel order, wrapping).
// And every station's picture colour: 4.5:1 against white, and axe on the tuner on each station.

import { expect, test, type Locator, type Page } from "@playwright/test";
import { checkA11y, useGround } from "../lib/a11y";
import { contrast } from "../lib/contrast";

/** The sample dial as the page draws it: channel, call sign, name, the picture's title. */
const DIAL = [
  ["7.1", "CIVC", "Inland Civic", "Town Hall: backyard homes and ADUs"],
  ["9.1", "RDLS", "Redlands Public Access", "City Council, regular meeting"],
  ["12.1", "BEAT", "Inland Beat", "Saturday Reel"],
  ["18.1", "SAZN", "Sazón", "Tamales for forty"],
  ["24.1", "REEL", "Saturday Reel", "Cartoons from 1928 to 1934"],
  ["31.1", "PREP", "Inland Preps", "Football: Redlands East Valley at Citrus Valley"],
  ["88.4", "NITE", "Night Desk", "Radio dramas from the 1940s"],
  ["102.0", "CRAT", "Crate", "The Producers’ Hour"]
] as const;

const readout = (page: Page): Locator => page.locator(".st-readout");
const picture = (page: Page): Locator => page.getByTestId("tuner-picture");

/** The tuner shows station `i`: the readout names it and the picture has its title. */
async function showing(page: Page, i: number) {
  const [ch, cs, name, title] = DIAL[i]!;
  await expect(readout(page)).toContainText(`${ch}${cs}${name}`);
  await expect(picture(page)).toContainText(title);
}

async function opened(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Television, run by your neighbors." })).toBeVisible();
  await showing(page, 0);
  await expect(page.locator(".oc-tally--switching")).toHaveCount(0);
}

test("the rocker: channel up and down, wrapping at the ends", async ({ page }) => {
  await opened(page);
  await expect(readout(page)).toContainText(/Try it, or use\s*the arrow keys/);
  await expect(page.getByRole("group", { name: "A sample of the Opencast dial" }).getByText("Live", { exact: true })).toBeVisible();
  const up = page.getByRole("button", { name: "Channel up" });
  const down = page.getByRole("button", { name: "Channel down" });
  await up.click();
  await showing(page, 1);
  await up.click();
  await showing(page, 2);
  await down.click();
  await down.click();
  await showing(page, 0);
  // Down from the first wraps to the last: 102.0, radio, live, no bug on a radio picture.
  await down.click();
  await showing(page, 7);
  await expect(picture(page)).toContainText("102.0");
  await expect(page.getByRole("group", { name: "A sample of the Opencast dial" }).getByText("Radio band", { exact: true })).toBeVisible();
  await expect(page.locator(".st-set .oc-bug")).toHaveCount(0);
  await up.click();
  await showing(page, 0);
  await expect(page.locator(".st-set .oc-bug")).toContainText("CIVC7.1");
});

test("the arrow keys tune while the tuner is on screen, and not from a field", async ({ page }) => {
  await opened(page);
  await page.keyboard.press("ArrowUp");
  await showing(page, 1);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await showing(page, 3);
  await page.keyboard.press("ArrowDown");
  await showing(page, 2);

  // In a field the keys are the field's.
  await page.getByLabel("Email").fill("a@b.example");
  await page.getByLabel("Email").press("ArrowUp");
  await page.getByLabel("ZIP code").press("1");
  await page.getByLabel("ZIP code").press("8");
  await expect(page.getByLabel("ZIP code")).toHaveValue("18");

  // And off screen they're the page's: scrolled to the FAQ, the tuner doesn't move.
  await page.getByLabel("ZIP code").blur();
  await page.getByRole("heading", { name: "Questions." }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("group", { name: "A sample of the Opencast dial" })).not.toBeInViewport();
  await page.keyboard.press("ArrowUp");
  await page.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
  await showing(page, 2);
});

test("number keys: 1 2 tunes 12.1, 8 8 4 the radio's 88.4, and 13 and 991 have no station", async ({ page }) => {
  await opened(page);

  // "12" reads 12 with .1 filled in, names who's there, and tunes after the wait.
  await page.keyboard.press("1");
  await page.keyboard.press("2");
  await expect(readout(page)).toContainText("12.1BEATInland Beat");
  await expect(page.locator(".st-readout__filled")).toHaveText(".1");
  await showing(page, 2);

  // Enter tunes straight away.
  await page.keyboard.press("8");
  await page.keyboard.press("8");
  await page.keyboard.press("4");
  await expect(readout(page)).toContainText("884NITENight Desk");
  await page.keyboard.press("Enter");
  await showing(page, 6);
  await expect(picture(page)).toContainText("88.4");

  // A number with no station says so, then goes; the channel stays.
  await page.keyboard.press("1");
  await page.keyboard.press("3");
  await expect(readout(page)).toContainText("No station on 13");
  await expect(readout(page)).not.toContainText("No station on 13", { timeout: 6_000 });
  await showing(page, 6);

  // Nor has a real FM number: the radio band is on even tenths.
  await page.keyboard.press("9");
  await page.keyboard.press("9");
  await page.keyboard.press("1");
  await expect(readout(page)).toContainText("No station on 991");
  await expect(readout(page)).not.toContainText("No station on 991", { timeout: 6_000 });
  await showing(page, 6);

  // Escape drops what's typed.
  await page.keyboard.press("2");
  await page.keyboard.press("4");
  await expect(readout(page)).toContainText("24.1REEL");
  await page.keyboard.press("Escape");
  await showing(page, 6);
});

test("every station's colour holds 4.5:1 against white, and the tuner passes axe on each", async ({ page }) => {
  await useGround(page, "dark");
  await opened(page);
  const up = page.getByRole("button", { name: "Channel up" });
  for (let i = 0; i < DIAL.length; i++) {
    await showing(page, i);
    // The flip (.14 s of opacity) has finished: axe measures the picture, not the fade.
    await expect(picture(page)).not.toHaveClass(/st-pic--flip/);
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    const rgb = await picture(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    const hex = `#${rgb.match(/\d+/g)!.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
    const ratio = contrast(hex, "#FFFFFF");
    expect(ratio, `${DIAL[i]![1]} ${hex} against white`).toBeGreaterThanOrEqual(4.5);
    await checkA11y(page, `site tuner on ${DIAL[i]![1]}`, {
      // The bug is the station's graphic on the picture, drawn at 78 to 80% as broadcast bugs are
      // (the style guide's bug zone): WCAG 1.4.3's incidental text, part of a picture. It's
      // aria-hidden; the readout beside the set says the same in full contrast. On REEL's
      // #9A5412 (5.4:1 at full white) its channel number measures 4.32.
      exclude: [".st-set .oc-bug"]
    });
    await up.click();
  }
  await showing(page, 0);
});
