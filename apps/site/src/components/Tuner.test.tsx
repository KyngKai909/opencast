import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Tuner } from "./Tuner";

const readout = () => document.querySelector(".st-readout")!.textContent;
const picture = () => screen.getByTestId("tuner-picture");

describe("Tuner", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts on CIVC 7.1, live, with the bug and the lit tally", () => {
    render(<Tuner />);
    expect(readout()).toContain("7.1CIVCInland Civic");
    expect(picture().textContent).toContain("Town Hall: backyard homes and ADUs");
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByRole("img", { name: "On air" })).toBeTruthy();
    expect(document.querySelector(".oc-bug")!.textContent).toBe("CIVC7.1");
  });

  it("changes channel with the rocker after the flip, and wraps", () => {
    render(<Tuner />);
    fireEvent.click(screen.getByRole("button", { name: "Channel up" }));
    expect(picture().className).toContain("st-pic--flip");
    act(() => void vi.advanceTimersByTime(140));
    expect(picture().className).not.toContain("st-pic--flip");
    expect(readout()).toContain("9.1RDLS");
    fireEvent.click(screen.getByRole("button", { name: "Channel down" }));
    fireEvent.click(screen.getByRole("button", { name: "Channel down" }));
    act(() => void vi.advanceTimersByTime(140));
    expect(readout()).toContain("101.9CRAT");
  });

  it("changes channel with the arrow keys, but not from a field", () => {
    render(
      <>
        <Tuner />
        <input aria-label="Email" />
      </>
    );
    fireEvent.keyDown(document, { key: "ArrowUp" });
    act(() => void vi.advanceTimersByTime(140));
    expect(readout()).toContain("9.1RDLS");
    screen.getByLabelText("Email").focus();
    fireEvent.keyDown(screen.getByLabelText("Email"), { key: "ArrowUp" });
    act(() => void vi.advanceTimersByTime(140));
    expect(readout()).toContain("9.1RDLS");
  });

  it("tunes a typed number after the wait, or at once on Enter", () => {
    render(<Tuner />);
    fireEvent.keyDown(document, { key: "1" });
    fireEvent.keyDown(document, { key: "2" });
    expect(readout()).toContain("12.1BEATInland Beat");
    act(() => void vi.advanceTimersByTime(2000 + 140));
    expect(picture().textContent).toContain("Saturday Reel");
    expect(document.querySelector(".oc-bug")!.textContent).toBe("BEAT12.1");

    fireEvent.keyDown(document, { key: "2" });
    fireEvent.keyDown(document, { key: "4" });
    fireEvent.keyDown(document, { key: "Enter" });
    act(() => void vi.advanceTimersByTime(140));
    expect(readout()).toContain("24.1REEL");
  });

  it("shows the radio frequency and the Radio band tag, and no bug, on radio", () => {
    render(<Tuner />);
    for (const key of ["8", "8", "3", "Enter"]) fireEvent.keyDown(document, { key });
    act(() => void vi.advanceTimersByTime(140));
    expect(document.querySelector(".st-pic__radio")!.textContent).toBe("88.3");
    expect(screen.getByText("Radio band")).toBeTruthy();
    expect(document.querySelector(".oc-bug")).toBeNull();
    expect(readout()).toContain("88.3NITENight Desk");
  });

  it("says when a number has no station, and stays on the channel", () => {
    render(<Tuner />);
    fireEvent.keyDown(document, { key: "1" });
    fireEvent.keyDown(document, { key: "3" });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(readout()).toContain("No station on 13");
    act(() => void vi.advanceTimersByTime(2000));
    expect(readout()).toContain("7.1CIVC");
  });

  it("Escape drops what's typed", () => {
    render(<Tuner />);
    fireEvent.keyDown(document, { key: "9" });
    fireEvent.keyDown(document, { key: "Escape" });
    act(() => void vi.advanceTimersByTime(3000));
    expect(readout()).toContain("7.1CIVC");
  });
});
