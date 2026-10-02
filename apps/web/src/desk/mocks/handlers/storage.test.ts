// The desk mock's Storage maintenance answers as the API does: admins only; a check reports and
// changes nothing; an apply changes what it said, in the background, and goes in the change log;
// one run of a job at a time; Pinata unset refuses an apply; nothing is ever unpinned.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpHandler } from "msw";
import { deskApi } from "@opencast/contracts";
import { apiFor } from "../testApi";

const NOW = new Date("2026-09-27T03:42:12Z");
const RAE = "rae@opencast.example";
const LEE = "lee@opencast.example";

let handlers: HttpHandler[];
let storage: typeof import("../storageDb");
let settings: typeof import("../settingsDb");
let api: ReturnType<typeof apiFor>;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  storage = await import("../storageDb");
  settings = await import("../settingsDb");
  handlers = (await import("./index")).handlers;
  api = apiFor(handlers);
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  localStorage.clear();
  settings.resetSettings();
  storage.resetStorage();
});

const later = (ms = storage.RUN_MS) => vi.setSystemTime(new Date(Date.now() + ms));

async function run(job: string, mode: "check" | "apply") {
  const started = await api("POST", "/admin/storage/runs", { body: { job, mode } });
  expect(started.status).toBe(202);
  later();
  return deskApi.getStorageRun.response.parse((await api("GET", `/admin/storage/runs/${started.json.id}`)).json);
}

describe("Storage maintenance on the mocks", () => {
  it("is admins only", async () => {
    for (const as of [RAE, LEE]) {
      const res = await api("GET", "/admin/storage", { as });
      expect(res).toMatchObject({ status: 403, json: { error: { code: "desk_role" } } });
      expect((await api("POST", "/admin/storage/runs", { as, body: { job: "relinkLocations", mode: "check" } })).status).toBe(403);
    }
    expect((await api("GET", "/admin/storage", { as: "other" })).status).toBe(403);
    const state = deskApi.getStorageMaintenance.response.parse((await api("GET", "/admin/storage")).json);
    expect(state.pinataConnected).toBe(true);
    expect(state.jobs.map((j) => [j.job, j.running, j.lastCheck?.by?.name ?? null, j.canApply])).toEqual([
      ["relinkLocations", null, null, true],
      ["copyPinata", null, null, true],
      ["prepareFromOriginals", null, "Sam K.", true]
    ]);
  });

  it("checks without changing anything, shows progress while it runs, and keeps the report", async () => {
    const started = await api("POST", "/admin/storage/runs", { body: { job: "relinkLocations", mode: "check" } });
    expect(started.json).toMatchObject({ status: "running", progress: { done: 0, total: 3 }, counts: null, hasReport: false });
    later(storage.RUN_MS / 2);
    expect((await api("GET", "/admin/storage")).json.jobs[0].running).toMatchObject({ progress: { done: 1, total: 3 } });
    expect((await api("GET", `/admin/storage/runs/${started.json.id}/report`)).json.error.code).toBe("still_running");
    later();
    const done = (await api("GET", `/admin/storage/runs/${started.json.id}`)).json;
    expect(done).toMatchObject({ status: "done", counts: { rows: 3, unreachable: 1, relinked: 0 }, by: { name: "Dee A." }, hasReport: true });
    const report = (await api("GET", `/admin/storage/runs/${started.json.id}/report`)).json;
    expect(report).toMatchObject({ relink: false, rows: 3, entries: expect.arrayContaining([expect.objectContaining({ reachable: false })]) });
    // A check changes nothing: the next check finds the same, and nothing's in the change log.
    expect((await run("relinkLocations", "check")).counts).toMatchObject({ rows: 3 });
    expect((await api("GET", "/admin/change-log", { query: { kind: "storage" } })).json).toEqual([]);
  });

  it("applies in the background, one run of a job at a time, and logs each apply", async () => {
    const first = await api("POST", "/admin/storage/runs", { body: { job: "prepareFromOriginals", mode: "apply" } });
    expect(first.status).toBe(202);
    const again = await api("POST", "/admin/storage/runs", { body: { job: "prepareFromOriginals", mode: "check" } });
    expect(again).toMatchObject({ status: 409, json: { error: { code: "already_running", message: "Items on their 720p copies: Dee A. started an apply that's still running. Wait for it to finish." } } });
    // Another job runs meanwhile.
    expect((await api("POST", "/admin/storage/runs", { body: { job: "relinkLocations", mode: "check" } })).status).toBe(202);
    later();
    expect((await api("GET", `/admin/storage/runs/${first.json.id}`)).json.counts).toMatchObject({ queued: 2, moved: 0, noOriginal: 1 });
    // Pressed again once the worker has prepared them: moved.
    expect((await run("prepareFromOriginals", "apply")).counts).toMatchObject({ queued: 0, moved: 2 });
    expect((await run("prepareFromOriginals", "check")).counts).toMatchObject({ items: 1, toPrepare: 0, noOriginal: 1 });
    const log = deskApi.changeLog.response.parse((await api("GET", "/admin/change-log", { query: { kind: "storage" } })).json);
    expect(log.map((e) => [e.by?.name, e.summary])).toEqual([
      ["Dee A.", "Items on their 720p copies: Moved 2 items onto their originals; 0 queued for preparing"],
      ["Dee A.", "Items on their 720p copies: Moved 0 items onto their originals; 2 queued for preparing"]
    ]);
  });

  it("copies Pinata pins but never unpins; unset, there's nothing to copy", async () => {
    const copied = await run("copyPinata", "apply");
    expect(copied.counts).toMatchObject({ connected: 1, moving: 0, staying: 2, copied: 0 });
    expect(JSON.stringify((await api("GET", `/admin/storage/runs/${copied.id}/report`)).json)).not.toMatch(/unpin/i);

    storage.storageDb().pinataConnected = false;
    const state = deskApi.getStorageMaintenance.response.parse((await api("GET", "/admin/storage")).json);
    expect(state).toMatchObject({ pinataConnected: false, jobs: [{}, { job: "copyPinata", canApply: false }, {}] });
    const check = await run("copyPinata", "check");
    expect(check.counts).toMatchObject({ connected: 0, moving: 0 });
    expect((await api("POST", "/admin/storage/runs", { body: { job: "copyPinata", mode: "apply" } })).json.error.code).toBe("pinata_not_connected");
  });

  it("a fresh check of every job on request", async () => {
    const state = deskApi.getStorageMaintenance.response.parse((await api("GET", "/admin/storage", { query: { check: "all" } })).json);
    expect(state.jobs.map((j) => j.running?.mode)).toEqual(["check", "check", "check"]);
  });
});
