import { describe, expect, it } from "vitest";
import { isInformational, signOnSummary } from "./signOn";

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
  it("leaves out lines that only inform: off air hours, and items prepared while they all are", () => {
    const prepared = { key: "items_prepared", passed: true, blocking: false };
    expect(isInformational(prepared)).toBe(true);
    expect(signOnSummary([ok, ok, ok, ok, prepared, { key: "off_air_hours", passed: true, blocking: false }])).toBe("Four checks. All four are done.");
  });
  it("counts items still being prepared as a warning, never a blocker", () => {
    const preparing = { key: "items_prepared", passed: false, blocking: false };
    expect(isInformational(preparing)).toBe(false);
    expect(signOnSummary([ok, ok, ok, ok, preparing])).toBe("Five checks. Four are done; one is a warning you can sign on through.");
  });
});
