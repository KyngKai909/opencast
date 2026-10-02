import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Toast, ToastProvider, useToast, type ShowToast } from "./Toast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Trigger({ toast, label = "Remind me" }: { toast: ShowToast; label?: string }) {
  const { show } = useToast();
  return (
    <button type="button" onClick={() => show(toast)}>
      {label}
    </button>
  );
}

describe("Toast", () => {
  it("stands alone as a status with Undo", () => {
    const onUndo = vi.fn();
    render(<Toast message="Reminder set for Beat Tape Live, 9:00 pm" onUndo={onUndo} />);
    expect(screen.getByRole("status").textContent).toContain("Reminder set for Beat Tape Live, 9:00 pm");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalled();
  });
});

describe("ToastProvider", () => {
  it("shows one toast in a live region and takes it away after 5 seconds", () => {
    const onExpire = vi.fn();
    render(
      <ToastProvider>
        <Trigger toast={{ message: "Reminder set for Beat Tape Live, 9:00 pm", onExpire }} />
      </ToastProvider>
    );
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    fireEvent.click(screen.getByRole("button", { name: "Remind me" }));
    expect(region.textContent).toContain("Reminder set");
    act(() => vi.advanceTimersByTime(4999));
    expect(region.textContent).toContain("Reminder set");
    act(() => vi.advanceTimersByTime(1));
    expect(region.textContent).toBe("");
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("Undo calls back and closes; the change doesn't also expire", () => {
    const onUndo = vi.fn();
    const onExpire = vi.fn();
    render(
      <ToastProvider>
        <Trigger toast={{ message: "3 spots added. They start in the 8:44 pm break.", onUndo, onExpire }} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Remind me" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    act(() => vi.advanceTimersByTime(10_000));
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("a new toast replaces the one on screen and restarts the clock", () => {
    render(
      <ToastProvider>
        <Trigger toast={{ message: "First", timeout: 3000 }} label="One" />
        <Trigger toast={{ message: "Second", timeout: 3000 }} label="Two" />
      </ToastProvider>
    );
    const region = screen.getByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "One" }));
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(screen.getByRole("button", { name: "Two" }));
    expect(region.textContent).toBe("Second");
    act(() => vi.advanceTimersByTime(2000));
    expect(region.textContent).toBe("Second");
    act(() => vi.advanceTimersByTime(1000));
    expect(region.textContent).toBe("");
  });

  it("hover holds it; leaving starts the clock again", () => {
    render(
      <ToastProvider>
        <Trigger toast={{ message: "NITE can carry Late Crate from Monday", onUndo: () => {} }} />
      </ToastProvider>
    );
    const region = screen.getByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Remind me" }));
    fireEvent.mouseEnter(region);
    act(() => vi.advanceTimersByTime(20_000));
    expect(region.textContent).toContain("NITE can carry");
    fireEvent.mouseLeave(region);
    act(() => vi.advanceTimersByTime(5000));
    expect(region.textContent).toBe("");
  });

  it("useToast outside a provider says so", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger toast={{ message: "x" }} />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
