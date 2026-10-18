// The flows the site prompt asks for (Phase 4), in mock mode.
import { expect, test } from "@playwright/test";
import { joinWaitlist, open } from "./helpers";

test("tune the nav to another station", async ({ page }) => {
  await open(page, "/");
  await expect(page.locator("#npCs")).toHaveText("BEAT");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#npCs")).toHaveText("SAZN");
  await expect(page.locator("#lCs")).toHaveText("SAZN");
  // A station picked from the guide tunes the hero and the nav.
  await page.locator("#guide").scrollIntoViewIfNeeded();
  await page.locator('#gIn .g-row[data-i="6"]').click();
  await expect(page.locator("#npCs")).toHaveText("NITE");
  await expect(page.locator("#osdNum")).toHaveText("FM 88.4");
});

test("claim a number from Run through the waitlist sheet", async ({ page }) => {
  await open(page, "/run");
  await page.locator("#claim").scrollIntoViewIfNeeded();
  await page.click('#pick button[data-n="22.1"]');
  await page.fill("#csIn", "taco");
  await expect(page.locator("#csMsg")).toHaveText("TACO on 22.1 is free. Claim it.");
  await page.click("#claimBtn");
  await expect(page.locator("#waitlist")).toBeVisible();
  await expect(page.locator("#wlRole .on")).toHaveText("A station");
  await expect(page.locator("#wlCs")).toHaveValue("TACO");
  await expect(page.locator("#wlCh")).toHaveText("22.1");
  expect(await joinWaitlist(page)).toBe("TACO is on hold for you.");
  await expect(page.locator("#wlHeldN")).toHaveText("22.1");
});

test("filter the syndication market on desktop", async ({ page }) => {
  await open(page, "/syndication");
  await page.locator("#fits").scrollIntoViewIfNeeded();
  await expect(page.locator("#fCount")).toHaveText("11 programs fit");
  await page.click('.f-dd[data-k="terms"] .f-dd-b');
  await page.click('.f-dd[data-k="terms"] [data-v="free"]');
  await expect(page.locator("#fCount")).toHaveText("5 programs fit");
  await page.click('.f-dd[data-k="len"] .f-dd-b');
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#fCount")).toHaveText("1 program fits");
  await expect(page.locator("#fList .fp")).toHaveCount(1);
  await page.fill("#fQ", "zzz");
  await expect(page.locator("#fList")).toContainText("Nothing fits that yet");
});

test("filter the syndication market on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/syndication");
  await page.locator("#fits").scrollIntoViewIfNeeded();
  await page.click("#fMob");
  await expect(page.locator("#fSheet")).toBeVisible();
  await page.click('#fSheet .seg2[data-k="slot"] [data-v="late"]');
  await expect(page.locator("#fShowN")).toHaveText("Show 6 programs");
  await expect(page.locator("#fN")).toHaveText("1");
  await page.click("#fDone");
  await expect(page.locator("#fSheet")).toBeHidden();
  await expect(page.locator("#fCount")).toHaveText("6 programs fit");
  await expect(page.locator("#fMob")).toBeFocused();
});

test("plan a spot and start it", async ({ page }) => {
  await open(page, "/spots");
  await page.locator("#plan").scrollIntoViewIfNeeded();
  await expect(page.locator("#oSt")).toHaveText("3");
  await expect(page.locator("#oAd")).toHaveText("9.5");
  await page.click('#pWhere [data-v="online"]');
  await expect(page.locator("#oSt")).toHaveText("8");
  await page.click('#pKind [data-v="Music"]');
  await expect(page.locator("#oSt")).toHaveText("6");
  await page.click("#planStart");
  await expect(page.locator("#waitlist")).toBeVisible();
  await expect(page.locator("#wlRole .on")).toHaveText("A business");
  await expect(page.locator("#wlDetails")).toContainText("Online: Inland Empire, Long Beach");
  await expect(page.locator("#wlDetails")).toContainText("Film, Food, Sports, Civic, Talk, Radio");
  expect(await joinWaitlist(page)).toBe("Your business is on the list.");
});

test("check a call sign and reserve it", async ({ page }) => {
  await open(page, "/network");
  await page.locator("#dial").scrollIntoViewIfNeeded();
  await expect(page.locator("#csOut")).toHaveText("TACO is free. Reserve it and we hold it for 120 days.");
  await page.fill("#csIn", "KFRO");
  await expect(page.locator("#csOut")).toHaveText("Too close to a real FCC call sign. Try three or five letters.");
  await expect(page.locator("#csGo")).toBeHidden();
  await page.fill("#csIn", "ESPN");
  await expect(page.locator("#csOut")).toHaveText("That one belongs to someone else.");
  await page.fill("#csIn", "MESA");
  await expect(page.locator("#csCk li").nth(3)).toContainText("Already 33.1 in High Desert");
  await page.fill("#csIn", "SUNNY");
  await expect(page.locator("#csOut")).toHaveText("SUNNY is free. Reserve it and we hold it for 120 days.");
  await page.click("#csRes");
  await expect(page.locator("#waitlist")).toBeVisible();
  await expect(page.locator("#wlCs")).toHaveValue("SUNNY");
  expect(await joinWaitlist(page)).toBe("SUNNY is on hold for you.");
});

for (const desk of ["stations", "makers", "advertisers", "public", "press", "rights"]) {
  test(`send a contact message to the ${desk} desk`, async ({ page }) => {
    await open(page, "/contact");
    await page.click(`#sbJacks [data-desk="${desk}"]`);
    await expect(page.locator("#sbDesk")).toContainText("desk ·");
    await expect(page.locator(`.ct-desk[data-desk="${desk}"]`)).toBeVisible();
    for (const input of await page.locator(`.ct-desk[data-desk="${desk}"] input`).all()) {
      await input.fill((await input.getAttribute("type")) === "url" ? "https://example.com/show" : "Test value");
    }
    await page.fill("#ctName", "Ana Ruiz");
    await page.fill("#ctEmail", "ana@example.com");
    await page.fill("#ctMsg", `A question for the ${desk} desk.`);
    await page.click("#ctGo");
    await expect(page.locator("#ctSent")).toBeVisible();
    await expect(page.locator("#ctSentH")).toHaveText("Patched through.");
    await expect(page.locator("#ctSentP")).toHaveText("We'll write back to ana@example.com.");
  });
}
