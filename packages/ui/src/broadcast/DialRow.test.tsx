import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { DialRow } from "./DialRow";

afterEach(cleanup);

const TZ = "America/Los_Angeles";
const at = (h: number, m = 0) => new Date(Date.parse("2026-09-26T00:00:00-07:00") + (h * 60 + m) * 60_000);
const BEAT = { channel: "12.1", callSign: "BEAT", name: "Inland Beat", colour: "#8C3B7A" };

describe("DialRow", () => {
  it("tunes on a click anywhere in the row", () => {
    const onTune = vi.fn();
    const onOpenStation = vi.fn();
    const { container } = render(<DialRow station={BEAT} now={{ title: "Saturday Reel", until: at(21) }} onTune={onTune} onOpenStation={onOpenStation} timeZone={TZ} />);
    fireEvent.click(container.querySelector(".oc-dial-row__nx")!);
    fireEvent.click(container.querySelector(".oc-dial-row__tune")!);
    expect(onTune).toHaveBeenCalledTimes(2);
    expect(onOpenStation).not.toHaveBeenCalled();
  });

  it("opens the station preview from the ident, without tuning", () => {
    const onTune = vi.fn();
    const onOpenStation = vi.fn();
    const { getByLabelText } = render(<DialRow station={BEAT} now={{ title: "Saturday Reel" }} onTune={onTune} onOpenStation={onOpenStation} />);
    fireEvent.click(getByLabelText("BEAT 12.1, Inland Beat: station preview"));
    expect(onOpenStation).toHaveBeenCalledTimes(1);
    expect(onTune).not.toHaveBeenCalled();
  });

  it("says live, listed, carried and off air in words", () => {
    const live = render(<DialRow station={BEAT} now={{ title: "Beat Tape Live", live: true, until: at(22) }} timeZone={TZ} />);
    expect(live.container.textContent).toContain("Live");
    expect(live.container.textContent).toContain("Until 10:00 pm");
    const listed = render(<DialRow station={BEAT} now={{ title: "City Council", listed: true }} />);
    expect(listed.container.querySelector(".oc-tag--listed")?.textContent).toBe("Listed");
    const carried = render(<DialRow station={BEAT} now={{ title: "Saturday Reel", carriedFrom: "REEL", until: at(21) }} variant="phone" timeZone={TZ} />);
    expect(carried.container.textContent).toContain("From REEL, until 9:00 pm");
    const off = render(<DialRow station={BEAT} now={{ title: "", offAir: true, until: at(30) }} timeZone={TZ} />);
    expect(off.container.textContent).toContain("Off air");
    expect(off.container.textContent).toContain("Signs on again at 6:00 am");
  });

  it("drops am/pm on Next when it's the same half of the day", () => {
    const { container } = render(<DialRow station={BEAT} now={{ title: "Saturday Reel" }} next={{ at: at(21), title: "Beat Tape Live" }} at={at(20, 42)} timeZone={TZ} />);
    expect(container.querySelector(".oc-dial-row__nx .oc-mono")?.textContent).toBe("9:00");
  });

  it("draws the tally edge on the band list's station you're on, and nowhere else", () => {
    const band = render(<DialRow variant="band" station={BEAT} now={{ title: "x" }} watching onTune={() => undefined} />);
    expect(band.container.querySelector(".oc-dial-row--watching")).not.toBeNull();
    expect(band.container.querySelector(".oc-tally")).toBeNull();
    const web = render(<DialRow station={BEAT} now={{ title: "x" }} watching />);
    expect(web.container.querySelector(".oc-dial-row--watching")).toBeNull();
  });
});
