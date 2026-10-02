import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_CONNECT_AFTER_MS, mockMirroring } from "./mockMirroring";
import { batteryLine } from "./mirroring";
import type { RemoteCommand } from "./types";

describe("dev:mock's mirroring seam", () => {
  afterEach(() => vi.useRealTimers());

  it("knows Bedroom TV, and connects a little after the guide shows", () => {
    vi.useFakeTimers();
    const m = mockMirroring();
    const changes = vi.fn();
    m.subscribe(changes);
    expect(m.knownTvs()).toEqual(["Bedroom TV"]);
    m.expect("Bedroom TV");
    vi.advanceTimersByTime(MOCK_CONNECT_AFTER_MS - 1);
    expect(m.status().connected).toBe(false);
    vi.advanceTimersByTime(1);
    expect(m.status()).toMatchObject({ connected: true, tvName: "Bedroom TV", lockedAt: null });
    expect(changes).toHaveBeenCalledTimes(1);
    expect(batteryLine(m.battery())).toBe("Battery: 64%, about 3 hours at this rate.");
  });

  it("passes commands to the stand-in only while connected, and a lock stops the picture with the time", () => {
    const m = mockMirroring();
    const got: RemoteCommand[] = [];
    m.onCommand!((c) => got.push(c));
    m.send({ type: "channel", dir: "up" });
    expect(got).toEqual([]);
    window.__ocMirror!.connect("Bedroom TV");
    m.send({ type: "channel", dir: "up" });
    expect(got).toEqual([{ type: "channel", dir: "up" }]);
    window.__ocMirror!.lock();
    expect(m.status().connected).toBe(false);
    expect(m.status().lockedAt).toEqual(expect.any(Number));
    m.send({ type: "last" });
    expect(got).toHaveLength(1);
    m.stop();
    expect(m.status()).toMatchObject({ connected: false, lockedAt: null });
  });
});
