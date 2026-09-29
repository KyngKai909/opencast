import { beforeEach, describe, expect, it, vi } from "vitest";

// The frames' moment: Saturday, September 26, 8:42:12 pm in the Inland Empire.
let clockAt = Date.parse("2026-09-27T03:42:12Z");
vi.mock("../../../lib/clock", () => ({ now: () => new Date(clockAt), STATION_TZ: "America/Los_Angeles", useNow: () => new Date(clockAt) }));

const { audienceReport, availableMicros, heldSplit, moveToBank, resetEarnings, spotCost, RATES, stationEarnings, stationStatements, statementCsv, fitTo } = await import("./earnings");
const { getDb, resetDb, saveDb } = await import("../db");
const { BEAT, LAB } = await import("./stations");
const { at } = await import("./time");
const { money } = await import("@opencast/ui");

const $ = (d: number) => Math.round(d * 1_000_000);

beforeEach(() => {
  clockAt = Date.parse("2026-09-27T03:42:12Z");
  localStorage.clear();
  resetDb();
  resetEarnings();
});

describe("BEAT's September", () => {
  it("adds up to the frame: $2,112.90 so far, $640.12 available, $1,472.78 paid out", () => {
    const e = stationEarnings(BEAT.id, "month")!;
    expect(e.totalMicros).toBe($(2112.9));
    expect(e.lines.spots).toMatchObject({ micros: $(486.2), airings: 212, businesses: 5 });
    expect(e.lines.carriageIn.micros + e.lines.carriageOut.micros).toBe($(40.7));
    expect(e.lines.opencastShare).toEqual({ micros: 0, notSetYet: true });
    expect(e.lines.sponsors.list).toEqual([
      { name: "Redlands Hardware", monthlyMicros: $(100) },
      { name: "Clear", monthlyMicros: $(100) }
    ]);
    expect(e.account).toEqual({ availableMicros: $(640.12), paidOutThisMonthMicros: $(1472.78) });
    expect(e.nextPayout).toMatchObject({ on: "2026-09-28", schedule: "weekly", destination: "Chase ending 2231", amountMicros: $(640.12) });
  });

  it("holds 9 airings in 4 breaks tonight and 41 for the rest of the week", () => {
    const e = stationEarnings(BEAT.id, "month")!;
    expect(e.held).toEqual({ tonightMicros: $(21.6), tonightAirings: 9, tonightBreaks: 4, restOfWeekMicros: $(16.8), restOfWeekAirings: 41 });
  });

  it("the three September payouts and this week's earnings make the month", () => {
    const paidInSeptember = stationStatements(BEAT.id).filter((s) => s.paidOn! >= "2026-09-01");
    const paid = paidInSeptember.reduce((a, s) => a + s.closingMicros, 0);
    expect(paid).toBe($(1472.78));
    const week = stationEarnings(BEAT.id, "week")!;
    expect(week.totalMicros).toBe($(640.12));
    expect(paid + week.totalMicros).toBe($(2112.9));
  });

  it("held money becomes the station's when its airings run", () => {
    clockAt = Date.parse(at("21:59"));
    const e = stationEarnings(BEAT.id, "month")!;
    expect(e.held.tonightAirings).toBe(7);
    expect(e.held.tonightBreaks).toBe(3);
    expect(e.lines.spots.airings).toBe(214);
    expect(e.lines.spots.micros).toBe($(491));
    expect(e.account.availableMicros).toBe($(644.92));
  });

  it("a spot the market puts in a break still to air is held at its rate", () => {
    const b = getDb().breaks.find((x) => x.startsAt === at("20:59"))!;
    b.fills.push({ id: "x", kind: "spot", title: "Inland Tire and Wheel", lengthMs: 30_000, business: "Inland Tire and Wheel" });
    saveDb();
    const h = heldSplit(BEAT.id);
    expect(h.tonightAirings).toBe(10);
    expect(h.tonightBreaks).toBe(5);
    expect(h.tonightMicros).toBe($(25.6));
  });
});

describe("the week of September 14", () => {
  const s = () => stationStatements(BEAT.id).find((x) => x.periodStart === "2026-09-14")!;

  it("works out per-thousand lines from rate, airings and average: 18 × 262 × $8.00 ÷ 1,000 = $37.73", () => {
    expect(spotCost(RATES["Orange Street Coffee"], 18, 262)).toBe($(37.73));
    const orange = s().lines.find((l) => l.label === "Orange Street Coffee")!;
    expect(orange).toMatchObject({ group: "spots", airings: 18, averageTunedIn: 262, amountMicros: $(37.73), rate: { kind: "per_thousand", micros: $(8) } });
  });

  it("was paid Monday, September 21: $553.42 to Chase ending 2231", () => {
    expect(s()).toMatchObject({ paidOn: "2026-09-21", destination: "Chase ending 2231", closingMicros: $(553.42) });
    expect(s().lines.reduce((a, l) => a + l.amountMicros, 0)).toBe($(553.42));
  });

  it("exports every line with the entries behind it, adding up to the page", () => {
    const { csv, filename } = statementCsv(s(), "BEAT");
    expect(filename).toBe("BEAT-statement-week-of-2026-09-14.csv");
    const parse = (r: string) => Array.from(r.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g), (m) => m[1].replace(/^"|"$/g, "").replace(/""/g, '"')).slice(0, 7);
    const rows = csv.trim().split("\n").slice(1).map(parse);
    const lines = rows.filter((r) => r[3] === "line");
    const airings = rows.filter((r) => r[3] === "airing" && r[1] === "Orange Street Coffee");
    expect(lines).toHaveLength(11);
    expect(airings).toHaveLength(18);
    expect(airings.reduce((a, r) => a + Number(r[6]) * 100, 0)).toBeCloseTo(3773, 5);
    expect(rows.at(-1)!.slice(0, 2)).toEqual(["total", "Paid out"]);
    expect(rows.at(-1)![6]).toBe("553.42");
  });
});

