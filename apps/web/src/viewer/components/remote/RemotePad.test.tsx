// The phone remote's pad, as on a TV's remote: the arrows and OK always send focus and select (on
// the TV's picture and in its guide and menu alike), Menu, Guide, Back and Info sit at its corners,
// and the phone keeps track of the guide or menu it opened on the TV.

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { RemoteCommand } from "../../cast/types";
import type { TvOverlay } from "./logic";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, controlUrl: "http://control.test", tvUrl: "http://tv.test", mockClock: "2026-09-27T03:42:00Z" }
}));
vi.mock("../../cast/session", () => ({ stopCasting: vi.fn(), useCastSession: () => ({ status: "idle" }) }));
vi.mock("../../player/PlayerRoot", () => ({ useNowPlaying: () => ({ row: null, playing: false }) }));
vi.mock("../watch/overlay", () => ({ useOverlayParams: () => ({ open: vi.fn(), close: vi.fn(), params: new URLSearchParams() }) }));

const { RemotePad, useTvOverlay } = await import("./RemoteParts");

/** The pad as the remote uses it, keeping what's open on the TV. */
function Pad({ onCommand }: { onCommand: (c: RemoteCommand) => void }) {
  const [open, setOpen] = useState<TvOverlay>(null);
  return <RemotePad open={open} onCommand={onCommand} onOpenChange={setOpen} />;
}

const key = (name: string) => screen.getByRole("button", { name });
const pressed = (name: string) => key(name).getAttribute("aria-pressed");

describe("the remote's pad", () => {
  it("is one box: the round pad with the quick keys in the corners, sending focus and select", () => {
    const onCommand = vi.fn();
    render(<Pad onCommand={onCommand} />);
    const pad = screen.getByRole("group", { name: "Arrows" });
    // Menu and Guide above the ring, Back and Info below it, the arrows round OK in between.
    expect([...pad.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["Menu", "Guide", "Up", "Left", "OK", "Right", "Down", "Back", "Info"]);
    for (const name of ["Up", "Down", "Left", "Right", "OK"]) fireEvent.click(key(name));
    expect(onCommand.mock.calls.map(([c]) => c)).toEqual([
      { type: "focus", dir: "up" },
      { type: "focus", dir: "down" },
      { type: "focus", dir: "left" },
      { type: "focus", dir: "right" },
      { type: "select" }
    ]);
  });

  it("has Menu, Guide, Back and Info at its corners, sending menu, guide, back and info", () => {
    const onCommand = vi.fn();
    render(<Pad onCommand={onCommand} />);
    for (const name of ["Menu", "Guide", "Back", "Info"]) fireEvent.click(key(name));
    expect(onCommand.mock.calls.map(([c]) => c)).toEqual([{ type: "menu" }, { type: "guide" }, { type: "back" }, { type: "info" }]);
  });

  it("keeps Guide and Menu pressed for what's open on the TV, and names the pad for it", () => {
    render(<Pad onCommand={vi.fn()} />);
    expect([pressed("Guide"), pressed("Menu")]).toEqual(["false", "false"]);
    expect(screen.queryByRole("group", { name: "Guide on the TV" })).toBeNull();

    // Guide opens the TV's guide.
    fireEvent.click(key("Guide"));
    expect([pressed("Guide"), pressed("Menu")]).toEqual(["true", "false"]);
    expect(screen.getByRole("group", { name: "Guide on the TV" })).toBeTruthy();

    // Menu opens the menu in its place.
    fireEvent.click(key("Menu"));
    expect([pressed("Guide"), pressed("Menu")]).toEqual(["false", "true"]);
    expect(screen.getByRole("group", { name: "Menu on the TV" })).toBeTruthy();

    // The same key closes it.
    fireEvent.click(key("Menu"));
    expect([pressed("Guide"), pressed("Menu")]).toEqual(["false", "false"]);
    expect(screen.getByRole("group", { name: "Arrows" })).toBeTruthy();

    // Back closes what's open; Info and the arrows leave it.
    fireEvent.click(key("Guide"));
    fireEvent.click(key("Info"));
    fireEvent.click(key("Down"));
    fireEvent.click(key("OK"));
    expect(pressed("Guide")).toBe("true");
    fireEvent.click(key("Back"));
    expect(pressed("Guide")).toBe("false");
    expect(screen.queryByRole("group", { name: "Guide on the TV" })).toBeNull();
  });

  it("forgets what it opened when the TV changes station", () => {
    const { result, rerender } = renderHook(({ id }) => useTvOverlay(id), { initialProps: { id: "civc" as string | null } });
    act(() => result.current[1]("guide"));
    rerender({ id: "civc" });
    expect(result.current[0]).toBe("guide");
    rerender({ id: "beat" });
    expect(result.current[0]).toBeNull();
  });
});
