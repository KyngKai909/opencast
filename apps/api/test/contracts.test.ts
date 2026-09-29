import { describe, expect, it } from "vitest";
import { api, endEarlyAt, nextSegment, onSegment, SEGMENT_MS, snapLength, snapSpan, snapTime, snapToSegment } from "@opencast/contracts";
import * as lib from "../src/v1/lib/segments.js";

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

// G12: the 4-second rule is the contracts', and the API's lib/segments re-exports it.
describe("the segment rule", () => {
  const T = (iso: string) => Date.parse(iso);

  it("is the one the API rounds with", () => {
    expect(lib.SEGMENT_MS).toBe(SEGMENT_MS);
    expect([lib.snapToSegment, lib.nextSegment, lib.endEarlyAt]).toEqual([snapToSegment, nextSegment, endEarlyAt]);
    expect(lib.snapDate(new Date("2026-10-02T05:00:01.500Z")).toISOString()).toBe("2026-10-02T05:00:00.000Z");
  });

  it("rounds to the nearest boundary, a cued break to the next, and an early end after the start", () => {
    expect(SEGMENT_MS).toBe(4000);
    expect(snapTime("2026-10-02T05:01:03.000Z")).toBe("2026-10-02T05:01:04.000Z");
    expect(snapTime("2026-10-02T05:10:02.100Z")).toBe("2026-10-02T05:10:04.000Z");
    expect(nextSegment(T("2026-10-02T05:00:00.001Z"))).toBe(T("2026-10-02T05:00:04.000Z"));
    expect(onSegment("2026-10-02T05:00:00.000Z")).toBe(true);
    expect(snapLength(1_000)).toBe(SEGMENT_MS);
    expect(snapSpan({ startsAt: "2026-10-02T05:00:00.000Z", endsAt: "2026-10-02T05:00:01.000Z" }).endsAt).toBe("2026-10-02T05:00:04.000Z");
    expect(endEarlyAt(T("2026-10-02T05:00:01.000Z"), new Date("2026-10-02T05:00:00.000Z"))).toBe(T("2026-10-02T05:00:04.000Z"));
    expect(endEarlyAt(T("2026-10-02T05:30:05.000Z"), "2026-10-02T05:00:00.000Z")).toBe(T("2026-10-02T05:30:04.000Z"));
  });
});
