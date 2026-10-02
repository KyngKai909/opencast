// A241: a schedule entered by hand, as the desk's form edits it: the draft from a listing, what's
// sent, the API's rules said before sending, whether Change has anything to save, the week in one
// line a slot, and the change history's words.
import { describe, expect, it } from "vitest";
import type { ListedSource } from "@opencast/contracts";
import { changeWords } from "./external";
import { emptySlot, manualChanged, manualDraftOf, manualInput, manualProblems, weekLines } from "./manual";
import { zoneName } from "./ManualScheduleFields";

const loma = {
  id: "l",
  station: { id: "st", kind: "listed", callSign: "LOMA", handle: "loma", name: "Loma Linda Community Access", colour: null, band: "tv", channel: "9.7", marketSlug: "inland-empire", homeCity: null },
  name: "Loma Linda Community Access",
  description: null,
  streamUrl: "https://lomalinda.example.gov/live/manifest.mpd",
  embedTerms: "unclear",
  calendarUrl: null,
  calendarSync: "synced",
  listingState: "listed",
  lastSyncedAt: null,
  upcoming: 16,
  schedule: {
    source: "manual",
    format: null,
    url: null,
    checkedAgainst: "https://lomalinda.example.gov/community-access/program-grid",
    checkedOn: "2026-09-25",
    slots: [
      { days: ["sat"], start: "23:00", end: "01:00", title: "After hours", description: null, from: null, until: null },
      { days: ["mon", "tue", "wed", "thu", "fri"], start: "18:00", end: "21:00", title: "City Council", description: "Live from City Hall", from: null, until: "2026-12-18" }
    ],
    skipDates: ["2026-11-26"]
  }
} as ListedSource;

describe("the draft and what's sent", () => {
  it("fills the editor from a listing, keeps a season it doesn't edit, and sends the API's shape", () => {
    const d = manualDraftOf(loma);
    expect(d).toMatchObject({ checkedAgainst: "https://lomalinda.example.gov/community-access/program-grid", checkedOn: "2026-09-25", skipDates: ["2026-11-26"] });
    expect(d.slots.map((x) => x.title)).toEqual(["After hours", "City Council"]);
    expect(manualInput({ ...d, skipDates: ["2026-12-25", "2026-11-26"] })).toEqual({
      source: "manual",
      slots: [
        { days: ["sat"], start: "23:00", end: "01:00", title: "After hours", description: null },
        { days: ["mon", "tue", "wed", "thu", "fri"], start: "18:00", end: "21:00", title: "City Council", description: "Live from City Hall", until: "2026-12-18" }
      ],
      checkedAgainst: "https://lomalinda.example.gov/community-access/program-grid",
      checkedOn: "2026-09-25",
      skipDates: ["2026-11-26", "2026-12-25"]
    });
    // Days go in week order, whatever order they were picked in.
    expect(manualInput({ ...d, slots: [{ ...emptySlot(), days: ["fri", "mon"], title: " Late " }] }).slots[0]).toMatchObject({ days: ["mon", "fri"], title: "Late" });
  });

  it("starts fresh with one empty row, and (from a page with no event data) the page as where it was checked", () => {
    const fresh = manualDraftOf(undefined, "https://x.example.gov/hours.html");
    expect(fresh.slots).toHaveLength(1);
    expect(fresh.slots[0]).toMatchObject({ days: [], start: "18:00", end: "19:00", title: "" });
    expect(fresh.checkedAgainst).toBe("https://x.example.gov/hours.html");
  });

  it("says what the API would refuse, by field, before it's sent", () => {
    const d = { ...manualDraftOf(undefined), slots: [{ ...emptySlot(), title: "" }, { ...emptySlot(), days: ["mon" as const], start: "18:02", title: "Late" }] };
    expect(manualProblems(d)).toEqual({
      "slots.0.days": "Pick at least one day.",
      "slots.0.title": "Give it the title they publish.",
      "slots.1.start": "Use 5-minute steps (6:00, 6:05, 6:10).",
      checkedAgainst: "Paste the link to their published schedule.",
      checkedOn: "The day you checked it."
    });
    expect(manualProblems(manualDraftOf(loma))).toEqual({});
  });

  it("has nothing to save until something changes", () => {
    const d = manualDraftOf(loma);
    expect(manualChanged(d, loma)).toBe(false);
    expect(manualChanged({ ...d, skipDates: [...d.skipDates, "2026-12-24"] }, loma)).toBe(true);
    expect(manualChanged({ ...d, slots: d.slots.map((x, i) => (i ? { ...x, description: "" } : x)) }, loma)).toBe(true);
    expect(manualChanged(d, { ...loma, schedule: { ...loma.schedule!, source: "none" } })).toBe(true);
  });
});

describe("the week in words", () => {
  it("lists a slot a line, in week order, with the season", () => {
    expect(weekLines(loma)).toEqual([
      { text: "Mon–Fri 6:00–9:00 pm: City Council (until 2026-12-18)", description: "Live from City Hall" },
      { text: "Sat 11:00 pm–1:00 am: After hours", description: null }
    ]);
    expect(weekLines({ ...loma, schedule: { ...loma.schedule!, source: "feed" } })).toEqual([]);
    expect(zoneName("America/Los_Angeles")).toBe("Pacific Time");
  });

  it("reads a change to it in the history", () => {
    expect(
      changeWords(
        {
          id: "c",
          at: "2026-09-27T03:42:00.000Z",
          by: "Dee A.",
          action: "changed",
          fields: [
            { field: "schedule", from: "feed", to: "manual" },
            { field: "calendarFormat", from: "webpage", to: null },
            { field: "skipDates", from: null, to: "2026-11-26" }
          ],
          effects: ["schedule_reread"]
        },
        "America/Los_Angeles"
      ).text
    ).toBe("Dee A. changed What's on from Their calendar or schedule feed to Entered by hand; Feed format from Webpage (its event data) to nothing; Doesn't air on from nothing to 2026-11-26, 8:42 pm. Its schedule read again");
  });
});