describe("moving money to the bank", () => {
  it("moves up to what's available and counts it as paid out", () => {
    const r = moveToBank(BEAT.id, $(300), money);
    expect(r).toMatchObject({ ok: true, scheduledFor: "2026-09-28" });
    expect(availableMicros(BEAT.id)).toBe($(340.12));
    expect(stationEarnings(BEAT.id, "month")!.account.paidOutThisMonthMicros).toBe($(1772.78));
  });

  it("refuses more than is available, and a studio that hasn't set up its payouts", () => {
    expect(moveToBank(BEAT.id, $(700), money)).toMatchObject({ ok: false, status: 422, message: "Up to $640.12 is available." });
    expect(moveToBank(LAB.id, $(10), money)).toMatchObject({ ok: false, status: 409 });
  });
});

describe("a studio's earnings", () => {
  it("is carriage only: $186.40 earned in September, no payout yet", () => {
    const e = stationEarnings(LAB.id, "month")!;
    expect(e.totalMicros).toBe($(186.4));
    expect(e.lines.spots.micros + e.lines.pledges.micros + e.lines.sponsors.micros).toBe(0);
    expect(e.nextPayout).toBeNull();
  });
});

describe("BEAT's audience tonight", () => {
  const tonight = () => audienceReport(BEAT.id, at("18:00"), at("23:00"))!;

  it("reads as the frame: 312 now, a peak of 318 at 8:36 pm, 596 hours, 142 presets", () => {
    const a = tonight();
    expect(a.tunedInNow).toBe(312);
    expect(a.peak).toEqual({ tunedIn: 318, at: at("20:36") });
    expect(a.hoursWatched).toBe(596);
    expect(a.presetCount).toBe(142);
    expect(a.translators).toEqual([expect.objectContaining({ name: "YouTube", viewers: 88 })]);
  });

  it("measures each program on the line: 184, 262 and 305 on average", () => {
    const rows = tonight().byProgram!.map((p) => [p.title, p.averageTunedIn, p.peakTunedIn, p.stayedToTheEnd, p.onNow]);
    expect(rows).toEqual([
      ["Crate Session 02", 184, 241, 62, false],
      ["Late Crate, ep. 14", 262, 301, 81, false],
      ["Saturday Reel", 305, 318, null, true]
    ]);
    expect(tonight().byProgram![2]).toMatchObject({ source: "carried", carriedFrom: expect.objectContaining({ callSign: "REEL" }) });
  });

  it("splits where people watch: 44% phones, 24% casting, 21% web, 11% TV app", () => {
    const p = tonight().byPlatform;
    const total = p.phone + p.cast + p.web + p.tv_app;
    expect(total).toBe(312);
    expect([p.phone, p.cast, p.web, p.tv_app].map((n) => Math.round((n / total) * 100))).toEqual([44, 24, 21, 11]);
  });

  it("draws tonight's line to now and last Saturday's across the window, with the breaks", () => {
    const a = tonight();
    expect(a.series.at(-1)).toMatchObject({ minute: at("20:42"), tunedIn: 312 });
    expect(a.comparison!.at(-1)!.minute).toBe(at("23:00"));
    expect(a.breaks!.map((b) => b.startsAt)).toEqual([at("20:28:28"), at("20:44"), at("20:59"), at("21:29")]);
    expect(a.series.find((p) => p.minute === at("20:29"))!.inBreak).toBe(true);
  });

  it("counts nobody during dead air", () => {
    clockAt = Date.parse(at("23:50"));
    const a = audienceReport(BEAT.id, at("18:00"), at("24:00"))!;
    expect(a.series.find((p) => p.minute === at("23:45"))!.tunedIn).toBe(0);
    expect(a.tunedInNow).toBe(0);
  });

  it("fits a stretch to a peak and an average without moving its peak", () => {
    const v = fitTo([10, 20, 30, 40, 30], 25, 50);
    expect(Math.max(...v)).toBe(50);
    expect(v.indexOf(50)).toBe(3);
    expect(v.reduce((a, x) => a + x, 0) / v.length).toBeCloseTo(25, 0);
  });
});
