// One-time migration from the old data model. Reads the `opencast_state` blob
// (from LEGACY_DATABASE_URL, or DATABASE_URL if it still has the table) and any
// JSON files given as arguments; writes into the new tables at DATABASE_URL.
// The old table and files are only read.
//
//   npm run db:migrate:legacy -- [--report docs/migration-report.md] [storage/db.json ...]

import { promises as fs } from "node:fs";
import path from "node:path";
import pg from "pg";
import type { DatabaseSchema } from "@opencast/domain";
import { migrateLegacy, type MigrationReport } from "../src/legacy/migrate.js";

const args = process.argv.slice(2);
const reportIndex = args.indexOf("--report");
const reportPath = reportIndex >= 0 ? args.splice(reportIndex, 2)[1] : undefined;
const files = args;

const targetUrl = process.env.DATABASE_URL ?? "postgres://opencast:opencast@localhost:54329/opencast";
const legacyUrl = process.env.LEGACY_DATABASE_URL ?? targetUrl;

const COLLECTIONS = [
  "channels",
  "assets",
  "assetFolders",
  "playlistItems",
  "playoutStates",
  "commands",
  "streamSchedules",
  "destinations",
  "livepeerConfigs",
  "externalIngestJobs"
] as const;

function normalize(input: unknown): DatabaseSchema {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return Object.fromEntries(COLLECTIONS.map((key) => [key, Array.isArray(raw[key]) ? raw[key] : []])) as unknown as DatabaseSchema;
}

async function readBlob(): Promise<{ source: string; db: DatabaseSchema } | undefined> {
  const client = new pg.Client({ connectionString: legacyUrl });
  await client.connect();
  try {
    const exists = await client.query(`SELECT to_regclass('public.opencast_state') AS t`);
    if (!exists.rows[0].t) return undefined;
    const row = await client.query(`SELECT state FROM public.opencast_state WHERE id = 1`);
    if (!row.rows[0]) return undefined;
    return { source: `opencast_state at ${new URL(legacyUrl).host}${new URL(legacyUrl).pathname}`, db: normalize(row.rows[0].state) };
  } finally {
    await client.end();
  }
}

const sources: Array<{ source: string; db: DatabaseSchema }> = [];
const blob = await readBlob();
if (blob) sources.push(blob);
for (const file of files) {
  sources.push({ source: path.basename(file), db: normalize(JSON.parse(await fs.readFile(file, "utf8"))) });
}
if (sources.length === 0) {
  console.error("Nothing to migrate: no opencast_state table and no JSON files given.");
  process.exit(1);
}

const target = new pg.Client({ connectionString: targetUrl });
await target.connect();
const reports: MigrationReport[] = [];
for (const { source, db } of sources) {
  await target.query("BEGIN");
  try {
    reports.push(await migrateLegacy(target, db, source));
    await target.query("COMMIT");
  } catch (error) {
    await target.query("ROLLBACK");
    throw error;
  }
}
await target.end();

const markdown = renderReport(reports);
if (reportPath) {
  await fs.writeFile(reportPath, markdown);
  console.log(`Report written to ${reportPath}`);
}
console.log(markdown);

function renderReport(all: MigrationReport[]): string {
  const lines = [`# Legacy migration report`, ``, `Run ${new Date().toISOString()} into ${new URL(targetUrl).host}${new URL(targetUrl).pathname}.`, ``];
  for (const r of all) {
    lines.push(`## ${r.source}`, ``);
    lines.push(`Read: ${Object.entries(r.read).map(([k, v]) => `${k} ${v}`).join(", ")}.`, ``);
    lines.push(`| Table | Written | Already there |`, `|---|---|---|`);
    const tables = new Set([...Object.keys(r.written), ...Object.keys(r.skippedExisting)]);
    for (const t of [...tables].sort()) lines.push(`| ${t} | ${r.written[t] ?? 0} | ${r.skippedExisting[t] ?? 0} |`);
    lines.push(``, `### Didn't map (${r.unmapped.length})`, ``);
    lines.push(...(r.unmapped.length ? r.unmapped.map((u) => `- \`${u.table}\` ${u.id}: ${u.reason}`) : ["None."]));
    lines.push(``, `### Mapped, needs a look (${r.notes.length})`, ``);
    lines.push(...(r.notes.length ? r.notes.map((u) => `- \`${u.table}\` ${u.id}: ${u.reason}`) : ["None."]));
    lines.push(``);
  }
  return lines.join("\n");
}
