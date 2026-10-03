// A244: programming blocks on the log timeline: a rail in the block's colour, solid where it airs
// and dashed where it's placed but nothing of it airs; a button when it opens a pane.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { LogTimeline, bandLabel, placeBand, type TimelineBand } from "./LogTimeline";

afterEach(cleanup);

const TZ = "America/Los_Angeles";
const at = (h: number, m = 0) => new Date(Date.parse("2026-10-03T00:00:00-07:00") + (h * 60 + m) * 60_000).toISOString();
const band: TimelineBand = { id: "span-1", label: "Late Crate Nights", start: at(21), end: at(25), pieces: [{ start: at(21), end: at(25, 10) }], colour: "#1F5C99", problems: 1 };

describe("block rails", () => {
  it("run from the span's start to the last member's end; the solid part is where it airs", () => {
    const placed = placeBand({ ...band, pieces: [{ start: at(21, 30), end: at(23) }] }, at(18), at(26), 1);
    expect(placed).toEqual({ top: 180, height: 240, pieces: [{ top: 30, height: 90 }] });
    expect(bandLabel(band, TZ)).toBe("Late Crate Nights, 9:00 pm to 1:10 am");
  });

  it("is a button with its name and what to look at, when it opens a pane", () => {
    const onSelectBand = vi.fn();
    const { getByRole } = render(<LogTimeline blocks={[]} from={at(18)} to={at(26)} timeZone={TZ} bands={[band]} onSelectBand={onSelectBand} />);
    const button = getByRole("button", { name: "Late Crate Nights, 9:00 pm to 1:10 am, 1 thing to look at" });
    fireEvent.click(button);
    expect(onSelectBand).toHaveBeenCalledWith(band);
  });

  it("isn't drawn without bands", () => {
    const { container } = render(<LogTimeline blocks={[]} from={at(18)} to={at(26)} timeZone={TZ} />);
    expect(container.querySelector(".oc-tl__band")).toBeNull();
    expect(container.querySelector(".oc-tl--bands")).toBeNull();
  });
});
