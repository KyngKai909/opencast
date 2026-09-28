import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Toggle, ToggleLock } from "./Toggle";

afterEach(cleanup);

describe("Toggle", () => {
  it("is a switch that reports the new value", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Switch me over at 9:00" />);
    const sw = screen.getByRole("switch", { name: "Switch me over at 9:00" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("locked alerts show a lock that says Always on", () => {
    render(<ToggleLock />);
    expect(screen.getByRole("img", { name: "Always on" })).toBeTruthy();
    cleanup();
    render(<ToggleLock>Owner only</ToggleLock>);
    expect(screen.getByText("Owner only")).toBeTruthy();
  });
});
