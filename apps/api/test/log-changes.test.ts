// Edit mode (the user's request of 2026-09-29): a batch of changes to the log, checked together
// (a dry run) and published at once, in one transaction. One bad change applies nothing; a draft
// from before someone else's change is refused; on air, what's airing and anything inside the
// assembler's lead is locked; an on-air station is told once to read its log again; spots held in
// a break that goes move to the next break; template dates are marked edited; each batch is recorded.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import { LOG_EDIT_LEAD_MS } from "@opencast/contracts";
import { createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

const MIN = 60_000;
const $ = (d: number) => Math.round(d * 1_000_000);
const T = (hhmm: string) => `2026-10-02T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}.000Z`;

let h: Harness;
let kai: User;
let jess: User;
let marketId: string;
let tenths = 301;

/**
 * A station on air at 8:00 pm Pacific (3:00 UTC) with four half-hour programs from 7:50 pm, each a
 * 28:30 item closing with a 1:30 break: Crate Session (on now), Late Crate, Slow Hours, Night Desk.
 */
async function station(callSign: string) {
  h.clock.set(T("03:00"));
  const s = await stationFixture(h, { callSign, name: `${callSign} TV`, ownerId: kai.id, marketId, tenths: (tenths += 2), signedOn: true });
  await itemFixture(h, s.id, { title: `${callSign} ident`, code: "SID", durationMs: 5_000 });
  const titles = ["Crate Session", "Late Crate", "Slow Hours", "Night Desk"];
  const ids: string[] = [];
  const items: string[] = [];
  for (const [i, title] of titles.entries()) {
    const item = await itemFixture(h, s.id, { title, durationMs: 28.5 * MIN });
    items.push(item.id);
    // Straight in: the first one is on now, which the API wouldn't take as a new entry by then.
    const startsAt = new Date(Date.parse(T("02:50")) + i * 30 * MIN);
    const [row] = await h.db
      .insert(schema.logEntries)
      .values({ stationId: s.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MIN), kind: "program", code: "PGM", assetId: item.id })
      .returning();
    ids.push(row.id);
  }
  await h.db.insert(schema.playoutState).values({ stationId: s.id, onAir: true });
  const [crate, late, slow, night] = ids;
  return { id: s.id, crate, late, slow, night, items };
}

const changes = (id: string, body: object) => kai.post(`/v1/stations/${id}/log/changes`, body);
const entry = async (id: string) => (await h.db.select().from(schema.logEntries).where(eq(schema.logEntries.id, id)))[0];
const replans = async (stationId: string) => (await h.db.select().from(schema.commands).where(and(eq(schema.commands.stationId, stationId), eq(schema.commands.action, "replan")))).length;

beforeAll(async () => {
  h = await createHarness();
  h.clock.set(T("03:00"));
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
  jess = await h.signIn("Jess");
}, 60_000);
afterAll(() => h.close());

describe("the lead", () => {
  it("is the assembler's: the channel is written that far ahead", () => {
    const source = readFileSync(new URL("../src/v1/modules/playout/engine/assemble.ts", import.meta.url), "utf8");
    const lead = /const LEAD_MS = ([\d_]+);/.exec(source)?.[1];
    expect(Number(lead?.replace(/_/g, ""))).toBe(LOG_EDIT_LEAD_MS);
  });
});

describe("a dry run", () => {
  it("says what the batch does, with the dead air it leaves, and changes nothing", async () => {
    const s = await station("DRYR");
    const res = await changes(s.id, { dryRun: true, changes: [{ op: "move", entryId: s.slow, startsAt: T("04:50") }] }).expect(200);
    expect(res.body).toMatchObject({ applied: false, summary: "1 change: Slow Hours moves to 9:50 pm", problems: [], replanned: false, record: null });
    expect(res.body.changes).toEqual([{ index: 0, op: "move", entryId: s.slow, key: null, line: "Slow Hours moves to 9:50 pm", startsAt: T("04:50"), endsAt: T("05:20") }]);
    expect(res.body.warnings).toEqual([{ index: null, code: "dead_air", message: "Dead air from 8:50 pm to 9:20 pm (30 min)." }]);
    expect((await entry(s.slow)).startsAt.toISOString()).toBe(T("03:50"));
    expect((await kai.get(`/v1/stations/${s.id}/log/changes`).expect(200)).body.changes).toEqual([]);
  });

  it("snaps typed times to 4-second segments, as a single edit does", async () => {
    const s = await station("SNAP");
    const res = await changes(s.id, { dryRun: true, changes: [{ op: "move", entryId: s.night, startsAt: "2026-10-02T04:51:05.300Z" }] }).expect(200);
    expect(res.body.changes[0].startsAt).toBe(T("04:51:04"));
  });
});

