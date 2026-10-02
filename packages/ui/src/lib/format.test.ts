import { describe, expect, it } from "vitest";
import { clock, clockRange, duration, money, channel } from "./format";

const LA = "America/Los_Angeles";

describe("clock", () => {
  const evening = new Date("2026-09-27T03:42:12Z"); // 8:42:12 pm PDT
  it("uses a 12-hour clock with lowercase am/pm", () => {
    expect(clock(evening, { timeZone: LA })).toBe("8:42 pm");
    expect(clock(evening, { timeZone: LA, seconds: true })).toBe("8:42:12 pm");
    expect(clock(evening, { timeZone: LA, suffix: false })).toBe("8:42");
  });
  it("writes midnight and noon as 12", () => {
    expect(clock("2026-09-27T07:00:00Z", { timeZone: LA })).toBe("12:00 am");
    expect(clock("2026-09-26T19:00:00Z", { timeZone: LA })).toBe("12:00 pm");
  });
});

describe("clockRange", () => {
  it("says am/pm once when both ends share it", () => {
    expect(clockRange("2026-09-27T03:00:00Z", "2026-09-27T04:00:00Z", { timeZone: LA })).toBe("8:00 to 9:00 pm");
    expect(clockRange("2026-09-27T03:30:00Z", "2026-09-27T04:00:00Z", { timeZone: LA, separator: "–" })).toBe("8:30 – 9:00 pm");
  });
  it("says both when they differ", () => {
    expect(clockRange("2026-09-27T06:40:00Z", "2026-09-27T09:00:00Z", { timeZone: LA })).toBe("11:40 pm to 2:00 am");
  });
  it("says both across midnight, even when they match", () => {
    // On air 6:00 am to 1:00 am the next morning.
    expect(clockRange("2026-09-26T13:00:00Z", "2026-09-27T08:00:00Z", { timeZone: LA })).toBe("6:00 am to 1:00 am");
  });
});

describe("duration", () => {
  it("writes lengths the broadcast way", () => {
    expect(duration(30_000)).toBe(":30");
    expect(duration(5_000)).toBe(":05");
    expect(duration(120_000)).toBe("2:00");
    expect(duration(28 * 60_000 + 30_000)).toBe("28:30");
    expect(duration(3_735_000)).toBe("1:02:15");
    expect(duration(0)).toBe(":00");
  });
});

describe("money", () => {
  it("formats micros as dollars", () => {
    expect(money(412_500_000)).toBe("$412.50");
    expect(money(1_234_560_000)).toBe("$1,234.56");
    expect(money(0)).toBe("$0.00");
  });
  it("uses a true minus sign, and a plus when asked", () => {
    expect(money(-2_500_000)).toBe("−$2.50");
    expect(money(250_000_000, { sign: true })).toBe("+$250.00");
    expect(money(0, { sign: true })).toBe("$0.00");
  });
  it("can drop whole cents", () => {
    expect(money(100_000_000, { trimCents: true })).toBe("$100");
    expect(money(100_500_000, { trimCents: true })).toBe("$100.50");
  });
});

describe("channel", () => {
  it("joins major and minor", () => {
    expect(channel(12, 1)).toBe("12.1");
    expect(channel(88, 4)).toBe("88.4");
  });
});

