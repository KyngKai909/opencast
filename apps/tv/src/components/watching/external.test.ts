// External stations on the TV (follow-up Phase 6): a stream link plays as a picture, nothing
// scheduled isn't off air, a stream that's down is Stand by (never "Off air"), and what the
// presets, the options and the station page say about them.

import { describe, expect, it } from "vitest";
import type { DialRowX } from "../../api/ext";
import { tuneDetail } from "../guide/optionsLogic";
import { externalDownLine, externalOf, externalStandbyLine, externalStreamLine, isExternalStation } from "./external";
import { airState, canSuggest, suggestion, type Row } from "./offAir";
import { nowLine } from "./presetStrip";

function row(callSign: string, channel: string, o: Partial<DialRowX> & { kind?: DialRowX["station"]["kind"] } = {}): Row & DialRowX {
  const { kind = "station", ...rest } = o;
  return {
    station: { id: callSign, kind, callSign, handle: callSign.toLowerCase(), name: `${callSign} name`, colour: null, band: "tv", channel, marketSlug: "inland-empire", homeCity: null },
    onAir: true,
    now: { logEntryId: null, title: `${callSign} now`, episodeTitle: null, code: "PGM", kind: "program", startsAt: "2026-09-27T03:00:00Z", endsAt: "2026-09-27T04:00:00Z", live: false, carriedFrom: null, programId: null },
    next: null,
    playback: { kind: "hls", url: `/x/${callSign}.m3u8` },
    ...rest
  } as Row & DialRowX;
}

const COLTON = { source: "City of Colton", plays: "stream_link" as const, schedule: "feed" as const };
// COLT 9.2 with nothing scheduled: on, its stream link played in Opencast's player.
const colt = row("COLT", "9.2", { kind: "listed", now: null, playback: { kind: "hls", url: "/mock-hls/colt/master.m3u8" }, external: COLTON, signal: "ok" });
// The player's copy once COLT left the dial while it was on (PlayerEngine.setChannels).
const coltDown = { ...colt, onAir: false, playback: null };
const rdls = row("RDLS", "9.1", { kind: "listed", playback: { kind: "embed", url: "/mock-embed/rdls.html" }, external: { source: "City of Redlands", plays: "embed", schedule: "feed" } });

describe("which screen shows for an external station", () => {
  it("plays a stream link as a picture, and an official embed as the source's player", () => {
    expect(airState(colt, "playing")).toBeNull();
    expect(airState(colt, "tuning")).toBeNull();
    expect(airState(rdls, "embed")).toBeNull();
  });

  it("isn't off air with nothing scheduled", () => {
    expect(airState({ ...colt, now: null }, "playing")).toBeNull();
  });

  it("stands by, never off air, when its stream is down", () => {
    expect(airState(coltDown, "standby")).toBe("standby");
    // Whatever the player says, a row that isn't playable is Stand by.
    expect(airState(coltDown, "playing")).toBe("standby");
    expect(airState(coltDown, "off_air")).toBe("standby");
    // The player's own Stand by (no picture in 8 s) while it's still on the dial.
    expect(airState(colt, "standby")).toBe("standby");
  });

  it("leaves other stations as they were: off air is off air", () => {
    const civc = row("CIVC", "7.1");
    expect(airState({ ...civc, onAir: false, playback: null }, "playing")).toBe("off_air");
    expect(airState(civc, "playing")).toBeNull();
  });

  it("still offers only Opencast's own stations from a Stand by (the decided rule)", () => {
    const beat = row("BEAT", "12.1");
    expect(canSuggest(colt)).toBe(false);
    expect(suggestion([row("CIVC", "7.1"), rdls, coltDown, beat], "COLT")?.station.callSign).toBe("BEAT");
  });
});

describe("what's known about an external station", () => {
  it("comes from the station page first (with down), then the dial row", () => {
    expect(isExternalStation(colt.station)).toBe(true);
    expect(isExternalStation(row("BEAT", "12.1").station)).toBe(false);
    expect(externalOf(colt)).toEqual({ ...COLTON, down: false });
    expect(externalOf(coltDown)).toEqual({ ...COLTON, down: true });
    expect(externalOf(undefined, { station: colt.station, external: { ...COLTON, down: true } })).toEqual({ ...COLTON, down: true });
    expect(externalOf(row("BEAT", "12.1"))).toBeNull();
  });

  it("says whose stream it is, and when it's down", () => {
    expect(externalStreamLine(COLTON)).toBe("City of Colton's own stream. No Opencast playout, spots or breaks.");
    expect(externalDownLine(COLTON)).toBe("City of Colton's stream is down. It's off the dial until it's back.");
    expect(externalStandbyLine(COLTON)).toBe("City of Colton's stream is down. Stand by.");
  });

  it("is Live from the source on a preset key and under Tune to, with nothing scheduled", () => {
    expect(nowLine(colt)).toEqual({ live: true, text: "from City of Colton" });
    expect(nowLine({ ...colt, now: row("X", "1").now })).toEqual({ live: false, text: "X now" });
    expect(tuneDetail(null, true, "City of Colton")).toBe("Live from City of Colton");
    expect(tuneDetail("City Council, regular meeting", true, "City of Colton")).toBe("City Council, regular meeting is on");
    expect(tuneDetail(null, false, "City of Colton")).toBe("Stand by");
  });
});
