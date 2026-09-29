// Day templates and off air hours (added 2026-09-29): a day built once and repeated (every day,
// weekdays, a given weekday, once), with edited dates kept as exceptions; and planned off air time,
// which is never dead air: no warnings, no fill, heartbeats not counted, and viewers see when the
// station is back. Against the local Postgres (no ffmpeg).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createPlanner } from "../src/v1/modules/playout/engine/plan.js";
import { anon, createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let beat: string;
let reel: string;
let show: { id: string };
let morning: { id: string };
let night: { id: string };

// Monday, October 26, 2026, noon in Los Angeles (PDT). Clocks fall back on Sunday, November 1.
const MONDAY_NOON = "2026-10-26T19:00:00.000Z";

const logOf = async (stationId: string, from: string, to: string) => (await kai.get(`/v1/stations/${stationId}/log?from=${from}&to=${to}`).expect(200)).body;
const starts = (entries: Array<{ startsAt: string }>) => entries.map((e) => e.startsAt);

beforeAll(async () => {
  h = await createHarness();
  h.clock.set(MONDAY_NOON);
  const m = await market(h);
  kai = await h.signIn("Kai");
  beat = (await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true, colour: "#8C3B7A" })).id;
  reel = (await stationFixture(h, { callSign: "REEL", name: "Reel 24", ownerId: kai.id, marketId: m.id, tenths: 241, signedOn: true, colour: "#1F5C99" })).id;
  show = await itemFixture(h, beat, { title: "Late Crate" });
  morning = await itemFixture(h, beat, { title: "Morning Set" });
  night = await itemFixture(h, reel, { title: "Night Desk", durationMs: 29.5 * 60_000 });
}, 60_000);
afterAll(() => h.close());

