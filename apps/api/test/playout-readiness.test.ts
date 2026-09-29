// The Monitor's readiness and the sign-on check `items_prepared`, by item (G13) and with what
// failed told apart from what's on its way (G14). Pure: no database.
import { describe, expect, it } from "vitest";
import { summariseReadiness, type LogItemReadiness } from "../src/v1/modules/playout/engine/readiness.js";
import { preparedTail } from "../src/v1/modules/playout/service.js";

const row = (entryId: string, itemId: string, at: string, ready: boolean, status: string | null = ready ? "ready" : "queued"): LogItemReadiness => ({
  entryId,
  itemId,
  title: itemId,
  airsAt: new Date(at),
  key: `k-${itemId}`,
  ready,
  status
});

describe("readiness by item", () => {
  it("counts an item airing twice once, and names its earliest airing", () => {
    const s = summariseReadiness([
      row("e3", "late-crate-15", "2026-10-03T10:30:00Z", false, "preparing"),
      row("e1", "late-crate-14", "2026-10-03T03:00:00Z", true),
      row("e2", "late-crate-15", "2026-10-03T05:00:00Z", false, "preparing"),
      row("e4", "late-crate-14", "2026-10-03T11:00:00Z", true)
    ]);
    expect(s).toMatchObject({ items: 2, ready: 1, failed: 0, preparing: 1, firstFailed: null });
    expect(s.firstNotReady).toMatchObject({ entryId: "e2", itemId: "late-crate-15" });
  });

  it("tells failed from on its way (queued, preparing, never asked)", () => {
    const s = summariseReadiness([
      row("a", "one", "2026-10-03T03:00:00Z", false, "queued"),
      row("b", "two", "2026-10-03T04:00:00Z", false, "failed"),
      row("c", "three", "2026-10-03T05:00:00Z", false, null),
      row("d", "two", "2026-10-03T06:00:00Z", false, "failed"),
      row("e", "four", "2026-10-03T07:00:00Z", true)
    ]);
    expect(s).toMatchObject({ items: 4, ready: 1, failed: 1, preparing: 2 });
    expect(s.firstNotReady?.entryId).toBe("a");
    expect(s.firstFailed).toMatchObject({ entryId: "b", itemId: "two" });
  });

  it("is empty with nothing on the log", () => {
    expect(summariseReadiness([])).toEqual({ items: 0, ready: 0, failed: 0, preparing: 0, firstNotReady: null, firstFailed: null });
  });
});

describe("the items_prepared detail", () => {
  it("keeps the old words while everything left is on its way", () => {
    expect(preparedTail(0, 0)).toBe("");
    expect(preparedTail(0, 2)).toBe(". The rest are being prepared; anything not ready at air time airs station ID and bumpers");
  });

  it("says what couldn't be prepared, and what's still being prepared", () => {
    expect(preparedTail(1, 0)).toBe(". 1 couldn't be prepared (its file needs replacing); anything not ready at air time airs station ID and bumpers");
    expect(preparedTail(2, 1)).toBe(". 2 couldn't be prepared (their files need replacing) and 1 is being prepared; anything not ready at air time airs station ID and bumpers");
    expect(preparedTail(1, 3)).toMatch(/and 3 are being prepared;/);
  });
});
