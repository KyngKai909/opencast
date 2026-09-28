// The station page, program page and search mocks at the frames' moment (Saturday, 8:42 pm).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { StationPageFull, ProgramPageX, SearchFull } from "../../api/ext/station";

type Mods = { station: typeof import("./station"); search: typeof import("./search"); fixtures: typeof import("../fixtures/station"); schedule: typeof import("../fixtures/schedule") };
let m: Mods;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-27T03:42:00Z"));
  localStorage.removeItem("oc-mock-db");
  m = { station: await import("./station"), search: await import("./search"), fixtures: await import("../fixtures/station"), schedule: await import("../fixtures/schedule") };
});
afterAll(() => vi.useRealTimers());

const IE = "inland-empire";

describe("the station page mock", () => {
  it("draws BEAT as the frame does, and matches the contract", () => {
    const page = m.station.stationPage("beat")!;
    expect(StationPageFull.safeParse(page).success).toBe(true);
    expect(page.now?.title).toBe("Saturday Reel");
    expect(page.upNext[0]?.title).toBe("Beat Tape Live");
    expect(page.members).toBe(214);
    expect(page.onDialSince).toBe("2026-09-05");
    expect(page.carries.map((c) => `${c.from.channel} ${c.program.title}, ${c.slot}`)).toEqual(["24.1 Saturday Reel, Saturdays 8:30 pm", "90.7 Slow Hours, nightly 11:00 pm"]);
    expect(page.madeHere).toEqual([{ program: expect.objectContaining({ title: "Late Crate" }), carriers: 2 }]);
    expect(page.madePossibleBy.map((c) => c.text)).toEqual(["Members of Inland Beat", "Redlands Hardware", "Orange Street Coffee"]);
  });

  it("has the rest of the week, without overlapping tonight", () => {
    const page = m.station.stationPage("beat", "2026-09-26T13:00:00Z", "2026-10-04T13:00:00Z")!;
    const sunday = page.schedule.filter((a) => a.startsAt >= "2026-09-27T13:00:00Z" && a.startsAt < "2026-09-28T13:00:00Z");
    expect(sunday.length).toBeGreaterThan(3);
    const sorted = [...page.schedule].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    sorted.slice(1).forEach((a, i) => expect(a.startsAt >= sorted[i]!.endsAt).toBe(true));
  });

  it("gives a listed city stream no carriage, no members and no credits", () => {
    const page = m.station.stationPage("rdls")!;
    expect(page.station.kind).toBe("listed");
    expect(page.carries).toEqual([]);
    expect(page.madeHere).toEqual([]);
    expect(page.members).toBeUndefined();
    expect(page.madePossibleBy).toEqual([]);
  });

  it("says who a claimable station is run for", () => {
    expect(m.station.stationPage("crat")!.claimable?.runFor).toBe("Marcus Reyes");
    expect(m.station.stationPage("nope")).toBeNull();
  });
});

describe("the program page mock", () => {
  it("draws Saturday Reel as the frame does", () => {
    const id = m.fixtures.programByKey("saturday-reel")!.id;
    const page = m.station.programPage(id, IE)!;
    expect(ProgramPageX.safeParse(page).success).toBe(true);
    expect(page.station.callSign).toBe("REEL");
    expect(page.whereToWatch.map((w) => [w.station.callSign, !!w.now])).toEqual([
      ["BEAT", true],
      ["REEL", true],
      ["SAZN", false]
    ]);
    expect(page.whereToWatch[2]!.next?.startsAt).toBe("2026-09-27T16:00:00.000Z"); // Sunday, 9:00 am.
    expect(page.carriers).toMatchObject({ total: 12, outsideMarket: 9 });
    expect(page.airedCount).toBe(14);
    const ep = (n: number) => page.episodes.find((e) => e.episodeNumber === n)!;
    expect(ep(14).onNow?.station.callSign).toBe("BEAT");
    expect(ep(15).nextAiring?.station.callSign).toBe("SAZN");
    expect(ep(16).nextAiring?.airing.startsAt).toBe("2026-10-04T03:00:00.000Z");
    expect(ep(17).nextAiring).toBeNull();
  });
});

describe("the search mock", () => {
  it("orders town hall airing next first, and finds the station by what it is", () => {
    const r = m.search.searchResults("town hall", IE);
    expect(SearchFull.safeParse(r).success).toBe(true);
    expect(r.tuneTo).toBeNull();
    expect(r.airings.map((a) => a.program?.title)).toEqual(["Town Hall", "Co-op town hall", "Colton town hall"]);
    expect(r.airings[2]!.listed).toBe(true);
    expect(r.airings[2]!.airing.listedAiringId).toBeTruthy();
    expect(r.stations.map((s) => [s.callSign, s.description])).toEqual([["CIVC", "Public affairs. Town halls and council meetings"]]);
  });

  it("tunes a number, and finds programs only by a name that starts with it", () => {
    const r = m.search.searchResults("24", IE);
    expect(r.tuneTo?.callSign).toBe("REEL");
    expect(r.stations.map((s) => s.callSign)).toEqual(["REEL"]);
    expect(r.airings.map((a) => a.airing.title)).toEqual(["24 hours at the fair"]);
    expect(m.search.searchResults("883", IE).tuneTo?.callSign).toBe("NITE");
    expect(m.search.searchResults("13", IE).tuneTo).toBeNull();
  });

  it("adds a reminded airing from the week to the shared schedule, and only then", () => {
    const colton = m.search.searchResults("colton", IE).airings[0]!.airing.listedAiringId!;
    expect(m.schedule.AIRINGS.some((a) => a.id === colton)).toBe(false);
    m.fixtures.registerReminded([colton]);
    expect(m.schedule.airingById(colton)?.title).toBe("Colton town hall, district 3");
  });
});
