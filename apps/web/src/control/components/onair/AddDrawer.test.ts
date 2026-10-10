// A246: the Add drawer, worked out: the space it adds into, the fit badges ("Fits", "9 min over"
// with what it pushes as far as the next fixed point, "Next episode", "Never aired"), next episodes
// from the day loaded and, for the rest, the library's (Programming Phase 2), and quick fill's
// inserts when it joins a draft. Also the tray's title.

import { describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "@opencast/contracts";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { fitOf, nextEpisodes, repeatInserts, spaceLine, type AddSpace } from "./AddDrawer";
import { trayTitle } from "./EditTray";
import type { DraftEntry } from "./logEdit";
import { fixedReason, type Reflow } from "./reorder";

const T = (hms: string) => `2026-09-27T${hms}.000Z`;
const MIN = 60_000;
const entry = (id: string, startsAt: string, endsAt: string, o: Partial<DraftEntry> = {}): DraftEntry => ({ id, kind: "program", code: "PGM", startsAt, endsAt, title: id, episodeTitle: null, itemId: null, programId: null, liveSourceId: null, carriedFrom: null, carriageAgreementId: null, repeatGroupId: null, localNote: null, ...o });
const item = (id: string, programId: string | null, episodeNumber: number | null, durationMs = 29 * MIN): LibraryItem => ({ id, programId, episodeNumber, title: id, durationMs } as LibraryItem);

// 11:40 pm dead air until Late Crate, ep. 13 at 12:00 am, then ep. 14 at 12:30.
const entries = [entry("Late Crate, ep. 13", T("07:00:00"), T("07:29:00")), entry("Late Crate, ep. 14", T("07:30:00"), T("08:00:00"))];
const reflow: Reflow = { entries, breaks: [], fixed: (e) => !!fixedReason(e, false), edges: [] };
const space: AddSpace = { at: T("06:40:00"), endsAt: T("07:00:00"), next: "Late Crate, ep. 13", gap: true };

describe("the space", () => {
  it("says how much is free and until what", () => {
    expect(spaceLine(space)).toBe("20 min free, until Late Crate, ep. 13 at 12:00 am");
    expect(spaceLine({ ...space, endsAt: null, next: null })).toBe("Nothing after it on this day");
  });
});

describe("fit badges", () => {
  it("fits, saying what's left for a break or more", () => {
    expect(fitOf(18 * MIN + 40_000, space, reflow, false)).toEqual({ badge: "fits", label: "Fits", line: "19:00. Leaves 1:00 for a break" });
    expect(fitOf(10 * MIN, space, reflow, false)).toEqual({ badge: "fits", label: "Fits", line: "10:00. Leaves 10 min" });
  });

  it("runs over, and says what it pushes as far as the next fixed point", () => {
    expect(fitOf(29 * MIN, space, reflow, true)).toEqual({ badge: "over", label: "9 min over", line: "Next episode. 29:00, runs 9 min over: Late Crate, ep. 13 moves to 12:09 am" });
    const kept: Reflow = { ...reflow, entries: entries.map((e, i) => (i === 0 ? { ...e, keepTime: true } : e)) };
    expect(fitOf(29 * MIN, space, kept, false).line).toBe("29:00, runs 9 min over, into Late Crate, ep. 13");
  });

  it("marks the next episode of a series when it fits", () => {
    expect(fitOf(15 * MIN, space, reflow, true)).toMatchObject({ badge: "next", label: "Next episode", line: "Next episode. 15:00. Leaves 5 min" });
  });

  it("marks what never aired when it fits, unless it's the next episode", () => {
    expect(fitOf(15 * MIN, space, reflow, false, undefined, true)).toEqual({ badge: "never", label: "Never aired", line: "Never aired. 15:00. Leaves 5 min" });
    expect(fitOf(15 * MIN, space, reflow, true, undefined, true)).toMatchObject({ badge: "next", label: "Next episode" });
    expect(fitOf(29 * MIN, space, reflow, false, undefined, true)).toMatchObject({ badge: "over", line: "Never aired. 29:00, runs 9 min over: Late Crate, ep. 13 moves to 12:09 am" });
  });
});

describe("next episodes", () => {
  it("are the episode after each series' latest airing in what's loaded", () => {
    const items = [item("lc13", "lc", 13), item("lc14", "lc", 14), item("lc15", "lc", 15), item("ct1", "ct", 1), item("ct2", "ct", 2), item("promo", null, null)];
    const aired = [
      { itemId: "lc13", programId: "lc", startsAt: T("07:00:00") },
      { itemId: "lc14", programId: "lc", startsAt: T("07:30:00") },
      { itemId: "ct2", programId: "ct", startsAt: T("04:00:00") }
    ];
    expect([...nextEpisodes(aired, items)]).toEqual(["lc15"]);
  });

  it("are the library's for a series not on the day loaded (after its last airing in the as-run log)", () => {
    const items = [item("lc14", "lc", 14), { ...item("lc15", "lc", 15), nextEpisode: false }, { ...item("ct1", "ct", 1), nextEpisode: false }, { ...item("ct2", "ct", 2), nextEpisode: true }, { ...item("lc1", "lc", 1), nextEpisode: true }];
    // Late Crate is on the day loaded: ep. 14 there wins over the library's ep. 1.
    expect([...nextEpisodes([{ itemId: "lc14", programId: "lc", startsAt: T("07:00:00") }], items)].sort()).toEqual(["ct2", "lc15"]);
  });
});

describe("quick fill in a draft", () => {
  it("repeats in order, whole minutes and a break after each, the last cut where the space ends", () => {
    let n = 0;
    const out = repeatInserts([item("a", "p", 1, 14 * MIN + 10_000)], T("06:40:00"), T("07:20:00"), 2 * MIN, () => `k${++n}`);
    expect(out.map((c) => (c.op === "insert" ? [c.entry.startsAt, c.entry.endsAt] : null))).toEqual([
      [T("06:40:00"), T("06:55:00")],
      [T("06:57:00"), T("07:12:00")],
      [T("07:14:00"), T("07:20:00")]
    ]);
    expect(out.map((c) => (c.op === "insert" ? c.key : null))).toEqual(["k1", "k2", "k3"]);
  });
});

describe("the tray's title", () => {
  it("counts the changes and says whether anything blocks publishing", () => {
    const result = (problems: number) => ({ applied: false, summary: "", changes: [], problems: Array.from({ length: problems }, () => ({ index: 0, code: "overlap", message: "" })), warnings: [], gaps: [], replanned: false, record: null });
    expect(trayTitle(4, result(0), false)).toBe("4 changes, checked: nothing blocks publishing");
    expect(trayTitle(1, result(1), false)).toBe("1 change, checked: 1 problem blocks publishing");
    expect(trayTitle(2, result(2), false)).toBe("2 changes, checked: 2 problems block publishing");
    expect(trayTitle(2, undefined, true)).toBe("2 changes, checking…");
  });
});
