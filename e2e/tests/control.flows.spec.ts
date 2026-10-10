// Master control's flows (apps prompt, Phase 9), on the mock at its Saturday evening, 8:42 pm:
// sign on for the first time, carry a program, fill a break from the spot market, approve a
// sponsorship, open a break, edit the log and publish the changes, fill dead air from the Add
// drawer; A246 Phase 4: move where a block ends on the log, reset a date to its template, and on
// the phone open a break as a sheet and fill dead air (from the dead-air warning's link). What each screen says is the reference frames' copy (docs/reference/control, the Schedule
// in opencast-schedule.html); copy beyond them is in docs/apps/new-copy.md.

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
  // The files upload side by side (straight to storage, follow-up Phase 4), so the smaller one can
  // land first: each item's own row is used, not the list's order.
  for (const title of ["Tape Talks, ep. 1", "TAPE station ID"]) {
    await page.getByRole("row").filter({ has: page.getByRole("button", { name: `More for ${title}` }) }).getByRole("button", { name: "Confirm rights to air it" }).click();
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

  // 3. Program log (A.4; A246's Day view, without the Schedule's tabs or the Week): dead air,
  // filled by repeating the library from the Add drawer's quick fill.
  await expect(page.getByRole("heading", { name: "Program log" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Templates" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Week" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Dead air (now|at .+), / })).toBeVisible();
  await page.getByRole("button", { name: /^Fill/ }).first().click();
  const drawer = page.getByRole("dialog", { name: /^Add at / });
  await expect(drawer.getByText("Fills all 24 hr, in order, with the break rule")).toBeVisible();
  await drawer.getByRole("button", { name: "Fill", exact: true }).click();
  await expect(page.getByText(/^Filled .+ from your library\.$/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Dead air (now|at .+), / })).toHaveCount(0);
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

// A229: BEAT shares its call sign with 12.2 Beat Tapes in the mock, so where only a call sign would
// show, master control names it with its channel ("BEAT 12.1").
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
  await expect(page.getByText("Choose when it airs on BEAT 12.1. Free terms, One sponsor credit an hour.")).toBeVisible();
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

