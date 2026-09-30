// External stations in the viewer's mock (follow-up Phase 6), at the frames' moment (Saturday,
// 8:42 pm): an official embed and a stream link on the dial with their schedules; a stream down
// stays on the dial for 5 minutes, then leaves the dial, the guide, search and the swipe order,
// and comes back when it's up. And how the dial, the guide and the tuned-in page word them.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { neighbour } from "@opencast/player";
import { DialRowX } from "../api/ext";
import { StationPageFull } from "../api/ext/station";

type Mods = {
  external: typeof import("./external");
  view: typeof import("./view");
  fixtures: typeof import("./fixtures/stations");
  station: typeof import("./handlers/station");
  search: typeof import("./handlers/search");
  dial: typeof import("../components/home/MarketDial");
  guide: typeof import("../components/guide/logic");
};
let m: Mods;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-27T03:42:00Z"));
  localStorage.clear();
  m = {
    external: await import("./external"),
    view: await import("./view"),
    fixtures: await import("./fixtures/stations"),
    station: await import("./handlers/station"),
    search: await import("./handlers/search"),
    dial: await import("../components/home/MarketDial"),
    guide: await import("../components/guide/logic")
  };
});
afterEach(() => localStorage.removeItem("oc-mock-external-down"));
afterAll(() => vi.useRealTimers());

const rowsOnDial = () =>
  m.fixtures
    .inMarket("inland-empire", "tv")
    .filter((s) => !m.external.hiddenExternal(s.ident.id))
    .map((s) => m.view.dialRow(s));
const callSigns = (rows: Array<{ station: { callSign: string | null } }>) => rows.map((r) => r.station.callSign);

describe("external stations on the mock dial", () => {
  it("play an official embed and a stream link, each with the source's own schedule", () => {
    const rows = rowsOnDial();
    const rdls = rows.find((r) => r.station.callSign === "RDLS")!;
    const colt = rows.find((r) => r.station.callSign === "COLT")!;
    expect(DialRowX.safeParse(colt).success).toBe(true);
    expect(rdls).toMatchObject({ onAir: true, playback: { kind: "embed" }, external: { source: "City of Redlands", plays: "embed" }, now: { title: "City Council, Sept 16 meeting", kind: "listed" } });
    expect(colt).toMatchObject({ onAir: true, playback: { kind: "hls", url: "/mock-hls/colt/master.m3u8" }, external: { source: "City of Colton", plays: "stream_link" }, now: { title: "City Council, regular meeting", kind: "listed", live: true } });
  });

  it("keep a stream that's down for its first 5 minutes, then take it off the dial, the guide, search and the swipe order until it's back", () => {
    m.external.externalDown("COLT");
    expect(callSigns(rowsOnDial())).toContain("COLT");
    m.external.externalDown("COLT", 5);
    const rows = rowsOnDial();
    expect(callSigns(rows)).not.toContain("COLT");
    // The swipe order: down from BEAT is LOMA 9.7 (the DASH stream link), then RDLS, skipping COLT.
    const beat = rows.find((r) => r.station.callSign === "BEAT")!;
    const loma = neighbour(rows, beat.station.id, "down")!;
    expect(loma.station.callSign).toBe("LOMA");
    expect(neighbour(rows, loma.station.id, "down")?.station.callSign).toBe("RDLS");
    expect(m.search.searchResults("council", "inland-empire").airings.map((a) => a.station.callSign)).not.toContain("COLT");
    expect(m.search.searchResults("9.2", "inland-empire").tuneTo).toBeNull();
    const page = m.station.stationPage("colt")!;
    expect(StationPageFull.safeParse(page).success).toBe(true);
    expect(page).toMatchObject({ onAir: false, playback: null, external: { source: "City of Colton", down: true } });
    m.external.externalUp("COLT");
    expect(callSigns(rowsOnDial())).toContain("COLT");
  });

  it("play a DASH stream link in Opencast's player while the rule says played (A201), and hold it off the dial otherwise", () => {
    const loma = rowsOnDial().find((r) => r.station.callSign === "LOMA")!;
    expect(DialRowX.safeParse(loma).success).toBe(true);
    expect(loma).toMatchObject({ onAir: true, now: null, playback: { kind: "hls", format: "dash", url: "/mock-dash/loma/manifest.mpd" }, external: { plays: "stream_link", schedule: "none" } });
    m.external.setDashPlayed(false);
    expect(callSigns(rowsOnDial())).not.toContain("LOMA");
    m.external.setDashPlayed(true);
    expect(callSigns(rowsOnDial())).toContain("LOMA");
  });
});

describe("how the viewer words an external station", () => {
  it("with nothing scheduled: its name, Live, External and the source on the dial", () => {
    const colt = { ...rowsOnDial().find((r) => r.station.callSign === "COLT")!, now: null };
    expect(m.dial.dialNow(colt)).toEqual({ title: "City of Colton", live: true, listed: true, detail: "From City of Colton's own stream" });
  });

  it("in the guide: the External tag on its row, and Live with nothing listed when there's nothing in the window", () => {
    const station = m.view.identX(m.fixtures.stationByRef("COLT")!);
    const rows = m.guide.gridRows({ market: { id: "m", slug: "inland-empire", name: "Inland Empire", timezone: "America/Los_Angeles", open: true }, from: "2026-09-28T03:00:00.000Z", to: "2026-09-28T06:00:00.000Z", rows: [{ station, airings: [] }] });
    expect(rows[0]).toMatchObject({ callSign: "COLT", external: true, programs: [{ title: "City of Colton", listed: true, start: "2026-09-28T03:00:00.000Z", end: "2026-09-28T06:00:00.000Z" }] });
  });

  it("fills the gaps around what the source lists, never shorter than 15 minutes", () => {
    const meeting = { ...m.view.dialRow(m.fixtures.stationByRef("COLT")!).now!, startsAt: "2026-09-27T03:10:00.000Z", endsAt: "2026-09-27T04:30:00.000Z" };
    const filled = m.guide.withNothingListed([meeting], "City of Colton", "2026-09-27T03:00:00.000Z", "2026-09-27T06:00:00.000Z");
    expect(filled.map((a) => [a.title, a.startsAt, a.endsAt])).toEqual([
      ["City Council, regular meeting", "2026-09-27T03:10:00.000Z", "2026-09-27T04:30:00.000Z"],
      ["City of Colton", "2026-09-27T04:30:00.000Z", "2026-09-27T06:00:00.000Z"]
    ]);
  });
});
