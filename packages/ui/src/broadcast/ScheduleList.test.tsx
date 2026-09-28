import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ScheduleList, scheduleStatus, type ScheduleItem } from "./ScheduleList";

afterEach(cleanup);

const TZ = "America/Los_Angeles";
const at = (h: number, m = 0) => new Date(Date.parse("2026-09-26T00:00:00-07:00") + (h * 60 + m) * 60_000);
const ITEMS: ScheduleItem[] = [
  { id: "a", start: at(18), end: at(20), title: "Crate Session 02" },
  { id: "b", start: at(20), title: "Late Crate, ep. 14" },
  { id: "c", start: at(20, 30), title: "Saturday Reel" },
  { id: "d", start: at(21), title: "Beat Tape Live" },
  { id: "e", start: at(24), end: at(26), title: "Late Crate, eps. 12 to 15" }
];

describe("ScheduleList", () => {
  it("works out past, now and next from the time", () => {
    expect(scheduleStatus(ITEMS, at(20, 42))).toEqual(["past", "past", "now", "next", "next"]);
    expect(scheduleStatus(ITEMS)).toEqual(["next", "next", "next", "next", "next"]);
  });
  it("puts the tally edge on the row on now", () => {
    const { container } = render(<ScheduleList items={ITEMS} now={at(20, 42)} timeZone={TZ} />);
    const now = container.querySelector(".oc-sch--now")!;
    expect(now.textContent).toContain("Saturday Reel");
    expect(now.getAttribute("aria-current")).toBe("true");
    expect(container.querySelectorAll(".oc-sch--past")).toHaveLength(2);
  });
  it("writes the week's times with am/pm where it changes", () => {
    const { container } = render(<ScheduleList items={ITEMS} variant="week" timeZone={TZ} />);
    const times = [...container.querySelectorAll(".oc-mono")].map((e) => e.textContent);
    expect(times).toEqual(["6:00 pm", "8:00", "8:30", "9:00", "12:00 am"]);
  });
  it("offers a reminder on later rows only", () => {
    const onRemind = vi.fn();
    const { getAllByLabelText } = render(<ScheduleList items={ITEMS} now={at(20, 42)} variant="week" onRemind={onRemind} timeZone={TZ} />);
    const bells = getAllByLabelText("Remind me");
    expect(bells).toHaveLength(2);
    fireEvent.click(bells[0]);
    expect(onRemind).toHaveBeenCalledWith(ITEMS[3]);
  });
});
