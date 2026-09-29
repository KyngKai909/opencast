// The business flow against the real API (playwright.real.config.ts), as far as the API goes: fund,
// list a spot, pause and resume it, the station answering a sponsorship, order a spot and accept
// its quote. What the UI can't do in real mode is arranged with api() and says so: adding money
// (the card form is mock-only), the review desk, stations adding a spot, the station's answers,
// and the maker's delivery (a multipart upload api() can't send), so approving a delivery stays on
// the mocks (spots.flow.spec.ts).

import { execFileSync } from "node:child_process";
import { api, expect, seed, signIn, test } from "../lib/real";

const $ = (d: number) => Math.round(d * 1_000_000);

/** A real :30 at 1920 by 1080 with sound, so the API's checks can read it (ffmpeg, as the API uses). */
function makeSpotFile(path: string): string {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x8C3B7A:s=1920x1080:r=25:d=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=30", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "40", "-c:a", "aac", "-shortest", path]);
  return path;
}

async function fund(person: string, businessId: string, dollars: number) {
  const sources = await api<Array<{ id: string; kind: string }>>(`/businesses/${businessId}/funding-sources`, { as: person, method: "POST", body: { kind: "card", token: "tok_4242" } });
  await api(`/businesses/${businessId}/deposits`, { as: person, method: "POST", body: { amountMicros: $(dollars), fundingSourceId: sources.at(-1)!.id } });
}

test("someone new: start a business, fund it, list a spot, pause it and bring it back", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "loma-cycles");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your business" })).toBeVisible();
  await page.getByLabel("Business name").fill("Loma Cycles");
  await page.getByLabel("Category").selectOption("Shops");
  // "A location" needs the address lookup (P10, not in the API): online, in a market, doesn't.
  await page.getByRole("radio", { name: "Online" }).check();
  await page.getByText("Inland Empire", { exact: true }).click();
  await expect(page.getByText("Shops. Online")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Fund your balance" })).toBeVisible();
  const business = new URL(page.url()).pathname.split("/")[1]!;
  await fund("loma-cycles", business, 250);
  await page.goto(`/${business}/start/spot`);
  await expect(page.getByRole("heading", { name: "Your first spot" }).last()).toBeVisible();
  await page.getByLabel("Call it").fill("Tune-ups in a day");
  await page.locator('input[type="file"]').setInputFiles(makeSpotFile(test.info().outputPath("tune-ups.mp4")));
  await page.getByRole("button", { name: "Upload and check" }).click();
  await expect(page.getByRole("heading", { name: "Tune-ups in a day", level: 1 })).toBeVisible();
  await expect(page.getByText("Picture 1920 by 1080")).toBeVisible();
  await expect(page.getByText("$250.00").first()).toBeVisible();
  await page.getByRole("button", { name: "Next: rate and budget" }).click();
  await expect(page.getByRole("heading", { name: "Tune-ups in a day: rate and budget" })).toBeVisible();
  // An online business: its market is chosen already, and the API's matches list its stations.
  await expect(page.getByText("6 stations will see it")).toBeVisible();
  await page.getByRole("button", { name: "List Tune-ups in a day" }).click();
  await expect(page.getByText("In review", { exact: true })).toBeVisible();
  const spotId = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(page.getByText("It's checked for category and content before stations can see it")).toBeVisible();

  // The review desk passes it (an admin, through the API), and BEAT adds it to its rotation.
  await api(`/review/spots/${spotId}`, { as: "dee", method: "POST", body: { decision: "approve" } });
  await page.reload();
  await expect(page.getByText("In the market. Stations choose whether to add it")).toBeVisible();
  await api(`/stations/${seed.stations.beat.id}/rotations/main`, { as: "kai", method: "PUT", body: { spotIds: [spotId] } });
  await page.reload();
  await expect(page.getByText("Pause it")).toBeVisible();
  await expect(page.getByText("In rotation on 1 station").first()).toBeVisible();
  await page.getByRole("button", { name: "Pause it" }).click();
  await expect(page.getByText("Waiting for you", { exact: true }).first()).toBeVisible();
  // The API answers paused_budget for a pause by hand; with budget left it reads as waiting for you.
  await expect(page.getByText("Stations don't see it")).toBeVisible();
  await page.getByRole("button", { name: "Bring it back" }).click();
  await expect(page.getByText("Tune-ups in a day is back in the market.")).toBeVisible();
  await expect(page.getByText("In the market. Stations choose whether to add it")).toBeVisible();
});

