// TV mode's flow (apps prompt, Phase 9): change channel by number and arrows, open the guide, set
// the sleep timer; then a phone's commands over the mock relay. Keyboard keys stand in for the
// remote: arrows, Enter = OK, Escape = Back, ContextMenu = Menu, digits.
//
// The sleep timer runs on Playwright's clock: it flows naturally, and fastForward jumps the half
// hour to the fade (the last minute) and the end, so nothing waits 30 minutes.

import { expect, test, type Page } from "@playwright/test";
import { MOCK_CHANNEL, openTv, playing, TV_ID } from "./tv.helpers";

test.use({ colorScheme: "dark" });

const banner = (page: Page) => page.locator(".oc-banner");
const focused = (page: Page) => page.locator(".tv-focus");

/**
 * The banner names the channel, e.g. "12.1" and "BEAT", and its picture is on screen. On a channel
 * change the banner comes once the new picture is in and the static has rolled away (follow-up
 * Phase 5); going straight to a city's player or an off-air station, at once. Waiting for the new
 * picture (aria-busy) keeps a later page.clock.fastForward from jumping past a tune still under way
 * (a half-hour jump in no real time would reach the tune's Stand by).
 */
async function onChannel(page: Page, channel: string, callSign: string) {
  await expect(banner(page).locator(".oc-banner__ch")).toHaveText(channel);
  await expect(banner(page).locator(".oc-banner__cs")).toHaveText(callSign);
  await expect(page.locator(".oc-player")).toHaveAttribute("aria-busy", "false");
}

