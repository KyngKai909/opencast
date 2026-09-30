import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { StatRow } from "./StatRow";
import { KeyValueList } from "./KeyValueList";
import { Timeline } from "./Timeline";
import { StepRail } from "./StepRail";
import { PermissionsTable } from "./PermissionsTable";
import { LineChart, hourTicks, niceStep, niceTop } from "./LineChart";
import { BalanceBar, balanceShares } from "./BalanceBar";
import { BalanceChip } from "./BalanceChip";
import { Checks, checksSummary, type Check } from "./Checks";
import { Funnel, funnelPercents } from "./FunnelRow";
import { SplitBar, splitShares } from "./SplitBar";
import { Runway, runwayDays } from "./Runway";
import { PromiseList } from "./PromiseList";
import { Sparkbars, sparkPeak } from "./Sparkbars";

const TZ = "America/Los_Angeles";
const sat = (min: number) => new Date(Date.parse("2026-09-26T18:00:00-07:00") + min * 60_000);

describe("StatRow", () => {
  it("writes amounts with money() and keeps undecided money at $0.00 with Not set yet", () => {
    const { container } = render(
      <StatRow stats={[{ amount: 412_500_000, caption: "Available", dot: "ink" }, { notSetYet: true, caption: "The pool" }]} />
    );
    const values = Array.from(container.querySelectorAll(".oc-stats__value")).map((e) => e.textContent);
    expect(values).toEqual(["$412.50", "$0.00"]);
    expect(container.querySelector(".oc-stats__open")?.textContent).toBe("Not set yet");
    expect((container.firstChild as HTMLElement).style.getPropertyValue("--oc-stats-n")).toBe("2");
  });
});

describe("KeyValueList", () => {
  it("rows: signs money in, reads money out and undecided lines quietly, marks the total", () => {
    const { container } = render(
      <KeyValueList
        variant="rows"
        items={[
          { title: "Added", amount: 500_000_000, sign: true },
          { title: "Programs you carry", amount: -2_500_000 },
          { title: "The pool", notSetYet: true },
          { title: "September so far", amount: 2_112_900_000, total: true }
        ]}
      />
    );
    const m = Array.from(container.querySelectorAll(".oc-kvrows__m"));
    expect(m.map((e) => e.textContent)).toEqual(["+$500.00", "−$2.50", "$0.00", "$2,112.90"]);
    expect(m[1].className).toContain("--quiet");
    expect(m[2].className).toContain("--quiet");
    expect(container.textContent).toContain("Not set yet");
    expect(container.querySelector(".oc-kvrows__row--total")?.textContent).toContain("September so far");
  });

  it("pairs are a description list", () => {
    const { container } = render(<KeyValueList items={[{ label: "Arrives", value: "1 to 2 business days, no fee" }]} />);
    expect(container.querySelector("dl dt")?.textContent).toBe("Arrives");
    expect(container.querySelector("dl dd")?.textContent).toBe("1 to 2 business days, no fee");
  });
});

describe("Timeline and StepRail", () => {
  it("marks the current step and says done and not yet in words", () => {
    const { container } = render(
      <Timeline
        items={[
          { state: "done", when: "Aug 19", title: "Claim received" },
          { state: "current", when: "By October 5", title: "BEAT answers" },
          { state: "future", when: "If no answer", title: "Removed" }
        ]}
      />
    );
    const items = container.querySelectorAll("li");
    expect(items[0].textContent).toContain("Done: ");
    expect(items[1].getAttribute("aria-current")).toBe("step");
    expect(items[2].textContent).toContain("Not yet: ");
  });

  it("numbers the steps and checks the done ones", () => {
    const { container } = render(
      <StepRail
        label="Setting up BEAT"
        hint="Each step saves as you go."
        steps={[
          { label: "Your station", state: "done" },
          { label: "Library", state: "current" },
          { label: "Sign on", state: "todo" }
        ]}
      />
    );
    const ns = container.querySelectorAll(".oc-steps__n");
    expect(ns[0].querySelector("svg")).not.toBeNull();
    expect(ns[1].textContent).toBe("2");
    expect(container.querySelector("[aria-current=step]")?.textContent).toContain("Library");
    expect(container.querySelector(".oc-steps__hint")?.textContent).toBe("Each step saves as you go.");
    const row = render(<StepRail variant="row" label="Order" steps={[{ label: "Asked", state: "done" }, { label: "Quoted", state: "current" }]} />);
    expect(row.container.querySelectorAll(".oc-steprow__n")[1].textContent).toBe("2");
  });
});

