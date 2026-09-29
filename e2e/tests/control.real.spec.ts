// Master control against the real API (playwright.real.config.ts): Kai, signed in with a test
// token, lands on BEAT's Monitor, which shows the seeded program log.

import { expect, signIn, test } from "../lib/real";

test("Kai's station's Monitor shows its real log", async ({ page }) => {
  await signIn(page, "kai");
  await page.goto("/control");
  await expect(page).toHaveURL(/\/beat\/monitor$/);
  await expect(page.getByRole("heading", { name: "Monitor", level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(/Late Crate|Beat Tape Live/);
  // The seeded sponsorship waits for BEAT's answer.
  await expect(page.getByRole("navigation").getByText("1 new request")).toBeAttached();
});
