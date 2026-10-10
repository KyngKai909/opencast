// The mock's break rule (A246 phase 3): `previewBreakRule` answers what `getLog` shows after
// `setBreakRule` saves the same rule, writes nothing, keeps breaks within 20 minutes as they are,
// refuses what saving refuses; S20's `cadence.upNext` stays when left out and is cleared by null.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupServer } from "msw/node";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { mockTokenFor } from "../../../auth/mockToken";
import { getDb, resetDb } from "../db";
import { breakRuleOf, resetStationState } from "../fixtures/station";
import { BEAT } from "../fixtures/stations";
import { handlers } from ".";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetStationState();
});

const api = async (method: string, path: string, body?: unknown, who = "kai") => {
  const headers: Record<string, string> = { authorization: `Bearer ${mockTokenFor(`${who}@example.com`)}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`http://api.test/v1/stations/${BEAT.id}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
};
// 8:00 pm to 11:00 pm on the mock's Saturday.
const FROM = "2026-09-27T03:00:00.000Z";
const TO = "2026-09-27T06:00:00.000Z";
type Slot = { id: string | null; startsAt: string; keeps?: boolean; rows: Array<{ code: string; title: string; lengthMs: number }> };
const shape = (breaks: Slot[]) => breaks.map((b) => ({ startsAt: b.startsAt, rows: b.rows.map((r) => `${r.code} ${r.lengthMs}`) }));

describe("the mock's break rule preview", () => {
  it("answers what getLog shows after saving the same rule, and writes nothing", async () => {
    const rule = (await api("GET", "/break-rule")).json;
    const next = { ...rule, cadence: { ...rule.cadence, underwriting: { every: "never" }, stationId: { every: "hour" } } };
    const before = JSON.stringify(getDb());
    const seen = await api("POST", "/break-rule/preview", { rule: next, from: FROM, to: TO });
    expect(seen.status).toBe(200);
    expect(JSON.stringify(getDb())).toBe(before);
    expect(breakRuleOf(BEAT.id).cadence?.underwriting).toEqual({ every: "break" });
    const saved = await api("PUT", "/break-rule", next);
    expect(seen.json.rule).toEqual(saved.json);
    const log = (await api("GET", `/log?from=${FROM}&to=${TO}`)).json;
    expect(shape(seen.json.breaks)).toEqual(shape(log.breaks));
    // Breaks within 20 minutes of 8:42 pm keep what they have; later ones take the rule.
    expect(seen.json.breaks.filter((b: Slot) => b.keeps).map((b: Slot) => b.startsAt)).toEqual(["2026-09-27T03:28:28.000Z", "2026-09-27T03:44:00.000Z", "2026-09-27T03:59:00.000Z"]);
    const later = seen.json.breaks.filter((b: Slot) => !b.keeps);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((b: Slot) => !b.rows.some((r) => r.code === "UND"))).toBe(true);
  });

  it("refuses what saving refuses, and a window over three hours", async () => {
    const rule = (await api("GET", "/break-rule")).json;
    const bad = { ...rule, mode: "every_n_minutes", everyMinutes: null };
    expect((await api("POST", "/break-rule/preview", { rule: bad, from: FROM, to: TO })).status).toBe(400);
    expect((await api("PUT", "/break-rule", bad)).status).toBe(400);
    const never = { ...rule, cadence: { ...rule.cadence, stationId: { every: "never" } } };
    expect((await api("POST", "/break-rule/preview", { rule: never, from: FROM, to: TO })).status).toBe(400);
    expect((await api("PUT", "/break-rule", never)).status).toBe(400);
    expect((await api("POST", "/break-rule/preview", { rule, from: FROM, to: "2026-09-27T06:00:01.000Z" })).status).toBe(400);
    expect((await api("POST", "/break-rule/preview", { rule, from: FROM, to: TO }, "jen")).status).toBe(403);
  });

  it("S20: Up next's own cadence stays when left out; null clears it", async () => {
    const rule = (await api("GET", "/break-rule")).json;
    expect(rule.cadence).not.toHaveProperty("upNext");
    await api("PUT", "/break-rule", { ...rule, cadence: { ...rule.cadence, upNext: { every: "hour" } } });
    expect((await api("PUT", "/break-rule", rule)).json.cadence.upNext).toEqual({ every: "hour" });
    expect((await api("PUT", "/break-rule", { ...rule, cadence: { ...rule.cadence, upNext: null } })).json.cadence).not.toHaveProperty("upNext");
  });
});

