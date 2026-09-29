import { beforeEach, describe, expect, it } from "vitest";
import { balanceOf, getDb, resetDb } from "../db";
import { OSC_ID } from "./businesses";
import * as deals from "./deals";

const $ = (d: number) => Math.round(d * 1_000_000);
const DRAFT = "a family coffee house on Orange Street in downtown Redlands, and home of the best pumpkin bread in the Inland Empire. Come by this weekend.";

beforeEach(() => {
  localStorage.clear();
  resetDb();
  deals.resetDeals();
});

describe("the credit rules check", () => {
  it("flags the frame's comparison and call to action, and names who and where", () => {
    const c = deals.checkCredit(DRAFT);
    expect(c.passes).toBe(false);
    expect(c.flags.map((f) => f.kind)).toEqual(["comparison", "call_to_action"]);
    const [cmp, act] = c.flags;
    expect(cmp!.quote).toBe("the best");
    expect(cmp!.suggestion).toBe("home of the pumpkin bread");
    expect(act!.quote).toBe("Come by this weekend");
    expect(act!.suggestion).toBe("");
    expect(c.who).toBe("A family coffee house on Orange Street in downtown Redlands");
  });

  it("previews the credit with every fix applied", () => {
    const c = deals.checkCredit(DRAFT);
    expect(deals.applyFlags(DRAFT, c.flags)).toBe("a family coffee house on Orange Street in downtown Redlands, and home of the pumpkin bread.");
  });

  it("passes once the fixes are used, one at a time", () => {
    let text = DRAFT;
    for (let i = 0; i < 3; i++) {
      const c = deals.checkCredit(text);
      if (c.passes) break;
      text = deals.applyFlag(text, c.flags[0]!);
    }
    const c = deals.checkCredit(text);
    expect(c.passes).toBe(true);
    expect(c.flags).toEqual([]);
  });

  it("flags prices and offers, and removes the clause with its comma", () => {
    const text = "A family coffee house in Redlands, with 10% off lattes.";
    const c = deals.checkCredit(text);
    expect(c.flags).toHaveLength(1);
    expect(c.flags[0]!.kind).toBe("price_or_offer");
    expect(c.flags[0]!.quote).toBe("10% off");
    expect(deals.applyFlags(text, c.flags)).toBe("A family coffee house in Redlands.");
  });

  it("doesn't pass an empty credit", () => {
    expect(deals.checkCredit("   ").passes).toBe(false);
  });
});

