// Settings, Storage maintenance (2026-09-29): the one-off storage jobs, checked or applied in the
// background, one run of a job at a time. As the API: admins only (403 `desk_role` for the rest of
// the team), Pinata unset refuses an apply, and nothing is ever unpinned.
import { http, type HttpHandler } from "msw";
import { deskApi, StorageJob, StorageRunMode } from "@opencast/contracts";
import { findRun, maintenanceView, runView, startRun, storageDb } from "../storageDb";
import { bodyOf, fail, lacks, needsDesk, path, reply } from "../respond";

const LABELS = { relinkLocations: "Files stored by location", copyPinata: "Pinata pins", prepareFromOriginals: "Items on their 720p copies" } as const;

export const storageHandlers: HttpHandler[] = [
  http.get(path(deskApi.getStorageMaintenance), ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "admin");
    if (no) return no;
    const check = new URL(request.url).searchParams.get("check");
    if (check) for (const job of check === "all" ? StorageJob.options : StorageJob.options.filter((j) => j === check)) startRun(p.id, job, "check");
    return reply(deskApi.getStorageMaintenance.response, maintenanceView());
  }),

  http.post(path(deskApi.startStorageRun), async ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "admin");
    if (no) return no;
    const body = await bodyOf<{ job?: string; mode?: string }>(request);
    const job = StorageJob.safeParse(body?.job);
    const mode = StorageRunMode.safeParse(body?.mode);
    if (!job.success || !mode.success) return fail(400, "bad_request", "Check the form: choose a job, and check or apply.");
    if (job.data === "copyPinata" && mode.data === "apply" && !storageDb().pinataConnected) return fail(422, "pinata_not_connected", "Pinata isn't connected here (PINATA_JWT isn't set on the API), so there's nothing to copy.");
    const started = startRun(p.id, job.data, mode.data);
    if ("running" in started) {
      const other = runView(started.running);
      return fail(409, "already_running", `${LABELS[job.data]}: ${other.by?.name ?? "Someone"} started ${other.mode === "apply" ? "an apply" : "a check"} that's still running. Wait for it to finish.`);
    }
    return reply(deskApi.startStorageRun.response, runView(started.run), 202);
  }),

  http.get(path(deskApi.getStorageRun), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "admin");
    if (no) return no;
    const run = findRun(String(params.runId));
    if (!run) return fail(404, "not_found", "That run wasn't found.");
    return reply(deskApi.getStorageRun.response, runView(run));
  }),

  http.get(path(deskApi.storageRunReport), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "admin");
    if (no) return no;
    const run = findRun(String(params.runId));
    if (!run) return fail(404, "not_found", "That run wasn't found.");
    if (run.status === "running") return fail(409, "still_running", "It's still running: its report comes when it finishes.");
    if (!run.report) return fail(404, "not_found", "That run's report wasn't found.");
    return reply(deskApi.storageRunReport.response, run.report);
  })
];
