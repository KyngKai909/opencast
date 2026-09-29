// TV mode's flow against the real API (playwright.real.config.ts), as a new person on a new TV:
// first launch (the market from the connection: the harness has no geo lookup, so the fallback),
// signing in by code, the dial (by number and arrows), the guide and its options (a reminder,
// read back through the API), settings saved to the account (settings.tv, read back), a preset;
// then Sam's phone driving his TV through the relay (/tv/remote/:tvId/commands) and hearing
// what it shows. Keyboard keys stand in for the remote: arrows, Enter = OK, Escape = Back.
//
// No video plays (no playout worker): the picture stays tuning, and nothing here needs it to play.

import type { Page } from "@playwright/test";
import { api, approveTvCode, expect, seed, test } from "../lib/real";
import { answered, deviceStore, openTv, phoneListens, phoneSays, tvSession, watch } from "./tv.real.helpers";

test.use({ colorScheme: "dark" });

const banner = (page: Page) => page.locator(".oc-banner");
const focused = (page: Page) => page.locator(".tv-focus");
/** The focused settings row. */
const row = (page: Page) => page.locator(".tvs-row--focus");

/** The banner names the channel, e.g. "12.1" and "BEAT". */
async function onChannel(page: Page, channel: string, callSign: string) {
  await expect(banner(page).locator(".oc-banner__ch")).toHaveText(channel);
  await expect(banner(page).locator(".oc-banner__cs")).toHaveText(callSign);
}

test("first launch, sign in by code, the dial, the guide's reminder, settings and a preset", async ({ page }) => {
  const person = `tv-flow-${Date.now().toString(36)}`;
  const w = watch(page);

  // First launch: the TV registers itself and shows a code. No geo lookup in the harness, so the
  // connection finds no market (S10's fallback) and the TV says which dial it's showing.
  await openTv(page, "/", { firstLaunch: true });
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByText("Sign in on your phone.")).toBeVisible();
  await expect(page.getByText("No market is open near this TV's connection yet, so it's showing Inland Empire. Change it any time in the menu.")).toBeVisible();
  const code = page.locator(".tvs-welcome__code");
  await expect(code).toHaveText(/^[A-Z0-9]{3} [A-Z0-9]{3}$/);
  const tv = await deviceStore(page);
  expect(tv.tvId, "registered on first launch").toBeTruthy();

  // Approved on the phone: the TV signs in and goes to the picture.
  await approveTvCode((await code.innerText()).replace(/\s/g, ""), person);
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  await expect.poll(async () => (await deviceStore(page)).token).toBeTruthy();
  const tvs = await api<Array<{ id: string; kind: string; signedIn: boolean }>>("/me/tvs", { as: person });
  expect(tvs).toEqual([expect.objectContaining({ id: tv.tvId, kind: "tv_app", signedIn: true })]);

  // The dial: ▲ ▼ along it from the first TV channel (CIVC 7.1, tuned underneath since first
  // launch), a number with OK, a number on its own. The picture never comes (no playout), so the
  // banner is what says where the TV is.
  await page.keyboard.press("ArrowUp");
  await onChannel(page, "12.1", "BEAT");
  await expect(banner(page)).toContainText("Inland Beat");
  await expect(banner(page)).toContainText("Late Crate");
  await page.keyboard.press("ArrowDown");
  await onChannel(page, "7.1", "CIVC");
  await page.keyboard.press("1");
  await page.keyboard.press("8");
  await expect(page.locator(".oc-numpad__num")).toHaveAttribute("aria-label", "Channel 18.1");
  await page.keyboard.press("Enter");
  await onChannel(page, "18.1", "SAZN");
  await page.keyboard.press("2");
  await page.keyboard.press("4");
  await expect(page.locator(".oc-numpad")).toBeVisible();
  await expect(page.locator(".oc-numpad")).toBeHidden();
  await onChannel(page, "24.1", "REEL");

  // Menu, Guide: the grid, focused on what's on now; ▶ is the next program, OK its options.
  await page.keyboard.press("ContextMenu");
  await expect(page).toHaveURL(/\/menu$/);
  await expect(focused(page)).toContainText("Guide");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/guide$/);
  const cell = page.getByRole("gridcell", { selected: true });
  await expect(cell).toContainText(/^On now: /);
  const guideRow = (await cell.locator("xpath=ancestor::*[@role='row']").getAttribute("aria-label"))!;
  await page.keyboard.press("ArrowRight");
  await expect(cell).not.toContainText(/^On now: /);
  const title = (await cell.locator("b").innerText()).trim();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/guide\/options\//);
  const options = page.getByRole("dialog");
  await expect(options.getByRole("heading")).toHaveText(title);
  // The focused option (the guide keeps its focused cell underneath).
  const option = page.locator(".tvg-dlg .tv-focus");
  await expect(option).toContainText("Remind me");
  await expect(option).toContainText("On this TV and your phone");
  await page.keyboard.press("Enter");
  await expect(option).toContainText("Reminder set");
  const callSign = guideRow.split(" ")[1];
  const reminders = () => api<Array<{ switchMeOver: boolean; airing: { title: string; station: { callSign: string | null } } }>>("/me/reminders", { as: person });
  expect((await reminders()).map((r) => [r.airing.title, r.airing.station.callSign, r.switchMeOver])).toEqual([[title, callSign, false]]);
  // Switch me over, on the same reminder.
  await page.keyboard.press("ArrowDown");
  await expect(option).toContainText(/Switch me over at /);
  await page.keyboard.press("Enter");
  await expect(option).toContainText(/Switching over at /);
  await expect.poll(async () => (await reminders()).map((r) => r.switchMeOver)).toEqual([true]);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/guide$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/$/);

  // Settings are saved to the account (A7's settings.tv): the banner stays 8 seconds, the sound
  // isn't evened out.
  const tvSettings = async () => (await api<{ settings: { tv?: Record<string, unknown> } }>("/me", { as: person })).settings.tv;
  await page.goto("/settings/watching");
  await expect(page.getByText("Saved to your account, so your other TVs use them too.")).toBeVisible();
  await expect(row(page)).toContainText("Captions");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
  await expect(row(page)).toContainText("Banner stays for");
  await expect(row(page)).toContainText("5 seconds");
  await page.keyboard.press("ArrowRight");
  await expect(row(page)).toContainText("8 seconds");
  await expect.poll(async () => (await tvSettings())?.bannerSeconds).toBe(8);
  await page.goto("/settings/picture");
  await expect(row(page)).toContainText("Picture quality");
  await page.keyboard.press("ArrowDown");
  await expect(row(page)).toContainText("Even out the sound");
  await page.keyboard.press("Enter");
  await expect.poll(tvSettings).toMatchObject({ bannerSeconds: 8, eveningOut: false });
  // Another TV on the account takes them when it reads the account.
  const other = await page.context().newPage();
  await openTv(other, "/settings/picture", { session: await tvSession(person) });
  await expect(row(other)).toContainText("Picture quality");
  await expect(other.getByRole("switch", { name: "Even out the sound: Off" })).toHaveAttribute("aria-checked", "false");
  await other.close();

  // Presets: the account's, on the strip (a preset saved on the phone); a key tunes it. (Saving
  // the channel on now needs the picture's current station, which never comes here: no playout.)
  await api("/me/presets", { as: person, method: "POST", body: { stationId: seed.stations.beat.id, key: 3 }, status: 200 });
  await page.goto("/presets");
  const key3 = page.locator(".tvw-pt").filter({ has: page.locator(".tvw-pt__k", { hasText: /^3$/ }) });
  await expect(key3).toContainText("BEAT");
  await expect(key3).toContainText("12.1");
  await page.keyboard.press("3");
  await expect(page).toHaveURL(/\/$/);
  await onChannel(page, "12.1", "BEAT");

  await answered(w);
  for (const r of w.refused) test.info().annotations.push({ type: "refused", description: r });
  expect(w.errors, "page errors").toEqual([]);
  expect(w.mismatched, "responses that don't match their contracts").toEqual([]);
  expect(w.refused, "calls the API refused").toEqual([]);
});

