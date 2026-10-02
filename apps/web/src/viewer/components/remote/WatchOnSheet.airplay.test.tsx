// "Watch on" in Safari: an AirPlay row while an AirPlay TV is around, opening Safari's own list
// straight from the tap; while AirPlaying, Stop AirPlay. The Chromecast and TV app rows are as they were.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ToastProvider } from "@opencast/ui";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, controlUrl: "http://control.test", tvUrl: "http://tv.test", mockClock: "2026-09-27T03:42:00Z" }
}));

const engine = { showAirPlayPicker: vi.fn(() => true), stopAirPlay: vi.fn() };
const player = { channels: [], currentId: null, pendingId: null, airPlay: { available: false, active: false } };
vi.mock("@opencast/player", async (orig) => ({ ...(await orig<object>()), usePlayer: () => [player, engine] }));
vi.mock("../../cast/mirroring", () => ({ getMirroring: async () => null }));
vi.mock("../../cast/session", () => ({ clearCastError: vi.fn(), startCast: vi.fn(), stopCasting: vi.fn(), useCastSession: () => ({ status: "idle", error: null }) }));
const LIVING = { id: "l", name: "Living room TV", kind: "chromecast" };
vi.mock("../../cast/useCast", () => ({
  mirrorGuideHidden: () => false,
  useCastIntro: () => ({ from: "Kai's phone", marketSlug: "inland-empire", othersCanChange: true }),
  useWatchOnTargets: () => ({ targets: [LIVING], loading: false, refresh: async () => [LIVING] })
}));
vi.mock("../watch/overlay", () => ({ useOverlayParams: () => ({ params: new URLSearchParams("sheet=watch-on"), open: vi.fn(), close: vi.fn() }) }));
vi.mock("./PairTv", () => ({ PairTvSheet: () => null }));

const { WatchOnSheet } = await import("./WatchOnSheet");

function show() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <WatchOnSheet />
      </ToastProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  engine.showAirPlayPicker.mockClear();
  engine.stopAirPlay.mockClear();
  player.airPlay = { available: false, active: false };
});

describe("AirPlay in Watch on", () => {
  it("isn't offered unless Safari says an AirPlay TV is around", () => {
    show();
    expect(screen.getByRole("radio", { name: /Living room TV/ })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /^AirPlay/ })).toBeNull();
  });

  it("offers AirPlay beside the Chromecast; choosing it opens Safari's list from the tap", () => {
    player.airPlay = { available: true, active: false };
    show();
    expect(screen.getByRole("radio", { name: /Living room TV/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /^AirPlay/ }));
    fireEvent.click(screen.getByRole("button", { name: "AirPlay to a TV" }));
    // Called synchronously in the click: WebKit opens its list only from a gesture.
    expect(engine.showAirPlayPicker).toHaveBeenCalledOnce();
  });

  it("while AirPlaying: chosen already, it says so, and stops", () => {
    player.airPlay = { available: true, active: true };
    show();
    expect(screen.getByRole("radio", { name: /^AirPlay/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Playing on AirPlay")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop AirPlay" }));
    expect(engine.stopAirPlay).toHaveBeenCalledOnce();
    expect(engine.showAirPlayPicker).not.toHaveBeenCalled();
  });
});
