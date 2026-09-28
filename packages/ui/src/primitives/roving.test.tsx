import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { moveIndex } from "./roving";

afterEach(cleanup);

describe("moveIndex", () => {
  it("wraps at both ends and skips disabled items", () => {
    expect(moveIndex(2, "ArrowRight", 3)).toBe(0);
    expect(moveIndex(0, "ArrowLeft", 3)).toBe(2);
    expect(moveIndex(0, "ArrowDown", 4, (i) => i === 1)).toBe(2);
    expect(moveIndex(1, "Home", 4, (i) => i === 0)).toBe(1);
    expect(moveIndex(0, "End", 4, (i) => i === 3)).toBe(2);
    expect(moveIndex(0, "a", 4)).toBeNull();
    expect(moveIndex(0, "ArrowRight", 2, () => true)).toBeNull();
  });
});
