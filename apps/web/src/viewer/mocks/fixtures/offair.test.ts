// Planned off air in the viewer's mocks (G9): the off air airing, the dial row, and a sign-off
// matched to the mock stream's (`?signoff=prep`).

import { describe, expect, it } from "vitest";
import { Airing } from "@opencast/contracts";
import { DialRowX } from "../../api/ext";
import { rowOf } from "../view";
import { toAiring, type MockAiring } from "./schedule";
import { applySignOff, signOffAsked } from "./signoff";
import { stationByRef } from "./stations";

const prep = stationByRef("PREP")!;
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 27, h, m)).toISOString();
const mock = (o: Partial<MockAiring>): MockAiring => ({ id: "00000000-0000-4000-8000-000000000001", stationId: prep.ident.id, title: "Football", start: at(2), end: at(5), programId: null, ...o });

describe("planned off air in the mocks (G9)", () => {
  it("is one Off air airing, code OPEN, back at its end", () => {
    const a = Airing.parse(toAiring(mock({ title: "anything", offAir: true, start: at(6), end: at(13) })));
    expect(a).toMatchObject({ title: "Off air", code: "OPEN", kind: "off_air", live: false, programId: null, backAt: at(13), endsAt: at(13) });
  });

  it("puts the station off the air on the dial, with no playback and its backAt", () => {
    const off = DialRowX.parse(rowOf(prep, { now: mock({ offAir: true, start: at(6), end: at(13) }), next: mock({ start: at(13), end: at(14) }) }));
    expect(off).toMatchObject({ onAir: false, playback: null, backAt: at(13), now: { kind: "off_air" } });
    const on = DialRowX.parse(rowOf(prep, { now: mock({}), next: null }));
    expect(on.onAir).toBe(true);
    expect(on.playback).not.toBeNull();
    expect("backAt" in on).toBe(false);
  });

  it("cuts into the program on at the sign-off, which resumes when it's back", () => {
    const list = [mock({ id: "a", start: at(2), end: at(5) }), mock({ id: "b", start: at(5), end: at(6) })];
    applySignOff(list, prep.ident.id, at(3), at(3, 30));
    const shape = list.sort((x, y) => x.start.localeCompare(y.start)).map((x) => [x.offAir ? "off" : x.title, x.start, x.end]);
    expect(shape).toEqual([
      ["Football", at(2), at(3)],
      ["off", at(3), at(3, 30)],
      ["Football", at(3, 30), at(5)],
      ["Football", at(5), at(6)]
    ]);
  });

  it("reads the address's switch as the stream server does", () => {
    expect(signOffAsked("?signoff=prep")).toBe("prep");
    expect(signOffAsked("?signoff=1")).toBe("prep");
    expect(signOffAsked("?signoff=off")).toBeNull();
    expect(signOffAsked("?clock=2026-09-27T07:00:00Z")).toBeNull();
  });
});
