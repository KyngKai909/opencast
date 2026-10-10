// G18 (2026-10-03): "Keep at this time" on an entry. The station marks a row as a fixed point: the
// log says so, a single edit or a batch sets and clears it, a batch can't move a kept entry unless it
// clears the mark first (changes are taken in order), a day template keeps the mark on every date it
// makes, and a live block ending early doesn't move a kept program up.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

const MIN = 60_000;
const T = (hhmm: string) => `2026-10-02T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}.000Z`;

let h: Harness;
let kai: User;
let marketId: string;
let tenths = 501;

/**
 * A station on air at 8:00 pm Pacific (3:00 UTC) with four half-hour programs from 7:50 pm:
 * Crate Session (on now), Late Crate, Slow Hours, Night Desk.
 */
async function station(callSign: string) {
  h.clock.set(T("03:00"));
  const s = await stationFixture(h, { callSign, name: `${callSign} TV`, ownerId: kai.id, marketId, tenths: (tenths += 2), signedOn: true });
  const ids: string[] = [];
  for (const [i, title] of ["Crate Session", "Late Crate", "Slow Hours", "Night Desk"].entries()) {
    const item = await itemFixture(h, s.id, { title, durationMs: 28.5 * MIN });
    const startsAt = new Date(Date.parse(T("02:50")) + i * 30 * MIN);
    const [row] = await h.db
      .insert(schema.logEntries)
      .values({ stationId: s.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MIN), kind: "program", code: "PGM", assetId: item.id })
      .returning();
    ids.push(row.id);
  }
  await h.db.insert(schema.playoutState).values({ stationId: s.id, onAir: true });
  const [crate, late, slow, night] = ids;
  return { id: s.id, crate, late, slow, night };
}

const changes = (id: string, body: object) => kai.post(`/v1/stations/${id}/log/changes`, body);
const entry = async (id: string) => (await h.db.select().from(schema.logEntries).where(eq(schema.logEntries.id, id)))[0];
const logOf = async (stationId: string) => (await kai.get(`/v1/stations/${stationId}/log?from=${T("02:00")}&to=${T("09:00")}`).expect(200)).body;
const replans = async (stationId: string) => (await h.db.select().from(schema.commands).where(and(eq(schema.commands.stationId, stationId), eq(schema.commands.action, "replan")))).length;

beforeAll(async () => {
  h = await createHarness();
  h.clock.set(T("03:00"));
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
}, 60_000);
afterAll(() => h.close());

describe("the log", () => {
  it("says which entries keep their time; adding and editing an entry set and clear it", async () => {
    const s = await station("KEEP");
    expect((await logOf(s.id)).entries.map((e: { keepTime: boolean }) => e.keepTime)).toEqual([false, false, false, false]);

    const kept = await kai.patch(`/v1/stations/${s.id}/log/${s.night}`, { keepTime: true }).expect(200);
    expect(kept.body.keepTime).toBe(true);
    // Left out, it stays as it is.
    expect((await kai.patch(`/v1/stations/${s.id}/log/${s.night}`, { localNote: "Fixed for the news" }).expect(200)).body.keepTime).toBe(true);
    expect((await logOf(s.id)).entries.map((e: { keepTime: boolean }) => e.keepTime)).toEqual([false, false, false, true]);
    expect((await kai.patch(`/v1/stations/${s.id}/log/${s.night}`, { keepTime: false }).expect(200)).body.keepTime).toBe(false);

    const item = await itemFixture(h, s.id, { title: "Night Owls", durationMs: 28.5 * MIN });
    const added = await kai.post(`/v1/stations/${s.id}/log`, { kind: "program", startsAt: T("05:00"), itemId: item.id, keepTime: true }).expect(201);
    expect(added.body.keepTime).toBe(true);
    expect((await entry(added.body.id)).keepTime).toBe(true);
    const plain = await kai.post(`/v1/stations/${s.id}/log`, { kind: "program", startsAt: T("05:30"), itemId: item.id }).expect(201);
    expect(plain.body.keepTime).toBe(false);
  });
});

