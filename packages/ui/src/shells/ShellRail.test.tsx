import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ShellRail, buildRail } from "./ShellRail";
import { CONTROL_RAIL } from "./ControlShell";

afterEach(cleanup);

describe("ShellRail", () => {
  it("builds the fixed rail with links from linkTo and the app's extras", () => {
    const groups = buildRail(CONTROL_RAIL, { breaks: { count: "3:30", warn: true } }, (p) => `/beat/${p}`);
    expect(groups.map((g) => g.label)).toEqual(["On air", "Market", "Programming", "Money", "Station"]);
    expect(groups[0].items[4]).toMatchObject({ id: "breaks", label: "Breaks", href: "/beat/breaks", count: "3:30", warn: true });
  });

  it("marks the active page and the amber count", () => {
    const groups = buildRail(CONTROL_RAIL, { breaks: { count: "3:30", warn: true, countLabel: "of breaks unfilled" }, library: { count: 7 } }, (p) => `#${p}`);
    render(<ShellRail groups={groups} active="monitor" />);
    expect(screen.getByRole("link", { name: "Monitor" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Audience" }).getAttribute("aria-current")).toBeNull();
    const breaks = screen.getByRole("link", { name: /Breaks/ });
    expect(breaks.textContent).toBe("Breaks3:30, of breaks unfilled");
    expect(breaks.querySelector(".oc-shell-rail__count--warn")).not.toBeNull();
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
