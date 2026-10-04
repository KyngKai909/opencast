// Master control's flows against the real API (playwright.real.config.ts), on the seed: carry a
// program (Jess's Saturday Reel, open to any station), fill BEAT's breaks from the spot market
// (Orange Street Coffee's spots, BEAT's rotation empty), approve a sponsorship (one Orange Street
// offers here, so the seed's waiting request stays for the other specs), and a new person starting
// a station. Each checks what the API kept.

import { api, expect, seed, signIn, test } from "../lib/real";

const beatId = () => seed.stations.beat.id;

test("BEAT carries Saturday Reel from the syndication market", async ({ page }) => {
  await signIn(page, "kai");
  await page.goto(`/control/beat/market/offers/${seed.offers.saturdayReel}`);
  await expect(page.getByRole("heading", { name: "Saturday Reel", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Choose terms" }).click();
  const terms = page.getByRole("dialog");
  await expect(terms).toContainText("Saturday Reel");
  await terms.getByRole("button", { name: "Choose a slot" }).click();

  await expect(page.getByRole("heading", { name: "Place Saturday Reel" })).toBeVisible();
  await page.getByRole("button", { name: "Carry Saturday Reel" }).click();
  const toast = page.getByText(/^Saturday Reel is in your log from /);
  await expect(toast).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 20_000 });

  // The agreement is on the API, and Carried by BEAT lists it.
  await expect
    .poll(async () => (await api<{ carrying: { program: { id: string } }[] }>(`/stations/${beatId()}/carriage/agreements`, { as: "kai" })).carrying.some((a) => a.program.id === seed.programs.saturdayReel))
    .toBe(true);
  await page.goto("/control/beat/market/carried");
  await expect(page.getByRole("row").filter({ hasText: "Saturday Reel" })).toContainText(/REEL/);
});

test("BEAT fills its breaks from the spot market", async ({ page }) => {
  await signIn(page, "kai");
  // A246: Breaks is the Schedule now.
  await page.goto("/control/beat/breaks");
  await expect(page).toHaveURL(/\/control\/beat\/schedule$/);
  await expect(page.getByRole("heading", { name: "Schedule", level: 1 })).toBeVisible();
  await page.goto("/control/beat/spot-market");
  await expect(page.getByRole("heading", { name: "Spot market" })).toBeVisible();
  const add = page.getByRole("button", { name: "Add Orange Street Coffee to your rotation" }).first();
  await add.click();
  await expect(page.getByRole("row").filter({ hasText: "Orange Street Coffee" }).first()).toContainText("In rotation");

  // The rotation is on the API.
  await expect
    .poll(async () => {
      const r = await api<{ main: { spots: { spotId: string }[] } }>(`/stations/${beatId()}/rotations`, { as: "kai" });
      return r.main.spots.some((s) => s.spotId === seed.spots.fallMenu || s.spotId === seed.spots.nightOwl);
    })
    .toBe(true);
  // The rotation tab says it was added (C.3's toast, A246).
  await page.goto("/control/beat/spot-market/rotation");
  await expect(page.getByText(/^Orange Street Coffee added\./)).toBeVisible();
});

test("BEAT approves a sponsorship of Beat Tape Live", async ({ page }) => {
  // Orange Street Coffee offers $75 a month for Beat Tape Live (the seed's Late Crate request is left for the other specs).
  const offered = await api<{ id: string }>(`/businesses/${seed.businesses.orange}/sponsorships`, {
    as: "maya",
    body: { stationId: beatId(), programId: seed.programs.beatTapeLive, monthlyMicros: 75_000_000, creditText: "Orange Street Coffee, open till midnight.", startsOn: new Date().toISOString().slice(0, 10) }
  });

  await signIn(page, "kai");
  await page.goto("/control/beat/sponsors");
  await expect(page.getByRole("heading", { name: "Sponsors", exact: true })).toBeVisible();
  const request = page.getByText("Orange Street Coffee wants to sponsor Beat Tape Live");
  await expect(request).toBeVisible();
  await page.goto(`/control/beat/sponsors/${offered.id}`);
  await expect(request).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  const toast = page.getByText("Orange Street Coffee approved.");
  await expect(toast).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 20_000 });

  const state = async () => (await api<{ sponsorships: { id: string; state: string }[] }>(`/stations/${beatId()}/sponsorships`, { as: "kai" })).sponsorships.find((x) => x.id === offered.id)?.state;
  await expect.poll(state).toBe("approved");
  await page.reload();
  await expect(request).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText("Beat Tape Live");
});

