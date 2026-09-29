import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../api/client", () => ({ call: vi.fn(async () => ({})) }));
import { call } from "../../api/client";
import { getDevice, setDevice } from "../../tv/device";
import { useTvSettings } from "./useTvSettings";

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
const calls = call as unknown as ReturnType<typeof vi.fn>;

describe("saving TV settings", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calls.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    setDevice({ token: null, signedInAs: null });
  });

  it("signed out: on this TV only, at once", async () => {
    setDevice({ token: null });
    const { result } = renderHook(() => useTvSettings(), { wrapper });
    act(() => result.current.save({ bannerSeconds: 8 }));
    expect(getDevice().settings.bannerSeconds).toBe(8);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(calls).not.toHaveBeenCalled();
  });

  it("signed in: on this TV at once, and one save to the account for several presses", async () => {
    setDevice({ token: "mock-access-token" });
    const { result } = renderHook(() => useTvSettings(), { wrapper });
    act(() => result.current.save({ captions: "off" }));
    act(() => result.current.save({ captions: "muted_only" }));
    act(() => result.current.save({ numberWaitSeconds: 3 }));
    expect(getDevice().settings.captions).toBe("muted_only");
    expect(calls).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(calls).toHaveBeenCalledTimes(1);
    expect(calls.mock.calls[0]![1]).toEqual({ body: { settings: { watching: { captions: "muted_only" }, tv: { numberWaitSeconds: 3 } } } });
  });

  it("leaving settings saves what's waiting", async () => {
    setDevice({ token: "mock-access-token" });
    const { result, unmount } = renderHook(() => useTvSettings(), { wrapper });
    act(() => result.current.save({ eveningOut: false }));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
