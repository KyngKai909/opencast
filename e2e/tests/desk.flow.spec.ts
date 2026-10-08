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
  // Six of the frame's, and Rialto Community Access, an IPTV-list lead (follow-up Phase 6).
  await expect(stage(page, "Found")).toHaveText(/^7\s*Found$/);
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
  await expect(stage(page, "Found")).toHaveText(/^8\s*Found$/);
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
  await expect(page.getByRole("grid", { name: "External sources" })).toContainText("Not on the dial");
});

// A215 (follow-up Phase 6): a new stream address makes COLT wait for evidence (said before saving),
// recording it puts COLT back; RDLS taken off the dial for good leaves the viewer's dial (one app, one
// mock world) and is put back from Taken off the dial.
test("External sources: change a listing, take one off the dial for good and put it back (A215)", async ({ page }) => {
  await signedInAsAdmin(page);
  // The viewer's side of the same app, in the Inland Empire.
  await page.addInitScript(() => localStorage.setItem("oc-device", JSON.stringify({ marketSlug: "inland-empire", presets: [], reminders: [], settings: {}, lastStationId: null })));
  await page.goto(`${IE}/listed`);
  await page.getByText("City of Colton").first().click();
  await page.getByRole("dialog", { name: "City of Colton" }).getByRole("button", { name: "Change" }).click();
  const form = page.getByRole("dialog", { name: "Change the listing" });
  await form.getByLabel("Stream address").fill("https://stream.colton.example.gov/council/index.m3u8");
  await expect(form).toContainText("Saving takes COLT off the dial until new evidence is recorded for the new address.");
  await form.getByRole("button", { name: "Save, and wait for evidence" }).click();
  const rec = page.getByRole("dialog", { name: "Record evidence" });
  await rec.getByLabel("Who said yes").fill("Maria Lopez, City Clerk, City of Colton");
  await rec.getByLabel("Said yes on").fill("2026-09-26");
  await rec.getByLabel("Where it's kept").fill("Email to network@opencast.tv, Sept 26");
  await rec.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("City of Colton is on the dial at 9.2.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "City of Colton" }).getByRole("list", { name: "Changes" })).toContainText("It waits for new evidence");
  await page.getByRole("dialog", { name: "City of Colton" }).getByRole("button", { name: "Close" }).last().click();

  await page.getByText("City of Redlands").first().click();
  await page.getByRole("dialog", { name: "City of Redlands" }).getByRole("button", { name: "Take off the dial for good" }).click();
  await page.getByRole("dialog", { name: "Take 9.1 RDLS off the dial for good?" }).getByRole("button", { name: "Take it off the dial" }).click();
  await expect(page.getByText("City of Redlands is off the dial for good. It's under Taken off the dial.")).toBeVisible();

  await page.goto("/");
  await expect(page.getByText("COLT").first()).toBeVisible();
  await expect(page.getByText("RDLS", { exact: true })).toHaveCount(0);

  await page.goto(`${IE}/listed?show=removed`);
  await page.getByRole("grid", { name: "Taken off the dial" }).getByRole("button", { name: "Put back on the list" }).click();
  await page.getByRole("dialog", { name: "Put City of Redlands back on the list?" }).getByRole("button", { name: "Put it back" }).click();
  await expect(page.getByText("City of Redlands is back on the list at 9.1. It's checked from the next minute.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("RDLS", { exact: true }).first()).toBeVisible();
});

// A241: Loma Linda's schedule entered by hand: the week in its details, then a slot added in Change
// (day chips, times past midnight, a title), refused while it overlaps, saved once it doesn't, and
// the change in its history.
test("External sources: a schedule entered by hand (A241)", async ({ page }) => {
  await signedInAsAdmin(page);
  await page.goto(`${IE}/listed`);
  await expect(page.getByRole("grid", { name: "External sources" }).getByRole("row", { name: /^Loma Linda Community Access/ })).toContainText("Entered by hand");
  await page.getByText("Loma Linda Community Access").first().click();
  const details = page.getByRole("dialog", { name: "Loma Linda Community Access" });
  await expect(details.getByRole("list", { name: "Every week" })).toContainText("Mon–Fri 6:00–9:00 pm: City Council and commissions");
  await details.getByRole("button", { name: "Change" }).click();
  const form = page.getByRole("dialog", { name: "Change the listing" });
  await expect(form.getByRole("radio", { name: "Enter it by hand" })).toHaveAttribute("aria-checked", "true");
  await form.getByRole("button", { name: "Add a slot" }).click();
  const slot = form.getByRole("listitem", { name: "Slot 4" });
  await slot.getByRole("button", { name: "Fri" }).click();
  await slot.getByLabel("Starts").fill("20:00");
  await slot.getByLabel("Ends").fill("22:00");
  await slot.getByLabel("Title").fill("Friday night films");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(slot).toContainText("“Friday night films” overlaps “City Council and commissions” on Fridays at 8:00 pm.");
  await slot.getByLabel("Starts").fill("22:00");
  await slot.getByLabel("Ends").fill("00:30");
  await expect(slot).toContainText("10:00 pm–12:30 am, 2 hr 30 min, past midnight");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Loma Linda Community Access is saved. It's on the dial at 9.7.")).toBeVisible();
  await expect(details.getByRole("list", { name: "Every week" })).toContainText("Fri 10:00 pm–12:30 am: Friday night films");
  await expect(details.getByRole("list", { name: "Changes" })).toContainText("Its schedule read again");
});

// A248: Attic Channel's schedule from a published Google Sheet: what was read in its details; then
// in Change, a spreadsheet uploaded instead (checked first: what's read, the first airings), saved,
// and in its history. A shared link that isn't shared with anyone with the link says so.
test("External sources: a schedule from a spreadsheet (A248)", async ({ page }) => {
  await signedInAsAdmin(page);
  await page.goto(`${IE}/listed`);
  await expect(page.getByRole("grid", { name: "External sources" }).getByRole("row", { name: /^Attic Channel/ })).toContainText("Their spreadsheet");
  await page.getByText("Attic Channel").first().click();
  const details = page.getByRole("dialog", { name: "Attic Channel" });
  await expect(details).toContainText("Read 152 shows from a week grid, Monday 9/21 to Sunday 9/27, times in Eastern.");
  await expect(details).toContainText("Eastern: the sheet says so");
  await expect(details.getByRole("list", { name: "Skipped" })).toContainText("out of order in its day");
  await details.getByRole("button", { name: "Change" }).click();
  const form = page.getByRole("dialog", { name: "Change the listing" });
  await expect(form.getByRole("radio", { name: "A spreadsheet", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(form.getByLabel("Spreadsheet link")).toHaveValue(/2PACX-1vMockAtticChannelWeek/);
  // A link for editing that isn't shared: said before anything is saved.
  await form.getByLabel("Spreadsheet link").fill("https://docs.google.com/spreadsheets/d/1PrivateMadeUpSheet/edit#gid=0");
  await form.getByRole("button", { name: "Check it" }).click();
  await expect(form).toContainText("This sheet isn't public");
  await settled(page);
  await checkA11y(page, "desk Change, a sheet that isn't public");
  // A file instead: checked, then saved.
  await form.getByRole("radio", { name: "Upload a spreadsheet" }).click();
  await form.locator('input[type="file"]').setInputFiles({ name: "attic-week.csv", mimeType: "text/csv", buffer: Buffer.from("Mon,Tue\nNews 6pm,News 6pm\n") });
  await form.getByRole("button", { name: "Check it" }).click();
  await expect(form.getByRole("region", { name: "What was read" })).toContainText("Read 14 shows from a week grid, Mon to Sun, every week, times in Pacific.");
  await expect(form.getByRole("list", { name: "The first airings" }).getByRole("listitem")).toHaveCount(8);
  await settled(page);
  await checkA11y(page, "desk Change, a spreadsheet checked");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Attic Channel is saved. It's on the dial at 36.1.")).toBeVisible();
  await expect(details).toContainText("attic-week.csv, CSV file");
  await expect(details.getByRole("list", { name: "Changes" })).toContainText("Spreadsheet from nothing to attic-week.csv, 14 shows");
  await details.getByRole("button", { name: "Close" }).last().click();

  // Listing a new source with a Google Sheet's link: it's read as it's saved.
  await page.getByRole("button", { name: "List a source" }).click();
  const add = page.getByRole("dialog", { name: "List a source" });
  await add.getByLabel("Whose stream").fill("Couch Club");
  await add.getByLabel("Channel").fill("39.1");
  await add.getByLabel("Call sign").fill("CUCH");
  await add.getByRole("radio", { name: "Stream link" }).click();
  await add.getByLabel("Stream address").fill("https://couch.example.org/live/index.m3u8");
  await add.getByRole("radio", { name: "Clearly public" }).click();
  await add.getByLabel("The basis").fill("Non-profit channel, stream published for the public");
  await add.getByRole("radio", { name: "A spreadsheet", exact: true }).click();
  await add.getByLabel("Spreadsheet link").fill("https://docs.google.com/spreadsheets/d/e/2PACX-1vMadeUpCouchClub/pubhtml");
  await add.getByRole("button", { name: "List it" }).click();
  await expect(page.getByText("Couch Club is on the dial at 39.1.")).toBeVisible();
  await expect(page.getByRole("grid", { name: "External sources" }).getByRole("row", { name: /^Couch Club/ })).toContainText("Their spreadsheet");
});

// A249: Anime x HIDIVE, a free channel whose lineup is in a platform's public guide. "Find this
// channel's guide" looks its name up in iptv-org's lists (canned on the mocks): the guide files
// Opencast can read, one checked (its channel, of how many, the first airings), then used as guide
// data, checked against their published schedule, and listed with what was read.
test("External sources: find a channel's guide (A249)", async ({ page }) => {
  await signedInAsAdmin(page);
  await page.goto(`${IE}/listed`);
  await page.getByRole("button", { name: "List a source" }).click();
  const add = page.getByRole("dialog", { name: "List a source" });
  // Without a name, there's nothing to look up.
  await add.getByRole("button", { name: "Find this channel's guide" }).click();
  await expect(add.getByRole("alert")).toContainText("Fill in whose stream first");
  await add.getByLabel("Whose stream").fill("Anime x HIDIVE");
  await add.getByLabel("Channel").fill("43.1");
  await add.getByLabel("Call sign").fill("HIDV");
  await add.getByRole("radio", { name: "Stream link" }).click();
  await add.getByLabel("Stream address").fill("https://fast.example.org/hidive/index.m3u8");
  await add.getByRole("radio", { name: "Clearly public" }).click();
  await add.getByLabel("The basis").fill("Free channel, stream published for the public");
  await add.getByRole("button", { name: "Find this channel's guide" }).click();
  const found = add.getByRole("region", { name: "Guides found" });
  const files = found.getByRole("list", { name: "Guide files" });
  await expect(files.getByRole("listitem", { name: /via i\.mjh\.nz$/ })).toHaveCount(3);
  await expect(files.getByRole("listitem").first()).toContainText("Pluto TV (US), via i.mjh.nz");
  await expect(found).toContainText("3 more guides need a site's pages read, so they aren't offered.");
  await settled(page);
  await checkA11y(page, "desk List a source, guides found");
  await found.getByRole("button", { name: "Check Pluto TV (US), via i.mjh.nz" }).click();
  const read = found.getByRole("region", { name: "What was read" });
  await expect(read).toContainText("Read 32 airings to come for ANIME x HIDIVE, one of 427 channels in the guide.");
  await expect(read).toContainText("965 KB as it downloads (gzipped), 7.4 MB unzipped");
  await expect(read.getByRole("list", { name: "The first airings" }).getByRole("listitem")).toHaveCount(8);
  await expect(read.getByRole("list", { name: "The first airings" }).getByRole("listitem").first()).toContainText("Golden Time");
  await settled(page);
  await checkA11y(page, "desk List a source, a guide checked");
  await found.getByRole("button", { name: "Use Pluto TV (US), via i.mjh.nz" }).click();
  await expect(add.getByLabel("Guide data address")).toHaveValue("https://i.mjh.nz/PlutoTV/us.xml.gz#channel=6793eaa4bc03978b9bc63db1");
  await expect(add.getByLabel("Format")).toHaveValue("xmltv");
  await expect(add.getByRole("checkbox", { name: "It's guide data, checked against their published schedule" })).toBeChecked();
  await expect(found.getByRole("button", { name: "Pluto TV (US), via i.mjh.nz is in use" })).toBeDisabled();
  await add.getByRole("textbox", { name: "Checked against" }).fill("https://pluto.tv/us/live-tv/6793eaa4bc03978b9bc63db1");
  await add.getByLabel("Date checked").fill("2026-09-26");
  await add.getByRole("button", { name: "List it" }).click();
  await expect(page.getByText("Anime x HIDIVE is on the dial at 43.1.")).toBeVisible();
  await expect(page.getByRole("grid", { name: "External sources" }).getByRole("row", { name: /^Anime x HIDIVE/ })).toContainText("Guide data");
  await page.getByText("Anime x HIDIVE").first().click();
  const details = page.getByRole("dialog", { name: "Anime x HIDIVE" });
  await expect(details).toContainText("ANIME x HIDIVE (6793eaa4bc03978b9bc63db1), one of 427 channels");
  await expect(details).toContainText("Read every hour (every 30 minutes at most while it runs out), asking first whether it changed.");
  await details.getByRole("button", { name: "Close" }).last().click();

  // A channel the list names but the file no longer has: said, and not offered as one to use.
  await page.getByRole("button", { name: "List a source" }).click();
  await add.getByLabel("Whose stream").fill("WeatherNation");
  await add.getByRole("button", { name: "Find this channel's guide" }).click();
  await expect(found).toContainText("Not in the guide right now");
  await expect(found.getByRole("button", { name: "Use Samsung TV Plus (US), via i.mjh.nz" })).toBeDisabled();
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

test("Analytics (A251): the network's week, then every station sorted and filtered, exported; a market lead's market fixed", async ({ page }) => {
  // Signed in through storage (not an init script), so the test can sign in as someone else later.
  await page.goto("/desk");
  await page.evaluate(() => localStorage.setItem("oc-mock-signed-in", "dee@opencast.example"));
  await page.goto("/desk");
  await page.getByRole("navigation").getByRole("link", { name: "Analytics" }).click();
  await expect(page).toHaveURL(/\/desk\/analytics\/overview$/);
  await expect(page.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();
  await expect(page.getByText("Hours watched", { exact: true })).toBeVisible();
  await expect(page.getByText("76,783")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tuned in at once" })).toBeVisible();
  // 30 days: the span is in the address, and the numbers grow with it.
  await page.getByRole("group", { name: "Span" }).getByRole("button", { name: "30 days" }).click();
  await expect(page).toHaveURL(/span=30d/);
  await expect(page.getByText("76,783")).toBeHidden();
  await page.getByRole("group", { name: "Span" }).getByRole("button", { name: "7 days" }).click();

  // Every station: sorted by hours, then by peak; External alone; exported.
  await page.getByRole("button", { name: "All 13 stations" }).click();
  await expect(page).toHaveURL(/\/desk\/analytics\/stations/);
  const table = page.getByRole("table", { name: "Every station's span" });
  const firstRow = table.getByRole("row").nth(1);
  await expect(firstRow).toContainText("BEAT");
  await table.getByRole("button", { name: "Peak" }).click();
  await expect(firstRow).toContainText("REEL");
  await page.getByRole("group", { name: "Kind of station" }).getByRole("button", { name: /External/ }).click();
  await expect(firstRow).toContainText("RDLS");
  await expect(firstRow).toContainText("Their stream");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/^opencast-stations-\d{4}-\d{2}-\d{2}\.csv$/);

  // One station (Ref. 12d 03): BEAT, opened from the table, its span kept.
  await page.getByRole("group", { name: "Kind of station" }).getByRole("button", { name: /^All/ }).click();
  await table.getByRole("link", { name: "BEAT" }).click();
  await expect(page).toHaveURL(/\/desk\/analytics\/stations\/[0-9a-f-]+\?span=7d/);
  await expect(page.getByRole("heading", { name: /^BEAT/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saturday night" })).toBeVisible();
  await expect(page.getByRole("table", { name: "That night's airings" })).toContainText("Carried from REEL 24.1");
  await expect(page.getByText("Paid out")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cost to run" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in master control" })).toHaveAttribute("href", "/control/BEAT/audience");
  await page.getByRole("button", { name: "All stations" }).click();
  await expect(page).toHaveURL(/\/desk\/analytics\/stations\?/);

  // Programs and breaks (Ref. 12d 05): pick a program to see who stayed.
  await page.getByRole("tab", { name: "Programs" }).click();
  await expect(page.getByRole("heading", { name: "Late Crate, still watching" })).toBeVisible();
  await page.getByRole("table", { name: "Programs across stations" }).getByRole("button", { name: "Saturday Reel" }).click();
  await expect(page.getByRole("heading", { name: "Saturday Reel, still watching" })).toBeVisible();
  await expect(page.getByText(/Breaks that open with a bumper keep/)).toBeVisible();

  // Money (Ref. 12d 06): Opencast's share not set yet, never a guessed $0; the cost to run estimated.
  await page.getByRole("tab", { name: "Money" }).click();
  await expect(page.getByText("Opencast’s share: not set yet.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spot market" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Held for claimable stations" })).toBeVisible();

  // Health (Ref. 12d 07) and Growth: what went wrong, and what people look for.
  await page.getByRole("tab", { name: "Health" }).click();
  await expect(page.getByRole("table", { name: "Each station's airtime by kind" })).toContainText("PREP");
  await expect(page.getByText(/PREP 31\.1: dead air, 47 min/)).toBeVisible();
  await page.getByRole("tab", { name: "Growth" }).click();
  await expect(page.getByRole("heading", { name: "Found nothing" })).toBeVisible();
  await expect(page.getByText("la liga").first()).toBeVisible();

  // Audience (Ref. 12d 04): the week's grid, then narrowed to BEAT.
  await page.getByRole("tab", { name: "Audience" }).click();
  await expect(page).toHaveURL(/\/desk\/analytics\/audience/);
  await expect(page.getByRole("table", { name: "Average tuned in by weekday and hour" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How people tuned in" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Changes between stations" })).toContainText("REEL");
  await page.getByRole("combobox", { name: "Station" }).selectOption({ label: "12.1 BEAT" });
  await expect(page).toHaveURL(/station=/);
  await expect(page.getByText("BEAT 12.1, in the market’s time")).toBeVisible();

  // Lee leads the High Desert: their market, fixed.
  await page.evaluate(() => localStorage.setItem("oc-mock-signed-in", "lee@opencast.example"));
  await page.goto("/desk/analytics/overview");
  await expect(page.getByText("Every station in High Desert", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Market" })).toBeDisabled();
});

test("A station's file (added 2026-10-07): who made it, then an admin archives an upload and takes the station off the air; a market lead only looks", async ({ page }) => {
  await page.goto("/desk");
  await page.evaluate(() => localStorage.setItem("oc-mock-signed-in", "dee@opencast.example"));
  await page.goto("/desk/analytics/stations/00000000-0000-4000-8000-000000097001");
  await expect(page.getByText(/Made .* by Kai Morgan/)).toBeVisible();

  // Uploads: archive one, with why.
  await page.getByRole("tab", { name: "Uploads" }).click();
  await expect(page).toHaveURL(/view=uploads/);
  await page.getByRole("button", { name: "Archive Night Tape 2" }).click();
  const archive = page.getByRole("dialog", { name: "Archive Night Tape 2" });
  await archive.getByRole("button", { name: "Archive it" }).click();
  await expect(archive.getByText("Say why: the station's people will read it.")).toBeVisible();
  await archive.getByRole("textbox", { name: "Why" }).fill("Someone else's show");
  await archive.getByRole("button", { name: "Archive it" }).click();
  await expect(archive).toBeHidden();
  await page.getByRole("button", { name: /Show 2 archived/ }).click();
  await expect(page.getByText("Archived by Opencast (Dee A.): Someone else's show")).toBeVisible();

  // Off the air and held, then lifted.
  await page.getByRole("button", { name: "Take off the air" }).click();
  const hold = page.getByRole("dialog", { name: "Take BEAT off the air" });
  await hold.getByRole("textbox", { name: "Why" }).fill("Rebroadcasting a channel it doesn't own");
  await hold.getByRole("button", { name: "Take it off the air" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Off the air, held by Opencast" })).toContainText("Rebroadcasting a channel it doesn't own");
  await expect(page.getByRole("button", { name: "Take off the air" })).toHaveCount(0);
  await page.getByRole("button", { name: "Lift the hold" }).click();
  await expect(page.getByText("Off the air, held by Opencast")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Take off the air" })).toBeVisible();

  // Lee leads the High Desert: the file, without the buttons.
  await page.evaluate(() => localStorage.setItem("oc-mock-signed-in", "lee@opencast.example"));
  await page.goto("/desk/analytics/stations/00000000-0000-4000-8000-000000097010?view=uploads");
  await expect(page.getByRole("table", { name: "The station's uploads" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Archive / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Take off the air" })).toHaveCount(0);
});
