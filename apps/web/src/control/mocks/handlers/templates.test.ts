// @vitest-environment node
// Day templates and off air hours on the mocks (G8, G9): BEAT's templates, making, changing and
// stopping one, the off air hours and their 400, and planned off air kept out of dead air. G18:
// "Keep at this time" as the API keeps it: the batch's `keep`, a kept entry's move refused, and a
// template made from a day carrying the mark onto its dates.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// On the reference's Saturday, 8:42:12 pm, whatever the real time is: the mock clock, as dev:mock
// runs it. (On the real clock, the sign-off that runs into the off air hours wasn't the one found
// just after midnight, and never meets them once Pacific time is UTC-8: the fixtures are UTC-7.)
vi.mock("../../../config", async (importOriginal) => {
  const { config } = await importOriginal<typeof import("../../../config")>();
  return { config: { ...config, mock: true, mockClock: "2026-09-27T03:42:12Z" } };
});
import { setupServer } from "msw/node";
import { getDb, resetDb } from "../db";
import { MOCK_TOKEN_PREFIX } from "../../../auth/mockToken";
import { handlers } from "./index";
import { now } from "../../../lib/clock";
import { addDays, broadcastDay, isoDate, viewWindow, weekdayOf } from "../../components/onair/time";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => resetDb());

