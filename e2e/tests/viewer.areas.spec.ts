// One app, three areas (apps prompt, "One app, three areas"): the viewer's avatar menu opens master
// control for people with a station role and Network desk for admins, master control's header goes
// "Back to watching", and You's "Run a station" opens master control, all in the same session.

import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 820 } });

async function signedInAs(page: Page, email: string) {
  await page.addInitScript((e) => {
    localStorage.setItem("oc-mock-signed-in", e);
    localStorage.setItem("oc-device", JSON.stringify({ marketSlug: "inland-empire", presets: [], reminders: [], settings: {}, lastStationId: null }));
  }, email);
}

test("a station owner goes from watching to master control and back, signed in once", async ({ page }) => {
  await signedInAs(page, "kai@example.com");
  await page.goto("/");
  await page.getByRole("button", { name: "Kai M." }).click();
  const menu = page.getByRole("menu", { name: "Kai M." });
  await expect(menu.getByRole("menuitem")).toHaveText(["You", "Master control"]);
  await menu.getByRole("menuitem", { name: "Master control" }).click();
  await expect(page).toHaveURL(/\/control\/beat\/monitor$/);
  await expect(page.getByRole("heading", { name: "Sign in to Opencast" })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to watching" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Kai M." })).toBeVisible();
});

test("an admin's menu has Network desk", async ({ page }) => {
  await signedInAs(page, "dee@opencast.example");
  await page.goto("/");
  await page.getByRole("button", { name: "Dee A." }).click();
  await page.getByRole("menu", { name: "Dee A." }).getByRole("menuitem", { name: "Network desk" }).click();
  await expect(page).toHaveURL(/\/desk\/markets\/inland-empire\/board$/);
  await expect(page.getByRole("heading", { level: 1, name: "Inland Empire" })).toBeVisible();
});

test("a viewer with no station: the avatar goes to You, and Run a station opens master control", async ({ page }) => {
  await signedInAs(page, "new@example.com");
  await page.goto("/you");
  await expect(page.getByRole("link", { name: /new@example\.com|^N$/ }).first()).toBeVisible();
  await page.getByRole("link", { name: "Open master control" }).click();
  await expect(page).toHaveURL(/\/control$/);
  await expect(page.getByRole("heading", { name: "Start a station" })).toBeVisible();
});
