// Station colours hold 4.5:1 against white (rules.md): the swatches both of master control's
// colour pickers offer, and the pickers' rule, measured in the page with the WCAG formula
// (lib/contrast.ts), not the app's own. Every fixture colour is checked in the app's unit tests
// (apps/control/src/mocks/fixtures/colours.test.ts).

import { expect, test, type Page } from "@playwright/test";
import { contrast } from "../lib/contrast";
import { settle, signInAs } from "./control.support";

const WHITE = "#FFFFFF";
/** The ratio the pickers print: to the nearest tenth, and a failing colour never reads 4.5:1. */
const label = (hex: string) => {
  const r = contrast(hex, WHITE);
  const tenth = Math.round(r * 10) / 10;
  return `${(r < 4.5 && tenth >= 4.5 ? 4.4 : tenth).toFixed(1)}:1`;
};

// Colours either side of the line, and the frames' own failing example.
const PASSING = ["#767676", "#8C3B7A", "#1D6A70"];
const FAILING = ["#777777", "#E9A93A", "#6CCFEA"];

test("every picker colour and the rule hold 4.5:1 against white", () => {
  for (const c of PASSING) expect(contrast(c, WHITE), c).toBeGreaterThanOrEqual(4.5);
  for (const c of FAILING) expect(contrast(c, WHITE), c).toBeLessThan(4.5);
});

async function swatches(page: Page, name: RegExp): Promise<string[]> {
  const labels = await page.getByRole("button", { name }).or(page.getByRole("radio", { name })).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  return labels.map((l) => l.match(/#[0-9a-f]{6}/i)![0]!.toUpperCase());
}

test("setting up a station: the swatches pass and the rule matches the formula", async ({ page }) => {
  await signInAs(page, "new");
  await page.goto("/new");
  await expect(page.getByRole("heading", { name: "Your station" })).toBeVisible();
  await settle(page);

  const offered = await swatches(page, /^Colour #[0-9A-F]{6}$/i);
  expect(offered.length).toBeGreaterThanOrEqual(5);
  for (const c of offered) expect(contrast(c, WHITE), `swatch ${c}`).toBeGreaterThanOrEqual(4.5);

  const field = page.getByLabel("Station colour", { exact: true });
  for (const c of PASSING) {
    await field.fill(c);
    await expect(page.getByText(`White text on it reads at ${label(c)}`, { exact: true })).toBeVisible();
  }
  for (const c of FAILING) {
    await field.fill(c);
    await expect(page.getByRole("alert").filter({ hasText: `White text on it reads at ${label(c)}. A station colour needs 4.5:1, so this one can't be saved.` })).toBeVisible();
  }
});

test("station settings: the swatches pass and a failing colour can't be saved", async ({ page }) => {
  await signInAs(page, "kai");
  await page.goto("/beat/settings/identity");
  await expect(page.getByRole("radiogroup", { name: "Station colours" })).toBeVisible();
  await settle(page);

  const offered = await swatches(page, /^#[0-9A-F]{6}$/i);
  expect(offered.length).toBeGreaterThanOrEqual(5);
  for (const c of offered) expect(contrast(c, WHITE), `swatch ${c}`).toBeGreaterThanOrEqual(4.5);
  // BEAT's own plum is chosen.
  await expect(page.getByRole("radio", { name: "#8C3B7A" })).toHaveAttribute("aria-checked", "true");

  const field = page.getByLabel("Colour, as a hex code");
  for (const c of PASSING) {
    await field.fill(c);
    await expect(page.getByText(`White text reads at ${label(c)}`, { exact: true })).toBeVisible();
  }
  for (const c of FAILING) {
    await field.fill(c);
    await expect(page.getByRole("alert").filter({ hasText: `White text reads at ${label(c)}. Station colours need 4.5:1, so this one can't be saved.` })).toBeVisible();
  }
});
