// The relay background's line (radio stations, contracts of 2026-09-29): what relays show.
import { describe, expect, it } from "vitest";
import type { RelayBackground } from "@opencast/contracts";
import { backgroundLine, RELAY_BACKGROUND_ACCEPT } from "./RelayBackground";

const bg = (over: Partial<RelayBackground>): RelayBackground => ({
  kind: "image",
  fileName: "wave.png",
  status: "ready",
  error: null,
  loopUrl: "https://media.test/relay-backgrounds/x/loop.mp4",
  stillUrl: "https://media.test/relay-backgrounds/x/still.jpg",
  width: 1280,
  height: 720,
  durationMs: 2_000,
  updatedAt: "2026-09-29T20:00:00.000Z",
  ...over
});

describe("the relay background's line", () => {
  it("says what relays show", () => {
    expect(backgroundLine(null, "WAVE")).toBe("None yet. Relays show WAVE's colour with its call sign and channel.");
    expect(backgroundLine(bg({}), "WAVE")).toBe("wave.png, held still.");
    expect(backgroundLine(bg({ kind: "gif", fileName: "spin.gif", durationMs: 2_400 }), "WAVE")).toBe("spin.gif, looping every 2.4 seconds.");
    expect(backgroundLine(bg({ kind: "video", fileName: "waves.mp4", durationMs: 12_000 }), "WAVE")).toBe("waves.mp4, looping every 12 seconds.");
    expect(backgroundLine(bg({ status: "preparing", fileName: "waves.mp4" }), "WAVE")).toBe("waves.mp4 is being prepared. Relays keep showing what they show now until it's ready.");
    expect(backgroundLine(bg({ status: "failed", error: "That file couldn't be made into a loop. Try another." }), "WAVE")).toBe("That file couldn't be made into a loop. Try another.");
  });

  it("takes the files the API takes", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/quicktime", "video/webm"]) expect(RELAY_BACKGROUND_ACCEPT.split(",")).toContain(type);
  });
});
