// The viewer's flow (apps prompt, Phase 9): first visit, tune in, save a preset (signing in on the
// way), set a reminder. On the mocks (dev:mock): sign-in takes any six digits but 000000, and the
// email picks the person in the app's one mock world: kai@example.com is the reference's Kai M.,
// whose six keys are all taken (someone new would be asked their name first).
// Copy is the frames': viewer/opencast-home.html 08.1 (first visit), opencast-you.html 01 (sign-in)
// and 03.1 (all six keys taken), opencast-station-pages.html (Remind me).

import { expect, test, type Page } from "@playwright/test";
import { useGround } from "../lib/a11y";

const WIDTHS = { web: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } } as const;

/** Kai's six keys in the mock (mocks/db.ts, from you 02.1 and 03.1). */
const KAI_KEYS = ["BEAT 12.1", "CIVC 7.1", "NITE 88.3", "REEL 24.1", "CRAT 101.9", "HALL 90.7"];

/** The toast that confirms an action (role status), by its words. */
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

for (const width of ["web", "phone"] as const) {
  test.describe(width, () => {
    test.use({ viewport: WIDTHS[width] });

    test("first visit, tune in, save a preset (sign-in), set a reminder", async ({ page }) => {
      await useGround(page, "dark");

      // First visit: nothing on this device, so the market question comes first and can't be closed.
      await page.goto("/");
      const market = page.getByRole("dialog", { name: "Where are you tuning in from?" });
      await expect(market).toBeVisible();
      await expect(market).toContainText("Your market decides which stations come first on your dial.");
      await expect(market.getByRole("button", { name: "Use my location" })).toBeVisible();
      await expect(market.getByRole("button", { name: /^Close/ })).toHaveCount(0);
      const zip = market.getByLabel("Or enter a ZIP code");
      await zip.fill("1234");
      await zip.press("Enter");
      await expect(market).toContainText("Enter a five-digit ZIP code.");
      // A ZIP outside every market says so and points to the others.
      await zip.fill("10001");
      await expect(market).toContainText("10001 isn't in a market yet.");
      // Redlands' ZIP is in the Inland Empire: five digits look it up without a button.
      await zip.fill("92373");
      await expect(market).toBeHidden();
      await expect(page.getByRole("button", { name: /Inland Empire/ }).first()).toBeVisible();

      // Tune in: PREP 31.1 from the dial.
      await page.getByRole("button", { name: "Tune in to PREP 31.1: Football: Redlands East Valley at Citrus Valley" }).click();
      await expect(page).toHaveURL(/\/watch\/prep$/);
      await expect(page.getByRole("heading", { name: "Football: Redlands East Valley at Citrus Valley" }).first()).toBeVisible();

      // Save it as a preset: signed out, sign-in asks, named for the action.
      await page.getByRole("button", { name: "Add to presets" }).first().click();
      const signIn = page.getByRole("dialog", { name: "Sign in to Opencast" });
      await expect(signIn).toBeVisible();
      await expect(signIn).toContainText("save PREP 31.1 as a preset");
      await signIn.getByRole("textbox", { name: "Email" }).fill("kai@example.com");
      await signIn.getByRole("textbox", { name: "Email" }).press("Enter");
      const code = page.getByRole("dialog", { name: "Check your email" });
      await expect(code).toBeVisible();
      await expect(code).toContainText("kai@example.com");
      // 000000 is the mock's wrong code.
      await code.getByRole("textbox").first().pressSequentially("000000");
      await expect(code).toContainText("That code didn't work. Check it, or send a new one.");
      await code.getByRole("textbox").first().fill("");
      await code.getByRole("textbox").first().pressSequentially("482913");

      // Signed in, the save finishes; Kai's six keys are all taken, so it asks which key.
      const replace = page.getByRole("dialog", { name: "Where should PREP 31.1 go?" });
      await expect(replace).toBeVisible();
      await expect(replace).toContainText("All six keys are taken");
      // The key used least is preselected (the API suggests it): "Replace key 3, NITE 88.3".
      const chosen = replace.getByRole("radio", { checked: true });
      await expect(chosen).toHaveCount(1);
      let key = 0;
      for (let k = 1; k <= 6 && !key; k++) if (await replace.getByRole("radio", { name: new RegExp(`^Replace key ${k}, ${KAI_KEYS[k - 1]}`), checked: true }).count()) key = k;
      expect(key, "a key is preselected").toBeGreaterThan(0);
      const displaced = KAI_KEYS[key - 1]!.split(" ")[0]!;
      await replace.getByRole("button", { name: "Save PREP 31.1" }).click();
      await expect(replace).toBeHidden();
      await expect(toast(page, `PREP 31.1 is on key ${key}. ${displaced} moved to More presets.`)).toBeVisible();
      await expect(page.getByRole("button", { name: `Preset ${key}. Open presets` }).first()).toBeVisible();

      // Presets has it on that key, and the station it replaced in More presets.
      await page.goto("/presets");
      await expect(page.getByRole("button", { name: `Key ${key}, PREP 31.1. Tune in` })).toBeVisible();
      await expect(page.locator("section", { has: page.getByRole("heading", { name: "More presets" }) }).first()).toContainText(displaced);

      // Set a reminder: Late Crate, from Inland Beat's page.
      await page.goto("/beat");
      // The listing opens from its title (the phone's week has no bell beside each row).
      await page.getByRole("button", { name: "Late Crate, ep. 15" }).click();
      const listing = page.getByRole("dialog", { name: /Late Crate, ep\. 15/ });
      await expect(listing).toBeVisible();
      await listing.getByRole("button", { name: /^Remind me/ }).click();
      await expect(toast(page, /^Reminder set for Late Crate, ep\. 15, 10:00/)).toBeVisible();

      // You lists it with the others.
      await page.goto("/you");
      const row = page.locator(".vw-y-rem").filter({ hasText: "Late Crate, ep. 15" });
      await expect(row).toContainText("10:00 pm");
      await expect(row).toContainText("BEAT 12.1");
    });
  });
}
