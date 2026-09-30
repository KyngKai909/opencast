import { describe, expect, it } from "vitest";
import type { StationIdent } from "@opencast/contracts";
import type { AiringX } from "../api/ext";
import { cellLine, identText as guideIdent, type Cell } from "../components/guide/guideLogic";
import { identText as offAirIdent } from "../components/watching/offAir";
import { byRef, pledgePath, pledgeRoute } from "../components/watching/pledge";
import { callSignLabel, findByRef, parseStationSlug, refersTo, stationAddress } from "./stationRef";

// Shared call signs (A229): 15.1, 15.2 and 15.3 are all RIVC; 12.1 and 12.2 are both BEAT.
function ident(id: string, callSign: string, channel: string, name: string, o: Partial<StationIdent> = {}): StationIdent {
  return { id, kind: "station", callSign, handle: callSign.toLowerCase(), name, colour: null, band: "tv", channel, marketSlug: "inland-empire", homeCity: null, slug: callSign.toLowerCase(), ...o };
}
const civc = ident("id-civc", "CIVC", "7.1", "Inland Civic");
const beat = ident("id-beat", "BEAT", "12.1", "Inland Beat", { sharesCallSign: true });
const tapes = ident("id-tapes", "BEAT", "12.2", "Beat Tapes", { handle: null, slug: "beat-12-2", sharesCallSign: true });
const rivc = ident("id-rivc", "RIVC", "15.1", "Riverside County, Board of Supervisors", { kind: "listed", handle: null, sharesCallSign: true });
const rvpw = ident("id-rvpw", "RIVC", "15.2", "Riverside County, Public Works", { kind: "listed", handle: null, slug: "rivc-15-2", sharesCallSign: true });
const rvlb = ident("id-rvlb", "RIVC", "15.3", "Riverside County Library Live", { kind: "listed", handle: null, slug: "rivc-15-3", sharesCallSign: true });
const dial = [civc, beat, tapes, rivc, rvpw, rvlb];
const find = (list: StationIdent[], ref: string) => findByRef(list, ref, (s) => s)?.name ?? null;

/** The same idents from an API from before shared call signs: no slug, no sharesCallSign. */
const older = dial.map(({ slug: _slug, sharesCallSign: _shares, ...s }) => s);

describe("finding a station by its ref, with shared call signs", () => {
  it("takes the bare call sign, in any case, as the family's X.1", () => {
    expect(find(dial, "rivc")).toBe(rivc.name);
    expect(find(dial, "RIVC")).toBe(rivc.name);
    expect(find(dial, "beat")).toBe("Inland Beat");
    // Wherever X.1 sits in the list.
    expect(find([rvlb, rvpw, rivc], "rivc")).toBe(rivc.name);
  });

  it("takes a family member's address, and a call sign with any channel", () => {
    expect(find(dial, "rivc-15-2")).toBe(rvpw.name);
    expect(find(dial, "RIVC-15-3")).toBe(rvlb.name);
    expect(find(dial, "beat-12-2")).toBe("Beat Tapes");
    expect(find(dial, "beat-12-1")).toBe("Inland Beat");
    expect(find(dial, "civc-7-1")).toBe("Inland Civic");
    expect(find(dial, "rivc-15-4")).toBeNull();
  });

  it("keeps every old form working: the id, the call sign, the handle", () => {
    expect(find(dial, "id-rvpw")).toBe(rvpw.name);
    expect(find(dial, "id-tapes")).toBe("Beat Tapes");
    expect(find(dial, "CIVC")).toBe("Inland Civic");
    expect(find(dial, "civc")).toBe("Inland Civic");
    expect(find([{ ...civc, slug: undefined, callSign: null, handle: "inland-civic" }], "inland-civic")).toBe("Inland Civic");
    expect(find(dial, "nope")).toBeNull();
    expect(find(dial, "")).toBeNull();
  });

  it("works on idents from an older API, which has no slugs", () => {
    expect(find(older, "rivc")).toBe(rivc.name);
    expect(find([...older].reverse(), "RIVC")).toBe(rivc.name);
    expect(find(older, "rivc-15-2")).toBe(rvpw.name);
    expect(find(older, "beat")).toBe("Inland Beat");
    expect(find(older, "id-rvlb")).toBe(rvlb.name);
  });

  it("says whether a ref names one station, on its ident alone", () => {
    expect(refersTo("BEAT", beat)).toBe(true);
    expect(refersTo("BEAT", tapes)).toBe(false);
    expect(refersTo("beat-12-2", tapes)).toBe(true);
    expect(refersTo("id-tapes", tapes)).toBe(true);
    expect(refersTo("RIVC", rvpw)).toBe(false);
    expect(refersTo("rivc", rivc)).toBe(true);
    expect(refersTo("CIVC", civc)).toBe(true);
    expect(refersTo("REEL", civc)).toBe(false);
  });

  it("parses addresses as the domain does", () => {
    expect(parseStationSlug("rivc-15-2")).toEqual({ callSign: "RIVC", channel: "15.2" });
    expect(parseStationSlug("RIVC")).toEqual({ callSign: "RIVC", channel: null });
    expect(parseStationSlug("00000000-0000-4000-8000-000000000012")).toBeNull();
  });
});

