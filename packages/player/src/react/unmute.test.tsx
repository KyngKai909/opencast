// Sound refused until the viewer does something: the first click or key anywhere turns it on, not
// only the "Tap for sound" button (on a TV the overlays sit over it, and a remote can't reach it).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { PlayerEngine } from "../engine/PlayerEngine";
import { fakeDriver, flush, station, stubMedia } from "../test-helpers";
import { PlayerProvider } from "./context";
import { PlayerSurface } from "./PlayerSurface";

const CIVC = station("CIVC", "7.1");
let engine: PlayerEngine;

beforeEach(() => {
  vi.useFakeTimers();
  stubMedia();
  engine = new PlayerEngine({ driver: fakeDriver(), warm: "buffer", bannerMs: 5000, numberWaitMs: 2000, pauseHoldMs: 30 * 60_000 });
  engine.setChannels([CIVC]);
});
afterEach(() => {
  engine.destroy();
  vi.useRealTimers();
});

describe("tap for sound", () => {
  it("turns sound on at the first key or click anywhere", async () => {
    render(
      <PlayerProvider engine={engine}>
        <PlayerSurface />
      </PlayerProvider>
    );
    await act(async () => {
      const t = engine.tune(CIVC.station.id);
      await flush(10);
      await t;
    });
    act(() => (engine as unknown as { patch(p: object): void }).patch({ mutedByBrowser: true }));
    expect(engine.getState().mutedByBrowser).toBe(true);
    act(() => void fireEvent.keyDown(window, { key: "ArrowUp" }));
    expect(engine.getState().mutedByBrowser).toBe(false);
    expect(engine.getState().muted).toBe(false);

    act(() => (engine as unknown as { patch(p: object): void }).patch({ mutedByBrowser: true }));
    act(() => void fireEvent.pointerDown(document.body));
    expect(engine.getState().mutedByBrowser).toBe(false);
  });
});
