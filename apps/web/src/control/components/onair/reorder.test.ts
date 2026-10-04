// A246 (decision 1): moving rows on the rundown, worked out (reorder.ts). A dropped row starts right
// after the row above it (and that row's break); the rows below shift down only as far as the next
// fixed point: live, carried, off air, kept at its time (G18), locked, or a block's edge. Arrow keys
// move a row a place; something added makes room the same way; a live block's new end pushes too;
// and membership while dragging follows the API's start-time rule.

import { describe, expect, it } from "vitest";
import type { BreakSlot } from "@opencast/contracts";
import type { DraftEntry, DraftSpan } from "./logEdit";
import { dropAfter, dropStart, edgesOf, fixedReason, makeRoom, membershipNote, nudge, resizeTo, type Reflow } from "./reorder";

const T = (hms: string) => `2026-09-27T${hms}.000Z`;
const MIN = 60_000;
const entry = (id: string, startsAt: string, endsAt: string, o: Partial<DraftEntry> = {}): DraftEntry => ({ id, kind: "program", code: "PGM", startsAt, endsAt, title: id, episodeTitle: null, itemId: null, programId: null, liveSourceId: null, carriedFrom: null, carriageAgreementId: null, repeatGroupId: null, localNote: null, ...o });
const brk = (startsAt: string, lengthMs: number): BreakSlot => ({ id: null, startsAt, lengthMs, context: "", origin: "rule", producerShareMs: 0, filledMs: 0, openMs: 0 });

// 9:00 pm a (28 min, then a 2 min break), 9:30 b, 10:00 c, 10:30 d; 11:30 e after a gap.
const base = [entry("a", T("04:00:00"), T("04:28:00")), entry("b", T("04:30:00"), T("05:00:00")), entry("c", T("05:00:00"), T("05:30:00")), entry("d", T("05:30:00"), T("06:00:00")), entry("e", T("06:30:00"), T("07:00:00"))];
const reflow = (entries: DraftEntry[], o: Partial<Reflow> = {}): Reflow => ({ entries, breaks: [brk(T("04:28:00"), 2 * MIN)], fixed: (e) => !!fixedReason(e, false), edges: [], ...o });

describe("what's a fixed point", () => {
  it("live, carried, off air, kept at its time and locked rows stay where they are", () => {
    expect(fixedReason(entry("x", T("04:00:00"), T("05:00:00"), { kind: "live" }), false)).toBe("live");
    expect(fixedReason(entry("x", T("04:00:00"), T("05:00:00"), { carriageAgreementId: "ag" }), false)).toBe("carried");
    expect(fixedReason(entry("x", T("04:00:00"), T("05:00:00"), { kind: "off_air" }), false)).toBe("off_air");
    expect(fixedReason(entry("x", T("04:00:00"), T("05:00:00"), { keepTime: true }), false)).toBe("kept");
    expect(fixedReason(entry("x", T("04:00:00"), T("05:00:00")), true)).toBe("locked");
    expect(fixedReason(entry("x", T("04:00:00"), T("05:00:00")), false)).toBeNull();
  });
});

