// The Results area's mock history: September adds up to the frames and the shared balance, and
// what the mock does later (airings, redemptions, money moves) shows up and still reconciles.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config", () => ({ config: { mock: true, apiBase: "", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" } }));

const { resetDb, getDb, move, balanceOf } = await import("../db");
const { OSC_ID, CYPRESS_ID } = await import("./businesses");
const R = await import("./results");

const $ = (d: number) => Math.round(d * 1_000_000);
const inMonth = (month: string) => (a: { startedAt: string }) => R.marketDate(a.startedAt).slice(0, 7) === month;
const sum = (l: Array<{ costMicros: number }>) => l.reduce((s, a) => s + a.costMicros, 0);
const BEAT = "00000000-0000-4000-8000-000000000012";
const CIVC = "00000000-0000-4000-8000-000000000007";
const SAZN = "00000000-0000-4000-8000-000000000018";

beforeEach(() => {
  localStorage.clear();
  resetDb();
  R.resetResults();
});

describe("September, as the frames draw it", () => {
  const sept = () => R.airingsOf(OSC_ID).filter(inMonth("2026-09"));

  it("is 118 airings for $248.90, the balance's spent this month", () => {
    expect(sept()).toHaveLength(118);
    expect(sum(sept())).toBe($(248.9));
    expect(balanceOf(OSC_ID).spentThisMonthMicros).toBe($(248.9));
  });

  it("splits by spot and station as the statement does", () => {
    const line = (spotId: string, stationId: string) => sept().filter((a) => a.spotId === spotId && a.stationId === stationId);
    expect([line(R.SPOT_IDS.fall, BEAT).length, sum(line(R.SPOT_IDS.fall, BEAT))]).toEqual([50, $(110.27)]);
    expect([line(R.SPOT_IDS.fall, CIVC).length, sum(line(R.SPOT_IDS.fall, CIVC))]).toEqual([31, $(81.84)]);
    expect([line(R.SPOT_IDS.fall, SAZN).length, sum(line(R.SPOT_IDS.fall, SAZN))]).toEqual([13, $(27.81)]);
    expect([line(R.SPOT_IDS.pumpkin, BEAT).length, sum(line(R.SPOT_IDS.pumpkin, BEAT))]).toEqual([12, $(17.7)]);
    expect([line(R.SPOT_IDS.pumpkin, SAZN).length, sum(line(R.SPOT_IDS.pumpkin, SAZN))]).toEqual([12, $(11.28)]);
  });

  it("prices every airing as tuned in times the rate, for what aired", () => {
    for (const a of R.airingsOf(OSC_ID)) expect(a.costMicros).toBe(R.airingCost(a.rate, a.tunedIn, a.airedSec, a.lengthSec));
  });

  it("has 38 afternoon and 80 evening airings", () => {
    const parts = sept().map((a) => R.daypartOf(a.startedAt));
    expect(parts.filter((p) => p === "afternoons")).toHaveLength(38);
    expect(parts.filter((p) => p === "evenings")).toHaveLength(80);
  });

  it("has the week of the 20th at 31 airings for $64.02, 17 on BEAT, 8 on CIVC, 6 on SAZN", () => {
    const week = sept().filter((a) => R.marketDate(a.startedAt) >= "2026-09-20");
    expect(week).toHaveLength(31);
    expect(sum(week)).toBe($(64.02));
    expect(week.filter((a) => a.stationId === BEAT)).toHaveLength(17);
    expect(week.filter((a) => a.stationId === CIVC)).toHaveLength(8);
    expect(week.filter((a) => a.stationId === SAZN)).toHaveLength(6);
  });

  it("ends with the five airings drawn in 02.1, newest first", () => {
    const newest = sept().slice(-5).reverse();
    expect(newest.map((a) => [a.tunedIn, a.costMicros, a.airedSec, a.programContext])).toEqual([
      [262, $(2.1), 30, "Before Saturday Reel"],
      [241, $(1.93), 30, "During Crate Session 02"],
      [188, $(0.94), 15, "During Tamales for forty"],
      [175, $(0.56), 12, "After the town hall"],
      [410, $(3.28), 30, "During the town hall"]
    ]);
    expect(newest[0]!.scans).toBe(4);
    expect(R.working(newest[0]!)).toBe("262 × $8.00 ÷ 1,000 = $2.10");
  });

  it("counts 37 customers: 21, 9 and 7 by station, 30 from evening airings, 11 this week, 8 marked today", () => {
    const uses = R.usesOf(OSC_ID);
    expect(uses).toHaveLength(37);
    const airings = new Map(R.airingsOf(OSC_ID).map((a) => [a.id, a]));
    const station = (id: string) => uses.filter((u) => u.stationId === id).length;
    expect([station(BEAT), station(CIVC), station(SAZN)]).toEqual([21, 9, 7]);
    expect(uses.filter((u) => R.daypartOf(airings.get(u.airingId!)!.startedAt) === "evenings")).toHaveLength(30);
    const week = uses.filter((u) => R.marketDate(u.at) >= "2026-09-20");
    expect(week).toHaveLength(11);
    expect([BEAT, CIVC, SAZN].map((s) => week.filter((u) => u.stationId === s).length)).toEqual([6, 3, 2]);
    expect(R.redeemedToday(OSC_ID)).toBe(8);
    const orange = uses.filter((u) => u.code === "ORANGE10");
    expect([orange.length, orange.filter((u) => u.how === "clear_pay").length, orange.filter((u) => u.how === "marked").length]).toEqual([31, 24, 7]);
    // Every use is credited to an airing of its spot on its station, within 7 days before it.
    for (const u of uses) {
      const a = airings.get(u.airingId!)!;
      expect(a.spotId).toBe(u.spotId);
      expect(Date.parse(u.at) - Date.parse(a.startedAt)).toBeGreaterThan(0);
      expect(Date.parse(u.at) - Date.parse(a.startedAt)).toBeLessThanOrEqual(7 * 86_400_000);
    }
  });

  it("has ORANGE10 scanned 214 times and saved 61 times", () => {
    expect(sept().filter((a) => a.spotId === R.SPOT_IDS.fall).reduce((s, a) => s + a.scans, 0)).toBe(214);
    expect(R.savesOf("ORANGE10")).toHaveLength(61);
  });

  it("holds 41 airings for $14.20, 9 of them tonight for $4.60", () => {
    const held = R.heldOf(OSC_ID);
    expect(held).toHaveLength(41);
    expect(held.reduce((s, h) => s + h.heldMicros, 0)).toBe($(14.2));
    const tonight = held.filter((h) => R.marketDate(h.scheduledAt) === "2026-09-26");
    expect([tonight.length, tonight.reduce((s, h) => s + h.heldMicros, 0)]).toEqual([9, $(4.6)]);
  });
});