describe("publishing", () => {
  it("applies every change at once: programs trade places, and the batch is recorded with who and when", async () => {
    const s = await station("SWAP");
    const res = await changes(s.id, {
      changes: [
        { op: "move", entryId: s.late, startsAt: T("03:50") },
        { op: "move", entryId: s.slow, startsAt: T("03:20") }
      ]
    }).expect(200);
    expect(res.body.applied).toBe(true);
    expect(res.body.summary).toBe("2 changes: Late Crate moves to 8:50 pm, Slow Hours moves to 8:20 pm");
    expect((await entry(s.late)).startsAt.toISOString()).toBe(T("03:50"));
    expect((await entry(s.slow)).startsAt.toISOString()).toBe(T("03:20"));
    expect(res.body.record).toMatchObject({ by: { userId: kai.id, name: "Kai" }, at: T("03:00"), summary: res.body.summary, count: 2 });
    const history = (await kai.get(`/v1/stations/${s.id}/log/changes`).expect(200)).body.changes;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: res.body.record.id, by: { name: "Kai" }, lines: ["Late Crate moves to 8:50 pm", "Slow Hours moves to 8:20 pm"] });
  });

  it("inserts, replaces, resizes and removes in one batch", async () => {
    const s = await station("MIXD");
    const extra = await itemFixture(h, s.id, { title: "Crate Talk", durationMs: 14 * MIN });
    const res = await changes(s.id, {
      changes: [
        { op: "remove", entryId: s.night },
        { op: "insert", key: "new-1", entry: { kind: "program", startsAt: T("04:20"), itemId: extra.id } },
        { op: "replace", entryId: s.slow, itemId: extra.id }
      ]
    }).expect(200);
    expect(res.body.summary).toBe("3 changes: Night Desk at 9:20 pm comes off the log, Crate Talk goes on at 9:20 pm, Crate Talk replaces Slow Hours at 8:50 pm");
    const inserted = res.body.changes[1];
    expect(inserted).toMatchObject({ key: "new-1", startsAt: T("04:20"), endsAt: T("04:34") });
    expect((await entry(inserted.entryId)).createdBy).toBe(kai.id);
    expect(await entry(s.night)).toBeUndefined();
    const slow = await entry(s.slow);
    expect([slow.assetId, slow.endsAt.toISOString()]).toEqual([extra.id, T("04:04")]);
  });

  it("refuses the whole batch when one change is wrong: nothing is applied", async () => {
    const s = await station("ATOM");
    const unconfirmed = await itemFixture(h, s.id, { title: "Unsure", durationMs: 20 * MIN, rights: false });
    const body = {
      changes: [
        { op: "remove", entryId: s.night },
        { op: "move", entryId: s.slow, startsAt: T("03:30") },
        { op: "insert", entry: { kind: "program", startsAt: T("05:00"), itemId: unconfirmed.id } }
      ]
    };
    const dry = await changes(s.id, { ...body, dryRun: true }).expect(200);
    expect(dry.body.problems).toEqual([
      { index: 1, code: "overlap", message: "Slow Hours would overlap Late Crate at 8:30 pm." },
      { index: 2, code: "rights_unconfirmed", message: "Confirm the rights to air it first." }
    ]);
    const res = await changes(s.id, body).expect(422);
    expect(res.body.error).toMatchObject({ code: "log_changes_refused", message: "Slow Hours would overlap Late Crate at 8:30 pm." });
    expect(await entry(s.night)).toBeTruthy();
    expect((await entry(s.slow)).startsAt.toISOString()).toBe(T("03:50"));
    expect((await h.db.select().from(schema.logEntries).where(eq(schema.logEntries.stationId, s.id))).length).toBe(4);
    expect((await kai.get(`/v1/stations/${s.id}/log/changes`).expect(200)).body.changes).toEqual([]);
  });

  it("marks the dates a day template made as edited", async () => {
    const s = await station("TMPL");
    const [template] = await h.db.insert(schema.repeatGroups).values({ stationId: s.id, pattern: "daily", startTime: "18:00", startsOn: "2026-09-30", template: true }).returning();
    // 9:20 pm Thursday, October 1 in Los Angeles: that broadcast day.
    await h.db.insert(schema.dayTemplateDates).values({ stationId: s.id, date: "2026-10-01", templateId: template.id, generatedAt: h.clock.now() });
    await changes(s.id, { changes: [{ op: "move", entryId: s.night, startsAt: T("05:00") }] }).expect(200);
    const [date] = await h.db.select().from(schema.dayTemplateDates).where(eq(schema.dayTemplateDates.stationId, s.id));
    expect(date.editedAt?.toISOString()).toBe(T("03:00"));
  });

  it("only with the owner or an operator: someone off the team doesn't see the station", async () => {
    const s = await station("ROLE");
    await jess.post(`/v1/stations/${s.id}/log/changes`, { dryRun: true, changes: [{ op: "remove", entryId: s.night }] }).expect(404);
    await jess.get(`/v1/stations/${s.id}/log/changes`).expect(404);
  });
});

