// A246 (Phase 4): a block's start and end as handles on the rundown, worked out (blockHandles.ts).
// A handle lands between rows and takes the start of the row below, or the day's end; the arrow
// keys move it a row; on air only its end moves; blocks never overlap; membership while dragging
// is the API's start-time rule; and each row says what it is to the block.

import { describe, expect, it } from "vitest";
import type { DayRow } from "./dayRows";
import type { DraftEntry, DraftSpan } from "./logEdit";
import { handleRange, handleSpots, handleWords, isMember, memberNote, membershipChange, membershipWords, nudgeHandle } from "./blockHandles";

const T = (hms: string) => `2026-09-27T${hms}.000Z`;
const entry = (id: string, startsAt: string, endsAt: string, o: Partial<DraftEntry> = {}): DraftEntry => ({ id, kind: "program", code: "PGM", startsAt, endsAt, title: id, episodeTitle: null, itemId: null, programId: null, liveSourceId: null, carriedFrom: null, carriageAgreementId: null, repeatGroupId: null, localNote: null, ...o });
const span = (o: Partial<DraftSpan> = {}): DraftSpan => ({ id: "s", blockId: "b", name: "Late Crate Nights", colour: "#1F5C99", startsAt: T("04:00:00"), endsAt: T("08:00:00"), ...o });
const row = (id: string, kind: DayRow["kind"], at: string, o: Partial<DayRow> = {}): DayRow => ({ id, kind, code: "PGM", at, endsAt: at, title: id, source: null, state: "ahead", block: null, ...o });

// 9:00 pm Beat Tape Live (live), 10:00 Late Crate 15, its break, 10:30 Slow Hours, 11:40 dead air,
// 12:00 am Late Crate 13, 12:30 Crate Session 01; the block from 9:00 pm to 1:00 am.
const entries = [
  entry("Beat Tape Live", T("04:00:00"), T("05:00:00"), { kind: "live" }),
  entry("Late Crate 15", T("05:00:00"), T("05:29:10")),
  entry("Slow Hours", T("05:30:00"), T("06:40:00")),
  entry("Late Crate 13", T("07:00:00"), T("07:29:10")),
  entry("Crate Session 01", T("07:30:00"), T("08:28:40"))
];
const rows = [
  row("band:s", "band", T("04:00:00")),
  ...entries.map((e) => row(e.id, "entry", e.startsAt, { entry: e })),
  row("brk", "break", T("05:29:10")),
  row("gap", "gap", T("06:40:00")),
  row("off", "off_air", T("09:00:00"))
];
const DAY_END = T("13:00:00");

describe("where a handle can land", () => {
  it("is the start of each row it can sit above (not a break: that's its program's), and the day's end", () => {
    expect(handleSpots(rows, DAY_END)).toEqual([T("04:00:00"), T("05:00:00"), T("05:30:00"), T("06:40:00"), T("07:00:00"), T("07:30:00"), T("09:00:00"), DAY_END]);
  });

  it("keeps a start between the block before and its own end, an end between its start and the block after, inside the day", () => {
    const other = span({ id: "o", startsAt: T("02:00:00"), endsAt: T("03:00:00") });
    const next = span({ id: "n", startsAt: T("09:00:00"), endsAt: T("10:00:00") });
    const limits = { earliest: Date.parse(T("00:00:00")), dayEnd: DAY_END };
    expect(handleRange(span(), [other, span(), next], "start", limits)).toEqual({ min: Date.parse(T("03:00:00")), max: Date.parse(T("08:00:00")) - 1 });
    expect(handleRange(span(), [other, span(), next], "end", limits)).toEqual({ min: Date.parse(T("04:00:00")) + 1, max: Date.parse(T("09:00:00")) });
    expect(handleRange(span(), [span()], "end", limits)?.max).toBe(Date.parse(DAY_END));
  });

  it("on air, only the end moves, and not into what's already set", () => {
    const limits = { earliest: Date.parse(T("04:42:20")), dayEnd: DAY_END };
    expect(handleRange(span(), [span()], "start", limits)).toBeNull();
    expect(handleRange(span(), [span()], "end", limits)).toEqual({ min: Date.parse(T("04:42:20")) + 1, max: Date.parse(DAY_END) });
    expect(handleRange(span({ endsAt: T("04:30:00") }), [span()], "end", limits)).toBeNull();
  });

  it("moves a row at a time with the arrow keys: an edge between rows sits above the row after it", () => {
    const spots = handleSpots(rows, DAY_END);
    const range = { min: 0, max: Date.parse(DAY_END) };
    // The end at 1:00 am sits above the off air row (2:00 am): down goes below it (the day's end), up above Crate Session 01.
    expect(nudgeHandle(spots, T("08:00:00"), 1, range)).toBe(DAY_END);
    expect(nudgeHandle(spots, T("08:00:00"), -1, range)).toBe(T("07:30:00"));
    // On a row's start: a row either way.
    expect(nudgeHandle(spots, T("05:00:00"), 1, range)).toBe(T("05:30:00"));
    expect(nudgeHandle(spots, T("05:00:00"), -1, range)).toBe(T("04:00:00"));
    // Not past what it can reach, nor past either end.
    expect(nudgeHandle(spots, T("05:00:00"), -1, { min: Date.parse(T("04:30:00")), max: range.max })).toBeNull();
    expect(nudgeHandle(spots, DAY_END, 1, range)).toBeNull();
  });
});