test("someone new starts a station", async ({ page }) => {
  await signIn(page, "first-station-owner");
  await page.goto("/control");
  await expect(page.getByRole("heading", { name: "Start a station" })).toBeVisible();
  await page.getByRole("link", { name: "Start a station" }).click();

  await expect(page.getByRole("heading", { name: "Your station" })).toBeVisible();
  await page.getByLabel("Station name").fill("Redlands Tapes");
  await page.getByLabel("Station name").blur();
  await page.waitForURL(/\/setup\/[^/]+\/station$/);
  const stationId = page.url().match(/setup\/([^/]+)/)![1]!;
  await page.getByLabel("Call sign").fill("TAPE");
  await expect(page.getByText("TAPE is free")).toBeVisible();
  const channel = page.getByRole("radio", { name: /^\d+$/ }).and(page.locator(":not([disabled])")).first();
  const picked = await channel.textContent();
  await channel.click();
  await expect(page.getByText(new RegExp(`You'll be ${picked}\\.1`))).toBeVisible();
  await page.getByRole("button", { name: "Continue to library" }).click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

  // The API has it: the name, the call sign, the channel.
  const setup = await api<{ station: { name: string; callSign: string | null; channel: string | null } }>(`/stations/${stationId}/setup`, { as: "first-station-owner" });
  expect(setup.station).toMatchObject({ name: "Redlands Tapes", callSign: "TAPE", channel: `${picked}.1` });

  // The sign-on checks read the real API: an empty log can't sign on yet.
  await page.goto(`/control/setup/${stationId}/sign-on`);
  await expect(page.getByRole("heading", { name: "Ready to sign on" })).toBeVisible();
  await expect(page.getByText("The log covers the next 24 hours")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign on", exact: true })).toBeDisabled();
});

test("the switcher says each station is on air (A5)", async ({ page }) => {
  await signIn(page, "kai");
  const status = await api<{ stationId: string; onAir: boolean; deadAirAt: string | null }[]>("/me/stations/status", { as: "kai" });
  expect(status.find((x) => x.stationId === beatId())).toMatchObject({ onAir: true });
  await page.goto("/control/beat/monitor?switch=1");
  await expect(page.getByRole("menu").getByText("Owner. On air").first()).toBeVisible();
});

test("BEAT describes an airing in Listings (G5)", async ({ page }) => {
  await signIn(page, "kai");
  const t = Date.now();
  const window = `from=${encodeURIComponent(new Date(t).toISOString())}&to=${encodeURIComponent(new Date(t + 7 * 86_400_000).toISOString())}`;
  type L = { entryId: string; title: string; carriedFrom: unknown; episodeDescription: string | null };
  const before = await api<{ listings: L[] }>(`/stations/${beatId()}/listings?${window}`, { as: "kai" });
  const mine = before.listings.find((l) => !l.carriedFrom);
  test.skip(!mine, "nothing of BEAT's own airs this week");
  await page.goto(`/control/beat/listings/${mine!.entryId}`);
  await expect(page.getByRole("heading", { name: "Listings" })).toBeVisible();
  const editor = page.getByRole("complementary", { name: `Listing for ${mine!.title}` });
  const words = "Tonight: tapes from the Redlands basement.";
  await editor.getByLabel("Description").fill(words);
  await editor.getByLabel("Description").blur();
  await expect
    .poll(async () => (await api<{ listings: L[] }>(`/stations/${beatId()}/listings?${window}`, { as: "kai" })).listings.find((l) => l.entryId === mine!.entryId)?.episodeDescription)
    .toBe(words);
  await expect(page.getByText(/can't be edited here yet/)).toHaveCount(0);
});

test("a library item shows where it's scheduled and where it aired (L5)", async ({ page }) => {
  await signIn(page, "kai");
  const lib = await api<{ items: { id: string; title: string }[] }>(`/stations/${beatId()}/library`, { as: "kai" });
  const item = lib.items[0]!;
  const history = await api<{ itemId: string; scheduled: unknown[] }>(`/library/${item.id}/history`, { as: "kai" });
  expect(history.itemId).toBe(item.id);
  await page.goto(`/control/beat/library/items/${item.id}`);
  await expect(page.getByRole("heading", { name: item.title, level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^In the log/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Aired/ })).toBeVisible();
  await expect(page.getByText(history.scheduled.length ? /scheduled$/ : "Nothing scheduled")).toBeVisible();
});
