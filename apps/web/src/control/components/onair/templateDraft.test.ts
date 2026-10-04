// A246 (Phase 4, decision 7): a day template's rundown as the day's rows (templateDraft.ts): its
// wall-clock times placed on a date and back, whole minutes kept when rows move, what goes to
// `updateTemplate`, and the template's own check: each change in words (a block's with who joins
// or leaves) and what blocks saving (an overlap, two blocks overlapping, a block past 6:00 am).

import { describe, expect, it } from "vitest";
import type { DayTemplate } from "@opencast/contracts";
import { draftEntries, draftSpans } from "./logEdit";
import { dropAfter, fixedReason } from "./reorder";
import { blocksInput, checkTemplate, dayEndOf, entriesInput, minuteBreaks, placeOn, templateEntries, templateSpans, wallClockOf } from "./templateDraft";

const MIN = 60_000;
const te = (id: string, startTime: string, lengthMs: number, o: Partial<DayTemplate["entries"][number]> = {}): DayTemplate["entries"][number] => ({ id, startTime, lengthMs, kind: "program", code: "PGM", title: id, itemId: `item-${id}`, programId: null, liveSourceId: null, carriageAgreementId: null, episodeTitle: null, episodeDescription: null, localNote: null, ...o });
const tpl = {
  entries: [te("Late Crate 14", "20:00", 29 * MIN + 10_000, { episodeTitle: "ep. 14" }), te("Saturday Reel", "20:30", 29 * MIN, { carriageAgreementId: "ag" }), te("Beat Tape Live", "21:00", 60 * MIN, { kind: "live", itemId: null, liveSourceId: "src" }), te("Night Owl", "01:00", 60 * MIN, { localNote: "Repeat" })],
  blocks: [{ id: "tb", blockId: "b", name: "Late Crate Nights", colour: "#1F5C99", startTime: "20:00", lengthMs: 60 * MIN }]
};
const DATE = "2026-10-03";

describe("a template's times, on a date and back", () => {
  it("places wall-clock times on the broadcast day (before 6:00 am is after midnight) and reads them back to the minute", () => {
    expect(placeOn("20:00", DATE)).toBe("2026-10-04T03:00:00.000Z");
    expect(placeOn("01:00", DATE)).toBe("2026-10-04T08:00:00.000Z");
    expect(dayEndOf(DATE)).toBe("2026-10-04T13:00:00.000Z");
    expect(wallClockOf("2026-10-04T03:29:40.000Z")).toBe("20:30");
    const entries = templateEntries(tpl, DATE, (id) => (id === "ag" ? { id: "reel", callSign: "REEL", channel: "24.1", name: "Reel 24", colour: "#33507A" } as never : null));
    expect(entries.map((e) => [e.title, e.startsAt])).toEqual([
      ["Late Crate 14", "2026-10-04T03:00:00.000Z"],
      ["Saturday Reel", "2026-10-04T03:30:00.000Z"],
      ["Beat Tape Live", "2026-10-04T04:00:00.000Z"],
      ["Night Owl", "2026-10-04T08:00:00.000Z"]
    ]);
    expect(entries[1].carriedFrom?.callSign).toBe("REEL");
    expect(templateSpans(tpl, DATE)).toEqual([{ id: "tb", blockId: "b", name: "Late Crate Nights", colour: "#1F5C99", startsAt: "2026-10-04T03:00:00.000Z", endsAt: "2026-10-04T04:00:00.000Z" }]);
  });

  it("keeps whole minutes when a row moves: the next row starts at the minute after", () => {
    const entries = templateEntries(tpl, DATE);
    expect(minuteBreaks(entries).map((b) => [b.startsAt, b.lengthMs])).toEqual([["2026-10-04T03:29:10.000Z", 50_000]]);
    // Night Owl dropped after Late Crate 14: at 8:30 pm, not 8:29:10 (Saturday Reel is carried, so it stays).
    const moves = dropAfter({ entries, breaks: minuteBreaks(entries), fixed: (e) => !!fixedReason(e, false), edges: [] }, "Night Owl", "Late Crate 14");
    expect(moves).toEqual([{ op: "move", entryId: "Night Owl", startsAt: "2026-10-04T03:30:00.000Z" }]);
  });

  it("sends the draft back as the template's entries and blocks, each keeping its episode and note", () => {
    const entries = templateEntries(tpl, DATE);
    const moved = draftEntries(entries, [{ op: "move", entryId: "Night Owl", startsAt: "2026-10-04T09:00:00.000Z" }], () => undefined);
    expect(entriesInput(moved, tpl)).toEqual([
      { startTime: "20:00", lengthMs: 29 * MIN + 10_000, kind: "program", itemId: "item-Late Crate 14", episodeTitle: "ep. 14" },
      { startTime: "20:30", lengthMs: 29 * MIN, kind: "program", itemId: "item-Saturday Reel", carriageAgreementId: "ag" },
      { startTime: "21:00", lengthMs: 60 * MIN, kind: "live", liveSourceId: "src" },
      { startTime: "02:00", lengthMs: 60 * MIN, kind: "program", itemId: "item-Night Owl", localNote: "Repeat" }
    ]);
    const spans = draftSpans(templateSpans(tpl, DATE), [{ op: "block_resize", spanId: "tb", endsAt: "2026-10-04T05:00:00.000Z" }], () => undefined);
    expect(blocksInput(spans)).toEqual([{ blockId: "b", startTime: "20:00", lengthMs: 2 * 60 * MIN }]);
  });
});

