import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ViewerPhoneShell } from "./ViewerPhoneShell";

afterEach(cleanup);

describe("ViewerPhoneShell", () => {
  it("shows the four tabs with the selected one", () => {
    render(<ViewerPhoneShell tab="guide" linkTo={(t) => `/${t}`} market={{ name: "Inland Empire" }} />);
    const tabs = ["Dial", "Guide", "Search", "You"].map((n) => screen.getByRole("link", { name: n }));
    expect(tabs.map((t) => t.getAttribute("aria-current"))).toEqual([null, "page", null, null]);
    expect(screen.getByRole("button", { name: "Inland Empire" })).toBeTruthy();
  });

  it("swaps the top bar for a back bar, without tabs", () => {
    const back = vi.fn();
    render(<ViewerPhoneShell tabs={false} back={{ title: "Notifications", onBack: back }} market={{ name: "Inland Empire" }} />);
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Inland Empire" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Dial" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(back).toHaveBeenCalledOnce();
  });
});
