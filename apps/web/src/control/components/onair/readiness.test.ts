import { describe, expect, it } from "vitest";
import { preparationWords, readinessLine } from "./readiness";

// Saturday, September 26, 8:42 pm in Redlands (03:42 UTC on the 27th).
const NOW = Date.parse("2026-09-27T03:42:00.000Z");
const first = (status: "queued" | "preparing" | "failed" | "not_asked", airsAt = "2026-09-27T05:00:00.000Z") => ({ itemId: "i", title: "Late Crate, ep. 15", airsAt, status });

describe("the Monitor's readiness line", () => {
  it("counts the next 48 hours' items and names the first not ready, with its time", () => {
    expect(readinessLine({ items: 13, ready: 12, firstNotReady: first("preparing") }, NOW)).toEqual({
      text: "12 of 13 items ready for the next 48 hours; Late Crate, ep. 15 at 10:00 pm is being prepared",
      good: false,
      attention: false
    });
    expect(readinessLine({ items: 13, ready: 12, firstNotReady: first("queued") }, NOW)!.text).toMatch(/is being prepared$/);
    expect(readinessLine({ items: 13, ready: 12, firstNotReady: first("not_asked") }, NOW)!.text).toMatch(/isn't prepared yet$/);
  });

  it("names another day's time with its day", () => {
    expect(readinessLine({ items: 4, ready: 3, firstNotReady: first("preparing", "2026-09-28T03:00:00.000Z") }, NOW)!.text).toBe(
      "3 of 4 items ready for the next 48 hours; Late Crate, ep. 15 at 8:00 pm Sunday is being prepared"
    );
  });

  it("needs attention when one couldn't be prepared, or airs within the hour unprepared", () => {
    expect(readinessLine({ items: 13, ready: 12, firstNotReady: first("failed") }, NOW)).toMatchObject({ text: expect.stringMatching(/couldn't be prepared$/), attention: true });
    expect(readinessLine({ items: 13, ready: 12, firstNotReady: first("preparing", "2026-09-27T04:30:00.000Z") }, NOW)!.attention).toBe(true);
  });

  it("is good when everything is ready, and absent with nothing to prepare", () => {
    expect(readinessLine({ items: 1, ready: 1, firstNotReady: null }, NOW)).toEqual({ text: "1 of 1 item ready for the next 48 hours", good: true, attention: false });
    expect(readinessLine({ items: 0, ready: 0, firstNotReady: null }, NOW)).toBeNull();
    expect(readinessLine(null, NOW)).toBeNull();
    expect(readinessLine(undefined, NOW)).toBeNull();
  });
});

describe("a library item's preparation", () => {
  it("reads in place of the old cache line", () => {
    expect(preparationWords("ready")).toBe("Prepared for air");
    expect(preparationWords("queued")).toBe("Being prepared");
    expect(preparationWords("preparing")).toBe("Being prepared");
    expect(preparationWords("failed")).toBe("Couldn't be prepared");
    expect(preparationWords("not_asked")).toBeNull();
    expect(preparationWords(undefined)).toBeNull();
  });
});