describe("sponsorships", () => {
  const offer = () =>
    deals.offerSponsorship(OSC_ID, { stationId: deals.BEAT.id, programId: deals.PROGRAM_IDS.beatTapeLive, monthlyMicros: $(75), creditText: "A family coffee house on Orange Street in downtown Redlands, and home of the pumpkin bread.", startsOn: "2026-10-01" }, new Date("2026-09-27T03:42:00Z"));

  it("sends a request that passes the rules and the minimum", () => {
    const x = offer();
    expect("status" in x).toBe(false);
    expect((x as deals.FxSponsorship).state).toBe("requested");
    // It's no longer offered as a target, and asking again is refused.
    expect(deals.targetsFor(OSC_ID).targets.some((t) => t.program?.id === deals.PROGRAM_IDS.beatTapeLive)).toBe(false);
    expect("status" in offer()).toBe(true);
  });

  it("refuses under the minimum, and a flagged credit", () => {
    const base = { stationId: deals.BEAT.id, programId: deals.PROGRAM_IDS.beatTapeLive, startsOn: "2026-10-01" };
    expect(deals.offerSponsorship(OSC_ID, { ...base, monthlyMicros: $(50), creditText: "A coffee house in Redlands." })).toMatchObject({ code: "under_minimum" });
    expect(deals.offerSponsorship(OSC_ID, { ...base, monthlyMicros: $(75), creditText: DRAFT })).toMatchObject({ code: "credit_flagged" });
  });

  it("is held on the 1st once approved, credited from its start, and paid to the station at the month's end", () => {
    const x = offer() as deals.FxSponsorship;
    deals.decideSponsorship(x, { decision: "approve" });
    expect(x.state).toBe("approved");
    const before = balanceOf(OSC_ID).availableMicros;
    deals.settle(new Date("2026-09-28T03:00:00Z"));
    expect(x.state).toBe("approved");
    expect(balanceOf(OSC_ID).availableMicros).toBe(before);

    deals.settle(new Date("2026-10-01T16:00:00Z"));
    expect(x.state).toBe("credited");
    expect(x.heldMonths).toEqual(["2026-10"]);
    // October held for Beat Tape Live ($75) and for Council Watch ($50), from available.
    expect(balanceOf(OSC_ID).availableMicros).toBe(before - $(125));
    const heldBefore = balanceOf(OSC_ID).heldMicros;

    deals.settle(new Date("2026-11-01T16:00:00Z"));
    expect(x.heldMonths).toEqual(["2026-11"]);
    // October's two holds paid out, November's two held.
    expect(balanceOf(OSC_ID).heldMicros).toBe(heldBefore);
    expect(balanceOf(OSC_ID).availableMicros).toBe(before - $(250));
    const paid = getDb().movements[OSC_ID]!.filter((m) => m.kind === "sponsorship");
    expect(paid.map((m) => m.amountMicros).sort((a, b) => a - b)).toEqual([-$(75), -$(50)]);
    expect(paid[0]!.at).toBe("2026-11-01T07:00:00.000Z");
  });

  it("lapses when the balance can't cover a month", () => {
    const x = offer() as deals.FxSponsorship;
    deals.decideSponsorship(x, { decision: "approve" });
    balanceOf(OSC_ID).availableMicros = $(60);
    deals.settle(new Date("2026-10-01T16:00:00Z"));
    expect(x.state).toBe("lapsed");
  });

  it("ends a request at once, and a running one with its paid month", () => {
    const x = offer() as deals.FxSponsorship;
    deals.endSponsorship(x, new Date("2026-09-28T03:00:00Z"));
    expect(x.state).toBe("ended");

    const cw = deals.getDeals().sponsorships.find((s) => s.id === deals.SPONSORSHIP_IDS.councilWatch)!;
    deals.endSponsorship(cw, new Date("2026-09-28T03:00:00Z"));
    expect(cw.state).toBe("credited");
    expect(cw.renewsOn).toBeNull();
    deals.settle(new Date("2026-10-01T16:00:00Z"));
    expect(cw.state).toBe("ended");
  });
});

