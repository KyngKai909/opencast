// The Settings area's rules: how days, people and money sources are written; who sees and changes
// what; addresses to places; the switcher keeping the page. On the reference's Saturday, 8:42 pm.

import { describe, expect, it } from "vitest";
import { swapBusiness } from "../overlays/BusinessSwitcher";
import { addressLine, dayWord, firstName, fundingDetail, fundingTitle, inviteState, invitedLine, lastIn, peopleLine, shortDay, warnLine, websiteShown, websiteToSave, whereLine } from "./format";
import { CLEAR_ACCESS, clearLinkedLine, clearPayLine } from "./ConnectionsSection";
import { emailOf } from "./InviteModal";
import { topUpLine } from "./MoneySection";
import { addressPlace, cityPlace } from "./place";
import { accessFor, sectionsFor } from "./rules";

const TZ = "America/Los_Angeles";
const NOW = new Date("2026-09-27T03:42:00Z"); // Saturday September 26, 8:42 pm
const at = (s: string) => new Date(`${s}-07:00`);

describe("the team list's days", () => {
  it("says Now, Yesterday and the weekday, as the frame does", () => {
    expect(lastIn(at("2026-09-26T20:40:00"), NOW, TZ)).toBe("Now");
    expect(lastIn(at("2026-09-26T09:00:00"), NOW, TZ)).toBe("Today");
    expect(lastIn(at("2026-09-25T17:00:00"), NOW, TZ)).toBe("Yesterday");
    expect(lastIn(at("2026-09-21T10:00:00"), NOW, TZ)).toBe("Monday");
    expect(lastIn(at("2026-09-24T15:00:00"), NOW, TZ)).toBe("Thursday");
    expect(lastIn(at("2026-09-15T15:00:00"), NOW, TZ)).toBe("Last Tuesday");
    expect(lastIn(null, NOW, TZ)).toBe("Not yet");
  });
  it("counts days in the market's zone, not UTC", () => {
    // 11:30 pm Friday in Redlands is already Saturday in UTC.
    expect(dayWord(at("2026-09-25T23:30:00"), NOW, TZ)).toBe("Yesterday");
  });
  it("names the day an invite went out, yesterday included", () => {
    expect(invitedLine(at("2026-09-25T10:00:00"), NOW, TZ)).toBe("Invited Friday");
    expect(invitedLine(at("2026-09-26T10:00:00"), NOW, TZ)).toBe("Invited today");
    expect(invitedLine(at("2026-08-19T10:00:00"), NOW, TZ)).toBe("Invited Aug 19");
  });
  it("marks an invite expired after its week", () => {
    expect(inviteState(at("2026-10-02T10:00:00"), NOW)).toBe("Not joined yet");
    expect(inviteState(at("2026-09-26T10:00:00"), NOW)).toBe("Invite expired");
  });
  it("counts people, invites included", () => {
    expect(peopleLine(5, "Orange Street Coffee")).toBe("5 people on Orange Street Coffee.");
    expect(peopleLine(1, "Cypress Dental")).toBe("1 person on Cypress Dental.");
  });
  it("greets by first name", () => {
    expect(firstName("Jess Lin")).toBe("Jess");
    expect(firstName(null)).toBeNull();
  });
});

describe("money and receipts", () => {
  it("writes the short months the frame uses", () => {
    expect(shortDay(at("2026-10-01T00:05:00"), TZ)).toBe("Oct 1");
    expect(shortDay(at("2026-09-24T10:00:00"), TZ)).toBe("Sept 24");
    expect(shortDay(at("2026-06-03T10:00:00"), TZ)).toBe("June 3");
  });
  it("names funding sources and their fee", () => {
    expect(fundingTitle("clear_bank")).toBe("Bank, through Clear");
    expect(fundingDetail({ kind: "clear_bank", label: "Clear, Chase ending 8810" })).toBe("Chase ending 8810. No fee");
    expect(fundingDetail({ kind: "card", label: "Visa ending 4417" })).toBe("Visa ending 4417. Stripe's fee at cost");
  });
  it("says what topping up automatically does", () => {
    expect(topUpLine({ on: false, amountMicros: null, belowDays: 3 }, undefined)).toBe("Off");
    expect(topUpLine({ on: true, amountMicros: 200_000_000, belowDays: 3 }, { label: "Clear, Chase ending 8810" })).toBe(
      "On. Adds $200.00 from Chase ending 8810 when about 3 days of airings are left"
    );
    expect(topUpLine({ on: true, amountMicros: 100_000_000, belowDays: 1 }, undefined)).toBe("On. Adds $100.00 when about 1 day of airings is left");
  });
  it("words the pause warning from the business's warning days", () => {
    expect(warnLine([3, 1])).toBe("At 3 days and 1 day of airings left");
    expect(warnLine([1, 3, 5])).toBe("At 5 days, 3 days and 1 day of airings left");
    expect(warnLine([3])).toBe("At 3 days of airings left");
  });
});

