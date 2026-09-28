import { describe, expect, it } from "vitest";
import type { TargetMatch } from "@opencast/contracts";
import type { PauseStory, SpotX } from "../../api/ext/spots";
import {
  budgetEstimate,
  budgetShare,
  budgetWords,
  defaultRaise,
  listOrder,
  listStateLabel,
  listWords,
  matchLine,
  parseDollars,
  pauseTimeline,
  phoneDetail,
  raiseDays,
  scaleCost,
  shortStateLabel,
  spotHref,
  spotLine,
  stateLabel,
  stateTag,
  summarizeMatches,
  targetingWords
} from "./format";

const $ = (d: number) => Math.round(d * 1e6);
const station = (callSign: string, channel: string) => ({ id: `00000000-0000-4000-8000-00000000${channel.replace(".", "")}`.slice(0, 36), kind: "station" as const, callSign, handle: null, name: callSign, colour: null, band: "tv" as const, channel, marketSlug: null, homeCity: null });

function spot(o: Partial<SpotX> = {}): SpotX {
  return {
    id: "00000000-0000-4000-8000-000000064001",
    businessId: "00000000-0000-4000-8000-000000060001",
    title: "Fall menu",
    lengthSec: 30,
    category: "Food",
    state: "in_rotation",
    inRotationOn: 3,
    rate: { kind: "per_thousand", micros: $(8), perAiringMaxMicros: null },
    budget: { totalMicros: $(300), dailyCapMicros: null, usedMicros: $(176.4), usedTodayMicros: $(4.6) },
    startsOn: null,
    endsOn: null,
    targeting: { withinMiles: 10, locationIds: [], marketIds: [], stationCategories: [], dayparts: [], excludedStationIds: [] },
    code: { code: "ORANGE10", offer: "10% off", windowDays: 7 },
    file: null,
    productionOrderId: null,
    createdAt: "2026-09-01T17:00:00.000Z",
    inRotationStations: [station("BEAT", "12.1"), station("CIVC", "7.1"), station("SAZN", "18.1")],
    ...o
  };
}

describe("states in the business's words", () => {
  it("fills the number of stations, and says one station", () => {
    expect(stateLabel(spot())).toBe("In rotation on 3 stations");
    expect(stateLabel(spot({ inRotationOn: 1 }))).toBe("In rotation on 1 station");
  });
  it("uses states.ts for the pauses, and the resumed label once it's back", () => {
    expect(stateLabel(spot({ state: "paused_budget" }))).toBe("Paused (budget spent)");
    expect(stateLabel(spot({ state: "paused_daily_cap" }))).toBe("Paused until midnight");
    expect(stateLabel(spot({ state: "listed", back: { backAt: "2026-09-26T03:42:00.000Z", reason: "raised_budget", told: [] } }))).toBe("Back in the market");
    expect(stateLabel(spot({ state: "listed" }))).toBe("Listed");
  });
  it("adds how long review takes in the list, as drawn", () => {
    expect(listStateLabel(spot({ state: "in_review" }))).toBe("In review, usually a few hours");
  });
  it("has the phone's short tags", () => {
    expect(shortStateLabel(spot())).toBe("In rotation");
    expect(shortStateLabel(spot({ state: "paused_daily_cap" }))).toBe("Until midnight");
    expect(shortStateLabel(spot({ state: "in_review" }))).toBe("In review");
    expect(shortStateLabel(spot({ state: "ended" }))).toBe("Ended");
  });
  it("draws running solid, attention amber and review dashed, never by colour alone", () => {
    expect(stateTag("in_rotation")).toBe("solid");
    expect(stateTag("paused_budget")).toBe("standby");
    expect(stateTag("paused_daily_cap")).toBe("standby");
    expect(stateTag("in_review")).toBe("listed");
    expect(stateTag("ended")).toBe("plain");
  });
});

