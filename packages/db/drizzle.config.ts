import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  schemaFilter: ["accounts", "broadcast", "catalog", "spots", "ledger", "trust", "network", "audience", "notify", "tv"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://opencast:opencast@localhost:54329/opencast" }
});
