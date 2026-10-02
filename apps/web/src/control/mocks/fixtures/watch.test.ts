// Watch data in master control's mock (follow-up Phase 1): the Audience page's per-airing numbers
// and Offering your programs across carriers, parsed with the contracts through the handlers.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The frames' moment: Saturday, September 26, 8:42:12 pm in the Inland Empire.
vi.mock("../../../lib/clock", () => ({ now: () => new Date("2026-09-27T03:42:12Z"), STATION_TZ: "America/Los_Angeles", useNow: () => new Date("2026-09-27T03:42:12Z") }));

const { setupServer } = await import("msw/node");
const { AudienceReport, MakerWatchData } = await import("@opencast/contracts");
const { earningsHandlers } = await import("../handlers/earnings");
const { resetDb } = await import("../db");
const { resetEarnings } = await import("./earnings");
const { airingWatchOf, makerWatchData } = await import("./watch");
const { BEAT, HALL, LAB } = await import("./stations");
const { at } = await import("./time");

const server = setupServer(...earningsHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetEarnings();
});

const api = async (path: string, as: string | null) => {
  const r = await fetch(`http://localhost/v1${path}`, { headers: as ? { authorization: `Bearer mock-access-token:${as}@example.com` } : {} });
  return { status: r.status, json: await r.json() };
};
const tonight = (stationId: string, as = "kai") => api(`/stations/${stationId}/audience?from=${at("18:00")}&to=${at("23:00")}`, as);

describe("the Audience page's airings", () => {
  it("BEAT tonight: watch time and a tune-away line per airing, the one on now still counting", async () => {
    const r = AudienceReport.parse((await tonight(BEAT.id)).json);
    const rows = r.byProgram!.map((p) => [p.title, p.watch?.status, p.watch?.timeLabel]);
    expect(rows).toEqual([
      ["Crate Session 02", "shown", "watch_time"],
      ["Late Crate, ep. 14", "shown", "watch_time"],
      ["Saturday Reel", "counting", "watch_time"]
    ]);
    const late = r.byProgram![1];
    expect(late.watch).toMatchObject({ audienceAtStart: expect.any(Number), peakAudience: late.peakTunedIn, stayedToTheEnd: 81, notForMe: 2 });
    expect(late.watch!.tuneAways![0]).toBe(0);
    expect(late.watch!.tuneAways!.length).toBeGreaterThan(20);
    expect(r.byProgram![2].watch).toMatchObject({ watchMinutes: null, tuneAways: null, note: null });
  });

  it("HALL is on the radio band: listening time", async () => {
    const r = AudienceReport.parse((await tonight(HALL.id, "kai")).json);
    expect(r.byProgram!.find((p) => p.watch?.status === "shown")?.watch?.timeLabel).toBe("listening_time");
  });

  it("under the minimum it's \"Not enough viewers yet\" and no numbers", () => {
    expect(airingWatchOf("Crate Talk", [4, 9, 7], { onNow: false, band: "tv", stayed: 50 })).toEqual({
      status: "not_enough_viewers",
      note: "Not enough viewers yet",
      timeLabel: "watch_time",
      watchMinutes: null,
      audienceAtStart: null,
      peakAudience: null,
      audienceAtEnd: null,
      stayedToTheEnd: null,
      tuneAways: null,
      notForMe: null
    });
  });
});

describe("Offering your programs", () => {
  const month = `from=${new Date(Date.parse(at("18:00")) - 30 * 86_400_000).toISOString()}&to=${at("18:00")}`;

  it("BEAT's programs across every station that aired them, added up, never per station", async () => {
    const { status, json } = await api(`/stations/${BEAT.id}/programs/watch-data?${month}`, "kai");
    expect(status).toBe(200);
    const data = MakerWatchData.parse(json);
    const row = (title: string, band: "tv" | "radio") => data.programs.find((p) => p.title === title && p.band === band)!;
    expect(row("Late Crate", "tv")).toMatchObject({ status: "shown", stations: 2, notCounted: { airings: 0 }, timeLabel: "watch_time" });
    expect(row("Late Crate", "radio")).toMatchObject({ status: "shown", stations: 1, timeLabel: "listening_time" });
    expect(row("Late Crate", "tv").totals!.tuneAways).toHaveLength(30);
    // CRAT's one airing on its own is left out; Crate Talk is under the minimum.
    expect(row("Beat Tape Live", "radio")).toMatchObject({ status: "not_enough_viewers", note: "Not enough viewers yet", notCounted: { airings: 1 }, totals: null });
    expect(row("Crate Talk", "tv")).toMatchObject({ status: "not_enough_viewers", totals: null });
    for (const callSign of ["HALL", "SAZN", "CRAT"]) expect(JSON.stringify(json)).not.toContain(callSign);
  });

  it("a studio has makers' numbers too; only its owners and operators see them", async () => {
    const data = MakerWatchData.parse((await api(`/stations/${LAB.id}/programs/watch-data?${month}`, "sam")).json);
    expect(data.programs.map((p) => [p.title, p.band, p.status])).toEqual([
      ["Crate Diggers Radio Hour", "radio", "shown"],
      ["Studio Notes", "tv", "shown"]
    ]);
    expect((await api(`/stations/${LAB.id}/programs/watch-data?${month}`, "kai")).status).toBe(403);
    expect((await api(`/stations/${BEAT.id}/programs/watch-data?${month}`, null)).status).toBe(401);
    expect((await api(`/stations/${BEAT.id}/programs/watch-data?from=2025-01-01T00:00:00.000Z&to=${at("18:00")}`, "kai")).status).toBe(400);
  });

  it("a shorter window has fewer airings", () => {
    const week = makerWatchData(BEAT.id, new Date(Date.parse(at("18:00")) - 7 * 86_400_000).toISOString(), at("18:00"));
    const m = makerWatchData(BEAT.id, new Date(Date.parse(at("18:00")) - 30 * 86_400_000).toISOString(), at("18:00"));
    const airings = (d: typeof week) => d.programs.find((p) => p.title === "Late Crate" && p.band === "tv")!.airings;
    expect(airings(week)).toBeLessThan(airings(m));
  });
});
