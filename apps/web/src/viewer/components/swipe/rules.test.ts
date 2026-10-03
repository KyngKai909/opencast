// The swipe home's smaller rules (swipe home 01, 03, 08): the position line, the detent's words,
// Back to live (when it shows, where, and how far behind), where the home opens, presets' order.

import { describe, expect, it } from "vitest";
import { backToLivePlace, behindMs, behindText, boundaryText, placeText, presetIdsInOrder, startStation } from "./rules";

describe("the position line", () => {
  it('says "Preset 2 of 3" or "Dial, 4 of 5", and "Band" on the radio band', () => {
    expect(placeText({ kind: "preset", n: 2, of: 3 }, "tv")).toBe("Preset 2 of 3");
    expect(placeText({ kind: "dial", n: 4, of: 5 }, "tv")).toBe("Dial, 4 of 5");
    expect(placeText({ kind: "dial", n: 1, of: 4 }, "radio")).toBe("Band, 1 of 4");
    expect(placeText(null, "tv")).toBeNull();
  });
});

describe("the detent's words", () => {
  const o = { presets: 3, total: 8, band: "tv" as const };
  it("are the reference's", () => {
    expect(boundaryText("presets_end", o)).toEqual({ title: "End of your presets", sub: "The dial, in channel order" });
    expect(boundaryText("presets_start", o)).toEqual({ title: "Back to your presets", sub: "Preset 3" });
    expect(boundaryText("wrap_end", o)).toEqual({ title: "End of the dial", sub: "Back to preset 1" });
    expect(boundaryText("wrap_start", o)).toEqual({ title: "Start of your presets", sub: "To the end of the dial" });
  });
  it("with no presets, are about the dial alone", () => {
    expect(boundaryText("wrap_end", { presets: 0, total: 5, band: "tv" })).toEqual({ title: "End of the dial", sub: "Back to the start" });
    expect(boundaryText("wrap_start", { presets: 0, total: 4, band: "radio" })).toEqual({ title: "Start of the band", sub: "To the end of the band" });
  });
});

describe("Back to live", () => {
  const at = { behindLive: false, status: "playing" as const, pendingId: null };
  it("isn't there at the live edge", () => {
    expect(backToLivePlace(at, true)).toBeNull();
    expect(backToLivePlace(at, false)).toBeNull();
  });
  it("shows while paused, just above the banner (which is up while paused)", () => {
    expect(backToLivePlace({ ...at, status: "paused", behindLive: true }, true)).toBe("above_banner");
  });
  it("stays while playing on behind live, and drops to just above the floating bar once the banner hides", () => {
    expect(backToLivePlace({ ...at, behindLive: true }, true)).toBe("above_banner");
    expect(backToLivePlace({ ...at, behindLive: true }, false)).toBe("above_bar");
  });
  it("goes when the channel changes (a new station joins live)", () => {
    expect(backToLivePlace({ ...at, behindLive: true, pendingId: "x" }, false)).toBeNull();
    expect(backToLivePlace({ ...at, behindLive: true, status: "tuning" }, false)).toBeNull();
  });
  it("counts how far behind in minutes and seconds, adding up each pause", () => {
    expect(behindMs({ before: 0, pausedSince: 1_000, now: 49_000 })).toBe(48_000);
    expect(behindMs({ before: 48_000, pausedSince: null, now: 99_000 })).toBe(48_000);
    expect(behindMs({ before: 48_000, pausedSince: 100_000, now: 186_000 })).toBe(134_000);
    expect(behindText(48_000)).toBe("0:48 behind");
    expect(behindText(134_000)).toBe("2:14 behind");
    expect(behindText(3_725_000)).toBe("1:02:05 behind");
  });
});

describe("where the home opens", () => {
  const tv = ["beat", "sazn", "civc", "rdls"];
  const radio = ["nite", "hall"];
  it("stays on what's already playing", () => {
    expect(startStation({ playingId: "civc", startOn: "dial", lastId: "hall", tv, radio })).toBe("civc");
  });
  it("opens on the last channel with Start on: Last channel", () => {
    expect(startStation({ playingId: null, startOn: "last_channel", lastId: "hall", tv, radio })).toBe("hall");
  });
  it("otherwise at the start of the order: preset 1, or the dial's first", () => {
    expect(startStation({ playingId: null, startOn: "dial", lastId: "hall", tv, radio })).toBe("beat");
    expect(startStation({ playingId: null, startOn: "last_channel", lastId: "gone", tv, radio })).toBe("beat");
    expect(startStation({ playingId: null, startOn: undefined, lastId: null, tv: [], radio })).toBe("nite");
    expect(startStation({ playingId: null, startOn: undefined, lastId: null, tv: [], radio: [] })).toBeNull();
  });
});

describe("presets' order", () => {
  it("is keys 1 to 6, then More presets as they're kept", () => {
    const p = (id: string, key: number | null, position: number) => ({ key, position, station: { id } });
    expect(presetIdsInOrder([p("c", 3, 0), p("m2", null, 5), p("a", 1, 9), p("m1", null, 2), p("b", 2, 1)])).toEqual(["a", "b", "c", "m1", "m2"]);
  });
});