test("Sam's phone drives his TV through the relay and hears what it shows", async ({ page }) => {
  const sam = await tvSession("sam");
  const w = watch(page);
  await openTv(page, "/", { session: sam });
  await onChannel(page, "7.1", "CIVC");

  const phone = await phoneListens(sam.tvId, "sam");
  try {
    // The TV's stream opens once the app is up: until then the API answers 409 tv_not_connected,
    // so the phone says it again until the TV tunes.
    await expect(async () => {
      await phoneSays(sam.tvId, "sam", { type: "tune", channel: "12.1" });
      await onChannel(page, "12.1", "BEAT");
    }).toPass({ intervals: [500, 1000, 2000] });
    // The phone hears what the TV said when its stream opened.
    await expect.poll(() => phone.states.length).toBeGreaterThan(0);

    // CH up from the phone: the TV changes channel and its hint row names the phone.
    await phoneSays(sam.tvId, "sam", { type: "channel", dir: "up" });
    await onChannel(page, "18.1", "SAZN");
    await expect(page.getByText("Playing from Sam's phone")).toBeVisible();

    // Digits from the phone's keypad tune after the wait, as the remote's do.
    await phoneSays(sam.tvId, "sam", { type: "digit", digit: 2 });
    await phoneSays(sam.tvId, "sam", { type: "digit", digit: 4 });
    await onChannel(page, "24.1", "REEL");

    // Sam's preset key 1 (BEAT) from the phone.
    await phoneSays(sam.tvId, "sam", { type: "preset", key: 1 });
    await onChannel(page, "12.1", "BEAT");

    // The sleep timer from the phone: the TV's menu says it's set, and the phone hears when it
    // ends and who set it; cancelled, it hears that too.
    await phoneSays(sam.tvId, "sam", { type: "sleep", until: 30 });
    await expect.poll(() => phone.states.at(-1)?.sleepEndsAt ?? 0).toBeGreaterThan(Date.now() + 25 * 60_000);
    expect(phone.states.at(-1)?.changedBy).toBe("Sam's phone");
    await page.keyboard.press("ContextMenu");
    await expect(page.getByRole("menuitem", { name: /Sleep timer/ })).not.toContainText("Off");
    await page.keyboard.press("Escape");
    await phoneSays(sam.tvId, "sam", { type: "sleep", until: null });
    await expect.poll(() => phone.states.at(-1)?.sleepEndsAt).toBeNull();
    // What's on, in the state, is the picture's station: it stays null here, since no picture
    // ever comes (no playout worker in the harness).
    test.info().annotations.push({ type: "no playout", description: `the phone heard stationId ${JSON.stringify(phone.states.at(-1)?.stationId)}` });

    // Someone else's phone isn't paired with this TV.
    await expect(phoneSays(sam.tvId, "kai", { type: "channel", dir: "up" })).rejects.toMatchObject({ status: 403 });
  } finally {
    phone.close();
  }
  await answered(w);
  for (const r of w.refused) test.info().annotations.push({ type: "refused", description: r });
  expect(w.errors, "page errors").toEqual([]);
  expect(w.mismatched, "responses that don't match their contracts").toEqual([]);
});