describe("a batch", () => {
  it("keeps an entry at its time: a dry run says so and changes nothing", async () => {
    const s = await station("KDRY");
    const res = await changes(s.id, { dryRun: true, changes: [{ op: "keep", entryId: s.slow, keep: true }] }).expect(200);
    expect(res.body).toMatchObject({ applied: false, summary: "1 change: Slow Hours keeps its time", problems: [], warnings: [], replanned: false, record: null });
    expect(res.body.changes).toEqual([{ index: 0, op: "keep", entryId: s.slow, key: null, line: "Slow Hours keeps its time", startsAt: T("03:50"), endsAt: T("04:20") }]);
    expect((await entry(s.slow)).keepTime).toBe(false);
  });

  it("published, the mark is written and recorded, and the template's date is edited; nothing is replanned", async () => {
    const s = await station("KPUB");
    const [template] = await h.db.insert(schema.repeatGroups).values({ stationId: s.id, pattern: "daily", startTime: "18:00", startsOn: "2026-09-30", template: true }).returning();
    await h.db.insert(schema.dayTemplateDates).values({ stationId: s.id, date: "2026-10-01", templateId: template.id, generatedAt: h.clock.now() });

    const res = await changes(s.id, { changes: [{ op: "keep", entryId: s.late, keep: true }] }).expect(200);
    expect(res.body).toMatchObject({ applied: true, summary: "1 change: Late Crate keeps its time", problems: [], replanned: false });
    expect((await entry(s.late)).keepTime).toBe(true);
    // Times, versions and the channel are as they were: the mark changes nothing about what airs.
    expect((await entry(s.late)).startsAt.toISOString()).toBe(T("03:20"));
    expect(await replans(s.id)).toBe(0);
    const [date] = await h.db.select().from(schema.dayTemplateDates).where(eq(schema.dayTemplateDates.stationId, s.id));
    expect(date.editedAt?.toISOString()).toBe(T("03:00"));

    h.clock.set(T("03:01"));
    const cleared = await changes(s.id, { changes: [{ op: "keep", entryId: s.late, keep: false }] }).expect(200);
    expect(cleared.body.changes[0].line).toBe("Late Crate no longer keeps its time");
    expect((await entry(s.late)).keepTime).toBe(false);
    const history = (await kai.get(`/v1/stations/${s.id}/log/changes`).expect(200)).body.changes;
    expect(history.map((r: { lines: string[] }) => r.lines)).toEqual([["Late Crate no longer keeps its time"], ["Late Crate keeps its time"]]);
    const [stored] = await h.db.select().from(schema.logChanges).where(eq(schema.logChanges.id, res.body.record.id));
    expect(stored.changes).toEqual([{ op: "keep", entryId: s.late, keep: true }]);
  });

  it("can't move a kept entry, unless it clears the mark first: changes are taken in order", async () => {
    const s = await station("KMOV");
    await h.db.update(schema.logEntries).set({ keepTime: true }).where(eq(schema.logEntries.id, s.slow));
    const kept = { index: 0, code: "kept", message: "Slow Hours is kept at its time. Turn off Keep at this time to move it." };

    const move = { op: "move", entryId: s.slow, startsAt: T("04:50") };
    expect((await changes(s.id, { dryRun: true, changes: [move] }).expect(200)).body.problems).toEqual([kept]);
    const refused = await changes(s.id, { changes: [move] }).expect(422);
    expect(refused.body.error).toMatchObject({ code: "log_changes_refused", message: kept.message });
    // Cleared after the move: too late.
    expect((await changes(s.id, { dryRun: true, changes: [move, { op: "keep", entryId: s.slow, keep: false }] }).expect(200)).body.problems).toEqual([kept]);
    // Marked in the same batch, then moved: refused at the move.
    const marked = await changes(s.id, { dryRun: true, changes: [{ op: "keep", entryId: s.late, keep: true }, { op: "move", entryId: s.late, startsAt: T("04:50") }] }).expect(200);
    expect(marked.body.problems).toEqual([{ index: 1, code: "kept", message: "Late Crate is kept at its time. Turn off Keep at this time to move it." }]);

    const res = await changes(s.id, { changes: [{ op: "keep", entryId: s.slow, keep: false }, move] }).expect(200);
    expect(res.body.summary).toBe("2 changes: Slow Hours no longer keeps its time, Slow Hours moves to 9:50 pm");
    const slow = await entry(s.slow);
    expect([slow.startsAt.toISOString(), slow.keepTime]).toEqual([T("04:50"), false]);
  });

  it("puts an entry on that keeps its time", async () => {
    const s = await station("KINS");
    const item = await itemFixture(h, s.id, { title: "Crate Talk", durationMs: 14 * MIN });
    const res = await changes(s.id, { changes: [{ op: "insert", key: "new-1", entry: { kind: "program", startsAt: T("04:50"), itemId: item.id, keepTime: true } }] }).expect(200);
    const inserted = res.body.changes[0];
    expect((await entry(inserted.entryId)).keepTime).toBe(true);
    expect((await logOf(s.id)).entries.find((e: { id: string }) => e.id === inserted.entryId).keepTime).toBe(true);
  });
});