describe("the template's own check", () => {
  const before = templateEntries(tpl, DATE);
  const spansBefore = templateSpans(tpl, DATE);
  const check = (changes: Parameters<typeof checkTemplate>[0]["changes"]) =>
    checkTemplate({ changes, before, after: draftEntries(before, changes, (id) => (id === "x" ? { id: "x", title: "Crate Session 03", durationMs: 58 * MIN } : undefined)), spansBefore, spansAfter: draftSpans(spansBefore, changes, (id) => (id === "m" ? { name: "Matinee", colour: null } : undefined)), dayEnd: dayEndOf(DATE) });

  it("says each change in the tray's words, a block's with who joins or leaves it", () => {
    const r = check([
      { op: "block_resize", spanId: "tb", endsAt: "2026-10-04T04:30:00.000Z" },
      { op: "remove", entryId: "Night Owl" },
      { op: "insert", key: "k", entry: { kind: "program", startsAt: "2026-10-04T10:00:00.000Z", itemId: "x" } },
      { op: "keep", entryId: "Late Crate 14", keep: true }
    ]);
    expect(r.lines).toEqual([
      { index: 0, line: "Late Crate Nights now ends at 9:30 pm, was 9:00 pm. Beat Tape Live joins it" },
      { index: 1, line: "Night Owl comes off the template" },
      { index: 2, line: "Crate Session 03 goes on at 3:00 am" },
      { index: 3, line: "Late Crate 14 keeps its time" }
    ]);
    expect(r.problems).toEqual([]);
  });

  it("finds what blocks saving: an overlap, two blocks overlapping, a block past 6:00 am", () => {
    expect(check([{ op: "move", entryId: "Night Owl", startsAt: "2026-10-04T04:30:00.000Z" }]).problems).toEqual([{ index: 0, message: "Night Owl would overlap Beat Tape Live at 9:30 pm." }]);
    expect(check([{ op: "block_add", key: "m1", blockId: "m", startsAt: "2026-10-04T03:30:00.000Z", endsAt: "2026-10-04T05:00:00.000Z" }]).problems).toEqual([{ index: 0, message: "Blocks can't overlap: Late Crate Nights is on until 9:00 pm." }]);
    expect(check([{ op: "block_resize", spanId: "tb", endsAt: "2026-10-04T14:00:00.000Z" }]).problems).toEqual([{ index: 0, message: "A block in a day template ends by 6:00 am, when the next broadcast day starts. Make it two blocks, or place it on the date." }]);
  });
});