describe("membership while dragging", () => {
  it("is by start: who joins, who leaves, in words", () => {
    expect(isMember(span(), entries[0])).toBe(true);
    expect(isMember(span(), entry("off", T("05:00:00"), T("06:00:00"), { kind: "off_air" }))).toBe(false);
    const shorter = membershipChange(span(), { startsAt: T("04:00:00"), endsAt: T("07:30:00") }, entries);
    expect(shorter.leaves.map((e) => e.id)).toEqual(["Crate Session 01"]);
    expect(membershipWords(shorter)).toBe("Crate Session 01 leaves it");
    const later = membershipChange(span({ endsAt: T("07:30:00") }), { startsAt: T("05:00:00"), endsAt: T("08:00:00") }, entries);
    expect(membershipWords(later)).toBe("Crate Session 01 joins it. Beat Tape Live leaves it");
    expect(membershipWords(membershipChange(span(), span(), entries))).toBe("Its programs stay the same");
  });

  it("says each edge as f-blockplace draws it, with its outro's time", () => {
    const moved = span({ endsAt: T("07:30:00") });
    expect(handleWords(moved, "start", { entries })).toEqual({ title: "Late Crate Nights starts 9:00 pm", detail: "Drag to change. Programs that start inside it become its members" });
    expect(handleWords(moved, "end", { was: span(), entries, outro: true })).toEqual({ title: "Ends 12:30 am, was 1:00 am", detail: "Its outro airs at 12:29:10 am" });
    expect(handleWords(moved, "end", { entries, outro: false })).toEqual({ title: "Ends 12:30 am", detail: "It airs until 12:29 am" });
    expect(handleWords(span({ startsAt: T("10:00:00"), endsAt: T("11:00:00") }), "end", { entries }).detail).toBe("Nothing in it yet");
    expect(handleWords(span(), "start", { entries, locked: true })).toEqual({ title: "Late Crate Nights started 9:00 pm", detail: "On air, so only its end can change" });
  });

  it("says on each row what it is to the block", () => {
    const moved = [span({ endsAt: T("07:15:00") })];
    const intro = { intro: () => true };
    expect(memberNote(entries[0], moved, entries, intro)).toBe("Member. Its intro airs just before");
    expect(memberNote(entries[0], moved, entries)).toBe("Member");
    expect(memberNote(entries[3], moved, entries)).toBe("Member, runs to 12:29 am");
    expect(memberNote(entries[4], moved, entries)).toBe("Not a member: starts after the block ends");
    expect(memberNote(entry("early", T("03:30:00"), T("04:30:00")), moved, [entry("early", T("03:30:00"), T("04:30:00")), ...entries])).toBe("Not a member: starts before the block");
    expect(memberNote(entry("far", T("10:00:00"), T("11:00:00")), moved, [...entries, entry("far", T("10:00:00"), T("11:00:00"))])).toBeNull();
  });
});
