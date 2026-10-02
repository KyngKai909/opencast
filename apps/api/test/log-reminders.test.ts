// Reminders on the log (the catch-up report's follow-up, 2026-09-29). An airing a viewer set a
// reminder for can come off the log, by a single remove or in a batch: the reminder moves to the
// same program's next airing on the station (within a week), or is cancelled, and each viewer is
// told. A move keeps the entry, so its reminders follow it, at the new start. A batch's dry run
// warns first. Also: a batch counts its own airings of a carried episode against the agreement.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

const MIN = 60_000;
/** Thursday, October 1, 2026 in Los Angeles (UTC the next day). */
const T = (hhmm: string, day = 2) => `2026-10-${String(day).padStart(2, "0")}T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}.000Z`;

let h: Harness;
let kai: User;
let marketId: string;
let tenths = 401;
let viewers = 0;

/**
 * A station on air at 8:00 pm Pacific (3:00 UTC) with four half-hour programs from 7:50 pm, each
 * its own program with one 28:30 episode: Crate Session (on now), Late Crate, Slow Hours, Night Desk.
 */
async function station(callSign: string) {
  h.clock.set(T("03:00"));
  const s = await stationFixture(h, { callSign, name: `${callSign} TV`, ownerId: kai.id, marketId, tenths: (tenths += 2), signedOn: true });
  const titles = ["Crate Session", "Late Crate", "Slow Hours", "Night Desk"];
  const ids: string[] = [];
  const items: string[] = [];
  const programs: string[] = [];
  for (const [i, title] of titles.entries()) {
    const program = await kai.post(`/v1/stations/${s.id}/programs`, { title }).expect(201);
    const item = await itemFixture(h, s.id, { title: `${title}, episode 1`, programId: program.body.id, episodeNumber: 1, durationMs: 28.5 * MIN });
    programs.push(program.body.id);
    items.push(item.id);
    const startsAt = new Date(Date.parse(T("02:50")) + i * 30 * MIN);
    ids.push(await put(s.id, item.id, program.body.id, startsAt));
  }
  await h.db.insert(schema.playoutState).values({ stationId: s.id, onAir: true });
  const [crate, late, slow, night] = ids;
  const channel = `${Math.floor(tenths / 10)}.${tenths % 10}`;
  return { id: s.id, name: `${callSign} ${channel}`, crate, late, slow, night, items, programs };
}

/** An entry straight onto the log. */
async function put(stationId: string, itemId: string, programId: string, startsAt: Date, length = 30 * MIN) {
  const [row] = await h.db
    .insert(schema.logEntries)
    .values({ stationId, startsAt, endsAt: new Date(startsAt.getTime() + length), kind: "program", code: "PGM", assetId: itemId, programId })
    .returning();
  return row.id;
}

/** A viewer with an email address. */
async function viewer(name: string) {
  const user = await h.signIn(name);
  await h.db.update(schema.users).set({ email: `${name.toLowerCase()}${++viewers}@example.test` }).where(eq(schema.users.id, user.id));
  return user;
}

const remind = (user: User, logEntryId: string) => user.post("/v1/me/reminders", { logEntryId }).expect(200);
const remindersOf = async (userId: string) => h.db.select().from(schema.reminders).where(eq(schema.reminders.userId, userId));
const noticesOf = async (userId: string) => {
  await h.deps.bus.settle();
  return (await h.services.notifications.list(userId, { limit: 20 })).filter((n) => n.kind === "reminder");
};
const emailsTo = async (userId: string) => {
  const [u] = await h.db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId));
  return h.sent.filter((s) => s.channel === "email" && s.to === u.email);
};
const changes = (id: string, body: object) => kai.post(`/v1/stations/${id}/log/changes`, body);

beforeAll(async () => {
  h = await createHarness();
  h.clock.set(T("03:00"));
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
}, 60_000);
afterAll(() => h.close());

