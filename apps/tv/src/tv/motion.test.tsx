import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

let reducedMotion = true;
vi.mock("../api/client", () => ({ call: vi.fn(async () => ({ settings: { appearance: { reducedMotion } } })) }));
import { setDevice } from "./device";
import { useAccountMotion } from "./motion";

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

describe("the account's Reduce motion on the TV", () => {
  afterEach(() => {
    setDevice({ token: null });
    delete document.documentElement.dataset.motion;
  });

  it("signed in with Reduce motion on: the channel change crossfades", async () => {
    reducedMotion = true;
    setDevice({ token: "mock-access-token" });
    renderHook(() => useAccountMotion(), { wrapper });
    await waitFor(() => expect(document.documentElement.dataset.motion).toBe("reduce"));
  });

  it("off, or signed out: left to the TV's own setting", async () => {
    reducedMotion = false;
    setDevice({ token: "mock-access-token" });
    renderHook(() => useAccountMotion(), { wrapper });
    await new Promise((r) => setTimeout(r, 50));
    expect(document.documentElement.dataset.motion).toBeUndefined();
    setDevice({ token: null });
    renderHook(() => useAccountMotion(), { wrapper });
    expect(document.documentElement.dataset.motion).toBeUndefined();
  });
});
