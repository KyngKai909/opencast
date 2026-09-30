// The mock API's Storage maintenance (Network desk Settings, 2026-09-29): the one-off storage jobs
// as the API runs them, in the background. A run takes RUN_MS of the mock clock; its progress is
// the time gone, and what it does happens when it finishes (read lazily, on the next request).
// Seeded: 3 files stored by location (one can't be read), Pinata connected with only the catalog's
// 2 pins (nothing to copy), and 2 items still airing from their 720p copies (a third with no
// original). An apply's queued originals are prepared by the "worker" before the next run. Kept in
// localStorage ("oc-mock-desk-storage"; remove it to start again). Never unpins, never deletes an
// original: the copies go once the items are on their originals, as the API does.

import type { StorageJob, StorageMaintenance, StorageRun, StorageRunCounts, StorageRunMode } from "@opencast/contracts";
import { STORAGE_JOBS } from "@opencast/contracts";
import { now } from "../../lib/clock";
import { U } from "./fixtures/ids";
import { logChange, personOf, SAMK_ID, saveSettings } from "./settingsDb";

export const STORAGE_DB_KEY = "oc-mock-desk-storage";
const VERSION = 1;
/** How long a mock run takes. */
export const RUN_MS = 4_000;
const GB = 1024 ** 3;

interface Located {
  table: "asset_files" | "spot_files" | "order_files";
  id: string;
  location: string;
  reachable: boolean;
  contentId: string | null;
}
interface MockPin {
  ipfsCid: string;
  name: string;
  bytes: number;
  catalog: boolean;
  copied: boolean;
}
interface OnCopy {
  itemId: string;
  title: string;
  copy: string;
  original: string | null;
  bytes: number;
  state: "to_prepare" | "queued" | "ready_to_move" | "moved";
}
export interface MockRun {
  id: string;
  seq: number;
  job: StorageJob;
  mode: StorageRunMode;
  status: StorageRun["status"];
  by: string | null;
  startedAt: string;
  finishedAt: string | null;
  total: number;
  counts: StorageRunCounts | null;
  error: string | null;
  report: Record<string, unknown> | null;
}
interface StorageDb {
  version: number;
  pinataConnected: boolean;
  located: Located[];
  pins: MockPin[];
  items: OnCopy[];
  runs: MockRun[];
  seq: number;
}

const cid = (n: number) => `bafkreig${String(n).padStart(3, "0")}${"a".repeat(49)}`;

function seed(): StorageDb {
  return {
    version: VERSION,
    pinataConnected: true,
    located: [
      { table: "asset_files", id: U(7801), location: "/data/uploads/beat/ready/night-talk-01.mp4", reachable: true, contentId: null },
      { table: "asset_files", id: U(7802), location: "https://media.opencast.example/old/fall-menu.mp4", reachable: true, contentId: null },
      { table: "spot_files", id: U(7803), location: "/data/uploads/business-orange/gone.mp4", reachable: false, contentId: null }
    ],
    pins: [
      { ipfsCid: "bafybeibwzifw52ttrkqlikfzext5akxu7lz4xiwjgwzmqcpdzmp3n5vnbe", name: "Cartoons, 1928 to 1936, ep. 1", bytes: 412 * 1024 ** 2, catalog: true, copied: false },
      { ipfsCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi", name: "Cartoons, 1928 to 1936, ep. 2", bytes: 388 * 1024 ** 2, catalog: true, copied: false }
    ],
    items: [
      { itemId: U(7811), title: "Beat Tape Live, Aug 2", copy: cid(1), original: cid(2), bytes: 610 * 1024 ** 2, state: "to_prepare" },
      { itemId: U(7812), title: "Night Talk, ep. 4", copy: cid(3), original: cid(4), bytes: 240 * 1024 ** 2, state: "to_prepare" },
      { itemId: U(7813), title: "Fall menu", copy: cid(5), original: null, bytes: 30 * 1024 ** 2, state: "to_prepare" }
    ],
    runs: [
      {
        id: U(7821),
        seq: 1,
        job: "prepareFromOriginals",
        mode: "check",
        status: "done",
        by: SAMK_ID,
        startedAt: "2026-09-25T17:02:00.000Z",
        finishedAt: "2026-09-25T17:02:09.000Z",
        total: 3,
        counts: { items: 3, toPrepare: 2, readyToMove: 0, queued: 0, moved: 0, failed: 0, noOriginal: 1, copyBytes: 880 * 1024 ** 2, errors: 0 },
        error: null,
        report: { at: "2026-09-25T17:02:00.000Z", apply: false, items: 3, toPrepare: 2, noOriginal: 1, copyGb: 0.859, entries: [], runId: U(7821), job: "prepareFromOriginals", mode: "check" }
      }
    ],
    seq: 1
  };
}

let db: StorageDb | null = null;

export function storageDb(): StorageDb {
  if (db) return db;
  try {
    const raw = localStorage.getItem(STORAGE_DB_KEY);
    const saved = raw ? (JSON.parse(raw) as StorageDb) : null;
    db = saved && saved.version === VERSION ? saved : seed();
  } catch {
    db = seed();
  }
  return db;
}

export function saveStorage() {
  try {
    localStorage.setItem(STORAGE_DB_KEY, JSON.stringify(storageDb()));
  } catch {
    // Private windows: kept for this visit only.
  }
}

export function resetStorage() {
  db = seed();
  saveStorage();
}

if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_DB_KEY || e.key === null) db = null;
  });

