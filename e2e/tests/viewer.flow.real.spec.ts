// The viewer's flow against the real API (playwright.real.config.ts): first visit (the market from
// where you are, S10), tune in, save a preset (signing in on the way), set a reminder, as a new
// person; Sam changing his pledge; the account's data (A1 sign out everywhere, A2 watch history,
// A3 download and delete); and the permission page's Stop and Claim now (B8).

import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { api, emailOf, expect, seed, signIn, test, tokenFor } from "../lib/real";

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

  // First visit: nothing on this device. "Use my location" in Redlands: the API's market for it (S10).
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 34.0556, longitude: -117.1825 });
  await page.goto("/");
  const market = page.getByRole("dialog", { name: "Where are you tuning in from?" });
  await expect(market).toBeVisible();
  await market.getByRole("button", { name: "Use my location" }).click();
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

/** A new person, signed in, in the Inland Empire (so first visit doesn't ask), whom the API has seen. */
async function newPerson(page: Page, prefix: string) {
  const person = `${prefix}-${Date.now().toString(36)}`;
  const signedIn = await signIn(page, person);
  await api("/me", { token: signedIn.token, method: "PATCH", body: { marketId: seed.markets.inlandEmpire } });
  return { person, ...signedIn };
}

test("sign out everywhere (A1): this device signs out, and the old token is refused", async ({ page }) => {
  const { token } = await newPerson(page, "everywhere");
  await page.goto("/settings/account");
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(toast(page, "Signed out everywhere")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in or create an account" })).toBeVisible();
  const refused = await api<{ error: { code: string } }>("/me", { token, status: 401 });
  expect(refused.error.code).toBe("signed_out");
});

test("watch history (A2): a signed-in heartbeat keeps the last channel; Settings clears it", async ({ page }) => {
  const { token } = await newPerson(page, "history");
  await api("/heartbeat", { token, method: "POST", body: { stationId: seed.stations.beat.id, sessionId: crypto.randomUUID(), platform: "web", mediaTimeMs: 30_000, playing: true } });
  const kept = await api<{ keep: boolean; lastChannel: { station: { callSign: string } } | null }>("/me/watch-history", { token });
  expect(kept.keep).toBe(true);
  expect(kept.lastChannel?.station.callSign).toBe("BEAT");
  // Signed out, a heartbeat keeps nothing for anyone.
  await api("/heartbeat", { method: "POST", body: { stationId: seed.stations.reel.id, sessionId: crypto.randomUUID(), platform: "web", mediaTimeMs: 30_000, playing: true } });
  expect((await api<{ lastChannel: { station: { callSign: string } } | null }>("/me/watch-history", { token })).lastChannel?.station.callSign).toBe("BEAT");

  await page.goto("/settings/privacy");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(toast(page, "Watch history cleared")).toBeVisible();
  expect(await api("/me/watch-history", { token })).toMatchObject({ lastChannel: null, items: [] });
});

test("your data (A3): the emailed link downloads the file", async ({ page }) => {
  const { person } = await newPerson(page, "download");
  const email = emailOf(person);
  await page.goto("/settings/data");
  await page.getByRole("button", { name: "Download" }).click();
  await expect(toast(page, `We emailed a link to ${email}. Open it to download the file.`)).toBeVisible();
  // The link opens here, signed in: the file is made and saved.
  const download = page.waitForEvent("download");
  await page.goto("/settings/data?download=1");
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^opencast-data-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(await readFile((await file.path())!, "utf8")) as { account: { email: string | null } };
  expect(data.account.email).toBe(email);
  await expect(toast(page, "Your data is downloaded")).toBeVisible();
});

test("delete the account (A3): not while Kai owns BEAT, and he's told why", async ({ page }) => {
  await signIn(page, "kai");
  // Kai's account has no market: this device has one, so first visit doesn't ask.
  await page.addInitScript(() => localStorage.setItem("oc-device", JSON.stringify({ marketSlug: "inland-empire" })));
  await page.goto("/settings/data");
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByRole("alert")).toHaveText("You own BEAT 12.1. Make someone on its team the owner in master control first, then delete your account.");
  await expect(page).toHaveURL(/\/settings\/data$/);
  expect((await api<{ displayName: string | null }>("/me", { as: "kai" })).displayName).toBe("Kai M.");
});

test("delete the account (A3): a new person's goes at once, and its token is refused", async ({ page }) => {
  const { token } = await newPerson(page, "leaving");
  await page.goto("/settings/data");
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(toast(page, "Your account is deleted")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  const refused = await api<{ error: { code: string } }>("/me", { token, status: 401 });
  expect(refused.error.code).toBe("account_deleted");
});

/** A new creator the desk has asked (its own, so stopping it leaves the seed's creators alone): the permission page's path. */
async function askedCreator(name: string): Promise<string> {
  const made = await api<{ id: string }>("/admin/creators", {
    as: "dee",
    method: "POST",
    body: { marketId: seed.markets.inlandEmpire, displayName: name, description: "Evening walks", sourcePlatform: "vimeo", sourceUrl: "https://vimeo.com/walks", contactEmail: "walks@example.com" }
  });
  await api(`/admin/creators/${made.id}/works`, { as: "dee", method: "POST", body: [{ title: "Walk one", durationMs: 20 * 60_000, sourceUrl: "https://vimeo.com/1" }], status: 200 });
  const asked = await api<{ link: string }>(`/admin/creators/${made.id}/permission-requests`, { as: "dee", method: "POST", body: { sentVia: ["email"] } });
  return `/permission/${asked.link.split("/permission/")[1]}`;
}

test("the permission page: yes, then Stop from the link (B8)", async ({ page }) => {
  const link = await askedCreator(`Redlands Walks ${Date.now().toString(36)}`);
  await page.goto(link);
  await page.getByRole("button", { name: "Yes, go ahead" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Thanks. We'll set it up.");
  // Stop waits out its Undo toast, then stops.
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stopped.", { timeout: 20_000 });
  const after = await api<{ stoppedAt: string | null }>(`/permission/${link.split("/permission/")[1]}`);
  expect(after.stoppedAt).toBeTruthy();
});

test("the permission page: Claim now, signed in, before the station exists (B8)", async ({ page }) => {
  const link = await askedCreator(`Mentone Walks ${Date.now().toString(36)}`);
  await signIn(page, `walker-${Date.now().toString(36)}`);
  await page.goto(link);
  await page.getByRole("button", { name: "Yes, go ahead" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Thanks. We'll set it up.");
  await page.getByRole("button", { name: "Claim now" }).click();
  await expect(page.getByText("Your claim has started")).toBeVisible();
  const after = await api<{ claim: { status: string } | null }>(`/permission/${link.split("/permission/")[1]}`);
  expect(after.claim?.status).toBe("verifying");
});
