// The budgets from Phase 4: under 60KB of gzipped JS a page (Lenis included, though the budget
// leaves it out), canvases drawn at no more than twice their CSS size, animated canvases still
// while they're off screen, and no layout shift as the fonts and scripts arrive.
import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { open } from "./helpers";

const ROUTES = ["/", "/run", "/syndication", "/spots", "/network", "/contact", "/no-such-page"];

for (const route of ROUTES) {
  test(`budget ${route}`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
    const sizes: Promise<number>[] = [];
    page.on("response", (r) => {
      if (r.request().resourceType() === "script") sizes.push(r.body().then((b) => gzipSync(b).length, () => 0));
    });
    await page.addInitScript(() => {
      (window as unknown as { cls: number }).cls = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) (window as unknown as { cls: number }).cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await open(page, route);
    await page.waitForTimeout(1500);
    // Scroll the whole page, so lazily loaded chunks and every canvas count.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 50));
      }
    });
    await page.waitForTimeout(600);
    const js = (await Promise.all(sizes)).reduce((a, b) => a + b, 0);
    expect(js, "gzipped JS").toBeLessThan(60 * 1024);
    const over = await page.$$eval("canvas", (cs) => cs.filter((c) => c.clientWidth > 0 && c.width > Math.ceil(c.clientWidth * 2) + 1).map((c) => `${c.id || c.className} ${c.width} for ${c.clientWidth}`));
    expect(over, "canvases over DPR 2").toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { cls: number }).cls), "layout shift").toBeLessThan(0.02);
    await page.close();
  });
}

test("an animated canvas stops drawing off screen and starts again on screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/syndication");
  const frame = () => page.$eval("#wPic", (c) => (c as HTMLCanvasElement).toDataURL());
  const changes = async () => {
    const a = await frame();
    await page.waitForTimeout(400);
    return a !== (await frame());
  };
  await page.locator("#wPic").scrollIntoViewIfNeeded();
  expect(await changes()).toBe(true);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  expect(await changes()).toBe(false);
  await page.locator("#wPic").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  expect(await changes()).toBe(true);
});
