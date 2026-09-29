import { describe, expect, it } from "vitest";
import type { LibraryItem } from "@opencast/contracts";
import { planRepeat } from "./repeat";

const MIN = 60_000;
let n = 0;
function item(o: Partial<LibraryItem>): LibraryItem {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    stationId: "s",
    programId: null,
    folderId: null,
    episodeNumber: null,
    episodeDescription: null,
    source: "upload",
    sourceUrl: null,
    mediaKind: "video",
    title: "Item",
    code: "PGM",
    durationMs: 30 * MIN,
    status: "ready",
    prepProgress: null,
    picture: null,
    loudnessLufs: null,
    captions: "none",
    originalFilename: null,
    rights: { basis: "made_it", confirmedBy: "Kai M.", confirmedAt: "2026-09-01T00:00:00.000Z", note: null },
    offerable: true,
    breakPointsMs: [],
    storage: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...o
  } as LibraryItem;
}

const LATE = "late";
const lateCrate = [28, 29, 27, 29, 28, 30, 28, 29, 27, 28, 29, 28, 29, 28.5, 29 + 1 / 6].map((m, i) =>
  item({ title: `Late Crate, ep. ${i + 1}`, programId: LATE, episodeNumber: i + 1, durationMs: Math.round(m * MIN), createdAt: `2026-09-${String(10 + i).padStart(2, "0")}T00:00:00.000Z` })
);
const gap = { startsAt: "2026-09-27T06:40:00.000Z", endsAt: "2026-09-27T09:00:00.000Z" };

describe("planRepeat", () => {
  it("takes the newest series' latest episodes, as few as cover the gap", () => {
    const plan = planRepeat([...lateCrate, item({ title: "Old thing", createdAt: "2026-01-01T00:00:00.000Z" })], [{ id: LATE, title: "Late Crate" }], gap, 2 * MIN, "America/Los_Angeles")!;
    expect(plan.itemIds).toEqual(lateCrate.slice(10).map((i) => i.id));
    expect(plan.long).toBe("Late Crate episodes 11 to 15, in order, with your break rule");
    expect(plan.short).toBe("Late Crate 11 to 15, until 2:00 am");
  });

  it("leaves out what can't air: unconfirmed rights, still preparing, not a program", () => {
    const items = [item({ title: "Link import", rights: null }), item({ title: "Preparing", status: "preparing" }), item({ title: "ID", code: "SID" })];
    expect(planRepeat(items, [], gap, 2 * MIN)).toBeNull();
  });

  it("repeats a single program", () => {
    const plan = planRepeat([item({ title: "My first show" })], [], gap, 2 * MIN, "America/Los_Angeles")!;
    expect(plan.long).toBe("My first show, repeated, with your break rule");
    expect(plan.short).toBe("My first show, until 2:00 am");
  });
});
