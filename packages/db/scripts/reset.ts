// Drops the new schemas (never the old opencast_state table) and re-applies migrations. Local only.
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgres://opencast:opencast@localhost:54329/opencast";
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1"].includes(host)) {
  console.error(`Refusing to reset a database on ${host}.`);
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(
  `DROP SCHEMA IF EXISTS accounts, broadcast, catalog, spots, ledger, trust, network, audience, notify, tv, drizzle CASCADE`
);
await client.end();
console.log("Dropped the new schemas. Run db:migrate next.");
