// axe on every route at three widths: no serious or critical issues (Phase 4).
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { open, WIDTHS } from "./helpers";

type Result = Awaited<ReturnType<AxeBuilder["analyze"]>>;

/** Serious and critical violations, one line a node, with the colours for a contrast failure. */
function serious(r: Result): string[] {
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .flatMap((v) =>
      v.nodes.map((n) => {
        const d = n.any[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined;
        return `${v.id}: ${n.target.join(" ")}${d?.fgColor ? ` (${d.fgColor} on ${d.bgColor}, ${d.contrastRatio})` : ""}`;
      })
    );
}

const ROUTES = ["/", "/run", "/syndication", "/spots", "/network", "/contact", "/no-such-page", "/_kit"];

for (const w of WIDTHS) {
  for (const route of ROUTES) {
    test(`axe ${route} (${w.name})`, async ({ page }) => {
      await page.setViewportSize({ width: w.width, height: w.height });
      await open(page, route);
      await page.waitForTimeout(1800);
      const r = await new AxeBuilder({ page }).analyze();
      expect(serious(r)).toEqual([]);
    });
  }
}

test("axe with the waitlist sheet and the menu open", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/run");
  await page.click("#menuBtn");
  // The menu's links fade in over half a second; scan them once they're there.
  await page.waitForTimeout(800);
  let r = await new AxeBuilder({ page }).include("#mob").analyze();
  expect(serious(r)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.click("[data-claim]");
  await expect(page.locator("#waitlist")).toBeVisible();
  await page.waitForTimeout(800);
  r = await new AxeBuilder({ page }).include("#waitlist").analyze();
  expect(serious(r)).toEqual([]);
});