/** How many rows (pins, items) a run works through. */
function totalFor(d: StorageDb, job: StorageJob, mode: StorageRunMode): number {
  if (job === "relinkLocations") return d.located.filter((l) => !l.contentId).length;
  if (job === "copyPinata") return mode === "apply" ? d.pins.filter((p) => !p.catalog && !p.copied).length : 0;
  return d.items.filter((i) => i.state !== "moved").length;
}

const LABELS: Record<StorageJob, string> = { relinkLocations: "Files stored by location", copyPinata: "Pinata pins", prepareFromOriginals: "Items on their 720p copies" };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a run does when it finishes: the counts and the report, as the API's. */
function finish(d: StorageDb, run: MockRun) {
  const at = new Date(new Date(run.startedAt).getTime() + RUN_MS).toISOString();
  const apply = run.mode === "apply";
  if (run.job === "relinkLocations") {
    const rows = d.located.filter((l) => !l.contentId);
    const entries = rows.map((l, n) => {
      if (!apply) return { table: l.table, id: l.id, location: l.location, reachable: l.reachable };
      if (!l.reachable) return { table: l.table, id: l.id, location: l.location, error: "its file isn't where the row says" };
      l.contentId = cid(100 + n + d.seq);
      return { table: l.table, id: l.id, location: l.location, contentId: l.contentId, relinked: true, carried: [] };
    });
    const unreachable = rows.filter((l) => !l.reachable).length;
    const errors = apply ? unreachable : 0;
    run.counts = { rows: rows.length, relinked: entries.filter((e) => "relinked" in e).length, unreachable, preparedAsLocation: 0, errors };
    run.report = { at: run.startedAt, relink: apply, store: "local", ...run.counts, entries };
  } else if (run.job === "copyPinata") {
    if (!d.pinataConnected) {
      run.counts = { connected: 0, pins: 0, moving: 0, movingBytes: 0, staying: 0, stayingBytes: 0, copied: 0, relinked: 0, errors: 0 };
      run.report = { at: run.startedAt, store: "local", connected: false, note: "Pinata isn't connected here (PINATA_JWT isn't set on the API), so there's nothing to copy.", copies: [] };
    } else {
      const moving = d.pins.filter((p) => !p.catalog && !p.copied);
      const staying = d.pins.filter((p) => p.catalog);
      const copies = apply ? moving.map((p, n) => ((p.copied = true), { ipfsCid: p.ipfsCid, name: p.name, bytes: p.bytes, contentId: cid(200 + n + d.seq), verified: true, relinked: [] })) : [];
      const sum = (ps: MockPin[]) => ps.reduce((s, p) => s + p.bytes, 0);
      run.counts = { connected: 1, pins: d.pins.length, moving: moving.length, movingBytes: sum(moving), staying: staying.length, stayingBytes: sum(staying), copied: copies.length, relinked: 0, errors: 0 };
      run.report = {
        at: run.startedAt,
        store: "local",
        connected: true,
        copy: apply,
        listings: { "v3 public": "read", "v3 private": "read", legacy: "read" },
        pinned: { files: d.pins.length, gb: +(sum(d.pins) / GB).toFixed(3) },
        moving: { files: moving.length, gb: +(sum(moving) / GB).toFixed(3) },
        stayingOnIpfs: { files: staying.length, gb: +(sum(staying) / GB).toFixed(3), cids: staying.map((p) => p.ipfsCid) },
        copies
      };
    }
  } else {
    // The worker has prepared what an earlier apply queued.
    for (const i of d.items) if (i.state === "queued") i.state = "ready_to_move";
    const left = d.items.filter((i) => i.state !== "moved");
    const entries = left.map((i) => {
      const state = !i.original ? "no_original" : !apply ? i.state : i.state === "to_prepare" ? "queued" : "moved";
      if (apply && i.original) i.state = state === "queued" ? "queued" : "moved";
      return { itemId: i.itemId, title: i.title, copy: i.copy, original: i.original ?? "", bands: ["tv"], state };
    });
    const count = (s: string) => entries.filter((e) => e.state === s).length;
    const copyBytes = left.reduce((s, i) => s + i.bytes, 0);
    run.counts = { items: entries.length, toPrepare: count("to_prepare"), readyToMove: count("ready_to_move"), queued: count("queued"), moved: count("moved"), failed: 0, noOriginal: count("no_original"), copyBytes, errors: 0 };
    run.report = { at: run.startedAt, apply, ...run.counts, copyGb: +(copyBytes / GB).toFixed(3), entries };
  }
  run.report = { ...run.report, runId: run.id, job: run.job, mode: run.mode };
  run.status = "done";
  run.finishedAt = at;
  if (apply) {
    const c = run.counts!;
    const n = (k: string) => c[k] ?? 0;
    const line =
      run.job === "relinkLocations"
        ? `Stored ${plural(n("relinked"), "file")} by content ID of ${n("rows")} stored by location${n("unreachable") ? `; ${n("unreachable")} couldn't be read` : ""}`
        : run.job === "copyPinata"
          ? `Copied ${plural(n("copied"), "Pinata pin")} of ${n("moving")} into storage, checked by hash, and relinked ${plural(n("relinked"), "row")}. Nothing unpinned`
          : `Moved ${plural(n("moved"), "item")} onto ${n("moved") === 1 ? "its original" : "their originals"}; ${n("queued")} queued for preparing${n("failed") ? `; ${n("failed")} couldn't be prepared` : ""}`;
    logChange({ by: run.by, kind: "storage", subject: run.id, summary: `${LABELS[run.job]}: ${line}`, after: { job: run.job, mode: run.mode, status: "done", counts: c, error: null } });
    saveSettings();
  }
}

