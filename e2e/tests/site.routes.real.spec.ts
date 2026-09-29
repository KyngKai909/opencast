// The site against the real API (playwright.real.config.ts): its one page, in both grounds and at
// phone width, with the waitlist form's live call-sign check answering from the API. A page error,
// an error message or a missing heading fails; so does an answer that doesn't match its contract
// (the client says so in the console) or a call the API refuses.

import type { Page } from "@playwright/test";
import { expect, test } from "../lib/real";

function watch(page: Page) {
  const w = { errors: [] as string[], mismatched: [] as string[], refused: [] as string[] };
  page.on("pageerror", (e) => w.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /doesn't match its contract/.test(m.text())) w.mismatched.push(m.text().slice(0, 300));
  });
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.port === "8788" && r.status() >= 400) w.refused.push(`${r.request().method()} ${u.pathname} ${r.status()}`);
  });
  return w;
}

for (const [ground, width] of [["dark", 1280], ["light", 1280], ["dark", 390]] as const) {
  test(`the page, ${ground} ground, ${width}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: ground });
    await page.setViewportSize({ width, height: 900 });
    const w = watch(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Get on the dial." })).toBeVisible();
    // The live check under the call sign asks the API.
    await page.getByRole("radio", { name: "A station" }).click();
    await page.getByLabel("Call sign you'd like").fill("CIVC");
    await expect(page.getByText("CIVC is taken. Try another.")).toBeVisible();
    await page.getByLabel("Call sign you'd like").fill("QZXV");
    await expect(page.getByText("QZXV is free.")).toBeVisible();
    await expect(page.getByText("Something went wrong", { exact: false })).toHaveCount(0);
    for (const r of w.refused) test.info().annotations.push({ type: "refused", description: r });
    expect(w.errors, "page errors").toEqual([]);
    expect(w.mismatched, "responses that don't match their contracts").toEqual([]);
    expect(w.refused, "calls the API refused").toEqual([]);
  });
}