test("change channel by number and arrows, open the guide, set the sleep timer", async ({ page }) => {
  await page.clock.install();
  await openTv(page, "/");
  await playing(page);
  await onChannel(page, "7.1", "CIVC");
  await expect(banner(page)).toContainText("Town Hall: backyard homes and ADUs");
  await expect(banner(page)).toContainText("48 min left");

  // ▲ ▼ change channel along the dial.
  await page.keyboard.press("ArrowUp");
  await onChannel(page, "9.1", "RDLS");
  // Changing channel (follow-up Phase 5): the number and call sign at once, top right, over soft
  // static; then the picture, the static rolling away, and the banner.
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".oc-tune__osd")).toHaveText("7.1CIVC");
  await expect(page.getByTestId("tuning-static")).toBeVisible();
  await onChannel(page, "7.1", "CIVC");
  await expect(page.getByTestId("tuning")).toHaveCount(0);

  // A number, then OK to tune right away.
  await page.keyboard.press("1");
  await page.keyboard.press("2");
  await expect(page.locator(".oc-numpad__num")).toHaveAttribute("aria-label", "Channel 12.1");
  await page.keyboard.press("Enter");
  await onChannel(page, "12.1", "BEAT");
  await expect(banner(page)).toContainText("Inland Beat");

  // A number on its own tunes after the wait (two seconds).
  await page.keyboard.press("2");
  await page.keyboard.press("4");
  await expect(page.locator(".oc-numpad")).toBeVisible();
  await expect(page.locator(".oc-numpad")).toBeHidden();
  await onChannel(page, "24.1", "REEL");

  // ▶ opens the guide on the channel that's on; Back closes it.
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/guide$/);
  await expect(page.getByText("Now on REEL 24.1")).toBeVisible();
  await expect(page.getByText("Close guide")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/$/);

  // OK with the banner down brings it up ("OK Guide" in its hints); OK again opens the guide.
  await page.clock.fastForward("00:06");
  await expect(banner(page)).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(banner(page)).toContainText("Guide");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/guide$/);

  // In the guide, ▲ moves up a row, and OK on what's on now tunes to it and closes the guide.
  await expect(focused(page)).toContainText("Cartoons from 1928 to 1934");
  await page.keyboard.press("ArrowUp");
  await expect(focused(page)).toContainText("Tamales for forty");
  await expect(page.getByText("Tune in")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
  // The new channel's banner comes up over the picture as the guide closes.
  await onChannel(page, "18.1", "SAZN");

  // Menu, Sleep timer (Off), 30 min: it says the clock time it ends.
  await page.keyboard.press("ContextMenu");
  await expect(page).toHaveURL(/\/menu$/);
  await expect(focused(page)).toContainText("Guide");
  const sleepItem = page.getByRole("menuitem", { name: /Sleep timer/ });
  await expect(sleepItem).toContainText("Off");
  while (!(await sleepItem.evaluate((e) => e.classList.contains("tv-focus")))) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sleep$/);
  await expect(page.getByRole("dialog", { name: "Turn off after" })).toBeVisible();
  await expect(page.getByText(/^It's \d{1,2}:\d{2} pm$/)).toBeVisible();
  await expect(page.getByText("A minute before, the sound fades and a notice offers 30 more minutes.")).toBeVisible();
  await expect(focused(page)).toContainText("End of this program");
  await page.keyboard.press("ArrowRight");
  await expect(focused(page)).toContainText("30 min");
  const endsAt = (await focused(page).locator("small").textContent())!;
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);

  // The menu says when it turns off.
  await page.keyboard.press("ContextMenu");
  await expect(sleepItem).toContainText(endsAt);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/$/);

  // The last minute: the sound fades and the notice offers 30 more minutes; OK takes them.
  const notice = page.locator(".oc-player__sleep");
  await page.clock.fastForward("29:30");
  await expect(notice).toContainText("Turning off in a minute.");
  await expect(notice.getByRole("button", { name: "30 more minutes" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(notice).toBeHidden();

  // Left alone this time, it fades and ends: Opencast stops itself.
  await page.clock.fastForward("29:30");
  await expect(notice).toContainText("Turning off in a minute.");
  await page.clock.fastForward("01:00");
  await expect(page.getByRole("status").filter({ hasText: "Turned off by the sleep timer." })).toBeVisible();
  await expect(page.getByText("to watch again.")).toBeVisible();
  await expect(page.locator(".oc-player")).toHaveAttribute("data-status", "stopped");

  // OK starts it again, on the last channel.
  await page.keyboard.press("Enter");
  await playing(page);
  await onChannel(page, "18.1", "SAZN");
});

test("pause, then back to live: holding OK, and the chip while playing on behind live", async ({ page }) => {
  await page.clock.install();
  await openTv(page, "/");
  await playing(page);
  const paused = page.locator(".oc-player__paused");
  const chip = page.locator(".oc-player__live");
  const hint = banner(page).locator(".oc-banner__hints");

  // The space bar pauses: the paused sign offers Back to live at once, and the banner's hint row
  // says how on a remote.
  await page.keyboard.press(" ");
  await expect(page.locator(".oc-player")).toHaveAttribute("data-status", "paused");
  await expect(paused.getByRole("button", { name: "Back to live" })).toBeVisible();
  await expect(hint).toContainText("HoldOKBack to live");

  // Held OK: back to live.
  await page.keyboard.down("Enter");
  await page.waitForTimeout(700);
  await page.keyboard.up("Enter");
  await playing(page);
  await expect(paused).toBeHidden();
  await expect(chip).toBeHidden();

  // Paused a while, then play: it plays on behind live. Once the banner goes, the chip says how back.
  await page.keyboard.press(" ");
  await expect(page.locator(".oc-player")).toHaveAttribute("data-status", "paused");
  await page.waitForTimeout(10_000);
  await page.keyboard.press(" ");
  await playing(page);
  await page.clock.fastForward("00:06");
  await expect(banner(page)).toBeHidden();
  await expect(chip).toHaveText("Hold OKBack to live");
  // OK brings the banner up (the chip steps aside for its hint row); held, it's back to live.
  await page.keyboard.press("Enter");
  await expect(hint).toContainText("HoldOKBack to live");
  await expect(chip).toBeHidden();
  await page.keyboard.down("Enter");
  await page.waitForTimeout(700);
  await page.keyboard.up("Enter");
  await page.clock.fastForward("00:06");
  await expect(banner(page)).toBeHidden();
  await expect(chip).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
});

test("a phone's commands over the relay change the channel and set the sleep timer", async ({ page, context }) => {
  await page.clock.install();
  await openTv(page, "/", { signedIn: true });
  await playing(page);
  await onChannel(page, "7.1", "CIVC");

  // Kai's phone: another tab on this origin, on the mock relay's channel (as the viewer's phone
  // remote reaches it through the bridge). It hears what the TV posts back.
  const phone = await context.newPage();
  await phone.goto("/mock-cast-bridge.html");
  await phone.evaluate(
    ({ channel, tvId }) => {
      const c = new BroadcastChannel(channel);
      const w = window as unknown as { heard: unknown[]; send: (m: object) => void };
      w.heard = [];
      c.addEventListener("message", (e) => {
        if (e.data?.to === "relay-phone" && e.data.tvId === tvId) w.heard.push(e.data);
      });
      const base = { to: "relay-tv", tvId, phoneId: "00000000-0000-4000-8000-00000000f001", name: "Kai's phone" };
      w.send = (m) => c.postMessage({ ...base, ...m });
      w.send({ connected: true, kind: "account" });
    },
    { channel: MOCK_CHANNEL, tvId: TV_ID }
  );
  const send = (m: object) => phone.evaluate((x) => (window as unknown as { send: (m: object) => void }).send(x), m);
  const lastState = () =>
    phone.evaluate(() => {
      const heard = (window as unknown as { heard: Array<{ state?: { stationId: string | null; changedBy: string | null; sleepEndsAt: number | null } }> }).heard;
      return heard.filter((m) => m.state).at(-1)?.state ?? null;
    });

  // The TV's relay stream opens once it's registered: a command before then isn't heard (the
  // API answers 409 tv_not_connected), so the phone says it again until the TV tunes.
  await expect(async () => {
    await send({ command: { type: "tune", channel: "12.1" } });
    await onChannel(page, "12.1", "BEAT");
  }).toPass({ intervals: [500, 1000, 2000] });
  await expect.poll(lastState).toMatchObject({ changedBy: "Kai's phone", sleepEndsAt: null });
  const beat = (await lastState())!.stationId;

  // CH up on the phone: the TV changes channel, the hint row names the phone, the phone hears it.
  await send({ command: { type: "channel", dir: "up" } });
  await onChannel(page, "18.1", "SAZN");
  await expect(page.getByText("Playing from Kai's phone")).toBeVisible();
  await expect.poll(async () => (await lastState())?.stationId).not.toBe(beat);

  // Digits from the phone's keypad tune after the wait, as the remote's do.
  await send({ command: { type: "digit", digit: 2 } });
  await send({ command: { type: "digit", digit: 4 } });
  await onChannel(page, "24.1", "REEL");

  // Sleep in a minute from the phone: the fade's notice at once; the phone hears when it ends.
  await send({ command: { type: "sleep", until: 1 } });
  await expect(page.locator(".oc-player__sleep")).toContainText("Turning off in a minute.");
  await expect.poll(async () => (await lastState())?.sleepEndsAt ?? null).not.toBeNull();
  await page.clock.fastForward("01:05");
  await expect(page.getByText("Turned off by the sleep timer.")).toBeVisible();
  // The remote session ends with it (POST /tv/remote/end): the phone is told.
  await expect.poll(() => phone.evaluate(() => (window as unknown as { heard: Array<{ ended?: string }> }).heard.some((m) => m.ended === "tv_ended"))).toBe(true);
});

test("TV settings: Tuning sound, off until turned on, and kept on this TV (tv-update 04.1)", async ({ page }) => {
  await openTv(page, "/settings/watching");
  const row = page.locator(".tvs-row--focus");
  await expect(row).toContainText("Captions");
  // Captions, Caption size, Channel up goes, Banner stays for, then Tuning sound.
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  await expect(row).toContainText("Tuning sound");
  await expect(row).toContainText("A soft hiss when changing channel");
  await expect(row.locator(".tvs-row__val")).toContainText("Off");
  await page.keyboard.press("ArrowRight");
  await expect(row.locator(".tvs-row__val")).toContainText("On");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("oc-tv-device") ?? "{}").settings?.tuningSound)).toBe(true);
});