describe("taking an entry off (a single remove)", () => {
  it("moves reminders to the program's next airing on the station, and tells each viewer", async () => {
    const s = await station("RMVA");
    // Late Crate airs again tomorrow, Friday 8:20 pm, and next week.
    const friday = await put(s.id, s.items[1], s.programs[1], new Date(T("03:20", 3)));
    await put(s.id, s.items[1], s.programs[1], new Date(T("03:20", 9)));
    const ana = await viewer("Ana");
    const ben = await viewer("Ben");
    await remind(ana, s.late);
    await remind(ben, s.late);
    // Ben already has one on Friday's: he keeps that one.
    await remind(ben, friday);

    await kai.delete(`/v1/stations/${s.id}/log/${s.late}`).expect(200);
    expect(await h.db.select().from(schema.logEntries).where(eq(schema.logEntries.id, s.late))).toEqual([]);
    expect((await remindersOf(ana.id)).map((r) => [r.logEntryId, r.notifiedAt])).toEqual([[friday, null]]);
    expect((await remindersOf(ben.id)).map((r) => r.logEntryId)).toEqual([friday]);
    const [listed] = (await ana.get("/v1/me/reminders").expect(200)).body;
    expect(listed.airing).toMatchObject({ title: "Late Crate", startsAt: T("03:20", 3), logEntryId: friday });

    const title = `Late Crate moved to Friday 8:20 pm on ${s.name}`;
    for (const who of [ana, ben]) {
      const notices = await noticesOf(who.id);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({ title, body: "Your reminder moved with it.", link: null, scope: { kind: "viewer", id: null } });
      // In the app, and by email (on by default for reminders).
      expect((await emailsTo(who.id)).map((e) => e.title)).toEqual([title]);
    }
  });

  it("cancels them when the program doesn't air again on the station within a week, and tells each viewer", async () => {
    const s = await station("RMVB");
    // Night Desk airs again, but eight days on: too far.
    await put(s.id, s.items[3], s.programs[3], new Date(T("04:20", 10)));
    const ana = await viewer("Ana");
    await remind(ana, s.night);

    await kai.delete(`/v1/stations/${s.id}/log/${s.night}`).expect(200);
    expect(await remindersOf(ana.id)).toEqual([]);
    const notices = await noticesOf(ana.id);
    expect(notices.map((n) => [n.title, n.body])).toEqual([[`Night Desk was taken off ${s.name}'s schedule`, "It was on for Thursday 9:20 pm. Your reminder is cancelled."]]);
    expect((await emailsTo(ana.id)).map((e) => e.body)).toEqual(["It was on for Thursday 9:20 pm. Your reminder is cancelled."]);
  });

  it("says a date for an airing a week or more away", async () => {
    const s = await station("RMVC");
    const next = await put(s.id, s.items[2], s.programs[2], new Date(T("03:50", 9)));
    const ana = await viewer("Ana");
    await remind(ana, s.slow);
    await kai.delete(`/v1/stations/${s.id}/log/${s.slow}`).expect(200);
    expect((await remindersOf(ana.id)).map((r) => r.logEntryId)).toEqual([next]);
    expect((await noticesOf(ana.id)).map((n) => n.title)).toEqual([`Slow Hours moved to October 8, 8:50 pm on ${s.name}`]);
  });
});

describe("edit mode", () => {
  it("the dry run warns that viewers set reminders, and changes nothing", async () => {
    const s = await station("RDRY");
    const [ana, ben] = [await viewer("Ana"), await viewer("Ben")];
    await remind(ana, s.slow);
    await remind(ben, s.slow);
    await remind(ana, s.night);
    const dry = await changes(s.id, { dryRun: true, changes: [{ op: "remove", entryId: s.slow }, { op: "remove", entryId: s.night }, { op: "move", entryId: s.late, startsAt: T("03:24") }] }).expect(200);
    const reminders = dry.body.warnings.filter((w: { code: string }) => w.code === "reminders");
    expect(reminders).toEqual([
      { index: 0, code: "reminders", message: "2 viewers set reminders for this; they'll be told." },
      { index: 1, code: "reminders", message: "1 viewer set a reminder for this; they'll be told." }
    ]);
    expect((await remindersOf(ana.id)).length).toBe(2);
    expect(await noticesOf(ana.id)).toEqual([]);
  });

  it("a batch remove cancels them (the batch isn't refused) and tells each viewer", async () => {
    const s = await station("RBAT");
    const [ana, ben] = [await viewer("Ana"), await viewer("Ben")];
    await remind(ana, s.slow);
    await remind(ben, s.slow);
    const res = await changes(s.id, { changes: [{ op: "remove", entryId: s.slow }] }).expect(200);
    expect(res.body.applied).toBe(true);
    expect(res.body.warnings).toContainEqual({ index: 0, code: "reminders", message: "2 viewers set reminders for this; they'll be told." });
    expect(await h.db.select().from(schema.logEntries).where(eq(schema.logEntries.id, s.slow))).toEqual([]);
    for (const who of [ana, ben]) {
      expect(await remindersOf(who.id)).toEqual([]);
      expect((await noticesOf(who.id)).map((n) => n.title)).toEqual([`Slow Hours was taken off ${s.name}'s schedule`]);
    }
  });

  it("moves them to a later airing the same batch puts on (another episode of the program)", async () => {
    const s = await station("RINS");
    const episode2 = await itemFixture(h, s.id, { title: "Night Desk, episode 2", programId: s.programs[3], episodeNumber: 2, durationMs: 28.5 * MIN });
    const ana = await viewer("Ana");
    await remind(ana, s.night);
    // Night Desk comes off at 9:20 pm; its next episode goes on at 10:00 pm.
    const res = await changes(s.id, {
      changes: [
        { op: "remove", entryId: s.night },
        { op: "insert", key: "ep2", entry: { kind: "program", startsAt: T("05:00"), itemId: episode2.id } }
      ]
    }).expect(200);
    const inserted = res.body.changes[1].entryId;
    expect((await remindersOf(ana.id)).map((r) => r.logEntryId)).toEqual([inserted]);
    expect((await noticesOf(ana.id)).map((n) => n.title)).toEqual([`Night Desk moved to Thursday 10:00 pm on ${s.name}`]);
  });

  it("moves and new lengths keep the entry: reminders follow, and come again at the new start", async () => {
    const s = await station("RMOV");
    const ana = await viewer("Ana");
    await remind(ana, s.night);
    await remind(ana, s.slow);
    // Both already reminded (their reminder went out).
    await h.db.update(schema.reminders).set({ notifiedAt: h.clock.now() }).where(eq(schema.reminders.userId, ana.id));
    await changes(s.id, { changes: [{ op: "move", entryId: s.night, startsAt: T("05:00") }, { op: "resize", entryId: s.slow, endsAt: T("04:24") }] }).expect(200);
    const rows = await remindersOf(ana.id);
    const night = rows.find((r) => r.logEntryId === s.night)!;
    const slow = rows.find((r) => r.logEntryId === s.slow)!;
    // Moved: reminded again at 10:00 pm. A new end only: nothing to remind again.
    expect(night.notifiedAt).toBeNull();
    expect(slow.notifiedAt).not.toBeNull();
    const listed = (await ana.get("/v1/me/reminders").expect(200)).body;
    expect(listed.find((r: { airing: { logEntryId: string } }) => r.airing.logEntryId === s.night).airing.startsAt).toBe(T("05:00"));
    expect(await noticesOf(ana.id)).toEqual([]);

    // A single edit's move too; and it's reminded when the new start comes.
    await h.db.update(schema.reminders).set({ notifiedAt: h.clock.now() }).where(eq(schema.reminders.id, night.id));
    await kai.patch(`/v1/stations/${s.id}/log/${s.night}`, { startsAt: T("05:30") }).expect(200);
    expect((await remindersOf(ana.id)).find((r) => r.id === night.id)!.notifiedAt).toBeNull();
    h.clock.set(T("05:27"));
    const due = await h.services.accounts.dueReminders(5);
    expect(due.filter((r) => r.userId === ana.id).map((r) => r.airing.startsAt)).toEqual([T("05:30")]);
    h.clock.set(T("03:00"));
  });
});

