import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ViewerPhoneShell } from "./ViewerPhoneShell";

afterEach(cleanup);

describe("ViewerPhoneShell", () => {
  it("shows the four tabs with the selected one", () => {
    render(<ViewerPhoneShell tab="guide" linkTo={(t) => `/${t}`} market={{ name: "Inland Empire" }} />);
    const tabs = ["Watch", "Guide", "Search", "You"].map((n) => screen.getByRole("link", { name: n }));
    expect(tabs.map((t) => t.getAttribute("aria-current"))).toEqual([null, "page", null, null]);
    expect(screen.getByRole("button", { name: "Inland Empire" })).toBeTruthy();
  });

  it("swaps the top bar for a back bar, without tabs", () => {
    const back = vi.fn();
    render(<ViewerPhoneShell tabs={false} back={{ title: "Notifications", onBack: back }} market={{ name: "Inland Empire" }} />);
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Inland Empire" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Watch" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(back).toHaveBeenCalledOnce();
  });

  it("floats the tabs in a pill with the Tune button beside it (A245, swipe home 08)", () => {
    const tune = vi.fn();
    render(<ViewerPhoneShell floating onPicture tab="dial" linkTo={(t) => `/${t}`} onTune={tune} />);
    const pill = screen.getByRole("navigation", { name: "Tabs" });
    expect(pill.querySelectorAll("a")).toHaveLength(4);
    expect(screen.getByRole("link", { name: "Watch" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Tune by number" }));
    expect(tune).toHaveBeenCalledOnce();
  });

  it("takes the floating bar out of reach while it's faded, and away on a phone on its side", () => {
    const { rerender } = render(<ViewerPhoneShell floating onPicture barHidden linkTo={(t) => `/${t}`} onTune={() => {}} />);
    expect(document.querySelector(".oc-viewer-phone__float")?.hasAttribute("inert")).toBe(true);
    rerender(<ViewerPhoneShell floating onPicture noBar linkTo={(t) => `/${t}`} onTune={() => {}} />);
    expect(screen.queryByRole("navigation", { name: "Tabs" })).toBeNull();
  });
});
