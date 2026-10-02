// Network desk against the real API (playwright.real.config.ts): Dee (an Opencast admin), signed
// in with a test token, opens the Inland Empire board with the seeded stations and pipeline.

import { expect, signIn, test } from "../lib/real";

test("the market board shows the real Inland Empire", async ({ page }) => {
  await signIn(page, "dee");
  await page.goto("/desk");
  await expect(page).toHaveURL(/\/markets\/inland-empire\/board$/);
  const main = page.getByRole("main");
  await expect(main).toContainText("5 stations and 1 claimable station on air.");
  // Tía Lupe's Kitchen, until the desk's flow sets her station up (desk.flow.real.spec.ts).
  await expect(main).toContainText(/Creators? who said yes, not set up yet/);
  await expect(main).toContainText("BEAT");
  await expect(main).toContainText("CIVC");
});

test("someone who isn't on the Opencast team is kept out (the API says who's an admin)", async ({ page }) => {
  await signIn(page, "sam");
  await page.goto("/desk");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This desk is for the Opencast team.");
  await expect(page.getByRole("main")).toContainText("You're signed in as sam@example.com");
});
