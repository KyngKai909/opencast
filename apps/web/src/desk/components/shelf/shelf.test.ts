// The catalog's words (desk-catalog 01 to 03), as the frames write them.
import { describe, expect, it } from "vitest";
import type { EpisodeView, RebuildView, Shelf, ShelfItem, ShelfSeriesRow } from "@opencast/contracts";
import { checkRows, episodeSub, episodesCell, evidenceWords, lengthWords, rebuildWords, removalNote, seriesLine, shelfStats, stateTag } from "./shelf";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (over: Partial<ShelfSeriesRow>): ShelfSeriesRow => ({
  id: U(1),
  title: "The mystery hour",
  description: "30 min radio dramas, 1940s",
  colour: "#33507A",
  mediaKind: "audio",
  episodeLengthMs: 1_800_000,
  rightsBasis: "sound_recording",
  basisLabel: "Per show, still checking",
  basisNote: "Old radio rights vary by series",
  episodesReady: 44,
  episodesTotal: 60,
  carriers: 6,
  state: "in_review",
  inReview: 7,
  station: { id: U(111), kind: "catalog", callSign: "OCAT", handle: "ocat", name: "Opencast Classics", colour: "#1F3A5F", band: "tv", channel: "60.1", marketSlug: "inland-empire", homeCity: null },
  programId: U(2),
  ...over
});
const date = (iso: string) => ({ "2026-09-21T16:00:00.000Z": "September 21" })[iso] ?? iso;

describe("the shelf", () => {
  it("reads its four numbers as drawn", () => {
    const shelf = { stats: { itemsPassed: 312, readyMs: 486 * 3_600_000, carrierStations: 21, carrierMarkets: 3, awaitingSecondCheck: 7 } } as Shelf;
    expect(shelfStats(shelf)).toEqual([
      { value: "312", caption: "Items with a confirmed rights record" },
      { value: "486 hr", caption: "Prepared and ready to air" },
      { value: "21", caption: "Stations carrying catalog series, in 3 markets" },
      { value: "7", caption: "Items waiting for a second check" }
    ]);
  });

  it("says each series' episodes and state", () => {
    expect(episodesCell(row({}))).toEqual({ value: "44", of: " of 60" });
    expect(episodesCell(row({ episodesReady: 12, episodesTotal: 12 }))).toEqual({ value: "12", of: null });
    expect(stateTag(row({}))).toEqual({ text: "7 in review", variant: "standby" });
    expect(stateTag(row({ state: "offered", inReview: 0 }))).toEqual({ text: "Offered", variant: "plain" });
    expect(stateTag(row({ state: "coming", inReview: 0 })).text).toBe("Coming");
    expect(seriesLine(row({ description: null, episodeLengthMs: 7_200_000 }))).toBe("2 hr episodes");
    expect(lengthWords(1_800_000)).toBe("30 min");
  });
});

describe("a series", () => {
  const ep: EpisodeView = {
    id: U(3),
    number: 14,
    title: "River boats and paddle wheels",
    status: "ready",
    version: 2,
    lengthMs: 1_630_000,
    error: null,
    composedAt: null,
    libraryItemId: null,
    items: [
      { itemId: U(4), title: "River Rhythms", source: "1929", publishedYear: 1929, basisLine: "Published 1929, before 1931", lengthMs: 400_000, position: 1, removedAt: null, removedReason: null, checkedBy: ["Dee A.", "Rae T."] },
      { itemId: U(5), title: "Down the River", source: "1934", publishedYear: 1934, basisLine: "Renewal found in 1962", lengthMs: 440_000, position: null, removedAt: "2026-09-21T16:00:00.000Z", removedReason: "Renewal found in 1962", checkedBy: [] }
    ]
  };

  it("says what's in an episode, and what came out", () => {
    expect(episodeSub(ep)).toBe("River boats and paddle wheels. 1 item, 27:10");
    expect(removalNote(ep, date)).toBe(
      '"Down the River" came out when its check failed (renewal found in 1962). Episode 14 was rebuilt: stations carrying it air the new version from their next airing, and nothing aired with it after September 21.'
    );
  });

  it("says what was rebuilt, and what wasn't", () => {
    const r: RebuildView = { id: U(6), at: "2026-09-21T16:00:00.000Z", by: null, reason: "Renewal found in 1962", item: { id: U(5), title: "Down the River" }, episodes: [{ episodeId: U(3), number: 14, fromVersion: 1, toVersion: 2, status: "ready" }], unchanged: 38 };
    expect(rebuildWords(r, date)).toBe('September 21: Episode 14 rebuilt after "Down the River" failed (renewal found in 1962). 38 unchanged.');
    expect(rebuildWords({ ...r, item: null, episodes: [{ ...r.episodes[0]!, number: 3 }, { ...r.episodes[0]!, number: 7 }, { ...r.episodes[0]!, number: 9 }] }, date)).toBe("September 21: Episodes 3, 7 and 9 rebuilt. 38 unchanged.");
  });
});

describe("an item's check", () => {
  it("fills the pane's first check, second check and then", () => {
    const item = { state: "second_check", firstCheck: { by: { userId: U(900), name: "Dee A." }, at: "2026-09-21T16:00:00.000Z" }, secondCheck: null, failed: null, episodes: [] } as unknown as ShelfItem;
    expect(checkRows(item, date)).toEqual([
      { label: "First check", value: "Dee A., September 21" },
      { label: "Second check", value: "Waiting" },
      { label: "Then", value: "Prepared and added to episodes" }
    ]);
  });

  it("names the evidence: files, a short record, or nothing", () => {
    const line = { line: "source", title: "", help: "", state: "ok", detail: null, record: null, evidence: [], prefilled: false, setBy: null, setAt: null } as ShelfItem["checklist"][number];
    expect(evidenceWords({ ...line, evidence: [{ fileName: "loc-record.pdf" } as never] })).toBe("loc-record.pdf");
    expect(evidenceWords({ ...line, state: "warn", record: "noted" })).toBe("noted");
    expect(evidenceWords({ ...line, record: "Copyright Office renewal records searched" })).toBe("record kept");
    expect(evidenceWords({ ...line, state: "not_needed" })).toBe("not needed");
    expect(evidenceWords(line)).toBe("");
  });
});