describe("statements", () => {
  it("draws September as the frame does, tied to the balance", () => {
    const [sept, aug] = R.statementsOf(OSC_ID);
    expect(sept!.id).toBe(R.STATEMENT_IDS.september);
    expect(sept!.inProgress).toBe(true);
    expect(sept!.asOf).toBe("2026-09-26");
    expect(sept!.openingMicros).toBe($(175.6));
    const line = (kind: string) => sept!.lines.find((l) => l.kind === kind)!;
    expect(line("added").amountMicros).toBe($(500));
    expect(line("aired").amountMicros).toBe(-$(248.9));
    expect(line("returned")).toMatchObject({ amountMicros: $(1.86), detail: "2 airings cut short, included above" });
    expect(line("fees").amountMicros).toBe(0);
    expect(sept!.closingMicros).toBe($(426.7));
    expect([sept!.closingAvailableMicros, sept!.closingHeldMicros]).toEqual([$(412.5), $(14.2)]);
    expect(sept!.lines.filter((l) => l.group === "spent").map((l) => [l.label, l.airings, l.amountMicros])).toEqual([
      ["Fall menu on BEAT 12.1", 50, $(110.27)],
      ["Fall menu on CIVC 7.1", 31, $(81.84)],
      ["Fall menu on SAZN 18.1", 13, $(27.81)],
      ["Pumpkin latte on BEAT 12.1", 12, $(17.7)],
      ["Pumpkin latte on SAZN 18.1", 12, $(11.28)]
    ]);
    // August: settings 03.1's "96 airings, 1 sponsorship, $290.40", ending where September starts.
    expect(aug!.id).toBe(R.STATEMENT_IDS.august);
    expect(aug!.lines.find((l) => l.kind === "aired")!.amountMicros).toBe(-$(240.4));
    expect(aug!.closingMicros).toBe($(175.6));
  });

  it("keeps reconciling after the mock airs, adds, takes out and pays from a hold", () => {
    R.recordAiring(OSC_ID, { spotId: R.SPOT_IDS.fall, stationId: BEAT, tunedIn: 300 });
    R.recordAiring(OSC_ID, { spotId: R.SPOT_IDS.fall, stationId: CIVC, tunedIn: 200, airedSec: 15 });
    move(OSC_ID, { kind: "aired", label: "Aired on SAZN 18.1", amountMicros: -$(1.5), detail: ":15 spot, 300 tuned in, $5.00 per 1,000" });
    move(OSC_ID, { kind: "added", label: "Added by bank transfer", amountMicros: $(100), detail: "Through Clear" });
    move(OSC_ID, { kind: "withdrawn", label: "Taken out", amountMicros: -$(20), detail: "To Clear, Chase ending 8810" });
    // An order: held, then paid (the Deals area's pattern), and a hold returned with kind "returned".
    move(OSC_ID, { kind: "held", label: "Held for Holiday gift cards", amountMicros: $(140), detail: null, hold: true });
    move(OSC_ID, { kind: "held", label: "Paid", amountMicros: -$(140), detail: null, hold: true });
    move(OSC_ID, { kind: "order", label: "Paid to BEAT 12.1", amountMicros: -$(140), detail: "Holiday gift cards" });
    move(OSC_ID, { kind: "held", label: "Held", amountMicros: $(30), detail: null, hold: true });
    move(OSC_ID, { kind: "returned", label: "Returned", amountMicros: -$(30), detail: null, hold: true });
    const b = balanceOf(OSC_ID);
    const [sept] = R.statementsOf(OSC_ID);
    expect(sept!.closingMicros).toBe(b.availableMicros + b.heldMicros);
    expect(sept!.lines.find((l) => l.kind === "aired")!.airings).toBe(121);
    expect(sept!.lines.filter((l) => l.kind === "added")).toHaveLength(2);
    expect(sept!.lines.find((l) => l.kind === "order")!.amountMicros).toBe(-$(140));
    expect(R.airingsOf(OSC_ID).filter(inMonth("2026-09"))).toHaveLength(121);
    const fromMovement = R.airingsOf(OSC_ID).find((a) => a.stationId === SAZN && a.tunedIn === 300)!;
    expect(fromMovement.spotId).toBe(R.SPOT_IDS.pumpkin);
  });

  it("gives a business with no books none, and a new business its month from its first movement", () => {
    expect(R.statementsOf(CYPRESS_ID)).toEqual([]);
    const id = "00000000-0000-4000-8000-000000069999";
    getDb().businesses.push({ ...getDb().businesses[0]!, id, name: "New Shop" });
    move(id, { kind: "added", label: "Added by card", amountMicros: $(250), detail: "Visa ending 2210" });
    move(id, { kind: "fee", label: "Card fee", amountMicros: -$(7.55), detail: "Stripe's fee, at cost" });
    const [st] = R.statementsOf(id);
    expect(st!.openingMicros).toBe(0);
    expect(st!.closingMicros).toBe($(242.45));
    expect(st!.lines.find((l) => l.kind === "fees")!.detail).toBe("Card fees, Stripe's at cost");
  });
});

