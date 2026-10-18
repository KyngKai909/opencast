// Keyboard: the menu and the sheets keep focus and close on Escape, focus is visible, controls
// work without a mouse; the skip link; reduced motion; and no CSP violations on any page.
import { expect, test } from "@playwright/test";
import { open } from "./helpers";

test("the menu keeps focus and closes on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/spots");
  await page.focus("#menuBtn");
  await page.keyboard.press("Enter");
  await expect(page.locator("#mob")).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("#mob"))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("#mob")).toBeHidden();
  await expect(page.locator("#menuBtn")).toBeFocused();
});

test("the waitlist sheet keeps focus and closes on Escape", async ({ page }) => {
  await open(page, "/network");
  const opener = page.locator("footer .claimc .btn:not(.ghost)");
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#waitlist")).toBeVisible();
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("#waitlist"))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("#waitlist")).toBeHidden();
  await expect(opener).toBeFocused();
});

test("the filter sheet keeps focus and closes on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await open(page, "/syndication");
  await page.locator("#fMob").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#fSheet")).toBeVisible();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("#fSheet"))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("#fSheet")).toBeHidden();
});

test("focus is visible on links and buttons", async ({ page }) => {
  await open(page, "/run");
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip")).toBeFocused();
  for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement!);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), shadow: s.boxShadow };
  });
  expect(outline.style !== "none" || outline.shadow !== "none").toBe(true);
});

test("the skip link moves focus into the page", async ({ page }) => {
  await open(page, "/syndication");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("MAIN");
});

test("controls work from the keyboard: the switchboard, the receipt tabs, the tuner", async ({ page }) => {
  await open(page, "/contact");
  await page.locator('#sbJacks [data-desk="stations"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#sbDesk")).toContainText("Makers desk");
  await open(page, "/spots");
  await page.locator("#rcT0").focus();
  await page.keyboard.press("End");
  await expect(page.locator("#rcS3")).toHaveText("$0.00 paid, $2.00 back");
  await open(page, "/network");
  await page.locator("#tnNext").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#tnScan")).toHaveText("Scan");
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("no smooth scroll, still tickers, still scenes, no cursor", async ({ page }) => {
    await open(page, "/syndication");
    expect(await page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(false);
    expect(await page.evaluate(() => document.body.classList.contains("cursor-on"))).toBe(false);
    const first = await page.textContent("#dlV .dl-v");
    await page.waitForTimeout(4000);
    expect(await page.textContent("#dlV .dl-v")).toBe(first);
    await open(page, "/");
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".crawl .track")!).animationName)).toBe("none");
    // The hero picture draws one still frame: two snapshots a second apart are the same.
    const a = await page.evaluate(() => (document.getElementById("pic") as HTMLCanvasElement).toDataURL());
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => (document.getElementById("pic") as HTMLCanvasElement).toDataURL())).toBe(a);
  });
});

for (const route of ["/", "/run", "/syndication", "/spots", "/network", "/contact", "/no-such-page"]) {
  test(`no console errors or CSP violations on ${route}`, async ({ page }) => {
    const errs: string[] = [];
    page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    page.on("pageerror", (e) => errs.push(e.message));
    // A violation that the page catches (Zod's eval probe was one) never reaches the console.
    await page.exposeFunction("cspViolation", (d: string) => errs.push(`CSP ${d}`));
    await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { cspViolation: (d: string) => void }).cspViolation(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}`)));
    await open(page, route);
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(800);
    expect(errs.filter((e) => !/404 \(Not Found\)/.test(e) || route !== "/no-such-page")).toEqual([]);
  });
}
