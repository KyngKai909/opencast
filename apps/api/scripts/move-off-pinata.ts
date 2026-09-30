// Moves files off Pinata. By default it only reports: what's pinned, how many
// gigabytes, what stays (the Opencast catalog), and what storage costs before and
// after. With --copy it copies each pin into object storage under its content ID
// (Infrequent Access: they're originals), verifies the copy by hash, and then points
// every row that used the pin (legacy asset files stored on IPFS, and any file row
// whose location names it) at the new content ID, carrying over what was prepared
// from the old location. --copy never unpins or deletes anything, and it's safe to run
// again. With --unpin --yes-unpin it then unpins every verified copy that isn't a
// catalog item. Unpinning deletes the IPFS copy: it can't be undone, so it's never the
// default, and it's a separate decision from the copy.
//
//   npx tsx scripts/move-off-pinata.ts                   report
//   npx tsx scripts/move-off-pinata.ts --copy            copy + verify, and write the report
//   npx tsx scripts/move-off-pinata.ts --copy --unpin --yes-unpin
//   --keep <ipfsCid>   (repeatable) treat a pin as a catalog item
//   --pinata-monthly <dollars>   what the Pinata plan costs, for the before-and-after
//
// The desk runs the report and --copy too (Settings, Storage maintenance); --unpin is only here.

import { promises as fs } from "node:fs";
import path from "node:path";
import { STORAGE_ROOT } from "../src/config.js";
import { createDeps, createV1 } from "../src/v1/runtime.js";
import { moveOffPinata, pinataFromEnv, type Pin } from "../src/v1/storageMaintenance.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const values = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const COPY = flag("--copy");
const UNPIN = flag("--unpin") && flag("--yes-unpin");
if (flag("--unpin") && !flag("--yes-unpin")) {
  console.error("--unpin deletes the IPFS copies and can't be undone. Add --yes-unpin to confirm.");
  process.exit(1);
}

const jwt = process.env.PINATA_JWT;
const pinata = pinataFromEnv(process.env);
if (!jwt || !pinata) {
  console.error("PINATA_JWT isn't set.");
  process.exit(1);
}

// Unpinning lives here only (the desk's Storage maintenance never unpins).
async function unpin(pin: Pin) {
  const url = pin.unpin.kind === "v3" ? `https://api.pinata.cloud/v3/files/${pin.unpin.network}/${pin.unpin.id}` : `https://api.pinata.cloud/pinning/unpin/${pin.ipfsCid}`;
  const response = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${jwt}` } });
  if (!response.ok) throw new Error(`DELETE ${url} answered ${response.status}`);
}

const deps = createDeps(process.env, STORAGE_ROOT);
const { services } = createV1(deps);
const monthly = values("--pinata-monthly")[0];
const { report } = await moveOffPinata({ deps, services }, pinata, {
  copy: COPY,
  keep: values("--keep"),
  pinataMonthly: monthly ? Number(monthly) : undefined,
  async afterCopy(pin, entry) {
    if (entry.verified && UNPIN) {
      try {
        await unpin(pin);
        entry.unpinned = true;
      } catch (error) {
        entry.unpinError = (error as Error).message;
      }
    }
    console.log(JSON.stringify(entry));
  }
});

const out = path.join(STORAGE_ROOT, `pinata-move-${Date.now()}.json`);
await fs.writeFile(out, JSON.stringify(report, null, 2));
const { copies: _copies, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
console.log(`Report: ${out}`);
process.exit(0);
