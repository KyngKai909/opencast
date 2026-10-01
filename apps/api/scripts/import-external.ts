// Adds external stations and IPTV-list leads from a file, through the same service the Network desk
// uses, so every rule holds: a listing goes on the dial only with its evidence, channel numbers and
// call signs follow the listing rules, and list channels are leads only (follow-up Phase 6). The
// admin named by --as (an email on their account) is recorded as having made each change. By
// default it only reports what it would do; --apply writes. Safe to rerun: a lead whose stream is
// already a lead or a listing, and a listing whose call sign or channel is taken, are skipped.
//
//   npx tsx --conditions=source scripts/import-external.ts --file <plan.json> --as <admin email> [--apply]
//
// The plan: { "market": "<slug>", "m3u": "<path to an M3U>", "listings": [<addListedSource input
// without marketId>] }; `m3u` and `listings` are both optional.

import { promises as fs } from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@opencast/db";
import { STORAGE_ROOT } from "../src/config.js";
import { createDeps, createV1 } from "../src/v1/runtime.js";
import type { AddListedInput } from "../src/v1/modules/network/external.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const APPLY = process.argv.includes("--apply");
const file = arg("--file");
const as = arg("--as")?.toLowerCase();
if (!file || !as) throw new Error("Use --file <plan.json> --as <admin email> [--apply]");

const plan = JSON.parse(await fs.readFile(file, "utf8")) as { market: string; m3u?: string; listings?: Array<Omit<AddListedInput, "marketId">> };
const deps = createDeps(process.env, STORAGE_ROOT);
const { services } = createV1(deps);
const { db } = deps;

const [market] = await db.select({ id: schema.markets.id, name: schema.markets.name }).from(schema.markets).where(eq(schema.markets.slug, plan.market));
if (!market) throw new Error(`No market "${plan.market}"`);
const [admin] = await db
  .select({ id: schema.users.id, privyDid: schema.users.privyDid, isAdmin: schema.users.isAdmin })
  .from(schema.users)
  .innerJoin(schema.identities, eq(schema.identities.userId, schema.users.id))
  .where(and(eq(schema.identities.value, as), inArray(schema.identities.kind, ["email", "google", "apple"])));
if (!admin?.isAdmin) throw new Error("--as must be an admin's email (sign in to the desk once first)");
const user = { id: admin.id, privyDid: admin.privyDid, isAdmin: true };
console.log(`${APPLY ? "Applying" : "Dry run"} in ${market.name}`);

if (plan.m3u) {
  const m3u = await fs.readFile(path.resolve(path.dirname(file), plan.m3u), "utf8");
  const preview = await services.network.previewIptvList({ m3u });
  const fresh = preview.channels.filter((c) => !c.already);
  for (const c of preview.channels) console.log(`  lead  ${c.already ? `skip (already ${c.already})` : "add "}  ${c.name}`);
  if (APPLY && fresh.length) {
    const { imported, skipped } = await services.network.importIptvLeads({ marketId: market.id, channels: fresh.map(({ already: _, ...c }) => c) });
    console.log(`  leads imported: ${imported.length}, skipped: ${skipped}`);
  }
}

for (const listing of plan.listings ?? []) {
  const label = `${listing.channel} ${listing.callSign} (${listing.name})`;
  if (!APPLY) {
    console.log(`  list  add   ${label}`);
    continue;
  }
  try {
    const added = await services.network.addListedSource(user, { ...listing, marketId: market.id });
    console.log(`  list  added ${label}: ${added.onDial ? "on the dial" : `waiting (${added.waiting ?? "checks"})`}`);
  } catch (error) {
    console.log(`  list  skip  ${label}: ${(error as Error).message}`);
  }
}
process.exit(0);
