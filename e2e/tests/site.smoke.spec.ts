import { expect, test } from "@playwright/test";
import { checkA11y, useGround } from "../lib/a11y";

test("the site opens with its tuner", async ({ page }) => {
  await useGround(page, "dark");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Television");
  await checkA11y(page, "site, dark");
});
