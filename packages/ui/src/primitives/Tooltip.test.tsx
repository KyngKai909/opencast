import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "./Tooltip";

afterEach(cleanup);

describe("Tooltip", () => {
  it("describes its control, shows on focus and hides on Escape", () => {
    render(
      <Tooltip content="On air only">
        <button type="button">Cue a break</button>
      </Tooltip>
    );
    const btn = screen.getByRole("button", { name: "Cue a break" });
    const tip = screen.getByRole("tooltip", { hidden: true });
    expect(btn.getAttribute("aria-describedby")).toBe(tip.id);
    fireEvent.focus(btn);
    expect(tip.className).toContain("oc-tooltip--shown");
    fireEvent.keyDown(btn, { key: "Escape" });
    expect(tip.className).not.toContain("oc-tooltip--shown");
  });

  it("waits before showing on hover", () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="On air only" delay={400}>
        <button type="button">Cue a break</button>
      </Tooltip>
    );
    const tip = screen.getByRole("tooltip", { hidden: true });
    fireEvent.mouseEnter(tip.parentElement!);
    expect(tip.className).not.toContain("oc-tooltip--shown");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(tip.className).toContain("oc-tooltip--shown");
    vi.useRealTimers();
  });
});
