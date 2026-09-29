// Master control's flows (apps prompt, Phase 9), on the mock at its Saturday evening, 8:42 pm:
// sign on for the first time, carry a program, fill a break from the spot market, approve a
// sponsorship. What each screen says is the reference frames' copy (docs/reference/control).

import { expect, test } from "@playwright/test";
import { signInAs } from "./control.support";

test.use({ viewport: { width: 1280, height: 900 } });

test("someone new signs on for the first time", async ({ page }) => {
  // The mock prepares an upload for air in 20 seconds, as the real one takes its time.
  test.setTimeout(180_000);
  // Signing in: a wrong code is refused, the right one lets them in.
  await page.goto("/");
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
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(page.getByText("Nothing here yet. Drop your first programs and a station ID above.")).toBeVisible();
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
  await page.goto("/beat/market");
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
  await page.goto("/beat/market/carried");
  const row = page.getByRole("row").filter({ hasText: "Nights at the observatory" });
  await expect(row).toContainText("From Opencast catalog");
  await expect(row).toContainText("Sundays at 8:00 pm");
  await expect(row).toContainText("One sponsor credit an hour");
});

test("BEAT fills a break from the spot market", async ({ page }) => {
  await signInAs(page, "kai");
  await page.goto("/beat/breaks");

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
  await page.goto("/beat/sponsors");

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