describe("day templates", () => {
  it("made from a day, keep its fixed points on each date they make; a template's entries set them", async () => {
    h.clock.set(T("03:00"));
    const s = await stationFixture(h, { callSign: "KTPL", name: "KTPL TV", ownerId: kai.id, marketId, tenths: (tenths += 2), signedOn: true });
    const morning = await itemFixture(h, s.id, { title: "Morning Set" });
    const show = await itemFixture(h, s.id, { title: "Late Crate" });
    // Saturday, October 3: Morning Set at 9:00 am, kept at its time; Late Crate at 8:00 pm.
    await kai.post(`/v1/stations/${s.id}/log`, { kind: "program", startsAt: "2026-10-03T16:00:00.000Z", itemId: morning.id, keepTime: true }).expect(201);
    await kai.post(`/v1/stations/${s.id}/log`, { kind: "program", startsAt: "2026-10-04T03:00:00.000Z", itemId: show.id }).expect(201);

    const made = await kai.post(`/v1/stations/${s.id}/log/templates`, { fromDay: "2026-10-03", pattern: "weekly" }).expect(201);
    const templateId = made.body.template.id;
    expect(made.body.template.entries.map((e: { startTime: string; keepTime: boolean }) => [e.startTime, e.keepTime])).toEqual([
      ["09:00", true],
      ["20:00", false]
    ]);
    const generated = async () =>
      (
        await h.db
          .select()
          .from(schema.logEntries)
          .where(and(eq(schema.logEntries.repeatGroupId, templateId), isNotNull(schema.logEntries.templateDate)))
          .orderBy(asc(schema.logEntries.startsAt))
      ).map((r) => [r.templateDate, r.keepTime]);
    expect(await generated()).toEqual([
      ["2026-10-10", true],
      ["2026-10-10", false],
      ["2026-10-17", true],
      ["2026-10-17", false]
    ]);

    // The template's own entries: Late Crate is the fixed point now, on every date it made.
    const changed = await kai
      .patch(`/v1/stations/${s.id}/log/templates/${templateId}`, {
        entries: [
          { startTime: "09:00", kind: "program", itemId: morning.id },
          { startTime: "20:00", kind: "program", itemId: show.id, keepTime: true }
        ]
      })
      .expect(200);
    expect(changed.body.template.entries.map((e: { keepTime: boolean }) => e.keepTime)).toEqual([false, true]);
    expect(await generated()).toEqual([
      ["2026-10-10", false],
      ["2026-10-10", true],
      ["2026-10-17", false],
      ["2026-10-17", true]
    ]);
  });
});

describe("a live block ending early (G3)", () => {
  it("moves the programs after it up, but not one kept at its time, nor what follows it", async () => {
    h.clock.set(T("03:00"));
    const s = await stationFixture(h, { callSign: "KEND", name: "KEND TV", ownerId: kai.id, marketId, tenths: (tenths += 2), signedOn: true });
    const sourceId = (await kai.post(`/v1/stations/${s.id}/live-sources`, { kind: "encoder", name: "Studio A" }).expect(201)).body.source.id;
    // Live from 7:50 pm to 8:50 pm, then three programs; the second (9:20 pm) is kept at its time.
    const [live] = await h.db
      .insert(schema.logEntries)
      .values({ stationId: s.id, startsAt: new Date(T("02:50")), endsAt: new Date(T("03:50")), kind: "live", code: "PGM", liveSourceId: sourceId })
      .returning();
    const programs: string[] = [];
    for (const [i, title] of ["Late Crate", "Slow Hours", "Night Desk"].entries()) {
      const item = await itemFixture(h, s.id, { title, durationMs: 28.5 * MIN });
      const startsAt = new Date(Date.parse(T("03:50")) + i * 30 * MIN);
      const [row] = await h.db
        .insert(schema.logEntries)
        .values({ stationId: s.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MIN), kind: "program", code: "PGM", assetId: item.id, keepTime: i === 1 })
        .returning();
      programs.push(row.id);
    }
    await h.db.insert(schema.playoutState).values({ stationId: s.id, onAir: true });

    h.clock.set("2026-10-02T03:00:00.400Z");
    const res = await kai.post(`/v1/stations/${s.id}/log/${live.id}/end-early`).expect(200);
    expect(res.body).toEqual({ entryId: live.id, endedAt: T("03:00"), movedUp: 1 });
    const times = await Promise.all(programs.map(async (id) => entry(id).then((r) => [r.startsAt.toISOString(), r.endsAt.toISOString()])));
    expect(times).toEqual([
      [T("03:00"), T("03:30")],
      [T("04:20"), T("04:50")],
      [T("04:50"), T("05:20")]
    ]);
    h.clock.set(T("03:00"));
  });
});
