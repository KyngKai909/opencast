import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, act, fireEvent, render, screen } from "@testing-library/react";
import { ControlShell } from "./ControlShell";
import { ControlSetupShell } from "./ControlSetupShell";
import { StudioShell } from "./StudioShell";

afterEach(cleanup);

const BEAT = { channel: "12.1", callSign: "BEAT", colour: "#8C3B7A" };
const LA = "America/Los_Angeles";

afterEach(() => vi.useRealTimers());

describe("ControlShell", () => {
  it("has Back to watching in the Opencast app, and none without", () => {
    const { rerender } = render(<ControlShell station={BEAT} active="monitor" now="2026-09-27T03:42:12Z" timeZone={LA} onAir watchHref="/" />);
    expect(screen.getByRole("link", { name: "Back to watching" }).getAttribute("href")).toBe("/");
    rerender(<ControlShell station={BEAT} active="monitor" now="2026-09-27T03:42:12Z" timeZone={LA} onAir />);
    expect(screen.queryByRole("link", { name: "Back to watching" })).toBeNull();
  });

  it("shows the 12-hour clock with seconds in the station's time zone", () => {
    render(<ControlShell station={BEAT} active="monitor" now="2026-09-27T03:42:12Z" timeZone={LA} onAir />);
    expect(screen.getByText("8:42:12 pm").tagName).toBe("TIME");
  });

  it("ticks each second when no time is given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T03:42:12Z"));
    render(<ControlShell station={BEAT} active="monitor" timeZone={LA} onAir />);
    expect(screen.getByText("8:42:12 pm")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("8:42:13 pm")).toBeTruthy();
  });

  it("lights the tally and offers Sign off only on air, and only to someone who can", () => {
    const onSignOff = vi.fn();
    const { rerender } = render(<ControlShell station={BEAT} active="monitor" now={0} onAir onSignOff={onSignOff} />);
    expect(screen.getByRole("img", { name: "On air" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign off" }));
    expect(onSignOff).toHaveBeenCalledOnce();
    rerender(<ControlShell station={BEAT} active="monitor" now={0} onAir={false} onSignOff={onSignOff} />);
    expect(screen.getByRole("img", { name: "Not on air" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign off" })).toBeNull();
    rerender(<ControlShell station={BEAT} active="monitor" now={0} onAir />);
    expect(screen.queryByRole("button", { name: "Sign off" })).toBeNull();
  });

  it("opens the station switcher", () => {
    const onSwitch = vi.fn();
    render(<ControlShell station={BEAT} active="monitor" now={0} onAir onSwitchStation={onSwitch} />);
    fireEvent.click(screen.getByRole("button", { name: /12\.1\s*BEAT/ }));
    expect(onSwitch).toHaveBeenCalledOnce();
  });
});

describe("ControlSetupShell", () => {
  it("says which step of five, and saves and finishes later", () => {
    const later = vi.fn();
    render(<ControlSetupShell step={2} onFinishLater={later} />);
    expect(screen.getByText("New station, step 2 of 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save and finish later" }));
    expect(later).toHaveBeenCalledOnce();
  });
});

describe("StudioShell", () => {
  it("has no clock, tally or Sign off, and no on-air pages", () => {
    const { container } = render(<StudioShell studio={{ name: "Inland Sound Lab", colour: "#7E2F35" }} active="programs" linkTo={(p) => `#${p}`} />);
    expect(screen.getByText("Studios don’t broadcast")).toBeTruthy();
    expect(container.querySelector("time, .oc-tally")).toBeNull();
    expect(screen.queryByRole("link", { name: "Monitor" })).toBeNull();
    expect(screen.getByRole("link", { name: "Your programs" }).getAttribute("aria-current")).toBe("page");
  });
});
