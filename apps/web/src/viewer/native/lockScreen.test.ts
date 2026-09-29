import { describe, expect, it, vi } from "vitest";
import type { PluginListenerHandle } from "@capacitor/core";
import type { DialRow } from "@opencast/contracts";
import type { Command } from "@opencast/player";
import { lockScreenCommand, nativeLockScreenInput, nowPlayingInfo } from "./lockScreen";
import type { LockScreenAction } from "./plugins";

describe("lock-screen controls", () => {
  it("are channel up and down (next and previous track), pause and play", () => {
    expect(lockScreenCommand("next")).toEqual({ type: "channel", dir: "up" });
    expect(lockScreenCommand("previous")).toEqual({ type: "channel", dir: "down" });
    expect(lockScreenCommand("pause")).toEqual({ type: "pause" });
    expect(lockScreenCommand("play")).toEqual({ type: "play" });
    // A headset's single button.
    expect(lockScreenCommand("toggle")).toEqual({ type: "togglePlay" });
    expect(lockScreenCommand("seek" as LockScreenAction)).toBeNull();
  });

  it("reach the player as commands from the plugin's presses, until the input stops", async () => {
    let press: ((d: { action: LockScreenAction }) => void) | null = null;
    const removed = vi.fn();
    const plugin = {
      addListener: vi.fn(async (_e: "action", cb: (d: { action: LockScreenAction }) => void): Promise<PluginListenerHandle> => {
        press = cb;
        return { remove: async () => removed() };
      })
    };
    const got: Array<[Command, string]> = [];
    const stop = nativeLockScreenInput(async () => plugin).start((c, src) => got.push([c, src.input]));
    await vi.waitFor(() => expect(press).not.toBeNull());
    press!({ action: "next" });
    press!({ action: "pause" });
    expect(got).toEqual([
      [{ type: "channel", dir: "up" }, "media-session"],
      [{ type: "pause" }, "media-session"]
    ]);
    stop();
    await vi.waitFor(() => expect(removed).toHaveBeenCalled());
    press!({ action: "previous" });
    expect(got).toHaveLength(2);
  });

  it("show the station and what's on", () => {
    const row = {
      station: { id: "beat", kind: "channel", callSign: "BEAT", handle: "beat", name: "Inland Beat", colour: null, band: "tv", channel: "12.1", marketSlug: "inland-empire", homeCity: null },
      onAir: true,
      now: { logEntryId: "l1", title: "Saturday Reel", episodeTitle: null, code: "PGM", kind: "program", startsAt: "2026-09-27T03:30:00Z", endsAt: "2026-09-27T04:00:00Z", live: false, carriedFrom: null, programId: null },
      next: null,
      playback: null
    } as unknown as DialRow;
    expect(nowPlayingInfo(row, true)).toEqual({ title: "BEAT 12.1", subtitle: "Saturday Reel", playing: true });
    expect(nowPlayingInfo({ ...row, onAir: false, now: null } as DialRow, false)).toEqual({ title: "BEAT 12.1", subtitle: "Off air", playing: false });
    expect(nowPlayingInfo(null, false)).toBeNull();
  });
});
