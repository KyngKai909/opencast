// The viewer's flow against the real API (playwright.real.config.ts): first visit, tune in, save a
// preset (signing in on the way), set a reminder, as a new person; Sam changing his pledge; and the
// screens whose endpoints are still only proposed (api/ext/you.ts: A1, A2, A3), which say so in
// words and leave the account as it was.

import type { Page } from "@playwright/test";
import { api, expect, seed, signIn, test, tokenFor } from "../lib/real";

/** Puts a person's test token where the test sign-in reads it, without telling the app: the sign-in steps pick it up. */
async function stashToken(page: Page, person: string) {
  const token = await tokenFor(person, { expiresIn: "2h" });
  await page.evaluate(([t, e]) => {
    localStorage.setItem("oc-dev-token", t);
    localStorage.setItem("oc-dev-email", e);
  }, [token, `${person}@example.com`] as [string, string]);
}

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

test("first visit, tune in, save a preset (sign-in), set a reminder", async ({ page }) => {
  const person = `viewer-flow-${Date.now().toString(36)}`;

  // First visit: nothing on this device.
  await page.goto("/");
  const market = page.getByRole("dialog", { name: "Where are you tuning in from?" });
  await expect(market).toBeVisible();
  // S10 (markets' centres) isn't in the API: the location can't be matched, and it says so.
  await market.getByRole("button", { name: "Use my location" }).click();
  await expect(market.getByRole("alert")).toHaveText("Your location can't be matched to a market yet. Enter a ZIP code or pick a market instead.");
  await market.getByLabel("Or enter a ZIP code").fill("92373");
  await expect(market).toBeHidden();

  // Tune in to BEAT from the dial.
  await page.getByRole("button", { name: /^Tune in to BEAT 12\.1: / }).click();
  await expect(page).toHaveURL(/\/watch\/beat$/);

  // Save it: sign-in asks, named for the action; the test sign-in takes the stashed token.
  await page.getByRole("button", { name: "Add to presets" }).first().click();
  const signInDialog = page.getByRole("dialog", { name: "Sign in to Opencast" });
  await expect(signInDialog).toContainText("save BEAT 12.1 as a preset");
  await stashToken(page, person);
  await signInDialog.getByRole("textbox", { name: "Email" }).fill(`${person}@example.com`);
  await signInDialog.getByRole("textbox", { name: "Email" }).press("Enter");
  const code = page.getByRole("dialog", { name: "Check your email" });
  await expect(code).toBeVisible();
  await code.getByRole("textbox").first().pressSequentially("123456");

  // A new account has no name: one question, then the button that finishes the save.
  const first = page.getByRole("dialog", { name: "You're signed in." });
  await expect(first).toContainText("One thing before you go back to BEAT.");
  await first.getByRole("textbox", { name: "What stations call you" }).fill("Rae P.");
  await first.getByRole("button", { name: "Save BEAT 12.1 and go back" }).click();
  await expect(first).toBeHidden();
  await expect(page.getByRole("button", { name: "Preset 1. Open presets" }).first()).toBeVisible();

  // The account has it, and the name.
  const presets = await api<Array<{ key: number | null; station: { callSign: string } }>>("/me/presets", { as: person });
  expect(presets.map((p) => [p.key, p.station.callSign])).toEqual([[1, "BEAT"]]);
  expect((await api<{ displayName: string | null }>("/me", { as: person })).displayName).toBe("Rae P.");

  // Set a reminder: the next airing on BEAT's page, from its listing.
  await page.goto("/beat");
  const upcoming = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Remind me" }) }).first();
  const title = (await upcoming.getByRole("button").first().innerText()).trim();
  await upcoming.getByRole("button", { name: "Remind me" }).click();
  await expect(toast(page, new RegExp(`^Reminder set for ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, `))).toBeVisible();
  const reminders = await api<Array<{ airing: { title: string } }>>("/me/reminders", { as: person });
  expect(reminders.map((r) => r.airing.title)).toEqual([title]);

  // You lists it.
  await page.goto("/you");
  await expect(page.locator(".vw-y-rem").filter({ hasText: title })).toContainText("BEAT 12.1");
});

test("Sam changes his pledge to Saturday Reel", async ({ page }) => {
  await signIn(page, "sam");
  await page.goto("/you");
  await page.getByRole("button", { name: /Saturday Reel.*Manage|Manage, Saturday Reel/ }).click();
  const manage = page.getByRole("dialog", { name: /Saturday Reel/ });
  await expect(manage).toBeVisible();
  await manage.getByRole("radio", { name: /^\$20/ }).click();
  await manage.getByRole("button", { name: /^Save/ }).click();
  await expect(toast(page, "Your pledge to Saturday Reel is saved")).toBeVisible();
  const pledges = await api<Array<{ amountMicros: number; station: { callSign: string } }>>("/me/pledges", { as: "sam" });
  expect(pledges.find((p) => p.station.callSign === "REEL")?.amountMicros).toBe(20_000_000);
});

test("proposed account endpoints say so and change nothing (A1, A2, A3)", async ({ page }) => {
  await signIn(page, "sam");
  // A route the API doesn't mount answers 404 without its error body: the client says so.
  const said = (p: Page) => p.getByRole("alert").filter({ hasText: "This isn't available yet." });

  // A1: sign out everywhere. Sam stays signed in.
  await page.goto("/settings/account");
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(said(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();

  // A2: clear watch history.
  await page.goto("/settings/privacy");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(said(page)).toBeVisible();
  await expect(toast(page, "Watch history cleared")).toHaveCount(0);

  // A3: download, and delete (confirmed). The account is still there.
  await page.goto("/settings/data");
  await page.getByRole("button", { name: "Download" }).click();
  await expect(said(page)).toBeVisible();
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(said(page)).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/data$/);
  expect((await api<{ displayName: string | null }>("/me", { as: "sam" })).displayName).toBe("Sam T.");
});

test("the permission page's yes works; Stop from the link says it isn't there yet (B8)", async ({ page }) => {
  const asked = await api<{ link: string }>(`/admin/creators/${seed.creators.lupe}/permission-requests`, { as: "dee", method: "POST", body: { sentVia: ["email"], note: "One more look." } });
  await page.goto(`/permission/${asked.link.split("/permission/")[1]}`);
  await page.getByRole("button", { name: "Yes, go ahead" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Thanks. We'll set it up.");
  // Stop waits out its Undo toast, then calls B8's stop, which the API doesn't mount.
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "This isn't available yet." })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Thanks. We'll set it up.");
});
