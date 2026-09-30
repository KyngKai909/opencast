// Settings, Storage maintenance (2026-09-29): each one-off storage job's words. What it does, its
// check's summary ("2 items still airing from 720p copies", "0 Pinata pins to copy", "3 files
// stored by location"), what an apply did, and what the confirm dialog says will change, all from
// the run's counts (StorageRunCounts). The words are in docs/apps/new-copy.md.

import type { StorageJob, StorageRun, StorageRunCounts } from "@opencast/contracts";

const n = (c: StorageRunCounts | null | undefined, k: string) => c?.[k] ?? 0;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "1.2 GB", "388 MB". */
export function sizeWords(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

export const JOB_WORDS: Record<StorageJob, { title: string; explain: string; unit: [string, string] }> = {
  relinkLocations: {
    title: "Files stored by location",
    explain: "Files from before content IDs, found by a disk path or a URL. Apply stores each one by its content ID, points its row there and carries over what was prepared from it.",
    unit: ["file", "files"]
  },
  copyPinata: {
    title: "Pinata pins",
    explain: "Pins copied off Pinata into Opencast's storage and checked by hash; the items that used a pin then play the copy. The catalog's pins stay on IPFS, and nothing is unpinned here.",
    unit: ["pin", "pins"]
  },
  prepareFromOriginals: {
    title: "Items on their 720p copies",
    explain: "Items stored before September 29 still air from a copy capped at 1280 px wide. Apply queues their originals for the worker to prepare, then moves each item onto its original once it's ready.",
    unit: ["item", "items"]
  }
};

/** Pinata isn't set up on the API (the check says so, and there's nothing to apply). */
export function pinataOff(run: StorageRun | null, connected: boolean): boolean {
  return !connected || (!!run?.counts && run.counts.connected === 0);
}

/** A check's summary, the job's headline. */
export function checkLine(job: StorageJob, c: StorageRunCounts): string {
  switch (job) {
    case "relinkLocations": {
      if (!n(c, "rows")) return "No files stored by location";
      return `${plural(n(c, "rows"), "file")} stored by location${n(c, "unreachable") ? `, ${n(c, "unreachable")} can't be read` : ""}`;
    }
    case "copyPinata": {
      if (c.connected === 0) return "Pinata isn't connected here";
      return `${plural(n(c, "moving"), "Pinata pin")} to copy${n(c, "moving") ? ` (${sizeWords(n(c, "movingBytes"))})` : ""}${n(c, "staying") ? `, ${plural(n(c, "staying"), "catalog pin")} ${n(c, "staying") === 1 ? "stays" : "stay"} on IPFS` : ""}`;
    }
    case "prepareFromOriginals": {
      const left = n(c, "items") - n(c, "noOriginal");
      if (!left) return "No items left on their 720p copies";
      return `${plural(left, "item")} still airing from 720p copies`;
    }
  }
}

/** The check's second line, where there's more to say. */
export function checkDetail(job: StorageJob, c: StorageRunCounts): string | null {
  if (job === "copyPinata" && c.connected === 0) return "Set PINATA_JWT on the API to connect it. Until then there's nothing to copy.";
  if (job !== "prepareFromOriginals") return null;
  const parts: string[] = [];
  if (n(c, "toPrepare")) parts.push(`${n(c, "toPrepare")} to prepare`);
  if (n(c, "readyToMove")) parts.push(`${n(c, "readyToMove")} ready to move`);
  if (n(c, "noOriginal")) parts.push(`${n(c, "noOriginal")} with no original ${n(c, "noOriginal") === 1 ? "stays on its copy" : "stay on their copies"}`);
  return parts.length ? `${parts.join(", ")}.` : null;
}

/** What an apply did. */
export function applyLine(job: StorageJob, c: StorageRunCounts): string {
  switch (job) {
    case "relinkLocations":
      return `${plural(n(c, "relinked"), "file")} stored by content ID${n(c, "unreachable") ? `, ${n(c, "unreachable")} couldn't be read and ${n(c, "unreachable") === 1 ? "stays" : "stay"} where ${n(c, "unreachable") === 1 ? "it is" : "they are"}` : ""}`;
    case "copyPinata":
      return `${plural(n(c, "copied"), "pin")} copied and checked${n(c, "relinked") ? `, ${plural(n(c, "relinked"), "file")} now ${n(c, "relinked") === 1 ? "plays" : "play"} the copy` : ""}. Nothing unpinned`;
    case "prepareFromOriginals":
      return `${plural(n(c, "moved"), "item")} moved onto ${n(c, "moved") === 1 ? "its original" : "their originals"}, ${n(c, "queued")} queued for the worker${n(c, "failed") ? `, ${n(c, "failed")} couldn't be prepared` : ""}`;
  }
}

/**
 * Prepare from originals: what's left after the last apply ("Queued for the worker", "Left to
 * prepare"), or that it's finished. Null for the other jobs, or before any apply.
 */
export function leftAfter(job: StorageJob, lastApply: StorageRun | null, lastCheck: StorageRun | null): { queued: number; toPrepare: number; readyToMove: number; done: boolean } | null {
  if (job !== "prepareFromOriginals" || !lastApply?.counts) return null;
  const queued = n(lastApply.counts, "queued");
  // A check since then says what's left; otherwise what the apply queued is still to prepare.
  const since = lastCheck?.counts && Date.parse(lastCheck.startedAt) >= Date.parse(lastApply.startedAt) ? lastCheck.counts : null;
  const toPrepare = since ? n(since, "toPrepare") : queued;
  const readyToMove = since ? n(since, "readyToMove") : 0;
  return { queued, toPrepare, readyToMove, done: !toPrepare && !readyToMove };
}

/** The confirm dialog: its title, what will change, and its button. Uses the last check's counts when there is one. */
export function confirmWords(job: StorageJob, check: StorageRunCounts | null): { title: string; body: string[]; button: string } {
  switch (job) {
    case "relinkLocations": {
      const rows = check ? n(check, "rows") : null;
      return {
        title: rows === null ? "Store the files by content ID?" : `Store ${plural(rows, "file")} by content ID?`,
        body: [
          "Each file is read, stored by its content ID in Infrequent Access, and its row points there. What was prepared from it carries over, so nothing is prepared again.",
          "Files that can't be read are left as they are. Nothing is deleted."
        ],
        button: "Store them"
      };
    }
    case "copyPinata": {
      const moving = check ? n(check, "moving") : null;
      return {
        title: moving === null ? "Copy the Pinata pins?" : `Copy ${plural(moving, "Pinata pin")}?`,
        body: [
          `Each pin but the catalog's is copied into storage${moving ? ` (${sizeWords(n(check, "movingBytes"))})` : ""} and checked by hash; the items that used it then play the copy.`,
          "The pins stay on Pinata. Unpinning is a separate step, and it isn't done here."
        ],
        button: "Copy them"
      };
    }
    case "prepareFromOriginals": {
      const toPrepare = check ? n(check, "toPrepare") : null;
      const ready = check ? n(check, "readyToMove") : null;
      return {
        title: "Prepare from the originals?",
        body: [
          toPrepare === null
            ? "Originals not prepared yet are queued for the worker, soon after what airs within the hour."
            : `${plural(toPrepare, "original")} ${toPrepare === 1 ? "is" : "are"} queued for the worker, soon after what airs within the hour.`,
          `${ready === 1 ? "1 item whose original is ready moves onto it, as a new file version." : `${ready ? plural(ready, "item") : "Items"} whose originals are ready move onto them, as new file versions.`} The 720p copies go once nothing points at them; originals are never deleted.`,
          "Apply again once the worker has prepared what's queued, until nothing is left."
        ],
        button: "Apply"
      };
    }
  }
}

/** While a run goes: "Checking, 1 of 3 files". */
export function progressLine(run: StorageRun): string {
  const verb = run.mode === "apply" ? "Applying" : "Checking";
  const p = run.progress;
  if (!p || !p.total) return `${verb}…`;
  const [one, many] = JOB_WORDS[run.job].unit;
  return `${verb}, ${Math.min(p.done, p.total)} of ${p.total} ${p.total === 1 ? one : many}`;
}