test("Not for me on the menu: off by default; with the switch on, OK says it once (follow-up Phase 1)", async ({ page }) => {
  // Off, as the rules registry starts it: the menu has no such item.
  await openTv(page, "/");
  await playing(page);
  await page.keyboard.press("ContextMenu");
  await expect(page).toHaveURL(/\/menu$/);
  await expect(page.getByRole("menuitem", { name: /Guide/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Not for me/ })).toHaveCount(0);

  // The mock's switch turns it on: the item sits after the station line, reached with the arrows.
  await openTv(page, "/?notForMe=on");
  await playing(page);
  await page.keyboard.press("ContextMenu");
  const item = page.getByRole("menuitem", { name: /Not for me/ });
  await expect(item).toBeVisible();
  for (let i = 0; i < 12 && !(await focused(page).textContent())?.startsWith("Not for me"); i++) await page.keyboard.press("ArrowDown");
  await expect(focused(page)).toContainText("Not for me");
  const vote = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/not-for-me"));
  await page.keyboard.press("Enter");
  expect(await (await vote).json()).toEqual({ ok: true, status: "recorded" });
  await expect(item).toContainText("Noted");
  await expect(page.getByRole("status").filter({ hasText: "Noted. Only a count is kept, never who said it." })).toBeVisible();
  // OK again in the same airing: nothing more is sent.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: /^You've already said .+ isn't for you\.$/ })).toBeVisible();
});