describe("day templates", () => {
  let saturday: string;
  let weekdays: string;

  it("repeats a Saturday every Saturday, at the same local time across the change to standard time", async () => {
    // Saturday, October 31 (PDT): Morning Set at 9:00 am, Late Crate at 8:00 pm.
    await kai.post(`/v1/stations/${beat}/log`, { kind: "program", startsAt: "2026-10-31T16:00:00.000Z", itemId: morning.id }).expect(201);
    await kai.post(`/v1/stations/${beat}/log`, { kind: "program", startsAt: "2026-11-01T03:00:00.000Z", itemId: show.id }).expect(201);
    const made = await kai.post(`/v1/stations/${beat}/log/templates`, { fromDay: "2026-10-31", pattern: "weekly" }).expect(201);
    saturday = made.body.template.id;
    expect(made.body.template).toMatchObject({ pattern: "weekly", weekday: 6, label: "Every Saturday", fromDay: "2026-10-31", until: null, timezone: "America/Los_Angeles" });
    expect(made.body.template.entries.map((e: { startTime: string; title: string }) => `${e.startTime} ${e.title}`)).toEqual(["09:00 Morning Set", "20:00 Late Crate"]);
    // Three weeks ahead: November 7 and 14.
    expect(made.body.generated).toEqual({ dates: 2, created: 4, removed: 0, skippedForConflicts: 0, exceptions: 0 });

    // November 7 is in standard time (PST): still 9:00 am and 8:00 pm.
    const log = await logOf(beat, "2026-11-07T08:00:00.000Z", "2026-11-08T08:00:00.000Z");
    expect(starts(log.entries)).toEqual(["2026-11-07T17:00:00.000Z", "2026-11-08T04:00:00.000Z"]);
    expect(log.entries.every((e: { repeatGroupId: string }) => e.repeatGroupId === saturday)).toBe(true);
    expect(log.repeats).toContainEqual(expect.objectContaining({ id: saturday, pattern: "weekly", template: true, weekday: 6, label: "Every Saturday" }));
  });

  it("generating again changes nothing", async () => {
    expect(await h.services.log.templates.generate(beat)).toEqual({ dates: 0, created: 0, removed: 0, skippedForConflicts: 0, exceptions: 0 });
    await logOf(beat, "2026-11-14T08:00:00.000Z", "2026-11-15T08:00:00.000Z");
    const rows = await h.db.select().from(schema.logEntries).where(eq(schema.logEntries.repeatGroupId, saturday));
    expect(rows).toHaveLength(4);
  });

  it("an edited date stays as it is when the template changes; the other dates follow the template", async () => {
    const nov7 = await logOf(beat, "2026-11-07T08:00:00.000Z", "2026-11-08T08:00:00.000Z");
    const late = nov7.entries.find((e: { startsAt: string }) => e.startsAt === "2026-11-08T04:00:00.000Z");
    // November 7 only: Late Crate moves to 9:00 pm.
    await kai.patch(`/v1/stations/${beat}/log/${late.id}`, { startsAt: "2026-11-08T05:00:00.000Z" }).expect(200);

    // The template: Late Crate at 7:30 pm from now on.
    const changed = await kai
      .patch(`/v1/stations/${beat}/log/templates/${saturday}`, {
        entries: [
          { startTime: "09:00", kind: "program", itemId: morning.id },
          { startTime: "19:30", kind: "program", itemId: show.id }
        ]
      })
      .expect(200);
    expect(changed.body.generated).toEqual({ dates: 1, created: 1, removed: 1, skippedForConflicts: 0, exceptions: 1 });
    expect(changed.body.template.dates).toEqual([
      { date: "2026-11-07", edited: true, entries: 2, skipped: 0 },
      { date: "2026-11-14", edited: false, entries: 2, skipped: 0 }
    ]);
    expect(starts((await logOf(beat, "2026-11-07T08:00:00.000Z", "2026-11-08T08:00:00.000Z")).entries)).toEqual(["2026-11-07T17:00:00.000Z", "2026-11-08T05:00:00.000Z"]);
    expect(starts((await logOf(beat, "2026-11-14T08:00:00.000Z", "2026-11-15T08:00:00.000Z")).entries)).toEqual(["2026-11-14T17:00:00.000Z", "2026-11-15T03:30:00.000Z"]);
    // The edited date is never generated again.
    expect((await h.services.log.templates.generate(beat)).exceptions).toBe(1);
  });

  it("repeats a Tuesday on weekdays only", async () => {
    // Tuesday, October 27: Morning Set at 7:00 am.
    await kai.post(`/v1/stations/${beat}/log`, { kind: "program", startsAt: "2026-10-27T14:00:00.000Z", itemId: morning.id }).expect(201);
    const made = await kai.post(`/v1/stations/${beat}/log/templates`, { fromDay: "2026-10-27", pattern: "weekdays", name: "Weekday mornings" }).expect(201);
    weekdays = made.body.template.id;
    expect(made.body.template).toMatchObject({ pattern: "weekdays", weekday: null, label: "Weekdays", name: "Weekday mornings" });
    // October 28 to November 16, Monday to Friday.
    const dates = made.body.template.dates.map((d: { date: string }) => d.date);
    expect(dates).toEqual(["2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-16"]);
    const rows = await h.db.select().from(schema.logEntries).where(eq(schema.logEntries.repeatGroupId, weekdays)).orderBy(asc(schema.logEntries.startsAt));
    // Friday October 30 at 7:00 am PDT, Monday November 2 at 7:00 am PST.
    expect(rows.map((r) => r.startsAt.toISOString())).toContain("2026-10-30T14:00:00.000Z");
    expect(rows.map((r) => r.startsAt.toISOString())).toContain("2026-11-02T15:00:00.000Z");
    expect(rows.some((r) => ["2026-10-31", "2026-11-01", "2026-11-07", "2026-11-08"].includes(r.templateDate!))).toBe(false);
  });

  it("where two templates cover a date, the more specific wins; taking one off lets the other in", async () => {
    // Every day from the Tuesday: weekdays and Saturdays have their own, so it takes Sundays (and
    // Saturday October 31, the day the Saturday template was built from, which it doesn't cover).
    const daily = await kai.post(`/v1/stations/${beat}/log/templates`, { fromDay: "2026-10-27", pattern: "daily" }).expect(201);
    expect(daily.body.template.dates.map((d: { date: string }) => d.date)).toEqual(["2026-10-31", "2026-11-01", "2026-11-08", "2026-11-15"]);

    const list = await kai.get(`/v1/stations/${beat}/log/templates`).expect(200);
    expect(list.body.templates.map((t: { label: string }) => t.label)).toEqual(["Every Saturday", "Weekdays", "Every day"]);

    // Stop the Saturday template: its entries come off from now on, and every day takes Saturdays.
    const removed = await kai.delete(`/v1/stations/${beat}/log/templates/${saturday}`).expect(200);
    expect(removed.body).toEqual({ removed: 4 });
    const nov7 = await logOf(beat, "2026-11-07T08:00:00.000Z", "2026-11-08T08:00:00.000Z");
    expect(nov7.entries.map((e: { startsAt: string; repeatGroupId: string }) => [e.startsAt, e.repeatGroupId])).toEqual([["2026-11-07T15:00:00.000Z", daily.body.template.id]]);
    await kai.get(`/v1/stations/${beat}/log/templates/${saturday}`).expect(404);
  });

  it("Repeat this day still works, and makes a template (G7)", async () => {
    await kai.post(`/v1/stations/${beat}/log`, { kind: "program", startsAt: "2026-10-29T03:00:00.000Z", itemId: show.id }).expect(201);
    const made = await kai.post(`/v1/stations/${beat}/log/repeat`, { day: "2026-10-28", pattern: "once", until: "2026-10-28", onto: "2026-11-04" }).expect(200);
    expect(made.body).toEqual({ created: 1, skippedForConflicts: 0, templateId: expect.any(String) });
    // Once wins over weekdays on November 4: Wednesday October 28 as it is (the weekday morning,
    // which stays where it was, and the evening added by hand).
    const rows = await h.db
      .select()
      .from(schema.logEntries)
      .where(and(eq(schema.logEntries.stationId, beat), eq(schema.logEntries.templateDate, "2026-11-04")))
      .orderBy(asc(schema.logEntries.startsAt));
    expect(rows.map((r) => [r.startsAt.toISOString(), r.repeatGroupId])).toEqual([
      ["2026-11-04T15:00:00.000Z", made.body.templateId],
      ["2026-11-05T04:00:00.000Z", made.body.templateId]
    ]);
    // Adding the evening by hand made October 28 an exception to the weekday template.
    const [oct28] = await h.db.select().from(schema.dayTemplateDates).where(and(eq(schema.dayTemplateDates.stationId, beat), eq(schema.dayTemplateDates.date, "2026-10-28")));
    expect(oct28.editedAt).not.toBeNull();
  });
});

