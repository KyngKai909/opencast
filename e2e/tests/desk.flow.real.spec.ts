// Network desk's flow against the real API (playwright.real.config.ts), as Dee (an Opencast
// admin): the board and pipeline, asking a new creator (B7: only the ticked works go, as
// `workIds`), setting up Tía Lupe's Kitchen from a recipe on 33.1 (the seed leaves it free) and
// sending her the claim link (N3), held earnings, and the one reminder (N2). Checked through the API.

import type { Page } from "@playwright/test";
import { api, expect, seed, signIn, test } from "../lib/real";

const IE = "/desk/markets/inland-empire";

type Creator = { id: string; displayName: string; stage: string; station: { callSign: string | null; channel: string | null } | null; nextActionDue: string | null; remindedAt?: string | null; claimLinkSentAt?: string | null };
type Slot = { major: number; state: string; stations: Array<{ callSign: string | null }> };

const stage = (page: Page, label: string) => page.getByRole("group", { name: "Stages" }).getByRole("button", { name: label, exact: false });
const creators = () => api<Creator[]>(`/admin/creators?marketId=${seed.markets.inlandEmpire}`, { as: "dee" });

function watch(page: Page) {
  const w = { errors: [] as string[], mismatched: [] as string[] };
  page.on("pageerror", (e) => w.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /doesn't match its contract/.test(m.text())) w.mismatched.push(m.text().slice(0, 300));
  });
  return w;
}

