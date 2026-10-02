// Back to live on the picture: the paused sign always offers it; playing on behind live, the TV
// shows a small chip (a remote can't reach a button), and the web leaves it to the controls.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PlayerEngine } from "../engine/PlayerEngine";
import type { OnScreen } from "../engine/timeline";
import { NOTHING_ON_SCREEN } from "../engine/timeline";
import { fakeDriver, flush, station, stubMedia } from "../test-helpers";
import { PlayerProvider } from "./context";
import { PlayerSurface, type PlayerSurfaceProps } from "./PlayerSurface";

const CIVC = station("CIVC", "7.1");
let engine: PlayerEngine;
let driver: ReturnType<typeof fakeDriver>;

beforeEach(() => {
  vi.useFakeTimers();
  stubMedia();
  driver = fakeDriver();
  engine = new PlayerEngine({ driver, warm: "buffer", bannerMs: 5000, numberWaitMs: 2000, pauseHoldMs: 30 * 60_000 });
  engine.setChannels([CIVC]);
});
afterEach(() => {
  engine.destroy();
  vi.useRealTimers();
});

async function show(props: PlayerSurfaceProps = {}) {
  const r = render(
    <PlayerProvider engine={engine}>
      <PlayerSurface {...props} />
    </PlayerProvider>
  );
  await act(async () => {
    const t = engine.tune(CIVC.station.id);
    await flush(10);
    await t;
    // The tune's banner goes.
    await flush(6000);
  });
  return r;
}

const live = () => screen.queryByRole("button", { name: "Back to live" });

describe("the paused sign", () => {
  it("always offers Back to live, not only after the hold", async () => {
    await show();
    expect(live()).toBeNull();
    act(() => engine.pause());
    expect(screen.getByText("Paused")).toBeTruthy();
    expect(engine.getState().paused?.expired).toBe(false);
    act(() => void fireEvent.click(live()!));
    expect(engine.getState()).toMatchObject({ status: "playing", behindLive: false, paused: null });
    expect(screen.queryByText("Paused")).toBeNull();
  });

  it("after the hold, play and Back to live both go back to live", async () => {
    await show({ size: "tv" });
    act(() => engine.pause());
    await act(async () => flush(30 * 60_000 + 10));
    expect(engine.getState().paused?.expired).toBe(true);
    expect(live()).toBeTruthy();
    act(() => engine.play());
    expect(engine.getState()).toMatchObject({ status: "playing", behindLive: false });
  });
});

describe("playing on behind live", () => {
  async function resumeBehind() {
    act(() => engine.pause());
    // A minute paused: the stream's live edge moves on.
    await act(async () => flush(60_000));
    driver.handles.at(-1)!.live! += 60;
    act(() => engine.play());
    // The banner held while paused goes after the usual time.
    await act(async () => flush(5001));
    expect(engine.getState()).toMatchObject({ status: "playing", behindLive: true, banner: null });
  }

  it("TV: a small chip on the picture goes back to live", async () => {
    const { container } = await show({ size: "tv" });
    await resumeBehind();
    const chip = container.querySelector(".oc-player__live") as HTMLButtonElement;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toBe("Back to live");
    act(() => void fireEvent.click(chip));
    expect(engine.getState().behindLive).toBe(false);
    expect(container.querySelector(".oc-player__live")).toBeNull();
  });

  it("TV with a remote: the chip says to hold OK; its name stays Back to live", async () => {
    const { container } = await show({ size: "tv", holdOkHint: true });
    await resumeBehind();
    const chip = container.querySelector(".oc-player__live")!;
    expect(chip.textContent).toBe("Hold OKBack to live");
    expect(chip.querySelector("kbd")?.textContent).toBe("OK");
    expect(live()).toBe(chip);
  });

  it("TV: not while the banner is up (its hint row says it), and not in the guide's window", async () => {
    const { container } = await show({ size: "tv" });
    await resumeBehind();
    act(() => engine.showBanner());
    expect(container.querySelector(".oc-player__live")).toBeNull();
    await act(async () => flush(5001));
    expect(container.querySelector(".oc-player__live")).toBeTruthy();

    const guide = await showAgain({ size: "tv", overlays: "bug" });
    expect(guide.container.querySelector(".oc-player__live")).toBeNull();
  });

  it("web: nothing on the picture (the controls have the button)", async () => {
    const { container } = await show();
    await resumeBehind();
    expect(container.querySelector(".oc-player__live")).toBeNull();
    expect(live()).toBeNull();
  });

  it("steps to the top right when the station's bug is top left", async () => {
    const { container } = await show({ size: "tv" });
    await resumeBehind();
    const bug: NonNullable<OnScreen["bug"]> = { id: "bug-1", mode: "call_sign_and_channel", callSign: "CIVC", channel: "7.1", logoUrl: null, position: "top_left", opacity: 78 };
    act(() => (engine as unknown as { patch(p: object): void }).patch({ onScreen: { ...NOTHING_ON_SCREEN, bug, stationId: CIVC.station.id } }));
    expect(container.querySelector(".oc-player__live")?.getAttribute("data-side")).toBe("right");
    // Paused, the banner is up and covers the bug: the paused sign stays top left; with the banner
    // put away, the bug shows again and the sign steps aside.
    act(() => engine.pause());
    expect(container.querySelector(".oc-player__paused")?.getAttribute("data-side")).toBeNull();
    act(() => engine.hideBanner());
    expect(container.querySelector(".oc-player__paused")?.getAttribute("data-side")).toBe("right");
  });
});

describe("the TV's hint row", () => {
  it("writes a hold hint as Hold, the key, then what it does", async () => {
    const { container } = await show({ size: "tv", hints: [{ kind: "key", key: "OK", label: "Back to live", hold: true }] });
    act(() => engine.pause());
    const hint = [...container.querySelectorAll(".oc-banner__hints > span")].find((n) => n.textContent?.includes("Back to live"));
    expect(hint?.textContent).toBe("HoldOKBack to live");
    expect(hint?.querySelector("kbd")?.textContent).toBe("OK");
  });
});

/** A second surface on the same engine (what's on stays). */
async function showAgain(props: PlayerSurfaceProps) {
  return render(
    <PlayerProvider engine={engine}>
      <PlayerSurface {...props} />
    </PlayerProvider>
  );
}
