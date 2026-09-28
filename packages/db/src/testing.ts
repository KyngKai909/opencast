// A throwaway database with every migration applied, for tests in any package.
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema/index.js";

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function freshDatabase(adminUrl = process.env.DATABASE_URL ?? "postgres://opencast:opencast@localhost:54329/opencast") {
  const name = `opencast_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
  // Dropping the database ends idle connections from the server side; that's expected here.
  pool.on("error", () => undefined);
  await migrate(drizzle(pool), { migrationsFolder, migrationsSchema: "drizzle" });
  return {
    url: url.toString(),
    pool,
    db: drizzle(pool, { schema }),
    async drop() {
      await pool.end();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  };
}
