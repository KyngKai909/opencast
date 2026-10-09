// Programming Phase 2: seasons and parts guessed at upload, dead-air fill walking a program's
// episodes in order from the as-run log (so a gap filled twice airs different episodes), and the
// library's "Never aired" and "Next episode".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createHarness, itemFixture, stationFixture, testClip, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let station: { id: string };
let programId: string;
const episodes: Array<{ id: string }> = [];
const MIN = 60_000;

/** What fill put on the log between two times, as episode numbers. */
async function filled(from: string, to: string) {
  const rows = await h.db
    .select({ assetId: schema.logEntries.assetId, startsAt: schema.logEntries.startsAt, endsAt: schema.logEntries.endsAt, id: schema.logEntries.id })
    .from(schema.logEntries)
    .where(eq(schema.logEntries.stationId, station.id))
    .orderBy(asc(schema.logEntries.startsAt));
  return rows.filter((r) => r.startsAt >= new Date(from) && r.startsAt < new Date(to));
}
const numbers = (rows: Array<{ assetId: string | null }>) => rows.map((r) => episodes.findIndex((e) => e.id === r.assetId) + 1);

/** The rows aired as planned: the as-run log playout would write. */
async function air(rows: Array<{ id: string; assetId: string | null; startsAt: Date; endsAt: Date }>) {
  for (const r of rows) {
    await h.db.insert(schema.asRun).values({ stationId: station.id, code: "PGM", startedAt: r.startsAt, endedAt: r.endsAt, logEntryId: r.id, assetId: r.assetId, programId, reason: "dead_air_fill" });
  }
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-09T02:00:00.000Z");
  kai = await h.signIn("Kai");
  station = await stationFixture(h, { callSign: "KRAT", name: "Crate Radio", ownerId: kai.id, signedOn: true });
  programId = (await kai.post(`/v1/stations/${station.id}/programs`, { title: "Late Crate" }).expect(201)).body.id;
  // Six episodes of 9.5 minutes (10 on the log), added newest last.
  for (let n = 1; n <= 6; n++) {
    episodes.push(await itemFixture(h, station.id, { title: `Late Crate ${n}`, programId, episodeNumber: n, durationMs: 9.5 * MIN, createdAt: new Date(Date.UTC(2026, 8, n)) }));
  }
}, 60_000);
afterAll(() => h.close());

describe("dead-air fill", () => {
  it("walks the program in order from the as-run log: a gap filled twice airs different episodes", async () => {
    expect(await h.services.log.fillDeadAir(station.id, { startsAt: "2026-10-09T04:00:00.000Z", endsAt: "2026-10-09T04:30:00.000Z" })).toBe(3);
    const first = await filled("2026-10-09T04:00:00.000Z", "2026-10-09T04:30:00.000Z");
    expect(numbers(first)).toEqual([1, 2, 3]);
    await air(first);

    // Another gap the next night: it picks up after episode 3.
    expect(await h.services.log.fillDeadAir(station.id, { startsAt: "2026-10-10T04:00:00.000Z", endsAt: "2026-10-10T04:30:00.000Z" })).toBe(3);
    const second = await filled("2026-10-10T04:00:00.000Z", "2026-10-10T04:30:00.000Z");
    expect(numbers(second)).toEqual([4, 5, 6]);
    await air(second);

    // And the next starts over.
    await h.services.log.fillDeadAir(station.id, { startsAt: "2026-10-11T04:00:00.000Z", endsAt: "2026-10-11T04:20:00.000Z" });
    expect(numbers(await filled("2026-10-11T04:00:00.000Z", "2026-10-11T04:20:00.000Z"))).toEqual([1, 2]);
  });

  it("passes over an episode it can't air for now, and comes back for it", async () => {
    const ahead = await h.services.log.repeatsAhead(station.id, 3);
    expect(ahead.map((i) => episodes.findIndex((e) => e.id === i.id) + 1)).toEqual([1, 2, 3]);
    // Episodes 1 and 2 are on the log (not aired yet); as-run says 6 aired last. Episode 1 isn't prepared.
    const placed = await h.services.log.fillDeadAir(station.id, { startsAt: "2026-10-12T04:00:00.000Z", endsAt: "2026-10-12T04:20:00.000Z" }, { usable: (i) => i.id !== episodes[0].id });
    expect(placed).toBe(2);
    expect(numbers(await filled("2026-10-12T04:00:00.000Z", "2026-10-12T04:20:00.000Z"))).toEqual([2, 3]);
  });

  it("airs a multi-part episode whole, or not at all", async () => {
    const owner = await h.signIn("Dee");
    const other = await stationFixture(h, { callSign: "KTWO", name: "Two Parts", ownerId: owner.id, signedOn: true });
    const program = (await owner.post(`/v1/stations/${other.id}/programs`, { title: "The Long Night" }).expect(201)).body.id;
    const parts = [];
    for (let n = 1; n <= 2; n++) parts.push(await itemFixture(h, other.id, { title: `The Long Night, Part ${n}`, programId: program, durationMs: 9.5 * MIN, createdAt: new Date(Date.UTC(2026, 8, n)) }));
    for (const [i, p] of parts.entries()) await h.db.update(schema.assets).set({ partOf: "The Long Night", partNumber: i + 1 }).where(eq(schema.assets.id, p.id));
    // 15 minutes: only one part fits, so neither airs.
    expect(await h.services.log.fillDeadAir(other.id, { startsAt: "2026-10-09T04:00:00.000Z", endsAt: "2026-10-09T04:15:00.000Z" })).toBe(0);
    expect(await h.services.log.fillDeadAir(other.id, { startsAt: "2026-10-09T05:00:00.000Z", endsAt: "2026-10-09T05:20:00.000Z" })).toBe(2);
    const rows = await h.db.select().from(schema.logEntries).where(eq(schema.logEntries.stationId, other.id)).orderBy(asc(schema.logEntries.startsAt));
    expect(rows.map((r) => r.assetId)).toEqual(parts.map((p) => p.id));
  });
});

