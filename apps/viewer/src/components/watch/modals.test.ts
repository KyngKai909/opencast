import { describe, expect, it } from "vitest";
import type { AiringX, StationIdentX, StationPageX } from "../../api/ext";
import { marketAirings, whenText } from "./CarriedFrom";
import { parseAmount, pledgeAmount, pledgeSummary } from "./Pledge";
import { airingWhen, shareUrl } from "./Share";
import { rowFromPage, withOutsideStation } from "./logic";
import { carriedByOthers, previewListings, previewNote } from "../overlays/StationPreview";

const TZ = "America/Los_Angeles";
const NOW = new Date("2026-09-27T03:42:00Z"); // Saturday 8:42 pm in Redlands
const pt = (h: number, m = 0, day = 0) => new Date(Date.UTC(2026, 8, 26 + day, h + 7, m)).toISOString();

function ident(callSign: string, channel: string, market = "inland-empire"): StationIdentX {
  return { id: callSign.toLowerCase(), kind: "station", callSign, handle: callSign.toLowerCase(), name: callSign, colour: "#33507A", band: "tv", channel, marketSlug: market, homeCity: "Redlands" };
}
function airing(title: string, start: string, end: string, programId: string | null = null): AiringX {
  return { logEntryId: title, title, episodeTitle: null, code: "PGM", kind: "program", startsAt: start, endsAt: end, live: false, carriedFrom: null, programId, note: null, listedAiringId: null };
}

describe("pledge amounts", () => {
  it("reads what people type", () => {
    expect(parseAmount("12.50")).toBe(12_500_000);
    expect(parseAmount("$1,000")).toBe(1_000_000_000);
    expect(parseAmount("12.345")).toBeNull();
    expect(parseAmount("ten")).toBeNull();
  });
  it("starts at $1.00", () => {
    expect(pledgeAmount("other", "0.50")).toEqual({ micros: null, error: "Pledges start at $1.00." });
    expect(pledgeAmount("other", "1")).toEqual({ micros: 1_000_000, error: null });
    expect(pledgeAmount("other", "")).toEqual({ micros: null, error: null });
    expect(pledgeAmount(10_000_000, "")).toEqual({ micros: 10_000_000, error: null });
  });
  it("says where the money goes, monthly or once", () => {
    expect(pledgeSummary(10_000_000, "monthly", "Inland Beat")).toBe("$10.00 a month goes to Inland Beat. Cancel any time from You.");
    expect(pledgeSummary(20_000_000, "once", "Inland Beat")).toBe("$20.00 goes to Inland Beat, once.");
  });
});

describe("carried from", () => {
  const upcoming = [
    { logEntryId: "3", startsAt: pt(9, 0, 1), station: ident("SAZN", "18.1") },
    { logEntryId: "1", startsAt: pt(20, 30), station: ident("BEAT", "12.1") },
    { logEntryId: "2", startsAt: pt(9, 0, 8), station: ident("SAZN", "18.1") },
    { logEntryId: "9", startsAt: pt(21), station: ident("KLAX", "4.1", "los-angeles") }
  ];
  it("lists each station in the market once, in channel order, from upcoming", () => {
    expect(marketAirings({ upcoming, whereToWatch: undefined }, "inland-empire").map((r) => [r.station.callSign, r.startsAt])).toEqual([
      ["BEAT", pt(20, 30)],
      ["SAZN", pt(9, 0, 1)]
    ]);
  });
  it("prefers where-to-watch with its slot and the airing on now", () => {
    const rows = marketAirings(
      {
        upcoming,
        whereToWatch: [
          { station: ident("REEL", "24.1"), slot: "Saturdays, all day", now: airing("x", pt(20), pt(21)), next: null },
          { station: ident("BEAT", "12.1"), slot: "Saturdays at 8:30 pm", now: null, next: airing("y", pt(20, 30), pt(21)) }
        ]
      },
      "inland-empire"
    );
    expect(rows.map((r) => [r.station.callSign, r.slot, r.startsAt])).toEqual([
      ["BEAT", "Saturdays at 8:30 pm", pt(20, 30)],
      ["REEL", "Saturdays, all day", pt(20)]
    ]);
  });
  it("gives tonight's time plainly and another day's with the day", () => {
    expect(whenText(pt(20, 30), NOW, TZ)).toBe("8:30 pm");
    expect(whenText(pt(9, 0, 1), NOW, TZ)).toBe("Sun 9:00 am");
  });
});

describe("share", () => {
  it("names when the airing is", () => {
    expect(airingWhen({ startsAt: pt(21), endsAt: pt(22) }, NOW, TZ)).toBe("tonight at 9:00 pm");
    expect(airingWhen({ startsAt: pt(20, 30), endsAt: pt(21) }, NOW, TZ)).toBe("on now");
    expect(airingWhen({ startsAt: pt(9, 0, 1), endsAt: pt(10, 0, 1) }, NOW, TZ)).toBe("tomorrow at 9:00 am");
  });
  it("links the station, or one airing", () => {
    const beat = ident("BEAT", "12.1");
    expect(shareUrl("https://useopencast.org", beat)).toBe("https://useopencast.org/beat");
    expect(shareUrl("https://useopencast.org", beat, { logEntryId: "abc", listedAiringId: null })).toBe("https://useopencast.org/watch/beat?airing=abc");
  });
});

describe("station preview", () => {
  const page = { now: airing("Town Hall", pt(20), pt(21, 30), "th"), upNext: [airing("Planning Commission", pt(21, 30), pt(23), "pc"), airing("Community notices", pt(23), pt(23, 30)), airing("Council Watch", pt(23, 30), pt(24, 30), "cw")] };
  it("shows now, next and one later, skipping filler for the later", () => {
    const l = previewListings(page);
    expect([l.now?.title, l.next?.title, l.later?.title]).toEqual(["Town Hall", "Planning Commission", "Council Watch"]);
  });
  it("writes the note", () => {
    expect(previewNote("Public affairs", "On air 6:00 am to 1:00 am.", { title: "Council Watch", carriers: 6 })).toBe("Public affairs. On air 6:00 am to 1:00 am. Council Watch is carried by 6 stations.");
    expect(previewNote(undefined, null, undefined)).toBe("");
  });
  it("takes carriage from madeHere, or the dial until it lands", () => {
    expect(carriedByOthers("civc", [{ program: { id: "cw", title: "Council Watch" }, carriers: 6 }], [])).toEqual([{ programId: "cw", title: "Council Watch", carriers: 6 }]);
    const dial = { carriedWidely: [{ program: { id: "cw", title: "Council Watch" }, maker: ident("CIVC", "7.1"), carriers: 6, where: null }] } as never;
    expect(carriedByOthers("civc", undefined, [dial])).toEqual([{ programId: "cw", title: "Council Watch", carriers: 6 }]);
  });
});

describe("a station from outside the dial", () => {
  const page = { station: ident("CIVC", "7.1"), onAir: true, now: airing("Town Hall", pt(20), pt(21, 30)), upNext: [airing("Planning", pt(21, 30), pt(23))], playback: { kind: "hls" as const, url: "/x.m3u8" } } as Pick<StationPageX, "station" | "onAir" | "now" | "upNext" | "playback">;
  it("becomes a dial row the player can tune", () => {
    const row = rowFromPage(page);
    expect(row.next?.title).toBe("Planning");
    expect(row.playback?.url).toBe("/x.m3u8");
  });
  it("joins the player's dial once", () => {
    const row = rowFromPage(page);
    const once = withOutsideStation([], row)!;
    expect(once).toHaveLength(1);
    expect(withOutsideStation(once, row)).toBeNull();
  });
});
