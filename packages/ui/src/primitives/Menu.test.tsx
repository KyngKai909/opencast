import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Menu } from "./Menu";

afterEach(cleanup);

function setup() {
  const give = vi.fn();
  const remove = vi.fn();
  render(
    <Menu
      label="More for NITE 88.4"
      items={[
        { label: "Give it a key", onSelect: give },
        { label: "Move", onSelect: () => {}, disabled: true },
        { label: "Remove", onSelect: remove, danger: true }
      ]}
    />
  );
  return { give, remove, button: screen.getByRole("button", { name: "More for NITE 88.4" }) };
}

describe("Menu", () => {
  it("opens from the keyboard onto the first item", () => {
    const { button } = setup();
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(button, { key: "ArrowDown" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Give it a key" }));
  });

  it("arrows skip disabled items and wrap; Enter chooses and returns focus", () => {
    const { button, remove } = setup();
    fireEvent.keyDown(button, { key: "Enter" });
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Remove" }));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Give it a key" }));
    fireEvent.keyDown(menu, { key: "End" });
    fireEvent.click(document.activeElement!);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("ArrowUp on the button opens onto the last item", () => {
    const { button } = setup();
    fireEvent.keyDown(button, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Remove" }));
  });

  it("Escape closes without leaking to a dialog around it", () => {
    const outer = vi.fn();
    const give = vi.fn();
    render(
      <div onKeyDown={(e) => e.key === "Escape" && outer()}>
        <Menu items={[{ label: "Export to IPFS", onSelect: give }]} />
      </div>
    );
    const button = screen.getByRole("button", { name: "More" });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });

  it("a press outside closes it", () => {
    const { button } = setup();
    fireEvent.click(button);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
