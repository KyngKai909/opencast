// The direct-upload widget's state for React: files added (a drop, Choose files), each one's
// progress as it goes to storage in parts, then the API's "Checking" and "Preparing for air" (or
// done), with pause, resume, retry and cancel. A batch (one drop) is reported once every file in it
// has finished or failed, so a screen can say "2 files are being prepared for air."

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { UploadPurposeInput, UploadView } from "@opencast/contracts";
import { createUploader, type OcUppy, type OcUppyFile, type UploadClient } from "./uploader";

export type UploadStatus =
  /** Going to storage, part by part. */
  | "uploading"
  | "paused"
  /** Every part is in; the API is checking it. */
  | "checking"
  /** Finished: kept, and being prepared for air. */
  | "preparing"
  /** Finished, with nothing to prepare. */
  | "done"
  | "failed"
  /** Back after a reload: the browser doesn't keep a big file, so it has to be chosen again to carry on. */
  | "choose_again";

export interface UploadItem {
  /** Uppy's file ID. */
  id: string;
  name: string;
  bytes: number;
  /** Bytes in storage so far. */
  sent: number;
  status: UploadStatus;
  /** Why it failed, in words. */
  error: string | null;
  /** It failed on the way (a dropped connection): Retry carries on. A refusal by the API isn't retried. */
  retryable: boolean;
  /** The API's view of it once it's all in. */
  upload: UploadView | null;
}

export interface DirectUploadOptions {
  /** Unique per widget, e.g. `library-<station ID>`. Changing it starts a new uploader. */
  id: string;
  client: UploadClient;
  /** What a file is for. */
  purpose: (file: File) => UploadPurposeInput;
  /** Keep the list across reloads (Golden Retriever). */
  resume?: boolean;
  /** A file the API has finished with (`preparing` or `done`). */
  onFinished?: (item: UploadItem, upload: UploadView) => void;
  /** A file that failed (at the API, or after its retries). */
  onFailed?: (item: UploadItem) => void;
  /** Every file added together has finished or failed. */
  onBatchDone?: (batch: { finished: UploadItem[]; failed: UploadItem[] }) => void;
  /** How often to ask how the checking is going. */
  pollMs?: number;
  /** Take a finished file off the list after this long (the screen shows what it made by then). */
  clearFinishedAfterMs?: number;
}

const FINAL: UploadStatus[] = ["preparing", "done", "failed"];

/** How many mounted widgets use each uploader. */
const mounted = new WeakMap<OcUppy, number>();

