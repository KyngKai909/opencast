import { describe, expect, it } from "vitest";
import { dateRangeTag, HLS_CLASS, parseDateRanges } from "@opencast/contracts";
import { CODE_SECONDS, mergeRanges, onScreenAt, signOffIn } from "./timeline";

// A playlist's tags, written the way the worker writes them (the contract's dateRangeTag) and read
// the way the player reads them (parseDateRanges).
const T0 = Date.parse("2026-09-27T03:30:00Z");
const s = (seconds: number) => T0 + seconds * 1000;
const tags = (...lines: string[]) => parseDateRanges(["#EXTM3U", `#EXT-X-PROGRAM-DATE-TIME:${new Date(T0).toISOString()}`, ...lines].join("\n"));

const program = dateRangeTag({ id: "item-1", class: HLS_CLASS.item, start: s(0), durationSeconds: 40, attributes: { logEntryId: "le-1", code: "PGM", contentId: "bafy-program", title: "Saturday Reel", carriedFrom: "REEL" } });
const bug = dateRangeTag({ id: "bug-1", class: HLS_CLASS.bug, start: s(0), durationSeconds: 40, attributes: { mode: "call_sign_and_channel", callSign: "BEAT", channel: "12.1", position: "bottom_right", opacity: 78 } });
const brk = dateRangeTag({ id: "break-1", class: HLS_CLASS.break, start: s(40), durationSeconds: 20, scte35Out: "0xFC302000", scte35In: "0xFC302001", attributes: { breakId: "br-1" } });
const spot = dateRangeTag({ id: "item-2", class: HLS_CLASS.item, start: s(40), durationSeconds: 16, attributes: { code: "SPT", contentId: "bafy-spot", title: "Fall at Orange Street" } });
const code = dateRangeTag({ id: "code-1", class: HLS_CLASS.code, start: s(46), durationSeconds: 10, attributes: { spotId: "spot-1", code: "ORANGE10", offer: "10% off", qrUrl: "https://useopencast.org/c/ORANGE10" } });
const sid = dateRangeTag({ id: "item-3", class: HLS_CLASS.item, start: s(56), durationSeconds: 4, attributes: { code: "SID", contentId: "bafy-sid", title: "Station ID" } });

