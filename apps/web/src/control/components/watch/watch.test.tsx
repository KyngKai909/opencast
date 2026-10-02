// Watch data's pieces in master control (follow-up Phase 1): the words, and one airing's cell on
// the Audience page in each state (shown with its tune-away line and sentence, counting, not
// enough viewers, radio's listening time).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AiringWatch } from "@opencast/contracts";
import { TuneAwayLine, WatchTime } from "./WatchCell";
import { makerRowDetail, lastThirtyDays } from "./ProgramWatch";
import { busiestMinute, mostLeftText, notCountedText, notForMeText, timeLabelWord, watchPhoneText, watchStateText, watchTimeText } from "./words";

const TZ = "America/Los_Angeles";
const blank = { watchMinutes: null, audienceAtStart: null, peakAudience: null, audienceAtEnd: null, stayedToTheEnd: null, tuneAways: null, notForMe: null };
const shown = (o: Partial<AiringWatch> = {}): AiringWatch => ({
  status: "shown",
  note: null,
  timeLabel: "watch_time",
  watchMinutes: 1240,
  audienceAtStart: 240,
  peakAudience: 301,
  audienceAtEnd: 226,
  stayedToTheEnd: 79,
  tuneAways: [0, 3, 2, 9, 4, 1],
  notForMe: 0,
  ...o
});

describe("the words", () => {
  it("names the column watch time, or listening time on the radio band", () => {
    expect(timeLabelWord("watch_time")).toBe("Watch time");
    expect(timeLabelWord("listening_time")).toBe("Listening time");
  });

  it("says watch time in minutes, then hours", () => {
    expect(watchTimeText(48)).toBe("48 min");
    expect(watchTimeText(60)).toBe("1 hour");
    expect(watchTimeText(90)).toBe("1.5 hours");
    expect(watchTimeText(1240)).toBe("21 hours");
    expect(watchTimeText(72_300)).toBe("1,205 hours");
  });

  it("says where most left: a clock time for one airing, minutes in for airings added up", () => {
    const start = "2026-09-27T04:20:00.000Z"; // 9:20 pm in the Inland Empire
    expect(busiestMinute([0, 3, 2, 9, 4, 9])).toBe(3);
    expect(mostLeftText([0, 3, 2, 9, 4], { startsAt: start, timeZone: TZ })).toBe("Most left around 9:23 pm");
    expect(mostLeftText([0, 3, 2, 9, 4])).toBe("Most left 3 minutes in");
    expect(mostLeftText([0, 5, 1])).toBe("Most left a minute in");
    expect(mostLeftText([0, 0, 0], { startsAt: start, timeZone: TZ })).toBe("Nobody left before the end");
  });

  it("counts votes, states and airings left out", () => {
    expect(notForMeText(0)).toBeNull();
    expect(notForMeText(4)).toBe("4 said “Not for me”");
    expect(watchStateText({ status: "counting", note: null })).toBe("Counting…");
    expect(watchStateText({ status: "not_enough_viewers", note: "Not enough viewers yet" })).toBe("Not enough viewers yet");
    expect(watchStateText({ status: "shown", note: null })).toBeNull();
    expect(watchPhoneText(shown())).toBe("21 hours watched");
    expect(watchPhoneText(shown({ timeLabel: "listening_time", watchMinutes: 45 }))).toBe("45 min listened");
    expect(notCountedText(0)).toBeNull();
    expect(notCountedText(1)).toBe("1 airing not counted yet");
    expect(notCountedText(3)).toBe("3 airings not counted yet");
  });

  it("the maker's rows: totals across stations, never a station", () => {
    expect(makerRowDetail({ band: "tv", status: "shown", airings: 34, stations: 2 })).toBe("34 airings on 2 stations");
    expect(makerRowDetail({ band: "radio", status: "shown", airings: 27, stations: 1 })).toBe("Radio band, 27 airings on 1 station");
    expect(makerRowDetail({ band: "tv", status: "not_enough_viewers", airings: 0, stations: 0 })).toBe("");
    const w = lastThirtyDays(new Date("2026-09-27T03:42:12Z"));
    expect(w).toEqual({ from: "2026-08-28T03:00:00.000Z", to: "2026-09-27T03:00:00.000Z" });
  });
});

describe("an airing's watch data on the Audience page", () => {
  const cell = (w: AiringWatch | undefined, startsAt: string | null = null) =>
    render(
      <>
        <WatchTime watch={w} />
        <TuneAwayLine watch={w} startsAt={startsAt} timeZone={TZ} />
      </>
    );

  it("shown: its watch time, and the tune-away line whose sentence is its text", () => {
    const { container } = cell(shown({ notForMe: 2 }), "2026-09-27T04:20:00.000Z");
    expect(screen.getByText("21 hours")).toBeTruthy();
    expect(container.querySelectorAll("rect")).toHaveLength(6);
    const figure = screen.getByRole("figure");
    expect(figure.textContent).toBe("Most left around 9:23 pm2 said “Not for me”");
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("counting while it's on or being worked out", () => {
    cell({ status: "counting", note: null, timeLabel: "watch_time", ...blank });
    expect(screen.getByText("Counting…")).toBeTruthy();
    expect(screen.queryByRole("figure")).toBeNull();
  });

  it("not enough viewers yet, and no numbers", () => {
    cell({ status: "not_enough_viewers", note: "Not enough viewers yet", timeLabel: "listening_time", ...blank });
    expect(screen.getByText("Not enough viewers yet")).toBeTruthy();
    expect(screen.queryByRole("figure")).toBeNull();
  });

  it("a row the API has no watch data for says nothing", () => {
    cell(undefined);
    expect(screen.getByText("–")).toBeTruthy();
    expect(screen.queryByRole("figure")).toBeNull();
  });
});
