import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BandScale, bandPosition, bandStep } from "./BandScale";

afterEach(cleanup);

const STATIONS = [
  { frequency: 88.3, callSign: "NITE", colour: "#33507A" },
  { frequency: 90.7, callSign: "HALL", colour: "#56508A" },
  { frequency: 101.9, callSign: "CRAT", colour: "#7E2F35" },
  { frequency: 104.3, callSign: "VOZE", colour: "#1D6A70" }
];

describe("BandScale", () => {
  it("places frequencies along 88 to 108", () => {
    expect(bandPosition(88)).toBe(0);
    expect(bandPosition(108)).toBe(100);
    expect(bandPosition(88.3)).toBeCloseTo(1.5);
    expect(bandPosition(98)).toBe(50);
  });
  it("steps along the band, wrapping at the ends", () => {
    expect(bandStep(STATIONS, 88.3, 1)).toBe(90.7);
    expect(bandStep(STATIONS, 104.3, 1)).toBe(88.3);
    expect(bandStep(STATIONS, 88.3, -1)).toBe(104.3);
    expect(bandStep(STATIONS, undefined, 1)).toBe(88.3);
  });
  it("tunes from a mark and from the arrow keys", () => {
    const onTune = vi.fn();
    const { getByLabelText } = render(<BandScale stations={STATIONS} tuned={88.3} onTune={onTune} />);
    fireEvent.click(getByLabelText("CRAT 101.9"));
    expect(onTune).toHaveBeenLastCalledWith(101.9);
    fireEvent.keyDown(getByLabelText("NITE 88.3"), { key: "ArrowRight" });
    expect(onTune).toHaveBeenLastCalledWith(90.7);
    fireEvent.keyDown(getByLabelText("NITE 88.3"), { key: "ArrowLeft" });
    expect(onTune).toHaveBeenLastCalledWith(104.3);
  });
  it("draws the needle only when tuned to the band", () => {
    expect(render(<BandScale stations={STATIONS} tuned={88.3} />).container.querySelector(".oc-band-scale__needle")).not.toBeNull();
    expect(render(<BandScale stations={STATIONS} />).container.querySelector(".oc-band-scale__needle")).toBeNull();
  });
  it("scrolls the phone scale to keep the needle in view", () => {
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    const client = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 640 });
    Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get: () => 358 });
    try {
      const { container } = render(<BandScale stations={STATIONS} tuned={104.3} scroll />);
      const scroller = container.querySelector(".oc-band-scroll") as HTMLElement;
      // 104.3 sits at 81.5% of 640px = 521.6px; centred in 358px.
      expect(scroller.scrollLeft).toBeCloseTo(521.6 - 179, 0);
    } finally {
      if (width) Object.defineProperty(HTMLElement.prototype, "offsetWidth", width);
      if (client) Object.defineProperty(Element.prototype, "clientWidth", client);
    }
  });
});
