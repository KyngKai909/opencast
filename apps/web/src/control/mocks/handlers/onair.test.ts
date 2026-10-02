// @vitest-environment node
// A new station, start to finish on the mocks: create it, choose a call sign and channel, put a
// program and a station ID in its library, fill the log, pass the checks, sign on.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import type { LibraryItem } from "@opencast/contracts";
import { getDb, resetDb } from "../db";
import { MOCK_TOKEN_PREFIX } from "../../../auth/mockToken";
import { handlers } from "./index";
import { now } from "../../../lib/clock";
import { addDays, broadcastDay, isoDate } from "../../components/onair/time";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => resetDb());

async function api(path: string, init: { method?: string; body?: unknown; as?: string } = {}) {
  const res = await fetch(`http://localhost/v1${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${MOCK_TOKEN_PREFIX}${init.as ?? "new@example.com"}`, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  return { status: res.status, body: await res.json() };
}

function libraryItem(stationId: string, o: Partial<LibraryItem>): LibraryItem {
  const beat = getDb().library.items[0];
  return { ...beat, id: crypto.randomUUID(), stationId, programId: null, folderId: null, episodeNumber: null, ...o } as LibraryItem;
}

describe("signing on a new station", () => {
  it("goes from nothing to on air", async () => {
    const made = await api("/stations", { method: "POST", body: { name: "Test Station", colour: "#1F5E8C" } });
    expect(made.status).toBe(201);
    const id = made.body.station.id as string;
    expect(made.body.status).toBe("setting_up");

    // The dial: BEAT's 12 is taken, 13 is open; the frame's taken channels are struck through.
    const channels = await api("/markets/inland-empire/channels?band=tv");
    const state = (c: string) => channels.body.channels.find((x: { channel: string }) => x.channel === c).state;
    expect(["7.1", "9.1", "12.1", "18.1", "24.1", "31.1"].map(state)).toEqual(["taken", "taken", "taken", "taken", "taken", "taken"]);
    expect(state("13.1")).toBe("open");
    expect((await api(`/stations/${id}/channel`, { method: "PUT", body: { marketId: channels.body.market.id, band: "tv", channel: "12.1" } })).status).toBe(409);
    expect((await api(`/stations/${id}/channel`, { method: "PUT", body: { marketId: channels.body.market.id, band: "tv", channel: "13.1" } })).status).toBe(200);
    // The radio band is on even tenths: a real FM number (odd) isn't on it.
    const radio = await api("/markets/inland-empire/channels?band=radio");
    const freqs = radio.body.channels.map((x: { channel: string }) => x.channel);
    expect([freqs.length, freqs[0], freqs[freqs.length - 1]]).toEqual([99, "88.2", "107.8"]);
    expect(radio.body.channels.find((x: { channel: string }) => x.channel === "88.4").state).toBe("taken");
    expect((await api(`/stations/${id}/channel`, { method: "PUT", body: { marketId: channels.body.market.id, band: "radio", channel: "99.1" } })).status).toBe(422);

    expect((await api("/call-signs/BEAT")).body).toMatchObject({ valid: true, available: false });
    expect((await api("/call-signs/TEST")).body).toMatchObject({ valid: true, available: true });
    expect((await api(`/stations/${id}/setup`, { method: "PATCH", body: { callSign: "TEST" } })).status).toBe(200);

    // Nothing on the log: the checks block sign-on.
    let checks = await api(`/stations/${id}/sign-on/checks`);
    expect(checks.body.ready).toBe(false);
    expect((await api(`/stations/${id}/sign-on`, { method: "POST" })).status).toBe(409);

    // A program and a station ID, then the next 24 hours filled from the library.
    const show = libraryItem(id, { title: "First show", code: "PGM", durationMs: 29 * 60_000 });
    const sid = libraryItem(id, { title: "TEST station ID", code: "SID", durationMs: 5000 });
    getDb().library.items.push(show, sid);
    const dead = await api(`/stations/${id}/dead-air`);
    const gap = dead.body.gaps[0];
    const filled = await api(`/stations/${id}/log/fill`, { method: "POST", body: { with: "repeat", startsAt: gap.startsAt, endsAt: gap.endsAt, itemIds: [show.id] } });
    expect(filled.status).toBe(200);
    expect(filled.body.length).toBeGreaterThan(40);

    checks = await api(`/stations/${id}/sign-on/checks`);
    expect(checks.body.checks.filter((c: { passed: boolean; blocking: boolean }) => c.blocking && !c.passed)).toEqual([]);
    expect(checks.body.ready).toBe(true);

    // Only an owner signs on; the first sign-on fixes the call sign and channel.
    expect((await api(`/stations/${id}/sign-on`, { method: "POST", as: "kai@example.com" })).status).toBe(403);
    const on = await api(`/stations/${id}/sign-on`, { method: "POST" });
    expect(on.status).toBe(202);
    expect(on.body.onAir).toBe(true);
    expect((await api(`/stations/${id}/setup`, { method: "PATCH", body: { callSign: "TSTS" } })).status).toBe(409);

    // Signing off is the owner's too.
    const off = await api(`/stations/${id}/sign-off`, { method: "POST", body: { permanently: false } });
    expect(off.body.onAir).toBe(false);
  });

  it("won't take a colour that fails 4.5:1", async () => {
    const r = await api("/stations", { method: "POST", body: { name: "Pale", colour: "#F0C040" } });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/needs 4.5:1/);
  });
});

