// Programming Phase 3: day template slots that air the next episode. A Saturdays slot walks its
// program a step each date it airs; a date edited into an exception without it passes its episode
// to the next week; a template edit carries the walk on; Fill the slot runs as many episodes as fit
// and Same as earlier slot reruns them; the end of a program warns a week ahead (start over) or the
// slot stops; an episode longer than its slot pushes what follows, and is a warning at an entry kept
// at its time. Against the local Postgres (no ffmpeg).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let marketId: string;
const MIN = 60_000;

// Monday, October 19, 2026, noon in Los Angeles (PDT). Clocks fall back on Sunday, November 1.
const MONDAY_NOON = "2026-10-19T19:00:00.000Z";
// Saturday 8:00 pm: October 24 and 31 in PDT, November 7 and 14 in PST.
const SAT_8PM = { "2026-10-24": "2026-10-25T03:00:00.000Z", "2026-10-31": "2026-11-01T03:00:00.000Z", "2026-11-07": "2026-11-08T04:00:00.000Z", "2026-11-14": "2026-11-15T04:00:00.000Z" } as const;
type Saturday = keyof typeof SAT_8PM;
/** A broadcast Saturday, 6:00 am to 6:00 am. */
const dayOf = (date: Saturday) => {
  const from = new Date(Date.parse(SAT_8PM[date]) - 14 * 60 * MIN);
  return { from: from.toISOString(), to: new Date(from.getTime() + 24 * 60 * MIN).toISOString() };
};

interface Station {
  id: string;
  programId: string;
  episodes: Array<{ id: string }>;
  templateId: string;
}

/** A station with a program of `count` episodes, ep. 1 on Saturday October 24 at 8:00 pm, made Every Saturday. */
async function setup(callSign: string, tenths: number, o: { title: string; count: number; durationMs?: number; startsAt?: string; more?: (s: Omit<Station, "templateId">) => Promise<void> }): Promise<Station> {
  const station = await stationFixture(h, { callSign, name: `${callSign} TV`, ownerId: kai.id, marketId, tenths, signedOn: true });
  const programId = (await kai.post(`/v1/stations/${station.id}/programs`, { title: o.title }).expect(201)).body.id;
  const episodes = [];
  for (let n = 1; n <= o.count; n++) {
    episodes.push(await itemFixture(h, station.id, { title: `Episode ${n}`, programId, episodeNumber: n, durationMs: o.durationMs ?? 28.5 * MIN, createdAt: new Date(Date.UTC(2026, 8, n)) }));
  }
  await kai.post(`/v1/stations/${station.id}/log`, { kind: "program", startsAt: o.startsAt ?? SAT_8PM["2026-10-24"], itemId: episodes[0].id }).expect(201);
  await o.more?.({ id: station.id, programId, episodes });
  const templateId = (await kai.post(`/v1/stations/${station.id}/log/templates`, { fromDay: "2026-10-24", pattern: "weekly" }).expect(201)).body.template.id;
  return { id: station.id, programId, episodes, templateId };
}

const template = async (s: Station) => (await kai.get(`/v1/stations/${s.id}/log/templates/${s.templateId}`).expect(200)).body;
const logOf = async (s: Station, date: Saturday) => (await kai.get(`/v1/stations/${s.id}/log?from=${dayOf(date).from}&to=${dayOf(date).to}`).expect(200)).body;
/** A Saturday's programs as "20:00 ep. 3" (local time), from the log. */
async function episodesOn(s: Station, date: Saturday): Promise<string[]> {
  const log = await logOf(s, date);
  const local = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "America/Los_Angeles" }).format(new Date(iso));
  return log.entries.map((e: { startsAt: string; itemId: string; title: string }) => {
    const n = s.episodes.findIndex((x) => x.id === e.itemId);
    return `${local(e.startsAt)} ${n >= 0 ? `ep. ${n + 1}` : e.title}`;
  });
}
const patchEntries = (s: Station, entries: unknown[]) => kai.patch(`/v1/stations/${s.id}/log/templates/${s.templateId}`, { entries }).expect(200);

beforeAll(async () => {
  h = await createHarness();
  h.clock.set(MONDAY_NOON);
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
}, 60_000);
afterAll(() => h.close());

