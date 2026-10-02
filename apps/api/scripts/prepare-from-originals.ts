// Items stored before 2026-09-29 were prepared for air from a copy capped at 1280 px wide (their
// 1080p rendition upscaled from it). This prepares them again from their originals and moves
// each item onto its original. By default it only reports. With --apply it queues the originals
// not prepared yet (the worker prepares them, soon after what airs within the hour) and moves the
// items whose original is prepared; the copies then go, with what was prepared from them, once
// nothing points at them. Run it again (with --apply) until nothing is queued: it's safe to rerun.
// Items with no original stored stay on their copy.
//
//   npx tsx --conditions=source scripts/prepare-from-originals.ts            report
//   npx tsx --conditions=source scripts/prepare-from-originals.ts --apply    queue, then move

import { promises as fs } from "node:fs";
import path from "node:path";
import { STORAGE_ROOT } from "../src/config.js";
import { createDeps, createV1 } from "../src/v1/runtime.js";
import { prepareFromOriginals } from "../src/v1/storageMaintenance.js";

const APPLY = process.argv.includes("--apply");
const GB = 1024 ** 3;

const deps = createDeps(process.env, STORAGE_ROOT);
const { services } = createV1(deps);
const result = await prepareFromOriginals({ deps, services }, { apply: APPLY });
const { entries, copyBytes, ...counts } = result;
const out = path.join(STORAGE_ROOT, `prepare-from-originals-${Date.now()}.json`);
await fs.writeFile(out, JSON.stringify({ at: new Date().toISOString(), apply: APPLY, ...counts, copyGb: +(copyBytes / GB).toFixed(3), entries }, null, 2));
for (const e of entries) if (e.error || e.state === "no_original") console.log(JSON.stringify(e));
console.log(JSON.stringify({ apply: APPLY, ...counts, copyGb: +(copyBytes / GB).toFixed(3) }, null, 2));
console.log(`Report: ${out}`);
process.exit(0);
