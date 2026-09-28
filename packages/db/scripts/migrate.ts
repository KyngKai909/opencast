// Applies the checked-in SQL migrations. `npm run db:migrate` at the root.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { fileURLToPath } from "node:url";
import path from "node:path";

const url = process.env.DATABASE_URL ?? "postgres://opencast:opencast@localhost:54329/opencast";
const pool = new pg.Pool({ connectionString: url });
const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

await migrate(drizzle(pool), { migrationsFolder, migrationsSchema: "drizzle" });
console.log(`Migrations applied to ${new URL(url).host}${new URL(url).pathname}`);
await pool.end();
