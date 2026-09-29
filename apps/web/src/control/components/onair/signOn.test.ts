import { describe, expect, it } from "vitest";
import { signOnSummary } from "./signOn";

const ok = { passed: true, blocking: true };
const warn = { passed: false, blocking: false };
const block = { passed: false, blocking: true };

describe("signOnSummary", () => {
  it("writes the frame's line when one warning is left", () => {
    expect(signOnSummary([ok, ok, ok, ok, warn])).toBe("Five checks. Four are done; one is a warning you can sign on through.");
  });
  it("says what stops sign-on", () => {
    expect(signOnSummary([ok, ok, block, block, warn])).toBe("Five checks. Two are done; two need fixing before you can sign on.");
    expect(signOnSummary([ok, block, ok])).toBe("Three checks. Two are done; one needs fixing before you can sign on.");
  });
  it("says when everything is done", () => {
    expect(signOnSummary([ok, ok, ok, ok])).toBe("Four checks. All four are done.");
  });
});
