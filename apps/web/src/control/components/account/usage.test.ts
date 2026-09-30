// The Station account's words (pay-as-you-go): units and prices, the free allowance, caps and what
// reaching one pauses, each standing, and where a bill's money came from.

import { describe, expect, it } from "vitest";
import type { StationAccount, UsageBill, UsageLine } from "@opencast/contracts";
import { allowanceText, bannerWords, billDetail, capDetail, capEffect, cardExpiry, dueMonthsText, hoursText, pausedList, priceText, standingWords, unitPrice, usageDetail } from "./usage";

const $ = (d: number) => Math.round(d * 1_000_000);

const line = (over: Partial<UsageLine>): UsageLine => ({
  type: "relay_everything",
  label: "Relays, everything you air",
  unit: "hour",
  quantity: 156.925833,
  currentGb: null,
  allowance: null,
  priceMicros: $(0.2),
  free: false,
  soFarMicros: $(31.39),
  estimate: { quantity: 180, micros: $(36) },
  cap: { micros: $(60), reached: false, cappable: true },
  paused: null,
  pauses: "Relays of everything you air",
  ...over
});

const bill = (over: Partial<UsageBill>): UsageBill => ({
  id: "b",
  month: "2026-08",
  status: "paid",
  amountMicros: $(38.94),
  fromEarningsMicros: $(38.94),
  fromClearMicros: 0,
  fromCardMicros: 0,
  dueMicros: 0,
  lastAttempt: null,
  paidAt: "2026-09-01T00:00:00.000Z",
  lines: null,
  ...over
});

const funding = (over: Partial<StationAccount["funding"]> = {}): StationAccount["funding"] => ({
  earningsFirst: true,
  earningsAvailableMicros: $(88.2),
  source: "card",
  chosen: null,
  clear: { available: false, access: null, address: null, why: "Connect Clear first." },
  card: { label: "Visa ending 0002", expiresOn: "2027-03-31", expired: false },
  cardsAvailable: true,
  ...over
});

const declined = bill({ status: "due", amountMicros: $(96.4), fromEarningsMicros: 0, dueMicros: $(96.4), paidAt: null, lastAttempt: { at: "2026-09-20T03:42:12.000Z", method: "card", result: "failed", reason: "Your card was declined." } });

describe("units, prices and the allowance", () => {
  it("writes hours, GB-months and unit prices", () => {
    expect(hoursText(1)).toBe("1 hour");
    expect(hoursText(3.5)).toBe("3.5 hours");
    expect(hoursText(156.925833)).toBe("156.9 hours");
    expect(unitPrice($(0.04))).toBe("$0.04");
    expect(unitPrice(18_000)).toBe("$0.018");
    expect(priceText("gb_month", $(0.04))).toBe("$0.04 a GB-month");
    expect(priceText("hour", $(0.75))).toBe("$0.75 an hour");
    expect(priceText("hour", 0)).toBe("Free");
    expect(priceText("hour", null)).toBe("Price not set yet");
  });

  it("says the free allowance used and left", () => {
    expect(allowanceText({ unit: "hour", allowance: { quantity: 5, left: 3.5 } })).toBe("3.5 of 5 free hours left");
    expect(allowanceText({ unit: "hour", allowance: { quantity: 5, left: 0 } })).toBe("5 free hours a month, all used");
    expect(allowanceText({ unit: "gb_month", allowance: { quantity: 10, left: 4.2 } })).toBe("4.2 of 10 GB free left");
    expect(allowanceText({ unit: "hour", allowance: null })).toBeNull();
  });

  it("puts a line's usage, estimate, allowance and price together", () => {
    expect(usageDetail(line({}))).toBe("156.9 hours so far, about 180 hours by the month's end. $0.20 an hour.");
    expect(usageDetail(line({ type: "live_hours", label: "Live hours", quantity: 1.5, estimate: { quantity: 1.5, micros: 0 }, allowance: { quantity: 5, left: 3.5 }, priceMicros: $(0.75) }))).toBe("1.5 hours so far. 3.5 of 5 free hours left. $0.75 an hour.");
    expect(usageDetail(line({ type: "relay_live_only", quantity: 0, estimate: { quantity: 0, micros: 0 }, priceMicros: 0, free: true }))).toBe("0 hours so far. Always free.");
  });
});

