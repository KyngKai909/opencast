import { describe, expect, it, vi } from "vitest";
import type { PlayerEngine } from "@opencast/player";

vi.mock("./focus", () => ({ moveFocus: vi.fn(), pressFocused: vi.fn() }));
import { moveFocus, pressFocused } from "./focus";
import { contextFor, dispatch, onPictureCommand, type Ui } from "./commands";

function setup(path: string) {
  const ui: Ui = { path: () => path, go: vi.fn(), close: vi.fn() };
  const engine = { handle: vi.fn() } as unknown as PlayerEngine;
  return { ui, engine, handle: engine.handle as ReturnType<typeof vi.fn> };
}

describe("TV commands", () => {
  it("sends everything to the player while the picture shows", () => {
    const { ui, engine, handle } = setup("/");
    dispatch({ type: "channel", dir: "up" }, undefined, ui, engine);
    dispatch({ type: "focus", dir: "down" }, undefined, ui, engine);
    expect(handle).toHaveBeenCalledTimes(2);
    expect(moveFocus).not.toHaveBeenCalled();
  });

  it("opens the overlays the player passes on", () => {
    const { ui, engine, handle } = setup("/");
    onPictureCommand({ type: "guide" }, ui, engine);
    onPictureCommand({ type: "focus", dir: "left" }, ui, engine);
    onPictureCommand({ type: "back" }, ui, engine);
    expect(ui.go).toHaveBeenNthCalledWith(1, "/guide");
    expect(ui.go).toHaveBeenNthCalledWith(2, "/presets");
    expect(handle).toHaveBeenCalledWith({ type: "last" }, undefined);
  });

  it("moves focus, chooses and closes in an overlay; channel still changes underneath", () => {
    const { ui, engine, handle } = setup("/guide");
    dispatch({ type: "focus", dir: "right" }, undefined, ui, engine);
    dispatch({ type: "select" }, undefined, ui, engine);
    dispatch({ type: "back" }, undefined, ui, engine);
    dispatch({ type: "channel", dir: "down" }, undefined, ui, engine);
    expect(moveFocus).toHaveBeenCalledWith("right");
    expect(pressFocused).toHaveBeenCalled();
    expect(ui.close).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith({ type: "channel", dir: "down" }, undefined);
  });

  it("toggles the same overlay and swaps to another", () => {
    const { ui, engine } = setup("/guide/options/5");
    dispatch({ type: "guide" }, undefined, ui, engine);
    dispatch({ type: "menu" }, undefined, ui, engine);
    expect(ui.close).toHaveBeenCalledTimes(1);
    expect(ui.go).toHaveBeenCalledWith("/menu", { replace: true });
  });

  it("gives the keyboard its context", () => {
    expect(contextFor("/")).toBe("picture");
    expect(contextFor("/menu")).toBe("overlay");
  });
});
