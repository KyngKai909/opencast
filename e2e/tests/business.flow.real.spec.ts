// The business flow against the real API (playwright.real.config.ts), as far as the API goes: fund,
// list a spot (its code picked by Opencast at upload), pause and resume it, check a code at the
// counter, the station answering a sponsorship, order a spot and accept its quote; and the
// business app's requests (2026-09-29): the place lookup, what can be sponsored, receipts,
// connections, the Redeem switch, the logo, editing a location in place, and closing an account.
// What the UI can't do in real mode is arranged with api() and says so: adding money (the card
// form is mock-only), the review desk, stations adding a spot, the station's answers, and the
// maker's delivery (a multipart upload api() can't send), so approving a delivery stays on the
// mocks (business.flow.spec.ts).

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
  // P4: Opencast picks the code as the upload is checked: the business's first word and a number.
  await expect(page.getByText(/^Code LOMA\d+ added$/)).toBeVisible();
  await expect(page.getByText("$250.00").first()).toBeVisible();
  await page.getByRole("button", { name: "Next: rate and budget" }).click();
  await expect(page.getByRole("heading", { name: "Tune-ups in a day: rate and budget" })).toBeVisible();
  // An online business: its market is chosen already, and the API's matches list its stations: the
  // TV band as drawn (P8), so the market's two radio stations are listed as not chosen.
  await expect(page.getByText("4 stations will see it")).toBeVisible();
  await expect(page.getByText("Radio band, not chosen", { exact: false })).toHaveCount(2);
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
  // A pause by hand reads waiting_for_you (A115), with the pause story (P6): BEAT had it.
  await expect(page.getByText("Waiting for you", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("You paused Tune-ups in a day.")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("BEAT 12.1");
  await page.getByRole("button", { name: "Bring it back" }).click();
  await expect(page.getByText("Tune-ups in a day is back in the market.")).toBeVisible();
  await expect(page.getByText("BEAT was told it's back. Each chooses whether to add it again.")).toBeVisible();

  // The Redeem tool starts off for an online business (P12): turned on in Settings, it checks the
  // spot's code without counting it (B5).
  const code = (await api<{ code: { code: string } | null }>(`/spots/${spotId}`, { as: "loma-cycles" })).code!.code;
  await page.goto(`/${business}/redeem`);
  await expect(page.getByText("Redeem is off for this business. Turn it on in Settings to mark codes used at the counter.")).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).last().click();
  await page.getByRole("switch", { name: "Redeem in the app" }).click();
  await expect(page.getByRole("switch", { name: "Redeem in the app" })).toHaveAttribute("aria-checked", "true");
  await page.goto(`/${business}/redeem`);
  await page.getByPlaceholder("Type a code").fill(code);
  await expect(page.getByRole("button", { name: `${code}. Type another code` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Redeem", exact: true })).toBeVisible();
  const today = await api<{ on: boolean; redeemedToday: number }>(`/businesses/${business}/redeem/today`, { as: "loma-cycles" });
  expect(today).toMatchObject({ on: true, redeemedToday: 0 });
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

test("the place lookup says when there's none; what can be sponsored; receipts; a checkout", async ({ page }) => {
  // P10: the run has no place lookup (PLACES_URL), so a location's address can't be looked up
  // (503 not_available); Online still works (the first test).
  await signIn(page, "corner-bakery");
  await page.goto("/");
  await page.getByLabel("Business name").fill("Corner Bakery");
  await page.getByLabel("Category").selectOption("Coffee and food");
  await page.getByLabel("Address").fill("101 E State St, Redlands");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Addresses can't be looked up here yet. Choose Online to go on.")).toBeVisible();

  // P16: what Orange Street can sponsor near it, BEAT's programs among them.
  const orange = seed.businesses.orange;
  await signIn(page, "maya");
  await page.goto(`/${orange}/sponsorships/new`);
  await expect(page.getByRole("radio", { name: /Beat Tape Live, on BEAT 12\.1/ })).toBeVisible();

  // E4: its receipts, the $60 it added among them, each with a PDF.
  await page.goto(`/${orange}/settings/money`);
  const receipts = page.getByRole("list", { name: "Receipts and statements" });
  await expect(receipts).toContainText("Money added");
  const pdf = receipts.getByRole("link", { name: /PDF$/ }).first();
  await expect(pdf).toHaveAttribute("href", /^http:\/\/localhost:8788\/v1\/receipts\/.+\/pdf\?sig=/);
  const res = await page.request.get((await pdf.getAttribute("href"))!);
  expect(res.headers()["content-type"]).toContain("application/pdf");

  // P20: a checkout connects with its webhook secret; the owner sees where its webhooks go.
  await page.goto(`/${orange}/settings/connections`);
  const checkout = page.locator(".bz-conn__row", { hasText: "Your online checkout" });
  await checkout.getByRole("button", { name: "Connect" }).click();
  await checkout.getByRole("button", { name: "Stripe" }).click();
  await checkout.getByLabel("Stripe's signing secret").fill("whsec_e2e_secret");
  await checkout.getByRole("button", { name: "Connect Stripe" }).click();
  await expect(checkout).toContainText("Stripe is connected. Codes used online are counted too");
  await expect(checkout).toContainText("/v1/webhooks/checkout/");
  const conns = await api<{ checkout: { connected: boolean; provider: string } }>(`/businesses/${orange}/connections`, { as: "maya" });
  expect(conns.checkout).toMatchObject({ connected: true, provider: "stripe" });
  await checkout.getByRole("button", { name: "Disconnect" }).click();
  await expect(checkout).toContainText("Connect Shopify, Stripe or Square and codes used online are counted too");
});

test("the logo, and a location changed in place", async ({ page }) => {
  // P11 and P26, on a business of its own with a location in Redlands.
  const b = await api<{ id: string; locations: Array<{ id: string }> }>("/businesses", {
    as: "logo-co",
    body: { name: "Logo Co", category: "Shops", customersWhere: "location", locations: [{ kind: "location", streetAddress: "204 Orange St", city: "Redlands", latitude: 34.0556, longitude: -117.1825 }] }
  });
  await signIn(page, "logo-co");
  await page.goto(`/${b.id}/settings/business`);
  const png = test.info().outputPath("logo.png");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x2E6B5A:s=256x256", "-frames:v", "1", png]);
  await page.getByLabel("Choose a logo").setInputFiles(png);
  await expect(page.getByRole("img", { name: "Logo Co's logo" })).toHaveCount(1);
  expect((await api<{ logoUrl: string | null }>(`/businesses/${b.id}`, { as: "logo-co" })).logoUrl).toBeTruthy();

  // The address changes where it is (the first place stays first). Without a place lookup the
  // app places it by its town.
  const street = page.getByLabel("Street address");
  await street.fill("210 Orange St, Redlands");
  await street.press("Enter");
  await expect.poll(async () => (await api<{ locations: Array<{ id: string; streetAddress: string | null }> }>(`/businesses/${b.id}`, { as: "logo-co" })).locations[0]).toMatchObject({ id: b.locations[0]!.id, streetAddress: "210 Orange St" });
});

test("closing an account: not while money can only go back to a card; closed when there's none", async ({ page }) => {
  const market = seed.markets.inlandEmpire;
  const make = (name: string) => api<{ id: string }>("/businesses", { as: "closing-co", body: { name, category: "Shops", customersWhere: "online", marketIds: [market] } });
  const funded = await make("Closing Co");
  await fund("closing-co", funded.id, 20);
  const empty = await make("Empty Co");
  await signIn(page, "closing-co");

  // P21: the $20 came by card, and money can't go back to a card (409 no_source).
  await page.goto(`/${funded.id}/settings/close`);
  await expect(page.getByText("can't go back to a card", { exact: false })).toBeVisible();
  await page.getByLabel("Type Closing Co to close it").fill("Closing Co");
  await page.getByRole("button", { name: "Close the account" }).click();
  await expect(page.getByText("Add a bank or Clear account to send your money back to, then close the account.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Money and receipts" }).last()).toBeVisible();

  // Nothing to send back: it closes, and answers 404 from then on.
  await page.goto(`/${empty.id}/settings/close`);
  await page.getByLabel("Type Empty Co to close it").fill("empty co");
  await page.getByRole("button", { name: "Close the account" }).click();
  await expect(page.getByText("Empty Co is closed")).toBeVisible();
  await api(`/businesses/${empty.id}`, { as: "closing-co", status: 404 });
});