describe("a Next episode slot", () => {
  let beat: Station;
  let slotId: string;

  it("advances a step each Saturday over three generated weeks, from the day it was built from", async () => {
    beat = await setup("BEAT", 121, { title: "Late Crate", count: 6 });
    const tpl = await template(beat);
    slotId = tpl.entries[0].slotId;
    expect(tpl.entries[0]).toMatchObject({ startTime: "20:00", whatAirs: "this_episode", slotId: expect.any(String) });
    // This episode, as before: ep. 1 every Saturday.
    expect(await episodesOn(beat, "2026-10-31")).toEqual(["20:00 ep. 1"]);

    const saved = await patchEntries(beat, [{ startTime: "20:00", kind: "program", lengthMs: 30 * MIN, whatAirs: "next_episode", programIds: [beat.programId], slotId }]);
    expect(saved.body.template.entries[0]).toMatchObject({ slotId, whatAirs: "next_episode", programIds: [beat.programId], order: "in_order", atEnd: "start_over", title: "Late Crate" });
    // October 24 (by hand, the day it was built from) aired ep. 1: then 2, 3 and 4.
    expect(await episodesOn(beat, "2026-10-31")).toEqual(["20:00 ep. 2"]);
    expect(await episodesOn(beat, "2026-11-07")).toEqual(["20:00 ep. 3"]);
    expect(await episodesOn(beat, "2026-11-14")).toEqual(["20:00 ep. 4"]);
    const entry = (await logOf(beat, "2026-11-07")).entries[0];
    expect(entry).toMatchObject({ title: "Late Crate", episodeTitle: "Episode 3", templateSlot: { slotId, templateId: beat.templateId, templateName: null, label: "Every Saturday", startTime: "20:00", whatAirs: "next_episode" } });
    // Generating again changes nothing.
    expect((await h.services.log.templates.generate(beat.id, { through: "2026-11-14" })).dates).toBe(0);
  });

  it("names the real episode in the guide (the station page reads the same airings) and in reminders", async () => {
    const nov7 = (await logOf(beat, "2026-11-07")).entries[0];
    const guide = await kai.get(`/v1/markets/inland-empire/guide?from=${SAT_8PM["2026-11-07"]}&to=${new Date(Date.parse(SAT_8PM["2026-11-07"]) + 60 * MIN).toISOString()}`).expect(200);
    expect(JSON.stringify(guide.body)).toContain('"episodeTitle":"Episode 3"');
    const viewer = await h.signIn("Dee");
    await viewer.post(`/v1/me/reminders`, { logEntryId: nov7.id }).expect(200);
    const reminders = (await viewer.get(`/v1/me/reminders`).expect(200)).body;
    expect(reminders[0].airing).toMatchObject({ title: "Late Crate", episodeTitle: "Episode 3", logEntryId: nov7.id });
    await viewer.delete(`/v1/me/reminders/${reminders[0].id}`).expect(200);
  });

  it("previews the next four Saturdays", async () => {
    const preview = await kai.post(`/v1/stations/${beat.id}/log/templates/${beat.templateId}/preview`, { entry: { startTime: "20:00", kind: "program", lengthMs: 30 * MIN, whatAirs: "next_episode", programIds: [beat.programId], slotId } }).expect(200);
    expect(preview.body.line).toBe("Next 4 Saturdays: ep. 2, 3, 4, 5");
    // Fill the slot, unsaved: as many as fit 30 minutes (one).
    const fill = await kai.post(`/v1/stations/${beat.id}/log/templates/${beat.templateId}/preview`, { entry: { startTime: "20:00", kind: "program", lengthMs: 60 * MIN, whatAirs: "fill", programIds: [beat.programId], slotId }, count: 2 }).expect(200);
    expect(fill.body.line).toBe("Next 2 Saturdays: ep. 2–3, 4–5");
    // Marathon is for a mix.
    const marathon = await kai.post(`/v1/stations/${beat.id}/log/templates/${beat.templateId}/preview`, { entry: { startTime: "20:00", kind: "program", lengthMs: 30 * MIN, whatAirs: "next_episode", programIds: [beat.programId], order: "marathon" } }).expect(400);
    expect(marathon.body.error.message).toBe("Marathon is for a slot that draws on several programs. For one program, In order already airs a season at a time.");
  });

  it("passes the episode of a date edited into an exception without it to the next week", async () => {
    const oct31 = (await logOf(beat, "2026-10-31")).entries[0];
    await kai.delete(`/v1/stations/${beat.id}/log/${oct31.id}`).expect(200);
    expect(await episodesOn(beat, "2026-10-31")).toEqual([]);
    expect((await template(beat)).dates.find((d: { date: string }) => d.date === "2026-10-31")).toMatchObject({ edited: true });
    expect(await episodesOn(beat, "2026-11-07")).toEqual(["20:00 ep. 2"]);
    expect(await episodesOn(beat, "2026-11-14")).toEqual(["20:00 ep. 3"]);
  });

  it("carries the walk on through a template edit (the slot sent back with its id)", async () => {
    await patchEntries(beat, [{ startTime: "19:30", kind: "program", lengthMs: 30 * MIN, whatAirs: "next_episode", programIds: [beat.programId], slotId }]);
    expect(await episodesOn(beat, "2026-11-07")).toEqual(["19:30 ep. 2"]);
    expect(await episodesOn(beat, "2026-11-14")).toEqual(["19:30 ep. 3"]);
    const tpl = await template(beat);
    expect(tpl.entries[0].slotId).toBe(slotId);
  });
});

