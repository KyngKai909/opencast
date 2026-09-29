// axe on every route of TV mode (always dark: checked once), and the states on "/" (off air, stand
// by, the reminder card, number entry, the radio screen), the Cast receiver and the iPhone's
// second screen. Routes from apps/tv/src/pages/*/routes.tsx. Each check waits for what the screen
// says first, then for its fades to finish (reduced motion), so axe reads the settled screen.

import { expect, test, type Page } from "@playwright/test";
import { checkA11y, useGround } from "../lib/a11y";
import { MOCK_CHANNEL, openTv, playing, settled } from "./tv.helpers";

test.use({ reducedMotion: "reduce" });

test.beforeEach(async ({ page }) => {
  await useGround(page, "dark");
});

async function check(page: Page, label: string) {
  await settled(page);
  await checkA11y(page, `tv ${label}`);
}

test("/ watching, signed out", async ({ page }) => {
  await openTv(page, "/");
  await playing(page);
  await expect(page.locator(".oc-banner")).toContainText("Town Hall: backyard homes and ADUs");
  await check(page, "/");
});

test("/ watching, signed in", async ({ page }) => {
  await openTv(page, "/", { signedIn: true });
  await playing(page);
  await expect(page.locator(".oc-banner")).toContainText("Inland Civic");
  await check(page, "/ signed in");
});

test("/ number entry", async ({ page }) => {
  await openTv(page, "/");
  await playing(page);
  await page.keyboard.press("1");
  await page.keyboard.press("2");
  await expect(page.locator(".oc-numpad__num")).toHaveAttribute("aria-label", "Channel 12.1");
  // Not `check`: the entry clears itself after the number wait, so axe runs at once.
  await checkA11y(page, "tv / number entry");
});

test("/?offAir=CIVC off air", async ({ page }) => {
  await openTv(page, "/?offAir=CIVC");
  await expect(page.getByText("CIVC 7.1 signs on again at 9:30 pm. BEAT 12.1 is on now.")).toBeVisible();
  await expect(page.getByText("Tune to BEAT 12.1")).toBeVisible();
  await check(page, "/ off air");
});

test("/?standby=CIVC stand by", async ({ page }) => {
  await openTv(page, "/?standby=CIVC");
  await expect(page.getByText("Please stand by")).toBeVisible();
  await expect(page.getByText("CIVC 7.1 is waiting for its signal. BEAT 12.1 is on now.")).toBeVisible();
  await check(page, "/ stand by");
});

test("/ reminder card", async ({ page }) => {
  // A minute before Beat Tape Live (9:00 pm), a signed-in TV's card comes up.
  await openTv(page, "/?clock=2026-09-27T03:59:20Z", { signedIn: true });
  await expect(page.getByText("Beat Tape Live is starting on BEAT 12.1.")).toBeVisible();
  await check(page, "/ reminder card");
});

test("/radio the radio screen", async ({ page }) => {
  await openTv(page, "/radio");
  await expect(page).toHaveURL(/\/$/);
  await playing(page);
  await expect(page.locator(".oc-banner")).toContainText("Radio dramas from the 1940s");
  await check(page, "/ radio screen");
});

const overlays: Array<[route: string, says: string, signedIn?: boolean]> = [
  ["/guide", "Now on CIVC 7.1"],
  ["/about/civc", "Town halls and council meetings from across the Inland Empire, unedited."],
  ["/menu", "Sleep timer"],
  ["/presets", "Save this channel"],
  ["/presets", "Radio dramas from the 1940s", true],
  ["/sleep", "Turn off after"],
  ["/pledge/civc", "Scan with your phone."],
  ["/market", "Los Angeles"],
  ["/settings/watching", "Caption size"],
  ["/settings/remote", "Who on the Wi-Fi can change the channel"],
  ["/settings/picture", "Even out the sound"],
  ["/settings/account", "Sign out of this TV", true],
  ["/settings/about", "Version"]
];
for (const [route, says, signedIn] of overlays) {
  test(`${route}${signedIn ? " signed in" : ""}`, async ({ page }) => {
    await openTv(page, route, { signedIn });
    await playing(page);
    await expect(page.getByText(says).first()).toBeVisible();
    await check(page, `${route}${signedIn ? " signed in" : ""}`);
  });
}

test("/guide/options/:id", async ({ page }) => {
  await openTv(page, "/guide");
  await playing(page);
  await expect(page.getByText("Now on CIVC 7.1")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/guide\/options\//);
  await expect(page.getByText("Remind me").first()).toBeVisible();
  await check(page, "/guide/options/:id");
});

test("/welcome first launch", async ({ page }) => {
  await openTv(page, "/", { firstLaunch: true });
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByText("Sign in on your phone.")).toBeVisible();
  await expect(page.getByText("Watch without signing in")).toBeVisible();
  await check(page, "/welcome");
});

test("/receiver.html with a Cast session", async ({ page, context }) => {
  await openTv(page, "/receiver.html");
  const phone = await context.newPage();
  await phone.goto("/mock-cast-bridge.html");
  // The phone starts casting, and says it again until the receiver (still booting) answers with
  // what's on, changed by Kai's phone. Then Info brings up the banner, whose hint row names the phone.
  const ns = "urn:x-cast:org.useopencast.tv";
  await phone.evaluate((name) => {
    const w = window as unknown as { c: BroadcastChannel; heard: number };
    w.c = new BroadcastChannel(name);
    w.heard = 0;
    w.c.addEventListener("message", (e) => {
      if (e.data?.to === "sender" && e.data.data?.type === "state" && e.data.data.changedBy === "Kai's phone") w.heard++;
    });
  }, MOCK_CHANNEL);
  const say = (data: object) =>
    phone.evaluate(({ ns, data }) => (window as unknown as { c: BroadcastChannel }).c.postMessage({ to: "receiver", senderId: "phone-1", namespace: ns, data }), { ns, data });
  await expect(async () => {
    await phone.evaluate(() => (window as unknown as { c: BroadcastChannel }).c.postMessage({ to: "receiver", senderId: "phone-1", kind: "connect", name: "Kai's phone" }));
    await say({ type: "session", from: "Kai's phone", marketSlug: "inland-empire" });
    await expect.poll(() => phone.evaluate(() => (window as unknown as { heard: number }).heard), { timeout: 2000 }).toBeGreaterThan(0);
  }).toPass({ intervals: [500, 1000, 2000] });
  await playing(page);
  await say({ type: "info", from: "Kai's phone" });
  await expect(page.getByText("Playing from Kai's phone")).toBeVisible();
  await check(page, "/receiver.html");
});

test("/?mirror the iPhone's second screen", async ({ page }) => {
  await page.goto("/?mirror&device=Kai's iPhone&market=inland-empire");
  await playing(page);
  await expect(page.getByText("Mirrored from Kai's iPhone")).toBeVisible();
  await check(page, "/?mirror");
});