describe("caps", () => {
  it("says what reaching one pauses, never the channel", () => {
    expect(capEffect("relay_everything")).toBe("Relays pause for the rest of the month; your channel stays on air.");
    expect(capEffect("storage")).toBe("New uploads and imports pause for the rest of the month; your channel stays on air.");
    expect(capEffect("live_hours")).toBe("Live shows pause for the rest of the month (station ID and bumpers air instead); your channel stays on air.");
  });

  it("none, set, reached", () => {
    expect(capDetail(line({ cap: { micros: null, reached: false, cappable: true } }))).toBe("No cap. At a cap: relays pause for the rest of the month; your channel stays on air.");
    expect(capDetail(line({}))).toBe("$31.39 of $60.00 so far. At the cap: relays pause for the rest of the month; your channel stays on air.");
    expect(capDetail(line({ soFarMicros: $(5), cap: { micros: $(5), reached: true, cappable: true }, paused: "cap" }))).toBe("Reached $5.00. Relays pause for the rest of the month; your channel stays on air. Raise the cap to bring it back.");
  });
});

describe("standing", () => {
  const base = { dueMicros: 0, grace: null, bills: [bill({})], usage: [line({})], funding: funding() };

  it("ok: nothing to say, no banner", () => {
    expect(standingWords({ ...base, standing: "ok" }, true)).toBeNull();
    expect(bannerWords({ ...base, standing: "ok" })).toBeNull();
  });

  it("grace: what's due, until when, the channel on air, the last try", () => {
    const grace = { ...base, standing: "grace" as const, dueMicros: $(96.4), bills: [declined], grace: { startedOn: "2026-09-20", pausesOn: "2026-10-04", daysLeft: 7, dueMicros: $(96.4) } };
    expect(dueMonthsText(grace.bills)).toBe("August");
    expect(standingWords(grace, true)).toEqual({
      tone: "standby",
      title: "$96.40 is due for August's usage",
      detail: "Relays and live shows keep going until October 4 (7 days), then pause until it's paid. Your channel stays on air. Visa ending 0002: Your card was declined."
    });
    expect(standingWords(grace, false)!.detail).toMatch(/ An owner can pay it here\.$/);
    expect(standingWords({ ...grace, funding: funding({ source: null, card: null }) }, true)!.detail).toMatch(/Add a card or connect Clear with full access to pay it\.$/);
    expect(bannerWords(grace)).toEqual({ title: "Relays and live shows pause on October 4", detail: "$96.40 is due for August's usage. Your channel stays on air." });
  });

  it("paused: what's paused, the channel still on air", () => {
    const usage = [line({ paused: "unpaid" }), line({ type: "live_hours", paused: "unpaid", pauses: "Live shows (station ID and bumpers air instead)" }), line({ type: "storage", paused: null, pauses: "New uploads and imports" })];
    expect(pausedList(usage)).toEqual(["Relays of everything you air", "Live shows (station ID and bumpers air instead)"]);
    const paused = { ...base, standing: "paused" as const, dueMicros: $(96.4), bills: [declined], usage, grace: { startedOn: "2026-09-10", pausesOn: "2026-09-24", daysLeft: 0, dueMicros: $(96.4) } };
    expect(standingWords(paused, true)!.title).toBe("Relays and live shows are paused");
    expect(standingWords(paused, true)!.detail).toBe(
      "$96.40 is still due for August's usage. Your channel is still on air. Paused: Relays of everything you air; Live shows (station ID and bumpers air instead). Visa ending 0002: Your card was declined. Pay it to bring them back."
    );
    expect(bannerWords(paused)).toEqual({ title: "Relays and live shows are paused", detail: "$96.40 is still due for August's usage. Your channel is still on air." });
  });
});

describe("bills and the card", () => {
  it("says where each month's money came from", () => {
    expect(billDetail(bill({}), null)).toBe("$38.94 from earnings.");
    expect(billDetail(bill({ amountMicros: 0, fromEarningsMicros: 0 }), null)).toBe("Inside the free allowance.");
    expect(billDetail(bill({ fromEarningsMicros: $(20), fromCardMicros: $(18.94) }), "Visa ending 4242")).toBe("$20.00 from earnings, $18.94 charged to Visa ending 4242.");
    expect(billDetail(bill({ fromEarningsMicros: 0, fromClearMicros: $(38.94) }), null)).toBe("$38.94 from Clear.");
    expect(billDetail(declined, "Visa ending 0002")).toBe("$96.40 due. Visa ending 0002: Your card was declined.");
    expect(billDetail(bill({ status: "open", month: "2026-09", amountMicros: $(31.27), fromEarningsMicros: $(26.06), dueMicros: $(5.21) }), null)).toBe("So far. $26.06 from earnings, $5.21 to take at the month's end.");
  });

  it("says when the card expires", () => {
    expect(cardExpiry({ label: "Visa ending 4242", expiresOn: "2029-08-31", expired: false })).toBe("Expires August 2029");
    expect(cardExpiry({ label: "Visa ending 4242", expiresOn: "2026-08-31", expired: true })).toBe("Expired August 2026");
  });
});
