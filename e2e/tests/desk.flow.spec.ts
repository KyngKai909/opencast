// Network desk's flow (apps prompt, Phase 9): set up a claimable station from a recipe. Found →
// asked → the creator says yes on the viewer's /permission/:token page → set up from a recipe →
// on air, not claimed. On the mocks: the Opencast app's desk (/desk) and the permission page (/)
// are one app with one mock world, so the creator's yes reaches the pipeline by itself; the rest of
// the creator's side (signing on, claiming) is the desk's "creator's side" controls (mock mode only).

import { expect, test, type Locator, type Page } from "@playwright/test";
import { checkA11y, useGround } from "../lib/a11y";

const IE = "/desk/markets/inland-empire";

async function signedInAsAdmin(page: Page) {
  await page.addInitScript(() => localStorage.setItem("oc-mock-signed-in", "dee@opencast.example"));
}

/** No finite animation still running (the toast's rise, fades): axe measures what stays. */
async function settled(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity)
  );
}

/** A stage in the strip: its count and its words, e.g. "4 Said yes". */
const stage = (page: Page, label: string): Locator => page.getByRole("group", { name: "Stages" }).getByRole("button", { name: label, exact: false });

/** The mock's stand-in for the creator, for one creator. */
const creatorSide = (page: Page, name: string): Locator =>
  page.getByRole("region", { name: "Mock mode: the creator's side" }).locator(".nd-mock__row").filter({ hasText: name });

