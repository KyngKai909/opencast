// Every route and screen of TV mode against the real API (playwright.real.config.ts), signed out (a
// TV that registers itself) and signed in (Sam's account, through the code sign-in): each screen
// says what it's for, nothing throws, every answer matches its contract (the client says so in
// the console when one doesn't), and nothing is refused. Routes from apps/tv/src/pages/*/routes.tsx.
//
// No video plays: the harness runs no playout worker (docs/apps/testing.md), so the picture stays
// tuning. The banner, the guide and the menus don't need it.

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../lib/real";
import { answered, openTv, tvSession, watch, type TvSession } from "./tv.real.helpers";

test.use({ colorScheme: "dark" });

interface Visit {
  name: string;
  path: string;
  signedIn?: boolean;
  firstLaunch?: boolean;
  /** Gets from the path to the screen checked. */
  open?: (page: Page) => Promise<void>;
  /** What the screen says once it's up (text, or where to find it). */
  says: string | RegExp | ((page: Page) => Locator);
  /** Where the address ends up (a screen that hands over to another). */
  url?: RegExp;
}

const VISITS: Visit[] = [
  // The first tune brings up the banner (the picture itself never comes: no playout).
  { name: "/ watching, signed out", path: "/", says: (p) => p.locator(".oc-banner").filter({ hasText: "Inland Civic" }) },
  { name: "/ watching, signed in", path: "/", signedIn: true, says: (p) => p.locator(".oc-banner").filter({ hasText: "Inland Civic" }) },
  { name: "/welcome, first launch", path: "/", firstLaunch: true, url: /\/welcome$/, says: "Sign in on your phone." },
  { name: "/radio, the radio band", path: "/radio", url: /\/$/, says: (p) => p.locator(".oc-banner").filter({ hasText: /The Night Desk|Crate/ }) },
  { name: "/menu", path: "/menu", says: "Sleep timer" },
  { name: "/presets, signed out", path: "/presets", says: "Save this channel" },
  { name: "/presets, signed in (Sam's keys)", path: "/presets", signedIn: true, says: (p) => p.locator(".tvw-pt").filter({ hasText: "BEAT" }) },
  { name: "/sleep", path: "/sleep", says: "Turn off after" },
  { name: "/pledge/reel", path: "/pledge/reel", says: "Scan with your phone." },
  // "Now on CIVC 7.1" above the grid needs the picture (the player's current station): no playout here.
  { name: "/guide", path: "/guide", says: (p) => p.getByRole("gridcell", { name: /^On now: Redlands City Council/ }) },
  {
    name: "/guide/options/:airingId",
    path: "/guide",
    open: async (p) => {
      await expect(p.getByRole("gridcell", { selected: true })).toBeVisible();
      await p.keyboard.press("ArrowRight");
      await p.keyboard.press("Enter");
      await expect(p).toHaveURL(/\/guide\/options\//);
    },
    says: "Remind me"
  },
  {
    name: "/guide/options/:airingId, signed in",
    path: "/guide",
    signedIn: true,
    open: async (p) => {
      await expect(p.getByRole("gridcell", { selected: true })).toBeVisible();
      await p.keyboard.press("ArrowRight");
      await p.keyboard.press("Enter");
      await expect(p).toHaveURL(/\/guide\/options\//);
    },
    says: /Remind me|Reminder set/
  },
  { name: "/about/civc", path: "/about/civc", says: /Inland Civic/ },
  { name: "/market", path: "/market", says: "Los Angeles" },
  { name: "/settings/watching", path: "/settings/watching", says: "Caption size" },
  { name: "/settings/remote", path: "/settings/remote", says: "Who on the Wi-Fi can change the channel" },
  { name: "/settings/picture", path: "/settings/picture", says: "Even out the sound" },
  { name: "/settings/account, signed out", path: "/settings/account", says: /Sign in/ },
  { name: "/settings/account, signed in", path: "/settings/account", signedIn: true, says: "Sign out of this TV" },
  { name: "/settings/about", path: "/settings/about", says: "Version" },
  { name: "/?mirror, an iPhone's second screen", path: "/?mirror&device=Sam's iPhone&market=inland-empire", says: "Mirrored from Sam's iPhone" }
];

let sam: TvSession | null = null;

for (const v of VISITS) {
  test(v.name, async ({ page }) => {
    if (v.signedIn) sam ??= await tvSession("sam");
    const w = watch(page);
    await openTv(page, v.path, { session: v.signedIn ? sam! : undefined, firstLaunch: v.firstLaunch });
    if (v.url) await expect(page).toHaveURL(v.url);
    if (v.open) await v.open(page);
    await expect(typeof v.says === "function" ? v.says(page).first() : page.getByText(v.says).first()).toBeVisible();
    await answered(w);
    await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
    for (const r of w.refused) test.info().annotations.push({ type: "refused", description: r });
    expect(w.errors, "page errors").toEqual([]);
    expect(w.mismatched, "responses that don't match their contracts").toEqual([]);
    expect(w.refused, "calls the API refused").toEqual([]);
  });
}
