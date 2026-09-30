// Shared call signs (A229) in the TV's mock world, at the frames' moment (Saturday, 8:42 pm): the
// owner's own BEAT 12.1 and BEAT 12.2, and an external county's RIVC 15.1, 15.2 and 15.3, on the
// dial, the guide, the swipe order and search in channel order, each found by its own address;
// `ocMock.externalDown`/`externalUp` take a call sign, an address or an id.

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
  watching: typeof import("./handlers/watching");
  stations: typeof import("./fixtures/stations");
  guide: typeof import("../components/guide/guideLogic");
  ref: typeof import("../lib/stationRef");
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
    watching: await import("./handlers/watching"),
    stations: await import("./fixtures/stations"),
    guide: await import("../components/guide/guideLogic"),
    ref: await import("../lib/stationRef")
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
const labels = (rows: Array<{ station: Parameters<Mods["ref"]["callSignLabel"]>[0] }>) => rows.map((r) => m.ref.callSignLabel(r.station));
const channels = (rows: Array<{ station: { channel: string | null } }>) => rows.map((r) => r.station.channel);

describe("call-sign families in the TV's mock world", () => {
  it("gives every station a slug, the family's members their own, and no two the same slug or handle", () => {
    const all = m.stations.STATIONS.map((s) => s.ident);
    expect(all.every((s) => !!s.slug)).toBe(true);
    expect(new Set(all.map((s) => s.slug)).size).toBe(all.length);
    const handles = all.map((s) => s.handle).filter(Boolean);
    expect(new Set(handles).size).toBe(handles.length);
    const family = all.filter((s) => s.sharesCallSign).map((s) => [s.callSign, s.channel, s.slug, s.handle]);
    expect(family).toEqual([
      ["BEAT", "12.1", "beat", "beat"],
      ["BEAT", "12.2", "beat-12-2", null],
      ["RIVC", "15.1", "rivc", "rivc"],
      ["RIVC", "15.2", "rivc-15-2", null],
      ["RIVC", "15.3", "rivc-15-3", null]
    ]);
    // A station that shares nothing says nothing about it.
    expect(all.find((s) => s.callSign === "CIVC")).not.toHaveProperty("sharesCallSign");
  });

  it("puts the families on the dial in channel order, each told apart by its channel", async () => {
    const rows = (await dial()).rows;
    expect(channels(rows)).toEqual(["7.1", "9.1", "9.2", "9.7", "12.1", "12.2", "15.1", "15.2", "15.3", "18.1", "24.1", "31.1"]);
    expect(labels(rows).slice(4, 9)).toEqual(["BEAT 12.1", "BEAT 12.2", "RIVC 15.1", "RIVC 15.2", "RIVC 15.3"]);
    expect(labels(rows)[0]).toBe("CIVC");
    const byChannel = (c: string) => rows.find((r) => r.station.channel === c)!;
    expect(byChannel("12.2")).toMatchObject({ onAir: true, station: { name: "Beat Tapes", kind: "station", colour: "#8C3B7A" }, now: { title: "Beat Tapes: side A" }, playback: { kind: "hls", url: "/mock-hls/tape/master.m3u8" } });
    expect(byChannel("15.1")).toMatchObject({ onAir: true, now: null, station: { name: "Riverside County, Board of Supervisors", kind: "listed", colour: "#355C7D", homeCity: "Riverside" }, playback: { url: "/mock-hls/rivc/master.m3u8" }, external: { source: "Riverside County", plays: "stream_link", schedule: "none" } });
    expect(byChannel("15.2")).toMatchObject({ station: { name: "Riverside County, Public Works" }, playback: { url: "/mock-hls/rvpw/master.m3u8" } });
    expect(byChannel("15.3")).toMatchObject({ station: { name: "Riverside County Library Live" }, playback: { url: "/mock-hls/rvlb/master.m3u8" } });
  });

  it("swipes through each family member in turn", async () => {
    const rows = (await dial()).rows;
    const beat = rows.find((r) => r.station.slug === "beat")!;
    const order: string[] = [];
    let at = beat;
    for (let i = 0; i < 5; i++) {
      at = neighbour(rows, at.station.id, "up")!;
      order.push(m.ref.callSignLabel(at.station));
    }
    expect(order).toEqual(["BEAT 12.2", "RIVC 15.1", "RIVC 15.2", "RIVC 15.3", "SAZN"]);
  });

  it("lists the families in the guide in channel order", async () => {
    const g = await guide();
    const model = m.guide.buildModel(g.rows, [], Date.parse(FROM), Date.parse(TO));
    expect(model.rows.map((r) => m.guide.identText(r.station)).slice(4, 9)).toEqual(["BEAT 12.1", "BEAT 12.2", "RIVC 15.1", "RIVC 15.2", "RIVC 15.3"]);
    const tapes = model.rows.find((r) => r.station.slug === "beat-12-2")!;
    expect(tapes.cells[0]?.airing?.title).toBe("Beat Tapes: side A");
  });

  it("answers the station page by call sign (X.1), address, call sign and channel, or id", () => {
    const name = (ref: string) => m.station.stationPage(ref)?.station.name ?? null;
    expect(name("rivc")).toBe("Riverside County, Board of Supervisors");
    expect(name("RIVC")).toBe("Riverside County, Board of Supervisors");
    expect(name("rivc-15-2")).toBe("Riverside County, Public Works");
    expect(name("RIVC-15-3")).toBe("Riverside County Library Live");
    expect(name("beat")).toBe("Inland Beat");
    expect(name("BEAT")).toBe("Inland Beat");
    expect(name("beat-12-2")).toBe("Beat Tapes");
    expect(name("beat-12-1")).toBe("Inland Beat");
    expect(name(m.stations.uid(152))).toBe("Riverside County, Public Works");
    expect(name("colt")).toBe("City of Colton");
    expect(name("rivc-15-4")).toBeNull();
  });

  it("keeps a family's X.1 page its own, and gives the member its own programs", () => {
    const tapes = m.station.stationPage("beat-12-2")!;
    expect(StationPageFull.safeParse(tapes).success).toBe(true);
    expect(tapes.programs.map((p) => p.title)).toEqual(["Beat Tapes"]);
    expect(tapes.carries).toEqual([]);
    const beat = m.station.stationPage("beat")!;
    expect(beat.programs.map((p) => p.title)).not.toContain("Beat Tapes");
    expect(beat.carries.length).toBeGreaterThan(0);
  });

  it("finds a family in search, in channel order, and tunes to a member by its channel", () => {
    const found = m.search.searchResults("rivc", "inland-empire");
    expect(found.stations.map((s) => s.channel)).toEqual(["15.1", "15.2", "15.3"]);
    expect(m.search.searchResults("rivc-15-2", "inland-empire").stations.map((s) => s.channel)).toEqual(["15.2"]);
    expect(m.search.searchResults("15.2", "inland-empire").tuneTo).toMatchObject({ callSign: "RIVC", channel: "15.2", slug: "rivc-15-2" });
  });

  it("signs off or stands by one family member at a time from the address's switches", async () => {
    const rows = (await dial()).rows;
    const t = new Date();
    const beat = rows.find((r) => r.station.slug === "beat")!;
    const tapes = rows.find((r) => r.station.slug === "beat-12-2")!;
    expect(m.watching.patchRow(beat, t, { offAir: ["BEAT"], standby: [] }).onAir).toBe(false);
    expect(m.watching.patchRow(tapes, t, { offAir: ["BEAT"], standby: [] }).onAir).toBe(true);
    expect(m.watching.patchRow(tapes, t, { offAir: ["BEAT-12-2"], standby: [] }).onAir).toBe(false);
    expect(m.watching.patchRow(tapes, t, { offAir: [], standby: ["BEAT-12-2"] }).signal).toBe("standby");
  });
});