test("BEAT fills its rotation from the spot market; the rotation tab says what was added", async ({ page }) => {
  await signInAs(page, "kai");
  // A246: Breaks went to the Schedule; its old address lands there.
  await page.goto("/control/beat/breaks");
  await expect(page).toHaveURL(/\/control\/beat\/schedule$/);
  await expect(page.getByRole("heading", { name: "Schedule", level: 1 })).toBeVisible();

  // The spot market (C.2): add Orange Street Coffee.
  await page.goto("/control/beat/spot-market");
  await expect(page.getByRole("heading", { name: "Spot market" })).toBeVisible();
  await expect(page.getByText("Spots businesses have listed for stations in the Inland Empire. You choose which air on BEAT 12.1.")).toBeVisible();
  const orange = page.getByRole("row").filter({ hasText: "Orange Street Coffee" });
  await expect(orange).toContainText("$8.00");
  await page.getByRole("button", { name: "Add Orange Street Coffee to your rotation" }).click();
  await expect(orange).toContainText("In rotation");

  // Your rotation: C.3's toast says where it starts (it was on Breaks), and the way to tonight's breaks.
  await page.getByRole("tab", { name: "Your rotation" }).click();
  await expect(page.getByText(/^Orange Street Coffee added\. It starts in the \d{1,2}:\d\d (am|pm) break\.$/)).toBeVisible();
  await page.getByRole("link", { name: "See tonight's breaks" }).click();
  await expect(page).toHaveURL(/\/control\/beat\/schedule$/);
  await expect(page.getByRole("tab", { name: "Log" })).toHaveAttribute("aria-selected", "true");
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

test("BEAT edits its log and publishes four changes", async ({ page }) => {
  await signInAs(page, "kai");
  // An old link (A246): the Evening is the Schedule's Day now.
  await page.goto("/control/beat/log?view=evening&day=sat");
  await expect(page).toHaveURL(/\/control\/beat\/schedule\?view=day&day=sat$/);
  await expect(page.getByRole("heading", { name: "Schedule", level: 1 })).toBeVisible();
  // The rundown opens at now: Saturday Reel on air.
  await expect(page.getByRole("button", { name: "On air: Saturday Reel, 17 min left" })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const log = page.getByRole("list", { name: "The rundown, being edited" });
  await expect(log).toBeVisible();
  const tray = page.getByRole("region", { name: "Your changes" });

  // What's airing is locked, with the reason on its row.
  await expect(log.getByRole("listitem").filter({ hasText: "Saturday Reel" }).first()).toContainText("On air now, too late to change.");

  // 1. Late Crate, ep. 15 kept at its time: a fixed point.
  await page.getByRole("button", { name: "Keep Late Crate, ep. 15, 10:00 pm, at this time" }).click();
  await expect(tray.getByText("Late Crate, ep. 15 keeps its time")).toBeVisible();
  // Beat Tape Live running five minutes longer pushes the rows after it, but stops at the kept
  // one: the overlap blocks publishing, and Undo takes it out.
  await page.getByRole("button", { name: "Change when Beat Tape Live, 9:01 pm ends, now 9:58 pm" }).press("ArrowDown");
  await expect(tray.getByText(/^2 changes, checked: 1 problem blocks publishing$/)).toBeVisible();
  await expect(tray.getByText(/would overlap Late Crate, ep\. 15/)).toBeVisible();
  await tray.getByRole("button", { name: "Undo: Beat Tape Live now ends at 10:03 pm" }).click();
  await expect(tray.getByText("1 change, checked: nothing blocks publishing")).toBeVisible();

  // 2. Slow Hours comes off, struck through until it's published.
  await page.getByRole("button", { name: "Remove Slow Hours, 10:30 pm" }).click();
  await expect(log.getByRole("listitem").filter({ hasText: "Coming off the log" })).toBeVisible();

  // 3. Something from the library into the dead air, from the drawer.
  await log.getByRole("button", { name: /^Fill/ }).first().click();
  const drawer = page.getByRole("dialog", { name: "Add at 10:28 pm" });
  await drawer.getByLabel("Search your library").fill("Late Crate, ep. 1");
  await drawer.getByRole("button", { name: /^Late Crate, ep\. 1 (Never aired\. )?29:00/ }).click();
  await expect(tray.getByText("Late Crate, ep. 1 goes on at 10:28 pm")).toBeVisible();

  // 4. An overnight repeat a place up, with the arrow keys.
  await page.getByRole("button", { name: "Move Late Crate, ep. 13, 2:30 am", exact: true }).press("ArrowUp");
  await expect(tray.getByText("4 changes, checked: nothing blocks publishing")).toBeVisible();

  // Published, all at once; the record says what, who and when.
  await tray.getByRole("button", { name: "Publish 4 changes" }).click();
  await expect(page.getByText("4 changes published.")).toBeVisible();
  await expect(page.getByText(/^Published: 4 changes, by Kai M\. at 8:4\d pm$/)).toBeVisible();
  await expect(log).toHaveCount(0);
  await expect(page.getByText("Late Crate, ep. 15 keeps its time")).toBeVisible();
});

test("BEAT opens a break on the Schedule: what's in it, whose time it is, and why", async ({ page }) => {
  await signInAs(page, "kai");
  await page.goto("/control/beat/schedule");
  const log = page.getByRole("list", { name: "The rundown" });
  await log.getByRole("button", { name: /Spots placed at 9:09 pm/ }).click();
  await expect(page).toHaveURL(/break=/);
  const pane = page.getByRole("region", { name: "Break, 9:29:00 pm" });
  await expect(pane.getByText("During Beat Tape Live. 2:00")).toBeVisible();
  await expect(pane.getByRole("img", { name: "Credit :15, Open 1:45" })).toBeVisible();
  await expect(pane.getByText("Spots, placed at 9:09 pm")).toBeVisible();
  await expect(pane.getByText(/^From the main rotation\. 1:45 /)).toBeVisible();
  // The maker's barter, in a carried program's break.
  await log.getByRole("button", { name: /REEL's 1:00 barter/ }).click();
  const barter = page.getByRole("region", { name: "Break, 8:44:00 pm" });
  await expect(barter.getByText("REEL's barter").first()).toBeVisible();
  await expect(barter.getByText(/^REEL's 1:00 is the maker's time under barter\./)).toBeVisible();
  // The why line links to the rule that made it.
  await barter.getByRole("link", { name: "Break rules" }).click();
  await expect(page).toHaveURL(/\/control\/beat\/schedule\/rules$/);
});

// A246 phase 3: change how often a part airs, see the next hour rebuilt before saving, then save.
test("BEAT previews a break rule, then saves it", async ({ page }) => {
  await signInAs(page, "kai");
  await page.goto("/control/beat/schedule/rules");
  const preview = page.getByRole("region", { name: "Preview: 9:00 to 10:00 pm" });
  await expect(preview.getByText("Rebuilt with the rules as saved")).toBeVisible();
  const hour = preview.getByRole("list", { name: "The hour, rebuilt" });
  // 9:29 pm, cued during Beat Tape Live: the credit in it, as the rule says (every break).
  await expect(hour.getByRole("img", { name: "Bumper :10, Credit :15, Bumper :10, Open 1:20, ID :05" })).toBeVisible();
  const credit = page.getByRole("radiogroup", { name: "How often: Thank-you credit" });
  await credit.getByRole("radio", { name: "Never" }).click();
  // Rebuilt before saving: the credit is gone from the break, and nothing is saved yet.
  await expect(preview.getByText("Rebuilt with the rules as set. Nothing is saved yet")).toBeVisible();
  await expect(hour.getByRole("img", { name: "Bumper :10, Bumper :10, Open 1:35, ID :05" })).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  // The station ID can't be never: its chip is crossed out and can't be chosen.
  await expect(page.getByRole("radiogroup", { name: "How often: Station ID" }).getByRole("radio", { name: "Never" })).toBeDisabled();
  await page.getByRole("button", { name: "Save break rules" }).click();
  await expect(page.getByText("Break rules saved.")).toBeVisible();
  await expect(preview.getByText("Rebuilt with the rules as saved")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save break rules" })).toBeDisabled();
  // Saved: it's still so after a reload, and the Log's break is built the same way.
  await page.reload();
  await expect(page.getByRole("radiogroup", { name: "How often: Thank-you credit" }).getByRole("radio", { name: "Never" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("tab", { name: "Log" }).click();
  await page.getByRole("list", { name: "The rundown" }).getByRole("button", { name: /Spots placed at 9:09 pm/ }).click();
  await expect(page.getByRole("region", { name: "Break, 9:29:00 pm" }).getByRole("img", { name: "Bumper :10, Bumper :10, Open 1:35, ID :05" })).toBeVisible();
});

// A247: breaks at set times each hour. Clock breaks at :15 and :45, seen in the hour rebuilt before saving, then saved.
test("BEAT sets clock breaks at :15 and :45, sees the preview change, and saves", async ({ page }) => {
  await signInAs(page, "kai");
  await page.goto("/control/beat/schedule/rules");
  await page.getByRole("button", { name: "An hour later" }).click();
  const preview = page.getByRole("region", { name: "Preview: 10:00 to 11:00 pm" });
  const hour = preview.getByRole("list", { name: "The hour, rebuilt" });
  await expect(preview.getByText("Rebuilt with the rules as saved")).toBeVisible();
  // Every 30 minutes: Slow Hours' first break is at 11:00 pm, past this hour.
  await expect(hour.getByText("Slow Hours")).toBeVisible();
  await expect(hour.getByText("10:45:00")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Breaks come" }).selectOption("clock");
  const minutes = page.getByRole("group", { name: "Minutes past the hour" });
  for (const m of [":15", ":45", ":00", ":30"]) await minutes.getByRole("button", { name: m }).click();
  await expect(minutes.getByRole("button", { name: ":15" })).toHaveAttribute("aria-pressed", "true");
  await expect(minutes.getByRole("button", { name: ":30" })).toHaveAttribute("aria-pressed", "false");
  // Rebuilt before saving: Slow Hours pauses at 10:45 (Late Crate fills its slot, so it isn't cut at 10:15).
  await expect(preview.getByText("Rebuilt with the rules as set. Nothing is saved yet")).toBeVisible();
  await expect(hour.getByText("10:45:00")).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save break rules" }).click();
  await expect(page.getByText("Break rules saved.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save break rules" })).toBeDisabled();
  // Saved: still so after a reload.
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Breaks come" })).toHaveValue("clock");
  await expect(page.getByRole("group", { name: "Minutes past the hour" }).getByRole("button", { name: ":45" })).toHaveAttribute("aria-pressed", "true");
});

test("BEAT fills dead air from the Add drawer", async ({ page }) => {
  await signInAs(page, "kai");
  await page.goto("/control/beat/schedule");
  await page.getByRole("button", { name: "Dead air at 11:40 pm, 2 hr 20 min" }).click();
  await page.getByRole("list", { name: "The rundown" }).getByRole("button", { name: /^Fill/ }).click();
  const drawer = page.getByRole("dialog", { name: "Add at 11:40 pm" });
  await expect(drawer.getByText("2 hr 20 min free, until Late Crate, ep. 12 at 2:00 am")).toBeVisible();
  await expect(drawer.getByText("Fits").first()).toBeVisible();
  await drawer.getByLabel("Search your library").fill("Crate Session 01");
  await drawer.getByRole("button", { name: /^Crate Session 01 1:59:00\. Leaves 21 min Fits/ }).click();
  // It joins a draft: edit mode, with the change checked.
  const tray = page.getByRole("region", { name: "Your changes" });
  await expect(tray.getByText("1 change, checked: nothing blocks publishing")).toBeVisible();
  await expect(tray.getByText("Crate Session 01 goes on at 11:40 pm")).toBeVisible();
  await tray.getByRole("button", { name: "Publish 1 change" }).click();
  await expect(page.getByText("1 change published.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Dead air at 1:39 am, 21 min$/ })).toBeVisible();
});

// A246 phase 4: a block's end is a handle on the rundown in edit mode. Dragged below Beat Tape
// Live, it takes the start of the row under it; the rows say who joins, and the dry run's line too.
test("BEAT moves where Late Crate Nights ends on the log, and publishes it", async ({ page }) => {
  await signInAs(page, "kai");
  await page.goto("/control/beat/schedule");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const log = page.getByRole("list", { name: "The rundown, being edited" });
  // On air since 8:00 pm: its start stays; only its end moves.
  await expect(log.getByText("Late Crate Nights started 8:00 pm")).toBeVisible();
  await expect(log.getByRole("button", { name: /Move the start of Late Crate Nights/ })).toHaveCount(0);
  const end = log.getByRole("button", { name: "Move the end of Late Crate Nights, now 9:00 pm" });
  await end.scrollIntoViewIfNeeded();
  const grip = (await end.boundingBox())!;
  const below = (await log.locator("[data-row]").filter({ hasText: "Late Crate, ep. 15" }).first().boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, below.y + 2, { steps: 12 });
  // While dragging: where it would land, and who that brings in.
  await expect(log.getByText("Ends 10:00 pm. Beat Tape Live joins it")).toBeVisible();
  await expect(log.getByText("Joins Late Crate Nights")).toBeVisible();
  await page.mouse.up();
  await expect(log.getByText("Ends 10:00 pm, was 9:00 pm")).toBeVisible();
  await expect(log.getByText("Live, so it keeps its start. Member")).toBeVisible();
  const tray = page.getByRole("region", { name: "Your changes" });
  await expect(tray.getByText("1 change, checked: nothing blocks publishing")).toBeVisible();
  await expect(tray.getByText("Late Crate Nights now ends at 10:00 pm, was 9:00 pm. Beat Tape Live joins it")).toBeVisible();
  await tray.getByRole("button", { name: "Publish 1 change" }).click();
  await expect(page.getByText("1 change published.")).toBeVisible();
  await expect(page.getByRole("list", { name: "The rundown" }).getByRole("button", { name: /^Late Crate Nights Block, 8:00 to 10:00 pm/ })).toBeVisible();
});

// A246 phase 4 (decision 6): an edited date back to its template, with what comes off said first.
test("BEAT resets an edited Wednesday to its template", async ({ page }) => {
  await signInAs(page, "kai");
  await page.goto("/control/beat/schedule/templates");
  await expect(page.getByRole("heading", { level: 2, name: "After work" })).toBeVisible();
  await expect(page.getByText("Sep 30 edited")).toBeVisible();
  await expect(page.getByText("Saving changes here rebuilds 14 upcoming weekdays. Sep 30, edited by hand, is kept as an exception.")).toBeVisible();
  await page.getByRole("button", { name: "Reset Sep 30 to template" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset Sep 30 to After work?" });
  await expect(dialog.getByText("Crate Talk, 7:00 pm")).toBeVisible();
  await dialog.getByRole("button", { name: "Reset to template" }).click();
  await expect(page.getByText("Sep 30 is back to After work: 1 taken off.")).toBeVisible();
  await expect(page.getByText("Sep 30 edited")).toHaveCount(0);
  await expect(page.getByText("Saving changes here rebuilds 15 upcoming weekdays.")).toBeVisible();
  // The Log's Wednesday: from the template, no longer edited, and Crate Talk gone.
  await page.goto("/control/beat/schedule?day=2026-09-30");
  await expect(page.getByText('From "After work"', { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "The rundown" }).getByText("Crate Talk")).toHaveCount(0);
});

// A246 phase 4: the phone. The rundown with its chips, a break as a bottom sheet, and the dead-air
// warning's link (decision 9) opening straight to the gap with Fill ready.
test.describe("on the phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("BEAT opens a break as a sheet, and fills dead air from the warning's link", async ({ page }) => {
    await signInAs(page, "kai");
    await page.goto("/control/beat/schedule");
    await expect(page.getByText("Today, Sat Sep 26")).toBeVisible();
    await expect(page.getByRole("button", { name: "On air: Saturday Reel, 17 min left" })).toBeVisible();
    await page.getByRole("list", { name: "The rundown" }).getByRole("button", { name: /Spots placed at 9:09 pm/ }).click();
    const sheet = page.getByRole("dialog", { name: "Break, 9:29:00 pm" });
    await expect(sheet.getByText("Spots, placed at 9:09 pm")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    // The warning's link: the gap's day, and its start.
    await page.goto("/control/beat/schedule?day=2026-09-26&fill=2026-09-27T06:40:00.000Z");
    const fill = page.getByRole("dialog", { name: /^Dead air in/ });
    await expect(fill.getByText("Nothing is scheduled after 11:40 pm.")).toBeVisible();
    await fill.getByRole("button", { name: "Fill the gap" }).click();
    await expect(fill).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Dead air at 11:40 pm/ })).toHaveCount(0);
  });

  test("the Templates, Blocks and Break rules tabs say they're desk work, with the way back", async ({ page }) => {
    await signInAs(page, "kai");
    for (const [path, what] of [["templates", "Templates"], ["blocks", "Blocks"], ["rules", "Break rules"]] as const) {
      await page.goto(`/control/beat/schedule/${path}`);
      await expect(page.getByRole("heading", { name: `Open ${what} on a computer` })).toBeVisible();
    }
    await page.getByRole("link", { name: "Back to the Log" }).click();
    await expect(page).toHaveURL(/\/control\/beat\/schedule$/);
  });
});

// A246: every page the Schedule replaced still opens, on the right tab, with its query kept.
test("the old log, breaks and blocks addresses land on the Schedule's tabs with their query", async ({ page }) => {
  await signInAs(page, "kai");
  const LCN = "00000000-0000-4000-8000-0000000b1001";
  const offer = "00000000-0000-4000-8000-000000600001";
  const cases: Array<{ from: string; to: string; query?: Record<string, string>; tab?: string; shows?: string | RegExp }> = [
    { from: "/log", to: "/schedule", tab: "Log" },
    { from: "/log?view=day", to: "/schedule", query: { view: "day" }, tab: "Log" },
    { from: "/log?view=evening&day=sat", to: "/schedule", query: { view: "day", day: "sat" }, tab: "Log" },
    { from: "/log?view=week", to: "/schedule", query: { view: "week" }, tab: "Log" },
    { from: "/log?day=2026-10-03&edit=1", to: "/schedule", query: { day: "2026-10-03", edit: "1" }, tab: "Log", shows: /^Editing\. This date becomes an exception to "/ },
    { from: "/log?fill=2026-10-04T06:40:00.000Z", to: "/schedule", query: { fill: "2026-10-04T06:40:00.000Z" }, tab: "Log" },
    { from: "/log?day=2026-10-03&entry=e1&block=s1", to: "/schedule", query: { day: "2026-10-03", entry: "e1", block: "s1" }, tab: "Log" },
    { from: "/log?place=item-1", to: "/schedule", query: { edit: "1", add: "item-1" }, tab: "Log" },
    { from: "/log?switch=1", to: "/schedule", query: { switch: "1" }, tab: "Log" },
    { from: `/log/place/${offer}?term=barter`, to: `/schedule/place/${offer}`, query: { term: "barter" }, shows: /^Place / },
    { from: "/breaks", to: "/schedule", tab: "Log" },
    { from: "/breaks?rotation=backup", to: "/spot-market/rotation", query: { show: "backup" } },
    { from: "/blocks", to: "/schedule/blocks", tab: "Blocks" },
    { from: "/blocks/new", to: "/schedule/blocks/new", tab: "Blocks", shows: "Make the block" },
    { from: `/blocks/${LCN}`, to: `/schedule/blocks/${LCN}`, tab: "Blocks", shows: "What it airs" }
  ];
  for (const c of cases) {
    await page.goto(`/control/beat${c.from}`);
    await expect.poll(() => new URL(page.url()).pathname, { message: c.from }).toBe(`/control/beat${c.to}`);
    expect(Object.fromEntries(new URL(page.url()).searchParams), c.from).toEqual(c.query ?? {});
    if (c.tab) await expect(page.getByRole("tab", { name: c.tab, exact: true }), c.from).toHaveAttribute("aria-selected", "true");
    if (c.shows) await expect(page.getByText(c.shows).first(), c.from).toBeVisible();
    // The rail lights Schedule for each of them but the rotation.
    if (c.to.startsWith("/schedule")) await expect(page.getByRole("link", { name: "Schedule", exact: true }), c.from).toHaveAttribute("aria-current", "page");
  }

  // Station settings keeps a link where the break rule was.
  await page.goto("/control/beat/settings/breaks");
  await expect(page.getByText("Break rules moved to the Schedule.")).toBeVisible();
  await page.getByRole("link", { name: "Open Break rules" }).click();
  await expect(page).toHaveURL(/\/control\/beat\/schedule\/rules$/);
  await expect(page.getByRole("tab", { name: "Break rules" })).toHaveAttribute("aria-selected", "true");
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

test("BEAT's translators: connect YouTube, relay everything BEAT airs, and show the slate in breaks (follow-up Phase 3)", async ({ page }) => {
  await signInAs(page, "kai");
  await page.goto("/control/beat/translators");
  await expect(page.getByRole("heading", { name: "Translators" })).toBeVisible();
  const platforms = page.getByRole("list", { name: "Connected platforms" });
  await expect(platforms.getByRole("listitem").filter({ has: page.getByText("Twitch", { exact: true }) })).toContainText("inlandbeat, signed in");

  // YouTube, removed (confirmed) and connected again by signing in: the mock comes straight back.
  await page.getByRole("button", { name: "Remove YouTube" }).click();
  await page.getByRole("dialog", { name: "Remove YouTube?" }).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("YouTube removed. BEAT 12.1 no longer relays there.")).toBeVisible();
  await page.getByRole("button", { name: "Connect with Google" }).click();
  await expect(page.getByText("YouTube is connected.")).toBeVisible();
  await expect(page).toHaveURL(/\/control\/beat\/translators$/);
  await expect(platforms.getByRole("listitem").filter({ has: page.getByText("YouTube", { exact: true }) })).toContainText("Inland Beat channel, signed in. Opencast starts each broadcast for you");

  // What gets relayed: live shows only (free), then everything BEAT airs, by the hour.
  const modes = page.getByRole("radiogroup", { name: "What gets relayed" });
  await modes.getByRole("radio", { name: /Live shows only/ }).click();
  await expect(modes.getByRole("radio", { name: /Live shows only/ })).toHaveAttribute("aria-checked", "true");
  await modes.getByRole("radio", { name: /Everything BEAT 12\.1 airs/ }).click();
  await expect(page.getByText("BEAT 12.1 relays everything it airs, at $0.20 an hour.")).toBeVisible();
  await expect(modes.getByRole("radio", { name: /Everything BEAT 12\.1 airs/ })).toHaveAttribute("aria-checked", "true");

  // During breaks, relays show the station ID slate.
  const breaks = page.getByRole("radiogroup", { name: "During breaks, relays show" });
  await breaks.getByRole("radio", { name: "Station ID slate" }).click();
  await expect(breaks.getByRole("radio", { name: "Station ID slate" })).toHaveAttribute("aria-checked", "true");

  // Relayed this month, and Twitch's next restart, timed to a break.
  await expect(page.getByText("156.9 hours, $31.39 so far")).toBeVisible();
  await expect(page.getByRole("list", { name: "Next restarts" })).toContainText("Twitch restarts Saturday at 11:59 pm, during a break");
});
