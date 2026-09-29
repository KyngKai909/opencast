import { describe, expect, it } from "vitest";
import { SEGMENT_MS, endEarlyAt, nextSegment, onSegment, snapLength, snapSpan, snapTime, snapToSegment } from "./segments";

const T = (iso: string) => Date.parse(iso);

describe("segment boundaries", () => {
  it("are 4 seconds, counted from the epoch, so every whole minute is one", () => {
    expect(SEGMENT_MS).toBe(4000);
    expect(onSegment("2026-09-27T03:42:00.000Z")).toBe(true);
    expect(onSegment("2026-09-27T03:42:04.000Z")).toBe(true);
    expect(onSegment("2026-09-27T03:42:30.000Z")).toBe(false);
  });

  it("snap to the nearest boundary, as the API rounds (a tie goes later)", () => {
    expect(snapTime("2026-09-27T03:28:29.000Z")).toBe("2026-09-27T03:28:28.000Z");
    expect(snapTime("2026-09-27T03:28:30.000Z")).toBe("2026-09-27T03:28:32.000Z");
    expect(snapTime("2026-09-27T03:28:31.999Z")).toBe("2026-09-27T03:28:32.000Z");
    expect(snapTime("2026-09-27T03:28:00.000Z")).toBe("2026-09-27T03:28:00.000Z");
    expect(snapToSegment(T("2026-09-27T03:28:01.999Z"))).toBe(T("2026-09-27T03:28:00.000Z"));
  });

  it("the next boundary is at or after the time (a cued break)", () => {
    expect(nextSegment(T("2026-09-27T03:28:00.001Z"))).toBe(T("2026-09-27T03:28:04.000Z"));
    expect(nextSegment(T("2026-09-27T03:28:04.000Z"))).toBe(T("2026-09-27T03:28:04.000Z"));
  });

  it("snaps a span's start and end, never to nothing", () => {
    expect(snapSpan({ startsAt: "2026-09-27T03:00:01.000Z", endsAt: "2026-09-27T03:28:30.000Z", title: "Late Crate" })).toEqual({
      startsAt: "2026-09-27T03:00:00.000Z",
      endsAt: "2026-09-27T03:28:32.000Z",
      title: "Late Crate"
    });
    expect(snapSpan({ startsAt: "2026-09-27T03:00:00.000Z", endsAt: "2026-09-27T03:00:01.000Z" }).endsAt).toBe("2026-09-27T03:00:04.000Z");
  });

  it("rounds lengths to whole segments, at least one", () => {
    expect(snapLength(28 * 60_000 + 30_000)).toBe(28 * 60_000 + 32_000);
    expect(snapLength(1000)).toBe(4000);
  });

  it("a live block ended early ends at the nearest boundary after its start", () => {
    const start = T("2026-09-27T04:01:00.000Z");
    expect(endEarlyAt(T("2026-09-27T04:30:05.000Z"), start)).toBe(T("2026-09-27T04:30:04.000Z"));
    // A second in: the nearest boundary is the start itself, so the next one.
    expect(endEarlyAt(T("2026-09-27T04:01:01.000Z"), start)).toBe(T("2026-09-27T04:01:04.000Z"));
  });
});
