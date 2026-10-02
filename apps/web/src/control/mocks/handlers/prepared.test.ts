// @vitest-environment node
// Prepare once, then assemble, on the mocks: the log's times on 4-second segment boundaries (as the
// API rounds them), the Monitor's readiness, the sign-on check `items_prepared`, and a library
// item's preparation. On the reference's Saturday, 8:42:12 pm.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupServer } from "msw/node";

// On the reference's Saturday, 8:42:12 pm, whatever the real time is: the mock clock, as dev:mock
// runs it. (Late Crate, ep. 15 is still being prepared until 9:30 pm; on the real clock after that,
// these would all read "ready".)
vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));
import { onSegment } from "@opencast/ui";
import { getDb, resetDb } from "../db";
import { MOCK_TOKEN_PREFIX } from "../../../auth/mockToken";
import { at } from "../fixtures/time";
import { handlers } from "./index";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => resetDb());

async function api(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`http://localhost/v1${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${MOCK_TOKEN_PREFIX}kai@example.com`, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  return { status: res.status, body: await res.json() };
}

const beat = () => getDb().stations.find((s) => s.ident.callSign === "BEAT")!.ident.id;
const item = (title: string) => getDb().library.items.find((i) => i.title === title)!;

describe("the log on segment boundaries", () => {
  it("answers tonight's log with every time on a boundary", async () => {
    const log = await api(`/stations/${beat()}/log?from=${at("18:00")}&to=${at("26:00")}`);
    expect(log.status).toBe(200);
    for (const e of log.body.entries) expect([e.startsAt, e.endsAt].every(onSegment)).toBe(true);
    for (const b of log.body.breaks) expect(onSegment(b.startsAt)).toBe(true);
    expect(log.body.entries.find((e: { title: string }) => e.title === "Late Crate, ep. 14").endsAt).toBe(at("20:28:28"));
  });

  it("rounds what it's sent to the nearest boundary, never refusing it", async () => {
    const made = await api(`/stations/${beat()}/log`, { method: "POST", body: { kind: "off_air", startsAt: at("+3 13:00:30"), endsAt: at("+3 13:30:01") } });
    expect(made.status).toBe(201);
    expect([made.body.startsAt, made.body.endsAt]).toEqual([at("+3 13:00:32"), at("+3 13:30")]);
    const moved = await api(`/stations/${beat()}/log/${made.body.id}`, { method: "PATCH", body: { startsAt: at("+3 13:01:29"), endsAt: at("+3 13:31:03") } });
    expect(moved.status).toBe(200);
    expect([moved.body.startsAt, moved.body.endsAt]).toEqual([at("+3 13:01:28"), at("+3 13:31:04")]);
  });

  it("fills a gap from the boundary nearest what it's sent", async () => {
    const made = await api(`/stations/${beat()}/log/fill`, { method: "POST", body: { with: "sign_off", startsAt: at("23:40:01"), endsAt: at("25:59:59") } });
    expect(made.status).toBe(200);
    expect([made.body[0].startsAt, made.body[0].endsAt]).toEqual([at("23:40"), at("26:00")]);
  });
});

describe("preparation for air", () => {
  it("the Monitor counts the next 48 hours' items and names the first not ready", async () => {
    const status = await api(`/stations/${beat()}/playout`);
    expect(status.status).toBe(200);
    expect(status.body.output.livepeerEnabled).toBe(false);
    const r = status.body.readiness;
    expect(r.items).toBeGreaterThan(1);
    // Late Crate, ep. 15 airs twice in the next 48 hours (10:00 pm and the 3:30 am repeat): it counts once (G13).
    expect(r.items - r.ready).toBe(1);
    expect(r).toMatchObject({ failed: 0, preparing: 1 });
    const entry = getDb().log.find((e) => e.itemId === item("Late Crate, ep. 15").id && e.startsAt === at("22:00"))!;
    expect(r.firstNotReady).toMatchObject({ itemId: item("Late Crate, ep. 15").id, title: "Late Crate, ep. 15", airsAt: at("22:00"), status: "preparing", entryId: entry.id });
  });

  it("tells an item that couldn't be prepared from one on its way (G14)", async () => {
    const broken = item("Late Crate, ep. 14");
    broken.status = "failed";
    const r = (await api(`/stations/${beat()}/playout`)).body.readiness;
    expect(r).toMatchObject({ failed: 1, preparing: 1 });
    const checks = await api(`/stations/${beat()}/sign-on/checks`);
    const c = checks.body.checks.find((x: { key: string }) => x.key === "items_prepared");
    expect(c.preparation).toMatchObject({ failed: 1, preparing: 1, firstFailed: { itemId: broken.id, title: "Late Crate, ep. 14" } });
    expect(c.preparation.ready + 2).toBe(c.preparation.items);
    expect(c.detail).toMatch(/\. 1 couldn't be prepared \(its file needs replacing\) and 1 is being prepared; anything not ready at air time airs station ID and bumpers$/);
  });

  it("the sign-on checks say how many of the next 24 hours' items are prepared, never blocking", async () => {
    const checks = await api(`/stations/${beat()}/sign-on/checks`);
    const c = checks.body.checks.find((x: { key: string }) => x.key === "items_prepared");
    expect(c).toMatchObject({ label: "Items prepared for air", passed: false, blocking: false });
    expect(c.detail).toMatch(/^\d+ of \d+ in the next 24 hours\. The rest are being prepared/);
    expect(c.preparation).toMatchObject({ failed: 0, preparing: 1, firstFailed: null });
  });

  it("a library item's history says where its preparation stands", async () => {
    const preparing = await api(`/library/${item("Late Crate, ep. 15").id}/history`);
    expect(preparing.body.preparation).toMatchObject({ status: "preparing", preparedAt: null });
    expect(preparing.body.cachedForAir).toBe(false);
    const ready = await api(`/library/${item("Late Crate, ep. 14").id}/history`);
    expect(ready.body.preparation).toMatchObject({ status: "ready", renditions: ["v1080", "v720", "v480", "v360", "a128"] });
    expect(ready.body.cachedForAir).toBe(true);
  });
});
