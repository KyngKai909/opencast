import { describe, expect, it } from "vitest";
import type { GuideX } from "../../api/ext";
import { GUIDE_PHONE_SPAN_MS, findListing, gridRows, guideDate, guideHeading, guideWindow, listingActions, stepWindow } from "./logic";

const TZ = "America/Los_Angeles";
// Saturday, September 26, 2026 at 8:42 pm in Redlands (UTC−7).
const NOW = new Date("2026-09-27T03:42:00Z");
const pt = (h: number, m = 0, day = 0) => new Date(Date.UTC(2026, 8, 26 + day, h + 7, m));

describe("the guide's window", () => {
  it("opens on the hour now is in, three hours wide", () => {
    const w = guideWindow(NOW, null);
    expect(w.from.toISOString()).toBe(pt(20).toISOString());
    expect(w.to.toISOString()).toBe(pt(23).toISOString());
  });
  it("snaps a ?from= to the hour", () => {
    expect(guideWindow(NOW, pt(21, 40).toISOString()).from.toISOString()).toBe(pt(21).toISOString());
  });
  it("ignores a ?from= it can't read", () => {
    expect(guideWindow(NOW, "yesterday").from.toISOString()).toBe(pt(20).toISOString());
  });
  it("moves three hours at a time", () => {
    expect(stepWindow(NOW, pt(20), "later")?.toISOString()).toBe(pt(23).toISOString());
    expect(stepWindow(NOW, pt(20), "earlier")?.toISOString()).toBe(pt(17).toISOString());
  });
  it("never ends more than 24 hours after now", () => {
    // The latest window ends by 8:42 pm tomorrow: it starts at 5:00 pm.
    const far = guideWindow(NOW, pt(23, 0, 3).toISOString());
    expect(far.from.toISOString()).toBe(pt(17, 0, 1).toISOString());
    expect(far.to.getTime() - NOW.getTime()).toBeLessThanOrEqual(24 * 3600e3);
    expect(stepWindow(NOW, far.from, "later")).toBeNull();
  });
  it("never starts more than 24 hours before now", () => {
    const early = guideWindow(NOW, pt(8, 0, -5).toISOString());
    expect(early.from.toISOString()).toBe(pt(20, 0, -1).toISOString());
    expect(stepWindow(NOW, early.from, "earlier")).toBeNull();
  });
  it("gives each request at most 24 hours, the most the API answers", () => {
    const w = guideWindow(NOW, null, GUIDE_PHONE_SPAN_MS);
    expect(w.to.getTime() - w.from.getTime()).toBeLessThanOrEqual(24 * 3600e3);
  });
  it("clamps a step that would pass the edge to the edge", () => {
    // From 3:00 pm tomorrow, Later can only go to 5:00 pm.
    expect(stepWindow(NOW, pt(15, 0, 1), "later")?.toISOString()).toBe(pt(17, 0, 1).toISOString());
  });
});

describe("the heading", () => {
  it("says Tonight for this evening, with the date", () => {
    expect(guideHeading(pt(20), NOW, TZ)).toBe("Tonight");
    expect(guideDate(pt(20), TZ)).toBe("Saturday, September 26");
  });
  it("names the other days", () => {
    expect(guideHeading(pt(11), NOW, TZ)).toBe("Today");
    expect(guideHeading(pt(2, 0, 1), NOW, TZ)).toBe("Tomorrow");
    expect(guideHeading(pt(22, 0, -1), NOW, TZ)).toBe("Yesterday");
  });
});

describe("which button a listing leads with", () => {
  it("Remind me for anything not yet on, with Switch me over", () => {
    expect(listingActions({ startsAt: pt(21).toISOString(), endsAt: pt(22).toISOString() }, NOW)).toEqual({ when: "later", primary: "remind", remind: true, switchMeOver: true });
  });
  it("Tune in for what's on now", () => {
    expect(listingActions({ startsAt: pt(20, 30).toISOString(), endsAt: pt(21).toISOString() }, NOW)).toEqual({ when: "on", primary: "tune", remind: false, switchMeOver: false });
  });
  it("nothing to lead with once it's over", () => {
    expect(listingActions({ startsAt: pt(20).toISOString(), endsAt: pt(20, 30).toISOString() }, NOW).primary).toBeNull();
  });
});

describe("the grid's rows", () => {
  const guide = {
    market: { id: "m", slug: "inland-empire", name: "Inland Empire", timezone: TZ, open: true },
    from: pt(20).toISOString(),
    to: pt(23).toISOString(),
    rows: [
      {
        station: { id: "b", kind: "station", callSign: "BEAT", handle: "beat", name: "Inland Beat", colour: "#8C3B7A", band: "tv", channel: "12.1", marketSlug: "inland-empire", homeCity: "Redlands" },
        airings: [
          { logEntryId: "e1", title: "Saturday Reel", episodeTitle: null, code: "PGM", kind: "program", startsAt: pt(20, 30).toISOString(), endsAt: pt(21).toISOString(), live: false, carriedFrom: { id: "r", kind: "station", callSign: "REEL", handle: "reel", name: "Saturday Reel", colour: null, band: "tv", channel: "24.1", marketSlug: "inland-empire", homeCity: null }, programId: null }
        ]
      },
      {
        station: { id: "d", kind: "listed", callSign: "RDLS", handle: "rdls", name: "Redlands Public Access", colour: "#4F5B2A", band: "tv", channel: "9.1", marketSlug: "inland-empire", homeCity: "Redlands" },
        airings: [{ logEntryId: null, listedAiringId: "l1", title: "City Council", episodeTitle: null, code: "PGM", kind: "listed", startsAt: pt(19).toISOString(), endsAt: pt(21, 15).toISOString(), live: false, carriedFrom: null, programId: null }]
      }
    ]
  } as unknown as GuideX;
  it("maps airings to cells, with carried-from and listed", () => {
    const rows = gridRows(guide);
    expect(rows[0]!.programs[0]).toMatchObject({ id: "e1", carriedFrom: "REEL", listed: false });
    expect(rows[1]!.programs[0]).toMatchObject({ id: "l1", listed: true });
  });
  it("keeps only presets when asked", () => {
    expect(gridRows(guide, new Set(["d"])).map((r) => r.callSign)).toEqual(["RDLS"]);
  });
  it("finds a listing by its id", () => {
    expect(findListing(guide, "l1")?.station.callSign).toBe("RDLS");
    expect(findListing(guide, "nope")).toBeNull();
  });
});
