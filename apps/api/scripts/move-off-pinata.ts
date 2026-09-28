// Moves files off Pinata. By default it only reports: what's pinned, how many
// gigabytes, what stays (the Opencast catalog), and what storage costs before and
// after. With --copy it copies each pin into object storage under its content ID
// and verifies the copy by hash. With --unpin --yes-unpin it then unpins every
// verified copy that isn't a catalog item. Unpinning deletes the IPFS copy: it can't
// be undone, so it's never the default.
//
//   npx tsx scripts/move-off-pinata.ts                   report
//   npx tsx scripts/move-off-pinata.ts --copy            copy + verify, and write the report
//   npx tsx scripts/move-off-pinata.ts --copy --unpin --yes-unpin
//   --keep <ipfsCid>   (repeatable) treat a pin as a catalog item
//   --pinata-monthly <dollars>   what the Pinata plan costs, for the before-and-after

import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isNotNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import { STORAGE_ROOT } from "../src/config.js";
import { createDeps, createV1 } from "../src/v1/runtime.js";
import { contentIdOf, objectKey, sha256FromCid } from "../src/v1/storage.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const values = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const COPY = flag("--copy");
const UNPIN = flag("--unpin") && flag("--yes-unpin");
if (flag("--unpin") && !flag("--yes-unpin")) {
  console.error("--unpin deletes the IPFS copies and can't be undone. Add --yes-unpin to confirm.");
  process.exit(1);
}

// Published prices (per GB-month). R2 has no charge for reads (egress); Infrequent
// Access adds a retrieval fee and a 30-day minimum.
const R2 = { standard: 0.015, infrequent: 0.01, infrequentRetrievalPerGb: 0.01 };
const GB = 1024 ** 3;

const jwt = process.env.PINATA_JWT;
if (!jwt) {
  console.error("PINATA_JWT isn't set.");
  process.exit(1);
}
const gateway = (process.env.PINATA_GATEWAY_BASE ?? "https://gateway.pinata.cloud/ipfs").replace(/\/+$/, "");

interface Pin {
  ipfsCid: string;
  bytes: number;
  name: string | null;
  /** How to unpin it: a v3 file id, or the legacy pin (by CID). */
  unpin: { kind: "v3"; network: "public" | "private"; id: string } | { kind: "legacy" };
}

async function pinata(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${jwt}`, ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${url} answered ${response.status}`);
  return response.status === 204 ? null : response.json();
}

/** Which listings this key could read (a scoped key may not read them all). */
const listings: Record<string, string> = {};

async function listPins(): Promise<Pin[]> {
  const pins = new Map<string, Pin>();
  // Files uploaded through the v3 API (what the old API used), both networks.
  for (const network of ["public", "private"] as const) {
    let token: string | undefined;
    do {
      const page = (await pinata(`https://api.pinata.cloud/v3/files/${network}?limit=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`).catch((error: Error) => {
        listings[`v3 ${network}`] = error.message;
        return null;
      })) as {
        data?: { files?: Array<{ id: string; cid: string; size: number; name: string | null }>; next_page_token?: string };
      } | null;
      for (const f of page?.data?.files ?? []) pins.set(f.cid, { ipfsCid: f.cid, bytes: f.size, name: f.name, unpin: { kind: "v3", network, id: f.id } });
      if (page) listings[`v3 ${network}`] ??= "read";
      token = page?.data?.next_page_token || undefined;
    } while (token);
  }
  // Anything pinned through the legacy pinning API.
  for (let offset = 0; ; offset += 1000) {
    const page = (await pinata(`https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=1000&pageOffset=${offset}`).catch((error: Error) => {
      listings.legacy = error.message;
      return null;
    })) as { rows: Array<{ ipfs_pin_hash: string; size: number; metadata?: { name?: string } }> } | null;
    if (!page) break;
    listings.legacy ??= "read";
    for (const r of page.rows) if (!pins.has(r.ipfs_pin_hash)) pins.set(r.ipfs_pin_hash, { ipfsCid: r.ipfs_pin_hash, bytes: r.size, name: r.metadata?.name ?? null, unpin: { kind: "legacy" } });
    if (page.rows.length < 1000) break;
  }
  return [...pins.values()];
}