async function api(path: string, init: { method?: string; body?: unknown; as?: string } = {}) {
  const res = await fetch(`http://localhost/v1${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${MOCK_TOKEN_PREFIX}${init.as ?? "kai@example.com"}`, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  return { status: res.status, body: await res.json() };
}

const beat = () => getDb().stations.find((s) => s.ident.callSign === "BEAT")!.ident.id;
const overlaps = (a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;

describe("day templates (G8)", () => {
  it("lists BEAT's: weekdays (After work, with an edited date) and every week on tonight's day", async () => {
    const r = await api(`/stations/${beat()}/log/templates`);
    expect(r.status).toBe(200);
    const [weekdays, weekly] = r.body.templates;
    expect(weekdays).toMatchObject({ name: "After work", pattern: "weekdays", label: "Weekdays", weekday: null });
    expect(weekdays.dates.filter((d: { edited: boolean }) => d.edited)).toHaveLength(1);
    expect(weekly).toMatchObject({ name: null, pattern: "weekly", label: expect.stringMatching(/^Every [A-Z][a-z]+day$/) });
    expect(weekly.entries.length).toBeGreaterThan(5);
    expect(weekly.dates).toHaveLength(3);
    // Hosts don't see them.
    expect((await api(`/stations/${beat()}/log/templates`, { as: "jen@example.com" })).status).toBe(403);
  });

  it("makes a template from a day, and says what it made", async () => {
    const next = getDb().log.filter((e) => e.stationId === beat() && e.startsAt > now().toISOString()).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]!;
    const fromDay = isoDate(broadcastDay(next.startsAt));
    const onto = isoDate(addDays(broadcastDay(next.startsAt), 2));
    const made = await api(`/stations/${beat()}/log/templates`, { method: "POST", body: { fromDay, pattern: "once", onto } });
    expect(made.status).toBe(201);
    expect(made.body.template).toMatchObject({ pattern: "once", onDate: onto, label: expect.stringMatching(/^Once, [A-Z][a-z]{2} [A-Z][a-z]{2} \d+$/) });
    expect(made.body.generated.dates).toBeGreaterThanOrEqual(1);
    const date = made.body.template.dates.find((d: { date: string }) => d.date === onto);
    expect(date).toMatchObject({ edited: false });
    expect(date.entries).toBeGreaterThan(0);
    expect(made.body.generated.created).toBeGreaterThanOrEqual(date.entries);
    // Its entries are on the log that day.
    expect(getDb().log.filter((e) => e.repeatGroupId === made.body.template.id)).toHaveLength(date.entries);
  });

  it("asks for the day to copy to, and a last day after the first", async () => {
    const day = isoDate(broadcastDay(now()));
    const once = await api(`/stations/${beat()}/log/templates`, { method: "POST", body: { fromDay: day, pattern: "once" } });
    expect(once.status).toBe(400);
    expect(once.body.error).toMatchObject({ message: "Choose the day to copy to.", fields: { onto: "Required" } });
    const until = await api(`/stations/${beat()}/log/templates`, { method: "POST", body: { fromDay: day, pattern: "daily", until: day } });
    expect(until.status).toBe(400);
    expect(until.body.error.fields).toEqual({ until: "Before the day" });
  });

  it("renames one, changes when it repeats, leaves edited dates alone, and stops it", async () => {
    const [weekdays] = (await api(`/stations/${beat()}/log/templates`)).body.templates;
    const edited = new Set<string>(weekdays.dates.filter((d: { edited: boolean }) => d.edited).map((d: { date: string }) => d.date));
    const renamed = await api(`/stations/${beat()}/log/templates/${weekdays.id}`, { method: "PATCH", body: { name: "Weeknights" } });
    expect(renamed.body.template.name).toBe("Weeknights");
    const daily = await api(`/stations/${beat()}/log/templates/${weekdays.id}`, { method: "PATCH", body: { pattern: "daily" } });
    expect(daily.body.template).toMatchObject({ pattern: "daily", label: "Every day" });
    // The edited Wednesday stays as it is.
    expect(daily.body.generated.exceptions).toBeGreaterThanOrEqual(1);
    const stop = await api(`/stations/${beat()}/log/templates/${weekdays.id}`, { method: "DELETE" });
    expect(stop.status).toBe(200);
    expect(stop.body.removed).toBeGreaterThan(0);
    expect((await api(`/stations/${beat()}/log/templates/${weekdays.id}`)).status).toBe(404);
    // A132: the dates ahead that weren't edited are cleared; the edited Wednesday stays as it is.
    const left = getDb().log.filter((e) => e.repeatGroupId === weekdays.id && e.startsAt > now().toISOString());
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((e) => edited.has(isoDate(broadcastDay(e.startsAt))))).toBe(true);
  });

  it("says which template made each broadcast day on the log, past days and edited ones too (G11)", async () => {
    const [weekdays] = (await api(`/stations/${beat()}/log/templates`)).body.templates;
    const today = broadcastDay(now());
    const week = viewWindow("week", today);
    const log = (await api(`/stations/${beat()}/log?from=${encodeURIComponent(week.from)}&to=${encodeURIComponent(week.to)}`)).body;
    expect(log.days).toHaveLength(7);
    // This week's weekdays before today were made from "After work".
    for (const d of log.days) {
      const made = d.date > weekdays.fromDay && d.date < isoDate(today) && weekdayOf(broadcastDay(`${d.date}T19:00:00.000Z`)) % 6 !== 0;
      if (made) expect(d).toEqual({ date: d.date, templateId: weekdays.id, templateName: "After work", label: "Weekdays", edited: false });
      if (d.date === weekdays.fromDay) expect(d.templateId).toBeNull();
    }
    const editedDate = weekdays.dates.find((d: { edited: boolean }) => d.edited).date as string;
    const [y, m, dd] = editedDate.split("-").map(Number);
    const day = viewWindow("day", { year: y, month: m, day: dd });
    const one = (await api(`/stations/${beat()}/log?from=${encodeURIComponent(day.from)}&to=${encodeURIComponent(day.to)}`)).body;
    expect(one.days).toEqual([{ date: editedDate, templateId: weekdays.id, templateName: "After work", label: "Weekdays", edited: true }]);
  });

  it("makes a date an exception when it's edited by hand", async () => {
    const [weekdays] = (await api(`/stations/${beat()}/log/templates`)).body.templates;
    const date = weekdays.dates.find((d: { edited: boolean }) => !d.edited).date as string;
    const [y, m, d] = date.split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, d, 13)).toISOString();
    const to = new Date(Date.UTC(y, m - 1, d + 1, 13)).toISOString();
    const log = await api(`/stations/${beat()}/log?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    const made = log.body.entries.find((e: { repeatGroupId: string | null }) => e.repeatGroupId === weekdays.id);
    expect(made).toBeTruthy();
    expect((await api(`/stations/${beat()}/log/${made.id}`, { method: "DELETE" })).status).toBe(200);
    const after = (await api(`/stations/${beat()}/log/templates/${weekdays.id}`)).body;
    expect(after.dates.find((x: { date: string }) => x.date === date).edited).toBe(true);
  });
});

describe("off air hours (G9)", () => {
  it("reads BEAT's: every night, 2:00 to 6:00 am", async () => {
    const r = await api(`/stations/${beat()}/off-air-hours`);
    expect(r.body).toMatchObject({ timezone: "America/Los_Angeles", rules: [{ days: [0, 1, 2, 3, 4, 5, 6], signOffAt: "02:00", backAt: "06:00", label: "Every night, 2:00 am to 6:00 am" }] });
    expect(r.body.next).toMatchObject({ source: expect.stringMatching(/^(hours|sign_off)$/) });
  });

  it("replaces every rule, and refuses one that signs off and back on at the same time", async () => {
    const same = await api(`/stations/${beat()}/off-air-hours`, { method: "PUT", body: { rules: [{ days: [1], signOffAt: "02:00", backAt: "02:00" }] } });
    expect(same.status).toBe(400);
    expect(same.body.error).toMatchObject({ message: "Sign off and back on can't be the same time.", fields: { "rules.0.backAt": "Same as sign off" } });
    const set = await api(`/stations/${beat()}/off-air-hours`, { method: "PUT", body: { rules: [{ days: [5, 1, 2, 3, 4], signOffAt: "23:00", backAt: "06:00" }] } });
    expect(set.body.rules).toEqual([expect.objectContaining({ days: [1, 2, 3, 4, 5], label: "Weeknights, 11:00 pm to 6:00 am" })]);
    const none = await api(`/stations/${beat()}/off-air-hours`, { method: "PUT", body: { rules: [] } });
    expect(none.body.rules).toEqual([]);
    const eight = await api(`/stations/${beat()}/off-air-hours`, { method: "PUT", body: { rules: Array.from({ length: 8 }, () => ({ days: [1], signOffAt: "02:00", backAt: "06:00" })) } });
    expect(eight.status).toBe(400);
  });

  it("keeps planned off air out of dead air, and says so before sign-on", async () => {
    const t = now().getTime();
    const window = `from=${encodeURIComponent(new Date(t).toISOString())}&to=${encodeURIComponent(new Date(t + 2 * 86_400_000).toISOString())}`;
    const log = (await api(`/stations/${beat()}/log?${window}`)).body;
    expect(log.offAir.length).toBeGreaterThan(0);
    for (const o of log.offAir) for (const g of log.gaps) expect(overlaps(o, g)).toBe(false);
    // The sign-off tomorrow night runs into the hours: one stretch, back when they end.
    const signOff = log.offAir.find((o: { source: string }) => o.source === "sign_off");
    expect(signOff).toBeTruthy();
    const hours = log.offAir.find((o: { source: string; startsAt: string }) => o.source === "hours" && o.startsAt === signOff.endsAt);
    expect(hours).toBeTruthy();
    expect(signOff.backAt).toBe(hours.backAt);

    const dead = (await api(`/stations/${beat()}/dead-air`)).body;
    for (const o of dead.offAir) for (const g of dead.gaps) expect(overlaps(o, g)).toBe(false);

    const status = (await api(`/stations/${beat()}/playout`)).body;
    expect(status.offAir).toMatchObject({ now: expect.any(Boolean), backAt: expect.any(String) });

    const checks = (await api(`/stations/${beat()}/sign-on/checks`)).body.checks;
    expect(checks.find((c: { key: string }) => c.key === "off_air_hours")).toMatchObject({ label: "Off air hours planned", passed: true, blocking: false, detail: expect.stringMatching(/^Off air from .+, back at .+\. Not dead air: no warnings, nothing fills it$/) });
  });
});

describe("Keep at this time (G18)", () => {
  const sat = () => {
    const win = viewWindow("day", broadcastDay(now()));
    return { win, path: `/stations/${beat()}/log?from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}` };
  };
  const lateCrate15 = () => getDb().log.find((e) => e.stationId === beat() && e.title === "Late Crate, ep. 15" && e.localNote !== "Overnight repeat")!;

  it("marks an entry in a batch, checked first and then published, and the log says so", async () => {
    const id = lateCrate15().id;
    const check = await api(`/stations/${beat()}/log/changes`, { method: "POST", body: { dryRun: true, changes: [{ op: "keep", entryId: id, keep: true }] } });
    expect(check.status).toBe(200);
    expect(check.body.changes[0]).toMatchObject({ op: "keep", entryId: id, line: "Late Crate, ep. 15 keeps its time" });
    expect(lateCrate15().keepTime).toBeUndefined();
    expect((await api(`/stations/${beat()}/log/changes`, { method: "POST", body: { changes: [{ op: "keep", entryId: id, keep: true }] } })).body.applied).toBe(true);
    const log = (await api(sat().path)).body;
    expect(log.entries.find((e: { id: string }) => e.id === id).keepTime).toBe(true);
  });

  it("refuses to move a kept entry, unless the batch clears the mark first", async () => {
    const e = lateCrate15();
    e.keepTime = true;
    const earlier = new Date(Date.parse(e.startsAt) - 60_000).toISOString();
    const refused = await api(`/stations/${beat()}/log/changes`, { method: "POST", body: { dryRun: true, changes: [{ op: "move", entryId: e.id, startsAt: earlier }] } });
    expect(refused.body.problems).toEqual([{ index: 0, code: "kept", message: "Late Crate, ep. 15 is kept at its time. Turn off Keep at this time to move it." }]);
    const cleared = await api(`/stations/${beat()}/log/changes`, { method: "POST", body: { dryRun: true, changes: [{ op: "keep", entryId: e.id, keep: false }, { op: "move", entryId: e.id, startsAt: earlier }] } });
    expect(cleared.body.problems).toEqual([]);
    expect(cleared.body.changes[0].line).toBe("Late Crate, ep. 15 no longer keeps its time");
  });

  it("puts an entry on kept, and a template made from the day keeps the mark on its dates", async () => {
    lateCrate15().keepTime = true;
    const made = await api(`/stations/${beat()}/log/templates`, { method: "POST", body: { fromDay: isoDate(broadcastDay(now())), pattern: "once", onto: isoDate(addDays(broadcastDay(now()), 14)) } });
    expect(made.status).toBe(201);
    expect(made.body.template.entries.find((e: { title: string; startTime: string }) => e.title === "Late Crate, ep. 15" && e.startTime === "22:00").keepTime).toBe(true);
    const onto = addDays(broadcastDay(now()), 14);
    const w = viewWindow("day", onto);
    const log = (await api(`/stations/${beat()}/log?from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`)).body;
    expect(log.entries.filter((e: { keepTime?: boolean }) => e.keepTime).map((e: { title: string }) => e.title)).toEqual(["Late Crate, ep. 15"]);
  });
});
