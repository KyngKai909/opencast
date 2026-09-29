// Prints a station's as-run log, and what each spot cost and who was paid.
//   npx tsx scripts/as-run.ts <stationId> [since ISO time]
import { and, asc, eq, gte } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createDeps, createV1 } from "@opencast/api/runtime";
import { STORAGE_ROOT } from "../src/config.js";

const [stationId, since] = process.argv.slice(2);
const deps = createDeps(process.env, STORAGE_ROOT);
const { services } = createV1(deps);
const rows = await deps.db
  .select()
  .from(schema.asRun)
  .where(and(eq(schema.asRun.stationId, stationId), gte(schema.asRun.startedAt, since ? new Date(since) : new Date(0))))
  .orderBy(asc(schema.asRun.startedAt));
const titles = await services.library.titles({ itemIds: rows.map((r) => r.assetId).filter((v): v is string => Boolean(v)), programIds: rows.map((r) => r.programId).filter((v): v is string => Boolean(v)) });
const costs = await services.ledger.costsOfAsRun(rows.map((r) => r.id));
const tz = "America/Los_Angeles";
const time = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", second: "2-digit" }).toLowerCase();
const length = (a: Date, b: Date) => {
  const s = Math.round((b.getTime() - a.getTime()) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `:${String(s).padStart(2, "0")}`;
};
console.log(`As-run, ${rows.length} rows\n`);
console.log("Aired        Code  Runs   Why              What");
for (const r of rows) {
  const what = (r.assetId && titles.items.get(r.assetId)) || (r.programId && titles.programs.get(r.programId)) || (r.code === "SID" ? "Station ID" : r.code === "UND" ? "Thank-you credit" : r.code === "OPEN" ? (r.reason === "slate" ? "Sign-off slate" : "Station ID slate") : r.reason === "live" ? "Live" : "");
  const money = costs.has(r.id) ? `  $${(costs.get(r.id)! / 1e6).toFixed(2)}${r.carriageAgreementId ? " (barter: paid to the producer)" : ""}` : "";
  console.log(`${time(r.startedAt).padEnd(12)} ${r.code.padEnd(5)} ${length(r.startedAt, r.endedAt).padEnd(6)} ${r.reason.padEnd(16)} ${what}${money}${r.proofFrameUrl ? "  [proof frame]" : ""}`);
}
process.exit(0);
