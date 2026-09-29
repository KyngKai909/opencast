// The business flow (apps prompt, Phase 9): fund, list a spot, pause and resume it, sponsor a
// program, order and approve a spot. On the mock, as someone new who signs up; the mock-only
// panels play the review desk's and the stations' side. axe runs on the screens only this flow
// reaches (setup, a new spot's checks and rate, the code modal, a spot paused both ways, the
// sponsorship form, an order from asked to approved), in both grounds, at 1280 and at 406 wide.

import { expect, test, type Page } from "@playwright/test";
import { WIDTHS, axeBothGrounds, reducedMotion, type Width } from "./spots.support";

/** Moves to another area: the rail on the web; on the phone, the area's address. */
async function openArea(page: Page, width: Width, name: string, path: string) {
  if (width === "web") await page.getByRole("link", { name, exact: true }).click();
  else await page.goto(page.url().replace(/^(https?:\/\/[^/]+\/[0-9a-f-]{36})\/.*$/, `$1/${path}`));
}

test.use({ actionTimeout: 20_000 });

for (const width of Object.keys(WIDTHS) as Width[]) {
  test(`business flow at ${WIDTHS[width].width} wide: fund, list a spot, pause and resume it, sponsor a program, order and approve a spot`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize(WIDTHS[width]);
    await reducedMotion(page);
    const phone = width === "phone";
    const failures: string[] = [];
    const axe = async (label: string) => failures.push(...(await axeBothGrounds(page, `${width}: ${label}`)));

    await test.step("sign up", async () => {
      await page.goto("/");
      await page.getByLabel("Email").fill("maria@lomacycles.example");
      await page.getByRole("button", { name: "Email me a code" }).click();
      await expect(page.getByText("We sent a code to maria@lomacycles.example.")).toBeVisible();
      await page.getByLabel("Code").first().pressSequentially("424242");
    });

    await test.step("getting started: the business", async () => {
      await expect(page.getByRole("heading", { name: "Your business" })).toBeVisible();
      await axe("start, your business");
      await page.getByLabel("Business name").fill("Loma Cycles");
      await page.getByLabel("Category").selectOption("Shops");
      await page.getByLabel("Address").fill("11160 Anderson St, Loma Linda");
      await expect(page.getByText("Shops. Loma Linda")).toBeVisible();
      await page.getByRole("button", { name: "Continue" }).click();
    });

    await test.step("fund", async () => {
      await expect(page.getByRole("heading", { name: "Fund your balance" })).toBeVisible();
      await expect(page.getByText("A spot can be listed once your balance covers at least a day of its budget.")).toBeVisible();
      await axe("start, fund");
      await page.getByRole("radio", { name: /^Card Arrives right away/ }).check();
      await expect(page.getByRole("radio", { name: "$250" })).toBeChecked();
      await page.getByRole("button", { name: "Add $250 by card" }).click();
      // Stripe's card form stands in: the mock adds its test card.
      const card = page.getByRole("dialog", { name: "Add a card" });
      await expect(card).toContainText("In this demo it adds a test card");
      await axe("start, fund: add a card");
      await card.getByRole("button", { name: "Continue" }).click();
    });

    await test.step("list a spot: upload and checks", async () => {
      await expect(page.getByRole("heading", { name: "Your first spot" }).last()).toBeVisible();
      await axe("start, your first spot");
      await page.getByLabel("Call it").fill("Tune-ups in a day");
      await page.locator('input[type="file"]').setInputFiles({ name: "tune-ups.mp4", mimeType: "video/mp4", buffer: Buffer.from("a stand-in for the video") });
      await page.getByRole("button", { name: "Upload and check" }).click();

      // The checks, in the business shell now; the $250 is in.
      await expect(page.getByText("$250 is in your balance")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Tune-ups in a day", level: 1 })).toBeVisible();
      await expect(page.getByText("4 fine, 1 fixed, 1 for you")).toBeVisible();
      await expect(page.getByText("Phone number outside title safe")).toBeVisible();
      await axe("new spot, checks");
      await page.getByRole("button", { name: "Shrink to fit" }).click();
      await expect(page.getByText("Phone number outside title safe")).toBeHidden();

      // The code Opencast added, changed.
      await page.getByRole("button", { name: "Change" }).click();
      const code = page.getByRole("dialog", { name: "Change the code" });
      await expect(code).toContainText("Customers scan it or type it, and save the offer.");
      await axe("new spot, change the code");
      await code.getByLabel("Code").fill("TUNEUP");
      await code.getByLabel("Offer").fill("A free chain clean");
      await code.getByRole("button", { name: "Save" }).click();
      await expect(code).toBeHidden();
      await expect(page.getByText("Code TUNEUP added")).toBeVisible();
    });

    await test.step("list a spot: rate and budget", async () => {
      await page.getByRole("button", { name: "Next: rate and budget" }).click();
      await expect(page.getByRole("heading", { name: "Tune-ups in a day: rate and budget" })).toBeVisible();
      await expect(page.getByText("4 stations will see it")).toBeVisible();
      // $100 in total and no cap a day, so the mock's stations can spend it all at once below.
      await page.getByLabel("In total").fill("100");
      await page.getByLabel("Most per day").fill("");
      await expect(page.getByText("About 46 airings in all. You have $242.45 available.")).toBeVisible();
      await axe("new spot, rate and budget");
      await page.getByRole("button", { name: "List Tune-ups in a day" }).click();

      // In review; the mock's review desk passes it, and stations add it.
      await expect(page.getByText("It's checked for category and content before stations can see it, usually within a few hours.")).toBeVisible();
      await axe("spot, in review");
      await page.getByRole("button", { name: "Pass review now" }).click();
      await expect(page.getByText("In the market. Stations choose whether to add it")).toBeVisible();
      await page.getByRole("button", { name: "Stations add it to their rotations" }).click();
      await expect(page.getByText("In rotation on CIVC, BEAT and SAZN")).toBeVisible();
      await axe("spot, in rotation");
    });

    await test.step("pause it and bring it back", async () => {
      await page.getByRole("button", { name: "Pause it" }).click();
      await expect(page.getByText("You paused Tune-ups in a day.")).toBeVisible();
      await expect(page.getByText("Bring it back and it's back in the market, and the 3 stations are told")).toBeVisible();
      await axe("spot, paused by you");
      await page.getByRole("button", { name: "Bring it back" }).click();
      await expect(page.getByText("Tune-ups in a day is back in the market. CIVC, BEAT and SAZN are told.")).toBeVisible();
      await expect(page.getByText("CIVC, BEAT and SAZN were told it's back. Each chooses whether to add it again.")).toBeVisible();
      await page.getByRole("button", { name: "Stations add it to their rotations" }).click();
      await expect(page.getByText("In rotation on CIVC, BEAT and SAZN")).toBeVisible();
    });

    await test.step("paused when its budget is spent, resumed by raising it", async () => {
      await page.getByRole("button", { name: "Air it until the budget is spent" }).click();
      await expect(page.getByText("All $100 of Tune-ups in a day's budget has been spent.")).toBeVisible();
      await expect(page.getByText("Raise the budget and it's back in the market, and the 3 stations are told")).toBeVisible();
      await axe("spot, budget spent");
      if (phone) {
        // On the phone the banner's "Bring it back" opens the sheet.
        await page.getByRole("button", { name: "Bring it back" }).click();
        const sheet = page.getByRole("dialog", { name: "Bring Tune-ups in a day back" });
        await expect(sheet).toContainText("From your $142.45 available. Nothing is charged.");
        await axe("spot, budget spent: raise sheet");
        await sheet.getByRole("radio", { name: "$100" }).check();
        await sheet.getByRole("button", { name: "Raise budget by $100" }).click();
        await expect(sheet).toBeHidden();
      } else {
        await page.getByRole("radio", { name: "$100" }).check();
        await page.getByRole("button", { name: "Raise budget to $200" }).click();
      }
      await expect(page.getByText("CIVC, BEAT and SAZN were told it's back. Each chooses whether to add it again.")).toBeVisible();
      await expect(page.getByText("$100.00 of $200")).toBeVisible();
    });

    await test.step("sponsor a program", async () => {
      await openArea(page, width, "Sponsorships", "sponsorships");
      await expect(page.getByText("No sponsorships yet.")).toBeVisible();
      // The phone's list has no way to start one (as the frames draw it): the form's own address.
      if (phone) await openArea(page, width, "", "sponsorships/new");
      else await page.getByRole("link", { name: "Sponsor a station or program" }).click();
      await expect(page.getByRole("heading", { name: "Sponsor a station or program" })).toBeVisible();
      await expect(page.getByText("Near Loma Linda")).toBeVisible();
      await axe("new sponsorship");
      await page.getByRole("radio", { name: /Tamales for forty, on SAZN 18\.1/ }).check();
      await expect(page.getByText("SAZN's minimum is $40")).toBeVisible();
      await page.getByLabel("Your credit").fill("Bicycle tune-ups on Anderson Street in Loma Linda");
      await page.getByRole("button", { name: "Send to SAZN" }).click();
      await expect(page.getByText("Sent to SAZN.")).toBeVisible();
      const row = phone ? page.getByRole("main") : page.getByRole("row", { name: /Tamales for forty on SAZN 18\.1/ });
      await expect(row).toContainText("Waiting for SAZN");
      await axe("sponsorships, waiting for the station");

      // The station's side, from the mock-only panel.
      await page.getByRole("button", { name: "SAZN approves Tamales for forty" }).click();
      await expect(page.getByText("SAZN said yes to your sponsorship")).toBeVisible();
      await expect(row).toContainText("Approved");
    });

    await test.step("order a spot and approve it", async () => {
      await openArea(page, width, "Made for you", "orders");
      await expect(page.getByText("No orders yet. A station or Opencast's studio can make your first spot.")).toBeVisible();
      if (phone) await openArea(page, width, "", "orders/new");
      else await page.getByRole("link", { name: "Order a spot" }).click();
      await expect(page.getByRole("heading", { name: "Order a spot" })).toBeVisible();
      await axe("new order");
      await page.getByLabel("Call it").fill("Spring tune-ups");
      await page.getByRole("radio", { name: ":30" }).check();
      await page.getByLabel("What it's about").fill("A tune-up in a day, on Anderson Street. Bring your bike in the morning, ride it home at night.");
      await page.getByLabel("It must say").fill("11160 Anderson St, Loma Linda");
      await page.getByLabel("Needed by").fill("2026-10-16");
      await page.getByRole("button", { name: "Ask BEAT for a quote" }).click();
      await expect(page.getByText("Sent to BEAT for a quote.")).toBeVisible();
      await expect(page.getByText("Asked September 26. BEAT quotes here before anything is paid.")).toBeVisible();
      await axe("order, asked");

      await page.getByRole("button", { name: "BEAT quotes" }).click();
      await expect(page.getByText("$140.00, delivered by October 9")).toBeVisible();
      await page.getByRole("button", { name: "Accept BEAT's quote" }).click();
      const accept = page.getByRole("dialog", { name: "Accept BEAT's quote" });
      await expect(accept).toContainText("$140.00 for Spring tune-ups.");
      await expect(accept).toContainText("$2.45");
      await axe("order, accept the quote");
      await accept.getByRole("button", { name: "Accept and hold $140.00" }).click();
      await expect(accept).toBeHidden();
      await expect(page.getByText("$140.00 held for Spring tune-ups.")).toBeVisible();
      await expect(page.getByText("BEAT is making it. It's yours to review here when it's delivered.", { exact: false })).toBeVisible();

      await page.getByRole("button", { name: "BEAT delivers" }).click();
      await expect(page.getByRole("button", { name: "Approve and make it a spot" })).toBeVisible();
      await axe("order, delivered");
      await page.getByRole("button", { name: "Approve and make it a spot" }).click();
      await expect(page.getByText("Spring tune-ups is in your Spots now.")).toBeVisible();
      await expect(page.getByText("Approved. It's a spot now")).toBeVisible();
      if (!phone) await expect(page.getByRole("link", { name: "Set a rate and budget" })).toBeVisible();
      await axe("order, approved");
    });

    expect(failures, failures.join("\n\n")).toEqual([]);
  });
}
