import { describe, expect, it } from "vitest";
import { callSignState, readColour } from "./StationForm";
import { openGaps } from "./LogPage";

const T = (hhmm: string) => `2026-09-27T${hhmm}:00.000Z`;

describe("the call sign field", () => {
  it("reads free, taken and not three to five capitals", () => {
    expect(callSignState("", null, undefined)).toBe("empty");
    expect(callSignState("BE", null, undefined)).toBe("invalid");
    expect(callSignState("BEAT", null, { valid: true, available: false })).toBe("taken");
    expect(callSignState("TAPE", null, { valid: true, available: true })).toBe("free");
    expect(callSignState("TAPE", null, undefined)).toBe("checking");
  });
  it("counts the station's own call sign as free", () => {
    expect(callSignState("BEAT", "BEAT", { valid: true, available: false })).toBe("free");
  });
});

describe("the colour field", () => {
  it("reads #rrggbb with or without the #", () => {
    expect(readColour("8c3b7a")).toBe("#8C3B7A");
    expect(readColour("#1F5E8C ")).toBe("#1F5E8C");
    expect(readColour("#12345")).toBeNull();
  });
});

describe("the log's open gaps", () => {
  it("starts a gap no earlier than now, and follows it past the window's edge", () => {
    const deadAir = [{ startsAt: T("06:40"), endsAt: T("13:00") }];
    expect(openGaps([{ startsAt: T("06:40"), endsAt: T("09:00") }], deadAir, T("09:00"), Date.parse("2026-09-27T06:30:30.000Z"))).toEqual([{ key: T("06:40"), startsAt: T("06:40"), endsAt: T("13:00") }]);
    expect(openGaps([{ startsAt: T("06:40"), endsAt: T("09:00") }], [], T("10:00"), Date.parse("2026-09-27T07:00:30.000Z"))).toEqual([{ key: T("06:40"), startsAt: T("07:01"), endsAt: T("09:00") }]);
  });

  it("offers times on 4-second segment boundaries, as the API answers them", () => {
    const S = (hms: string) => `2026-09-27T${hms}.000Z`;
    expect(openGaps([{ startsAt: S("06:40:30"), endsAt: S("08:59:59") }], [], T("10:00"), Date.parse(T("03:42")))).toEqual([{ key: S("06:40:30"), startsAt: S("06:40:32"), endsAt: T("09:00") }]);
  });
});