export function useDirectUpload(options: DirectUploadOptions) {
  const opts = useRef(options);
  opts.current = options;
  const [, render] = useReducer((n: number) => n + 1, 0);
  /** What the API says, by file: its view, or why it failed. */
  const server = useRef(new Map<string, { upload: UploadView | null; error: string | null; status: UploadStatus | null; retryable?: boolean }>());
  const batches = useRef<Array<{ ids: Set<string>; reported: boolean }>>([]);
  const polling = useRef(new Set<string>());

  const uppy = useMemo<OcUppy>(() => createUploader({ id: options.id, client: options.client, resume: options.resume }), [options.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const itemOf = useCallback((file: OcUppyFile): UploadItem => {
    const s = server.current.get(file.id);
    const bytes = file.size ?? 0;
    const progress = file.progress;
    const sent = progress.uploadComplete ? bytes : Number(progress.bytesUploaded || 0);
    let status: UploadStatus = "uploading";
    if (file.isGhost) status = "choose_again";
    else if (s?.status) status = s.status;
    else if (file.error) status = "failed";
    else if (progress.uploadComplete) status = "checking";
    else if (file.isPaused) status = "paused";
    return { id: file.id, name: file.name ?? "file", bytes, sent, status, error: s?.error ?? (file.error ? String(file.error) : null), retryable: status === "failed" && (s?.retryable ?? true), upload: s?.upload ?? null };
  }, []);

  const checkBatches = useCallback(() => {
    for (const batch of batches.current) {
      if (batch.reported) continue;
      const items = [...batch.ids].map((id) => uppy.getFile(id)).filter(Boolean).map(itemOf);
      if (items.length < batch.ids.size && items.length === 0) {
        batch.reported = true;
        continue;
      }
      if (items.every((i) => FINAL.includes(i.status))) {
        batch.reported = true;
        opts.current.onBatchDone?.({ finished: items.filter((i) => i.status !== "failed"), failed: items.filter((i) => i.status === "failed") });
      }
    }
  }, [uppy, itemOf]);

  /** Follows a file at the API until it's finished. */
  const follow = useCallback(
    async (fileId: string, uploadId: string) => {
      if (polling.current.has(fileId)) return;
      polling.current.add(fileId);
      try {
        for (;;) {
          let view: UploadView;
          try {
            view = await opts.current.client.get(uploadId);
          } catch {
            await new Promise((r) => setTimeout(r, (opts.current.pollMs ?? 1500) * 2));
            if (!uppy.getFile(fileId)) return;
            continue;
          }
          const file = uppy.getFile(fileId);
          if (!file) return;
          if (view.state === "checking" || view.state === "uploading") {
            server.current.set(fileId, { upload: view, error: null, status: "checking" });
            render();
            await new Promise((r) => setTimeout(r, opts.current.pollMs ?? 1500));
            continue;
          }
          const failed = view.state === "failed" || view.state === "aborted";
          server.current.set(fileId, { upload: view, error: failed ? (view.error?.message ?? "That upload couldn't be finished. Try again.") : null, status: failed ? "failed" : view.state === "done" ? "done" : "preparing", retryable: false });
          render();
          const item = itemOf(file);
          if (failed) opts.current.onFailed?.(item);
          else opts.current.onFinished?.(item, view);
          checkBatches();
          const clearAfter = opts.current.clearFinishedAfterMs;
          if (!failed && clearAfter !== undefined)
            setTimeout(() => {
              if (!uppy.getFile(fileId)) return;
              server.current.delete(fileId);
              uppy.removeFile(fileId);
              render();
            }, clearAfter);
          return;
        }
      } finally {
        polling.current.delete(fileId);
      }
    },
    [uppy, itemOf, checkBatches]
  );

  useEffect(() => {
    const onChange = () => render();
    const onSuccess = (file: OcUppyFile | undefined) => {
      if (!file) return;
      const uploadId = file.meta.uploadId;
      if (uploadId) void follow(file.id, uploadId);
    };
    const onError = (file: OcUppyFile | undefined, error: { message?: string; request?: unknown; details?: string } | undefined) => {
      if (!file) return;
      const message = error?.message && !/^(Non 2xx|Unexpected|Failed to fetch|NetworkError)/.test(error.message) ? error.message : "The connection dropped. Retry to carry on from where it stopped.";
      // Refused when it was started (a role, a type, a size): trying again won't help.
      const refusedAtStart = !file.meta.uploadId;
      server.current.set(file.id, { upload: null, error: message, status: "failed", retryable: !refusedAtStart });
      render();
      opts.current.onFailed?.(itemOf(uppy.getFile(file.id) ?? file));
      checkBatches();
    };
    // Back after a reload: files that finished uploading are followed again.
    const onRestored = () => {
      for (const file of uppy.getFiles()) if (file.progress.uploadComplete && file.meta.uploadId) void follow(file.id, file.meta.uploadId);
      render();
    };
    uppy.on("upload-progress", onChange);
    uppy.on("state-update", onChange);
    uppy.on("upload-success", onSuccess);
    uppy.on("upload-error", onError);
    uppy.on("restored", onRestored);
    return () => {
      uppy.off("upload-progress", onChange);
      uppy.off("state-update", onChange);
      uppy.off("upload-success", onSuccess);
      uppy.off("upload-error", onError);
      uppy.off("restored", onRestored);
    };
  }, [uppy, follow, itemOf, checkBatches]);

  // Destroyed once nothing uses it. React's StrictMode unmounts and mounts again straight away in
  // development: the uploader lives through that (it's checked a moment later), and goes on a real unmount.
  useEffect(() => {
    mounted.set(uppy, (mounted.get(uppy) ?? 0) + 1);
    return () => {
      mounted.set(uppy, (mounted.get(uppy) ?? 1) - 1);
      setTimeout(() => {
        if (!mounted.get(uppy)) uppy.destroy();
      }, 0);
    };
  }, [uppy]);

  const add = useCallback(
    (files: FileList | File[]) => {
      const ids = new Set<string>();
      for (const file of Array.from(files)) {
        try {
          const id = uppy.addFile({ name: file.name, type: file.type, data: file, source: "Local", meta: { purpose: opts.current.purpose(file) } });
          server.current.delete(id);
          ids.add(id);
        } catch {
          // Already in the list (the same file twice): it carries on where it is.
        }
      }
      if (ids.size) batches.current.push({ ids, reported: false });
      render();
    },
    [uppy]
  );

  const items = uppy.getFiles().map(itemOf);
  return {
    items,
    /** Files still on their way (uploading, paused or checking). */
    busy: items.some((i) => i.status === "uploading" || i.status === "paused" || i.status === "checking"),
    add,
    pause: (id: string) => {
      if (!uppy.getFile(id)?.isPaused) uppy.pauseResume(id);
    },
    resume: (id: string) => {
      if (uppy.getFile(id)?.isPaused) uppy.pauseResume(id);
    },
    retry: (id: string) => {
      server.current.delete(id);
      render();
      void uppy.retryUpload(id);
    },
    /** Cancels one still on its way (its parts are deleted), or clears one that's finished or failed from the list. */
    remove: (id: string) => {
      server.current.delete(id);
      uppy.removeFile(id);
      checkBatches();
      render();
    },
    uppy
  };
}
