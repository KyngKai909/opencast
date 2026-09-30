// Master control's flows (apps prompt, Phase 9), on the mock at its Saturday evening, 8:42 pm:
// sign on for the first time, carry a program, fill a break from the spot market, approve a
// sponsorship, edit the log and publish the changes. What each screen says is the reference
// frames' copy (docs/reference/control); edit mode has no frame (docs/apps/new-copy.md).

import { expect, test } from "@playwright/test";
import { signInAs } from "./control.support";

test.use({ viewport: { width: 1280, height: 900 } });

test("someone new signs on for the first time", async ({ page }) => {
  // The mock prepares an upload for air in 20 seconds, as the real one takes its time.
  test.setTimeout(180_000);
  // Signing in: a wrong code is refused, the right one lets them in.
  await page.goto("/control");
  await expect(page.getByRole("heading", { name: "Sign in to Opencast" })).toBeVisible();
  await page.getByLabel("Email").fill("dana@example.com");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText("We sent a code to dana@example.com.")).toBeVisible();
  await page.getByLabel("Code").fill("000000");
  await expect(page.getByText("That code isn't right. Check the email and try again.")).toBeVisible();
  await page.getByLabel("Code").fill("482913");

  // No station yet: start one.
  await expect(page.getByRole("heading", { name: "Start a station" })).toBeVisible();
  await page.getByRole("link", { name: "Start a station" }).click();

  // 1. Your station (A.1): the first thing saved starts it; setup carries on under its id.
  await expect(page.getByRole("heading", { name: "Your station" })).toBeVisible();
  await page.getByLabel("Station name").fill("Redlands Tapes");
  await page.getByLabel("Station name").blur();
  await page.waitForURL(/\/setup\/[^/]+\/station$/);
  await page.getByLabel("Call sign").fill("TAPE");
  await expect(page.getByText("TAPE is free")).toBeVisible();
  await page.getByRole("radio", { name: "13", exact: true }).click();
  await expect(page.getByText(/You'll be 13\.1; subchannels 13\.2 and up/)).toBeVisible();
  await expect(page.getByText("White text on it reads at 6.9:1")).toBeVisible();
  await page.getByRole("button", { name: "Continue to library" }).click();

  // 2. Library (A.2): a program and a station ID, each prepared for air and its rights confirmed.
  // Continue works with nothing in it (only signing on checks what's needed), and until TAPE has a
  // station ID of its own it has a generated one, read-only (both 2026-09-29).
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(page.getByText("Nothing here yet. Drop your first programs and a station ID above.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to program log" })).toBeEnabled();
  const generated = page.getByRole("group", { name: "Generated station ID" });
  await expect(generated.getByText("Made for TAPE. Replaced by any station ID you upload")).toBeVisible();
  await generated.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("img", { name: "TAPE 13.1 in TAPE's colour" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await page.locator('input[type="file"]').setInputFiles([
    { name: "Tape Talks, ep. 1.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(9_000_000) },
    { name: "TAPE station ID.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(1_000) }
  ]);
  await expect(page.getByText("2 files are being prepared for air.")).toBeVisible();
  await expect(page.getByText("2 need rights confirmed")).toBeVisible();
  await page.getByLabel("Type of TAPE station ID").selectOption("SID");
  for (const title of ["Tape Talks, ep. 1", "TAPE station ID"]) {
    await page.getByRole("button", { name: "Confirm rights to air it" }).first().click();
    const pane = page.getByRole("dialog", { name: `Can TAPE air ${title}?` });
    await pane.getByText("I made it").click();
    await pane.getByRole("button", { name: "Confirm rights", exact: true }).click();
    await expect(pane).toBeHidden();
  }
  await expect(page.getByText(/need rights confirmed/)).toHaveCount(0);
  await expect(page.getByText(/Preparing for air/)).toHaveCount(0, { timeout: 45_000 });
  // TAPE's own station ID replaces the generated one.
  await expect(generated).toHaveCount(0);
  await page.getByRole("button", { name: "Continue to program log" }).click();

  // 3. Program log (A.4): 24 hours of dead air, filled by repeating the library.
  await expect(page.getByRole("heading", { name: "Program log" })).toBeVisible();
  await expect(page.getByText(/^Dead air from .+ Sunday\.$/)).toBeVisible();
  await expect(page.getByText("24 hr with nothing scheduled.")).toBeVisible();
  await expect(page.getByText("Tape Talks, ep. 1, repeated, with your break rule")).toBeVisible();
  await page.getByRole("button", { name: "Fill the gap" }).click();
  await expect(page.getByText(/^Filled .+ from your library\.$/)).toBeVisible();
  await expect(page.getByText("24 hr with nothing scheduled.")).toHaveCount(0);
  await page.getByRole("link", { name: "Continue to translators" }).click();

  // 4. Translators: optional.
  await expect(page.getByRole("heading", { name: "Translators" })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // 5. Ready to sign on (A.6): every check done, then the tally lights and the Monitor opens.
  await expect(page.getByRole("heading", { name: "Ready to sign on" })).toBeVisible();
  await expect(page.getByText("Four checks. All four are done.")).toBeVisible();
  await expect(page.getByText("Rights confirmed for everything in the log")).toBeVisible();
  await expect(page.getByText("2 of 2 items")).toBeVisible();
  await expect(page.getByText("Signing on puts TAPE on the Inland Empire dial. You can sign off at any time.")).toBeVisible();
  await page.getByRole("button", { name: "Sign on", exact: true }).click();
  await page.waitForURL(/\/tape\/monitor$/);
  await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible();
  await expect(page.getByText(/^On air since \d+:\d\d pm\. Break in /)).toBeVisible();
  await expect(page.getByText("Tape Talks, ep. 1").first()).toBeVisible();
});

test("BEAT carries a program from the syndication market", async ({ page }) => {
  await signInAs(page, "kai");
  await page.goto("/control/beat/market");
  await expect(page.getByRole("heading", { name: "Syndication market" })).toBeVisible();
  await page.getByRole("link", { name: "Nights at the observatory" }).first().click();

  // The program, for stations (market 02.1).
  await expect(page.getByRole("heading", { name: "Nights at the observatory" })).toBeVisible();
  await expect(page.getByText("Telescope footage and mission film from NASA, set to quiet music.")).toBeVisible();
  await page.getByRole("button", { name: "Choose terms" }).click();

  // Its terms: free, one sponsor credit an hour.
  const terms = page.getByRole("dialog");
  await expect(terms.getByText("No fee. One sponsor credit an hour; you sell the rest.")).toBeVisible();
  await expect(terms.getByText("Carried from the Opencast catalog")).toBeVisible();
  await terms.getByRole("button", { name: "Choose a slot" }).click();

  // Placing it in the log: Sundays at 8 pm, from tomorrow.
  await expect(page.getByRole("heading", { name: "Place Nights at the observatory" })).toBeVisible();
  await expect(page.getByText("Choose when it airs on BEAT. Free terms, One sponsor credit an hour.")).toBeVisible();
  await expect(page.getByText("Sundays, 8:00 to 10:00 pm")).toBeVisible();
  await expect(page.getByText('Opencast catalog is told, and it appears in your listings as "Carried from the Opencast catalog".')).toBeVisible();
  await page.getByRole("button", { name: "Carry Nights at the observatory" }).click();

  // Undo stays open a moment; when it closes, the carriage is sent.
  const toast = page.getByText("Nights at the observatory is in your log from tomorrow at 8:00 pm");
  await expect(toast).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 20_000 });

  // Carried by BEAT now lists it.
  await page.goto("/control/beat/market/carried");
  const row = page.getByRole("row").filter({ hasText: "Nights at the observatory" });
  await expect(row).toContainText("From Opencast catalog");
  await expect(row).toContainText("Sundays at 8:00 pm");
  await expect(row).toContainText("One sponsor credit an hour");
});

test("BEAT fills a break from the spot market", async ({ page }) => {
  await signInAs(page, "kai");
  await page.goto("/control/beat/breaks");

  // Breaks tonight (C.1): open time across tonight's breaks.
  await expect(page.getByRole("heading", { name: "Breaks tonight" })).toBeVisible();
  await expect(page.getByText("4:15 open across 4 breaks. Open time with nothing in it airs your station ID and bumpers.")).toBeVisible();
  await page.getByRole("link", { name: "Fill from the spot market" }).click();

  // The spot market (C.2): add Orange Street Coffee.
  await expect(page.getByRole("heading", { name: "Spot market" })).toBeVisible();
  await expect(page.getByText("Spots businesses have listed for stations in the Inland Empire. You choose which air on BEAT.")).toBeVisible();
  const orange = page.getByRole("row").filter({ hasText: "Orange Street Coffee" });
  await expect(orange).toContainText("$8.00");
  await page.getByRole("button", { name: "Add Orange Street Coffee to your rotation" }).click();
  await expect(orange).toContainText("In rotation");

  // Breaks tonight, filled (C.3): the spot is in tonight's breaks.
  await page.getByRole("link", { name: /^Breaks/ }).first().click();
  await expect(page.getByRole("heading", { name: "Breaks tonight" })).toBeVisible();
  await expect(page.getByText(":30 open across 4 breaks. Rotation: 1 spot.")).toBeVisible();
  const during = page.getByRole("row").filter({ hasText: "During Saturday Reel" });
  await expect(during).toContainText("Orange Street");
  await expect(page.getByText("Just added")).toBeVisible();
});

test("BEAT approves a sponsorship", async ({ page }) => {
  await signInAs(page, "kai");
  await page.goto("/control/beat/sponsors");

  // Sponsors, with a new request (sponsorships 03.1).
  await expect(page.getByRole("heading", { name: "Sponsors", exact: true })).toBeVisible();
  await expect(page.getByText("Orange Street Coffee wants to sponsor Beat Tape Live")).toBeVisible();
  await expect(page.getByText("$75.00, your minimum")).toBeVisible();
  await expect(page.getByText(/If you approve, it airs in Beat Tape Live's breaks from October 3/)).toBeVisible();
  await expect(page.getByText("$200.00 a month")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();

  // Approved, with Undo while the toast is up; then it's a current sponsor.
  const toast = page.getByText("Orange Street Coffee approved.");
  await expect(toast).toBeVisible();
  await expect(page.getByText("Orange Street Coffee wants to sponsor Beat Tape Live")).toHaveCount(0);
  await expect(page.getByText("$275.00 a month")).toBeVisible();
  await expect(page.getByText("Beat Tape Live, since October")).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 20_000 });

  // It stuck: a fresh visit shows it.
  await page.reload();
  await expect(page.getByText("$275.00 a month")).toBeVisible();
  await expect(page.getByText("Beat Tape Live, since October")).toBeVisible();
  await expect(page.getByText("New request")).toHaveCount(0);
});

test("BEAT edits its log and publishes the changes", async ({ page }) => {
  await signInAs(page, "kai");
  await page.goto("/control/beat/log?view=evening&day=sat");
  await expect(page.getByRole("heading", { name: "Program log" })).toBeVisible();
  await page.getByRole("button", { name: "Edit log" }).click();
  await expect(page.getByText("Editing the log.")).toBeVisible();
  const log = page.getByRole("list", { name: "The log, being edited" });

  // What's airing is locked.
  await log.getByRole("button", { name: /Saturday Reel/ }).click();
  await expect(page.getByText("On air now, too late to change.")).toBeVisible();

  // Slow Hours dragged half an hour later (1.12 px a minute), to the nearest minute.
  const slow = log.getByRole("button", { name: /Slow Hours/ });
  await slow.scrollIntoViewIfNeeded();
  const box = (await slow.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 20, { steps: 4 });
  await page.mouse.move(box.x + 40, box.y + 10 + 33.6, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByText("1 change: Slow Hours moves to 11:00 pm")).toBeVisible();
  await expect(page.getByText("Dead air from 10:30 pm to 11:00 pm (30 min).")).toBeVisible();

  // Then typed: 11:10 pm.
  const start = page.getByLabel("Starts at");
  await start.fill("23:10");
  await start.press("Enter");
  await expect(page.getByText("1 change: Slow Hours moves to 11:10 pm")).toBeVisible();

  // Published, all at once; the history says who and when.
  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.getByText("1 change published.")).toBeVisible();
  await expect(page.getByText("Editing the log.")).toHaveCount(0);
  await expect(page.getByText(/^Last changed by Kai M\. at 8:4\d pm$/)).toBeVisible();
  await expect(page.getByText("1 change: Slow Hours moves to 11:10 pm")).toBeVisible();
});

test("BEAT's Audience shows watch time and where people left; Offering your programs adds up every station (follow-up Phase 1)", async ({ page }) => {
  await signInAs(page, "kai");
  await page.goto("/control/beat/audience?period=tonight");
  const table = page.getByRole("table", { name: /By program/ });
  await expect(table.getByRole("columnheader", { name: "Watch time" })).toBeVisible();
  // Each airing's watch time, and its tune-away line with the sentence that says it.
  const late = table.getByRole("row").filter({ hasText: "Late Crate, ep. 14" });
  await expect(late).toContainText(/\d+ hours/);
  await expect(late.getByRole("figure")).toContainText(/^Most left around \d{1,2}:\d{2} pm/);
  // The airing on now is still being counted.
  await expect(table.getByRole("row").filter({ hasText: "Saturday Reel" })).toContainText("Counting…");

  // Offering your programs: every station that aired them, added up; never a station's own.
  await page.goto("/control/beat/market/offered");
  const list = page.getByRole("list", { name: "Your programs across every station" });
  await expect(list.getByRole("listitem").filter({ hasText: "Late Crate" }).filter({ hasText: "airings on 2 stations" })).toContainText("Watch time");
  const tape = list.getByRole("listitem").filter({ hasText: "Beat Tape Live" }).filter({ hasText: "Radio band" });
  await expect(tape).toContainText("1 airing not counted yet");
  await expect(tape).toContainText("Not enough viewers yet");
  for (const callSign of ["HALL", "SAZN", "CRAT"]) await expect(list).not.toContainText(callSign);
});

test("Station account: BEAT caps its live hours; HALL's grace period shows on its Monitor; paying what's due (follow-up Phase 2)", async ({ page }) => {
  await signInAs(page, "kai");
  await page.goto("/control/beat/settings/account");

  // Usage so far this month and the estimate, per type (the mock's September, paid from earnings).
  const usage = page.getByRole("table", { name: "This month" });
  await expect(usage.getByRole("row").filter({ hasText: "Relays, everything you air" })).toContainText("$31.39$36.00");
  await expect(usage.getByRole("row").filter({ hasText: /^Total/ })).toContainText("$34.75$40.41");

  // A cap on live hours: set, and it sticks.
  const caps = page.getByRole("list", { name: "Caps" });
  const live = caps.getByRole("listitem").filter({ hasText: /^Live hours/ });
  await expect(live).toContainText("No cap. At a cap: live shows pause for the rest of the month (station ID and bumpers air instead); your channel stays on air.");
  await page.getByRole("button", { name: "Set a cap: Live hours" }).click();
  await page.getByRole("textbox", { name: "Monthly cap for Live hours" }).fill("10");
  await live.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Live hours is capped at $10.00 a month.")).toBeVisible();
  await expect(live).toContainText("$2.25 of $10.00 so far.");
  await page.reload();
  await expect(page.getByRole("list", { name: "Caps" }).getByRole("listitem").filter({ hasText: /^Live hours/ })).toContainText("$10.00 a month");

  // HALL, which Kai operates, is in its grace period: the Monitor says when relays and live shows
  // pause, and Station account shows what's due, read-only.
  await page.goto("/control/hall/monitor");
  await expect(page.getByText("Relays and live shows pause on October 4")).toBeVisible();
  await expect(page.getByText("$96.40 is due for August's usage. Your channel stays on air.")).toBeVisible();
  await page.getByRole("link", { name: "Station account" }).click();
  await expect(page.getByText("$96.40 is due for August's usage")).toBeVisible();
  await expect(page.getByText(/Relays and live shows keep going until October 4 \(7 days\), then pause until it's paid\. Your channel stays on air\./)).toBeVisible();
  await expect(page.getByText("Only owners change caps and what pays, or pay what's due.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay now" })).toHaveCount(0);

  // The owner's side of it: BEAT put in the same grace period (the mock's switch), then Pay now.
  await page.evaluate(() => (window as unknown as { ocMock: { setAccountState(s: string, st: string): void } }).ocMock.setAccountState("BEAT", "grace"));
  await page.goto("/control/beat/settings/account");
  await expect(page.getByText("$96.40 is due for August's usage")).toBeVisible();
  await page.getByRole("button", { name: "Pay now" }).click();
  await expect(page.getByText("Your card was declined. Replace the card to pay it.")).toBeVisible();

  // A new card: no Stripe key on the mocks, so the stand-in saves the test card, and pays at once.
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Replace the card" });
  await expect(dialog.getByText("Stripe's card form goes here")).toBeVisible();
  await dialog.getByRole("button", { name: "Save test card" }).click();
  await expect(page.getByText("Visa ending 4242 is saved, and $96.40 is paid. Nothing is due.")).toBeVisible();
  await expect(page.getByText("$96.40 is due for August's usage")).toHaveCount(0);
  await page.goto("/control/beat/monitor");
  await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible();
  await expect(page.getByText(/Relays and live shows (pause|are paused)/)).toHaveCount(0);
});
