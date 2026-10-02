import { describe, expect, it, vi } from "vitest";
import { mergeSettings, saveSettings, settingsTarget } from "./useSettings";

describe("which settings save where", () => {
  it("to the account when signed in, to this device when signed out", () => {
    expect(settingsTarget(true)).toBe("account");
    expect(settingsTarget(false)).toBe("device");
  });

  it("signed in: sends only the patch to the account, and the device isn't touched", async () => {
    const account = vi.fn(async () => ({ watching: { captions: "on" as const } }));
    const device = vi.fn();
    await saveSettings(true, { watching: { captions: "off" } }, { watching: { captions: "on" } }, { account, device });
    expect(account).toHaveBeenCalledWith({ watching: { captions: "on" } });
    expect(device).not.toHaveBeenCalled();
  });

  it("signed out: merges into this device's settings and doesn't call the account", async () => {
    const account = vi.fn();
    const device = vi.fn();
    const saved = await saveSettings(false, { watching: { captions: "off", captionSize: "large" }, market: { showNearby: true } }, { watching: { captions: "muted_only" } }, { account, device });
    expect(account).not.toHaveBeenCalled();
    expect(device).toHaveBeenCalledWith(saved);
    expect(saved).toEqual({ watching: { captions: "muted_only", captionSize: "large" }, market: { showNearby: true } });
  });

  it("merges one section deep and keeps keys the contract doesn't type (quiet hours)", () => {
    expect(mergeSettings({ appearance: { ground: "dark", reducedMotion: true } }, { appearance: { ground: "light" }, notifications: { quietHours: false } })).toEqual({
      appearance: { ground: "light", reducedMotion: true },
      notifications: { quietHours: false }
    });
  });
});