describe("A247: when breaks come, in the mock", () => {
  // 10:00 to 11:00 pm: Late Crate, ep. 15 (10:00 to 10:28:28) and Slow Hours, carried (10:30:28 to 11:40).
  const HOUR_FROM = "2026-09-27T05:00:00.000Z";
  const HOUR_TO = "2026-09-27T06:00:00.000Z";
  const times = (breaks: Slot[]) => breaks.map((b) => b.startsAt.slice(11, 19));

  it("clock breaks at :15 and :45 show in the preview, and in getLog once saved", async () => {
    const rule = { ...breakRuleOf(BEAT.id), mode: "every_n_minutes", everyMinutes: 30, clockMinutes: [45, 15] };
    const seen = await api("POST", "/break-rule/preview", { rule, from: HOUR_FROM, to: HOUR_TO });
    expect(seen.status).toBe(200);
    expect(seen.json.rule).toMatchObject({ clockMinutes: [15, 45], everyMinutes: 30 });
    // Late Crate fills its slot, so 10:15 doesn't fit (it isn't cut for a break); Slow Hours pauses at 10:45.
    expect(times(seen.json.breaks)).toEqual(["05:28:28", "05:45:00"]);
    expect((await api("PUT", "/break-rule", rule)).status).toBe(200);
    const log = await api("GET", `/log?from=${HOUR_FROM}&to=${HOUR_TO}`);
    expect(times(log.json.breaks)).toEqual(times(seen.json.breaks));
  });

  it("after every N programs, and inside long programs", async () => {
    const base = breakRuleOf(BEAT.id);
    const every = await api("POST", "/break-rule/preview", { rule: { ...base, mode: "after_every_program", everyMinutes: null }, from: HOUR_FROM, to: HOUR_TO });
    expect(times(every.json.breaks)).toEqual(["05:28:28"]);
    // Late Crate, ep. 15 is the evening's 4th program (Beat Tape Live, live, isn't counted).
    const two = await api("POST", "/break-rule/preview", { rule: { ...base, mode: "after_every_program", everyMinutes: null, everyPrograms: 2 }, from: HOUR_FROM, to: HOUR_TO });
    expect(times(two.json.breaks)).toEqual(["05:28:28"]);
    const three = await api("POST", "/break-rule/preview", { rule: { ...base, mode: "after_every_program", everyMinutes: null, everyPrograms: 3 }, from: HOUR_FROM, to: HOUR_TO });
    expect(times(three.json.breaks)).toEqual([]);
    const long = await api("POST", "/break-rule/preview", { rule: { ...base, mode: "after_every_program", everyMinutes: null, longPrograms: { overMs: 45 * 60_000, everyMs: 20 * 60_000 } }, from: HOUR_FROM, to: HOUR_TO });
    // Slow Hours runs 69 minutes: every 20 inside it.
    expect(times(long.json.breaks)).toEqual(["05:28:28", "05:50:28"]);
  });

  it("refuses what the API refuses, and an older body keeps the clock until it changes the minutes", async () => {
    const base = breakRuleOf(BEAT.id);
    expect((await api("PUT", "/break-rule", { ...base, clockMinutes: [15, 20] })).json.error.message).toBe("Leave at least 10 minutes between break times.");
    expect((await api("PUT", "/break-rule", { ...base, mode: "none", everyPrograms: 2 })).json.error.message).toBe("Breaks after every N programs go with breaks after every program.");
    expect((await api("PUT", "/break-rule", { ...base, longPrograms: { overMs: 45 * 60_000, everyMs: 30 * 60_000 } })).json.error.message).toBe("Every N minutes already breaks inside every program.");
    await api("PUT", "/break-rule", { ...base, clockMinutes: [15, 45] });
    const { clockMinutes: _c, everyPrograms: _p, longPrograms: _l, ...old } = breakRuleOf(BEAT.id);
    expect((await api("PUT", "/break-rule", { ...old, lengthMs: 90_000 })).json).toMatchObject({ clockMinutes: [15, 45], lengthMs: 90_000 });
    expect((await api("PUT", "/break-rule", { ...old, everyMinutes: 20 })).json).toMatchObject({ clockMinutes: null, everyMinutes: 20 });
  });
});
