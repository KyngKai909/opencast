// The swipe's order (swipe home 08): presets in preset order, then the rest of the band in channel
// order skipping presets, wrapping to preset 1; no presets is the dial alone; radio by frequency.

import { describe, expect, it } from "vitest";
import { boundaryFrom, orderIds, orderPlace, preloadIds, stepId, swipeOrder } from "./order";
import { station } from "./test-helpers";

const CIVC = station("CIVC", "7.1");
const CITY = station("CITY", "9.1");
const BEAT = station("BEAT", "12.1");
const SAZN = station("SAZN", "18.1");
const REEL = station("REEL", "24.1");
const PREP = station("PREP", "31.1");
const NITE = station("NITE", "88.4", { band: "radio" });
const HALL = station("HALL", "90.8", { band: "radio" });
const CRAT = station("CRAT", "102.0", { band: "radio" });
const VOZE = station("VOZE", "104.4", { band: "radio" });
const all = [REEL, NITE, CIVC, VOZE, PREP, BEAT, HALL, CITY, CRAT, SAZN];
const id = (c: typeof CIVC) => c.station.id;
const signs = (rows: Array<typeof CIVC>) => rows.map((r) => r.station.callSign);

describe("the swipe's order", () => {
  it("is the presets in preset order, then the rest of the band in channel order, skipping presets", () => {
    const o = swipeOrder(all, [id(BEAT), id(SAZN), id(CIVC)], "tv");
    expect(signs(o.rows)).toEqual(["BEAT", "SAZN", "CIVC", "CITY", "REEL", "PREP"]);
    expect(o.presets).toBe(3);
  });

  it("with no presets is the dial alone, in channel order", () => {
    const o = swipeOrder(all, [], "tv");
    expect(signs(o.rows)).toEqual(["CIVC", "CITY", "BEAT", "SAZN", "REEL", "PREP"]);
    expect(o.presets).toBe(0);
  });

  it("keeps each band to itself: radio presets, then the band by frequency", () => {
    const presets = [id(BEAT), id(CRAT), id(SAZN)];
    expect(signs(swipeOrder(all, presets, "radio").rows)).toEqual(["CRAT", "NITE", "HALL", "VOZE"]);
    expect(swipeOrder(all, presets, "radio").presets).toBe(1);
    expect(signs(swipeOrder(all, presets, "tv").rows)).toEqual(["BEAT", "SAZN", "CIVC", "CITY", "REEL", "PREP"]);
  });

  it("ignores a preset that isn't on the dial, and one listed twice", () => {
    const gone = station("GONE", "40.1");
    const o = swipeOrder(all, [id(gone), id(SAZN), id(SAZN)], "tv");
    expect(signs(o.rows)).toEqual(["SAZN", "CIVC", "CITY", "BEAT", "REEL", "PREP"]);
    expect(o.presets).toBe(1);
  });
});

describe("stepping along it", () => {
  const o = orderIds(swipeOrder(all, [id(BEAT), id(SAZN), id(CIVC)], "tv"));
  const sign = (x: string | null) => all.find((c) => c.station.id === x)?.station.callSign ?? null;

  it("goes from the last preset into the dial, and wraps from the end back to preset 1", () => {
    expect(sign(stepId(o, id(CIVC), "next"))).toBe("CITY");
    expect(sign(stepId(o, id(PREP), "next"))).toBe("BEAT");
    expect(sign(stepId(o, id(BEAT), "prev"))).toBe("PREP");
  });

  it("skips what this device can't play", () => {
    expect(sign(stepId(o, id(CIVC), "next", (x) => x === id(CITY)))).toBe("REEL");
  });

  it("from a station outside the order, starts at either end", () => {
    expect(sign(stepId(o, id(NITE), "next"))).toBe("BEAT");
    expect(sign(stepId(o, id(NITE), "prev"))).toBe("PREP");
  });

  it("has nowhere to go with one station", () => {
    expect(stepId({ ids: [id(BEAT)] }, id(BEAT), "next")).toBeNull();
  });

  it("says where you are", () => {
    expect(orderPlace(o, id(SAZN))).toEqual({ kind: "preset", n: 2, of: 3 });
    expect(orderPlace(o, id(REEL))).toEqual({ kind: "dial", n: 2, of: 3 });
    expect(orderPlace(o, id(NITE))).toBeNull();
  });
});

describe("the detent", () => {
  const o = orderIds(swipeOrder(all, [id(BEAT), id(SAZN), id(CIVC)], "tv"));

  it("is at the end of the presets, both ways, and at the wrap, both ways", () => {
    expect(boundaryFrom(o, id(CIVC), "next")).toBe("presets_end");
    expect(boundaryFrom(o, id(CITY), "prev")).toBe("presets_start");
    expect(boundaryFrom(o, id(PREP), "next")).toBe("wrap_end");
    expect(boundaryFrom(o, id(BEAT), "prev")).toBe("wrap_start");
  });

  it("isn't anywhere else", () => {
    expect(boundaryFrom(o, id(BEAT), "next")).toBeNull();
    expect(boundaryFrom(o, id(CITY), "next")).toBeNull();
    expect(boundaryFrom(o, id(PREP), "prev")).toBeNull();
  });

  it("with no presets, is only the wrap", () => {
    const dial = orderIds(swipeOrder(all, [], "tv"));
    expect(boundaryFrom(dial, id(CIVC), "next")).toBeNull();
    expect(boundaryFrom(dial, id(PREP), "next")).toBe("wrap_end");
    expect(boundaryFrom(dial, id(CIVC), "prev")).toBe("wrap_start");
  });
});

describe("preloading", () => {
  const o = orderIds(swipeOrder(all, [id(BEAT), id(SAZN), id(CIVC)], "tv"));

  it("keeps the next and previous ready, and the first station of the dial while in the presets", () => {
    expect(preloadIds(o, id(BEAT))).toEqual([id(SAZN), id(PREP), id(CITY)]);
    expect(preloadIds(o, id(REEL))).toEqual([id(PREP), id(CITY)]);
  });

  it("doesn't name a station twice (the last preset's next is the dial's first)", () => {
    expect(preloadIds(o, id(CIVC))).toEqual([id(CITY), id(SAZN)]);
  });
});
