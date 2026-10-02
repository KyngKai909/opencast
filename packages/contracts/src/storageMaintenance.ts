// Network desk Settings, Storage maintenance (added 2026-09-29): the one-off storage steps run on the
// server from the desk, so nobody needs a shell. Each job checks (report only) or applies, in the
// background inside the API; one run of a job at a time. Admins only (403 `desk_role` otherwise).
// The same steps as the scripts (`storage:relink-locations`, `storage:move-off-pinata --copy`,
// `storage:prepare-from-originals`), which stay for local use. Nothing here unpins or deletes an
// original. The endpoints are part of `deskApi`.

import { z } from "zod";
import { endpoint } from "./core.js";
import { Id, Timestamp } from "./common.js";

/**
 * - `relinkLocations`: files from before content IDs (keyed by a disk path or URL) stored by content
 *   ID, and their rows pointed at it.
 * - `copyPinata`: each Pinata pin (but the catalog's) copied into object storage, checked by hash,
 *   and the rows that used it pointed at the copy. Never unpins.
 * - `prepareFromOriginals`: items still airing from the 1280 px (720p) copy: their originals queued
 *   for the worker to prepare, then each item moved onto its original. Apply again until nothing
 *   is queued or left to prepare.
 */
export const StorageJob = z.enum(["relinkLocations", "copyPinata", "prepareFromOriginals"]);
export type StorageJob = z.infer<typeof StorageJob>;
export const STORAGE_JOBS = StorageJob.options;

/** `check` reports only; `apply` changes what the report says it would. */
export const StorageRunMode = z.enum(["check", "apply"]);
export type StorageRunMode = z.infer<typeof StorageRunMode>;

/** `failed`: the run stopped (its `error` says why); what it did before that stays done. */
export const StorageRunStatus = z.enum(["running", "done", "failed"]);
export type StorageRunStatus = z.infer<typeof StorageRunStatus>;

/**
 * A run's numbers, by job (every one a whole number; bytes are bytes):
 * - `relinkLocations`: `rows` (keyed by location), `unreachable` (bytes that can't be read),
 *   `preparedAsLocation` (prepared under their old location, carried over when relinked),
 *   `relinked` (apply), `errors`.
 * - `copyPinata`: `connected` (1 or 0: PINATA_JWT is set here), `pins`, `moving` (pins to copy:
 *   every pin but the catalog's), `movingBytes`, `staying` (the catalog's, left on IPFS),
 *   `stayingBytes`, `copied` (apply: copied and checked by hash), `relinked` (rows now on the copy),
 *   `errors`.
 * - `prepareFromOriginals`: `items` (still on their copy), `toPrepare`, `readyToMove`, `queued`
 *   (apply: waiting for the worker), `moved` (apply), `failed`, `noOriginal`, `copyBytes`, `errors`.
 */
export const StorageRunCounts = z.record(z.string(), z.number());
export type StorageRunCounts = z.infer<typeof StorageRunCounts>;

export const StorageRun = z.object({
  id: Id,
  job: StorageJob,
  mode: StorageRunMode,
  status: StorageRunStatus,
  /** Who pressed it (null: started some other way). */
  by: z.object({ userId: Id, name: z.string() }).nullable(),
  startedAt: Timestamp,
  finishedAt: Timestamp.nullable(),
  /** While running: rows (or pins, or items) done of the total. Null until the total is known. */
  progress: z.object({ done: z.number().int(), total: z.number().int() }).nullable(),
  /** Null while running. */
  counts: StorageRunCounts.nullable(),
  /** Why the run stopped (`failed`). Errors on single rows are counted in `counts.errors` and listed in the report. */
  error: z.string().nullable(),
  /** The JSON report (the scripts' own), from `storageRunReport`. False while running. */
  hasReport: z.boolean()
});
export type StorageRun = z.infer<typeof StorageRun>;

export const StorageJobState = z.object({
  job: StorageJob,
  /** The run going now, if any: another of the same job is refused (409 `already_running`). */
  running: StorageRun.nullable(),
  /** The latest finished check, and the latest finished apply. */
  lastCheck: StorageRun.nullable(),
  lastApply: StorageRun.nullable(),
  /** False for `copyPinata` when PINATA_JWT isn't set here: its check says so, and it can't be applied. */
  canApply: z.boolean()
});
export type StorageJobState = z.infer<typeof StorageJobState>;

export const StorageMaintenance = z.object({
  /** PINATA_JWT is set on this API. */
  pinataConnected: z.boolean(),
  jobs: z.array(StorageJobState)
});
export type StorageMaintenance = z.infer<typeof StorageMaintenance>;

export const storageMaintenanceApi = {
  getStorageMaintenance: endpoint({
    method: "GET",
    path: "/admin/storage",
    auth: "desk",
    summary: "Each storage job's run going now, last check and last apply; `check` starts a fresh check of one job or all (admins only)",
    query: z.object({ check: z.union([StorageJob, z.literal("all")]).optional() }),
    response: StorageMaintenance
  }),
  startStorageRun: endpoint({
    method: "POST",
    path: "/admin/storage/runs",
    auth: "desk",
    summary: "Checks (report only) or applies one storage job, in the background (admins only)",
    body: z.object({ job: StorageJob, mode: StorageRunMode }),
    response: StorageRun,
    status: 202
  }),
  getStorageRun: endpoint({
    method: "GET",
    path: "/admin/storage/runs/:runId",
    auth: "desk",
    summary: "One storage run, with its progress (admins only)",
    params: z.object({ runId: Id }),
    response: StorageRun
  }),
  storageRunReport: endpoint({
    method: "GET",
    path: "/admin/storage/runs/:runId/report",
    auth: "desk",
    summary: "A finished storage run's JSON report, as the script writes it (admins only)",
    params: z.object({ runId: Id }),
    response: z.record(z.string(), z.unknown())
  })
} as const;