test("set up a claimable station from a recipe", async ({ page, context }) => {
  await signedInAsAdmin(page);
  await useGround(page, "dark");

  // Found: Desert Skate Films, with their Vimeo catalogued by title and length.
  await page.goto(`${IE}/pipeline`);
  await expect(page.getByRole("heading", { level: 1, name: "Creator pipeline" })).toBeVisible();
  await expect(page.getByText("Inland Empire. Sorted by what needs doing first.")).toBeVisible();
  await expect(stage(page, "Said yes")).toHaveText(/^4\s*Said yes$/);
  await expect(stage(page, "On air, not claimed")).toHaveText(/^1\s*On air, not claimed$/);
  await expect(page.getByRole("navigation", { name: "Network desk" })).toContainText("4 yeses to set up");
  await stage(page, "Found").click();
  await expect(page).toHaveURL(/stage=found/);
  await expect(stage(page, "Found")).toHaveAttribute("aria-pressed", "true");
  const skate = page.getByRole("row", { name: /Desert Skate Films/ });
  await expect(skate).toContainText("Skate films, Joshua Tree");
  await expect(skate).toContainText("Vimeo");
  await expect(skate).toContainText("Found");

  // Ask: which works, what Opencast would do, a note, and the message as they'll get it.
  await page.getByRole("button", { name: "Ask: Desert Skate Films" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ask Desert Skate Films" })).toBeVisible();
  await expect(page.getByLabel("Send to")).toHaveValue("Vimeo message and hello@desertskate.example");
  await expect(page.getByText("14 found on their Vimeo")).toBeVisible();
  await expect(page.getByText("A TV band station, 38.1 or 45.1")).toBeVisible();
  const message = page.getByLabel("The message as they'll get it");
  await expect(message).toContainText("From Opencast, the Inland Empire dial");
  await expect(message).toContainText("Your station tonight, if you say yes");
  await page.getByLabel("A note from you").fill("We love the Joshua Tree film. Could it air on the Inland Empire dial?");
  await expect(message).toContainText("We love the Joshua Tree film.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Sent to Desert Skate Films.")).toBeVisible();
  await expect(page.getByText("If they don't answer in a week, the pipeline says a reminder is due.")).toBeVisible();
  await settled(page);
  await checkA11y(page, "desk ask, sent");
  const link = await message.getByRole("link", { name: "See what you'd be saying yes to" }).getAttribute("href");
  expect(link).toMatch(/^http:\/\/localhost:5174\/permission\/mk\./);

  // The creator's side: the viewer's permission page, and yes.
  const creator = await context.newPage();
  await creator.goto(link!);
  await expect(creator.getByRole("heading", { level: 1, name: "A station of your films, on the Inland Empire dial." })).toBeVisible();
  await expect(creator.getByText("6 full-length skate films and 7 park session edits from your Vimeo. Not the sponsor edit for a shoe brand")).toBeVisible();
  await expect(creator.getByText(`Labelled "Run by Opencast for Desert Skate Films"`)).toBeVisible();
  await creator.getByRole("button", { name: "Yes, go ahead" }).click();
  await expect(creator.getByRole("heading", { level: 1, name: "Thanks. We'll set it up." })).toBeVisible();
  await expect(creator.getByText(/^13 works, on /)).toBeVisible();
  await creator.close();

  // Back on the desk: the yes has reached it, and the pipeline has a new yes to set up.
  await page.getByRole("link", { name: "Back to the pipeline" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Creator pipeline" })).toBeVisible();
  // The desk asks again (as it would the API the next time it loads): the creator answered in
  // another tab, whose mock saved it.
  await page.reload();
  await expect(stage(page, "Asked")).toHaveText(/^3\s*Asked$/);
  await expect(stage(page, "Said yes")).toHaveText(/^5\s*Said yes$/);
  await expect(page.getByRole("navigation", { name: "Network desk" })).toContainText("5 yeses to set up");
  await expect(page.getByRole("row", { name: /Desert Skate Films/ })).toContainText("Said yes");

  // Set up from a recipe: the day, the channel from the board, the call sign from their name.
  await page.getByRole("button", { name: "Set up: Desert Skate Films" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Set up DSF 38.1", exact: true })).toBeVisible();
  await expect(page.getByText(/^Said yes September \d+\. Covers 13 films on Vimeo\.$/)).toBeVisible();
  await page.getByRole("combobox", { name: "Recipe" }).selectOption({ label: "Films and video" });
  await expect(page.getByText("Films and video, TV band")).toBeVisible();
  await expect(page.getByText("13 films, 5 hr in total. Each airs at most 3 times a week")).toBeVisible();
  await expect(page.getByText("Carried: Council Watch from CIVC")).toBeVisible();
  await expect(page.getByText("From the board, open")).toBeVisible();
  await expect(page.getByText("Suggested from their name. They can't change it after claiming")).toBeVisible();
  await expect(page.getByText(/^Permission from Desert Skate Films, September \d+, for the 13 listed films$/)).toBeVisible();
  await expect(page.getByText("13 to import")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change when it signs on: " })).toHaveText("Monday, 6:00 am");
  await page.getByRole("button", { name: "Schedule sign-on" }).click();
  await expect(page.getByText("DSF 38.1 is set up. It signs on Monday at 6:00 am.")).toBeVisible();
  await expect(page.getByText("Sign-on scheduled")).toBeVisible();
  await expect(page.getByText(/^Station #\d+$/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in master control" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Network desk" })).toContainText("4 yeses to set up");
  await settled(page);
  await checkA11y(page, "desk setup, sign-on scheduled");

  // The sign-on time comes: on air, not claimed.
  await page.getByRole("link", { name: "Pipeline" }).first().click();
  await expect(page.getByRole("row", { name: /Desert Skate Films/ })).toContainText("Setting up");
  await creatorSide(page, "Desert Skate Films").getByRole("button", { name: "Sign it on now" }).click();
  await expect(stage(page, "On air, not claimed")).toHaveText(/^2\s*On air, not claimed$/);
  const onAir = page.getByRole("row", { name: /Desert Skate Films/ });
  await expect(onAir).toContainText("On air");
  await expect(onAir).toContainText("38.1 DSF");
  await expect(onAir).toContainText("On air. Waiting to be claimed");

  // The row's Open goes to the board: 38 is claimable, run by Opencast, on air. (In-app, not a
  // reload: the mock's clock starts again at 8:42 pm on every load, before this sign-on.)
  await page.getByRole("button", { name: "Open: Desert Skate Films" }).click();
  await expect(page).toHaveURL(/\/board\?ch=38$/);
  await expect(page.getByRole("button", { name: "Channel 38, DSF, Claimable, run by Opencast" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("38.1 DSF, selected")).toBeVisible();
  await expect(page.getByText("Claimable, on air. Desert Skate Films's station, waiting to be claimed")).toBeVisible();

  // Its setup page reads it back: on air, waiting to be claimed.
  await page.getByRole("link", { name: "Pipeline", exact: true }).last().click();
  await expect(page.getByRole("heading", { level: 1, name: "DSF 38.1", exact: true })).toBeVisible();
  await expect(page.getByText("On air, waiting to be claimed")).toBeVisible();
  await expect(page.getByText("On air since")).toBeVisible();
  await expect(page.getByText("Desert Skate Films hasn't been invited to claim it yet")).toBeVisible();
  await settled(page);
  await checkA11y(page, "desk setup, on air");

  // Invite them to claim it (N3): the claim row says when, and held earnings say Invited.
  await page.getByRole("button", { name: "Invite to claim" }).click();
  await expect(page.getByText("Claim invite sent to Desert Skate Films.")).toBeVisible();
  await expect(page.getByText(/^Claim invite sent \w+ \d+$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite to claim" })).toHaveCount(0);
  await page.getByRole("link", { name: /^Held earnings/ }).first().click();
  await expect(page.getByRole("row", { name: /DSF/ })).toContainText(/Invited \w+ \d+/);
});

test("Add a creator: found, with nothing to ask about until their works are catalogued", async ({ page }) => {
  await signedInAsAdmin(page);
  await useGround(page, "light");
  await page.goto(`${IE}/pipeline`);
  await expect(stage(page, "Found")).toHaveText(/^6\s*Found$/);
  await page.getByRole("button", { name: "Add a creator" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a creator" });
  await expect(dialog).toContainText("Someone making things in the Inland Empire. Nothing is asked or copied yet.");
  await dialog.getByRole("button", { name: "Add them" }).click();
  await expect(dialog.getByText("Say what they're called.")).toBeVisible();
  await expect(dialog.getByText("Paste the link to their channel or page.")).toBeVisible();
  await settled(page);
  await checkA11y(page, "desk Add a creator, with errors");
  await dialog.getByLabel("Name").fill("Banning Rodeo Films");
  await dialog.getByLabel("What they make").fill("Rodeo nights, Banning");
  await dialog.getByLabel("Their work lives on").selectOption({ label: "YouTube" });
  await dialog.getByLabel("Link").fill("https://www.youtube.com/@banningrodeo");
  await dialog.getByRole("button", { name: "Add them" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Banning Rodeo Films is on the pipeline, as Found.")).toBeVisible();
  await expect(stage(page, "Found")).toHaveText(/^7\s*Found$/);
  await stage(page, "Found").click();
  await expect(page.getByRole("row", { name: /Banning Rodeo Films/ })).toContainText("Rodeo nights, Banning");
  await page.getByRole("button", { name: "Ask: Banning Rodeo Films" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ask Banning Rodeo Films" })).toBeVisible();
  await expect(page.getByText("Nothing found on their YouTube yet.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
});

// Signing in through the page opens the desk at once (AuthProvider resets the cache, not clears it).
test("signing in through the page opens the desk without a reload", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/desk");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to Network desk" })).toBeVisible();
  await page.getByLabel("Email").fill("dee@opencast.example");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText("We sent a code to dee@opencast.example.")).toBeVisible();
  await page.getByLabel("Code").fill("123456");
  await expect(page.getByRole("heading", { level: 1, name: "Inland Empire" })).toBeVisible({ timeout: 8_000 });
});

test("External sources: the rail, the page and the board's key (network-desk 01.1, 05.1)", async ({ page }) => {
  await signedInAsAdmin(page);
  await useGround(page, "dark");
  await page.goto(`${IE}/board`);
  await expect(page.getByLabel("Key")).toContainText("External city stream");
  await expect(page.getByLabel("Key")).not.toContainText("Listed");
  await page.getByRole("link", { name: /^External sources/ }).click();
  await expect(page).toHaveURL(new RegExp(`${IE}/listed$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("External sources");
  await expect(page.getByText("Stations on the Inland Empire dial that play the source's own stream. No playout, no spots.")).toBeVisible();
  await expect(page.getByRole("table", { name: "External sources" })).toContainText("Not on the dial");
});

// desk-catalog 01 and 03 (follow-up Phase 0, item 10): the shelf as drawn, then an item added from
// the catalog station's library, its checklist answered with evidence and sent by Dee, and the
// second check done by Rae, a rights reviewer: never the first checker.
test("the catalog: the shelf, and adding an item checked by two people", async ({ page }) => {
  const signIn = async (email: string) => {
    await page.evaluate((e) => localStorage.setItem("oc-mock-signed-in", e), email);
  };
  await page.goto("/desk");
  await signIn("dee@opencast.example");
  await useGround(page, "dark");
  await page.goto(`${IE}/catalog`);
  await expect(page.getByRole("heading", { level: 1, name: "Catalog" })).toBeVisible();
  await expect(page.getByText("Opencast's own programs, offered free to every station. Made possible by Clear.")).toBeVisible();
  await expect(page.getByText("Items with a confirmed rights record")).toBeVisible();
  const shelf = page.getByRole("grid", { name: "Catalog series" });
  await expect(shelf.getByRole("row", { name: /Nights at the observatory/ })).toContainText("US government work");
  await expect(shelf.getByRole("row", { name: /The mystery hour/ })).toContainText("44 of 60");
  await expect(shelf.getByRole("row", { name: /The mystery hour/ })).toContainText("7 in review");
  await expect(shelf.getByRole("row", { name: /Licensed catalogs/ })).toContainText("Coming");

  // Add an item: from the library, with its source and year. The rules pre-fill the checklist.
  await page.getByRole("button", { name: "Add an item" }).click();
  const add = page.getByRole("dialog", { name: "Add an item" });
  await add.getByLabel("Series").selectOption({ label: "Cartoons, 1928 to 1936" });
  await add.getByLabel("File").selectOption({ label: "Ferry Boat Follies, 6:45" });
  await add.getByLabel("Source").fill("1933, original 35 mm print, Library of Congress");
  await add.getByLabel("Published").fill("1933");
  await add.getByRole("button", { name: "Start the rights check" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ferry Boat Follies" })).toBeVisible();
  await expect(page.getByText("Why it's free to air")).toBeVisible();
  await expect(page.getByText("Renewal would have been due in 1960 or 1961. Search the Copyright Office renewal records for the title and studio")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send for second check" })).toBeDisabled();

  // Every line answered, with evidence: a file for the source, written records for the rest.
  const lines = ["Source is an original, not a restoration", "Published 1933, with a copyright notice", "Copyright not renewed", "Soundtrack", "Characters and trademarks"];
  for (const title of lines) {
    await page.getByRole("button", { name: `Answer: ${title}` }).click();
    const answer = page.getByRole("group", { name: `Answer: ${title}` });
    await answer.getByRole("radio", { name: title === "Characters and trademarks" ? "Yes, with a caution" : "Yes", exact: true }).click();
    if (title === lines[0]) {
      await answer.getByLabel(`Evidence for ${title}`).setInputFiles({ name: "loc-record.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 Library of Congress record") });
      await expect(answer.getByText("loc-record.pdf")).toBeVisible();
    } else {
      await answer.getByLabel(/The record/).fill(title === "Characters and trademarks" ? "noted" : "Copyright Office renewal records searched: none found");
    }
    await answer.getByRole("button", { name: "Save" }).click();
    await expect(answer).toBeHidden();
  }
  await page.getByRole("button", { name: "Send for second check" }).click();
  await expect(page.getByText("Waiting for a rights reviewer or admin other than Dee A.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm: it's free to air" })).toHaveCount(0);

  // Rae, a rights reviewer, does the second check.
  const item = page.url();
  await signIn("rae@opencast.example");
  await page.goto(item);
  await page.getByRole("button", { name: "Confirm: it's free to air" }).click();
  await expect(page.getByText(/^Rae T\. reviewed the evidence and confirmed/)).toBeVisible();
  await expect(page.getByText("1933. Not renewed")).toBeVisible();
  await page.getByRole("link", { name: "Catalog / Cartoons, 1928 to 1936" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Cartoons, 1928 to 1936" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Items" }).getByRole("row", { name: /Ferry Boat Follies/ })).toContainText("Checked twice");
});

// desk-pages 04 (item 11): a rule set from a date, and the change log.
test("Settings: a rule changed from a date, in the change log", async ({ page }) => {
  await signedInAsAdmin(page);
  await useGround(page, "light");
  await page.goto("/desk/settings");
  await expect(page).toHaveURL(/\/desk\/settings\/rules$/);
  await expect(page.getByRole("heading", { name: "Rules" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Pay-as-you-go" }).getByText("Not set yet")).toHaveCount(3);
  await expect(page.getByText("10 GB, 5 live hours")).toBeVisible();
  await page.getByRole("button", { name: "Edit: Repeat limit" }).click();
  const dialog = page.getByRole("dialog", { name: "Repeat limit" });
  await dialog.getByLabel("Upheld claims in 12 months").fill("2");
  await dialog.getByLabel("Takes effect").fill("2026-10-01");
  await dialog.getByLabel("Note").fill("After the September review");
  await dialog.getByRole("button", { name: "Set it" }).click();
  await expect(page.getByText("2 from October 1")).toBeVisible();
  await page.getByRole("link", { name: "Change log" }).click();
  const log = page.getByRole("table", { name: "Change log" });
  await expect(log.getByRole("row", { name: /Repeat limit: 3 to 2/ })).toContainText("After the September review");
  await expect(log.getByRole("row", { name: /Repeat limit: 3 to 2/ })).toContainText("Dee A.");
});

// desk-pages 01 (item 11): every claim on every station. The figures, an answered claim's timeline
// and carriers, a privacy complaint that says so, an outcome recorded by Rae (a rights reviewer), and
// a market lead who sees only the High Desert.
test("Rights claims: timelines, carriers, a privacy complaint and an outcome", async ({ page }) => {
  const signIn = async (email: string) => {
    await page.evaluate((e) => localStorage.setItem("oc-mock-signed-in", e), email);
  };
  await page.goto("/desk");
  await signIn("rae@opencast.example");
  await useGround(page, "dark");
  await page.goto("/desk/rights-claims");
  await expect(page.getByRole("heading", { level: 1, name: "Rights claims" })).toBeVisible();
  await expect(page.getByText("Open claims, 3 off air")).toBeVisible();
  await expect(page.getByText("Station answer due in 2 days")).toBeVisible();
  const open = page.getByRole("grid", { name: "Open claims" });
  await expect(open.getByRole("row", { name: /Late Crate, ep\. 9, on BEAT 12\.1/ })).toContainText("Counter-notice sent");
  await expect(open.getByRole("row", { name: /Tamales for forty/ })).toContainText("SAZN answers by Sept 28");
  await expect(open.getByRole("row", { name: /Council Watch/ })).toContainText("Privacy, not copyright");

  // The answered claim: its timeline and the three carriers it was pulled from.
  await open.getByRole("row", { name: /Late Crate/ }).click();
  const late = page.getByRole("complementary", { name: "Late Crate, ep. 9" });
  await expect(late.getByText("Off air on BEAT and 3 carriers")).toBeVisible();
  await expect(late.getByText("Counter-notice sent to the claimant")).toBeVisible();
  await expect(late.getByRole("list", { name: "Carriers" }).getByRole("listitem")).toHaveCount(3);
  await late.getByRole("button", { name: "See evidence" }).click();
  const evidence = page.getByRole("dialog", { name: "Evidence" });
  await expect(evidence.getByText("rights@northside.example")).toBeVisible();
  await evidence.getByRole("button", { name: "Close" }).last().click();
  await expect(evidence).toBeHidden();

  // The privacy complaint follows its own path.
  await open.getByRole("row", { name: /Council Watch/ }).click();
  const council = page.getByRole("complementary", { name: "Council Watch, Sept 22" });
  await expect(council.getByText("Opencast reviews it", { exact: true })).toBeVisible();
  await expect(council.getByText("Off air on CIVC and 6 carriers")).toBeVisible();

  // Rae records the outcome on Harbor Nights: withdrawn, back on air, and closed.
  await open.getByRole("row", { name: /Harbor Nights, ep\. 2/ }).click();
  await page.getByRole("complementary", { name: "Harbor Nights, ep. 2" }).getByRole("button", { name: "Record the outcome" }).click();
  const outcome = page.getByRole("dialog", { name: "Record the outcome" });
  await outcome.getByRole("radio", { name: /Withdrawn/ }).click();
  await outcome.getByRole("button", { name: "Record it" }).click();
  await expect(page.getByText("Withdrawn. Harbor Nights, ep. 2 is back on air.")).toBeVisible();
  await expect(open.getByRole("row", { name: /Harbor Nights, ep\. 2/ })).toHaveCount(0);
  await page.getByRole("radio", { name: "Closed" }).click();
  await expect(page.getByRole("grid", { name: "Closed claims" }).getByRole("row", { name: /Harbor Nights, ep\. 2/ })).toContainText("Withdrawn");
  await page.getByRole("radio", { name: "By station" }).click();
  await expect(page.getByRole("table", { name: "Claims by station" }).getByRole("row", { name: /REEL 24\.1/ })).toContainText("1 of 3");

  // Lee leads the High Desert: MOJV's claim only, and no outcomes to record.
  await signIn("lee@opencast.example");
  await page.goto("/desk/rights-claims?tab=closed");
  const closed = page.getByRole("grid", { name: "Closed claims" });
  await expect(closed.getByRole("row", { name: /MOJV/ })).toHaveCount(1);
  await expect(closed.getByRole("row", { name: /BEAT/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Record the outcome" })).toHaveCount(0);
});

// desk-pages 02: reserved call signs. The same name twice decided, a name that isn't allowed
// replaced, the next ones invited in reservation order, and the hold's length in the rules.
test("Reserved call signs: decide, suggest and invite the next 10", async ({ page }) => {
  await signedInAsAdmin(page);
  await useGround(page, "light");
  await page.goto("/desk/reserved-call-signs");
  await expect(page.getByRole("heading", { level: 1, name: "Reserved call signs" })).toBeVisible();
  await expect(page.getByText("26 held from the waitlist in the Inland Empire, 4 with a channel held.")).toBeVisible();
  const table = page.getByRole("table", { name: "Reserved call signs" });
  await expect(table.getByRole("row", { name: /^TACO/ })).toContainText("Ends tomorrow");
  await expect(table.getByRole("row", { name: /^HOOP/ })).toContainText("Invited, signing on");

  await table.getByRole("button", { name: "Decide VALE" }).click();
  const decide = page.getByRole("dialog", { name: "VALE: 2 people asked" });
  await expect(decide.getByLabel("Hold instead for Pastor Ellis")).toHaveValue("VALEY");
  await decide.getByRole("button", { name: "Keep it for Dani R." }).click();
  await expect(page.getByText("VALE stays with Dani R. VALEY is held instead for the other.")).toBeVisible();
  await expect(table.getByRole("row", { name: /^VALEY/ })).toContainText("Pastor Ellis");

  await table.getByRole("button", { name: "Suggest KFRO" }).click();
  await page.getByRole("dialog", { name: "KFRO isn't allowed" }).getByRole("button", { name: "Hold FRO instead" }).click();
  await expect(table.getByRole("row", { name: /^FRO\b/ })).toContainText("J. Park");
  await expect(table.getByRole("row", { name: /^KFRO/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Invite the next 10" }).click();
  await page.getByRole("dialog", { name: "Invite the next 10" }).getByRole("button", { name: "Send 10 invites" }).click();
  await expect(table.getByRole("row", { name: /^SKAT/ })).toContainText("Invited");
  await settled(page);
  await checkA11y(page, "reserved call signs, after decisions");

  await page.goto("/desk/settings/rules");
  await expect(page.getByRole("region", { name: "Call signs" }).getByText("120 days, a reminder 14 days before")).toBeVisible();
});

// desk-pages 03 (item 11): Catalog sponsors. The page as drawn (Clear thanked wherever nobody else
// is, Inland Empire Libraries in Nights at the observatory), an open slot offered from the grid, the
// business saying yes (the mock's business side), and the slot then naming it.
test("Catalog sponsors: an open slot offered, and the business says yes", async ({ page }) => {
  await signedInAsAdmin(page);
  await useGround(page, "light");
  await page.goto("/desk/catalog-sponsors");
  await expect(page.getByRole("heading", { level: 1, name: "Catalog sponsors" })).toBeVisible();
  await expect(page.getByText("Catalog credits aired in September")).toBeVisible();
  await expect(page.getByText("Share to the creator fund. Not set yet")).toBeVisible();
  const list = page.getByRole("grid", { name: "Catalog sponsors" });
  await expect(list.getByRole("row", { name: /Clear/ })).toContainText("The house sponsor, thanked wherever nobody else is");
  await expect(list.getByRole("row", { name: /Inland Empire Libraries/ })).toContainText("Since August");
  const pane = page.getByRole("region", { name: "Inland Empire Libraries' credit" });
  await expect(pane.getByRole("figure", { name: /Nights at the observatory is made possible by Inland Empire Libraries/ })).toBeVisible();
  await expect(pane).toContainText("6 Inland Empire stations");
  await checkA11y(page, "catalog sponsors");

  // An open slot, from the grid: Cartoons in the Inland Empire, offered to Orange Street Coffee.
  const grid = page.getByRole("table", { name: "Slots by series and market" });
  await grid.getByRole("button", { name: "Cartoons, 1928 to 1936 in Inland Empire: Clear. Open slot, $150.00 a month" }).click();
  const slotPane = page.getByRole("region", { name: "Cartoons, 1928 to 1936 in Inland Empire" });
  await expect(slotPane).toContainText("Airs 12 times a day here, on 5 stations");
  await slotPane.getByRole("button", { name: "Offer it" }).click();
  const dialog = page.getByRole("dialog", { name: "Offer a slot" });
  await expect(dialog.getByText(/\$150\.00 a month, from Settings/)).toBeVisible();
  await dialog.getByLabel("Find the business").fill("orange");
  await expect(dialog.getByLabel("Business", { exact: true })).toHaveText("Orange Street Coffee, Redlands");
  await dialog.getByLabel("Their credit", { exact: true }).fill("Orange Street Coffee, roasting in Redlands.");
  await dialog.getByLabel("Starts", { exact: true }).selectOption({ label: "October 1" });
  await dialog.getByRole("button", { name: "Send the offer" }).click();
  await expect(page.getByText("Offered to Orange Street Coffee. It's theirs to answer.")).toBeVisible();
  await expect(list.getByRole("row", { name: /Orange Street Coffee/ })).toContainText("Offered, waiting for their answer");

  // The business says yes: credited from October 1, Clear until then.
  const business = page.getByRole("region", { name: "Mock mode: the business's side" });
  await business.getByRole("button", { name: "They say yes" }).click();
  await expect(list.getByRole("row", { name: /Orange Street Coffee/ })).toContainText("Starts October 1");
  await expect(grid.getByRole("button", { name: /^Cartoons, 1928 to 1936 in Inland Empire: Orange Street Coffee\. Starts October 1/ })).toBeVisible();
});
