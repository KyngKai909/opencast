import { describe, expect, it } from "vitest";
import type { AiringX, DialRowX } from "../../api/ext";
import { carriedWhere, chipOptions, dayLabel, filterRows, isThin, milesApart, openChannelsText, pickHero, placeName, radioDetail, soFarText, thinRows, upStationLine } from "./logic";

const TZ = "America/Los_Angeles";
let n = 0;
function airing(o: Partial<AiringX> = {}): AiringX {
  return { logEntryId: `a${++n}`, title: "Program", episodeTitle: null, code: "PGM", kind: "program", startsAt: "2026-09-27T03:00:00Z", endsAt: "2026-09-27T04:30:00Z", live: false, carriedFrom: null, programId: null, note: null, listedAiringId: null, ...o } as AiringX;
}
function row(channel: string, o: { live?: boolean; category?: string; band?: "tv" | "radio"; onAir?: boolean; carriedFrom?: string; market?: string } = {}): DialRowX {
  const onAir = o.onAir ?? true;
  return {
    station: { id: `s${channel}`, kind: "station", callSign: `C${channel}`, handle: null, name: `Station ${channel}`, colour: "#2E6B5A", band: o.band ?? "tv", channel, marketSlug: o.market ?? "ie", homeCity: null, category: o.category } as DialRowX["station"],
    onAir,
    now: onAir ? airing({ live: !!o.live, carriedFrom: o.carriedFrom ? ({ id: "x", kind: "station", callSign: "FAR", handle: null, name: "Far", colour: null, band: "tv", channel: "4.1", marketSlug: o.carriedFrom, homeCity: null } as AiringX["carriedFrom"]) : null }) : null,
    next: null,
    playback: onAir ? { kind: "hls", url: "/x.m3u8" } : null
  };
}

describe("the hero", () => {
  it("goes to live programming in your market first, in channel order, never by popularity", () => {
    const rows = [row("31.1", { live: true }), row("7.1", { live: true }), row("12.1")];
    expect(pickHero(rows, "ie")?.row.station.channel).toBe("7.1");
    expect(pickHero(rows, "ie")?.why).toBe("local");
  });
  it("then a live program carried in from another market", () => {
    const rows = [row("7.1"), row("12.1", { live: true, carriedFrom: "la" }), row("18.1", { live: true, carriedFrom: "sd" })];
    expect(pickHero(rows, "ie")).toMatchObject({ why: "carried", row: { station: { channel: "12.1" } } });
  });
  it("counts a live program carried from a station in the same market as local", () => {
    const rows = [row("12.1", { live: true, carriedFrom: "ie" })];
    expect(pickHero(rows, "ie")?.why).toBe("local");
  });
  it("prefers local live over carried live even at a higher channel", () => {
    const rows = [row("2.1", { live: true, carriedFrom: "la" }), row("40.1", { live: true })];
    expect(pickHero(rows, "ie")?.row.station.channel).toBe("40.1");
  });
  it("then whatever preset 1 is airing", () => {
    const p1 = row("88.3", { band: "radio" });
    expect(pickHero([row("7.1")], "ie", p1)).toMatchObject({ why: "preset", row: p1 });
  });
  it("skips live radio (there's no picture to preview) and off-air rows", () => {
    expect(pickHero([row("101.9", { band: "radio", live: true }), row("7.1", { onAir: false })], "ie")).toBeNull();
  });
  it("is empty when nothing is live and preset 1 is off air or unset", () => {
    expect(pickHero([row("7.1")], "ie", row("9.1", { onAir: false }))).toBeNull();
    expect(pickHero([row("7.1")], "ie", null)).toBeNull();
  });
});

describe("chips", () => {
  const rows = [row("7.1", { category: "Public affairs", live: true }), row("9.1", { category: "Public affairs" }), row("12.1", { category: "Music" }), row("18.1", { category: "Food" }), row("24.1", { category: "Classic" }), row("31.1", { category: "Sports" }), row("40.1", { category: "Kids" })];
  it("lists All, Live now, then the dial's categories in the reference order, others A to Z", () => {
    expect(chipOptions(rows).map((c) => c.label)).toEqual(["All", "Live now", "Public affairs", "Music", "Classic", "Food", "Sports", "Kids"]);
  });
  it("leaves out categories no station has", () => {
    expect(chipOptions([row("7.1", { category: "Music" })]).map((c) => c.label)).toEqual(["All", "Live now", "Music"]);
  });
  it("filters by category and by live, keeping channel order", () => {
    expect(filterRows(rows, "all")).toHaveLength(7);
    expect(filterRows(rows, "Public affairs").map((r) => r.station.channel)).toEqual(["7.1", "9.1"]);
    expect(filterRows(rows, "live").map((r) => r.station.channel)).toEqual(["7.1"]);
    expect(filterRows([row("7.1", { live: true, onAir: false })], "live")).toEqual([]);
  });
});