describe("production orders", () => {
  const giftCards = () => deals.getDeals().orders.find((o) => o.id === deals.ORDER_IDS.giftCards)!;

  it("holds the price on accepting the quote", () => {
    const b = balanceOf(OSC_ID);
    const [avail, held] = [b.availableMicros, b.heldMicros];
    deals.acceptQuote(giftCards());
    expect(giftCards().state).toBe("accepted");
    expect(b.availableMicros).toBe(avail - $(140));
    expect(b.heldMicros).toBe(held + $(140));
    expect(b.availableMicros).toBe($(272.5));
  });

  it("refuses a quote the balance can't cover", () => {
    balanceOf(OSC_ID).availableMicros = $(100);
    expect(deals.acceptQuote(giftCards())).toMatchObject({ code: "not_enough", message: "Your available balance is $100.00. Add money to accept." });
  });

  it("pays the maker on approval and becomes a draft spot with the order's id", () => {
    const o = giftCards();
    deals.acceptQuote(o);
    deals.deliverOrder(o, new Date("2026-09-27T03:50:00Z"));
    expect(o.state).toBe("delivered");
    expect(o.autoApproveAt).toBe("2026-10-04T03:50:00.000Z");
    deals.addOrderNote(o, "Jess Lin", { timecodeMs: 6000, body: "Bigger logo." });
    const b = balanceOf(OSC_ID);
    const [avail, held] = [b.availableMicros, b.heldMicros];
    deals.reviewDelivery(o, "approve");
    expect(o.state).toBe("approved");
    expect(b.availableMicros).toBe(avail);
    expect(b.heldMicros).toBe(held - $(140));
    const spot = getDb().spots.find((s) => s.id === o.spotId)!;
    expect(spot).toMatchObject({ title: "Holiday gift cards", state: "draft", productionOrderId: o.id });
    const lines = getDb().movements[OSC_ID]!.slice(0, 2).map((m) => [m.kind, m.label, m.amountMicros]);
    expect(lines).toEqual([
      ["order", "Paid to BEAT 12.1", -$(140)],
      ["held", "Held for Holiday gift cards", $(140)]
    ]);
  });

  it("approves itself 7 days after delivery", () => {
    const brunch = deals.getDeals().orders.find((o) => o.id === deals.ORDER_IDS.brunch)!;
    deals.settle(new Date(Date.parse(brunch.autoApproveAt!) - 60_000));
    expect(brunch.state).toBe("delivered");
    deals.settle(new Date(Date.parse(brunch.autoApproveAt!) + 60_000));
    expect(brunch.state).toBe("approved");
    expect(brunch.spotId).not.toBeNull();
  });

  it("uses a round for changes, but not for the maker's own mistakes", () => {
    const brunch = deals.getDeals().orders.find((o) => o.id === deals.ORDER_IDS.brunch)!;
    for (const n of brunch.notes) deals.markOwnMistake(brunch, n.id);
    expect(deals.changesUseARound(brunch)).toBe(false);
    deals.reviewDelivery(brunch, "request_changes");
    expect(brunch.state).toBe("changes_requested");
    expect(brunch.roundsUsed).toBe(0);

    deals.deliverOrder(brunch);
    deals.addOrderNote(brunch, "Jess Lin", { timecodeMs: 3000, body: "Warmer music." });
    deals.reviewDelivery(brunch, "request_changes");
    expect(brunch.roundsUsed).toBe(1);

    deals.deliverOrder(brunch);
    deals.addOrderNote(brunch, "Jess Lin", { timecodeMs: 3000, body: "Still not right." });
    expect(deals.reviewDelivery(brunch, "request_changes")).toMatchObject({ code: "no_rounds" });
    deals.reviewDelivery(brunch, "dispute");
    expect(brunch.state).toBe("disputed");
  });

  it("cancels freely before accepting, and after the delivery date with everything back", () => {
    const o = giftCards();
    deals.acceptQuote(o);
    expect(deals.cancelOrder(o, new Date("2026-10-05T18:00:00Z"))).toMatchObject({ code: "not_late", message: "You can cancel if BEAT 12.1 hasn't delivered by October 9." });
    const b = balanceOf(OSC_ID);
    const avail = b.availableMicros;
    deals.cancelOrder(o, new Date("2026-10-10T18:00:00Z"));
    expect(o.state).toBe("cancelled");
    expect(b.availableMicros).toBe(avail + $(140));
    expect(getDb().movements[OSC_ID]![0]).toMatchObject({ kind: "returned", amountMicros: $(140) });
  });

  it("quotes new orders as the maker usually does", () => {
    const o = deals.orderSpot(OSC_ID, { makerStationId: deals.BEAT.id, title: "Winter hours", lengthSec: 15, about: "Shorter hours in winter.", neededBy: "2026-11-01" }, new Date("2026-09-27T03:42:00Z")) as deals.FxOrder;
    expect(o.state).toBe("asked");
    deals.quoteOrder(o, deals.mockQuoteFor(o, new Date("2026-09-27T03:42:00Z")));
    expect(o.quote).toEqual({ priceMicros: $(140), deliverBy: "2026-10-09", roundsIncluded: 1, voicedBy: "Jen Park, host of Beat Tape Live" });
    expect(deals.orderSpot(OSC_ID, { makerStationId: deals.BEAT.id, title: "x", lengthSec: 15, about: "y", neededBy: "2026-09-26" }, new Date("2026-09-27T03:42:00Z"))).toMatchObject({ code: "needed_by_past" });
  });
});

describe("dates in the market's zone", () => {
  it("reads the local date and the next month's first", () => {
    // 8:42 pm Saturday September 26 in Redlands is 03:42 UTC on the 27th.
    expect(deals.localDate("2026-09-27T03:42:00Z")).toBe("2026-09-26");
    expect(deals.nextMonthStart("2026-09-27T03:42:00Z")).toBe("2026-10-01");
    expect(deals.nextMonthStart("2026-12-15T12:00:00Z")).toBe("2027-01-01");
    expect(deals.addDays("2026-09-26", 13)).toBe("2026-10-09");
  });
});
