// A246 (decision 6): "Reset to template". A date a day template made and that was edited by hand
// since (an exception) is made again from the template: entries and blocks put on by hand come
// off, the template's go back on, and the date stops being an exception. Dates from tomorrow on;
// a date the template didn't make isn't one to reset. Against the local Postgres (no ffmpeg).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let beat: string;
let saturdays: string;
let morning: { id: string };
let show: { id: string };
let extra: { id: string };

// Monday, October 26, 2026, noon in Los Angeles (PDT).
const MONDAY_NOON = "2026-10-26T19:00:00.000Z";
const NOV7 = { from: "2026-11-07T14:00:00.000Z", to: "2026-11-08T14:00:00.000Z" };

const logOf = async (from: string, to: string) => (await kai.get(`/v1/stations/${beat}/log?from=${from}&to=${to}`).expect(200)).body;
const titled = (entries: Array<{ startsAt: string; title: string }>) => entries.map((e) => `${e.startsAt} ${e.title}`);

beforeAll(async () => {
  h = await createHarness();
  h.clock.set(MONDAY_NOON);
  const m = await market(h);
  kai = await h.signIn("Kai");
  beat = (await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true, colour: "#8C3B7A" })).id;
  morning = await itemFixture(h, beat, { title: "Morning Set" });
  show = await itemFixture(h, beat, { title: "Late Crate" });
  extra = await itemFixture(h, beat, { title: "Crate Session" });
  // Saturday, October 31: Morning Set at 9:00 am and Late Crate at 8:00 pm, every Saturday.
  await kai.post(`/v1/stations/${beat}/log`, { kind: "program", startsAt: "2026-10-31T16:00:00.000Z", itemId: morning.id }).expect(201);
  await kai.post(`/v1/stations/${beat}/log`, { kind: "program", startsAt: "2026-11-01T03:00:00.000Z", itemId: show.id }).expect(201);
  saturdays = (await kai.post(`/v1/stations/${beat}/log/templates`, { fromDay: "2026-10-31", pattern: "weekly" }).expect(201)).body.template.id;
}, 60_000);
afterAll(() => h.close());

describe("resetting a date to its template", () => {
  it("takes what was done by hand off the date and puts the template's day back, no longer an exception", async () => {
    const before = await logOf(NOV7.from, NOV7.to);
    const late = before.entries.find((e: { title: string }) => e.title === "Late Crate");
    // November 7 by hand: Late Crate an hour later, Crate Session at 2:00 pm, and a block from 6:00 pm.
    const block = (await kai.post(`/v1/stations/${beat}/blocks`, { name: "Late Crate Nights" }).expect(201)).body;
    await kai
      .post(`/v1/stations/${beat}/log/changes`, {
        changes: [
          { op: "move", entryId: late.id, startsAt: "2026-11-08T05:00:00.000Z" },
          { op: "insert", entry: { kind: "program", startsAt: "2026-11-07T22:00:00.000Z", itemId: extra.id } },
          { op: "block_add", blockId: block.id, startsAt: "2026-11-08T02:00:00.000Z", endsAt: "2026-11-08T04:00:00.000Z" }
        ]
      })
      .expect(200);
    const edited = (await kai.get(`/v1/stations/${beat}/log/templates/${saturdays}`).expect(200)).body;
    expect(edited.dates.find((d: { date: string }) => d.date === "2026-11-07")).toMatchObject({ edited: true });

    const reset = await kai.post(`/v1/stations/${beat}/log/templates/${saturdays}/dates/2026-11-07/reset`).expect(200);
    // Crate Session and the moved Late Crate come off; Late Crate goes back on at 8:00 pm.
    expect(reset.body.generated).toEqual({ dates: 1, created: 1, removed: 2, skippedForConflicts: 0, exceptions: 0 });
    expect(reset.body.template.dates.find((d: { date: string }) => d.date === "2026-11-07")).toEqual({ date: "2026-11-07", edited: false, entries: 2, skipped: 0 });
    const after = await logOf(NOV7.from, NOV7.to);
    expect(titled(after.entries)).toEqual(["2026-11-07T17:00:00.000Z Morning Set", "2026-11-08T04:00:00.000Z Late Crate"]);
    expect(after.blocks ?? []).toEqual([]);
    expect(after.days).toContainEqual({ date: "2026-11-07", templateId: saturdays, templateName: null, label: "Every Saturday", edited: false });
  });

  it("leaves a date that wasn't edited as it is", async () => {
    const again = await kai.post(`/v1/stations/${beat}/log/templates/${saturdays}/dates/2026-11-07/reset`).expect(200);
    expect(again.body.generated).toEqual({ dates: 0, created: 0, removed: 0, skippedForConflicts: 0, exceptions: 0 });
  });

  it("refuses a date that has started, and one the template didn't make", async () => {
    const today = await kai.post(`/v1/stations/${beat}/log/templates/${saturdays}/dates/2026-10-26/reset`).expect(409);
    expect(today.body.error).toMatchObject({ code: "date_started", message: "Oct 26 has started. Only dates from tomorrow on can be reset to their template." });
    // Sunday, November 8: no template makes it.
    expect((await kai.post(`/v1/stations/${beat}/log/templates/${saturdays}/dates/2026-11-08/reset`).expect(404)).body.error.code).toBe("not_found");
  });

  it("is for the station's owners and operators", async () => {
    // Someone else doesn't learn the station's templates are there.
    const someone = await h.signIn("Someone");
    await someone.post(`/v1/stations/${beat}/log/templates/${saturdays}/dates/2026-11-07/reset`).expect(404);
  });
});
