import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlayerBar } from "./PlayerBar";
import { MiniPlayer } from "./MiniPlayer";

afterEach(cleanup);

const reel = { title: "Saturday Reel", colour: "#8C3B7A" };

describe("PlayerBar", () => {
  it("lights the tally only while playing, and turns Pause into Play", () => {
    const toggle = vi.fn();
    const { rerender } = render(<PlayerBar {...reel} station="BEAT 12.1, carried from REEL" playing onTogglePlay={toggle} />);
    expect(screen.getByRole("img", { name: "On air" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(toggle).toHaveBeenCalledOnce();
    rerender(<PlayerBar {...reel} station="BEAT 12.1, carried from REEL" playing={false} onTogglePlay={toggle} />);
    expect(screen.queryByRole("img", { name: "On air" })).toBeNull();
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("changes channel, or moves along the band on radio", () => {
    const down = vi.fn();
    const { rerender } = render(<PlayerBar {...reel} station="BEAT 12.1" playing onChannelDown={down} />);
    fireEvent.click(screen.getByRole("button", { name: "Channel down" }));
    expect(down).toHaveBeenCalledOnce();
    rerender(<PlayerBar title="Radio dramas" station="NITE 88.3" colour="#33507A" card="88.3" playing radio />);
    expect(screen.getByRole("button", { name: "Up the band" })).toBeTruthy();
  });

  it("shows volume and Open player only when the page offers them", () => {
    const { rerender } = render(<PlayerBar {...reel} station="BEAT 12.1" playing />);
    expect(screen.queryByRole("button", { name: "Volume" })).toBeNull();
    rerender(<PlayerBar {...reel} station="BEAT 12.1" playing onVolume={() => {}} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: "Volume" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open player" })).toBeTruthy();
  });
});

describe("MiniPlayer", () => {
  it("lights the tally only while playing, and opens the full player", () => {
    const open = vi.fn();
    const { rerender } = render(<MiniPlayer {...reel} station="BEAT 12.1" playing onOpen={open} />);
    expect(screen.getByRole("img", { name: "On air" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open player, Saturday Reel, BEAT 12.1" }));
    expect(open).toHaveBeenCalledOnce();
    rerender(<MiniPlayer {...reel} station="BEAT 12.1" playing={false} />);
    expect(screen.queryByRole("img", { name: "On air" })).toBeNull();
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });
});
