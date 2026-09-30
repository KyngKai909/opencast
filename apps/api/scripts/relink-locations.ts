// Files from before content IDs are keyed by where they were: a disk path or a URL (prepared for
// air as `loc-…`). By default this only reports them (and whether each can be read). With
// --relink it reads each one, stores it by its content ID in Infrequent Access (it's an
// original), points the row at the content ID (`storage` becomes the object store, a reference is
// added) and carries what was prepared under `loc-…` over to the content ID (the same bytes, so
// nothing is prepared again). Rows whose file can't be read are reported and left. It never
// deletes or unpins anything, and it's safe to run again: rows with a content ID are skipped.
// Pinata pins are relinked by `storage:move-off-pinata --copy` too.
//
//   npx tsx --conditions=source scripts/relink-locations.ts             report
//   npx tsx --conditions=source scripts/relink-locations.ts --relink    store and relink

import { promises as fs } from "node:fs";
import path from "node:path";
import { STORAGE_ROOT } from "../src/config.js";
import { createDeps, createV1 } from "../src/v1/runtime.js";
import { relinkLocations } from "../src/v1/storageMaintenance.js";

const RELINK = process.argv.includes("--relink");

const deps = createDeps(process.env, STORAGE_ROOT);
const { services } = createV1(deps);
const result = await relinkLocations({ deps, services }, { relink: RELINK });
const { entries, ...counts } = result;
const out = path.join(STORAGE_ROOT, `relink-locations-${Date.now()}.json`);
await fs.writeFile(out, JSON.stringify({ at: new Date().toISOString(), relink: RELINK, store: deps.storage.objects.name, ...counts, entries }, null, 2));
for (const e of entries) console.log(JSON.stringify(e));
console.log(JSON.stringify({ relink: RELINK, store: deps.storage.objects.name, ...counts }, null, 2));
console.log(`Report: ${out}`);
process.exit(0);
