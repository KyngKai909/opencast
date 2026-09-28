import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ViewerWebShell } from "./ViewerWebShell";

afterEach(cleanup);

const market = { name: "Inland Empire" };
const kai = { initials: "KM", name: "Kai M.", href: "/you" };

describe("ViewerWebShell", () => {
  it("opens search with / from anywhere outside a text field", () => {
    const onSearch = vi.fn();
    render(
      <ViewerWebShell market={market} onSearch={onSearch}>
        <input aria-label="Note" />
      </ViewerWebShell>
    );
    fireEvent.keyDown(document.body, { key: "/" });
    expect(onSearch).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Note" }), { key: "/" });
    fireEvent.keyDown(document.body, { key: "/", metaKey: true });
    fireEvent.keyDown(document.body, { key: "1" });
    expect(onSearch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Search stations and programs/ }));
    expect(onSearch).toHaveBeenCalledTimes(2);
  });

  it("stops listening when it unmounts", () => {
    const onSearch = vi.fn();
    const { unmount } = render(<ViewerWebShell market={market} onSearch={onSearch} />);
    unmount();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("underlines the active section", () => {
    render(<ViewerWebShell active="guide" linkTo={(s) => `/${s}`} market={market} user={kai} />);
    expect(screen.getByRole("link", { name: "Guide" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Dial" }).getAttribute("aria-current")).toBeNull();
  });

  it("rings the avatar on You, with no nav item active", () => {
    const { container } = render(<ViewerWebShell active="you" linkTo={(s) => `/${s}`} market={market} user={kai} />);
    expect(screen.getByRole("link", { name: "Kai M." }).className).toContain("oc-shell-avatar--current");
    expect(container.querySelectorAll("nav [aria-current]")).toHaveLength(0);
  });

  it("shows Sign in when nobody is signed in", () => {
    render(<ViewerWebShell market={market} signIn={{ href: "/signin" }} />);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/signin");
  });
});
