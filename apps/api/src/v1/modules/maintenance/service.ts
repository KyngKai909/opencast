// Network desk Settings, Storage maintenance (added 2026-09-29): the one-off storage steps
// (storageMaintenance.ts), run from the desk so nobody needs a shell. Admins check a job (report
// only) or apply it; it runs in the background in this process, one run of a job at a time
// (network.storage_runs' partial unique index, so two API processes can't both run it). Each run is
// kept with who, when, the mode, its counts and the scripts' JSON report; each apply goes in the
// change log too. `prepareFromOriginals` only queues preparation: the worker prepares, and it's
// applied again until nothing is queued or left to prepare. Nothing here unpins or deletes an
// original: the functions are the scripts' own, in the modes the desk may use (never `--unpin`).
// Owns network.storage_runs.

import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { schema } from "@opencast/db";
import { STORAGE_JOBS, type StorageJob, type StorageMaintenance, type StorageRun, type StorageRunCounts, type StorageRunMode } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { CurrentUser } from "../../http.js";
import { conflict, notFound, refused } from "../../errors.js";
import { moveOffPinata, prepareFromOriginals, relinkLocations, type Progress } from "../../storageMaintenance.js";

export interface MaintenanceService {
  /** Each job's run going now, last check and last apply. `check` starts a fresh check of one job, or all (skipping any running). */
  state(user: CurrentUser, check?: StorageJob | "all"): Promise<StorageMaintenance>;
  /** Starts a check or an apply in the background. 409 `already_running` while the job runs. */
  start(user: CurrentUser, input: { job: StorageJob; mode: StorageRunMode }): Promise<StorageRun>;
  run(user: CurrentUser, runId: string): Promise<StorageRun>;
  report(user: CurrentUser, runId: string): Promise<Record<string, unknown>>;
  /** Waits for the runs this process started (tests, and a clean shutdown). */
  settle(): Promise<void>;
}

/** A run that hasn't said anything for this long is taken as stopped (the API restarted mid-run). */
const STALE_MS = 30 * 60_000;
/** Progress is written at most this often (and at the start and the end). */
const PROGRESS_EVERY_MS = 1_000;

/** The jobs' names, as the change log and refusals say them. */
const LABELS: Record<StorageJob, string> = {
  relinkLocations: "Files stored by location",
  copyPinata: "Pinata pins",
  prepareFromOriginals: "Items on their 720p copies"
};

const GB = 1024 ** 3;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The change log's line for a finished apply. */
function applySummary(job: StorageJob, c: StorageRunCounts): string {
  const n = (k: string) => c[k] ?? 0;
  switch (job) {
    case "relinkLocations":
      return `Stored ${plural(n("relinked"), "file")} by content ID of ${n("rows")} stored by location${n("unreachable") ? `; ${n("unreachable")} couldn't be read` : ""}`;
    case "copyPinata":
      return `Copied ${plural(n("copied"), "Pinata pin")} of ${n("moving")} into storage, checked by hash, and relinked ${plural(n("relinked"), "row")}. Nothing unpinned`;
    case "prepareFromOriginals":
      return `Moved ${plural(n("moved"), "item")} onto ${n("moved") === 1 ? "its original" : "their originals"}; ${n("queued")} queued for preparing${n("failed") ? `; ${n("failed")} couldn't be prepared` : ""}`;
  }
}

