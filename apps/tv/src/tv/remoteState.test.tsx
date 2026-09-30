import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import type { RemoteState } from "@opencast/contracts";
import { changedByOf, noteSource, RelayStateToPhones, remoteStateOf, statePoster } from "./remoteState";
import type { RelayInput } from "./relay";
import { MirrorStateToPhone } from "./mirrorState";

// The player's state, driven by the test.
type S = { currentId: string | null; status: string; sleep: { endsAt: number; fading: boolean } | null; behindLive?: boolean };
let playerState: S;
const listeners = new Set<() => void>();
vi.mock("@opencast/player", async (orig) => {
  const { useSyncExternalStore } = await import("react");
  return {
    ...(await orig<object>()),
    usePlayer: () => [
      useSyncExternalStore(
        (l) => (listeners.add(l), () => listeners.delete(l)),
        () => playerState
      ),
      {}
    ]
  };
});
function setPlayer(p: Partial<S>) {
  act(() => {
    playerState = { ...playerState, ...p };
    listeners.forEach((l) => l());
  });
}

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

describe("what the TV tells phones", () => {
  it("is what's on, paused, who changed it and when sleep ends", () => {
    expect(remoteStateOf({ currentId: "civc", status: "paused", sleep: { endsAt: 1_700_000_000_000.4, fading: false } }, "Kai's phone")).toEqual({ stationId: "civc", paused: true, changedBy: "Kai's phone", sleepEndsAt: 1_700_000_000_000 });
    expect(remoteStateOf({ currentId: null, status: "idle", sleep: null }, null)).toEqual({ stationId: null, paused: false, changedBy: null, sleepEndsAt: null });
  });

  it("names a phone only when the last command came through the relay", () => {
    expect(changedByOf({ input: "relay", who: "Kai's phone" })).toBe("Kai's phone");
    expect(changedByOf({ input: "remote" })).toBeNull();
    expect(changedByOf(undefined)).toBeNull();
  });

  it("posts only changes, only once registered, and sends a failed one again", async () => {
    const post = vi.fn<(s: RemoteState) => Promise<unknown>>().mockResolvedValue({ ok: true });
    let ready = false;
    const p = statePoster({ post, end: vi.fn().mockResolvedValue({ ok: true }) }, () => ready);
    const a: RemoteState = { stationId: "civc", paused: false, changedBy: null, sleepEndsAt: null };
    p.post(a);
    expect(post).not.toHaveBeenCalled();
    ready = true;
    p.post(a);
    p.post({ ...a });
    expect(post).toHaveBeenCalledTimes(1);
    post.mockRejectedValueOnce(new Error("offline"));
    p.post({ ...a, paused: true });
    await new Promise((r) => setTimeout(r, 0));
    p.post({ ...a, paused: true });
    expect(post).toHaveBeenCalledTimes(3);
  });
});

describe("RelayStateToPhones", () => {
  const relay = { reset: vi.fn() } as unknown as RelayInput;
  beforeEach(() => {
    playerState = { currentId: "civc", status: "playing", sleep: null };
    vi.mocked(relay.reset).mockClear();
  });

  it("posts whenever what's on, paused or the sleep timer changes, and ends the session when sleep stops Opencast", async () => {
    const post = vi.fn<(s: RemoteState) => void>();
    const end = vi.fn();
    render(<RelayStateToPhones relay={relay} poster={{ post, end }} />);
    expect(post).toHaveBeenLastCalledWith({ stationId: "civc", paused: false, changedBy: null, sleepEndsAt: null });
    noteSource({ input: "relay", who: "Kai's phone" });
    setPlayer({ currentId: "beat" });
    expect(post).toHaveBeenLastCalledWith({ stationId: "beat", paused: false, changedBy: "Kai's phone", sleepEndsAt: null });
    setPlayer({ status: "paused" });
    expect(post.mock.lastCall![0].paused).toBe(true);
    setPlayer({ status: "playing", sleep: { endsAt: 2_000_000, fading: false } });
    expect(post.mock.lastCall![0].sleepEndsAt).toBe(2_000_000);
    const posts = post.mock.calls.length;
    setPlayer({ status: "stopped", sleep: null });
    await flush();
    expect(end).toHaveBeenCalledOnce();
    expect(relay.reset).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledTimes(posts);
    noteSource(undefined);
  });
});

describe("what the mirror tells the iPhone", () => {
  it("adds behind live, so the phone's remote can offer Back to live after a resume", () => {
    playerState = { currentId: "civc", status: "playing", sleep: null, behindLive: false };
    const postMessage = vi.fn();
    render(<MirrorStateToPhone target={{ postMessage, location: { origin: "capacitor://localhost" } as Location }} />);
    expect(postMessage).toHaveBeenLastCalledWith({ opencast: "state", state: { stationId: "civc", paused: false, changedBy: null, sleepEndsAt: null, behindLive: false } }, "capacitor://localhost");
    setPlayer({ behindLive: true });
    expect(postMessage).toHaveBeenLastCalledWith({ opencast: "state", state: expect.objectContaining({ paused: false, behindLive: true }) }, "capacitor://localhost");
  });
});