describe("the profile", () => {
  it("shows a website without its scheme and saves it with one", () => {
    expect(websiteShown("https://orangestreet.example/")).toBe("orangestreet.example");
    expect(websiteShown("orangestreet.example")).toBe("orangestreet.example");
    expect(websiteToSave("orangestreet.example")).toBe("https://orangestreet.example");
    expect(websiteToSave("http://a.example")).toBe("http://a.example");
    expect(websiteToSave("  ")).toBeNull();
  });
  it("says where the business is as stations see it", () => {
    const loc = { id: "x", kind: "location" as const, label: null, streetAddress: "204 Orange St", city: "Redlands", latitude: 0, longitude: 0, radiusMiles: null };
    expect(whereLine({ category: "Coffee and food", customersWhere: "location", locations: [loc] })).toBe("Coffee and food. Redlands");
    expect(whereLine({ category: "Plumbing", customersWhere: "service_area", locations: [{ ...loc, kind: "service_area", city: "Riverside", radiusMiles: 20 }] })).toBe("Plumbing. Riverside, 20 miles");
    expect(whereLine({ category: "Shops", customersWhere: "online", locations: [loc] })).toBe("Shops. Online");
    expect(addressLine(loc)).toBe("204 Orange St, Redlands");
  });
  it("reads a typed address, dropping the state and ZIP", () => {
    expect(addressPlace("204 Orange St, Redlands, CA 92373")).toMatchObject({ streetAddress: "204 Orange St", city: "Redlands" });
    expect(addressPlace("1150 E Washington St, colton")).toMatchObject({ streetAddress: "1150 E Washington St", city: "Colton" });
    expect(addressPlace("Redlands")).toBeNull();
    expect(addressPlace("1 Main St, Springfield")).toBeNull();
    expect(cityPlace("rancho cucamonga")?.city).toBe("Rancho Cucamonga");
  });
});

describe("who sees and changes what", () => {
  it("gives the owner everything", () => {
    expect(accessFor("owner")).toEqual({ profile: "edit", team: "edit", funding: "edit", tax: "edit", receipts: "read", notifications: "edit", connections: "edit", close: "edit" });
    expect(sectionsFor("owner").map((s) => s.id)).toContain("close");
  });
  it("lets managers change the profile and read money, team and connections", () => {
    expect(accessFor("manager")).toMatchObject({ profile: "edit", team: "read", funding: "read", tax: "read", connections: "read", close: "hidden", notifications: "edit" });
    expect(sectionsFor("manager").map((s) => s.id)).not.toContain("close");
  });
  it("shows viewers receipts and their own notifications, and nothing to change", () => {
    expect(accessFor("viewer")).toMatchObject({ profile: "read", team: "read", funding: "hidden", tax: "hidden", receipts: "read", notifications: "edit", connections: "read", close: "hidden" });
  });
});

describe("small parts", () => {
  it("takes an email address for an invite", () => {
    expect(emailOf(" Maya@OrangeStreet.example ")).toBe("maya@orangestreet.example");
    expect(emailOf("maya")).toBeNull();
  });
  it("names the codes Clear Pay applies", () => {
    expect(clearPayLine(["ORANGE10", "PUMPKIN"])).toBe("Applies ORANGE10 and other codes when customers pay in person, and counts them in Results");
    expect(clearPayLine(["ORANGE10"])).toBe("Applies ORANGE10 when customers pay in person, and counts them in Results");
    expect(clearPayLine([])).toBe("Applies your codes when customers pay in person, and counts them in Results");
  });
  it("shows a linked Clear account short, with when and what it shares", () => {
    expect(clearLinkedLine({ address: "0x1f2e3dc1ea71f2e3dc1ea71f2e3dc1ea71f2e3dc", access: "full", linkedAt: "2026-09-26T21:00:00Z" }, TZ)).toBe("0x1f2e…e3dc. Linked Sept 26");
    expect(CLEAR_ACCESS.read_only).toBe("Payouts and withdrawals can go here. Money is added inside Clear.");
  });
  it("keeps the page when switching business, and drops what belongs to the old one", () => {
    const osc = "00000000-0000-4000-8000-000000060001";
    const cd = "00000000-0000-4000-8000-000000060002";
    expect(swapBusiness(`/${osc}/settings/team`, cd)).toBe(`/${cd}/settings/team`);
    expect(swapBusiness(`/${osc}/spots/00000000-0000-4000-8000-000000064001/rate`, cd)).toBe(`/${cd}/spots`);
    expect(swapBusiness(`/${osc}`, cd)).toBe(`/${cd}`);
  });
});