export function createMaintenanceService(ctx: ModuleContext): MaintenanceService {
  const { deps, services } = ctx;
  const { db } = deps;
  const SR = schema.storageRuns;
  const inflight = new Set<Promise<void>>();

  async function views(rows: Array<typeof SR.$inferSelect>): Promise<StorageRun[]> {
    const who = await services.accounts.peopleByIds(rows.map((r) => r.startedBy).filter((id): id is string => !!id));
    return rows.map((r) => ({
      id: r.id,
      job: r.job,
      mode: r.mode,
      status: r.status,
      by: r.startedBy ? { userId: r.startedBy, name: who.get(r.startedBy)?.name ?? "Someone" } : null,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      progress: r.progressTotal === null ? null : { done: r.progressDone ?? 0, total: r.progressTotal },
      counts: r.status === "running" ? null : (r.counts ?? {}),
      error: r.error,
      hasReport: r.status !== "running" && r.report !== null
    }));
  }

  /** What one run does: the scripts' functions, and the report each script writes. */
  async function execute(job: StorageJob, mode: StorageRunMode, onProgress: Progress): Promise<{ counts: StorageRunCounts; report: Record<string, unknown> }> {
    const apply = mode === "apply";
    const at = deps.clock.now().toISOString();
    const store = deps.storage.objects.name;
    if (job === "relinkLocations") {
      const { entries, ...counts } = await relinkLocations(ctx, { relink: apply, onProgress });
      const more = { preparedAsLocation: entries.filter((e) => e.preparedAs).length, errors: entries.filter((e) => e.error).length };
      return { counts: { ...counts, ...more }, report: { at, relink: apply, store, ...counts, ...more, entries } };
    }
    if (job === "copyPinata") {
      if (!deps.pinata) {
        await onProgress(0, 0);
        const counts = { connected: 0, pins: 0, moving: 0, movingBytes: 0, staying: 0, stayingBytes: 0, copied: 0, relinked: 0, errors: 0 };
        return { counts, report: { at, store, connected: false, note: "Pinata isn't connected here (PINATA_JWT isn't set on the API), so there's nothing to copy.", copies: [] } };
      }
      // Never `afterCopy`: unpinning is only the script's (`--unpin --yes-unpin`).
      const { report, counts } = await moveOffPinata(ctx, deps.pinata, { copy: apply, onProgress });
      return { counts: { connected: 1, ...counts }, report: { ...report, connected: true, copy: apply } };
    }
    const { entries, copyBytes, ...counts } = await prepareFromOriginals(ctx, { apply, onProgress });
    const errors = entries.filter((e) => e.error && e.state !== "failed").length;
    return { counts: { ...counts, copyBytes, errors }, report: { at, apply, ...counts, copyGb: +(copyBytes / GB).toFixed(3), entries } };
  }

  /** Runs it in the background and records how it went. Never throws. */
  async function go(row: typeof SR.$inferSelect): Promise<void> {
    let last = 0;
    const onProgress: Progress = async (done, total) => {
      const t = Date.now();
      if (done !== 0 && done !== total && t - last < PROGRESS_EVERY_MS) return;
      last = t;
      await db.update(SR).set({ progressDone: done, progressTotal: total, heartbeatAt: deps.clock.now() }).where(eq(SR.id, row.id));
    };
    let finished: Partial<typeof SR.$inferInsert>;
    try {
      const { counts, report } = await execute(row.job, row.mode, onProgress);
      finished = { status: "done", counts, report: { ...report, runId: row.id, job: row.job, mode: row.mode } };
    } catch (error) {
      console.error(`[maintenance] ${row.job} (${row.mode}) failed`, error);
      finished = { status: "failed", error: (error as Error)?.message ?? String(error) };
    }
    try {
      await db.transaction(async (tx) => {
        const [done] = await tx
          .update(SR)
          .set({ ...finished, finishedAt: deps.clock.now(), heartbeatAt: deps.clock.now() })
          .where(and(eq(SR.id, row.id), eq(SR.status, "running")))
          .returning();
        if (!done || row.mode !== "apply") return;
        await services.settings.logChange(tx, {
          by: row.startedBy,
          kind: "storage",
          subject: row.id,
          summary: done.status === "done" ? `${LABELS[row.job]}: ${applySummary(row.job, done.counts ?? {})}` : `${LABELS[row.job]}: the apply stopped. ${done.error ?? ""}`.trim(),
          after: { job: row.job, mode: row.mode, status: done.status, counts: done.counts ?? null, error: done.error ?? null }
        });
      });
    } catch (error) {
      console.error(`[maintenance] recording ${row.job} (${row.mode}) failed`, error);
    }
  }

  async function begin(user: CurrentUser, job: StorageJob, mode: StorageRunMode): Promise<typeof SR.$inferSelect | { running: typeof SR.$inferSelect }> {
    const now = deps.clock.now();
    // A run that stopped saying anything (the API restarted) doesn't hold the job.
    await db
      .update(SR)
      .set({ status: "failed", finishedAt: now, error: "It stopped: nothing heard from it for 30 minutes (the API may have restarted). What it did before that stays done." })
      .where(and(eq(SR.job, job), eq(SR.status, "running"), lt(SR.heartbeatAt, new Date(now.getTime() - STALE_MS))));
    // The partial unique index refuses a second running run of the job, from any process.
    for (;;) {
      const [row] = await db.insert(SR).values({ job, mode, startedBy: user.id, startedAt: now, heartbeatAt: now }).onConflictDoNothing().returning();
      if (row) {
        const p: Promise<void> = go(row).finally(() => inflight.delete(p));
        inflight.add(p);
        return row;
      }
      const [running] = await db.select().from(SR).where(and(eq(SR.job, job), eq(SR.status, "running"))).limit(1);
      // It finished in between: try again.
      if (running) return { running };
    }
  }

  async function byId(runId: string) {
    const [row] = await db.select().from(SR).where(eq(SR.id, runId));
    if (!row) throw notFound("That run");
    return row;
  }

  const service: MaintenanceService = {
    async state(user, check) {
      await services.settings.requireDesk(user, "admin");
      if (check) {
        for (const job of check === "all" ? STORAGE_JOBS : [check]) await begin(user, job, "check");
      }
      const running = await db.select().from(SR).where(eq(SR.status, "running"));
      const last = await Promise.all(
        STORAGE_JOBS.flatMap((job) =>
          (["check", "apply"] as const).map(async (mode) => {
            const [row] = await db
              .select()
              .from(SR)
              .where(and(eq(SR.job, job), eq(SR.mode, mode), inArray(SR.status, ["done", "failed"])))
              .orderBy(desc(SR.startedAt), desc(SR.seq))
              .limit(1);
            return row;
          })
        )
      );
      const rows = [...running, ...last.filter((r): r is typeof SR.$inferSelect => !!r)];
      const all = new Map((await views(rows)).map((v) => [v.id, v]));
      const find = (f: (r: typeof SR.$inferSelect) => boolean) => {
        const row = rows.find(f);
        return row ? all.get(row.id)! : null;
      };
      return {
        pinataConnected: !!deps.pinata,
        jobs: STORAGE_JOBS.map((job) => ({
          job,
          running: find((r) => r.job === job && r.status === "running"),
          lastCheck: find((r) => r.job === job && r.mode === "check" && r.status !== "running"),
          lastApply: find((r) => r.job === job && r.mode === "apply" && r.status !== "running"),
          canApply: job !== "copyPinata" || !!deps.pinata
        }))
      };
    },

    async start(user, { job, mode }) {
      await services.settings.requireDesk(user, "admin");
      if (job === "copyPinata" && mode === "apply" && !deps.pinata) {
        throw refused("pinata_not_connected", "Pinata isn't connected here (PINATA_JWT isn't set on the API), so there's nothing to copy.");
      }
      const started = await begin(user, job, mode);
      if ("running" in started) {
        const [other] = await views([started.running]);
        throw conflict("already_running", `${LABELS[job]}: ${other.by?.name ?? "Someone"} started ${other.mode === "apply" ? "an apply" : "a check"} that's still running. Wait for it to finish.`);
      }
      return (await views([started]))[0];
    },

    async run(user, runId) {
      await services.settings.requireDesk(user, "admin");
      return (await views([await byId(runId)]))[0];
    },

    async report(user, runId) {
      await services.settings.requireDesk(user, "admin");
      const row = await byId(runId);
      if (row.status === "running") throw conflict("still_running", "It's still running: its report comes when it finishes.");
      if (!row.report) throw notFound("That run's report");
      return row.report as Record<string, unknown>;
    },

    async settle() {
      while (inflight.size) await Promise.all([...inflight]);
    }
  };
  return service;
}
