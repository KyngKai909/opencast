// axe on every viewer route and overlay (routes.tsx), in both grounds, at 1280 (the web shell) and
// at 390 (the phone shell, a different tree). Signed in as the mock's Kai unless a visit says
// otherwise; every visit starts on a fresh device with the Inland Empire chosen (first visit aside).

import { expect, test, type Locator, type Page } from "@playwright/test";
import { checkA11y, useGround, type A11yOptions, type Ground } from "../lib/a11y";
// TV mode's dev:mock server (playwright.config.ts PORTS.tv), started with the web project.

const WIDTHS = { web: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } } as const;
type Width = keyof typeof WIDTHS;

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Saturday Reel's program id (fixtures/schedule.ts, P("saturday-reel")). */
const SATURDAY_REEL = uid(774878);
const PREP = uid(31);
const TV_URL = "http://localhost:5175";

interface Visit {
  name: string;
  path: string;
  /** Default true: Kai, signed in. */
  signedIn?: boolean;
  /** Default true: the Inland Empire is on this device. False is a first visit. */
  market?: boolean;
  only?: Width;
  /** TV mode's receiver open beside the viewer, and the phone casting to it. */
  casting?: boolean;
  /** Gets from the path to the thing checked (a click that opens an overlay). */
  open?: (page: Page, width: Width) => Promise<void>;
  /** What the screen says once it's there. */
  sees: (page: Page, width: Width) => Locator;
  a11y?: A11yOptions;
}

const heading = (name: string | RegExp) => (p: Page) => p.getByRole("heading", { name }).first();
/** The phone's home is the picture (A245, the swipe home): its Tune button is there whatever's on. */
const swipeHome = (p: Page) => p.getByRole("button", { name: "Tune by number" });
const onWeb = (web: (p: Page) => Locator) => (p: Page, width: Width) => (width === "web" ? web(p) : swipeHome(p));
const dialog = (name: string | RegExp) => (p: Page) => p.getByRole("dialog", { name });

