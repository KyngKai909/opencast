// The Phase 2 STOP (pay-as-you-go), checked: October 2026 for three stations (test/billing-month.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { $, createMonthHarness, monthReport, noticesOf, runMonth, statementsOf, type MonthRun } from "./billing-month.js";

let run: MonthRun;

beforeAll(async () => {
  const { h, mirror, cards } = await createMonthHarness();
  run = await runMonth(h, mirror, cards);
}, 300_000);

afterAll(() => run?.h.close());

describe("a month of pay-as-you-go", () => {
  it("PREP stays inside the free allowance: nothing to pay, and it's told so", async () => {
    const a = run.accounts.prepEndOfMonth;
    const storage = a.usage.find((u) => u.type === "storage")!;
    expect(storage.quantity).toBeCloseTo((6 * 31) / 31, 5);
    expect(storage.allowance).toMatchObject({ quantity: 10 });
    expect(a.usage.find((u) => u.type === "live_hours")).toMatchObject({ quantity: 3, allowance: { quantity: 5, left: 2 }, soFarMicros: 0 });
    expect(a.totals.soFarMicros).toBe(0);
    expect(run.accounts.prepClosed.bills.find((b) => b.month === "2026-10")).toMatchObject({ month: "2026-10", status: "paid", amountMicros: 0, dueMicros: 0 });
    const notices = await noticesOf(run, run.owners.paz);
    expect(notices.map((n) => n.title)).toEqual(["October: inside the free allowance"]);
  });

  it("BEAT is paid from its earnings, taken before each payout", async () => {
    const mid = run.accounts.beatMidMonth;
    // Relays to two platforms at once count once: 6 hours a day, 84 by the 15th at noon; the
    // estimate is the month at that pace.
    const relays = mid.usage.find((u) => u.type === "relay_everything")!;
    expect(relays.quantity).toBeCloseTo(84, 5);
    expect(relays.estimate.quantity).toBeCloseTo((84 / 14.5) * 31, 5);
    expect(relays.soFarMicros).toBe($(16.8));
    // Storage as it stands, for the rest of the month: 40 GB-months, 30 over the allowance.
    expect(mid.usage.find((u) => u.type === "storage")!.estimate).toMatchObject({ quantity: expect.closeTo(40, 5), micros: $(1.2) });
    const bill = run.accounts.beatClosed.bills.find((b) => b.month === "2026-10")!;
    // Storage 30 GB-months over the free 10 at $0.04, relays 186 h at $0.20, live 10 h (5 free) at $0.75.
    expect(bill.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "storage", micros: $(1.2) }),
        expect.objectContaining({ type: "relay_everything", micros: $(37.2) }),
        expect.objectContaining({ type: "live_hours", micros: $(3.75), freeQuantity: 5 })
      ])
    );
    expect(bill).toMatchObject({ status: "paid", amountMicros: $(42.15), fromEarningsMicros: $(42.15), fromCardMicros: 0, dueMicros: 0 });
    expect(run.accounts.beatClosed.standing).toBe("ok");
    expect(run.cards.charges.filter((c) => c.stationId === run.beat.id)).toEqual([]);
    // The weekly statement: the usage section, with units and prices, and what came out of earnings.
    const statements = await statementsOf(run, run.beat.id, run.owners.kai);
    const week = statements.find((s) => s.period === "week" && s.periodStart === "2026-10-19")!;
    const usage = week.lines.filter((l) => l.group === "usage");
    expect(usage.find((l) => l.label === "Relays, everything you air")).toMatchObject({ amountMicros: -$(8.4), includedAbove: true, usage: { unit: "hour", quantity: 42, priceMicros: $(0.2) } });
    expect(usage.find((l) => l.label === "Usage, taken from earnings")!.amountMicros).toBeLessThan(0);
    const month = statements.find((s) => s.period === "month" && s.periodStart === "2026-10-01")!;
    expect(month.lines.find((l) => l.label === "Storage")).toMatchObject({ amountMicros: -$(1.2), usage: { quantity: 40, freeQuantity: 10, billableQuantity: 30, priceMicros: $(0.04) } });
    const notices = await noticesOf(run, run.owners.kai);
    expect(notices.map((n) => n.title)).toEqual(["October's usage: $42.15"]);
    expect(notices[0].body).toContain("$42.15 came from your earnings");
  });

  it("REEL runs out: grace, a warning, relays and live shows paused (never the channel), and back once paid", async () => {
    const grace = run.accounts.reelGrace;
    expect(grace.standing).toBe("grace");
    expect(grace.grace).toMatchObject({ startedOn: "2026-11-01", pausesOn: "2026-11-15", dueMicros: $(149.4) });
    expect(grace.bills.find((b) => b.month === "2026-10")).toMatchObject({ status: "due", amountMicros: $(149.4), dueMicros: $(149.4), lastAttempt: { method: "card", result: "failed", reason: "Your card was declined." } });
    expect(run.paused.relaysDuringGrace).toBe(1);
    expect(run.accounts.reelWarned.grace?.daysLeft).toBe(3);
    expect(run.accounts.reelPaused.standing).toBe("paused");
    expect(run.accounts.reelPaused.usage.find((u) => u.type === "relay_everything")?.paused).toBe("unpaid");
    expect(run.paused.relaysWhilePaused).toBe(0);
    expect(run.paused.liveWhilePaused).not.toContain("live");
    expect(run.paused.channelWhilePaused).toBe("on air");
    expect(run.accounts.reelResumed.standing).toBe("ok");
    expect(run.accounts.reelResumed.bills.find((b) => b.month === "2026-10")).toMatchObject({ status: "paid", fromCardMicros: $(149.4), dueMicros: 0 });
    expect(run.paused.relaysResumed).toBe(1);
    const titles = (await noticesOf(run, run.owners.jess)).map((n) => n.title);
    // The month's summary and the failed charge are sent at the same moment, so either comes first.
    expect(titles.slice(0, 2).sort()).toEqual(["October's usage: $149.40", "Your card wasn't charged for October's usage"]);
    expect(titles.slice(2)).toEqual([
      "Relays and live shows pause in 3 days",
      "Relays and live shows are paused",
      "Relays and live shows are back"
    ]);
  });

  it("every entry balances and the provider's wallets match the ledger", async () => {
    const report = await monthReport(run);
    expect(report).toContain("Every wallet at the provider matches the ledger: yes.");
  });
});
