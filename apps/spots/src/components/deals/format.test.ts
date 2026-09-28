import { describe, expect, it } from "vitest";
import type { OrderX, SponsorshipX } from "../../api/ext/deals";
import * as f from "./format";

const BEAT = { id: "b", kind: "station", callSign: "BEAT", handle: "beat", name: "Inland Beat", colour: "#8C3B7A", band: "tv", channel: "12.1", marketSlug: "inland-empire", homeCity: "Redlands" } as const;
const STUDIO = { ...BEAT, kind: "studio", callSign: null, channel: null, name: "Opencast Studio", colour: null } as const;
const TODAY = "2026-09-26";

const sp = (o: Partial<SponsorshipX>): SponsorshipX => ({
  id: "s",
  business: { id: "x", name: "Orange Street Coffee" },
  station: BEAT,
  program: { id: "p", title: "Beat Tape Live" },
  programFormat: "Weekly, live",
  monthlyMicros: 75_000_000,
  creditText: "",
  state: "requested",
  declineReason: null,
  startsOn: "2026-10-01",
  renewsOn: null,
  createdAt: "2026-09-26T22:00:00Z",
  ...o
});

describe("sponsorships as the business reads them", () => {
  it("writes the list's lines as the frames do", () => {
    expect(f.sponsorshipTitle(sp({}))).toBe("Beat Tape Live on BEAT 12.1");
    expect(f.sponsorshipTitle(sp({}), true)).toBe("Beat Tape Live on BEAT");
    expect(f.sponsorshipTitle(sp({ program: null }))).toBe("All of BEAT 12.1");
    expect(f.sponsorshipLine(sp({}))).toBe("One program, weekly, live");
    expect(f.sinceText(sp({}), TODAY)).toBe("From October 1");
    expect(f.sinceText(sp({ startsOn: "2026-08-01" }), TODAY)).toBe("August 1");
    expect(f.phoneLine(sp({}), TODAY)).toBe("$75.00 a month, from October 1");
    expect(f.phoneLine(sp({ startsOn: "2026-08-01", monthlyMicros: 50_000_000 }), TODAY)).toBe("$50.00 a month, since August");
  });

  it("uses the shared state words, the station's call sign, and the phone's short form", () => {
    expect(f.sponsorshipTag(sp({}))).toEqual({ text: "Waiting for BEAT", tone: "wait" });
    expect(f.sponsorshipTag(sp({ state: "credited" }))).toEqual({ text: "Credited on air", tone: "on" });
    expect(f.sponsorshipTag(sp({ state: "credited" }), true).text).toBe("Credited");
    expect(f.sponsorshipTag(sp({ state: "approved" })).text).toBe("Approved");
    expect(f.declineLine(sp({ state: "declined", declineReason: "full" }))).toBe("BEAT's reason: We're full.");
  });

  it("adds up what's held next month", () => {
    const list = [sp({ state: "approved", renewsOn: "2026-10-01" }), sp({ state: "credited", monthlyMicros: 50_000_000, renewsOn: "2026-10-01" }), sp({ state: "requested" }), sp({ state: "credited", renewsOn: null })];
    expect(f.nextMonthHold(list, TODAY)).toEqual({ on: "2026-10-01", micros: 125_000_000 });
  });

  it("ends a stopped sponsorship with its paid month", () => {
    expect(f.endsOn(sp({ state: "credited", startsOn: "2026-08-01", renewsOn: null }), TODAY)).toBe("2026-09-30");
    expect(f.endsOn(sp({ state: "credited", renewsOn: "2026-10-01" }), TODAY)).toBeNull();
  });

  it("says what's room and what's full", () => {
    expect(f.roomLine({ schedule: "Saturdays at 9:00 pm, live", sponsors: 0, maxSponsors: 2 })).toBe("Saturdays at 9:00 pm, live. No sponsors yet, room for 2");
    expect(f.roomLine({ schedule: "Credited in every break, 24 hours", sponsors: 2, maxSponsors: 3 })).toBe("Credited in every break, 24 hours. 2 sponsors, room for 1");
    expect(f.roomLine({ schedule: "Weekly", sponsors: 0, maxSponsors: null })).toBe("Weekly. No sponsors yet");
    expect(f.hasRoom({ sponsors: 2, maxSponsors: 2 })).toBe(false);
  });

  it("reads typed amounts", () => {
    expect(f.parseAmount("$75.00")).toBe(75_000_000);
    expect(f.parseAmount("1,200")).toBe(1_200_000_000);
    expect(f.parseAmount("7.5")).toBe(7_500_000);
    expect(f.parseAmount("abc")).toBeNull();
  });
});

