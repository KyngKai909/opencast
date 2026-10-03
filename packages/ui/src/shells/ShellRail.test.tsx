import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ShellRail, buildRail } from "./ShellRail";
import { CONTROL_RAIL } from "./ControlShell";

afterEach(cleanup);

describe("ShellRail", () => {
  it("builds the fixed rail with links from linkTo and the app's extras", () => {
    const groups = buildRail(CONTROL_RAIL, { listings: { count: "2", warn: true } }, (p) => `/beat/${p}`);
    expect(groups.map((g) => g.label)).toEqual(["On air", "Market", "Programming", "Money", "Station"]);
    // A246: Schedule in On air, in the reference's order; Blocks is one of its tabs, Breaks one of its parts.
    expect(groups[0].items.map((i) => i.label)).toEqual(["Monitor", "Audience", "Schedule", "Live sources"]);
    expect(groups[0].items[2]).toMatchObject({ id: "schedule", label: "Schedule", href: "/beat/schedule" });
    expect(groups[2].items.map((i) => i.label)).toEqual(["Library", "Listings"]);
    expect(groups[3].items.map((i) => i.label)).toEqual(["Spot market", "Sponsors", "Earnings"]);
    expect(groups[2].items[1]).toMatchObject({ id: "listings", href: "/beat/listings", count: "2", warn: true });
  });

  it("marks the active page and the amber count", () => {
    const groups = buildRail(CONTROL_RAIL, { listings: { count: "2", warn: true, countLabel: "need a description" }, library: { count: 7 } }, (p) => `#${p}`);
    render(<ShellRail groups={groups} active="monitor" />);
    expect(screen.getByRole("link", { name: "Monitor" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Audience" }).getAttribute("aria-current")).toBeNull();
    const listings = screen.getByRole("link", { name: /Listings/ });
    expect(listings.textContent).toBe("Listings2, need a description");
    expect(listings.querySelector(".oc-shell-rail__count--warn")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Library/ }).querySelector(".oc-shell-rail__count--warn")).toBeNull();
  });

  it("names each group for screen readers", () => {
    render(<ShellRail groups={buildRail(CONTROL_RAIL, {}, (p) => `#${p}`)} active="monitor" />);
    expect(screen.getByRole("group", { name: "Money" })).toBeTruthy();
  });

  it("makes an item without an href a button that calls onClick", () => {
    const onClick = vi.fn();
    render(<ShellRail groups={[{ label: "Station", items: [{ id: "rights", label: "Rights", onClick }] }]} active={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Rights" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("disables an item with its reason: not a link, still focusable, the reason as its title", () => {
    const onClick = vi.fn();
    render(
      <ShellRail
        groups={[{ label: "Money", items: [{ id: "earnings", label: "Earnings", href: "#earnings", onClick, disabled: "Hosts see only their live blocks" }] }]}
        active={null}
      />
    );
    const item = screen.getByRole("link", { name: "Earnings" });
    expect(item.tagName).toBe("SPAN");
    expect(item.getAttribute("href")).toBeNull();
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.getAttribute("tabindex")).toBe("0");
    expect(item.getAttribute("title")).toBe("Hosts see only their live blocks");
    fireEvent.click(item);
    expect(onClick).not.toHaveBeenCalled();
  });
});
