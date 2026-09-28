import { describe, expect, it } from "vitest";
import { inChannelOrder, neighbour, neighbours } from "./dial";
import { readEntry, typeKey } from "./numberEntry";
import { station } from "./test-helpers";

const CIVC = station("CIVC", "7.1");
const RDLS = station("RDLS", "9.1", { kind: "embed" });
const BEAT = station("BEAT", "12.1");
const SAZN = station("SAZN", "18.1");
const NITE = station("NITE", "88.3", { band: "radio" });
const CRAT = station("CRAT", "101.9", { band: "radio" });
const dial = [SAZN, NITE, BEAT, CRAT, CIVC, RDLS];

describe("the dial", () => {
  it("is in channel order, the same every time", () => {
    expect(inChannelOrder(dial).map((c) => c.station.channel)).toEqual(["7.1", "9.1", "12.1", "18.1", "88.3", "101.9"]);
  });
  it("moves up and down within the band, wrapping at the ends", () => {
    expect(neighbour(dial, BEAT.station.id, "up")?.station.callSign).toBe("SAZN");
    expect(neighbour(dial, BEAT.station.id, "down")?.station.callSign).toBe("RDLS");
    expect(neighbour(dial, SAZN.station.id, "up")?.station.callSign).toBe("CIVC");
    expect(neighbour(dial, NITE.station.id, "up")?.station.callSign).toBe("CRAT");
    expect(neighbour(dial, CRAT.station.id, "up")?.station.callSign).toBe("NITE");
  });
  it("can skip listed city streams (TV and Cast)", () => {
    expect(neighbour(dial, BEAT.station.id, "down", { skipListed: true })?.station.callSign).toBe("CIVC");
  });
  it("names both neighbours for warming", () => {
    expect(neighbours(dial, CIVC.station.id, { skipListed: true }).map((c) => c.station.callSign)).toEqual(["SAZN", "BEAT"]);
  });
});

describe("number entry", () => {
  it("fills in .1 and finds the station: 1, 2 is 12.1", () => {
    const e = readEntry("12", dial);
    expect(e.shown).toEqual({ typed: "12", filled: ".1" });
    expect(e.match?.station.callSign).toBe("BEAT");
  });
  it("reads radio frequencies from digits: 8, 8, 3 is 88.3", () => {
    expect(readEntry("883", dial).match?.station.callSign).toBe("NITE");
    expect(readEntry("1019", dial).match?.station.callSign).toBe("CRAT");
  });
  it("says when there's no station and names the nearest two", () => {
    const e = readEntry("13", dial);
    expect(e.match).toBeNull();
    expect(e.nearest.map((c) => c.station.channel)).toEqual(["9.1", "12.1"]);
  });
  it("takes one dot, and at most five keys", () => {
    expect(typeKey("12", ".")).toBe("12.");
    expect(typeKey("12.", ".")).toBeNull();
    expect(typeKey("", ".")).toBeNull();
    expect(typeKey("10199", 1)).toBeNull();
  });
});