async function unpin(pin: Pin) {
  if (pin.unpin.kind === "v3") await pinata(`https://api.pinata.cloud/v3/files/${pin.unpin.network}/${pin.unpin.id}`, { method: "DELETE" });
  else await pinata(`https://api.pinata.cloud/pinning/unpin/${pin.ipfsCid}`, { method: "DELETE" });
}

const deps = createDeps(process.env, STORAGE_ROOT);
const { services } = createV1(deps);
const catalog = new Set([
  ...values("--keep"),
  ...(await deps.db.select({ cid: schema.contents.ipfsCid, reason: schema.contents.ipfsReason }).from(schema.contents).where(isNotNull(schema.contents.ipfsCid)))
    .filter((r) => r.reason === "catalog")
    .map((r) => r.cid!)
]);

const pins = await listPins();
const total = pins.reduce((sum, p) => sum + p.bytes, 0);
const moving = pins.filter((p) => !catalog.has(p.ipfsCid));
const staying = pins.filter((p) => catalog.has(p.ipfsCid));
const movingBytes = moving.reduce((sum, p) => sum + p.bytes, 0);
const stayingBytes = staying.reduce((sum, p) => sum + p.bytes, 0);

const report: Record<string, unknown> = {
  at: new Date().toISOString(),
  store: deps.storage.objects.name,
  listings,
  pinned: { files: pins.length, gb: +(total / GB).toFixed(3) },
  moving: { files: moving.length, gb: +(movingBytes / GB).toFixed(3) },
  stayingOnIpfs: { files: staying.length, gb: +(stayingBytes / GB).toFixed(3), cids: staying.map((p) => p.ipfsCid) },
  monthly: {
    pinataBefore: values("--pinata-monthly")[0] ? Number(values("--pinata-monthly")[0]) : "your Pinata plan's price",
    // Originals move to Infrequent Access until an asset points at them as its prepared file.
    r2After: +((movingBytes / GB) * R2.infrequent).toFixed(2),
    r2AfterIfAllStandard: +((movingBytes / GB) * R2.standard).toFixed(2),
    pinataAfter: staying.length ? "the smallest plan that holds the catalog" : 0
  },
  copies: [] as unknown[]
};

if (COPY) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pinata-move-"));
  for (const pin of moving) {
    const file = path.join(dir, pin.ipfsCid);
    const entry: Record<string, unknown> = { ipfsCid: pin.ipfsCid, name: pin.name, bytes: pin.bytes };
    try {
      const response = await fetch(`${gateway}/${pin.ipfsCid}`);
      if (!response.ok || !response.body) throw new Error(`gateway answered ${response.status}`);
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(file));
      const stored = await services.library.content.store(file, { storageClass: "infrequent" });
      // Verify: read the copy back from storage and hash it.
      const back = path.join(dir, `${pin.ipfsCid}.back`);
      await deps.storage.objects.download(objectKey.file(stored.cid), back);
      const readBack = (await contentIdOf(back)).sha256;
      entry.contentId = stored.cid;
      entry.verified = readBack.equals(sha256FromCid(stored.cid)) && readBack.equals(createHash("sha256").update(await fs.readFile(file)).digest());
      if (entry.verified && UNPIN) {
        await unpin(pin);
        entry.unpinned = true;
      }
      await fs.rm(back, { force: true });
    } catch (error) {
      entry.error = (error as Error).message;
    } finally {
      await fs.rm(file, { force: true });
    }
    (report.copies as unknown[]).push(entry);
    console.log(JSON.stringify(entry));
  }
  await fs.rm(dir, { recursive: true, force: true });
}

const out = path.join(STORAGE_ROOT, `pinata-move-${Date.now()}.json`);
await fs.writeFile(out, JSON.stringify(report, null, 2));
const { copies: _copies, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
console.log(`Report: ${out}`);
process.exit(0);
