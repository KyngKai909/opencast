import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import type { Command, Status } from "@opencast/player";
import { AndroidTv, type AppStateSource } from "./AndroidTv";
import { keepAwake, onAppState, sleepEnded } from "./lifecycle";

// The player's state, driven by the test.
let status: Status = "idle";
let snapshot: { status: Status } = { status };
const listeners = new Set<() => void>();
const handled: Command[] = [];
const engine = { getState: () => ({ status }), handle: (c: Command) => void handled.push(c) };
vi.mock("@opencast/player", async (orig) => {
  const { useSyncExternalStore } = await import("react");
  return {
    ...(await orig<object>()),
    usePlayer: () => [useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => (snapshot.status === status ? snapshot : (snapshot = { status }))), engine]
  };
});
function setStatus(s: Status) {
  act(() => {
    status = s;
    listeners.forEach((l) => l());
  });
}

describe("the Android TV app around the picture", () => {
  it("keeps the screen on while a station plays or tunes", () => {
    expect((["playing", "tuning", "embed"] as Status[]).map(keepAwake)).toEqual([true, true, true]);
    expect((["idle", "paused", "off_air", "error", "stopped"] as Status[]).map(keepAwake)).toEqual([false, false, false, false, false]);
  });

  it("knows the sleep timer's end", () => {
    expect(sleepEnded("playing", "stopped")).toBe(true);
    expect(sleepEnded("stopped", "stopped")).toBe(false);
    expect(sleepEnded("playing", "paused")).toBe(false);
  });

  it("pauses when it leaves, and goes back to live only if leaving paused it", () => {
    expect(onAppState(false, "playing", false)).toBe("pause");
    expect(onAppState(false, "paused", false)).toBeNull();
    expect(onAppState(true, "paused", true)).toBe("backToLive");
    expect(onAppState(true, "paused", false)).toBeNull();
  });

  it("keeps the screen on while playing, clears it and goes home when the sleep timer ends", async () => {
    status = "tuning";
    const tv = { setKeepScreenOn: vi.fn(async () => undefined), exitToHome: vi.fn(async () => undefined) };
    render(<AndroidTv tv={tv} appStates={() => () => undefined} />);
    expect(tv.setKeepScreenOn).toHaveBeenLastCalledWith({ on: true });
    setStatus("playing");
    expect(tv.setKeepScreenOn).toHaveBeenCalledTimes(1);
    expect(tv.exitToHome).not.toHaveBeenCalled();
    setStatus("stopped");
    expect(tv.setKeepScreenOn).toHaveBeenLastCalledWith({ on: false });
    expect(tv.exitToHome).toHaveBeenCalledOnce();
  });

  it("pauses in the background and returns to live in front", () => {
    status = "playing";
    handled.length = 0;
    let tell: (active: boolean) => void = () => undefined;
    const appStates: AppStateSource = (fn) => ((tell = fn), () => undefined);
    const tv = { setKeepScreenOn: vi.fn(async () => undefined), exitToHome: vi.fn(async () => undefined) };
    render(<AndroidTv tv={tv} appStates={appStates} />);
    act(() => tell(false));
    setStatus("paused");
    act(() => tell(true));
    expect(handled).toEqual([{ type: "pause" }, { type: "backToLive" }]);
  });
});