describe("redeeming at the counter", () => {
  it("checks the typed code as the frame draws it, then counts it once", () => {
    const c = R.checkCode(OSC_ID, "orange10", undefined);
    expect(c).toMatchObject({ valid: true, firstUse: true, countsAsCustomer: true, offer: "10% off" });
    expect(c.message).toBe("ORANGE10 is good. First use for this customer. Saved from BEAT 12.1 on Saturday.");
    expect(R.redeemedToday(OSC_ID)).toBe(8);
    R.redeem(OSC_ID, "ORANGE10", undefined);
    expect(R.redeemedToday(OSC_ID)).toBe(9);
    const again = R.checkCode(OSC_ID, "ORANGE10", c.customerRef!);
    expect(again.valid).toBe(false);
    expect(again.message).toMatch(/^This customer used ORANGE10 on Saturday/);
  });

  it("turns away codes that aren't the business's", () => {
    expect(R.checkCode(OSC_ID, "NOPE1", undefined)).toMatchObject({ valid: false, message: "NOPE1 isn't one of your codes. Check it with the customer." });
    expect(R.checkCode(CYPRESS_ID, "ORANGE10", undefined).valid).toBe(false);
  });
});

describe("helpers", () => {
  it("apportions whole numbers by weight", () => {
    expect(R.apportion([1, 1, 2], 10)).toEqual([3, 2, 5]);
    expect(R.apportion([0, 0], 5)).toEqual([0, 0]);
  });

  it("writes a short airing's working", () => {
    expect(R.working({ rate: { kind: "per_thousand", micros: $(8) }, tunedIn: 175, airedSec: 12, lengthSec: 30, costMicros: $(0.56) })).toBe("175 × $8.00 ÷ 1,000, for :12 of :30 = $0.56");
    expect(R.working({ rate: { kind: "per_airing", micros: $(4) }, tunedIn: 90, airedSec: 30, lengthSec: 30, costMicros: $(4) })).toBe("$4.00 an airing = $4.00");
  });
});
