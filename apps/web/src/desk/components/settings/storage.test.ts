// Storage maintenance's words from a run's counts: each check's summary, what an apply did, what's
// left to prepare, the confirm dialog, and progress.
import { describe, expect, it } from "vitest";
import type { StorageRun } from "@opencast/contracts";
import { applyLine, checkDetail, checkLine, confirmWords, leftAfter, pinataOff, progressLine, sizeWords } from "./storage";

const run = (over: Partial<StorageRun>): StorageRun => ({
  id: "00000000-0000-4000-8000-000000000001",
  job: "prepareFromOriginals",
  mode: "check",
  status: "done",
  by: { userId: "00000000-0000-4000-8000-000000000900", name: "Dee A." },
  startedAt: "2026-09-27T03:40:00.000Z",
  finishedAt: "2026-09-27T03:40:04.000Z",
  progress: null,
  counts: {},
  error: null,
  hasReport: true,
  ...over
});

describe("a check's summary", () => {
  it("says what each job found, as the brief has it", () => {
    expect(checkLine("prepareFromOriginals", { items: 3, toPrepare: 2, noOriginal: 1 })).toBe("2 items still airing from 720p copies");
    expect(checkDetail("prepareFromOriginals", { items: 3, toPrepare: 2, noOriginal: 1 })).toBe("2 to prepare, 1 with no original stays on its copy.");
    expect(checkLine("prepareFromOriginals", { items: 1, noOriginal: 1 })).toBe("No items left on their 720p copies");
    expect(checkLine("copyPinata", { connected: 1, moving: 0, staying: 2 })).toBe("0 Pinata pins to copy, 2 catalog pins stay on IPFS");
    expect(checkLine("copyPinata", { connected: 1, moving: 1, movingBytes: 1.5 * 1024 ** 3 })).toBe("1 Pinata pin to copy (1.5 GB)");
    expect(checkLine("copyPinata", { connected: 0, moving: 0 })).toBe("Pinata isn't connected here");
    expect(checkDetail("copyPinata", { connected: 0 })).toBe("Set PINATA_JWT on the API to connect it. Until then there's nothing to copy.");
    expect(checkLine("relinkLocations", { rows: 3, unreachable: 0 })).toBe("3 files stored by location");
    expect(checkLine("relinkLocations", { rows: 3, unreachable: 1 })).toBe("3 files stored by location, 1 can't be read");
    expect(checkLine("relinkLocations", { rows: 0 })).toBe("No files stored by location");
    expect(sizeWords(388 * 1024 ** 2)).toBe("388 MB");
  });

  it("knows when Pinata isn't connected", () => {
    expect(pinataOff(null, false)).toBe(true);
    expect(pinataOff(run({ job: "copyPinata", counts: { connected: 0 } }), true)).toBe(true);
    expect(pinataOff(run({ job: "copyPinata", counts: { connected: 1 } }), true)).toBe(false);
  });
});

describe("an apply", () => {
  it("says what it did, never unpinning", () => {
    expect(applyLine("relinkLocations", { relinked: 2, unreachable: 1 })).toBe("2 files stored by content ID, 1 couldn't be read and stays where it is");
    expect(applyLine("copyPinata", { copied: 3, relinked: 4 })).toBe("3 pins copied and checked, 4 files now play the copy. Nothing unpinned");
    expect(applyLine("prepareFromOriginals", { moved: 1, queued: 1 })).toBe("1 item moved onto its original, 1 queued for the worker");
  });

  it("says what's queued and left to prepare until nothing is", () => {
    const apply = run({ mode: "apply", startedAt: "2026-09-27T03:41:00.000Z", counts: { queued: 2, moved: 0 } });
    expect(leftAfter("prepareFromOriginals", apply, run({}))).toEqual({ queued: 2, toPrepare: 2, readyToMove: 0, done: false });
    const later = run({ startedAt: "2026-09-27T04:00:00.000Z", counts: { toPrepare: 0, readyToMove: 2 } });
    expect(leftAfter("prepareFromOriginals", apply, later)).toEqual({ queued: 2, toPrepare: 0, readyToMove: 2, done: false });
    expect(leftAfter("prepareFromOriginals", run({ mode: "apply", counts: { queued: 0, moved: 2 } }), null)).toEqual({ queued: 0, toPrepare: 0, readyToMove: 0, done: true });
    expect(leftAfter("relinkLocations", apply, null)).toBeNull();
    expect(leftAfter("prepareFromOriginals", null, run({}))).toBeNull();
  });

  it("confirms what will change, from the last check", () => {
    expect(confirmWords("prepareFromOriginals", { toPrepare: 2, readyToMove: 0 })).toEqual({
      title: "Prepare from the originals?",
      body: [
        "2 originals are queued for the worker, soon after what airs within the hour.",
        "Items whose originals are ready move onto them, as new file versions. The 720p copies go once nothing points at them; originals are never deleted.",
        "Apply again once the worker has prepared what's queued, until nothing is left."
      ],
      button: "Apply"
    });
    expect(confirmWords("copyPinata", { moving: 2, movingBytes: 800 * 1024 ** 2 })).toMatchObject({ title: "Copy 2 Pinata pins?", body: [expect.stringContaining("(800 MB)"), "The pins stay on Pinata. Unpinning is a separate step, and it isn't done here."] });
    expect(confirmWords("relinkLocations", null)).toMatchObject({ title: "Store the files by content ID?", button: "Store them" });
  });
});

describe("progress", () => {
  it("counts what's done while it runs", () => {
    expect(progressLine(run({ status: "running", counts: null, progress: { done: 1, total: 3 } }))).toBe("Checking, 1 of 3 items");
    expect(progressLine(run({ job: "copyPinata", mode: "apply", status: "running", progress: { done: 0, total: 1 } }))).toBe("Applying, 0 of 1 pin");
    expect(progressLine(run({ job: "relinkLocations", status: "running", progress: null }))).toBe("Checking…");
  });
});