describe("PermissionsTable", () => {
  it("answers in words: Yes, No, or the partial answer", () => {
    const { container } = render(
      <PermissionsTable caption="What each role can do" roles={["Owner", "Operator", "Host"]} abilities={[{ label: "Earnings", can: [true, "See only", false] }]} />
    );
    const cells = Array.from(container.querySelectorAll("tbody td")).map((c) => [c.textContent, c.className]);
    expect(cells).toEqual([
      ["Yes", "oc-perm__yes"],
      ["See only", "oc-perm__no"],
      ["No", "oc-perm__no"]
    ]);
    expect(container.querySelector("tbody th[scope=row]")?.textContent).toBe("Earnings");
    expect(container.querySelector("caption")?.textContent).toBe("What each role can do");
  });
});

describe("LineChart", () => {
  it("picks round value steps with headroom", () => {
    expect(niceStep(410)).toBe(100);
    expect(niceTop(410)).toBe(450);
    expect(niceStep(38)).toBe(10);
    expect(niceStep(0)).toBe(1);
    expect(niceTop(0)).toBe(1.5);
  });

  it("labels hours on the 12-hour clock, saying am/pm only when it changes", () => {
    const t = hourTicks(sat(0), sat(300), 1, TZ).map((x) => x.text);
    expect(t).toEqual(["6 pm", "7", "8", "9", "10", "11"]);
    const late = hourTicks(sat(300), sat(480), 1, TZ).map((x) => x.text);
    expect(late).toEqual(["11 pm", "12 am", "1", "2"]);
  });

  it("marks now, keeps the comparison optional, and gives screen readers the numbers", () => {
    const series = [
      { at: sat(0), value: 120 },
      { at: sat(162), value: 312 }
    ];
    const { container, rerender } = render(
      <LineChart label="Tuned in" from={sat(0)} to={sat(300)} series={series} comparison={[{ at: sat(0), value: 110 }, { at: sat(300), value: 240 }]} breaks={[{ start: sat(118), end: sat(120) }]} timeZone={TZ} />
    );
    expect(container.querySelector(".oc-chart__label")?.textContent).toBe("312 now");
    expect(container.querySelector(".oc-chart__prev")).not.toBeNull();
    expect(container.querySelectorAll(".oc-chart__band")).toHaveLength(1);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("Tuned in");
    const rows = Array.from(container.querySelectorAll("table tbody tr")).map((r) => r.textContent);
    expect(rows).toEqual(["6:00 pm120110", "8:42 pm312", "11:00 pm240"]);
    expect(container.querySelector("table tfoot")?.textContent).toBe("Breaks7:58 to 8:00 pm");

    rerender(<LineChart label="Tuned in" from={sat(0)} to={sat(300)} series={series} timeZone={TZ} />);
    expect(container.querySelector(".oc-chart__prev")).toBeNull();
    expect(container.querySelector(".oc-chart__legend")?.textContent).toBe("Tonight");
  });

  it("compact drops the axis words and the now words", () => {
    const { container } = render(<LineChart compact label="Tuned in" from={sat(0)} to={sat(300)} series={[{ at: sat(0), value: 1 }, { at: sat(10), value: 2 }]} />);
    expect(container.querySelectorAll(".oc-chart__axis")).toHaveLength(0);
    expect(container.querySelector(".oc-chart__label")).toBeNull();
    expect(container.querySelector(".oc-chart__nowdot")).not.toBeNull();
  });
});