test("Orange Street Coffee: the station answers a sponsorship; order a spot and accept the quote", async ({ page }) => {
  test.setTimeout(180_000);
  const orange = seed.businesses.orange;
  await signIn(page, "maya");

  // The seeded $50 a month for Late Crate, waiting for BEAT; Kai approves it in master control.
  await page.goto(`/${orange}/sponsorships`);
  const row = page.getByRole("row", { name: /Late Crate/ });
  await expect(row).toContainText("Waiting for BEAT");
  const [late] = await api<Array<{ id: string }>>(`/businesses/${orange}/sponsorships`, { as: "maya" });
  await api(`/sponsorships/${late!.id}/decision`, { as: "kai", method: "POST", body: { decision: "approve" } });
  await page.reload();
  // It starts today, so it reads as on the air rather than approved.
  await expect(row).toContainText("Credited on air");

  // Order a spot from BEAT.
  await fund("maya", orange, 200);
  await page.goto(`/${orange}/orders/new`);
  await expect(page.getByRole("heading", { name: "Order a spot" })).toBeVisible();
  await page.getByLabel("Call it").fill("Pumpkin season");
  await page.getByRole("radio", { name: ":30" }).check();
  await page.getByLabel("What it's about").fill("Pumpkin lattes are back at Orange Street, all October.");
  await page.getByLabel("Needed by").fill(new Date(Date.now() + 21 * 86400e3).toISOString().slice(0, 10));
  await expect(page.getByRole("radio", { name: /BEAT 12\.1/ })).toContainText("About a week");
  await page.getByRole("button", { name: /^Ask BEAT for a quote/ }).click();
  await expect(page.getByText("Sent to BEAT for a quote.")).toBeVisible();
  const orderId = new URL(page.url()).pathname.split("/").at(-1)!;

  // Kai quotes in master control.
  const deliverBy = new Date(Date.now() + 14 * 86400e3).toISOString().slice(0, 10);
  await api(`/orders/${orderId}/quote`, { as: "kai", method: "POST", body: { action: "quote", priceMicros: $(120), deliverBy, roundsIncluded: 1, voicedBy: null } });
  await page.reload();
  await expect(page.getByText(/^\$120\.00, delivered by/)).toBeVisible();
  await page.getByRole("button", { name: "Accept BEAT's quote" }).click();
  const accept = page.getByRole("dialog", { name: "Accept BEAT's quote" });
  await expect(accept).toContainText("$120.00 for Pumpkin season.");
  await accept.getByRole("button", { name: "Accept and hold $120.00" }).click();
  await expect(page.getByText("$120.00 held for Pumpkin season.")).toBeVisible();
  await expect(page.getByText("BEAT is making it. It's yours to review here when it's delivered.", { exact: false })).toBeVisible();
  // The delivery is a multipart upload from the maker (api() can't send one): approving it runs on the mocks.
});

test("what the API doesn't have yet says so", async ({ page }) => {
  // P10: a location's address can't be looked up; Online still works (the first test).
  await signIn(page, "corner-bakery");
  await page.goto("/");
  await page.getByLabel("Business name").fill("Corner Bakery");
  await page.getByLabel("Category").selectOption("Coffee and food");
  await page.getByLabel("Address").fill("101 E State St, Redlands");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Addresses can't be looked up here yet. Choose Online to go on.")).toBeVisible();

  // P16: nothing to choose from on the sponsorship form. E4: receipts aren't listed.
  await signIn(page, "maya");
  await page.goto(`/${seed.businesses.orange}/sponsorships/new`);
  await expect(page.getByText("The stations and programs that take sponsors can't be listed here yet.")).toBeVisible();
  await page.goto(`/${seed.businesses.orange}/settings/money`);
  await expect(page.getByText("Receipts aren't listed here yet.", { exact: false })).toBeVisible();
});
