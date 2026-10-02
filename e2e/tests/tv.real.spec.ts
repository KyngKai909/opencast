// TV mode against the real API (playwright.real.config.ts): the TV registers, shows its sign-in
// code, Sam approves it (tv.approveTvCode, as the viewer's /tv page does), and the TV opens the dial.

import { approveTvCode, expect, seed, test } from "../lib/real";

test("TV mode signs in by code and shows the real dial", async ({ page }) => {
  await page.goto("/");
  const code = page.getByText(/^[A-Z0-9]{3} [A-Z0-9]{3}$/);
  await expect(code).toBeVisible();
  await approveTvCode((await code.innerText()).replace(/\s/g, ""), "sam");
  // Signed in, the TV goes to the picture; the guide lays out the dial.
  await expect(page).not.toHaveURL(/\/welcome/, { timeout: 20_000 });
  await page.goto("/guide");
  for (const s of [seed.stations.civc, seed.stations.beat, seed.stations.reel]) await expect(page.getByText(s.callSign, { exact: true }).first()).toBeVisible();
});
