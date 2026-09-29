import { describe, expect, it, vi } from "vitest";
import { getDevice, useMemoryOnly } from "./device";
import { ensureRegistered } from "./registration";

describe("the Cast receiver and the iPhone's second screen", () => {
  it("never register (they keep nothing)", async () => {
    useMemoryOnly();
    const register = vi.fn();
    expect(await ensureRegistered(register)).toBe(false);
    expect(register).not.toHaveBeenCalled();
    expect(getDevice().deviceToken).toBeNull();
  });
});
