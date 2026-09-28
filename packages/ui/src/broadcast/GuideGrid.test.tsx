import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { GuideGrid, guideCells, guideSlots, type GuideStation } from "./GuideGrid";

afterEach(cleanup);

const TZ = "America/Los_Angeles";
const at = (h: number, m = 0) => new Date(Date.parse("2026-09-26T00:00:00-07:00") + (h * 60 + m) * 60_000);

const ROWS: GuideStation[] = [
  {
    id: "civc", channel: "7.1", callSign: "CIVC",
    programs: [
      { id: "th", title: "Town Hall", start: at(20), end: at(21, 30), live: true },
      { id: "pc", title: "Planning Commission", start: at(21, 30), end: at(23) }
    ]
  },
  {
    id: "rdls", channel: "9.1", callSign: "RDLS",
    programs: [{ id: "cc", title: "City Council, Sept 16", start: at(19), end: at(21, 15), listed: true }]
  }
];

describe("guide layout", () => {
  it("spans each program from its start to its end in five-minute columns", () => {
    const cells = guideCells(ROWS[0].programs, at(20), at(23), at(20, 42));
    expect(cells.map((c) => [c.colStart, c.colEnd])).toEqual([[2, 20], [20, 38]]);
    expect(cells[0].onNow).toBe(true);
    expect(cells[1].onNow).toBe(false);
  });
  it("clips a program that began before the window and marks it", () => {
    const [c] = guideCells(ROWS[1].programs, at(20), at(23));
    expect(c.colStart).toBe(2);
    expect(c.colEnd).toBe(17);
    expect(c.began).toBe(true);
  });
  it("leaves out programs outside the window", () => {
    expect(guideCells([{ id: "x", title: "x", start: at(18), end: at(19) }], at(20), at(23))).toEqual([]);
  });
  it("has a head cell per half hour", () => {
    expect(guideSlots(at(20), at(23))).toHaveLength(6);
  });
});

describe("GuideGrid", () => {
  it("says Live in red text, never with the tally, and marks the listed start", () => {
    const { container } = render(<GuideGrid rows={ROWS} from={at(20)} to={at(23)} now={at(20, 42)} timeZone={TZ} />);
    expect(container.querySelector(".oc-live-text")?.textContent).toBe("Live");
    expect(container.querySelector(".oc-tally")).toBeNull();
    expect(container.textContent).toContain("Began 7:00, listed");
    expect(container.textContent).toContain("8:00 pm");
    expect(container.querySelector(".oc-now-line")?.textContent).toBe("8:42");
    expect(container.querySelector(".oc-guide__p--cont")).not.toBeNull();
  });
  it("places the now line at the time's share of the window", () => {
    const { container } = render(<GuideGrid rows={ROWS} from={at(20)} to={at(23)} now={at(20, 42)} timeZone={TZ} />);
    const left = (container.querySelector(".oc-now-line") as HTMLElement).style.left;
    expect(left).toContain("0.2333");
  });
  it("opens a listing from a cell", () => {
    const onSelect = vi.fn();
    const { getByText } = render(<GuideGrid rows={ROWS} from={at(20)} to={at(23)} onSelect={onSelect} />);
    fireEvent.click(getByText("Planning Commission"));
    expect(onSelect).toHaveBeenCalledWith(ROWS[0].programs[1], ROWS[0]);
  });
});
