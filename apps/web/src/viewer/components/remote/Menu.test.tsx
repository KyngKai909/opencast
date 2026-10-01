// The phone remote's Menu: opens the TV's menu (settings, captions, the market), and the pad that
// then moves and chooses there says it's the menu.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, controlUrl: "http://control.test", tvUrl: "http://tv.test", mockClock: "2026-09-27T03:42:00Z" }
}));
vi.mock("../../cast/session", () => ({ stopCasting: vi.fn(), useCastSession: () => ({ status: "idle" }) }));
vi.mock("../../player/PlayerRoot", () => ({ useNowPlaying: () => ({ row: null, playing: false }) }));
vi.mock("../watch/overlay", () => ({ useOverlayParams: () => ({ open: vi.fn(), close: vi.fn(), params: new URLSearchParams() }) }));

const { GuidePad, RemoteButtons } = await import("./RemoteParts");

describe("the remote's Menu", () => {
  it("sits beside Guide, and shows when the TV's menu is open", () => {
    const onMenu = vi.fn();
    const { rerender } = render(<RemoteButtons onGuide={vi.fn()} onMenu={onMenu} onInfo={vi.fn()} onKeypad={vi.fn()} onLast={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(onMenu).toHaveBeenCalledTimes(1);
    rerender(<RemoteButtons onGuide={vi.fn()} onMenu={onMenu} onInfo={vi.fn()} onKeypad={vi.fn()} onLast={vi.fn()} menuOpen />);
    expect(screen.getByRole("button", { name: "Menu" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Guide" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("moves and chooses in the TV's menu with the same pad as the guide", () => {
    const onCommand = vi.fn();
    render(<GuidePad label="Menu on the TV" onCommand={onCommand} onBack={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Menu on the TV" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Down" }));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onCommand.mock.calls).toEqual([[{ type: "focus", dir: "down" }], [{ type: "select" }]]);
  });
});
