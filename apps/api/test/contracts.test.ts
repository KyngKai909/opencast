import { describe, expect, it } from "vitest";
import { api } from "@opencast/contracts";

const all = Object.entries(api).flatMap(([module, endpoints]) =>
  Object.entries(endpoints).map(([name, e]) => ({ id: `${module}.${name}`, ...e }))
);

describe("contracts", () => {
  it("no two endpoints share a method and path", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const e of all) {
      const key = `${e.method} ${e.path}`;
      if (seen.has(key)) clashes.push(`${key}: ${seen.get(key)} and ${e.id}`);
      seen.set(key, e.id);
    }
    expect(clashes).toEqual([]);
  });

  it("path parameters match the params schema", () => {
    const mismatched = all.filter((e) => {
      const inPath = [...e.path.matchAll(/:(\w+)/g)].map((m) => m[1]).sort();
      const inSchema = Object.keys(e.params?.shape ?? {}).sort();
      return JSON.stringify(inPath) !== JSON.stringify(inSchema);
    });
    expect(mismatched.map((e) => e.id)).toEqual([]);
  });
});
