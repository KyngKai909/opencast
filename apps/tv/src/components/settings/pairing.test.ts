import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { RemotePairCode, RemotePhone } from "@opencast/contracts";
import { codeLasts, pairedSince, PAIR_RETRY_MS, phoneLine, phoneOrder, spacedCode, usePairCode, viewerAddress } from "./pairing";

const T0 = Date.parse("2026-09-27T03:42:00Z");
const phone = (id: string, o: Partial<RemotePhone> = {}): RemotePhone => ({ id, name: `${id}'s phone`, kind: "guest", connected: false, pairedAt: "2026-09-27T03:00:00.000Z", lastCommandAt: null, ...o });

describe("pairing a phone, the words", () => {
  it("names the address to go to on the phone, from the viewer's", () => {
    expect(viewerAddress("https://app.useopencast.org")).toBe("app.useopencast.org/tv");
    expect(viewerAddress("http://localhost:5174/")).toBe("localhost:5174/tv");
    expect(viewerAddress("not a url")).toBe("useopencast.org/tv");
  });

  it("spaces the code out so it reads from the sofa", () => {
    expect(spacedCode("4821")).toBe("4 8 2 1");
  });

  it("says how long the code lasts", () => {
    const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
    expect(codeLasts(at(5), T0)).toBe("Changes in 5 minutes");
    expect(codeLasts(at(1.5), T0)).toBe("Changes in 1 minute");
    expect(codeLasts(at(0.5), T0)).toBe("Changes in under a minute");
    expect(codeLasts(at(-1), T0)).toBe("Changes in under a minute");
  });

  it("says how each phone can drive this TV, and whether it's connected", () => {
    expect(phoneLine({ kind: "account", connected: true })).toBe("Signed in to your account, connected now");
    expect(phoneLine({ kind: "guest", connected: false })).toBe("Paired with a code");
  });

  it("lists connected phones first, then the rest, in the order they paired", () => {
    const list = [phone("a", { pairedAt: "2026-09-27T01:00:00.000Z" }), phone("b", { connected: true, pairedAt: "2026-09-27T02:00:00.000Z" }), phone("c", { pairedAt: "2026-09-26T01:00:00.000Z" })];
    expect(phoneOrder(list).map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  it("notices a guest's phone that paired since the code went up", () => {
    const since = "2026-09-27T03:42:00.000Z";
    expect(pairedSince([phone("old")], since)).toBeNull();
    expect(pairedSince([phone("acct", { kind: "account", pairedAt: "2026-09-27T03:43:00.000Z" })], since)).toBeNull();
    expect(pairedSince([phone("new", { pairedAt: "2026-09-27T03:43:00.000Z" })], since)?.id).toBe("new");
    expect(pairedSince(null, since)).toBeNull();
  });
});

describe("usePairCode", () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }));
  afterEach(() => vi.useRealTimers());
  const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
  const code = (c: string, fromMs: number): RemotePairCode => ({ code: c, expiresAt: new Date(fromMs + 5 * 60_000).toISOString() });

  it("shows nothing until asked, then a code, replaced the moment it runs out", async () => {
    const create = vi.fn().mockImplementationOnce(async () => code("4821", T0)).mockImplementationOnce(async () => code("7304", T0 + 5 * 60_000));
    const { result, rerender } = renderHook(({ on }) => usePairCode({ create, now: () => Date.now() }, on), { initialProps: { on: false } });
    expect(result.current.kind).toBe("off");
    rerender({ on: true });
    expect(result.current.kind).toBe("loading");
    await tick(0);
    expect(result.current).toMatchObject({ kind: "showing", code: { code: "4821" }, since: new Date(T0).toISOString() });
    await tick(5 * 60_000 - 1);
    expect(create).toHaveBeenCalledOnce();
    await tick(1);
    expect(result.current).toMatchObject({ kind: "showing", code: { code: "7304" } });
    rerender({ on: false });
    expect(result.current.kind).toBe("off");
    await tick(10 * 60_000);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("shows the API's message when it can't get a code, and tries again", async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error("Something went wrong. Try again.")).mockResolvedValueOnce(code("4821", T0));
    const { result } = renderHook(() => usePairCode({ create, now: () => Date.now() }, true));
    await tick(0);
    expect(result.current).toEqual({ kind: "error", message: "Something went wrong. Try again." });
    await tick(PAIR_RETRY_MS);
    expect(result.current.kind).toBe("showing");
  });
});
