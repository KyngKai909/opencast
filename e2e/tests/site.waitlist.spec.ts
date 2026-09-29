// The waitlist (S.10, S.11) on the mocks: a station with a free call sign, a taken one, and a
// viewer whose ZIP is outside every market. The mock answers as the API's waitlist module does
// (apps/site/src/mocks/handlers.ts): BEAT, CIVC, REEL, SAZN and NITE are taken; 92373 is in the
// Inland Empire; 10001 is in no market.

import { expect, test, type Page } from "@playwright/test";
import { checkA11y, useGround } from "../lib/a11y";

async function atTheForm(page: Page) {
  await page.goto("/#join");
  await expect(page.getByRole("heading", { name: "Get on the dial." })).toBeVisible();
  await expect(page.getByRole("radio", { name: "A viewer" })).toBeChecked();
  await expect(page.locator(".oc-tally--switching")).toHaveCount(0);
}

const joinButton = (page: Page) => page.locator("form").getByRole("button", { name: "Join the waitlist" });

test("a station with a free call sign: it's held until the market opens", async ({ page }) => {
  await useGround(page, "dark");
  await atTheForm(page);
  await page.getByRole("radio", { name: "A station" }).click();
  const callSign = page.getByLabel("Call sign you'd like");
  await expect(callSign).toBeVisible();
  await expect(page.getByText("Three to five letters. We'll hold it until your market opens.")).toBeVisible();
  await page.getByLabel("Email").fill("owls@example.com");
  await page.getByLabel("ZIP code").fill("92373");
  // Typed as it comes; kept to letters, in capitals.
  await callSign.fill("ow-ls1");
  await expect(callSign).toHaveValue("OWLS");
  await expect(page.getByText("OWLS is free.")).toBeVisible();
  const joined = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/v1/waitlist"));
  await joinButton(page).click();
  expect((await joined).postDataJSON()).toEqual({ role: "station", email: "owls@example.com", zip: "92373", callSign: "OWLS" });
  const done = page.getByRole("heading", { name: "OWLS is on hold for you." });
  await expect(done).toBeVisible();
  await expect(done).toBeFocused();
  await expect(page.getByText("We’ll write when your market opens, and your call sign is held until then.")).toBeVisible();
  await expect(page.locator(".st-done .oc-tally--switching")).toHaveCount(0);
  await checkA11y(page, "site waitlist, station joined");
});

test("a station with a taken call sign: it says so, and nothing is sent", async ({ page }) => {
  await useGround(page, "light");
  await atTheForm(page);
  await page.getByRole("radio", { name: "A station" }).click();
  await page.getByLabel("Email").fill("beat@example.com");
  await page.getByLabel("ZIP code").fill("92373");
  const callSign = page.getByLabel("Call sign you'd like");
  await callSign.fill("BEAT");
  await expect(page.getByText("BEAT is taken. Try another.")).toBeVisible();
  await expect(callSign).toHaveAttribute("aria-invalid", "true");
  let posted = false;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/v1/waitlist")) posted = true;
  });
  await joinButton(page).click();
  await expect(callSign).toBeFocused();
  await expect(page.getByText("BEAT is taken. Try another.")).toBeVisible();
  expect(posted).toBe(false);
  await checkA11y(page, "site waitlist, call sign taken");

  // Another one goes through.
  await callSign.fill("BEATS");
  await expect(page.getByText("BEATS is free.")).toBeVisible();
  await joinButton(page).click();
  await expect(page.getByRole("heading", { name: "BEATS is on hold for you." })).toBeVisible();
});

test("the form says what's missing before anything goes", async ({ page }) => {
  await atTheForm(page);
  await page.getByLabel("ZIP code").fill("923");
  await joinButton(page).click();
  await expect(page.getByLabel("Email")).toBeFocused();
  await expect(page.getByText("Enter an email address")).toBeVisible();
  await expect(page.getByText("A ZIP code is five digits.")).toBeVisible();
  await checkA11y(page, "site waitlist, missing fields");
});

test("a viewer with a ZIP outside every market", async ({ page }) => {
  await useGround(page, "light");
  await atTheForm(page);
  await page.getByLabel("Email").fill("far@example.com");
  // A ZIP+4 keeps its first five.
  await page.getByLabel("ZIP code").fill("10001-2345");
  await expect(page.getByLabel("ZIP code")).toHaveValue("10001");
  await expect(page.getByLabel("Call sign you'd like")).toHaveCount(0);
  const joined = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/v1/waitlist"));
  await joinButton(page).click();
  expect((await joined).postDataJSON()).toEqual({ role: "viewer", email: "far@example.com", zip: "10001" });
  const done = page.getByRole("heading", { name: "You’re on the list." });
  await expect(done).toBeVisible();
  await expect(done).toBeFocused();
  await expect(page.getByText("Your ZIP isn’t in a market yet. We’ll write when a dial opens near you.")).toBeVisible();
  await expect(page.locator(".st-done .oc-tally--switching")).toHaveCount(0);
  await checkA11y(page, "site waitlist, viewer outside every market");
});
