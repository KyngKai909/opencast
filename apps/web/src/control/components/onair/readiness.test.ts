import { describe, expect, it } from "vitest";
import { logEntryHref, preparationWords, preparedFixHref, readinessLine } from "./readiness";

// Saturday, September 26, 8:42 pm in Redlands (03:42 UTC on the 27th).
const NOW = Date.parse("2026-09-27T03:42:00.000Z");
const first = (status: "queued" | "preparing" | "failed" | "not_asked", airsAt = "2026-09-27T05:00:00.000Z") => ({ itemId: "i", title: "Late Crate, ep. 15", airsAt, status });

describe("the Monitor's readiness line", () => {
  it("counts the next 48 hours' items and names the first not ready, with its time", () => {
    expect(readinessLine({ items: 13, ready: 12, firstNotReady: first("preparing") }, NOW)).toMatchObject({
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
    expect(readinessLine({ items: 1, ready: 1, firstNotReady: null }, NOW)).toEqual({
      text: "1 of 1 item ready for the next 48 hours",
      good: true,
      attention: false,
      parts: { head: "1 of 1 item ready for the next 48 hours", item: null }
    });
    expect(readinessLine({ items: 0, ready: 0, firstNotReady: null }, NOW)).toBeNull();
    expect(readinessLine(null, NOW)).toBeNull();
    expect(readinessLine(undefined, NOW)).toBeNull();
  });
});

describe("readiness, by item and with what failed (G13, G14)", () => {
  it("needs attention when a later item couldn't be prepared, though the first named is on its way", () => {
    const r = { items: 13, ready: 11, failed: 1, preparing: 1, firstNotReady: first("preparing") };
    expect(readinessLine(r, NOW)).toMatchObject({ text: expect.stringMatching(/is being prepared$/), attention: true });
    expect(readinessLine({ ...r, failed: 0, preparing: 2 }, NOW)!.attention).toBe(false);
  });

  it("gives the Monitor the item named and its log entry, to link to", () => {
    const line = readinessLine({ items: 13, ready: 12, firstNotReady: { ...first("preparing"), entryId: "e15" } }, NOW)!;
    expect(line.parts).toEqual({
      head: "12 of 13 items ready for the next 48 hours",
      item: { title: "Late Crate, ep. 15", entryId: "e15", airsAt: "2026-09-27T05:00:00.000Z", rest: " at 10:00 pm is being prepared" }
    });
    expect(`${line.parts.head}; ${line.parts.item!.title}${line.parts.item!.rest}`).toBe(line.text);
    // Before G13 the API sent no entry: the line reads the same, with nothing to link.
    expect(readinessLine({ items: 13, ready: 12, firstNotReady: first("preparing") }, NOW)!.parts.item!.entryId).toBeNull();
  });

  it("links to the airing's broadcast day on the Schedule's Log, which shows the whole day (A246)", () => {
    // 10:00 pm Saturday.
    expect(logEntryHref("/control/beat", "e15", "2026-09-27T05:00:00.000Z")).toBe("/control/beat/schedule?day=2026-09-26&entry=e15");
    // 3:30 am Sunday is still Saturday's broadcast day.
    expect(logEntryHref("/control/beat", "e15r", "2026-09-27T10:30:00.000Z")).toBe("/control/beat/schedule?day=2026-09-26&entry=e15r");
    // 8:00 pm Sunday.
    expect(logEntryHref("/control/beat", "e", "2026-09-28T03:00:00.000Z")).toBe("/control/beat/schedule?day=2026-09-27&entry=e");
  });

  it("offers the pre-flight's fix only when an item couldn't be prepared", () => {
    const prep = (failed: number, preparing: number) => ({
      items: 5,
      ready: 5 - failed - preparing,
      failed,
      preparing,
      firstFailed: failed ? { itemId: "tape", title: "Borrowed Tape", airsAt: "2026-09-27T05:40:00.000Z", entryId: "e" } : null
    });
    const check = (failed: number, preparing: number) => ({ key: "items_prepared" as const, passed: failed + preparing === 0, preparation: prep(failed, preparing) });
    expect(preparedFixHref(check(1, 2), "/control/beat")).toBe("/control/beat/library/items/tape");
    expect(preparedFixHref(check(0, 2), "/control/beat")).toBeNull();
    expect(preparedFixHref(check(0, 0), "/control/beat")).toBeNull();
    // An API from before G14 says nothing about failures: no fix.
    expect(preparedFixHref({ key: "items_prepared", passed: false }, "/control/beat")).toBeNull();
    expect(preparedFixHref({ key: "rights_confirmed", passed: false }, "/control/beat")).toBeNull();
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