describe("the log", () => {
  it("fills a gap by signing off, and takes it back", async () => {
    const beat = getDb().stations.find((s) => s.ident.callSign === "BEAT")!.ident.id;
    const dead = await api(`/stations/${beat}/dead-air`, { as: "kai@example.com" });
    // A gap that starts later (the one starting now moves with the clock).
    const gap = dead.body.gaps.find((g: { startsAt: string }) => Date.parse(g.startsAt) > Date.now() + 60_000);
    const made = await api(`/stations/${beat}/log/fill`, { method: "POST", as: "kai@example.com", body: { with: "sign_off", startsAt: gap.startsAt, endsAt: gap.endsAt } });
    expect(made.body).toHaveLength(1);
    expect(made.body[0]).toMatchObject({ kind: "off_air", title: "Off air" });
    const starts = async () => (await api(`/stations/${beat}/dead-air`, { as: "kai@example.com" })).body.gaps.map((g: { startsAt: string }) => g.startsAt);
    expect(await starts()).not.toContain(gap.startsAt);
    // Hosts can't change the log.
    expect((await api(`/stations/${beat}/log/${made.body[0].id}`, { method: "DELETE", as: "jen@example.com" })).status).toBe(403);
    expect((await api(`/stations/${beat}/log/${made.body[0].id}`, { method: "DELETE", as: "kai@example.com" })).status).toBe(200);
    expect(await starts()).toContain(gap.startsAt);
  });

  it("repeats a day, lists the repeat, and takes it off again (G7, a day template since G8)", async () => {
    const beat = getDb().stations.find((x) => x.ident.callSign === "BEAT")!.ident.id;
    // BEAT's own templates stopped first: a more specific one (weekdays, every Saturday) would win the dates.
    for (const t of (await api(`/stations/${beat}/log/templates`, { as: "kai@example.com" })).body.templates) {
      expect((await api(`/stations/${beat}/log/templates/${t.id}`, { method: "DELETE", as: "kai@example.com" })).status).toBe(200);
    }
    // The day of BEAT's next program, copied onto the next three days.
    const next = getDb().log.filter((e) => e.stationId === beat && e.startsAt > now().toISOString()).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]!;
    const day = isoDate(broadcastDay(next.startsAt));
    const until = isoDate(addDays(broadcastDay(next.startsAt), 3));
    const made = await api(`/stations/${beat}/log/repeat`, { method: "POST", as: "kai@example.com", body: { day, pattern: "daily", until } });
    expect(made.body.created).toBeGreaterThan(0);
    const window = `from=${encodeURIComponent(now().toISOString())}&to=${encodeURIComponent(new Date(now().getTime() + 4 * 86_400_000).toISOString())}`;
    const log = await api(`/stations/${beat}/log?${window}`, { as: "kai@example.com" });
    const rep = log.body.repeats.find((r: { day: string; pattern: string }) => r.day === day && r.pattern === "daily");
    expect(rep).toMatchObject({ until, entries: expect.any(Number), template: true, label: "Every day", id: made.body.templateId });
    expect(rep.entries).toBeGreaterThan(0);
    const out = await api(`/stations/${beat}/log/repeats/${rep.id}`, { method: "DELETE", as: "kai@example.com" });
    expect(out.body.removed).toBe(rep.entries);
    const after = await api(`/stations/${beat}/log?${window}`, { as: "kai@example.com" });
    expect(after.body.repeats.some((r: { id: string }) => r.id === rep.id)).toBe(false);
  });

  it("returns what each break holds (G1), the station ID last", async () => {
    const beat = getDb().stations.find((s) => s.ident.callSign === "BEAT")!.ident.id;
    const b = getDb().breaks.find((x) => x.stationId === beat && x.origin === "carried_barter")!;
    const log = await api(`/stations/${beat}/log?from=${encodeURIComponent(new Date(Date.parse(b.startsAt) - 60_000).toISOString())}&to=${encodeURIComponent(new Date(Date.parse(b.startsAt) + 60_000).toISOString())}`, { as: "kai@example.com" });
    const rows = log.body.breaks[0].rows;
    expect(rows[0]).toMatchObject({ code: "SPT", title: "Mission Soda", whose: "producer" });
    expect(rows.reduce((a: number, r: { lengthMs: number }) => a + r.lengthMs, 0)).toBe(b.lengthMs);
  });
});
