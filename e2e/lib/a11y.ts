// Accessibility checks with axe (WCAG 2.2 A and AA), on both grounds. Every route of every app
// goes through checkA11y; a failure lists each rule, how serious it is, and where.

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export type Ground = "dark" | "light";

/** Sets the ground the way the apps read it: the system's colour scheme, and no saved choice. */
export async function useGround(page: Page, ground: Ground) {
  await page.emulateMedia({ colorScheme: ground });
}

export interface A11yOptions {
  /** Rules to leave out on this page, each with the reason (kept in the report). */
  skip?: Record<string, string>;
  /** Parts of the page to leave out (third-party frames, the city's own player). */
  exclude?: string[];
}

export async function checkA11y(page: Page, label: string, o: A11yOptions = {}) {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (o.skip) builder = builder.disableRules(Object.keys(o.skip));
  for (const sel of o.exclude ?? []) builder = builder.exclude(sel);
  const { violations } = await builder.analyze();
  const lines = violations.map((v) => `${v.impact ?? "?"} ${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(lines, `axe on ${label}`).toEqual([]);
}
