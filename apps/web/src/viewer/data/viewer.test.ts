import { describe, expect, it } from "vitest";
import { replaceKeySearch } from "./viewer";

describe("replaceKeySearch", () => {
  it("opens the replace dialog over a page", () => {
    const p = new URLSearchParams(replaceKeySearch("?day=sat", "id-prep"));
    expect(Object.fromEntries(p)).toEqual({ day: "sat", modal: "replace-key", station: "id-prep" });
  });

  it("remembers the station preview underneath, to go back to it", () => {
    const p = new URLSearchParams(replaceKeySearch("?station=prep", "id-prep"));
    expect(p.get("preview")).toBe("prep");
    expect(p.get("station")).toBe("id-prep");
  });

  it("doesn't take another modal's station for a preview", () => {
    const p = new URLSearchParams(replaceKeySearch("?modal=pledge&station=civc", "id-prep"));
    expect(p.get("preview")).toBeNull();
  });
});
