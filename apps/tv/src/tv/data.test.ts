import { describe, expect, it } from "vitest";
import { nextRefresh } from "./data";

describe("reading the dial again", () => {
  const at = Date.parse("2026-09-27T03:42:00Z");
  const ends = (iso: string) => ({ now: { endsAt: iso } });
  it("comes a second after the first program on the dial ends", () => {
    expect(nextRefresh([ends("2026-09-27T03:42:30Z"), ends("2026-09-27T04:00:00Z")], at)).toBe(31_000);
  });
  it("is at least every minute, and never sooner than a second", () => {
    expect(nextRefresh([ends("2026-09-27T05:00:00Z")], at)).toBe(60_000);
    expect(nextRefresh([], at)).toBe(60_000);
    expect(nextRefresh([ends("2026-09-27T03:42:00Z")], at)).toBe(60_000);
  });
});