describe("off air hours", () => {
  // Tuesday, October 27, 1:30 am PDT.
  const T0130 = "2026-10-27T08:30:00.000Z";
  const T0200 = "2026-10-27T09:00:00.000Z";
  const T0600 = "2026-10-27T13:00:00.000Z";
  const T0300 = "2026-10-27T10:00:00.000Z";

  beforeAll(async () => {
    h.clock.set(T0130);
    await h.db.insert(schema.playoutState).values({ stationId: reel, onAir: true });
  });

  it("sets every night, 2:00 to 6:00 am, in the market's time zone", async () => {
    await kai.put(`/v1/stations/${reel}/off-air-hours`, { rules: [{ days: [0, 1, 2, 3, 4, 5, 6], signOffAt: "02:00", backAt: "02:00" }] }).expect(400);
    const set = await kai.put(`/v1/stations/${reel}/off-air-hours`, { rules: [{ days: [0, 1, 2, 3, 4, 5, 6], signOffAt: "02:00", backAt: "06:00" }] }).expect(200);
    expect(set.body).toEqual({
      timezone: "America/Los_Angeles",
      rules: [{ id: expect.any(String), days: [0, 1, 2, 3, 4, 5, 6], signOffAt: "02:00", backAt: "06:00", label: "Every night, 2:00 am to 6:00 am" }],
      next: { startsAt: T0200, endsAt: T0600, backAt: T0600, source: "hours", logEntryId: null }
    });
    expect((await kai.get(`/v1/stations/${reel}/off-air-hours`).expect(200)).body).toEqual(set.body);
  });

  it("isn't dead air: the log covers 24 hours around it, station IDs hourly, and the pre-flight says so", async () => {
    // On until 2:00 am, then from 6:00 am to 2:00 am the next night: 29:30 in 30-minute slots.
    await kai.post(`/v1/stations/${reel}/log/fill`, { with: "repeat", startsAt: T0130, endsAt: T0200, itemIds: [night.id] }).expect(200);
    await kai.post(`/v1/stations/${reel}/log/fill`, { with: "repeat", startsAt: T0600, endsAt: "2026-10-28T09:00:00.000Z", itemIds: [night.id] }).expect(200);
    const checks = await kai.get(`/v1/stations/${reel}/sign-on/checks`).expect(200);
    const byKey = (key: string) => checks.body.checks.find((c: { key: string }) => c.key === key);
    expect(byKey("log_covers_24h").passed).toBe(true);
    expect(byKey("station_id_hourly").passed).toBe(true);
    expect(byKey("off_air_hours")).toMatchObject({ passed: true, blocking: false, detail: expect.stringMatching(/from 2:00 am, back at 6:00 am/) });

    const log = await logOf(reel, "2026-10-27T07:00:00.000Z", "2026-10-28T07:00:00.000Z");
    expect(log.offAir).toEqual([{ startsAt: T0200, endsAt: T0600, backAt: T0600, source: "hours", logEntryId: null }]);
    // The only dead air is before 1:30 am, already past.
    expect(log.gaps).toEqual([{ startsAt: "2026-10-27T07:00:00.000Z", endsAt: T0130 }]);
  });

  it("is never warned about or filled", async () => {
    h.clock.set("2026-10-27T08:45:00.000Z"); // 1:45 am
    await h.services.log.checkDeadAir([reel]);
    expect(await h.db.select().from(schema.deadAirEvents).where(eq(schema.deadAirEvents.stationId, reel))).toEqual([]);
    const deadAir = await kai.get(`/v1/stations/${reel}/dead-air`).expect(200);
    expect(deadAir.body.gaps).toEqual([]);
    expect(deadAir.body.offAir[0]).toMatchObject({ startsAt: T0200, backAt: T0600 });
    // What the worker's dead-air fill reads: nothing to fill at 2:00 am.
    expect(await h.services.log.gaps(reel, new Date("2026-10-27T08:59:00.000Z"), new Date("2026-10-27T09:01:00.000Z"))).toEqual([]);
  });

  it("the run sheet airs the sign-off slate, goes dark, and signs back on with the station ID", async () => {
    const planner = createPlanner({ deps: h.deps, services: h.services });
    const segments = await planner.plan(reel, new Date("2026-10-27T08:59:00.000Z"), new Date("2026-10-27T13:01:00.000Z"));
    const shape = segments.map((s) => `${s.startsAt.toISOString().slice(11, 19)} ${s.code} ${s.source.kind}`);
    expect(shape.slice(-5)).toEqual(["08:59:55 SID image", "09:00:00 OPEN image", "09:01:00 OPEN off", "12:59:55 SID image", "13:00:00 PGM file"]);
    const dark = segments.find((s) => s.source.kind === "off")!;
    expect(dark.source).toEqual({ kind: "off", backAt: new Date(T0600) });
  });

  it("heartbeats aren't counted while off air, and say when the station is back", async () => {
    h.clock.set(T0130);
    const counted = randomUUID();
    await anon(h).post("/v1/heartbeat").send({ stationId: reel, sessionId: counted, platform: "web", mediaTimeMs: 0, playing: true }).expect(200);
    h.clock.set(T0300);
    const ignored = randomUUID();
    const beat = await anon(h).post("/v1/heartbeat").send({ stationId: reel, sessionId: ignored, platform: "web", mediaTimeMs: 0, playing: true }).expect(200);
    expect(beat.body).toEqual({ ok: true, offAirUntil: T0600, nextInMs: 3 * 3_600_000 });
    expect(await h.db.select().from(schema.sessions).where(eq(schema.sessions.id, counted))).toHaveLength(1);
    expect(await h.db.select().from(schema.sessions).where(eq(schema.sessions.id, ignored))).toHaveLength(0);
  });

  it("the dial, the guide and the Monitor show the station off air with the time it's back", async () => {
    h.clock.set(T0300);
    const dial = await anon(h).get("/v1/markets/inland-empire/dial?band=tv").expect(200);
    const row = dial.body.rows.find((r: { station: { callSign: string } }) => r.station.callSign === "REEL");
    expect(row).toMatchObject({
      onAir: false,
      backAt: T0600,
      now: { kind: "off_air", title: "Off air", code: "OPEN", logEntryId: null, startsAt: T0200, endsAt: T0600, backAt: T0600, live: false },
      next: { kind: "program", title: "Night Desk", startsAt: T0600 }
    });
    expect(row.signal).toBeUndefined();

    const guide = await anon(h).get(`/v1/markets/inland-empire/guide?from=2026-10-27T08:00:00.000Z&to=2026-10-27T14:00:00.000Z`).expect(200);
    const airings = guide.body.rows.find((r: { station: { callSign: string } }) => r.station.callSign === "REEL").airings;
    expect(airings.map((a: { kind: string; startsAt: string; backAt?: string }) => [a.kind, a.startsAt, a.backAt ?? null])).toEqual([
      ["program", T0130, null],
      ["off_air", T0200, T0600],
      ["program", T0600, null],
      ["program", "2026-10-27T13:30:00.000Z", null]
    ]);

    const monitor = await kai.get(`/v1/stations/${reel}/playout`).expect(200);
    expect(monitor.body).toMatchObject({ onAir: true, now: null, offAir: { now: true, startsAt: T0200, backAt: T0600, source: "hours" } });

    const page = await anon(h).get("/v1/stations/REEL").expect(200);
    expect(page.body.now).toMatchObject({ kind: "off_air", backAt: T0600 });
    expect(page.body.upNext[0]).toMatchObject({ startsAt: T0600 });
  });

  it("a sign-off on the log runs into the hours: one stretch, back at 6:00 am", async () => {
    h.clock.set(T0300);
    // Wednesday night: sign off at 1:30 am instead of the last program.
    const log = await logOf(reel, "2026-10-28T08:00:00.000Z", "2026-10-28T14:00:00.000Z");
    const last = log.entries.find((e: { startsAt: string }) => e.startsAt === "2026-10-28T08:30:00.000Z");
    await kai.delete(`/v1/stations/${reel}/log/${last.id}`).expect(200);
    const [signOff] = (await kai.post(`/v1/stations/${reel}/log/fill`, { with: "sign_off", startsAt: "2026-10-28T08:30:00.000Z", endsAt: "2026-10-28T09:00:00.000Z" }).expect(200)).body;
    const after = await logOf(reel, "2026-10-28T08:00:00.000Z", "2026-10-28T14:00:00.000Z");
    expect(after.offAir).toEqual([
      { startsAt: "2026-10-28T08:30:00.000Z", endsAt: "2026-10-28T09:00:00.000Z", backAt: "2026-10-28T13:00:00.000Z", source: "sign_off", logEntryId: signOff.id },
      { startsAt: "2026-10-28T09:00:00.000Z", endsAt: "2026-10-28T13:00:00.000Z", backAt: "2026-10-28T13:00:00.000Z", source: "hours", logEntryId: null }
    ]);
    // Dead air only once the log runs out, after 6:00 am.
    expect(after.gaps).toEqual([{ startsAt: "2026-10-28T13:00:00.000Z", endsAt: "2026-10-28T14:00:00.000Z" }]);
    const guide = await anon(h).get(`/v1/markets/inland-empire/guide?from=2026-10-28T08:00:00.000Z&to=2026-10-28T14:00:00.000Z`).expect(200);
    const airings = guide.body.rows.find((r: { station: { callSign: string } }) => r.station.callSign === "REEL").airings;
    expect(airings.filter((a: { kind: string }) => a.kind === "off_air")).toEqual([
      expect.objectContaining({ logEntryId: signOff.id, startsAt: "2026-10-28T08:30:00.000Z", endsAt: "2026-10-28T13:00:00.000Z", backAt: "2026-10-28T13:00:00.000Z" })
    ]);
    // At 3:00 am the dial still shows the stretch from the sign-off.
    h.clock.set("2026-10-28T10:00:00.000Z");
    const dial = await anon(h).get("/v1/markets/inland-empire/dial?band=tv").expect(200);
    const row = dial.body.rows.find((r: { station: { callSign: string } }) => r.station.callSign === "REEL");
    expect(row).toMatchObject({ onAir: false, backAt: "2026-10-28T13:00:00.000Z", now: { logEntryId: signOff.id, startsAt: "2026-10-28T08:30:00.000Z" } });
    h.clock.set(T0300);
  });

  it("dead air outside the hours is still warned about", async () => {
    // Nothing from 6:00 to 6:30 am any more.
    const log = await logOf(reel, "2026-10-27T12:00:00.000Z", "2026-10-27T14:00:00.000Z");
    const first = log.entries.find((e: { startsAt: string }) => e.startsAt === T0600);
    await kai.delete(`/v1/stations/${reel}/log/${first.id}`).expect(200);
    h.clock.set("2026-10-27T12:45:00.000Z"); // 5:45 am
    await h.services.log.checkDeadAir([reel]);
    const events = await h.db.select().from(schema.deadAirEvents).where(eq(schema.deadAirEvents.stationId, reel));
    expect(events.map((e) => [e.gapStartsAt.toISOString(), Boolean(e.warned30At)])).toEqual([[T0600, true]]);
  });

  it("runs across midnight and keeps local time across the change to standard time", async () => {
    h.clock.set(T0130);
    const set = await kai.put(`/v1/stations/${reel}/off-air-hours`, { rules: [{ days: [6], signOffAt: "23:00", backAt: "06:00" }] }).expect(200);
    expect(set.body.rules[0].label).toBe("Saturdays, 11:00 pm to 6:00 am");
    // Saturday October 31, 11:00 pm PDT, to Sunday November 1, 6:00 am PST: eight hours that night.
    expect(await h.services.log.offAirSpans(reel, new Date("2026-10-31T12:00:00.000Z"), new Date("2026-11-02T00:00:00.000Z"))).toEqual([
      { startsAt: "2026-11-01T06:00:00.000Z", endsAt: "2026-11-01T14:00:00.000Z", backAt: "2026-11-01T14:00:00.000Z", source: "hours", logEntryId: null }
    ]);
    // The next off air time is Wednesday's sign-off, on its own now.
    expect(set.body.next).toMatchObject({ source: "sign_off", startsAt: "2026-10-28T08:30:00.000Z", backAt: "2026-10-28T09:00:00.000Z" });
    const none = await kai.put(`/v1/stations/${reel}/off-air-hours`, { rules: [] }).expect(200);
    expect(none.body).toMatchObject({ rules: [], next: expect.objectContaining({ source: "sign_off" }) });
  });
});
