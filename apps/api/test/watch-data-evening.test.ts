// The Phase 1 STOP evening (test/watch-evening.ts): a station's evening with the new numbers on its
// Audience page, a maker's view across its carriers, the stored aggregates, and 30 days later only
// numbers that identify nobody. WATCH_DATA_REPORT=1 prints the report (or run
// `npm run demo:watch-data -w @opencast/api`).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createHarness, type Harness } from "./harness.js";
import { EVENING, eveningReport, runEvening, thirtyDaysOn, type Evening } from "./watch-evening.js";

let h: Harness;
let ev: Evening;
let report: Awaited<ReturnType<typeof eveningReport>>;

beforeAll(async () => {
  h = await createHarness();
  ev = await runEvening(h);
  report = await eveningReport(h, ev);
  if (process.env.WATCH_DATA_REPORT) console.log(`\n${report.text}\n`);
}, 300_000);
afterAll(() => h.close());

describe("a Friday evening", () => {
  it("works out every airing on every station, final, its votes gone", () => {
    expect(ev.aggregated).toEqual({ computed: 7, finalized: 7, votesDeleted: 9 });
    expect(ev.votes).toBe(9);
  });

  it("BEAT's Audience page: watch time and tune-aways per airing, Council Watch under the minimum", () => {
    const rows = report.beat.byProgram ?? [];
    const by = (title: string) => rows.find((r) => r.title === title)!;
    for (const title of ["Crate Session", "Night Signal", "Late Crate"]) {
      const w = by(title).watch!;
      expect(w.status, title).toBe("shown");
      expect(w.timeLabel).toBe("watch_time");
      expect(w.peakAudience).toBeGreaterThanOrEqual(20);
      expect(w.tuneAways).toHaveLength(30);
      expect(w.watchMinutes).toBeGreaterThan(0);
    }
    expect(by("Night Signal").source).toBe("carried");
    // Twelve gave Night Signal three minutes: they left in its fourth.
    expect(by("Night Signal").watch!.tuneAways![3]).toBeGreaterThanOrEqual(12);
    expect(by("Night Signal").watch!.notForMe).toBe(5);
    expect(by("Council Watch").watch).toMatchObject({ status: "not_enough_viewers", note: "Not enough viewers yet", watchMinutes: null });
  });

  it("the radio band counts listening time", () => {
    expect(report.krad.byProgram?.[0].watch).toMatchObject({ status: "shown", timeLabel: "listening_time" });
  });

  it("bots never count: in the tuned-in line before they were caught, never in the numbers", async () => {
    const minute = (i: number) => new Date(Date.parse(EVENING) + i * 60_000);
    const tunedIn = async (i: number) => (await h.db.select().from(schema.minuteSamples).where(and(eq(schema.minuteSamples.stationId, ev.stations.beat), eq(schema.minuteSamples.minute, minute(i)))))[0]?.tunedIn ?? 0;
    const people = async (i: number) =>
      (
        await h.db
          .select({ id: schema.sessionMinutes.sessionId })
          .from(schema.sessionMinutes)
          .innerJoin(schema.sessions, eq(schema.sessions.id, schema.sessionMinutes.sessionId))
          .where(and(eq(schema.sessionMinutes.stationId, ev.stations.beat), eq(schema.sessionMinutes.minute, minute(i)), eq(schema.sessions.flaggedBot, false)))
      ).length;
    // 7:03 pm: the jump bot (caught at 7:08) is in the station's tuned-in count, not in the audience.
    expect((await tunedIn(3)) - (await people(3))).toBe(1);
    // 7:05 pm: the fast bot never counted anywhere.
    expect((await tunedIn(5)) - (await people(5))).toBe(1);
    const [crate] = await h.db.select().from(schema.airingStats).where(eq(schema.airingStats.logEntryId, ev.entries.beat.crate));
    expect(crate.audienceAtStart).toBe(await people(0));
    const flagged = await h.db.select().from(schema.sessions).where(eq(schema.sessions.flaggedBot, true));
    expect(flagged).toHaveLength(5);
  });

  it("the maker sees Night Signal across MAKR, BEAT and HALL added up, and nothing per station", () => {
    const tv = report.maker.programs.find((p) => p.band === "tv")!;
    expect(tv).toMatchObject({ title: "Night Signal", status: "shown", stations: 3, airings: 3, notCounted: { airings: 0 } });
    expect(tv.totals!.notForMe).toBe(5);
    const json = JSON.stringify(report.maker);
    for (const id of [ev.stations.beat, ev.stations.hall, ev.entries.beat.night, ev.entries.hall]) expect(json).not.toContain(id);
  });
});

describe("30 days on", () => {
  it("only the numbers are left, and the Audience page still reads them", async () => {
    const before = await h.db.select().from(schema.airingStats);
    const { purged, left } = await thirtyDaysOn(h);
    expect(purged.sessions).toBe(ev.viewers.length);
    expect(left).toMatchObject({ sessions: 0, sessionMinutes: 0, votes: 0, airingStats: 7 });
    expect(await h.db.select().from(schema.airingStats)).toEqual(before);
    const sessionIds = ev.viewers.map((v) => v.sessionId!);
    const kept = JSON.stringify(before);
    for (const id of [...sessionIds, ...Object.values(ev.people).map((p) => p.id)]) expect(kept).not.toContain(id);
    const again = await eveningReport(h, ev);
    expect(again.beat.byProgram?.find((r) => r.title === "Late Crate")?.watch).toEqual(report.beat.byProgram?.find((r) => r.title === "Late Crate")?.watch);
    if (process.env.WATCH_DATA_REPORT) console.log(`\n30 days on: purged ${JSON.stringify(purged)}; left ${JSON.stringify(left)}\n`);
  });
});