const VISITS: Visit[] = [
  { name: "home", path: "/", sees: onWeb(heading(/Town Hall/)) },
  { name: "home, signed out", path: "/", signedIn: false, sees: onWeb(heading(/Town Hall/)) },
  { name: "first visit", path: "/", signedIn: false, market: false, sees: dialog("Where are you tuning in from?") },
  { name: "market picker", path: "/?modal=market", sees: dialog("Where are you tuning in from?") },
  { name: "radio band", path: "/radio", sees: (p, width) => (width === "web" ? heading("Radio band")(p) : p.getByRole("button", { name: "Radio", pressed: true })) },
  { name: "tuned in, TV", path: "/watch/civc", sees: heading(/Town Hall/) },
  { name: "tuned in, radio", path: "/watch/nite", sees: heading(/Radio dramas/) },
  {
    name: "carried from",
    path: "/watch/beat",
    only: "web",
    open: async (p) => p.getByRole("button", { name: "Carried from REEL 24.1" }).first().click(),
    sees: dialog(/Saturday Reel|Carried/)
  },
  // The phone's swipe home has no carried-from line to press: the modal by its address.
  { name: "carried from, phone", path: `/watch/beat?modal=carried&program=${SATURDAY_REEL}`, only: "phone", sees: dialog(/Saturday Reel|Carried/) },
  { name: "pledge", path: "/watch/beat?modal=pledge&station=BEAT", sees: dialog("Pledge to Inland Beat") },
  { name: "tune pad", path: "/watch/beat?sheet=tune", only: "phone", sees: dialog("Tune by number") },
  { name: "share", path: "/watch/beat?modal=share&station=BEAT", sees: dialog("Share") },
  { name: "watch on", path: "/watch/civc?sheet=watch-on", only: "phone", sees: dialog("Watch on") },
  { name: "guide", path: "/guide", sees: heading("Tonight") },
  {
    name: "guide listing",
    path: "/guide",
    open: async (p) => p.getByRole("button", { name: /^Beat Tape Live/ }).first().click(),
    sees: dialog(/Beat Tape Live/)
  },
  { name: "search overlay", path: "/?q=beat", only: "web", sees: heading("Programs") },
  { name: "search page", path: "/search?q=beat", only: "phone", sees: heading("Programs") },
  { name: "search, empty", path: "/search", only: "phone", sees: (p) => p.getByRole("searchbox").or(p.getByRole("textbox")).first() },
  { name: "station preview", path: "/?station=CIVC", sees: dialog("Inland Civic") },
  { name: "program", path: `/program/${SATURDAY_REEL}`, sees: heading("Saturday Reel") },
  { name: "station", path: "/beat", sees: (p) => p.getByText("Inland Beat").first() },
  { name: "station, pledge", path: "/beat/pledge", sees: dialog("Pledge to Inland Beat") },
  { name: "station, claimable", path: "/crat", sees: (p) => p.getByText("Crate").first() },
  { name: "station, listed", path: "/rdls", sees: (p) => p.getByText("Redlands Public Access").first() },
  { name: "station, unknown", path: "/nobody", sees: (p) => p.getByRole("main") },
  { name: "not found", path: "/a/b/c", sees: (p) => p.getByRole("main") },
  { name: "presets", path: "/presets", sees: heading("More presets") },
  { name: "presets, signed out", path: "/presets", signedIn: false, sees: heading("Presets") },
  { name: "replace key", path: `/presets?modal=replace-key&station=${PREP}`, sees: dialog("Where should PREP 31.1 go?") },
  { name: "you", path: "/you", sees: heading("Reminders") },
  { name: "you, signed out", path: "/you", signedIn: false, sees: (p) => p.getByRole("main") },
  {
    name: "sign in, email",
    path: "/you",
    signedIn: false,
    open: async (p) => p.getByRole("button", { name: /^Sign in/ }).first().click(),
    sees: dialog("Sign in to Opencast")
  },
  {
    name: "sign in, code",
    path: "/you",
    signedIn: false,
    open: async (p) => {
      await p.getByRole("button", { name: /^Sign in/ }).first().click();
      await p.getByRole("textbox", { name: "Email" }).fill("test@example.com");
      await p.getByRole("textbox", { name: "Email" }).press("Enter");
    },
    sees: dialog("Check your email")
  },
  {
    name: "managing a pledge",
    path: "/you",
    // "Manage, Inland Beat" on the web; "Inland Beat, $10.00 a month. Manage" on the phone.
    open: async (p) => p.getByRole("button", { name: /Inland Beat.*Manage|Manage, Inland Beat/ }).click(),
    sees: dialog(/Inland Beat/)
  },
  { name: "settings", path: "/settings", sees: heading("Settings") },
  ...["account", "market", "watching", "notifications", "tvs", "appearance", "privacy", "data"].map(
    (s): Visit => ({ name: `settings, ${s}`, path: `/settings/${s}`, sees: (p) => p.getByRole("main") })
  ),
  { name: "settings, signed out", path: "/settings/account", signedIn: false, sees: (p) => p.getByRole("main") },
  { name: "remote, not casting", path: "/remote", sees: heading("Not casting") },
  { name: "remote, casting", path: "/remote?tv=Living%20room%20TV", casting: true, sees: (p) => p.getByRole("button", { name: /Keypad/i }) },
  {
    name: "remote, keypad",
    path: "/remote?tv=Living%20room%20TV",
    casting: true,
    open: async (p) => p.getByRole("button", { name: /Keypad/i }).click(),
    sees: (p) => p.getByRole("button", { name: "Done" })
  },
  { name: "mirror guide", path: "/remote/mirror-guide", sees: dialog("Watch on the TV") },
  { name: "tv code", path: "/tv", sees: heading("Add a TV") },
  { name: "permission, unanswered", path: "/permission/desert-skate-films-2026-0926", signedIn: false, sees: heading(/A station of your films/) },
  { name: "permission, said yes", path: "/permission/desert-skate-films-said-yes", signedIn: false, sees: heading("Thanks. We'll set it up.") },
  { name: "permission, set up", path: "/permission/tia-lupes-kitchen-2026-0922", signedIn: false, sees: heading("Thanks. We'll set it up.") }
];

/** Nothing loading and nothing moving: skeletons gone, fonts in, every finite animation finished. */
async function settle(page: Page) {
  await expect(page.locator('[aria-busy="true"]:visible')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finite = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
}

test.describe.configure({ mode: "parallel" });
test.use({ reducedMotion: "reduce" });

for (const width of ["web", "phone"] as const) {
  for (const ground of ["dark", "light"] as Ground[]) {
    test.describe(`${width}, ${ground}`, () => {
      test.use({ viewport: WIDTHS[width] });
      for (const v of VISITS) {
        if (v.only && v.only !== width) continue;
        test(v.name, async ({ page, context }) => {
          await context.addInitScript(
            ({ signedIn, market }) => {
              if (sessionStorage.getItem("oc-e2e-seeded")) return;
              sessionStorage.setItem("oc-e2e-seeded", "1");
              if (signedIn) localStorage.setItem("oc-mock-signed-in", "kai@example.com");
              if (market) localStorage.setItem("oc-device", JSON.stringify({ marketSlug: "inland-empire", presets: [], reminders: [], settings: {}, lastStationId: null }));
            },
            { signedIn: v.signedIn !== false, market: v.market !== false }
          );
          await useGround(page, ground);
          if (v.casting) {
            // The receiver, in the same browser so the mock Cast channel reaches it.
            const tv = await context.newPage();
            await tv.goto(`${TV_URL}/receiver.html`);
          }
          await page.goto(v.path);
          if (v.open) {
            await settle(page);
            await v.open(page, width);
          }
          await expect(v.sees(page, width)).toBeVisible();
          await settle(page);
          await checkA11y(page, `viewer ${v.name}, ${width}, ${ground}`, v.a11y);
        });
      }
    });
  }
}
