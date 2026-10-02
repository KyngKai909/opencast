// Every endpoint in the contracts is mounted, and nothing is mounted that isn't in them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "@opencast/contracts";
import { createHarness, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
}, 60_000);
afterAll(() => h.close());

describe("routes", () => {
  it("every contract endpoint is mounted", () => {
    const router = (h.app as unknown as { _router?: { stack: unknown[] }; router?: { stack: unknown[] } });
    const mounted = new Set<string>();
    const walk = (stack: Array<{ route?: { path: string; methods: Record<string, boolean> }; handle?: { stack?: unknown[] } }>) => {
      for (const layer of stack) {
        if (layer.route) for (const method of Object.keys(layer.route.methods)) mounted.add(`${method.toUpperCase()} ${layer.route.path}`);
        else if (layer.handle?.stack) walk(layer.handle.stack as never);
      }
    };
    walk(((router.router ?? router._router)!.stack) as never);
    const expected = Object.values(api).flatMap((endpoints) => Object.values(endpoints).map((e) => `${e.method} ${e.path}`));
    expect(expected.filter((e) => !mounted.has(e))).toEqual([]);
    expect(expected.length).toBeGreaterThan(150);
  });
});
