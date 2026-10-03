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
    expect(container.textContent).toContain("Began 7:00, external");
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

describe("external stations (follow-up Phase 6)", () => {
  it("carry the dashed External tag under their channel, and nowhere else", () => {
    const rows: GuideStation[] = [{ ...ROWS[1], external: true }, ROWS[0]];
    const { container } = render(<GuideGrid rows={rows} from={at(20)} to={at(23)} now={at(20, 42)} timeZone={TZ} />);
    const tags = container.querySelectorAll(".oc-guide__st .oc-tag--listed");
    expect([...tags].map((t) => t.textContent)).toEqual(["External"]);
    expect(tags[0].closest(".oc-guide__row")?.getAttribute("aria-label")).toBe("RDLS 9.1");
  });
});

// A229: a call sign shared on one channel's subchannels: each row names its own stream.
describe("a shared call sign", () => {
  it("shows each stream's name under its call sign and channel", () => {
    const rows: GuideStation[] = [
      { id: "r1", channel: "15.1", callSign: "RIVC", name: "Riverside County, Board of Supervisors", external: true, programs: [] },
      { id: "r2", channel: "15.2", callSign: "RIVC", name: "Riverside County, Public Works", external: true, programs: [] }
    ];
    const { getByRole, getByText } = render(<GuideGrid rows={rows} from={at(20)} to={at(22)} now={at(20, 42)} timeZone={TZ} />);
    expect(getByRole("group", { name: "RIVC 15.2, Riverside County, Public Works" })).toBeTruthy();
    expect(getByText("Riverside County, Board of Supervisors")).toBeTruthy();
  });
});

// A244: a programming block's band above a row's programs.
describe("programming block bands", () => {
  const withBlock: GuideStation = { ...ROWS[0], blocks: [{ id: "lcn", name: "Late Crate Nights", start: at(19, 30), end: at(22), colour: "#1F5C99" }] };

  it("are placed as the programs are, clipped to the window, with the leading marker when they began earlier", () => {
    const { container } = render(<GuideGrid rows={[withBlock, ROWS[1]]} from={at(20)} to={at(23)} timeZone={TZ} />);
    const band = container.querySelector(".oc-guide__band") as HTMLElement;
    expect(band.style.gridColumn).toBe("2 / 26");
    expect(band.classList.contains("oc-guide__band--cont")).toBe(true);
    expect(band.getAttribute("aria-label")).toBe("Late Crate Nights, 7:30 pm to 10:00 pm");
    expect(band.getAttribute("role")).toBe("note");
    expect(band.tagName).toBe("DIV");
    // Only rows with a block get the strip.
    expect(container.querySelectorAll(".oc-guide__row--blocks")).toHaveLength(1);
  });

  it("are left out of the compact variant, and of rows whose blocks are outside the window", () => {
    expect(render(<GuideGrid rows={[withBlock]} from={at(20)} to={at(23)} variant="compact" />).container.querySelector(".oc-guide__band")).toBeNull();
    cleanup();
    expect(render(<GuideGrid rows={[{ ...withBlock, blocks: [{ id: "x", name: "Earlier", start: at(17), end: at(19) }] }]} from={at(20)} to={at(23)} />).container.querySelector(".oc-guide__row--blocks")).toBeNull();
  });
});

describe("the swipe home's guide (A245)", () => {
  it("heads each part of the order, tints the station being watched, and tunes from a station's column", () => {
    const onTune = vi.fn();
    const rows: GuideStation[] = [{ ...ROWS[1], section: "Your presets" }, { ...ROWS[0], section: "The dial" }];
    const { getByRole, getAllByRole, container } = render(<GuideGrid rows={rows} from={at(20)} to={at(23)} tunedId="rdls" onTune={onTune} />);
    expect(getAllByRole("heading").map((h) => h.textContent)).toEqual(["Your presets", "The dial"]);
    expect(container.querySelector(".oc-guide__row--tuned")?.getAttribute("aria-label")).toBe("RDLS 9.1");
    fireEvent.click(getByRole("button", { name: "Tune in to CIVC 7.1" }));
    expect(onTune).toHaveBeenCalledWith(rows[1]);
  });
});
