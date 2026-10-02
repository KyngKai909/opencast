// Opencast for business against the real API (playwright.real.config.ts): Maya, signed in with a
// test token, opens Orange Street Coffee and sees its real balance and spots.

import { api, expect, seed, signIn, test } from "../lib/real";

test("Orange Street Coffee shows its real balance and spots", async ({ page }) => {
  const balance = await api<{ availableMicros: number }>(`/businesses/${seed.businesses.orange}/balance`, { as: "maya" });
  const dollars = `$${(balance.availableMicros / 1_000_000).toFixed(2)}`;

  await signIn(page, "maya");
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/${seed.businesses.orange}/`));
  await expect(page.getByText("Orange Street Coffee").first()).toBeVisible();
  await expect(page.getByText(dollars).first()).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Fall menu");
  await expect(page.getByRole("main")).toContainText("Night owl");
});
