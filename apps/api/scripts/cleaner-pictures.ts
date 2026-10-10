// Items prepared before 2026-10-09 went through a pipeline that didn't tonemap HDR or deinterlace
// (programming prompt, Phase 1): HDR phone video airs washed out and grey, interlaced video combed.
// This probes every video item prepared before then and prepares the HDR or interlaced ones again,
// beside their first copy (`prepared/<content ID>-p2/`); the first copy airs until the new one is
// ready in every rendition, then the new one does. Everything else keeps its segments. By default
// it only reports (a dry run: it probes, counts and changes nothing; `toPrepare` is how many items
// it would touch). With --apply it keeps what the probe found and queues those items for the
// worker, after anything airing soon. Run it again (with --apply) until nothing is queued: it's
// safe to rerun.
//
//   npx tsx --conditions=source scripts/cleaner-pictures.ts            report (dry run)
//   npx tsx --conditions=source scripts/cleaner-pictures.ts --apply    probe, keep, queue

import { promises as fs } from "node:fs";
import path from "node:path";
import { STORAGE_ROOT } from "../src/config.js";
import { createDeps, createV1 } from "../src/v1/runtime.js";
import { prepareCleanerPictures } from "../src/v1/storageMaintenance.js";

const APPLY = process.argv.includes("--apply");

const deps = createDeps(process.env, STORAGE_ROOT);
const { services } = createV1(deps);
const { entries, ...counts } = await prepareCleanerPictures({ deps, services }, { apply: APPLY, onProgress: (done, total) => void (done && done % 25 === 0 && done < total && console.error(`${done} of ${total}`)) });
const out = path.join(STORAGE_ROOT, `cleaner-pictures-${Date.now()}.json`);
await fs.writeFile(out, JSON.stringify({ at: new Date().toISOString(), apply: APPLY, ...counts, entries }, null, 2));
for (const e of entries) if (e.state !== "unchanged") console.log(JSON.stringify(e));
console.log(JSON.stringify({ apply: APPLY, ...counts }, null, 2));
console.log(`Report: ${out}`);
process.exit(0);
