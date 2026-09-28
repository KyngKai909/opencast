import { describe, expect, it } from "vitest";
import { addPreset, lowestFreeKey, moveKey, normalise, placePreset, removePresetFrom, replaceOutcome, slots, type KeyedPreset } from "./presetRules";

const six: KeyedPreset[] = [
  { stationId: "BEAT", key: 1 },
  { stationId: "CIVC", key: 2 },
  { stationId: "NITE", key: 3 },
  { stationId: "REEL", key: 4 },
  { stationId: "CRAT", key: 5 },
  { stationId: "HALL", key: 6 },
  { stationId: "SAZN", key: null },
  { stationId: "VOZE", key: null }
];
const show = (l: KeyedPreset[]) => l.map((p) => `${p.stationId}:${p.key ?? "-"}`).join(" ");

describe("the lowest free key", () => {
  it("is 1 with nothing saved", () => expect(lowestFreeKey([])).toBe(1));
  it("fills a gap before going past it", () => expect(lowestFreeKey([{ stationId: "A", key: 1 }, { stationId: "B", key: 3 }])).toBe(2));
  it("is null when all six are taken, whatever is in More presets", () => expect(lowestFreeKey(six)).toBeNull());
  it("ignores More presets", () => expect(lowestFreeKey([{ stationId: "A", key: null }])).toBe(1));
});

describe("saving a preset", () => {
  it("takes the lowest free key", () => {
    expect(show(addPreset([{ stationId: "A", key: 2 }], "B")!)).toBe("B:1 A:2");
  });
  it("asks (returns null) when all six are taken", () => expect(addPreset(six, "PREP")).toBeNull());
  it("does nothing for a station that's already a preset", () => expect(show(addPreset(six, "NITE")!)).toBe(show(six)));
});

describe("replacing a key never deletes", () => {
  it("moves the replaced station to the top of More presets", () => {
    const next = placePreset(six, "PREP", 6);
    expect(show(next)).toBe("BEAT:1 CIVC:2 NITE:3 REEL:4 CRAT:5 PREP:6 HALL:- SAZN:- VOZE:-");
    expect(next).toHaveLength(six.length + 1);
  });
  it("says who moves", () => expect(replaceOutcome(six, 3)).toEqual({ key: 3, stationId: "NITE" }));
  it("with no key, saves to the end of More presets", () => {
    expect(show(placePreset(six, "PREP", null))).toBe("BEAT:1 CIVC:2 NITE:3 REEL:4 CRAT:5 HALL:6 SAZN:- VOZE:- PREP:-");
  });
  it("gives a More preset a key, moving the key's station down", () => {
    expect(show(placePreset(six, "SAZN", 1))).toBe("SAZN:1 CIVC:2 NITE:3 REEL:4 CRAT:5 HALL:6 BEAT:- VOZE:-");
  });
  it("moves a keyed station to another key", () => {
    expect(show(placePreset(six, "BEAT", 4))).toBe("CIVC:2 NITE:3 BEAT:4 CRAT:5 HALL:6 REEL:- SAZN:- VOZE:-");
  });
  it("removing is its own action", () => expect(show(removePresetFrom(six, "NITE"))).toBe("BEAT:1 CIVC:2 REEL:4 CRAT:5 HALL:6 SAZN:- VOZE:-"));
});

describe("reordering the six keys", () => {
  it("drags a station to another key, shifting the ones between", () => {
    expect(show(moveKey(six, 6, 1))).toBe("HALL:1 BEAT:2 CIVC:3 NITE:4 REEL:5 CRAT:6 SAZN:- VOZE:-");
    expect(show(moveKey(six, 1, 2))).toBe("CIVC:1 BEAT:2 NITE:3 REEL:4 CRAT:5 HALL:6 SAZN:- VOZE:-");
  });
  it("moves empty keys along too", () => {
    const three: KeyedPreset[] = [{ stationId: "A", key: 1 }, { stationId: "B", key: 4 }];
    expect(slots(moveKey(three, 4, 2))).toEqual(["A", "B", null, null, null, null]);
    expect(slots(moveKey(three, 1, 6))).toEqual([null, null, "B", null, null, "A"]);
  });
  it("leaves More presets alone and ignores a move to the same key or off the six", () => {
    expect(moveKey(six, 3, 3)).toEqual(six);
    expect(moveKey(six, 6, 7)).toEqual(six);
  });
  it("normalises keys first in key order", () => {
    expect(show(normalise([{ stationId: "M", key: null }, { stationId: "B", key: 2 }, { stationId: "A", key: 1 }]))).toBe("A:1 B:2 M:-");
  });
});
