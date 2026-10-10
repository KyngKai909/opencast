// Invite-only sign-ups (added 2026-10-07): someone signed in without a code waits; a code lets
// them in; they make their own on You; a friend comes in through its /join link; the desk makes
// codes and lets people in. Mock mode: addresses at invite.example wait for a code.
import { expect, test, type Page } from "@playwright/test";

async function signInAs(page: Page, email: string) {
  await page.goto("/");
  await page.evaluate((e) => localStorage.setItem("oc-mock-signed-in", e), email);
}

test("waiting, a code, then their own invites; a friend comes in through the link", async ({ page }) => {
  await signInAs(page, "new@invite.example");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Opencast is invite-only for now" })).toBeVisible();
  await page.getByRole("textbox", { name: "Invite code" }).fill("ZZZZ-ZZZZ");
  await page.getByRole("button", { name: "Come in" }).click();
  await expect(page.getByText("That code isn't one of ours. Check it and try again.")).toBeVisible();
  await page.getByRole("textbox", { name: "Invite code" }).fill("open-2026");
  await page.getByRole("button", { name: "Come in" }).click();
  await expect(page.getByRole("heading", { name: "Opencast is invite-only for now" })).toBeHidden();

  // Their own codes, on You.
  await page.goto("/you");
  const invites = page.getByRole("region", { name: "Invite friends" });
  await expect(invites.getByText("10 invites left")).toBeVisible();
  await invites.getByRole("button", { name: "Make an invite" }).click();
  await expect(invites.getByText("9 invites left")).toBeVisible();
  const code = (await invites.locator(".vw-inv__code").first().textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  // A friend opens the link, signed in already, and comes in.
  await page.evaluate(() => localStorage.setItem("oc-mock-signed-in", "friend@invite.example"));
  await page.goto(`/join/${code}`);
  await expect(page.getByRole("heading", { name: /invited you to Opencast|You're invited to Opencast/ })).toBeVisible();
  await page.getByRole("button", { name: "Come in" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Opencast is invite-only for now" })).toHaveCount(0);

  // The code is spent: its link says so now.
  await page.goto(`/join/${code}`);
  await expect(page.getByRole("heading", { name: /You.re already in/ })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("oc-mock-signed-in"));
  await page.goto(`/join/${code}`);
  await expect(page.getByRole("heading", { name: /This invite can.t be used/ })).toBeVisible();
});

test("the desk makes codes, and lets in someone waiting", async ({ page }) => {
  // Someone signs in without a code and waits.
  await signInAs(page, "waiting@invite.example");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Opencast is invite-only for now" })).toBeVisible();

  await page.evaluate(() => localStorage.setItem("oc-mock-signed-in", "dee@opencast.example"));
  await page.goto("/desk/settings/invites");
  await expect(page.getByRole("heading", { name: "Waiting to come in" })).toBeVisible();
  await expect(page.getByText("waiting@invite.example")).toBeVisible();
  await page.getByRole("button", { name: "Let in" }).first().click();
  await expect(page.getByText(/can come in now/)).toBeVisible();

  await page.getByRole("button", { name: "Make codes" }).click();
  const dialog = page.getByRole("dialog", { name: "Make invite codes" });
  await dialog.getByRole("textbox", { name: "How many codes" }).fill("3");
  await dialog.getByRole("textbox", { name: "Uses each" }).fill("");
  await dialog.getByRole("textbox", { name: "Note" }).fill("Launch party");
  await dialog.getByRole("button", { name: "Make them" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("list", { name: "The desk's codes" }).getByText(/Launch party/)).toHaveCount(3);

  // The sign-up rules are under Rules.
  await page.goto("/desk/settings/rules");
  await expect(page.getByText("Invite only", { exact: true }).first()).toBeVisible();
});
