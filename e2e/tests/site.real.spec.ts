// The site against the real API (playwright.real.config.ts): joining the waitlist posts to the
// API, which answers with the Inland Empire (seeded, open) and records the signup.

import { api, expect, test } from "../lib/real";

test("joining the waitlist reaches the real API", async ({ page }) => {
  const email = `site-${Date.now()}@example.com`;
  await page.goto("/");
  const form = page.locator("form").filter({ has: page.getByLabel("Email") });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("ZIP code").fill("92373");
  await form.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(page.getByRole("status")).toContainText("The Inland Empire dial is already on.");

  const signups = await api<Array<{ email: string; market: { slug: string } | null }>>("/admin/waitlist", { as: "dee" });
  expect(signups.find((s) => s.email === email)?.market?.slug).toBe("inland-empire");
});
