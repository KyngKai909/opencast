// The phone remote's Back to live: under the rockers while the TV is behind live, sending the
// TV the backToLive command (Cast, the relay and the mirror take it alike).

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, controlUrl: "http://control.test", tvUrl: "http://tv.test", mockClock: "2026-09-27T03:42:00Z" }
}));
vi.mock("../../cast/session", () => ({ stopCasting: vi.fn(), useCastSession: () => ({ status: "idle" }) }));
vi.mock("../../player/PlayerRoot", () => ({ useNowPlaying: () => ({ row: null, playing: false }) }));
vi.mock("../watch/overlay", () => ({ useOverlayParams: () => ({ open: vi.fn(), close: vi.fn(), params: new URLSearchParams() }) }));

const { BackToLive } = await import("./RemoteParts");

describe("the remote's Back to live", () => {
  it("sends the TV back to live", () => {
    const onCommand = vi.fn();
    render(<BackToLive onCommand={onCommand} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to live" }));
    expect(onCommand).toHaveBeenCalledWith({ type: "backToLive" });
  });
});