describe("Fill the slot and Same as earlier slot", () => {
  it("fills a night with as many next episodes as fit, never past its end, and reruns them later", async () => {
    // Lofi Hours: ten episodes of 9.5 minutes (10 on the log). Saturday 10:00 pm.
    const lofi = await setup("LOFI", 141, { title: "Lofi Hours", count: 10, durationMs: 9.5 * MIN, startsAt: "2026-10-25T05:00:00.000Z" });
    const slotId = (await template(lofi)).entries[0].slotId;
    await patchEntries(lofi, [
      { startTime: "22:00", kind: "program", lengthMs: 45 * MIN, whatAirs: "fill", programIds: [lofi.programId], slotId },
      { startTime: "23:00", kind: "program", lengthMs: 45 * MIN, whatAirs: "same_as", sameAsSlotId: slotId }
    ]);
    // October 24 aired ep. 1. Four fit 45 minutes; the last 5 are left to the log's usual fill.
    expect(await episodesOn(lofi, "2026-10-31")).toEqual(["22:00 ep. 2", "22:10 ep. 3", "22:20 ep. 4", "22:30 ep. 5", "23:00 ep. 2", "23:10 ep. 3", "23:20 ep. 4", "23:30 ep. 5"]);
    expect(await episodesOn(lofi, "2026-11-07")).toEqual(["22:00 ep. 6", "22:10 ep. 7", "22:20 ep. 8", "22:30 ep. 9", "23:00 ep. 6", "23:10 ep. 7", "23:20 ep. 8", "23:30 ep. 9"]);
    // Ep. 10 ends the run; it starts over at ep. 1.
    expect(await episodesOn(lofi, "2026-11-14")).toEqual(["22:00 ep. 10", "22:10 ep. 1", "22:20 ep. 2", "22:30 ep. 3", "23:00 ep. 10", "23:10 ep. 1", "23:20 ep. 2", "23:30 ep. 3"]);
    const log = await logOf(lofi, "2026-10-31");
    expect(log.gaps).toContainEqual({ startsAt: "2026-11-01T05:40:00.000Z", endsAt: "2026-11-01T06:00:00.000Z" });
    expect(log.entries[4].templateSlot).toMatchObject({ whatAirs: "same_as", startTime: "23:00" });
  });
});

describe("the end of a program", () => {
  let ends: Station;
  let slotId: string;

  it("warns a week before the last new episode, then starts over", async () => {
    ends = await setup("ENDS", 151, { title: "Short Run", count: 3 });
    slotId = (await template(ends)).entries[0].slotId;
    await patchEntries(ends, [{ startTime: "20:00", kind: "program", lengthMs: 30 * MIN, whatAirs: "next_episode", programIds: [ends.programId], slotId }]);
    expect(await episodesOn(ends, "2026-10-31")).toEqual(["20:00 ep. 2"]);
    const warning = { code: "last_episode", templateId: ends.templateId, slotId, date: "2026-11-07", startsAt: SAT_8PM["2026-11-07"], message: "Short Run airs its last new episode Sat Nov 7, then starts over." };
    // On the log from October 31, a week before; not on October 24.
    expect((await logOf(ends, "2026-10-31")).warnings).toEqual([warning]);
    expect((await logOf(ends, "2026-10-24")).warnings).toBeUndefined();
    expect(await episodesOn(ends, "2026-11-07")).toEqual(["20:00 ep. 3"]);
    expect(await episodesOn(ends, "2026-11-14")).toEqual(["20:00 ep. 1"]);
    expect((await template(ends)).dates.find((d: { date: string }) => d.date === "2026-11-07").warnings).toEqual([warning]);
  });

  it("or stops: the slot is dead air from then on, which the dead air warnings catch", async () => {
    await patchEntries(ends, [{ startTime: "20:00", kind: "program", lengthMs: 30 * MIN, whatAirs: "next_episode", programIds: [ends.programId], atEnd: "stop", slotId }]);
    expect(await episodesOn(ends, "2026-11-07")).toEqual(["20:00 ep. 3"]);
    expect(await episodesOn(ends, "2026-11-14")).toEqual([]);
    const nov7 = await logOf(ends, "2026-10-31");
    expect(nov7.warnings[0].message).toBe("Short Run airs its last new episode Sat Nov 7, then stops. Its slot is dead air after that.");
    expect((await logOf(ends, "2026-11-14")).gaps.length).toBeGreaterThan(0);
    const preview = await kai.post(`/v1/stations/${ends.id}/log/templates/${ends.templateId}/preview`, { entry: { startTime: "20:00", kind: "program", lengthMs: 30 * MIN, whatAirs: "next_episode", programIds: [ends.programId], atEnd: "stop", slotId } }).expect(200);
    expect(preview.body.line).toBe("Next 4 Saturdays: ep. 2, 3, then nothing: it stops at the end");
  });
});

