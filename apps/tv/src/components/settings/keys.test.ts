import { describe, expect, it } from "vitest";
import { settingsCommand } from "./keys";

const rail = { zone: "rail" as const, row: null };
const stepper = { zone: "pane" as const, row: "step" as const };
const action = { zone: "pane" as const, row: "action" as const };

describe("the remote in TV settings", () => {
  it("◀ ▶ change the focused row's value, stopping at the ends; OK steps round", () => {
    expect(settingsCommand({ type: "focus", dir: "left" }, stepper)).toEqual({ do: "step", dir: -1, wrap: false });
    expect(settingsCommand({ type: "focus", dir: "right" }, stepper)).toEqual({ do: "step", dir: 1, wrap: false });
    expect(settingsCommand({ type: "select" }, stepper)).toEqual({ do: "step", dir: 1, wrap: true });
  });

  it("▲ ▼ move between rows and sections (focus does it)", () => {
    expect(settingsCommand({ type: "focus", dir: "up" }, stepper)).toBeNull();
    expect(settingsCommand({ type: "focus", dir: "down" }, rail)).toBeNull();
  });

  it("goes between the sections and their rows", () => {
    expect(settingsCommand({ type: "focus", dir: "right" }, rail)).toEqual({ do: "pane" });
    expect(settingsCommand({ type: "select" }, rail)).toEqual({ do: "pane" });
    expect(settingsCommand({ type: "focus", dir: "left" }, action)).toEqual({ do: "rail" });
    expect(settingsCommand({ type: "focus", dir: "right" }, action)).toEqual({ do: "nothing" });
    expect(settingsCommand({ type: "focus", dir: "left" }, rail)).toEqual({ do: "nothing" });
    // OK on a row that isn't a stepper presses it (sign out, sign in, your market).
    expect(settingsCommand({ type: "select" }, action)).toBeNull();
  });

  it("Back: rows to sections, sections to the menu", () => {
    expect(settingsCommand({ type: "back" }, stepper)).toEqual({ do: "rail" });
    expect(settingsCommand({ type: "back" }, rail)).toEqual({ do: "close" });
    expect(settingsCommand({ type: "back" }, { zone: null, row: null })).toEqual({ do: "close" });
  });

  it("leaves channel, numbers and the other keys alone", () => {
    expect(settingsCommand({ type: "channel", dir: "up" }, stepper)).toBeNull();
    expect(settingsCommand({ type: "digit", digit: 4 }, stepper)).toBeNull();
    expect(settingsCommand({ type: "menu" }, rail)).toBeNull();
    expect(settingsCommand({ type: "guide" }, stepper)).toBeNull();
  });
});
