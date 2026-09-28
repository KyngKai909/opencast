// No module reaches into another's tables: every `schema.<table>` a module's
// files use must be one it owns (src/v1/ownership.ts). Other modules' data comes
// through their services.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { is, Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schema } from "@opencast/db";
import { MODULE_TABLES } from "../src/v1/ownership.js";

const modulesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "v1", "modules");

const tableOf = new Map<string, string>();
for (const [name, value] of Object.entries(schema)) {
  if (is(value, Table)) {
    const config = getTableConfig(value as PgTable);
    tableOf.set(name, `${config.schema ?? "public"}.${config.name}`);
  }
}

function owns(module: string, table: string) {
  return (MODULE_TABLES[module] ?? []).some((rule) => (rule.endsWith(".*") ? table.startsWith(rule.slice(0, -1)) : rule === table));
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? sourceFiles(path.join(dir, e.name)) : Promise.resolve(e.name.endsWith(".ts") ? [path.join(dir, e.name)] : [])))
  );
  return nested.flat();
}

describe("module boundaries", () => {
  it("every table has an owner", () => {
    const unowned = [...tableOf.values()].filter((table) => !Object.keys(MODULE_TABLES).some((m) => owns(m, table)));
    expect(unowned).toEqual([]);
  });

  it("modules only touch their own tables", async () => {
    const violations: string[] = [];
    for (const module of await fs.readdir(modulesDir)) {
      for (const file of await sourceFiles(path.join(modulesDir, module))) {
        const source = await fs.readFile(file, "utf8");
        for (const match of source.matchAll(/\bschema\.(\w+)/g)) {
          const table = tableOf.get(match[1]);
          if (table && !owns(module, table)) {
            violations.push(`${module}: ${path.relative(modulesDir, file)} uses ${table}`);
          }
        }
      }
    }
    expect([...new Set(violations)]).toEqual([]);
  });
});