test("set up a claimable station from a recipe: Tía Lupe's Kitchen on 33.1", async ({ page }) => {
  const w = watch(page);
  await signIn(page, "dee");
  await page.goto(`${IE}/pipeline`);
  await expect(page.getByRole("heading", { level: 1, name: "Creator pipeline" })).toBeVisible();
  const lupe = page.getByRole("row", { name: /Tía Lupe's Kitchen/ });
  await expect(lupe).toContainText("Said yes");
  await page.getByRole("button", { name: "Set up: Tía Lupe's Kitchen" }).click();
  await expect(page).toHaveURL(new RegExp(`/pipeline/${seed.creators.lupe}/setup$`));
  await expect(page.getByRole("heading", { level: 1, name: /^Set up / })).toBeVisible();
  await expect(page.getByText("Food, TV band")).toBeVisible();

  // The channel: 33.1, open on the board.
  const channel = page.getByRole("button", { name: /^Change the channel/ });
  if ((await channel.innerText()).trim() !== "33.1") {
    await channel.click();
    await page.getByRole("combobox", { name: "Channel" }).selectOption("33.1");
  }
  await expect(page.getByRole("button", { name: /^Change the channel/ })).toHaveText("33.1");
  await expect(page.getByText("From the board, open")).toBeVisible();
  const callSign = (await page.locator(".nd-setup__cs").innerText()).trim();
  expect(callSign).toMatch(/^[A-Z]{3,5}$/);
  await expect(page.getByRole("heading", { level: 1, name: `Set up ${callSign} 33.1`, exact: true })).toBeVisible();
  // Who runs it: the Opencast team (A6); Dee, who's signed in, by default.
  await expect(page.getByText("Dee A.")).toBeVisible();
  await page.getByRole("button", { name: "Schedule sign-on" }).click();
  await expect(page.getByText(new RegExp(`^${callSign} 33\\.1 is set up\\. It signs on `))).toBeVisible();

  // The API has it: a station on 33.1, Lupe's, claimable on the board.
  await expect.poll(async () => (await creators()).find((c) => c.id === seed.creators.lupe)?.station).toMatchObject({ callSign, channel: "33.1" });
  const board = await api<{ slots: Slot[] }>(`/admin/markets/inland-empire/board?band=tv`, { as: "dee" });
  expect(board.slots.find((s) => s.major === 33)).toMatchObject({ state: "claimable", stations: [expect.objectContaining({ callSign, channel: "33.1" })] });

  // The claim link (N3): the setup page sends it, and held earnings say so.
  await page.getByRole("button", { name: "Send the claim link" }).click();
  await expect(page.getByText("Claim link sent to Tía Lupe's Kitchen.")).toBeVisible();
  await expect(page.getByText(/^Claim link sent \w+ \d+$/)).toBeVisible();
  await expect.poll(async () => (await creators()).find((c) => c.id === seed.creators.lupe)?.claimLinkSentAt).toBeTruthy();
  // Not on air yet, so held earnings still say so; the row keeps when the link went.
  const heldNow = await api<{ stations: Array<{ station: { callSign: string | null }; claimLinkSentAt?: string | null }> }>("/admin/held-earnings", { as: "dee" });
  expect(heldNow.stations.find((s) => s.station.callSign === callSign)?.claimLinkSentAt).toBeTruthy();

  // The pipeline's row moves on, and the board shows it.
  await page.getByRole("link", { name: "Pipeline" }).first().click();
  await expect(page.getByRole("row", { name: /Tía Lupe's Kitchen/ })).not.toContainText("Said yes");
  await page.goto(`${IE}/board?ch=33`);
  await expect(page.getByRole("main")).toContainText(callSign);

  expect(w.errors, "page errors").toEqual([]);
  expect(w.mismatched, "responses that don't match their contracts").toEqual([]);
});

test("ask a new creator: only the ticked works go, as workIds (B7)", async ({ page }) => {
  const w = watch(page);
  const name = `Banning Rodeo Films ${Date.now().toString(36)}`;
  const made = await api<{ id: string }>("/admin/creators", {
    as: "dee",
    method: "POST",
    body: { marketId: seed.markets.inlandEmpire, displayName: name, personName: "Rita Banning", description: "Rodeo nights, Banning", sourcePlatform: "youtube", sourceUrl: "https://youtube.com/@banningrodeo", contactEmail: "rita@example.com" }
  });
  await api(`/admin/creators/${made.id}/works`, {
    as: "dee",
    method: "POST",
    body: [
      { title: "Saturday night, part 1", durationMs: 20 * 60_000, sourceUrl: "https://youtube.com/v/r1" },
      { title: "Saturday night, part 2", durationMs: 22 * 60_000, sourceUrl: "https://youtube.com/v/r2" },
      { title: "The bull that wouldn't", durationMs: 9 * 60_000, sourceUrl: "https://youtube.com/v/r3" }
    ],
    status: 200
  });

  await signIn(page, "dee");
  await page.goto(`${IE}/pipeline?stage=found`);
  await page.getByRole("button", { name: `Ask: ${name}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Ask ${name}` })).toBeVisible();
  await expect(page.getByLabel("Send to")).toHaveValue("YouTube message and rita@example.com");
  // Leave one out.
  await page.getByRole("checkbox", { name: /The bull that wouldn't/ }).uncheck();
  await page.getByLabel("A note from you").fill("Could Saturday nights air on the Inland Empire dial?");
  const sent = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/admin/creators/${made.id}/permission-requests`));
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const res = await sent;
  expect(res.status()).toBe(201);
  const body = res.request().postDataJSON() as { workIds?: string[] };
  expect(body.workIds).toHaveLength(2);
  await expect(page.getByText(`Sent to ${name}.`)).toBeVisible();

  const answer = (await res.json()) as { link: string; preview: { works: Array<{ title: string; included: boolean }>; note: string | null } };
  expect(answer.preview.note).toBe("Could Saturday nights air on the Inland Empire dial?");
  // Only the ticked works are covered: the one left out says so on the permission page.
  expect(answer.preview.works.find((x) => x.title === "The bull that wouldn't")?.included).toBe(false);
  expect(answer.preview.works.filter((x) => x.included)).toHaveLength(2);
  expect((await creators()).find((c) => c.id === made.id)?.stage).toBe("asked");

  expect(w.errors, "page errors").toEqual([]);
  expect(w.mismatched, "responses that don't match their contracts").toEqual([]);
});

test("a reminder that's due: Remind sends the one reminder (N2), then No answer is next", async ({ page }) => {
  const w = watch(page);
  const name = `Redlands Choir ${Date.now().toString(36)}`;
  const made = await api<{ id: string }>("/admin/creators", {
    as: "dee",
    method: "POST",
    body: { marketId: seed.markets.inlandEmpire, displayName: name, description: "Choral evenings", sourcePlatform: "youtube", sourceUrl: "https://youtube.com/@redlandschoir", contactEmail: "choir@example.com" }
  });
  await api(`/admin/creators/${made.id}/works`, { as: "dee", method: "POST", body: [{ title: "Evensong", durationMs: 40 * 60_000, sourceUrl: "https://youtube.com/v/c1" }], status: 200 });
  await api(`/admin/creators/${made.id}/permission-requests`, { as: "dee", method: "POST", body: { sentVia: ["email"] } });
  // Asked a week ago: the reminder is due today.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  await api(`/admin/creators/${made.id}`, { as: "dee", method: "PATCH", body: { nextActionDue: today } });

  await signIn(page, "dee");
  await page.goto(`${IE}/pipeline?stage=asked`);
  const reminded = page.waitForResponse((r) => r.url().endsWith(`/admin/creators/${made.id}/reminders`));
  await page.getByRole("button", { name: `Remind: ${name}` }).click();
  expect((await reminded).status()).toBe(201);
  await expect(page.getByText(`Reminded ${name}. That's their one reminder.`)).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toContainText(/Reminded \w+ \d+\. No more after this/);
  await expect(page.getByText("Something went wrong", { exact: false })).toHaveCount(0);
  const after = (await creators()).find((c) => c.id === made.id);
  expect(after?.stage).toBe("asked");
  expect(after?.remindedAt).toBeTruthy();
  // A second reminder is refused.
  const again = await api<{ error: { code: string } }>(`/admin/creators/${made.id}/reminders`, { as: "dee", method: "POST", status: 422 });
  expect(again.error.code).toBe("reminded");

  expect(w.errors, "page errors").toEqual([]);
  expect(w.mismatched, "responses that don't match their contracts").toEqual([]);
});

test("held earnings: CRAT's, waiting to be claimed", async ({ page }) => {
  const w = watch(page);
  await signIn(page, "dee");
  await page.goto("/desk/held-earnings");
  await expect(page.getByRole("heading", { level: 1, name: "Held earnings" })).toBeVisible();
  const held = await api<{ stations: Array<{ station: { callSign: string | null }; creator: string }> }>("/admin/held-earnings", { as: "dee" });
  const crat = held.stations.find((s) => s.station.callSign === "CRAT");
  expect(crat?.creator).toBe("Andre Vega");
  await expect(page.getByRole("main")).toContainText("CRAT");
  await expect(page.getByRole("main")).toContainText("Andre Vega");
  await expect(page.getByText("Something went wrong", { exact: false })).toHaveCount(0);
  expect(w.errors, "page errors").toEqual([]);
  expect(w.mismatched, "responses that don't match their contracts").toEqual([]);
});