describe("thin markets", () => {
  const market = { id: "m", slug: "ie", name: "Inland Empire", timezone: TZ, open: true };
  it("is thin when the dial comes with a nearby market", () => {
    expect(isThin({ rows: [row("5.1"), row("6.1"), row("7.1")], nearby: [{ market, miles: 40, rows: [] }] }, { rows: [], nearby: [] })).toBe(true);
  });
  it("is thin with fewer than three stations on both bands together", () => {
    expect(isThin({ rows: [row("5.1")], nearby: [] }, { rows: [row("96.1", { band: "radio" })], nearby: [] })).toBe(true);
    expect(isThin({ rows: [row("5.1"), row("6.1")], nearby: [] }, { rows: [row("96.1", { band: "radio" })], nearby: [] })).toBe(false);
    expect(isThin(undefined, undefined)).toBe(false);
  });
  it("lists the TV band, then the radio band, each in channel order", () => {
    expect(thinRows([row("9.1"), row("5.1")], [row("96.1", { band: "radio" })]).map((r) => r.station.channel)).toEqual(["5.1", "9.1", "96.1"]);
  });
  it("says so plainly", () => {
    expect(soFarText(2)).toBe("2 stations so far");
    expect(soFarText(1)).toBe("1 station so far");
    expect(soFarText(0)).toBe("No stations so far");
  });
  it("names the open channels", () => {
    const open = Array.from({ length: 68 }, (_, i) => String(i + 2)).filter((c) => c !== "5");
    expect(openChannelsText("High Desert", open)).toBe("The High Desert has room on the dial. Any channel from 2 to 69 is open except 5.");
    expect(openChannelsText("High Desert", open.filter((c) => c !== "12"))).toBe("The High Desert has room on the dial. Any channel from 2 to 69 is open except 5 and 12.");
    expect(openChannelsText("Barstow", Array.from({ length: 68 }, (_, i) => String(i + 2)))).toBe("Barstow has room on the dial. Any channel from 2 to 69 is open.");
    expect(openChannelsText("High Desert", undefined)).toBe("The High Desert has room on the dial.");
  });
  it("gives regions a 'the', not cities", () => {
    expect(placeName("High Desert")).toBe("the High Desert");
    expect(placeName("Inland Empire")).toBe("the Inland Empire");
    expect(placeName("Los Angeles")).toBe("Los Angeles");
  });
});

describe("miles between two points", () => {
  it("is as the crow flies", () => {
    const ie = { lat: 34.0556, lng: -117.1825 };
    const hd = { lat: 34.5362, lng: -117.2928 };
    expect(Math.round(milesApart(ie, hd))).toBeGreaterThan(30);
    expect(Math.round(milesApart(ie, hd))).toBeLessThan(40);
    expect(milesApart(ie, ie)).toBe(0);
  });
});

describe("wording", () => {
  const now = new Date("2026-09-27T03:42:00Z"); // Saturday 8:42 pm, Pacific
  it("names the day of an airing coming up", () => {
    expect(dayLabel("2026-09-27T04:00:00Z", now, TZ)).toBe("Tonight");
    expect(dayLabel("2026-09-27T20:00:00Z", now, TZ)).toBe("Tomorrow"); // Sunday 1:00 pm
    expect(dayLabel("2026-09-29T01:00:00Z", now, TZ)).toBe("Monday"); // Monday 6:00 pm
    expect(dayLabel("2026-10-01T02:00:00Z", now, TZ)).toBe("Wednesday");
    expect(dayLabel("2026-10-06T02:00:00Z", now, TZ)).toBe("Mon, Oct 5");
    expect(dayLabel("2026-09-27T01:00:00Z", new Date("2026-09-26T16:00:00Z"), TZ)).toBe("Tonight");
    expect(dayLabel("2026-09-26T18:00:00Z", new Date("2026-09-26T16:00:00Z"), TZ)).toBe("Today");
  });
  it("says where a widely carried program is on", () => {
    const beat = { id: "beat", callSign: "BEAT", channel: "12.1" };
    const nite = { id: "nite", callSign: "NITE", channel: "88.3" };
    expect(carriedWhere({ station: beat, airing: airing(), onNow: true }, "reel", TZ)).toEqual({ live: false, text: "On BEAT 12.1 now" });
    expect(carriedWhere({ station: nite, airing: airing({ endsAt: "2026-09-27T13:00:00Z" }), onNow: true }, "nite", TZ)).toEqual({ live: false, text: "On NITE until 6:00 am" });
    expect(carriedWhere({ station: nite, airing: airing({ live: true }), onNow: true }, "nite", TZ)).toEqual({ live: true, text: "Live on NITE now" });
    expect(carriedWhere({ station: beat, airing: airing({ startsAt: "2026-09-27T06:30:00Z" }), onNow: false }, "civc", TZ)).toEqual({ live: false, text: "Next on BEAT at 11:30 pm" });
    expect(carriedWhere(null, "x", TZ)).toBeNull();
  });
  it("says a listed airing comes from the city's stream", () => {
    expect(upStationLine({ callSign: "RDLS", channel: "9.1" }, true)).toBe("RDLS 9.1, listed from the city’s stream");
    expect(upStationLine({ callSign: "BEAT", channel: "12.1" }, false)).toBe("BEAT 12.1");
  });
  it("writes a radio row's second line without doubling Live", () => {
    expect(radioDetail({ live: false, episodeTitle: "The Hollow Door, part 2", note: null })).toEqual({ live: false, text: "Now: The Hollow Door, part 2" });
    expect(radioDetail({ live: true, episodeTitle: null, note: "Live from Riverside" })).toEqual({ live: true, text: "from Riverside" });
    expect(radioDetail({ live: false, episodeTitle: null, note: "All night" })).toEqual({ live: false, text: "All night" });
    expect(radioDetail({ live: true, episodeTitle: null, note: null })).toEqual({ live: true, text: null });
    expect(radioDetail(null)).toEqual({ live: false, text: null });
  });
});
