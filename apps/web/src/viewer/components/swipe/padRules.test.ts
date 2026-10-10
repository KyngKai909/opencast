// The Tune pad's numbers (swipe home 04, 08): 18 is TV 18.1, 18.2 a subchannel, 90.7 radio; 2 to 69
// and 88.1 to 107.9; a number with no station names the nearest on its band.

import { describe, expect, it } from "vitest";
import type { DialRowX } from "../../api/ext";
import { padChannel, padKey, padLines, readPad } from "./padRules";

let n = 0;
function row(callSign: string, channel: string, band: "tv" | "radio" = "tv", title = `${callSign} tonight`): DialRowX {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  return {
    station: { id, kind: "station", callSign, handle: callSign.toLowerCase(), name: `${callSign} station`, colour: "#8C3B7A", band, channel, marketSlug: "inland-empire", homeCity: "Redlands" },
    onAir: true,
    now: { logEntryId: null, title, episodeTitle: null, code: "PGM", kind: "program", startsAt: "2026-09-27T03:30:00Z", endsAt: "2026-09-27T04:00:00Z", live: false, carriedFrom: null, programId: null },
    next: null,
    playback: { kind: "hls", url: `/mock-hls/${callSign.toLowerCase()}/master.m3u8` }
  } as DialRowX;
}

const CIVC = row("CIVC", "7.1");
const SAZN = row("SAZN", "18.1", "tv", "Tamales for forty");
const SAZ2 = row("SAZN", "18.2");
const LUPE = row("LUPE", "33.1");
const NITE = row("NITE", "88.4", "radio");
const HALL = row("HALL", "90.7", "radio", "Hall Sessions");
const CRAT = row("CRAT", "102.0", "radio");
const dial = [CIVC, SAZN, SAZ2, LUPE, NITE, HALL, CRAT];
const NOW = new Date("2026-09-27T03:42:00Z");

describe("what a number means", () => {
  it("18 is TV 18.1: a whole number means .1", () => {
    expect(padChannel("18")).toEqual({ band: "tv", channel: "18.1" });
    const r = readPad("18", dial);
    expect(r.kind === "match" && r.row).toBe(SAZN);
  });

  it("18.2 is the subchannel", () => {
    const r = readPad("18.2", dial);
    expect(r.kind === "match" && r.row).toBe(SAZ2);
  });

  it("90.7 is radio, and no band switch is needed", () => {
    const r = readPad("90.7", dial);
    expect(r).toMatchObject({ kind: "match", band: "radio" });
    expect(r.kind === "match" && r.row).toBe(HALL);
  });

  it("reads a frequency's digits without the point, as the remote's keypad does (884 is 88.4), and a whole frequency (102 is 102.0)", () => {
    expect(readPad("884", dial)).toMatchObject({ kind: "match", row: NITE });
    expect(readPad("102", dial)).toMatchObject({ kind: "match", row: CRAT });
  });

  it("2 to 69 is TV and 88.1 to 107.9 radio; anything else is out of range", () => {
    expect(padChannel("2")).toEqual({ band: "tv", channel: "2.1" });
    expect(padChannel("69.3")).toEqual({ band: "tv", channel: "69.3" });
    expect(padChannel("88.1")).toEqual({ band: "radio", channel: "88.1" });
    expect(padChannel("107.9")).toEqual({ band: "radio", channel: "107.9" });
    for (const t of ["70", "75", "87.9", "108", "108.1", "0", "120.5"]) expect(padChannel(t), t).toBeNull();
    expect(readPad("75", dial)).toEqual({ kind: "out_of_range", typed: "75" });
  });

  it("a digit on the way to a channel isn't an error yet (1 on the way to 12, 88 on the way to 88.4)", () => {
    expect(readPad("1", dial)).toEqual({ kind: "partial", typed: "1" });
    expect(readPad("88", dial).kind).not.toBe("out_of_range");
  });
});

describe("a number with no station", () => {
  it("says so and names the nearest on its band", () => {
    const r = readPad("45", dial);
    expect(r).toMatchObject({ kind: "none", band: "tv", channel: "45.1", nearest: LUPE });
    expect(padLines(r, NOW)).toEqual({ lead: "No station on 45.1", rest: "Nearest is LUPE 33.1.", none: true });
  });

  it("on the radio band, the nearest frequency", () => {
    expect(readPad("99.1", dial)).toMatchObject({ kind: "none", band: "radio", nearest: CRAT });
    expect(readPad("89.9", dial)).toMatchObject({ kind: "none", band: "radio", nearest: HALL });
  });
});

describe("the pad's lines", () => {
  it("name the station and what's on, with the time left", () => {
    expect(padLines(readPad("18", dial), NOW)).toEqual({ lead: "SAZN 18.1", rest: "Now: Tamales for forty, 18 min left", none: false });
    expect(padLines(readPad("90.7", dial), NOW).rest).toBe("Radio band. Now: Hall Sessions, 18 min left");
  });

  it("before a number, say how it works; out of range, say what the bands are", () => {
    expect(padLines(readPad("", dial), NOW).rest).toBe("Type a channel or frequency. It tunes 2 seconds after you stop, or press Tune.");
    expect(padLines(readPad("75", dial), NOW)).toEqual({ lead: "No channel 75", rest: "TV runs 2 to 69, radio 88.1 to 107.9.", none: true });
  });
});

describe("the keys", () => {
  it("take digits and one point, five at most, and delete the last", () => {
    expect(padKey("1", 8)).toBe("18");
    expect(padKey("18", ".")).toBe("18.");
    expect(padKey("18.", ".")).toBe("18.");
    expect(padKey("", ".")).toBe("");
    expect(padKey("107.9", 1)).toBe("107.9");
    expect(padKey("18.2", "del")).toBe("18.");
  });
});