describe("a batch and a carriage limit", () => {
  it("counts the batch's own airings of a carried episode against the agreement", async () => {
    const s = await station("CARR");
    const makerOwner = await h.signIn("Maker");
    const maker = await stationFixture(h, { callSign: "MAKR", ownerId: makerOwner.id, marketId, tenths: (tenths += 2), signedOn: true });
    const program = await makerOwner.post(`/v1/stations/${maker.id}/programs`, { title: "Saturday Reel" }).expect(201);
    const episode = await itemFixture(h, maker.id, { programId: program.body.id, episodeNumber: 1, durationMs: 25 * MIN, title: "Reel 1" });
    const offer = await makerOwner
      .post(`/v1/programs/${program.body.id}/offer`, {
        termsOffered: ["barter", "cash"],
        cashPriceMicros: 2_500_000,
        cashPriceUnit: "per_airing",
        barterMakerMsPerHour: 120_000,
        airingsPerEpisode: 1,
        windowDays: 7,
        liveOnly: false,
        noticeDays: 7,
        approval: "i_approve",
        radioBandAllowed: true
      })
      .expect(201);
    const request = await kai.post(`/v1/catalog/offers/${offer.body.id}/requests`, { carrierStationId: s.id, term: "barter", slots: [{ weekday: 6, time: "20:00" }], startsOn: "2026-10-01" }).expect(201);
    await makerOwner.post(`/v1/carriage/requests/${request.body.id}/decision`, { decision: "approve" }).expect(200);
    const agreementId = (await kai.get(`/v1/stations/${s.id}/carriage/agreements`).expect(200)).body.carrying[0].id;

    const twice = {
      changes: [
        { op: "insert", entry: { kind: "program", startsAt: T("05:00"), itemId: episode.id, carriageAgreementId: agreementId } },
        { op: "insert", entry: { kind: "program", startsAt: T("06:00"), itemId: episode.id, carriageAgreementId: agreementId } }
      ]
    };
    const dry = await changes(s.id, { ...twice, dryRun: true }).expect(200);
    expect(dry.body.problems).toEqual([{ index: 1, code: "airing_limit", message: "The agreement allows 1 airing of each episode." }]);
    const refused = await changes(s.id, twice).expect(422);
    expect(refused.body.error).toMatchObject({ code: "log_changes_refused", message: "The agreement allows 1 airing of each episode." });
    expect(await h.db.select().from(schema.logEntries).where(eq(schema.logEntries.carriageAgreementId, agreementId))).toEqual([]);

    // Once is fine; moving that airing in a batch only counts it once.
    const once = await changes(s.id, { changes: [twice.changes[0]] }).expect(200);
    const onLog = once.body.changes[0].entryId;
    const moved = await changes(s.id, { dryRun: true, changes: [{ op: "move", entryId: onLog, startsAt: T("06:00") }] }).expect(200);
    expect(moved.body.problems).toEqual([]);
  });
});