describe("Balance, funnel, split, runway", () => {
  it("measures the balance bar and reads it out", () => {
    expect(balanceShares([{ tone: "available", label: "", amount: 3 }, { tone: "held", label: "", amount: 1 }])).toEqual([75, 25]);
    expect(balanceShares([{ tone: "available", label: "", amount: 0 }])).toEqual([0]);
    const { container } = render(
      <BalanceBar legend segments={[{ tone: "available", label: "Available", amount: 412_500_000 }, { tone: "held", label: "Held", amount: 14_200_000 }]} />
    );
    expect(container.querySelector(".oc-balbar")?.getAttribute("aria-label")).toBe("Available $412.50, Held $14.20");
    expect(container.querySelector(".oc-balbar__legend")?.textContent).toContain("Held $14.20");
  });

  it("the header chip", () => {
    const { container } = render(<BalanceChip amount={412_500_000} />);
    expect(container.textContent).toBe("Available $412.50");
  });

  it("funnel bars measure against the largest step, tones go line to ink", () => {
    expect(funnelPercents([{ count: 214 }, { count: 61 }, { count: 31 }])).toEqual([100, 29, 14]);
    const { container } = render(<Funnel steps={[{ title: "Scanned", count: 214 }, { title: "Saved", count: 61 }, { title: "Used", count: 31 }]} />);
    const fills = Array.from(container.querySelectorAll(".oc-funnel__bar i")).map((i) => i.className);
    expect(fills).toEqual(["oc-funnel__fill--line", "oc-funnel__fill--ink-70", "oc-funnel__fill--ink"]);
    expect(container.querySelector(".oc-funnel__count")?.textContent).toBe("214");
  });

  it("split shares are parts of the whole", () => {
    expect(splitShares([{ amount: 38 }, { amount: 80 }])).toEqual([32, 68]);
    const { container } = render(<SplitBar variant="stacked" label="Phones 44%" parts={[{ label: "Phones", amount: 44 }]} />);
    expect(container.querySelector("[role=img]")?.getAttribute("aria-label")).toBe("Phones 44%");
  });

  it("runway speaks in days", () => {
    expect(runwayDays(44.7)).toBe("about 44 days");
    expect(runwayDays(1)).toBe("about 1 day");
    expect(runwayDays(-3)).toBe("about 0 days");
    const { container } = render(<Runway perDay={9_200_000} days={44} autoTopUp={false} />);
    expect(container.textContent).toBe("At this month's pace, about $9.20 a day, what's available covers about 44 days of airings. Auto top-up is off.");
  });
});

describe("Checks and the promise", () => {
  const items: Check[] = [
    { state: "fine", title: "Length" },
    { state: "fine", title: "Picture" },
    { state: "fixed", title: "Loudness levelled" },
    { state: "attention", title: "Phone number outside title safe" }
  ];
  it("summarises fine, fixed and for you, leaving out zeros", () => {
    expect(checksSummary(items)).toBe("2 fine, 1 fixed, 1 for you");
    expect(checksSummary(items.slice(0, 2))).toBe("2 fine");
  });
  it("says each state in words", () => {
    const { container } = render(<Checks variant="upload" label="Checks" items={items} />);
    const spoken = Array.from(container.querySelectorAll(".oc-sr-only")).map((e) => e.textContent);
    expect(spoken).toEqual(["Fine: ", "Fine: ", "Fixed: ", "For you: "]);
    expect(container.querySelector(".oc-uchecks__item--attention .oc-uchecks__mark")?.textContent).toBe("!");
  });
  it("numbers the promise as a list", () => {
    const { container } = render(<PromiseList title="What happens to your money" lines={[{ lead: "It sits in your balance.", rest: "Nothing is spent by adding it." }]} />);
    expect(container.querySelector("h3")?.textContent).toBe("What happens to your money");
    expect(container.querySelector("li")?.textContent).toBe("It sits in your balance. Nothing is spent by adding it.");
  });
});

describe("Sparkbars", () => {
  it("draws a bar a step, the busiest in ink, and says what it shows in its caption", () => {
    const { container, getByRole } = render(<Sparkbars values={[0, 2, 7, 3, 0]} caption="Most left around 9:24 pm" />);
    expect(container.querySelectorAll("rect")).toHaveLength(5);
    expect(container.querySelectorAll(".oc-sparkbars__peak")).toHaveLength(1);
    expect(container.querySelector("rect:nth-child(3)")?.getAttribute("class")).toBe("oc-sparkbars__peak");
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(getByRole("figure").textContent).toBe("Most left around 9:24 pm");
  });

  it("finds the busiest step, the first of a tie, and none when nobody left", () => {
    expect(sparkPeak([0, 4, 4, 1])).toBe(1);
    expect(sparkPeak([0, 0, 0])).toBeNull();
    expect(sparkPeak([])).toBeNull();
  });
});