describe("naming a station in addresses", () => {
  it("uses its slug first", () => {
    expect(stationAddress(rivc)).toBe("rivc");
    expect(stationAddress(rvpw)).toBe("rivc-15-2");
    expect(stationAddress(tapes)).toBe("beat-12-2");
    expect(stationAddress(civc)).toBe("civc");
  });

  it("from an older API: a family member's call sign and channel, else the handle, else the call sign, else the id", () => {
    expect(stationAddress({ ...rvpw, slug: undefined })).toBe("rivc-15-2");
    expect(stationAddress({ ...rivc, slug: undefined })).toBe("rivc");
    expect(stationAddress({ ...civc, slug: undefined, handle: "civic" })).toBe("civic");
    expect(stationAddress({ ...civc, slug: undefined, handle: null })).toBe("civc");
    expect(stationAddress({ ...civc, slug: undefined, handle: null, callSign: null })).toBe("id-civc");
  });

  it("puts a family member's own address on its pledge page and route, and finds it on the dial", () => {
    expect(pledgePath(tapes)).toBe("/beat-12-2/pledge");
    expect(pledgeRoute(tapes)).toBe("/pledge/beat-12-2");
    expect(pledgePath(beat)).toBe("/beat/pledge");
    const rows = dial.map((station) => ({ station }));
    expect(byRef(rows, "beat-12-2")?.station.name).toBe("Beat Tapes");
    expect(byRef(rows, "BEAT")?.station.name).toBe("Inland Beat");
    expect(byRef(rows, "id-rvpw")?.station.name).toBe(rvpw.name);
    // Not on the dial (a call sign the station has since changed from, say): the panel asks the API.
    expect(byRef(rows, "OLDB")).toBeNull();
  });
});

describe("telling a family's streams apart where only a call sign shows", () => {
  it("adds the channel to a shared call sign", () => {
    expect(callSignLabel(rvpw)).toBe("RIVC 15.2");
    expect(callSignLabel(rivc)).toBe("RIVC 15.1");
    expect(callSignLabel(tapes)).toBe("BEAT 12.2");
    expect(callSignLabel(civc)).toBe("CIVC");
    expect(callSignLabel({ ...civc, callSign: null })).toBe("Inland Civic");
    // An older API says nothing about sharing: the call sign alone, as before.
    expect(callSignLabel({ ...rvpw, sharesCallSign: undefined })).toBe("RIVC");
  });

  it("names the station a program is carried from with its channel when it shares its call sign", () => {
    const airing = (carriedFrom: StationIdent): Cell => {
      const a = { logEntryId: "x", title: "Beat Tapes", episodeTitle: null, code: "PGM", kind: "program", startsAt: "2026-09-27T05:00:00Z", endsAt: "2026-09-27T06:00:00Z", live: false, carriedFrom, programId: null } as AiringX;
      return { key: "k", stationId: "id-civc", start: Date.parse(a.startsAt), end: Date.parse(a.endsAt), airing: a, signOnAt: null };
    };
    const before = Date.parse("2026-09-27T03:42:00Z");
    expect(cellLine(airing(tapes), before).text).toBe("From BEAT 12.2");
    expect(cellLine(airing(civc), before).text).toBe("From CIVC");
  });

  it("already joins call sign and channel in the guide's and off air's idents", () => {
    expect(guideIdent(rvpw)).toBe("RIVC 15.2");
    expect(guideIdent(rvlb)).toBe("RIVC 15.3");
    expect(offAirIdent(tapes)).toBe("BEAT 12.2");
  });
});