/** Finishes the runs whose time is up. */
function tick() {
  const d = storageDb();
  let changed = false;
  for (const run of [...d.runs].sort((a, b) => a.seq - b.seq)) {
    if (run.status === "running" && now().getTime() - new Date(run.startedAt).getTime() >= RUN_MS) {
      finish(d, run);
      changed = true;
    }
  }
  if (changed) saveStorage();
}

export function runView(run: MockRun): StorageRun {
  const running = run.status === "running";
  const done = running ? Math.min(run.total, Math.floor(((now().getTime() - new Date(run.startedAt).getTime()) / RUN_MS) * run.total)) : run.total;
  return {
    id: run.id,
    job: run.job,
    mode: run.mode,
    status: run.status,
    by: personOf(run.by),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    progress: { done, total: run.total },
    counts: running ? null : run.counts,
    error: run.error,
    hasReport: !running && !!run.report
  };
}

export function findRun(id: string): MockRun | undefined {
  tick();
  return storageDb().runs.find((r) => r.id === id);
}

/** Starts a run, or the run already going (the handler answers 409). */
export function startRun(by: string, job: StorageJob, mode: StorageRunMode): { run: MockRun } | { running: MockRun } {
  tick();
  const d = storageDb();
  const running = d.runs.find((r) => r.job === job && r.status === "running");
  if (running) return { running };
  d.seq += 1;
  const run: MockRun = { id: U(78100 + d.seq), seq: d.seq, job, mode, status: "running", by, startedAt: now().toISOString(), finishedAt: null, total: totalFor(d, job, mode), counts: null, error: null, report: null };
  d.runs.push(run);
  saveStorage();
  return { run };
}

export function maintenanceView(): StorageMaintenance {
  tick();
  const d = storageDb();
  const latest = (job: StorageJob, f: (r: MockRun) => boolean) => {
    const run = d.runs.filter((r) => r.job === job && f(r)).sort((a, b) => b.seq - a.seq)[0];
    return run ? runView(run) : null;
  };
  return {
    pinataConnected: d.pinataConnected,
    jobs: STORAGE_JOBS.map((job) => ({
      job,
      running: latest(job, (r) => r.status === "running"),
      lastCheck: latest(job, (r) => r.mode === "check" && r.status !== "running"),
      lastApply: latest(job, (r) => r.mode === "apply" && r.status !== "running"),
      canApply: job !== "copyPinata" || d.pinataConnected
    }))
  };
}

