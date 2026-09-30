import { describe, expect, it } from "vitest";
import { inMarket } from "../../mocks/fixtures/stations";
import { dialRow } from "../../mocks/view";
import type { PresetView } from "../../data/viewer";
import { identText, keypadChannel, keypadEntry, keypadLine, presetStrip, pressKey, rockerNeighbours, tuningIn } from "./logic";

// The Inland Empire dial at the frames' moment.
const NOW = new Date("2026-09-27T03:42:00Z");
const DIAL = inMarket("inland-empire").map((s) => dialRow(s, NOW));
const id = (cs: string) => DIAL.find((r) => r.station.callSign === cs)!.station.id;

describe("the rocker's neighbours", () => {
  it("names the stations up and down the dial from what the TV shows (06.3, 02.2)", () => {
    const civc = rockerNeighbours(DIAL, id("CIVC"));
    expect([identText(civc.up), identText(civc.down)]).toEqual(["9.1 RDLS", "31.1 PREP"]);
    const beat = rockerNeighbours(DIAL, id("BEAT"));
    // A229: BEAT 12.2 (Beat Tapes, sharing BEAT's call sign) is next up the dial.
    expect([identText(beat.up), identText(beat.down)]).toEqual(["12.2 BEAT", "9.7 LOMA"]);
    // Casting to a Chromecast, whose up and down skip DASH stream links (A201).
    expect(identText(rockerNeighbours(DIAL, id("BEAT"), { skipDash: true }).down)).toBe("9.2 COLT");
  });
  it("keeps to the band, as the TV does", () => {
    const nite = rockerNeighbours(DIAL, id("NITE"));
    expect(nite.up?.station.band).toBe("radio");
    expect(nite.down?.station.band).toBe("radio");
  });
  it("has none before the TV says what's on", () => {
    expect(rockerNeighbours(DIAL, null)).toEqual({ up: null, down: null });
  });
});

describe("the keypad", () => {
  const type = (keys: Array<number | ".">) => keys.reduce<string>((t, k) => pressKey(t, k), "");

  it("fills in .1 and names the station with the countdown (06.4)", () => {
    const e = keypadEntry(type([2, 4]), DIAL);
    expect(e?.shown).toEqual({ typed: "24", filled: ".1" });
    expect(keypadChannel(e)).toBe("24.1");
    expect(keypadLine(e, 1)).toEqual({ lead: "REEL", rest: ", Saturday Reel. Tuning in 1 second" });
    expect(keypadLine(e, 2)?.rest).toBe(", Saturday Reel. Tuning in 2 seconds");
    expect(keypadLine(e, 0)?.rest).toBe(", Saturday Reel");
  });
  it("reads radio frequencies: 8, 8, 4 tunes 88.4", () => {
    expect(keypadChannel(keypadEntry(type([8, 8, 4]), DIAL))).toBe("88.4");
  });
  it("says a number with no station, and names the nearest two", () => {
    const e = keypadEntry(type([1, 3]), DIAL);
    expect(keypadChannel(e)).toBeNull();
    expect(keypadLine(e, null)).toEqual({ lead: "No station on 13", rest: ". Nearest: 12.1 BEAT, 12.2 BEAT" });
    // One digit is still being typed: nothing to say yet.
    expect(keypadLine(keypadEntry("5", DIAL), null)).toBeNull();
  });
  it("takes one dot, five keys at most, and back", () => {
    expect(type([1, 2, ".", "."])).toBe("12.");
    expect(type([1, 0, 1, 9, 9, 9])).toBe("10199");
    expect(pressKey("24", "back")).toBe("2");
    expect(pressKey("", ".")).toBe("");
  });
  it("counts in seconds", () => {
    expect(tuningIn(1)).toBe("Tuning in 1 second");
    expect(tuningIn(2)).toBe("Tuning in 2 seconds");
  });
});

describe("the presets strip", () => {
  it("is six keys, filled or empty", () => {
    const station = DIAL[0]!.station;
    const presets: PresetView[] = [
      { key: 2, station, position: 0 },
      { key: null, station, position: 1 }
    ];
    const strip = presetStrip(presets);
    expect(strip.map((k) => k.key)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(strip.map((k) => (k.preset ? k.preset.station.callSign : null))).toEqual([null, station.callSign, null, null, null, null]);
  });
});