describe("the credit flags' words", () => {
  it("words each kind as drawn", () => {
    expect(f.flagWords({ kind: "comparison", text: "x", start: 0, end: 1, suggestion: "home of the pumpkin bread", quote: "the best" })).toEqual({
      title: '"The best" is a comparison',
      detail: 'Say what you make instead, like "home of the pumpkin bread"',
      action: "Use that"
    });
    expect(f.flagWords({ kind: "call_to_action", text: " Come by this weekend.", start: 0, end: 1, suggestion: "", quote: "Come by this weekend" }).title).toBe('"Come by this weekend" asks people to act');
    expect(f.fixLine(2)).toBe("Fix the 2 flagged phrases to send.");
    expect(f.applyFixes("ab cd ef", [{ start: 3, end: 5, suggestion: "XY" }, { start: 0, end: 2, suggestion: "" }])).toBe(" XY ef");
  });
});

const order = (o: Partial<OrderX>): OrderX => ({
  id: "o",
  business: { id: "x", name: "Orange Street Coffee" },
  maker: BEAT,
  title: "Holiday gift cards",
  lengthSec: 30,
  about: "",
  mustSay: null,
  neededBy: "2026-11-20",
  state: "quoted",
  quote: { priceMicros: 140_000_000, deliverBy: "2026-10-09", roundsIncluded: 1, voicedBy: "Jen Park, host of Beat Tape Live" },
  roundsUsed: 0,
  briefFiles: [],
  deliveries: [],
  notes: [],
  deliveredAt: null,
  autoApproveAt: null,
  spotId: null,
  tellMakerWhenListed: false,
  createdAt: "2026-09-24T17:14:00Z",
  ...o
});

describe("orders as the business reads them", () => {
  it("colours the state by whose turn it is", () => {
    expect(f.orderTag(order({}))).toEqual({ text: "Quote ready, your turn", tone: "you" });
    expect(f.orderTag(order({ state: "delivered", autoApproveAt: "2026-10-02T18:20:00Z" }))).toEqual({ text: "Delivered, review by Oct 2", tone: "you" });
    expect(f.orderTag(order({ state: "asked" })).tone).toBe("wait");
    expect(f.orderTag(order({ state: "approved" }))).toEqual({ text: "Approved. It's a spot now", tone: "on" });
  });

  it("writes the order line and the action as the frame does", () => {
    expect(f.orderLine(order({}))).toBe(":30, asked September 24");
    expect(f.orderLine(order({ state: "delivered", lengthSec: 15, deliveredAt: "2026-09-25T18:20:00Z" }))).toBe(":15, delivered September 25");
    expect(f.orderLine(order({ state: "approved", approvedAt: "2026-09-22T16:30:00Z" }))).toBe(":30, approved September 22");
    expect(f.orderAction(order({ state: "delivered" }))).toBe("Review");
    expect(f.orderAction(order({ state: "approved", spotId: "s" }))).toBe("Spot");
    expect(f.orderAction(order({}))).toBe("Open");
  });

  it("walks the five steps", () => {
    expect(f.orderSteps("quoted").map((s) => s.state)).toEqual(["done", "current", "todo", "todo", "todo"]);
    expect(f.orderSteps("delivered").map((s) => s.state)).toEqual(["done", "done", "done", "current", "todo"]);
    expect(f.orderSteps("approved").map((s) => s.state)).toEqual(["done", "done", "done", "done", "current"]);
  });

  it("says where a delivery came from, and how early", () => {
    expect(f.deliveredLine(order({ deliveredAt: "2026-10-09T02:48:00Z" }), "2026-10-08")).toBe("From BEAT 12.1, voiced by Jen Park. Delivered today, a day early.");
    expect(f.orderSubtitle(order({ maker: STUDIO, lengthSec: 15, deliveredAt: "2026-09-25T18:20:00Z" }))).toBe("A :15 from Opencast Studio, delivered September 25.");
  });

  it("offers the round, the maker's fixes, or Opencast's review", () => {
    expect(f.changesButton(order({}), true)).toEqual({ label: "Ask for changes, using your 1 round", decision: "request_changes" });
    expect(f.changesButton(order({}), false).label).toBe("Ask for the fixes");
    expect(f.changesButton(order({ roundsUsed: 1 }), true)).toEqual({ label: "Ask Opencast to review it", decision: "dispute" });
    expect(f.roundsIncluded(1)).toBe("1 round of changes included");
  });
});
