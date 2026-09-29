// The viewer against the real API (playwright.real.config.ts): Sam, signed in with a test token,
// opens the dial and sees the seeded Inland Empire stations and what's on now, as the API says.

import { api, expect, seed, signIn, test } from "../lib/real";

test("the dial shows the real Inland Empire stations, signed in", async ({ page }) => {
  const dial = await api<{ rows: Array<{ station: { callSign: string }; now: { title: string } | null; next: { title: string } | null }> }>("/markets/inland-empire/dial");
  const beat = dial.rows.find((r) => r.station.callSign === "BEAT");
  expect(beat?.now?.title, "the API has something on BEAT now").toBeTruthy();
  // What's on now, or next if the hour turns while the page loads.
  const onNow = [beat!.now!.title, beat!.next?.title].filter(Boolean).map((t) => t!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

  await signIn(page, "sam");
  await page.goto("/");
  const { callSign, channel, name } = seed.stations.beat;
  await expect(page.getByRole("button", { name: `${callSign} ${channel}, ${name}: station preview` })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^Tune in to ${callSign} ${channel.replace(".", "\\.")}: (${onNow})$`) })).toBeVisible();
  // Signed in as Sam (the header's account link), whose presets come from the API: BEAT on key 1.
  await expect(page.getByRole("link", { name: "Sam T." })).toBeVisible();
  await expect(page.getByText("Keys 1 to 6")).toBeVisible();
});
