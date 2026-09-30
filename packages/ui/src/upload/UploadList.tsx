import { cx } from "../lib/cx";
import { Button } from "../primitives/Button";
import type { UploadItem } from "./useDirectUpload";
import "./UploadList.css";

/** "1.2 GB", "340 MB", "86 KB". */
export function fileSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** Where a file is, in words: "Uploading, 45%", "Checking", "Preparing for air". */
export function uploadStatusWords(item: UploadItem, finishedWords = "Preparing for air"): string {
  const pct = item.bytes ? Math.floor((item.sent / item.bytes) * 100) : 0;
  switch (item.status) {
    case "uploading":
      return `Uploading, ${pct}%`;
    case "paused":
      return `Paused at ${pct}%`;
    case "checking":
      return "Checking";
    case "preparing":
      return finishedWords;
    case "done":
      return "Done";
    case "failed":
      return item.error ?? "Couldn't upload. Retry to carry on.";
    case "choose_again":
      return `Stopped at ${pct}%. Choose the file again to carry on.`;
  }
}

export interface UploadListProps {
  items: UploadItem[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  /** Cancel (still on its way) or clear (finished or failed). */
  onRemove: (id: string) => void;
  /** What a finished file is doing: "Preparing for air" (the default), "Checked", "Attached". */
  finishedWords?: string;
  /** A label for the list, for screen readers. */
  label?: string;
  className?: string;
}

/**
 * Files on their way to storage: each one's name, size and progress, then "Checking" and "Preparing
 * for air" as the API takes over, with Pause and Resume, Retry after a dropped connection, and Cancel.
 */
export function UploadList({ items, onPause, onResume, onRetry, onRemove, finishedWords, label = "Uploads", className }: UploadListProps) {
  if (!items.length) return null;
  return (
    <ul className={cx("oc-upl", className)} aria-label={label}>
      {items.map((item) => {
        const pct = item.bytes ? Math.floor((item.sent / item.bytes) * 100) : 0;
        const words = uploadStatusWords(item, finishedWords);
        const moving = item.status === "uploading" || item.status === "paused";
        const finished = item.status === "preparing" || item.status === "done";
        return (
          <li key={item.id} className={cx("oc-upl__row", `oc-upl__row--${item.status}`)}>
            <div className="oc-upl__top">
              <span className="oc-upl__name" title={item.name}>
                {item.name}
              </span>
              <span className="oc-upl__size oc-mono">{fileSize(item.bytes)}</span>
            </div>
            <div
              className="oc-upl__bar"
              role="progressbar"
              aria-label={`${item.name}, uploaded`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={finished || item.status === "checking" ? 100 : pct}
              aria-valuetext={words}
            >
              <i style={{ width: `${finished || item.status === "checking" ? 100 : pct}%` }} />
            </div>
            <div className="oc-upl__foot">
              <span className="oc-upl__status" role={item.status === "failed" ? "alert" : undefined} aria-live="polite">
                {words}
              </span>
              <span className="oc-upl__actions">
                {item.status === "uploading" && (
                  <Button size="sm" variant="text" icon="pause" onClick={() => onPause(item.id)} aria-label={`Pause ${item.name}`}>
                    Pause
                  </Button>
                )}
                {item.status === "paused" && (
                  <Button size="sm" variant="text" icon="play" onClick={() => onResume(item.id)} aria-label={`Resume ${item.name}`}>
                    Resume
                  </Button>
                )}
                {item.status === "failed" && item.retryable && (
                  <Button size="sm" variant="text" onClick={() => onRetry(item.id)} aria-label={`Retry ${item.name}`}>
                    Retry
                  </Button>
                )}
                {(moving || item.status === "choose_again") && (
                  <Button size="sm" variant="text" onClick={() => onRemove(item.id)} aria-label={`Cancel ${item.name}`}>
                    Cancel
                  </Button>
                )}
                {(finished || item.status === "failed") && (
                  <Button size="sm" variant="text" icon="x" onClick={() => onRemove(item.id)} aria-label={`Clear ${item.name}`} />
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
