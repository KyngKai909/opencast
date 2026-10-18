import { expect, type Page } from "@playwright/test";

export const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "phone", width: 390, height: 844 }
] as const;

/** Load a page and wait for the scripts that make it work. */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
}

/** Fill and send the waitlist sheet, and wait for its answer. */
export async function joinWaitlist(page: Page, email = "kai@example.com", zip = "92373"): Promise<string> {
  await page.fill("#wlEmail", email);
  await page.fill("#wlZip", zip);
  await page.click("#wlGo");
  await expect(page.locator("#wlDone")).toBeVisible();
  return (await page.textContent("#wlDoneH")) ?? "";
}