describe("an episode longer than its slot", () => {
  let long: Station;
  let night: { id: string };
  let slotId: string;

  it("pushes what follows down (the ripple)", async () => {
    // Long Talk: 39.5-minute episodes in a 30-minute slot, Night Desk at 8:30 pm.
    long = await setup("LONG", 161, {
      title: "Long Talk",
      count: 4,
      durationMs: 39.5 * MIN,
      more: async (s) => {
        night = await itemFixture(h, s.id, { title: "Night Desk" });
        await kai.post(`/v1/stations/${s.id}/log`, { kind: "program", startsAt: "2026-10-25T03:40:00.000Z", itemId: night.id }).expect(201);
      }
    });
    slotId = (await template(long)).entries[0].slotId;
    await patchEntries(long, [
      { startTime: "20:00", kind: "program", lengthMs: 30 * MIN, whatAirs: "next_episode", programIds: [long.programId], slotId },
      { startTime: "20:30", kind: "program", itemId: night.id }
    ]);
    expect(await episodesOn(long, "2026-10-31")).toEqual(["20:00 ep. 2", "20:40 Night Desk"]);
  });

  it("is a warning, with the episode and the minutes, where it would push an entry kept at its time; that date doesn't use an episode", async () => {
    await patchEntries(long, [
      { startTime: "20:00", kind: "program", lengthMs: 30 * MIN, whatAirs: "next_episode", programIds: [long.programId], slotId },
      { startTime: "20:30", kind: "program", itemId: night.id, keepTime: true }
    ]);
    expect(await episodesOn(long, "2026-10-31")).toEqual(["20:30 Night Desk"]);
    const tpl = await template(long);
    expect(tpl.dates.find((d: { date: string }) => d.date === "2026-10-31").warnings).toEqual([
      expect.objectContaining({ code: "pushes_kept", message: "Long Talk, ep. 2 would push Night Desk 10 min past 8:30 pm on Sat Oct 31, where it's kept. What doesn't fit before 8:30 pm isn't placed that day." })
    ]);
    // November 7 gets ep. 2 (and the same warning).
    expect(await episodesOn(long, "2026-11-07")).toEqual(["20:30 Night Desk"]);
    expect((await logOf(long, "2026-11-07")).warnings[0].message).toContain("Long Talk, ep. 2 would push Night Desk");
  });
});

describe("a date where the slot didn't air", () => {
  it("uses no episode: the next date gets it (the as-run log says what aired)", async () => {
    const quiet = await setup("QUIE", 171, { title: "Quiet Hours", count: 5 });
    const slotId = (await template(quiet)).entries[0].slotId;
    await patchEntries(quiet, [{ startTime: "20:00", kind: "program", lengthMs: 30 * MIN, whatAirs: "next_episode", programIds: [quiet.programId], slotId }]);
    expect(await episodesOn(quiet, "2026-10-31")).toEqual(["20:00 ep. 2"]);
    // Monday, November 2: October 24 aired ep. 1 (as-run); October 31's ep. 2 didn't air (off air).
    const [oct24] = await h.db.select().from(schema.logEntries).where(eq(schema.logEntries.templateSlotId, slotId)).orderBy(asc(schema.logEntries.startsAt));
    await h.db.insert(schema.asRun).values({ stationId: quiet.id, code: "PGM", startedAt: oct24.startsAt, endedAt: oct24.endsAt, logEntryId: oct24.id, assetId: oct24.assetId, programId: quiet.programId, reason: "planned" });
    h.clock.set("2026-11-02T20:00:00.000Z");
    expect(await episodesOn(quiet, "2026-11-07")).toEqual(["20:00 ep. 2"]);
    expect(await episodesOn(quiet, "2026-11-14")).toEqual(["20:00 ep. 3"]);
  });
});
