// A244: the banner names a programming block before the title ("Late Crate Nights · Saturday
// Reel"), and the Next line names the block the next program enters (only a different one).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { station } from "../test-helpers";
import { Banner } from "./Banner";

type Block = { id: string; name: string; colour: string | null };
const LCN: Block = { id: "00000000-0000-4000-8000-00000000b10c", name: "Late Crate Nights", colour: "#1F5C99" };
const NIGHT: Block = { id: "00000000-0000-4000-8000-00000000b10d", name: "After Hours", colour: null };
const now = new Date("2026-09-27T03:40:00Z");

function channel(block: Block | null, nextBlock: Block | null) {
  const c = station("BEAT", "12.1");
  return {
    ...c,
    now: { ...c.now!, title: "Saturday Reel", ...(block ? { block } : {}) },
    next: { ...c.now!, title: "Late Crate", startsAt: "2026-09-27T04:00:00Z", endsAt: "2026-09-27T05:00:00Z", ...(nextBlock ? { block: nextBlock } : {}) }
  };
}

describe("the banner in a programming block", () => {
  it("reads 'Late Crate Nights · Saturday Reel', in one heading", () => {
    render(<Banner channel={channel(LCN, LCN)} size="tv" now={now} timeZone="America/Los_Angeles" onAirHere />);
    const h = screen.getByRole("heading", { level: 3, name: "Late Crate Nights · Saturday Reel" });
    expect(h.textContent).toBe("Late Crate Nights · Saturday Reel");
    // The next program is in the same block: the Next line doesn't repeat it.
    expect(screen.getByText(/Next at/).textContent).not.toContain("Late Crate Nights");
  });

  it("names the block the next program enters", () => {
    render(<Banner channel={channel(LCN, NIGHT)} size="web" now={now} timeZone="America/Los_Angeles" onAirHere />);
    expect(screen.getByText(/Next at/).textContent).toContain("Late Crate · After Hours");
  });

  it("without a block, the title alone (as before)", () => {
    render(<Banner channel={channel(null, null)} size="tv" now={now} timeZone="America/Los_Angeles" onAirHere />);
    const h = screen.getByRole("heading", { level: 3 });
    expect(h.textContent).toBe("Saturday Reel");
    expect(h.getAttribute("aria-label")).toBeNull();
  });
});
