// Master control's addresses with shared call signs (A229): 12.1 BEAT Inland Beat keeps
// /control/beat, 12.2 BEAT Beat Tapes is /control/beat-12-2, and every older link keeps working.

import { describe, expect, it } from "vitest";
import type { StationIdent } from "@opencast/contracts";
import { BEAT, HALL, LAB, TAPE } from "../mocks/fixtures/stations";
import { controlSlug, findByStationRef, parseStationSlug, stationLabel, stationPath } from "./slug";

const all = [BEAT, TAPE, HALL, LAB];
const find = (ref: string, list: StationIdent[] = all) => findByStationRef(list, ref, (s) => s)?.name;

describe("a station's control address", () => {
  it("is its slug, the lower-case call sign or handle from an older API", () => {
    expect(controlSlug(BEAT)).toBe("beat");
    expect(controlSlug(TAPE)).toBe("beat-12-2");
    expect(controlSlug(LAB)).toBe("inland-sound-lab");
    const { slug: _, ...older } = HALL;
    expect(controlSlug(older)).toBe("hall");
    expect(controlSlug({ id: "ABC", callSign: null, handle: null })).toBe("abc");
  });

  it("builds paths under the station", () => {
    expect(stationPath(BEAT, "/monitor")).toBe("/control/beat/monitor");
    expect(stationPath(TAPE, "/settings/identity")).toBe("/control/beat-12-2/settings/identity");
    expect(stationPath(TAPE)).toBe("/control/beat-12-2");
  });
});

describe("resolving /control/:ref", () => {
  it("by slug first", () => {
    expect(find("beat-12-2")).toBe("Beat Tapes");
    expect(find("BEAT-12-2")).toBe("Beat Tapes");
    expect(find("beat")).toBe("Inland Beat");
  });

  it("a bare call sign is the station on X.1, whatever the list's order", () => {
    expect(find("beat", [TAPE, BEAT])).toBe("Inland Beat");
    expect(find("BEAT", [TAPE, BEAT])).toBe("Inland Beat");
  });

  it("a call sign with its channel, even for a station that shares nothing", () => {
    expect(find("beat-12-1", [TAPE, BEAT])).toBe("Inland Beat");
    expect(find("beat-12-5")).toBeUndefined();
  });

  it("then a handle or an id", () => {
    expect(find("beat-tapes")).toBe("Beat Tapes");
    expect(find("inland-sound-lab")).toBe("Inland Sound Lab");
    expect(find(TAPE.id)).toBe("Beat Tapes");
    expect(find(TAPE.id.toUpperCase())).toBe("Beat Tapes");
  });

  it("an older API's idents, without slugs, still resolve by call sign", () => {
    const older = all.map(({ slug: _s, sharesCallSign: _c, ...rest }) => rest);
    expect(find("hall", older)).toBe("Study Hall");
    expect(find("beat", older)).toBe("Inland Beat");
  });

  it("a member alone doesn't answer to X.1's bare call sign", () => {
    expect(find("beat", [TAPE])).toBeUndefined();
    expect(find("beat-12-2", [TAPE])).toBe("Beat Tapes");
    expect(find("", all)).toBeUndefined();
  });

  it("parses a slug like the domain does", () => {
    expect(parseStationSlug("beat-12-2")).toEqual({ callSign: "BEAT", tenths: 122 });
    expect(parseStationSlug("Beat")).toEqual({ callSign: "BEAT", tenths: null });
    expect(parseStationSlug("inland-sound-lab")).toBeNull();
  });
});

describe("a station's label, where only its call sign would show", () => {
  it("adds the channel when the call sign is shared", () => {
    expect(stationLabel(BEAT)).toBe("BEAT 12.1");
    expect(stationLabel(TAPE)).toBe("BEAT 12.2");
    expect(stationLabel(TAPE)).not.toBe(stationLabel(BEAT));
  });

  it("is the call sign alone otherwise, and a studio's name", () => {
    expect(stationLabel(HALL)).toBe("HALL");
    expect(stationLabel(LAB)).toBe("Inland Sound Lab");
    expect(stationLabel({ callSign: null })).toBe("");
  });
});