describe("a stale draft", () => {
  it("is refused with a conflict once someone else changed the log, and the reload's version works", async () => {
    const s = await station("STAL");
    const window = { from: T("02:00"), to: T("09:00") };
    const log = await kai.get(`/v1/stations/${s.id}/log?from=${window.from}&to=${window.to}`).expect(200);
    const base = { ...window, version: log.body.version as string };
    expect(base.version).toMatch(/^[\w-]{16}$/);
    // The draft checks out against its version.
    await changes(s.id, { dryRun: true, base, changes: [{ op: "remove", entryId: s.night }] }).expect(200);
    // Someone else moves Night Desk.
    await kai.patch(`/v1/stations/${s.id}/log/${s.night}`, { startsAt: T("04:24") }).expect(200);
    const refused = await changes(s.id, { base, changes: [{ op: "remove", entryId: s.night }] }).expect(409);
    expect(refused.body.error).toMatchObject({ code: "log_changed", message: "The log changed since you started editing. Reload it to see what changed, then make your changes again." });
    expect(await entry(s.night)).toBeTruthy();
    const again = await kai.get(`/v1/stations/${s.id}/log?from=${window.from}&to=${window.to}`).expect(200);
    const res = await changes(s.id, { base: { ...window, version: again.body.version }, changes: [{ op: "remove", entryId: s.night }] }).expect(200);
    expect(res.body.version).not.toBe(again.body.version);
    expect(res.body.version).toBe((await kai.get(`/v1/stations/${s.id}/log?from=${window.from}&to=${window.to}`).expect(200)).body.version);
  });
});

describe("on air", () => {
  it("locks the entry airing now and anything starting within the lead; the rest goes live", async () => {
    const s = await station("LOCK");
    const onNow = await changes(s.id, { dryRun: true, changes: [{ op: "resize", entryId: s.crate, endsAt: T("03:24") }] }).expect(200);
    expect(onNow.body.problems).toEqual([{ index: 0, code: "locked", message: "On air now, too late to change." }]);
    // 8:19:50 pm: Late Crate airs in 10 seconds.
    h.clock.set(T("03:19:50"));
    const soon = await changes(s.id, { dryRun: true, changes: [{ op: "move", entryId: s.late, startsAt: T("03:21") }, { op: "move", entryId: s.slow, startsAt: T("05:00") }] }).expect(200);
    expect(soon.body.problems).toEqual([{ index: 0, code: "locked", message: "Airs in 10 s, too late to change." }]);
    // Nothing can be put inside the lead either.
    const into = await changes(s.id, { dryRun: true, changes: [{ op: "move", entryId: s.night, startsAt: T("03:20:04") }] }).expect(200);
    expect(into.body.problems.map((p: { code: string }) => p.code)).toEqual(["too_soon"]);
    expect(into.body.problems[0].message).toBe("That's too soon: the channel is already set for the next 20 seconds.");
    await changes(s.id, { changes: [{ op: "move", entryId: s.late, startsAt: T("03:21") }] }).expect(422);
    // Off air, only what's already started is locked.
    await h.db.update(schema.playoutState).set({ onAir: false }).where(eq(schema.playoutState.stationId, s.id));
    const off = await changes(s.id, { dryRun: true, changes: [{ op: "move", entryId: s.late, startsAt: T("03:20:04") }] }).expect(200);
    expect(off.body.problems.filter((p: { code: string }) => p.code !== "overlap")).toEqual([]);
    h.clock.set(T("03:00"));
  });

  it("tells the station to read its log again once per batch, when the batch reaches the next half hour", async () => {
    const s = await station("RPLN");
    const res = await changes(s.id, {
      changes: [
        { op: "remove", entryId: s.late },
        { op: "move", entryId: s.slow, startsAt: T("03:20") },
        { op: "move", entryId: s.night, startsAt: T("03:50") }
      ]
    }).expect(200);
    expect(res.body.replanned).toBe(true);
    expect(await replans(s.id)).toBe(1);
    // Hours ahead: the plan hasn't read that far yet.
    await changes(s.id, { changes: [{ op: "move", entryId: s.night, startsAt: T("06:00") }] }).expect(200);
    expect(await replans(s.id)).toBe(1);
  });
});

