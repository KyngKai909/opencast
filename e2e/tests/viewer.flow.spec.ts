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
const KAI_KEYS = ["BEAT 12.1", "CIVC 7.1", "NITE 88.4", "REEL 24.1", "CRAT 102.0", "HALL 90.8"];

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
      // The key used least is preselected (the API suggests it): "Replace key 3, NITE 88.4".
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

test("an external station says External, and Tuning sound is off until turned on (you 01, home 01)", async ({ page }) => {
  await page.setViewportSize(WIDTHS.web);
  await useGround(page, "dark");
  await page.addInitScript(() => {
    if (sessionStorage.getItem("oc-e2e-set")) return;
    sessionStorage.setItem("oc-e2e-set", "1");
    localStorage.setItem("oc-mock-signed-in", "kai@example.com");
    localStorage.setItem("oc-device", JSON.stringify({ marketSlug: "inland-empire", presets: [], reminders: [], settings: {}, lastStationId: null }));
  });

  // RDLS 9.1 plays the city's own stream: the dashed tag says External, never Listed.
  await page.goto("/");
  await expect(page.locator(".oc-tag--listed").first()).toHaveText("External");
  await expect(page.getByText("Listed", { exact: true })).toHaveCount(0);

  // Watching settings: the frame's row, off by default, kept on the account.
  await page.goto("/settings/watching");
  const sound = page.getByRole("switch", { name: "Tuning sound" });
  await expect(sound).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("A soft hiss when changing channel. Always on for the radio band unless turned off there")).toBeVisible();
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname.endsWith("/me"));
  await sound.click();
  await expect(sound).toHaveAttribute("aria-checked", "true");
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("switch", { name: "Tuning sound" })).toHaveAttribute("aria-checked", "true");
});

test("Not for me: off by default; with the switch on, one vote for what's airing, noted (follow-up Phase 1)", async ({ page }) => {
  await page.setViewportSize(WIDTHS.web);
  await useGround(page, "dark");
  await page.addInitScript(() => {
    if (sessionStorage.getItem("oc-e2e-set")) return;
    sessionStorage.setItem("oc-e2e-set", "1");
    localStorage.setItem("oc-device", JSON.stringify({ marketSlug: "inland-empire", presets: [], reminders: [], settings: {}, lastStationId: null }));
  });

  // Off, as the rules registry starts it: the player has no such control.
  await page.goto("/watch/beat");
  await expect(page.locator(".oc-player")).toHaveAttribute("data-status", "playing");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Not for me/ })).toHaveCount(0);

  // The mock's switch turns it on (as the desk's Settings, Rules, Features would): a quiet button
  // in the player's bar. The vote goes with the heartbeat's session, once.
  const beat = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/heartbeat"));
  await page.goto("/watch/beat?notForMe=on");
  await beat;
  const button = page.getByRole("button", { name: /^Not for me: / });
  await expect(button).toBeVisible();
  const vote = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/not-for-me"));
  await button.click();
  const res = await vote;
  expect(await res.json()).toEqual({ ok: true, status: "recorded" });
  expect(res.request().postDataJSON()).toEqual({ sessionId: expect.any(String) });
  await expect(toast(page, "Noted. Only a count is kept, never who said it.")).toBeVisible();
  await expect(page.getByText("Noted", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Not for me/ })).toHaveCount(0);
});

test("changing channel: the number at once over soft static, then the picture and the banner; a crossfade with reduced motion (follow-up Phase 5)", async ({ page }) => {
  await useGround(page, "dark");
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("oc-device", JSON.stringify({ marketSlug: "inland-empire", presets: [], reminders: [], settings: {}, lastStationId: null })));
  // From 15.3 RIVC (A229: 12.2 is now next up from BEAT 12.1), up to SAZN on 18.1.
  await page.goto("/watch/rivc-15-3");
  const player = page.locator(".oc-player").first();
  await expect(player).toHaveAttribute("data-status", "playing");

  await page.getByRole("button", { name: "Channel up to 18.1" }).first().click();
  // At once: SAZN's number and call sign, top right, over the static; no banner yet.
  await expect(page.locator(".oc-tune__osd")).toHaveText("18.1SAZN");
  await expect(page.getByTestId("tuning-static")).toBeVisible();
  // Then the picture, and the banner slides in once the static has rolled away.
  await expect(page.locator(".oc-banner .oc-banner__cs")).toHaveText("SAZN");
  await expect(page.getByTestId("tuning")).toHaveCount(0);
  await expect(player).toHaveAttribute("data-status", "playing");

  // Reduced motion: no grain, a crossfade with the same corner number.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: /^Channel up to/ }).first().click();
  await expect(page.getByTestId("tuning")).toHaveAttribute("data-look", "fade");
  await expect(page.getByTestId("tuning-static")).toHaveCount(0);
  await expect(page.locator(".oc-tune__osd")).toBeVisible();
  await expect(page.getByTestId("tuning")).toHaveCount(0);
});

// A229: one county's three streams share RIVC on 15; the channel and each stream's name tell them
// apart, and each has its own address.
test("a shared call sign: each stream on its own channel and address, with its own name (A229)", async ({ page }) => {
  await useGround(page, "dark");
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("oc-device", JSON.stringify({ marketSlug: "inland-empire", presets: [], reminders: [], settings: {}, lastStationId: null })));
  await page.goto("/watch/rivc-15-2");
  const banner = page.locator(".oc-banner").first();
  await expect(banner.locator(".oc-banner__ch")).toHaveText("15.2");
  await expect(banner.locator(".oc-banner__cs")).toHaveText("RIVC");
  await expect(banner).toContainText("Riverside County, Public Works");
  await page.getByRole("button", { name: "Channel up to 15.3" }).first().click();
  await expect(banner.locator(".oc-banner__ch")).toHaveText("15.3");
  await expect(banner).toContainText("Riverside County Library Live");
  await expect(page).toHaveURL(/\/watch\/rivc-15-3$/);
  // The call sign alone is X.1's, as before.
  await page.goto("/watch/rivc");
  await expect(page.locator(".oc-banner .oc-banner__ch").first()).toHaveText("15.1");
});