describe("the library", () => {
  it("says what never aired, when each last aired, and what's next in each program", async () => {
    const lib = (await kai.get(`/v1/stations/${station.id}/library`).expect(200)).body;
    const ep = (n: number) => lib.items.find((i: { id: string }) => i.id === episodes[n - 1].id);
    // Aired: 1, 2, 3, 4, 5, 6 (as-run), so episode 1 is next.
    expect(ep(1)).toMatchObject({ neverAired: false, nextEpisode: true, upNext: 0, seasonNumber: null, partOf: null, partNumber: null });
    expect(ep(6)).toMatchObject({ neverAired: false, nextEpisode: false, upNext: 5, lastAiredAt: "2026-10-10T04:20:00.000Z" });

    const extra = await itemFixture(h, station.id, { title: "Late Crate 7", programId, episodeNumber: 7, durationMs: 9.5 * MIN });
    const again = (await kai.get(`/v1/stations/${station.id}/library`).expect(200)).body;
    expect(again.items.find((i: { id: string }) => i.id === extra.id)).toMatchObject({ neverAired: true, lastAiredAt: null, nextEpisode: true, upNext: 0 });
  });

  it("guesses season, episode and part at upload, and the station corrects them", async () => {
    const up = (name: string) => kai.post(`/v1/stations/${station.id}/library/uploads`).field("code", "PGM").attach("file", clip, name).expect(201);
    const clip = await testClip(2);
    const se = (await up("Late.Crate.S02E05.1080p.mp4")).body;
    expect(se).toMatchObject({ title: "Late.Crate.S02E05.1080p", seasonNumber: 2, episodeNumber: 5, partOf: null });
    const part = (await up("The Long Night, Part 2.mp4")).body;
    expect(part).toMatchObject({ seasonNumber: null, episodeNumber: null, partOf: "The Long Night", partNumber: 2 });
    await h.services.library.settle();

    const fixed = (await kai.patch(`/v1/library/${se.id}`, { seasonNumber: 3, episodeNumber: 1, partOf: "Finale", partNumber: 1 }).expect(200)).body;
    expect(fixed).toMatchObject({ seasonNumber: 3, episodeNumber: 1, partOf: "Finale", partNumber: 1 });
    expect((await kai.patch(`/v1/library/${se.id}`, { partOf: null, partNumber: null }).expect(200)).body).toMatchObject({ partOf: null, partNumber: null });
    const [row] = await h.db.select().from(schema.assets).where(and(eq(schema.assets.id, part.id), eq(schema.assets.stationId, station.id)));
    expect(row.originalFilename).toBe("The Long Night, Part 2.mp4");
  });
});
