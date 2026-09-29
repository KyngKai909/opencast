import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { TvCode, TvCodeStatus } from "../../api/ext/signIn";
import { afterPoll, enterAt, formatCode, pollDelayMs, RETRY_MS, useTvCode } from "./codeFlow";

const T0 = Date.parse("2026-09-27T03:42:00Z");
const code = (c = "K7Q4MP", ttlS = 600): TvCode => ({ code: c, qrUrl: `http://localhost:5174/tv?code=${c}`, expiresAt: new Date(T0 + ttlS * 1000).toISOString(), pollToken: `poll-${c}`, pollSeconds: 2 });

describe("the code on screen", () => {
  it("reads in two groups of three", () => {
    expect(formatCode("K7Q4MP")).toBe("K7Q 4MP");
    expect(formatCode("k7q 4mp")).toBe("K7Q 4MP");
  });
  it("names where to type it: the server's words, or where the QR goes", () => {
    expect(enterAt({ ...code(), enterAt: "useopencast.org/tv" })).toBe("useopencast.org/tv");
    expect(enterAt({ ...code(), qrUrl: "https://useopencast.org/tv?code=K7Q4MP" })).toBe("useopencast.org/tv");
  });
  it("asks as often as the server says, 2 seconds otherwise, never under one", () => {
    expect(pollDelayMs(code())).toBe(2000);
    expect(pollDelayMs({ ...code(), pollSeconds: undefined })).toBe(2000);
    expect(pollDelayMs({ ...code(), pollSeconds: 0.2 })).toBe(1000);
  });
});

describe("after each poll", () => {
  it("keeps asking while pending, and after a failed poll", () => {
    expect(afterPoll({ status: "pending" }, code(), T0)).toEqual({ next: "poll" });
    expect(afterPoll(null, code(), T0)).toEqual({ next: "poll" });
  });
  it("signs in when approved, with the TV's own session", () => {
    expect(afterPoll({ status: "approved", token: "tv-session", signedInAs: "Kai M." }, code(), T0)).toEqual({ next: "approved", token: "tv-session", signedInAs: "Kai M." });
  });
  it("gets a new code when it's run out, even before the server says so", () => {
    expect(afterPoll({ status: "expired" }, code(), T0)).toEqual({ next: "renew" });
    expect(afterPoll({ status: "pending" }, code("K7Q4MP", 10), T0 + 10_000)).toEqual({ next: "renew" });
  });
});

describe("useTvCode", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function tick(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("creates a code, polls, and signs in when a phone approves it", async () => {
    const statuses: TvCodeStatus[] = [{ status: "pending" }, { status: "approved", token: "tv-session", signedInAs: "Kai M." }];
    const onApproved = vi.fn();
    const create = vi.fn(async () => code());
    const poll = vi.fn(async () => statuses.shift()!);
    const { result } = renderHook(() => useTvCode({ create, poll, now: () => T0, onApproved }));
    expect(result.current.kind).toBe("loading");
    await tick(0);
    expect(result.current).toMatchObject({ kind: "waiting", renewed: false, code: { code: "K7Q4MP" } });
    await tick(2000);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(onApproved).not.toHaveBeenCalled();
    await tick(2000);
    expect(onApproved).toHaveBeenCalledWith("tv-session", "Kai M.");
    expect(result.current.kind).toBe("approved");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("replaces a code that ran out, and says it's a new one", async () => {
    const create = vi.fn().mockResolvedValueOnce(code("K7Q4MP")).mockResolvedValueOnce(code("R2D9XW"));
    const { result } = renderHook(() => useTvCode({ create, poll: async () => ({ status: "expired" }), now: () => T0, onApproved: vi.fn() }));
    await tick(0);
    await tick(2000);
    expect(result.current).toMatchObject({ kind: "waiting", renewed: true, code: { code: "R2D9XW" } });
  });

  it("shows the API's message when it can't get a code, and tries again", async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error("Something went wrong. Try again.")).mockResolvedValueOnce(code());
    const { result } = renderHook(() => useTvCode({ create, poll: async () => ({ status: "pending" }), now: () => T0, onApproved: vi.fn() }));
    await tick(0);
    expect(result.current).toEqual({ kind: "error", message: "Something went wrong. Try again." });
    await tick(RETRY_MS);
    expect(result.current.kind).toBe("waiting");
  });

  it("stops asking once the screen closes", async () => {
    const poll = vi.fn(async () => ({ status: "pending" }) as TvCodeStatus);
    const { unmount } = renderHook(() => useTvCode({ create: async () => code(), poll, now: () => T0, onApproved: vi.fn() }));
    await tick(0);
    unmount();
    await tick(10_000);
    expect(poll).not.toHaveBeenCalled();
  });
});
