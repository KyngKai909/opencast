// External stations in the TV's mock (follow-up Phase 6), at the frames' moment (Saturday, 8:42
// pm): an official embed and a stream link on the dial with their schedules; a stream down stays on
// the dial for 5 minutes, then leaves the dial (and so the swipe order), the guide and search, and
// its station page says it's down; it comes back when it's up. Through the handlers the TV calls,
// the watching screen's patch of the dial included.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getResponse } from "msw";
import { neighbour } from "@opencast/player";
import { DialX, GuideX } from "../api/ext";
import { StationPageFull } from "../api/ext/station";

type Mods = {
  external: typeof import("./external");
  handlers: typeof import("./handlers");
  station: typeof import("./handlers/station");
  search: typeof import("./handlers/search");
  guide: typeof import("../components/guide/guideLogic");
};
let m: Mods;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-27T03:42:00Z"));
  localStorage.clear();
  m = {
    external: await import("./external"),
    handlers: await import("./handlers"),
    station: await import("./handlers/station"),
    search: await import("./handlers/search"),
    guide: await import("../components/guide/guideLogic")
  };
});
afterEach(() => localStorage.removeItem("oc-mock-external-down"));
afterAll(() => vi.useRealTimers());

async function get(path: string) {
  const res = await getResponse(m.handlers.handlers, new Request(`http://localhost/v1${path}`));
  return res!.json();
}
const dial = async () => DialX.parse(await get("/markets/inland-empire/dial?band=tv"));
const FROM = "2026-09-27T03:30:00.000Z";
const TO = "2026-09-28T03:30:00.000Z";
const guide = async () => GuideX.parse(await get(`/markets/inland-empire/guide?band=tv&from=${FROM}&to=${TO}`));
const callSigns = (rows: Array<{ station: { callSign: string | null } }>) => rows.map((r) => r.station.callSign);

describe("external stations on the TV's mock dial", () => {
  it("play an official embed and a stream link, each with the source's own schedule, in channel order", async () => {
    const rows = (await dial()).rows;
    expect(callSigns(rows).slice(0, 3)).toEqual(["CIVC", "RDLS", "COLT"]);
    expect(rows.find((r) => r.station.callSign === "RDLS")).toMatchObject({ onAir: true, playback: { kind: "embed" }, external: { source: "City of Redlands", plays: "embed" }, now: { kind: "listed" } });
    expect(rows.find((r) => r.station.callSign === "COLT")).toMatchObject({
      onAir: true,
      signal: "ok",
      playback: { kind: "hls", url: "/mock-hls/colt/master.m3u8" },
      external: { source: "City of Colton", plays: "stream_link", schedule: "feed" },
      now: { title: "City Council, regular meeting", kind: "listed", live: true }
    });
  });

  it("stay on the dial for a stream's first 5 minutes down", async () => {
    m.external.externalDown("COLT", 4);
    expect(callSigns((await dial()).rows)).toContain("COLT");
    expect(callSigns((await guide()).rows)).toContain("COLT");
    expect(m.station.stationPage("colt")).toMatchObject({ onAir: true, external: { down: false } });
  });

  it("leave the dial, the swipe order, the guide and search after 5 minutes down, and come back when it's up", async () => {
    m.external.externalDown("COLT", 5);
    const rows = (await dial()).rows;
    expect(callSigns(rows)).not.toContain("COLT");
    // The swipe order: down from BEAT is RDLS again.
    const beat = rows.find((r) => r.station.callSign === "BEAT")!;
    expect(neighbour(rows, beat.station.id, "down")?.station.callSign).toBe("RDLS");
    expect(callSigns((await guide()).rows)).not.toContain("COLT");
    expect(m.search.searchResults("council", "inland-empire").airings.map((a) => a.station.callSign)).not.toContain("COLT");
    expect(m.search.searchResults("9.2", "inland-empire").tuneTo).toBeNull();

    const page = m.station.stationPage("colt")!;
    expect(StationPageFull.safeParse(page).success).toBe(true);
    expect(page).toMatchObject({ onAir: false, playback: null, external: { source: "City of Colton", plays: "stream_link", down: true } });

    m.external.externalUp("COLT");
    expect(callSigns((await dial()).rows)).toContain("COLT");
    expect(callSigns((await guide()).rows)).toContain("COLT");
    expect(m.station.stationPage("colt")).toMatchObject({ onAir: true, playback: { kind: "hls" }, external: { down: false } });
  });

  it("aren't put down by the console unless they're external", () => {
    expect(() => m.external.externalDown("BEAT")).toThrow("BEAT isn't an external station");
  });
});

describe("the TV guide's external rows, from the mock", () => {
  it("has COLT's meeting, then its own stream with nothing listed", async () => {
    const g = await guide();
    const model = m.guide.buildModel(g.rows, [], Date.parse(FROM), Date.parse(TO));
    const colt = model.rows.find((r) => r.station.callSign === "COLT")!;
    expect(m.guide.isExternal(colt.station)).toBe(true);
    expect(colt.cells.slice(0, 2).map((c) => m.guide.cellTitle(c, colt.station))).toEqual(["City Council, regular meeting", "City of Colton"]);
    expect(colt.cells[1]).toMatchObject({ start: Date.parse("2026-09-27T04:30:00.000Z"), nothingListed: true, airing: null });
  });
});