describe("ocMock's external stream switches, with a family", () => {
  it("put a member down by its address, leaving the rest of the family on the dial, and back up", async () => {
    m.external.externalDown("rivc-15-2", 5);
    expect(channels((await dial()).rows)).toEqual(expect.arrayContaining(["15.1", "15.3"]));
    expect(channels((await dial()).rows)).not.toContain("15.2");
    expect(channels((await guide()).rows)).not.toContain("15.2");
    expect(m.station.stationPage("rivc-15-2")).toMatchObject({ onAir: false, external: { down: true } });
    expect(m.station.stationPage("rivc")).toMatchObject({ onAir: true, external: { down: false } });
    m.external.externalUp("rivc-15-2");
    expect(channels((await dial()).rows)).toContain("15.2");
  });

  it("take the bare call sign as X.1, and an id, in any case", async () => {
    m.external.externalDown("RIVC", 5);
    expect(channels((await dial()).rows).filter((c) => c?.startsWith("15."))).toEqual(["15.2", "15.3"]);
    m.external.externalUp("rivc");
    m.external.externalDown(m.stations.uid(153), 5);
    expect(channels((await dial()).rows).filter((c) => c?.startsWith("15."))).toEqual(["15.1", "15.2"]);
    m.external.externalUp(m.stations.uid(153));
    expect(channels((await dial()).rows).filter((c) => c?.startsWith("15."))).toEqual(["15.1", "15.2", "15.3"]);
  });

  it("still take the call signs they took before, and refuse a station that isn't external", async () => {
    m.external.externalDown("COLT", 5);
    expect(channels((await dial()).rows)).not.toContain("9.2");
    m.external.externalUp("COLT");
    expect(channels((await dial()).rows)).toContain("9.2");
    expect(() => m.external.externalDown("beat-12-2")).toThrow("beat-12-2 isn't an external station");
  });
});
