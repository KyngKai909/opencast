// Settings, Storage maintenance (2026-09-29), admins only: the one-off storage jobs, run on the
// server so nobody needs a shell. Each job: what it does, Check (report only) with its summary,
// Apply behind a dialog that says what will change, progress while it runs, and its last check and
// apply with who, when and the JSON report. Nothing here unpins or deletes an original.
import { useState } from "react";
import { deskApi, type StorageJob, type StorageJobState, type StorageRun, type StorageRunMode } from "@opencast/contracts";
import { Button, Modal, useToast } from "@opencast/ui";
import { call } from "../../../api/client";
import { useApi, useApiMutation } from "../../../api/hooks";
import { DEFAULT_TZ } from "../../../lib/clock";
import { dateAtTime } from "../../lib/dates";
import { errorText, ErrorLine, Quiet } from "../../pages/common";
import { applyLine, checkDetail, checkLine, confirmWords, JOB_WORDS, leftAfter, pinataOff, progressLine } from "./storage";

const when = (iso: string) => dateAtTime(iso, DEFAULT_TZ);

/** Saves a run's JSON report as a file. */
async function downloadReport(run: StorageRun) {
  const report = await call(deskApi.storageRunReport, { params: { runId: run.id } });
  const name = `storage-${run.job}-${run.mode}-${run.startedAt.slice(0, 10)}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function LastRun({ run, label }: { run: StorageRun; label: string }) {
  const toast = useToast();
  const title = JOB_WORDS[run.job].title;
  const what = run.status === "failed" ? `Stopped: ${run.error ?? "it didn't finish"}` : run.mode === "apply" && run.counts ? applyLine(run.job, run.counts) : null;
  return (
    <div className="nd-job__last">
      <small>
        {label}: {run.by?.name ?? "Opencast"}, {when(run.finishedAt ?? run.startedAt)}
        {what ? `. ${what}.` : "."}
      </small>
      {run.hasReport && (
        <Button size="sm" variant="ghost" onClick={() => void downloadReport(run).catch((e) => toast.show({ message: errorText(e) }))} aria-label={`Download report: ${title}, ${label.toLowerCase()}`}>
          Download report
        </Button>
      )}
    </div>
  );
}

function Job({ state, connected, onApply }: { state: StorageJobState; connected: boolean; onApply: (job: StorageJob) => void }) {
  const toast = useToast();
  const start = useApiMutation(deskApi.startStorageRun, { invalidates: [deskApi.getStorageMaintenance] });
  const w = JOB_WORDS[state.job];
  const { running, lastCheck, lastApply } = state;
  const off = state.job === "copyPinata" && pinataOff(lastCheck, connected);
  const left = leftAfter(state.job, lastApply, lastCheck);
  const check = async () => {
    try {
      await start.mutateAsync({ body: { job: state.job, mode: "check" satisfies StorageRunMode } });
      toast.show({ message: `Checking: ${w.title}.` });
    } catch (e) {
      toast.show({ message: errorText(e) });
    }
  };
  return (
    <section className="nd-job" aria-label={w.title}>
      <div className="nd-job__head">
        <div>
          <b>{w.title}</b>
          <small>{w.explain}</small>
        </div>
        <span className="nd-rule__acts">
          <Button size="sm" onClick={() => void check()} disabled={!!running || start.isPending} aria-label={`Check: ${w.title}`}>
            Check
          </Button>
          <Button size="sm" variant="primary" onClick={() => onApply(state.job)} disabled={!!running || !state.canApply} aria-label={`Apply: ${w.title}`}>
            Apply
          </Button>
        </span>
      </div>
      {running ? (
        <div className="nd-job__run" role="status">
          <progress value={running.progress?.done ?? undefined} max={running.progress?.total || undefined} aria-label={`${w.title}: ${running.mode === "apply" ? "applying" : "checking"}`} />
          <small>{progressLine(running)}</small>
        </div>
      ) : null}
      <div className="nd-job__result">
        {off ? (
          <>
            <span className="nd-job__v">Pinata isn't connected here</span>
            <small>Set PINATA_JWT on the API to connect it. Until then there's nothing to copy.</small>
          </>
        ) : lastCheck?.counts ? (
          <>
            <span className="nd-job__v">{checkLine(state.job, lastCheck.counts)}</span>
            {checkDetail(state.job, lastCheck.counts) && <small>{checkDetail(state.job, lastCheck.counts)}</small>}
          </>
        ) : (
          <span className="nd-job__v nd-job__v--quiet">{lastCheck ? "The last check stopped" : "Not checked yet"}</span>
        )}
        {left &&
          (left.done ? (
            <small className="nd-job__left">Nothing queued or left to prepare.</small>
          ) : (
            <small className="nd-job__left">
              Queued for the worker: {left.queued}. Left to prepare: {left.toPrepare}.{left.readyToMove ? ` Ready to move: ${left.readyToMove}.` : ""} Apply again once the worker has prepared them.
            </small>
          ))}
      </div>
      {lastCheck && <LastRun run={lastCheck} label="Last check" />}
      {lastApply && <LastRun run={lastApply} label="Last apply" />}
    </section>
  );
}

function ApplyDialog({ state, onClose }: { state: StorageJobState; onClose: () => void }) {
  const toast = useToast();
  const start = useApiMutation(deskApi.startStorageRun, { invalidates: [deskApi.getStorageMaintenance, deskApi.changeLog] });
  const [error, setError] = useState<string | null>(null);
  const words = confirmWords(state.job, state.lastCheck?.counts ?? null);
  const apply = async () => {
    setError(null);
    try {
      await start.mutateAsync({ body: { job: state.job, mode: "apply" satisfies StorageRunMode } });
      toast.show({ message: `Applying: ${JOB_WORDS[state.job].title}. It's recorded in the change log.` });
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={520}
      title={words.title}
      subtitle={state.lastCheck?.counts ? `From the last check, ${when(state.lastCheck.finishedAt ?? state.lastCheck.startedAt)}.` : "Not checked yet: Check first to see what it would do."}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void apply()} disabled={start.isPending}>
            {words.button}
          </Button>
        </>
      }
    >
      <div className="nd-form">
        {words.body.map((p) => (
          <p key={p} className="nd-set-p">
            {p}
          </p>
        ))}
        {error && <p className="nd-form__error">{error}</p>}
      </div>
    </Modal>
  );
}

export function StorageSection() {
  const state = useApi(deskApi.getStorageMaintenance, {}, { refetchInterval: (q) => (q.state.data?.jobs.some((j) => j.running) ? 1000 : false) });
  const [applying, setApplying] = useState<StorageJob | null>(null);
  if (state.isLoading) return <Quiet />;
  if (state.error || !state.data) return <ErrorLine error={state.error} />;
  const s = state.data;
  const dialog = applying ? s.jobs.find((j) => j.job === applying) : null;
  return (
    <>
      <p className="nd-set-p">
        The one-off storage steps, run on the server. Check first: it only reports. Apply changes what the check says, in the background; each apply goes in the change log. Nothing here unpins from Pinata or deletes an original.
      </p>
      {s.jobs.map((j) => (
        <Job key={j.job} state={j} connected={s.pinataConnected} onApply={setApplying} />
      ))}
      {dialog && <ApplyDialog state={dialog} onClose={() => setApplying(null)} />}
    </>
  );
}