describe("dropping a row", () => {
  it("puts it right after the row above and its break, and shifts what follows down to a gap", () => {
    // d dropped after a: it starts after a's break at 9:30; b and c shift down 30 minutes; e is after a gap.
    expect(dropAfter(reflow(base), "d", "a")).toEqual([
      { op: "move", entryId: "d", startsAt: T("04:30:00") },
      { op: "move", entryId: "b", startsAt: T("05:00:00") },
      { op: "move", entryId: "c", startsAt: T("05:30:00") }
    ]);
    // Later: the time b leaves is dead air (nothing moves up to fill it); e is after a gap, so stays.
    expect(dropAfter(reflow(base), "b", "d")).toEqual([{ op: "move", entryId: "b", startsAt: T("06:00:00") }]);
  });

  it("stops at a row kept at its time: what's lost shows as an overlap in the dry run", () => {
    const kept = base.map((e) => (e.id === "c" ? { ...e, keepTime: true } : e));
    expect(dropAfter(reflow(kept), "d", "a")).toEqual([
      { op: "move", entryId: "d", startsAt: T("04:30:00") },
      { op: "move", entryId: "b", startsAt: T("05:00:00") }
    ]);
  });

  it("stops at live, carried and locked rows, and at a block's edge", () => {
    const live = base.map((e) => (e.id === "b" ? { ...e, kind: "live" as const } : e));
    expect(dropAfter(reflow(live), "d", "a")).toEqual([{ op: "move", entryId: "d", startsAt: T("04:30:00") }]);
    const locked = reflow(base, { fixed: (e) => e.id === "c" });
    expect(dropAfter(locked, "d", "a")).toEqual([{ op: "move", entryId: "d", startsAt: T("04:30:00") }, { op: "move", entryId: "b", startsAt: T("05:00:00") }]);
    // A block starting at 10:15 pm: c would be pushed into it, so it stays.
    expect(dropAfter(reflow(base, { edges: edgesOf([{ startsAt: T("05:15:00"), endsAt: T("07:00:00") }], []) }), "d", "a")).toEqual([{ op: "move", entryId: "d", startsAt: T("04:30:00") }, { op: "move", entryId: "b", startsAt: T("05:00:00") }]);
  });

  it("at the top, takes the start of the row below", () => {
    expect(dropAfter(reflow(base), "c", null)[0]).toEqual({ op: "move", entryId: "c", startsAt: T("04:00:00") });
    expect(dropStart(reflow(base), "c", null)).toBe(T("04:00:00"));
  });

  it("dropped where it already is, nothing changes", () => {
    expect(dropAfter(reflow(base), "b", "a")).toEqual([]);
  });
});

describe("the arrow keys", () => {
  it("move a row one place up or down", () => {
    expect(nudge(reflow(base), "c", -1, () => false)?.[0]).toEqual({ op: "move", entryId: "c", startsAt: T("04:30:00") });
    expect(nudge(reflow(base), "c", 1, () => false)?.[0]).toEqual({ op: "move", entryId: "c", startsAt: T("06:00:00") });
  });

  it("don't go past either end, or up past a row that can't change", () => {
    expect(nudge(reflow(base), "a", -1, () => false)).toBeNull();
    expect(nudge(reflow(base), "e", 1, () => false)).toBeNull();
    expect(nudge(reflow(base), "c", -1, (e) => e.id === "b")).toBeNull();
  });
});

describe("making room, and a new end", () => {
  it("something put on shifts what's after it down as far as the next fixed point", () => {
    expect(makeRoom(reflow(base), T("05:00:00"), 15 * MIN)).toEqual([
      { op: "move", entryId: "c", startsAt: T("05:15:00") },
      { op: "move", entryId: "d", startsAt: T("05:45:00") }
    ]);
  });

  it("a live block running longer pushes the rows after it", () => {
    const live = [entry("live", T("04:00:00"), T("05:00:00"), { kind: "live" }), ...base.slice(2)];
    expect(resizeTo(reflow(live, { breaks: [] }), "live", T("05:10:00"))).toEqual([
      { op: "resize", entryId: "live", endsAt: T("05:10:00") },
      { op: "move", entryId: "c", startsAt: T("05:10:00") },
      { op: "move", entryId: "d", startsAt: T("05:40:00") }
    ]);
  });
});

describe("membership while dragging", () => {
  const spans: DraftSpan[] = [{ id: "s", blockId: "b", name: "Late Crate Nights", colour: null, startsAt: T("04:00:00"), endsAt: T("06:00:00") }];
  it("says when a row would join, stay in or leave a block, by its new start", () => {
    expect(membershipNote(spans, T("03:00:00"), T("04:30:00"))).toBe("Joins Late Crate Nights");
    expect(membershipNote(spans, T("04:30:00"), T("05:30:00"))).toBe("In Late Crate Nights");
    expect(membershipNote(spans, T("05:30:00"), T("06:00:00"))).toBe("Leaves Late Crate Nights");
    expect(membershipNote(spans, T("02:00:00"), T("03:00:00"))).toBeNull();
  });
});