describe("held spots", () => {
  it("move to the next break when the break they're in goes, and the summary says so first", async () => {
    const s = await station("HELD");
    const b = await jess.post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online", marketIds: [marketId] }).expect(201);
    const card = await jess.post(`/v1/businesses/${b.body.id}/funding-sources`, { kind: "card", token: "tok_4417" }).expect(201);
    await jess.post(`/v1/businesses/${b.body.id}/deposits`, { amountMicros: $(100), fundingSourceId: card.body[0].id }).expect(201);
    const spot = await jess.post(`/v1/businesses/${b.body.id}/spots`, { title: "Cold brew", lengthSec: 30, category: "Food", rate: { kind: "per_airing", micros: $(4) }, budget: { totalMicros: $(50), dailyCapMicros: $(20) } }).expect(201);
    await h.db.insert(schema.spotFiles).values({ spotId: spot.body.id, version: 1, location: "/fixtures/cold-brew.mp4", durationMs: 30_000 });
    await h.db.update(schema.spotsTable).set({ status: "listed" }).where(eq(schema.spotsTable.id, spot.body.id));

    // The break after Slow Hours (9:18:30 pm) holds the spot.
    const slots = await h.services.log.ensureBreaks(s.id, new Date(T("03:00")), new Date(T("05:00")));
    const after = slots.find((x) => x.startsAt === T("04:18:30"))!;
    const { airingId } = await h.services.spots.place({ spotId: spot.body.id, stationId: s.id, breakId: after.id!, scheduledAt: new Date(after.startsAt) });

    const dry = await changes(s.id, { dryRun: true, changes: [{ op: "remove", entryId: s.slow }] }).expect(200);
    expect(dry.body.warnings).toContainEqual({ index: 0, code: "held_spots", message: "1 held spot in the break after Slow Hours moves to the next break." });

    await changes(s.id, { changes: [{ op: "remove", entryId: s.slow }] }).expect(200);
    const [airing] = await h.db.select().from(schema.airings).where(eq(schema.airings.id, airingId));
    // The next break: after Night Desk, 9:48:30 pm, marked filled so the rotation doesn't fill it again.
    const [next] = await h.db.select().from(schema.breaks).where(eq(schema.breaks.id, airing.breakId));
    expect([next.startsAt.toISOString(), airing.scheduledAt.toISOString()]).toEqual([T("04:48:30"), T("04:48:30")]);
    expect(next.filledAt).not.toBeNull();
    // The break that went is gone, and the money is still held.
    expect(await h.db.select().from(schema.breaks).where(eq(schema.breaks.id, after.id!))).toEqual([]);
    const open = await h.services.ledger.openAmount([airing.holdId]);
    expect(open.get(airing.holdId)).toBe($(4));
    expect(await h.db.select().from(schema.breaks).where(and(eq(schema.breaks.stationId, s.id), isNull(schema.breaks.logEntryId)))).toEqual([]);
  });
});