describe("the budget column", () => {
  it("writes the list's amounts as drawn", () => {
    expect(budgetWords(spot())).toBe("$176.40 of $300");
    expect(budgetWords(spot({ budget: { totalMicros: $(200), dailyCapMicros: null, usedMicros: 0, usedTodayMicros: 0 } }))).toBe("$0 of $200");
    expect(budgetWords(spot({ state: "ended", budget: { totalMicros: $(240), dailyCapMicros: null, usedMicros: $(240), usedTodayMicros: 0 } }))).toBe("$240.00 of $240");
  });
  it("shows today's cap when paused until midnight", () => {
    const s = spot({ state: "paused_daily_cap", budget: { totalMicros: $(120), dailyCapMicros: $(4), usedMicros: $(38), usedTodayMicros: $(4) } });
    expect(budgetWords(s)).toBe("$4.00 of $4.00 today");
    expect(budgetShare(s)).toBe(1);
    expect(phoneDetail(s)).toBe("Today's $4.00 is spent");
  });
  it("says where it's in rotation on the phone", () => {
    expect(phoneDetail(spot())).toBe("$176.40 of $300. On BEAT, CIVC, SAZN");
    expect(phoneDetail(spot({ state: "in_review" }))).toBe("Being checked");
    expect(phoneDetail(spot({ state: "ended", endsOn: "2026-08-31" }))).toBe("Ended August 31");
  });
  it("writes the spot's line", () => {
    expect(spotLine(spot())).toBe(":30, code ORANGE10");
    expect(spotLine(spot({ state: "ended", endsOn: "2026-08-31" }))).toBe(":30. Ended August 31");
  });
});