describe("what's on screen, from the playlist's DATERANGE tags", () => {
  const all = tags(program, bug, brk, spot, code, sid);

  it("times each graphic by the picture's program date-time, not the device clock", () => {
    expect(onScreenAt(all, s(10))).toMatchObject({ item: { id: "item-1", code: "PGM", title: "Saturday Reel", carriedFrom: "REEL" }, bug: { id: "bug-1" }, inBreak: null, code: null });
    // The program's bug ends with it: the break has none.
    expect(onScreenAt(all, s(39.9)).bug?.id).toBe("bug-1");
    expect(onScreenAt(all, s(40)).bug).toBeNull();
    expect(onScreenAt(all, s(40))).toMatchObject({ item: { id: "item-2", code: "SPT" }, inBreak: { id: "break-1", breakId: "br-1", scte35Out: "0xFC302000", scte35In: "0xFC302001" } });
    expect(onScreenAt(all, s(57)).item?.code).toBe("SID");
    expect(onScreenAt(all, s(60))).toMatchObject({ item: null, inBreak: null });
    // No program date-time (a stream without the tag), nothing is drawn.
    expect(onScreenAt(all, null).bug).toBeNull();
  });

  it("gives the bug's attributes as the tag says: call sign and channel, corner, opacity", () => {
    expect(onScreenAt(all, s(5)).bug).toEqual({ id: "bug-1", mode: "call_sign_and_channel", callSign: "BEAT", channel: "12.1", logoUrl: null, position: "bottom_right", opacity: 78 });
    const logo = tags(dateRangeTag({ id: "bug-2", class: HLS_CLASS.bug, start: s(0), durationSeconds: 60, attributes: { mode: "logo", logoUrl: "https://cdn.example/sazn.svg", position: "top_left", opacity: 100 } }));
    expect(onScreenAt(logo, s(1)).bug).toMatchObject({ mode: "logo", logoUrl: "https://cdn.example/sazn.svg", callSign: null, position: "top_left", opacity: 100 });
  });

  it("shows a spot's code and QR for its last seconds only", () => {
    expect(onScreenAt(all, s(45.9)).code).toBeNull();
    expect(onScreenAt(all, s(46)).code).toEqual({ id: "code-1", spotId: "spot-1", code: "ORANGE10", offer: "10% off", qrUrl: "https://useopencast.org/c/ORANGE10", until: s(56) });
    expect(onScreenAt(all, s(55.9)).code?.code).toBe("ORANGE10");
    expect(onScreenAt(all, s(56)).code).toBeNull();
    // A code tag without an end shows for the default ten seconds.
    const open = tags(dateRangeTag({ id: "code-2", class: HLS_CLASS.code, start: s(100), attributes: { spotId: "spot-2", code: "TAMAL5", offer: "$5 off", qrUrl: "https://useopencast.org/c/TAMAL5" } }));
    expect(CODE_SECONDS).toBe(10);
    expect(onScreenAt(open, s(109.9)).code?.until).toBe(s(110));
    expect(onScreenAt(open, s(110)).code).toBeNull();
  });

  it("draws a lower third over a live block for its span", () => {
    const live = tags(
      dateRangeTag({ id: "live-1", class: HLS_CLASS.live, start: s(0), durationSeconds: 3600, attributes: { logEntryId: "le-9", sourceId: "src-a" } }),
      dateRangeTag({ id: "l3-1", class: HLS_CLASS.lowerThird, start: s(2), durationSeconds: 16, attributes: { name: "Dana Whitfield", title: "Chair, Planning Commission" } }),
      dateRangeTag({ id: "l3-2", class: HLS_CLASS.lowerThird, start: s(22), durationSeconds: 12, attributes: { name: "Marcus Bell", title: null } })
    );
    expect(onScreenAt(live, s(1))).toMatchObject({ live: { logEntryId: "le-9", sourceId: "src-a" }, lowerThird: null });
    expect(onScreenAt(live, s(2)).lowerThird).toEqual({ id: "l3-1", name: "Dana Whitfield", title: "Chair, Planning Commission" });
    expect(onScreenAt(live, s(18)).lowerThird).toBeNull();
    expect(onScreenAt(live, s(30)).lowerThird).toEqual({ id: "l3-2", name: "Marcus Bell", title: null });
  });

  it("ignores a tag whose attributes don't match the contract", () => {
    const bad = tags(dateRangeTag({ id: "bug-x", class: HLS_CLASS.bug, start: s(0), durationSeconds: 60, attributes: { mode: "sparkles", position: "middle", opacity: 250 } }));
    expect(onScreenAt(bad, s(1)).bug).toBeNull();
  });

  it("a range without an end runs until the next of its class", () => {
    const r = tags(
      dateRangeTag({ id: "a", class: HLS_CLASS.item, start: s(0), attributes: { code: "PGM", contentId: "c1", title: "One" } }),
      dateRangeTag({ id: "b", class: HLS_CLASS.item, start: s(30), attributes: { code: "PGM", contentId: "c2", title: "Two" } })
    );
    expect(onScreenAt(r, s(29)).item?.title).toBe("One");
    expect(onScreenAt(r, s(31)).item?.title).toBe("Two");
  });
});

describe("keeping the tags across playlist reloads", () => {
  it("merges a tag repeated with the same ID (the break's SCTE35-IN arrives later) and forgets old ones", () => {
    const out = tags(dateRangeTag({ id: "break-1", class: HLS_CLASS.break, start: s(40), scte35Out: "0xOUT", attributes: { breakId: "br-1" } }));
    const inTag = tags(dateRangeTag({ id: "break-1", class: HLS_CLASS.break, start: s(40), durationSeconds: 20, scte35In: "0xIN", attributes: { breakId: "br-1" } }));
    let known = mergeRanges(new Map(), out, s(41));
    known = mergeRanges(known, inTag, s(45));
    expect(known.get("break-1")).toMatchObject({ scte35Out: "0xOUT", scte35In: "0xIN", end: s(60) });
    // Ended more than five minutes before the picture: gone.
    known = mergeRanges(known, [], s(60 + 5 * 60 + 1));
    expect(known.size).toBe(0);
  });
});

describe("the planned sign-off", () => {
  it("reads when the station is back", () => {
    const r = tags(dateRangeTag({ id: "off-1", class: HLS_CLASS.signOff, start: s(0), durationSeconds: 6, attributes: { backAt: "2026-09-27T13:00:00.000Z" } }));
    expect(signOffIn(r)).toEqual({ id: "off-1", backAt: "2026-09-27T13:00:00.000Z" });
    expect(signOffIn(tags(program))).toBeNull();
  });
});
