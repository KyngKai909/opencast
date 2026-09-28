import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Sheet, SHEET_DRAG_CLOSE, SHEET_DRAG_EXPAND } from "./Sheet";

afterEach(cleanup);

// jsdom has no PointerEvent; a MouseEvent carries the clientY the drag reads.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

const grab = () => screen.getByRole("button", { name: "Close" });

describe("Sheet", () => {
  it("is a modal dialog with a grab handle and no close button in the head", () => {
    render(<Sheet open onClose={() => {}} title="Dead air in 12 min" />);
    expect(screen.getByRole("dialog", { name: "Dead air in 12 min" }).getAttribute("aria-modal")).toBe("true");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("the handle closes from the keyboard", () => {
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} title="Station" />);
    fireEvent.click(grab(), { detail: 0 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dragging the handle down past the threshold closes; a short drag springs back", () => {
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} title="Station" />);
    fireEvent.pointerDown(grab(), { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grab(), { clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(grab(), { clientY: 130, pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(grab(), { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grab(), { clientY: 100 + SHEET_DRAG_CLOSE, pointerId: 1 });
    fireEvent.pointerUp(grab(), { clientY: 100 + SHEET_DRAG_CLOSE, pointerId: 1 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dragging up expands when there's somewhere to go", () => {
    const onClose = vi.fn();
    const onExpand = vi.fn();
    render(<Sheet open onClose={onClose} onExpand={onExpand} title="Station" />);
    fireEvent.pointerDown(grab(), { clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(grab(), { clientY: 300 - SHEET_DRAG_EXPAND, pointerId: 1 });
    fireEvent.pointerUp(grab(), { clientY: 300 - SHEET_DRAG_EXPAND, pointerId: 1 });
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape closes", () => {
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} title="Station" />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
