import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ScrubBar } from "./ScrubBar";
import { ProgressBar } from "./ProgressBar";
import { Slate } from "./Slate";
import { BreakBar } from "./BreakBar";
import { PresetKeys } from "./PresetKeys";
import { StationBand } from "./StationBand";
import { CodeSelect } from "./CodeSelect";
import { LogTimeline, placeBlocks, type TimelineBlock } from "./LogTimeline";
import { Rundown } from "./Rundown";

afterEach(cleanup);

const TZ = "America/Los_Angeles";
const at = (h: number, m = 0) => new Date(Date.parse("2026-09-26T00:00:00-07:00") + (h * 60 + m) * 60_000);

describe("ScrubBar", () => {
  it("seeks with the arrow keys, Home and End, within the piece", () => {
    const onSeek = vi.fn();
    const { getByRole } = render(<ScrubBar position={6000} length={15000} onSeek={onSeek} step={1000} />);
    const s = getByRole("slider");
    expect(s.getAttribute("aria-valuetext")).toBe(":06 of :15");
    fireEvent.keyDown(s, { key: "ArrowRight" });
    expect(onSeek).toHaveBeenLastCalledWith(7000);
    fireEvent.keyDown(s, { key: "Home" });
    expect(onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(s, { key: "End" });
    expect(onSeek).toHaveBeenLastCalledWith(15000);
  });
  it("labels play and pause", () => {
    const onPlayPause = vi.fn();
    const { getByLabelText, rerender } = render(<ScrubBar position={0} length={1000} onPlayPause={onPlayPause} />);
    fireEvent.click(getByLabelText("Play"));
    expect(onPlayPause).toHaveBeenCalled();
    rerender(<ScrubBar position={0} length={1000} playing />);
    expect(getByLabelText("Pause")).toBeTruthy();
  });
});

describe("ProgressBar", () => {
  it("shows start, end and time left, and isn't seekable", () => {
    const { container, getByRole } = render(<ProgressBar start={at(20, 30)} end={at(21)} now={at(20, 42)} timeZone={TZ} />);
    expect(container.textContent).toBe("8:309:0018 min left");
    const bar = getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(container.querySelector("[role=slider]")).toBeNull();
  });
  it("has the station page's text form", () => {
    const { container } = render(<ProgressBar start={at(20, 30)} end={at(21)} now={at(20, 42)} timeZone={TZ} size="text" />);
    expect(container.textContent).toBe("8:30 – 9:00 pm, 18 min left");
  });
});

describe("Slate", () => {
  it("counts down to dead air and keeps the tally lit", () => {
    const { container } = render(<Slate kind="dead-air" deadAirAt={at(23, 40)} now={at(23, 28)} />);
    expect(container.textContent).toContain("Dead air in 12 min");
    expect(container.querySelector(".oc-tally--lit")).not.toBeNull();
  });
  it("gives stand by its bars and radio its frequency", () => {
    expect(render(<Slate kind="standby" />).container.querySelector(".oc-bars")).not.toBeNull();
    const radio = render(<Slate kind="radio" frequency="88.3" callSign="NITE" name="Night Desk" />);
    expect(radio.container.textContent).toContain("88.3NITE, Night Desk");
  });
});

describe("BreakBar", () => {
  it("draws each part to length and says it in words", () => {
    const { getByRole } = render(<BreakBar barterOwner="REEL" parts={[{ kind: "barter", length: 60_000 }, { kind: "open", length: 30_000 }, { kind: "added", length: 30_000 }]} />);
    const bar = getByRole("img");
    expect(bar.getAttribute("aria-label")).toBe("REEL's, under barter 1:00, Open :30, Just added :30");
    expect((bar.children[0] as HTMLElement).style.width).toBe("50%");
  });
});

describe("PresetKeys", () => {
  it("tunes a key and marks the one playing", () => {
    const onTune = vi.fn();
    const { container, getByText } = render(<PresetKeys keys={[{ key: 1, channel: "12.1", callSign: "BEAT", now: "Saturday Reel" }, null]} playing={1} onTune={onTune} />);
    expect(container.querySelector(".oc-pre--on")?.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(getByText("BEAT"));
    expect(onTune).toHaveBeenCalledWith(1);
    expect(container.querySelectorAll(".oc-pre--empty")).toHaveLength(5);
  });
  it("shows the empty line only when nothing is saved", () => {
    expect(render(<PresetKeys keys={[]} />).container.textContent).toContain("Tune in to a station and press Add to presets.");
    const onAdd = vi.fn();
    const strip = render(<PresetKeys keys={[{ key: 1, channel: "12.1", callSign: "BEAT" }]} variant="strip" onAdd={onAdd} />);
    expect(strip.container.textContent).not.toContain("Tune in to a station");
    fireEvent.click(strip.getByLabelText("Preset 2, empty: add"));
    expect(onAdd).toHaveBeenCalledWith(2);
  });
});

describe("StationBand", () => {
  it("marks a colour that can't carry white text", () => {
    const ok = render(<StationBand channel="12.1" callSign="BEAT" colour="#8C3B7A" />);
    expect(ok.container.firstElementChild?.getAttribute("data-contrast")).toBeNull();
    const bad = render(<StationBand channel="12.1" callSign="BEAT" colour="#E9A93A" />);
    expect(bad.container.firstElementChild?.getAttribute("data-contrast")).toBe("fails");
  });
});

describe("CodeSelect", () => {
  it("is a real select that reports the new code", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<CodeSelect value="PGM" onChange={onChange} />);
    fireEvent.change(getByLabelText("Type"), { target: { value: "SPT" } });
    expect(onChange).toHaveBeenCalledWith("SPT");
  });
});

describe("LogTimeline", () => {
  const blocks: TimelineBlock[] = [
    { id: "p", kind: "pgm", start: at(18), end: at(20), title: "Crate Session 02" },
    { id: "b", kind: "brk", start: at(20), end: at(20, 2) },
    { id: "d", kind: "dead", start: at(23, 40), end: at(26) }
  ];
  it("places blocks by time, as the reference draws them", () => {
    const [p, b, d] = placeBlocks(blocks, at(18), 1.12);
    expect(p.top).toBeCloseTo(1);
    expect(p.height).toBeCloseTo(120 * 1.12 - 2);
    expect(b.top).toBeCloseTo(120 * 1.12 - 2);
    expect(b.height).toBe(7);
    expect(d.top).toBeCloseTo(340 * 1.12);
    expect(d.height).toBeCloseTo(140 * 1.12);
  });
  it("names dead air with its span and labels the hours", () => {
    const { container } = render(<LogTimeline blocks={blocks} from={at(18)} to={at(26)} timeZone={TZ} />);
    expect(container.querySelector(".oc-blk--dead")?.textContent).toBe("Dead air, 11:40 pm to 2:00 am");
    const hours = [...container.querySelectorAll(".oc-tl__hrs span")].map((s) => s.textContent);
    expect(hours[0]).toBe("6 pm");
    expect(hours[8]).toBe("2 am");
  });
});

describe("Rundown", () => {
  it("writes times to the second and lengths the broadcast way", () => {
    const { container } = render(<Rundown items={[{ id: "a", at: at(20, 30), code: "PGM", title: "Saturday Reel, part 1", length: 14 * 60_000 }]} nowId="a" timeZone={TZ} />);
    expect(container.querySelector(".oc-rd__t")?.textContent).toBe("On air: 8:30:00");
    expect(container.querySelector(".oc-rd__d")?.textContent).toBe("14:00");
    expect(container.querySelector(".oc-rd--now")).not.toBeNull();
  });
});