describe("where a spot opens, and the list's order", () => {
  it("sends drafts back to where they stopped and ended spots to their results", () => {
    expect(spotHref("/b", spot({ state: "draft" }))).toBe("/b/spots/00000000-0000-4000-8000-000000064001/setup");
    expect(spotHref("/b", spot({ state: "draft", file: { url: "x", durationMs: 30000, originalFilename: null, checks: [] } }))).toBe("/b/spots/00000000-0000-4000-8000-000000064001/setup/rate");
    expect(spotHref("/b", spot({ state: "ended" }))).toContain("/b/results");
    expect(spotHref("/b", spot())).toBe("/b/spots/00000000-0000-4000-8000-000000064001");
  });
  it("puts ended spots last", () => {
    const list = listOrder([spot({ id: "a", state: "ended" }), spot({ id: "b" }), spot({ id: "c", state: "in_review" })]);
    expect(list.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });
});

describe("estimates", () => {
  const m = (cs: string, low: number, high: number, included = true): TargetMatch => ({
    station: station(cs, "7.1"),
    category: "Food",
    miles: 1,
    included,
    reason: included ? null : "not chosen",
    estimatedCostPerAiringMicros: included ? { low: $(low), high: $(high) } : null
  });
  it("turns the matches into a range an airing", () => {
    const s = summarizeMatches([m("CIVC", 1.52, 3.2), m("BEAT", 1.4, 2.64), m("PREP", 0, 0, false)]);
    expect(s.low).toBe($(1.4));
    expect(s.high).toBe($(3.2));
    expect(s.included).toHaveLength(2);
    expect(s.excluded).toHaveLength(1);
  });
  it("turns a budget and a cap into airings a day and days (the frame's 5 a day for 25 days)", () => {
    expect(budgetEstimate($(300), $(12), $(2.22))).toEqual({ perDay: 5, days: 25, inAll: null });
    expect(budgetEstimate($(300), null, $(2.5))).toEqual({ perDay: null, days: null, inAll: 120 });
    expect(budgetEstimate($(300), $(12), null)).toEqual({ perDay: null, days: null, inAll: null });
  });
  it("scales a saved estimate to the rate being typed", () => {
    const saved = { kind: "per_thousand" as const, micros: $(8), perAiringMaxMicros: null };
    expect(scaleCost($(1.4), saved, { ...saved, micros: $(16) })).toBe($(2.8));
    expect(scaleCost($(1.4), saved, { kind: "per_airing", micros: $(4), perAiringMaxMicros: null })).toBe($(4));
  });
  it("says a raise in days at the spot's pace (the frame's $200 is about 17 days)", () => {
    expect(raiseDays($(200), $(11.7))).toBe(17);
    expect(raiseDays($(200), null)).toBeNull();
  });
  it("offers $200 first, or the most the balance covers", () => {
    expect(defaultRaise($(236.1))).toBe($(200));
    expect(defaultRaise($(150))).toBe($(100));
    expect(defaultRaise($(40))).toBe($(100));
  });
});

describe("targeting words", () => {
  it("says who it's for as the frame does", () => {
    expect(targetingWords({ withinMiles: 10, stationCategories: ["Music", "Food"], dayparts: ["afternoons", "evenings"] }, 5, 4)).toBe("Within 10 mi, these kinds, afternoons and evenings");
    expect(targetingWords({ withinMiles: null, stationCategories: [], dayparts: [] }, 5, 4)).toBe("Every kind, any time of day");
  });
  it("writes each station's line", () => {
    const base = { station: station("LUPE", "33.1"), category: "Food", miles: 8.9, included: true, reason: "From Monday", estimatedCostPerAiringMicros: { low: 1, high: 2 } };
    expect(matchLine(base)).toBe("Food, 8.9 mi. From Monday");
    expect(matchLine({ ...base, reason: null })).toBe("Food, 8.9 mi");
    expect(matchLine({ ...base, category: "Sports", included: false, reason: "not chosen" })).toBe("Sports, not chosen");
  });
  it("joins names", () => {
    expect(listWords(["BEAT"])).toBe("BEAT");
    expect(listWords(["BEAT", "CIVC", "SAZN"])).toBe("BEAT, CIVC and SAZN");
  });
});

describe("typed amounts", () => {
  it("reads dollars", () => {
    expect(parseDollars("$8.00")).toBe($(8));
    expect(parseDollars("1,200.5")).toBe($(1200.5));
    expect(parseDollars("8.001")).toBeNull();
    expect(parseDollars("eight")).toBeNull();
  });
});

describe("the pause story", () => {
  const story: PauseStory = {
    reason: "budget_spent",
    pausedAt: "2026-10-12T22:10:00.000Z",
    lastHold: { amountMicros: $(1.9), station: station("BEAT", "12.1") },
    held: { airings: 6, airedAt: "2026-10-13T03:00:00.000Z" },
    stations: [
      { station: station("BEAT", "12.1"), filledWith: "backup_rotation", toldWhenBack: true },
      { station: station("CIVC", "7.1"), filledWith: "another_spot", toldWhenBack: true },
      { station: station("SAZN", "18.1"), filledWith: "station_id", toldWhenBack: true }
    ]
  };
  it("tells what happened as the frame does", () => {
    const t = pauseTimeline("Fall menu", story);
    expect(t.map((i) => [i.state, i.when, i.title, i.detail])).toEqual([
      ["done", "Oct 12, 3:10 pm", "Budget reached", "The last $1.90 was held for an airing on BEAT"],
      ["done", "Oct 12, 3:10 pm", "Out of the market, stations told", "BEAT, CIVC and SAZN had it in rotation"],
      ["done", "Oct 12, evening", "6 airings already held still aired", "They were paid for before the pause"],
      ["current", "Now", "Waiting for you", "Raise the budget and it's back in the market, and the 3 stations are told"]
    ]);
  });
  it("puts held airings still to come after now", () => {
    const t = pauseTimeline("Fall menu", { ...story, held: { airings: 1, airedAt: null } });
    expect(t.at(-1)).toMatchObject({ state: "future", title: "1 airing already held still airs" });
  });
});
