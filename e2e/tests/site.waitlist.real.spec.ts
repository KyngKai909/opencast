// The site's waitlist against the real API (playwright.real.config.ts): the form posts to the real
// `waitlist.join`, and Dee (an Opencast admin) checks through the API what it recorded: a station
// with a free call sign (held), a station whose call sign is taken (a station on the dial: nothing
// is sent), one someone on the waitlist already asked for (since 2026-09-29 it can still be asked
// for, and both wait for the desk to decide), and a viewer whose ZIP is outside every market.

import type { Page } from "@playwright/test";
import { api, expect, test } from "../lib/real";

type Signup = { email: string; role: string; zip: string; market: { slug: string } | null; callSign: string | null };
type Reservation = { callSign: string; email: string | null; market: { slug: string } | null; state: string; sameName: string[] };

const joinButton = (page: Page) => page.locator("form").getByRole("button", { name: "Join the waitlist" });

/** A call sign nobody has yet (the API says it's free): four letters, starting with Q. */
async function freeCallSign(): Promise<string> {
  for (;;) {
    const cs = `Q${Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("")}`;
    if ((await api<{ available: boolean }>(`/call-signs/${cs}`)).available) return cs;
  }
}

async function atTheForm(page: Page) {
  await page.goto("/#join");
  await expect(page.getByRole("heading", { name: "Get on the dial." })).toBeVisible();
  await expect(page.getByRole("radio", { name: "A viewer" })).toBeChecked();
}

test("a station with a free call sign: it's held until the market opens", async ({ page }) => {
  const email = `site-station-${Date.now()}@example.com`;
  const callSign = await freeCallSign();
  await atTheForm(page);
  await page.getByRole("radio", { name: "A station" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("ZIP code").fill("92373");
  await page.getByLabel("Call sign you'd like").fill(callSign);
  await expect(page.getByText(`${callSign} is free.`)).toBeVisible();
  await joinButton(page).click();
  const done = page.getByRole("heading", { name: `${callSign} is on hold for you.` });
  await expect(done).toBeVisible();
  await expect(done).toBeFocused();
  await expect(page.getByText("We’ll write when your market opens, and your call sign is held until then.")).toBeVisible();

  const signups = await api<Signup[]>("/admin/waitlist", { as: "dee" });
  expect(signups.find((s) => s.email === email)).toMatchObject({ role: "station", zip: "92373", market: { slug: "inland-empire" }, callSign });
  const held = await api<Reservation[]>("/admin/reservations", { as: "dee" });
  expect(held.find((r) => r.callSign === callSign)).toMatchObject({ email, market: { slug: "inland-empire" } });
  expect((await api<{ available: boolean }>(`/call-signs/${callSign}`)).available).toBe(false);
});

test("a station with a taken call sign: it says so, and nothing is sent", async ({ page }) => {
  const email = `site-taken-${Date.now()}@example.com`;
  await atTheForm(page);
  await page.getByRole("radio", { name: "A station" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("ZIP code").fill("92373");
  const callSign = page.getByLabel("Call sign you'd like");
  let posted = false;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/v1/waitlist")) posted = true;
  });

  // A station on the dial.
  await callSign.fill("BEAT");
  await expect(page.getByText("BEAT is taken. Try another.")).toBeVisible();
  await expect(callSign).toHaveAttribute("aria-invalid", "true");
  await joinButton(page).click();
  await expect(callSign).toBeFocused();
  expect(posted).toBe(false);
  const signups = await api<Signup[]>("/admin/waitlist", { as: "dee" });
  expect(signups.some((s) => s.email === email)).toBe(false);

  // The API says the same if the form's check hasn't answered yet: its 409, on the field, with
  // free names to try (2026-09-29).
  const refused = await api<{ error: { code: string; message: string } }>("/waitlist", { method: "POST", body: { role: "station", email, zip: "92373", callSign: "BEAT" }, status: 409 });
  expect(refused.error.code).toBe("call_sign_taken");
  expect(refused.error.message).toMatch(/^BEAT is taken\. Try (another|[A-Z]{3,5}( or [A-Z]{3,5})?)\.$/);
});

test("a station asking for a name someone on the waitlist holds: it can still ask, and the desk decides", async ({ page }) => {
  const email = `site-also-${Date.now()}@example.com`;
  const holder = await freeCallSign();
  await api("/waitlist", { method: "POST", body: { role: "station", email: `holder-${Date.now()}@example.com`, zip: "92374", callSign: holder } });
  await atTheForm(page);
  await page.getByRole("radio", { name: "A station" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("ZIP code").fill("92373");
  const callSign = page.getByLabel("Call sign you'd like");
  await callSign.fill(holder);
  await expect(page.getByText(`Someone else asked for ${holder} too. You can still ask: Opencast decides who keeps it.`)).toBeVisible();
  await expect(callSign).not.toHaveAttribute("aria-invalid", "true");
  await joinButton(page).click();
  const done = page.getByRole("heading", { name: `${holder} is on hold for you. Someone else asked for it too: Opencast’s team decides who keeps it, and writes to you either way.` });
  await expect(done).toBeVisible();
  await expect(done).toBeFocused();

  const held = (await api<Reservation[]>("/admin/reservations", { as: "dee" })).filter((r) => r.callSign === holder);
  expect(held).toHaveLength(2);
  expect(held.map((r) => r.state)).toEqual(["same_name", "same_name"]);
  expect(held.find((r) => r.email === email)).toMatchObject({ market: { slug: "inland-empire" }, sameName: [expect.any(String)] });
});

test("a viewer with a ZIP outside every market", async ({ page }) => {
  const email = `site-far-${Date.now()}@example.com`;
  await atTheForm(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("ZIP code").fill("10001-2345");
  await expect(page.getByLabel("ZIP code")).toHaveValue("10001");
  await joinButton(page).click();
  const done = page.getByRole("heading", { name: "You’re on the list." });
  await expect(done).toBeVisible();
  await expect(page.getByText("Your ZIP isn’t in a market yet. We’ll write when a dial opens near you.")).toBeVisible();

  const signups = await api<Signup[]>("/admin/waitlist", { as: "dee" });
  expect(signups.find((s) => s.email === email)).toMatchObject({ role: "viewer", zip: "10001", market: null, callSign: null });
});
