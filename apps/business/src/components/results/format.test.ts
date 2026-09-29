import { describe, expect, it } from "vitest";
import { airedWords, airingsCsv, andList, daypartSentence, perCustomer, plural, proofHeading, rangeWords, rowTime, tenths } from "./format";
import { readScan } from "./CodeScanner";
import { queryFor, selectionFrom } from "./useResults";

const NOW = new Date("2026-09-27T03:42:12Z"); // Saturday, September 26, 8:42 pm in the Inland Empire

describe("results words", () => {
  it("counts and lists", () => {
    expect(plural(1, "airing")).toBe("1 airing");
    expect(plural(1180, "airing")).toBe("1,180 airings");
    expect(andList(["Fall menu", "Pumpkin latte"])).toBe("Fall menu and Pumpkin latte");
    expect(andList(["A", "B", "C"])).toBe("A, B and C");
  });

  it("writes periods as the frames do", () => {
    expect(rangeWords("2026-09-01", "2026-09-26")).toBe("September 1 to 26");
    expect(rangeWords("2026-09-20", "2026-09-26", true)).toBe("Sept 20 to 26");
    expect(rangeWords("2026-08-01", "2026-09-26")).toBe("August 1 to September 26");
    expect(rangeWords("2026-09-26", "2026-09-26")).toBe("September 26");
  });

  it("costs per customer, or nothing without customers", () => {
    expect(perCustomer(248_900_000, 37)).toBe(6_727_027);
    expect(perCustomer(64_020_000, 0)).toBeNull();
  });

  it("says which part of the day brought the customers", () => {
    expect(daypartSentence([{ daypart: "afternoons", customers: 7 }, { daypart: "evenings", customers: 30 }])).toBe("Evenings brought 30 of the 37 customers.");
    expect(daypartSentence([{ daypart: "evenings", customers: 0 }, { daypart: "afternoons", customers: 0 }])).toBeNull();
  });

  it("writes airing times with seconds and tenths", () => {
    expect(rowTime("2026-09-27T03:28:30Z", NOW)).toBe("Sat 8:28:30 pm");
    expect(rowTime("2026-09-13T04:28:30Z", NOW)).toBe("Sept 12 9:28:30 pm");
    expect(proofHeading("2026-09-27T03:28:30Z", "BEAT", NOW)).toBe("Saturday, 8:28:30 pm, BEAT");
    expect(tenths("2026-09-27T03:28:30.000Z")).toBe("8:28:30.0 pm");
    expect(airedWords(12_000, 30)).toBe(":12 of :30");
  });

  it("writes the airings CSV with a row per airing", () => {
    const csv = airingsCsv([
      { asRunId: "a1", startedAt: "2026-09-27T03:28:30Z", endedAt: "2026-09-27T03:29:00Z", station: { callSign: "BEAT", channel: "12.1" }, spot: { title: "Fall menu", lengthSec: 30 }, programContext: "Before Saturday Reel", airedMs: 30_000, tunedIn: 262, costMicros: 2_100_000, working: "262 × $8.00 ÷ 1,000 = $2.10" }
    ]);
    expect(csv.split("\n")[1]).toBe("2026-09-27T03:28:30Z,2026-09-27T03:29:00Z,BEAT 12.1,Fall menu,Before Saturday Reel,:30 of :30,262,$2.10,\"262 × $8.00 ÷ 1,000 = $2.10\",a1");
  });
});

describe("the period in the address", () => {
  it("defaults to this month, and asks for P14's periods", () => {
    const sel = selectionFrom(new URLSearchParams(""), NOW);
    expect(sel).toEqual({ period: "month", month: "2026-09", week: null });
    expect(queryFor(sel)).toEqual({ month: "2026-09" });
    expect(queryFor(selectionFrom(new URLSearchParams("period=week&week=2026-09-13"), NOW))).toEqual({ month: "2026-09", period: "week", week: "2026-09-13" });
    expect(selectionFrom(new URLSearchParams("period=nope&month=bad"), NOW)).toEqual({ period: "month", month: "2026-09", week: null });
  });
});

describe("scanning the customer's screen", () => {
  it("reads the saved offer's link or a bare code", () => {
    expect(readScan("https://opencast.example/c/orange10?customer=abc")).toEqual({ code: "ORANGE10", customerRef: "abc" });
    expect(readScan("PUMPKIN")).toEqual({ code: "PUMPKIN" });
    expect(readScan("hello there")).toBeNull();
  });
});
