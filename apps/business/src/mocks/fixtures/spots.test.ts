// The Spots mock's rules: matching, checks, airing through the shared ledger, the budget pause and
// coming back, and the role checks on the handlers' data.

import { beforeEach, describe, expect, it } from "vitest";
import { balanceOf, getDb, resetDb } from "../db";
import { OSC_ID, seedBusinesses } from "./businesses";
import { airingCost, airOnce, airUntilPaused, codeFor, comeBack, matchStations, mockOf, pauseForBalance, resetSpotsMock, resumeAfterTopUp, spotOut, stationsAdd, uploadChecks } from "./spots";
import { can } from "../../business/abilities";

const $ = (d: number) => Math.round(d * 1e6);
const FALL = "00000000-0000-4000-8000-000000064001";
const fall = () => getDb().spots.find((s) => s.id === FALL)!;
const osc = () => getDb().businesses.find((b) => b.id === OSC_ID)!;

beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetSpotsMock();
});

describe("matching stations", () => {
  it("names the frame's seven stations: five in, sports and radio left out", () => {
    const m = matchStations(osc(), fall().rate, { withinMiles: 10, locationIds: [osc().locations[0]!.id], stationCategories: ["Music", "Public affairs", "Food", "Classic"], bands: ["tv"] });
    expect(m.map((x) => x.station.callSign)).toEqual(["CIVC", "BEAT", "SAZN", "REEL", "LUPE", "PREP", "NITE"]);
    expect(m.filter((x) => x.included)).toHaveLength(5);
    expect(m.find((x) => x.station.callSign === "LUPE")!.reason).toMatch(/^From /);
    expect(m.find((x) => x.station.callSign === "PREP")).toMatchObject({ included: false, reason: "not chosen", category: "Sports" });
    expect(m.find((x) => x.station.callSign === "NITE")).toMatchObject({ included: false, reason: "not chosen", category: "Radio band" });
  });
  it("prices an airing from the station's tuned-in range: $1.40 to $3.30 at $8.00 per 1,000", () => {
    const m = matchStations(osc(), fall().rate, { withinMiles: 10, locationIds: [osc().locations[0]!.id], stationCategories: ["Music", "Public affairs", "Food", "Classic"] }).filter((x) => x.included);
    expect(Math.min(...m.map((x) => x.estimatedCostPerAiringMicros!.low))).toBe($(1.4));
    expect(Math.max(...m.map((x) => x.estimatedCostPerAiringMicros!.high))).toBe($(3.3));
  });
  it("leaves out what's farther than the distance", () => {
    const m = matchStations(osc(), fall().rate, { withinMiles: 5, locationIds: [osc().locations[0]!.id] });
    expect(m.find((x) => x.station.callSign === "SAZN")).toMatchObject({ included: false, reason: "farther than 5 mi" });
  });
  it("costs a flat rate the same everywhere", () => {
    expect(airingCost({ kind: "per_airing", micros: $(4), perAiringMaxMicros: null }, 900)).toBe($(4));
    expect(airingCost({ kind: "per_thousand", micros: $(8), perAiringMaxMicros: null }, 262)).toBe($(2.1));
  });
});

describe("upload checks", () => {
  it("finds what the frame draws: 4 fine, 1 fixed, 1 for you", () => {
    const c = uploadChecks(30, "ORANGE11", false);
    expect(c.map((x) => x.result)).toEqual(["fine", "fine", "fine", "fixed", "for_you", "fine"]);
    expect(c[0]!.label).toBe("Length :30.0");
  });
  it("shrinking to fit fixes the safe area", () => {
    expect(uploadChecks(30, null, true).find((x) => x.check === "safe_area")!.result).toBe("fixed");
  });
  it("picks a code the business doesn't have yet", () => {
    expect(codeFor(seedBusinesses()[0]!, ["ORANGE10"])).toBe("ORANGE11");
  });
});

describe("airing, pausing and coming back", () => {
  it("an airing spends through the ledger and counts against the budget", () => {
    const before = balanceOf(OSC_ID).availableMicros;
    const used = fall().budget.usedMicros;
    expect(airOnce(fall())).toBe("aired");
    const spent = before - balanceOf(OSC_ID).availableMicros;
    expect(spent).toBeGreaterThan(0);
    expect(fall().budget.usedMicros - used).toBe(spent);
    expect(getDb().movements[OSC_ID]![0]).toMatchObject({ kind: "aired", amountMicros: -spent });
  });

  it("Fall menu spends its $300, holds the last of it and pauses (budget spent), with its story", () => {
    const start = balanceOf(OSC_ID);
    const avail = start.availableMicros;
    const held = start.heldMicros;
    airUntilPaused(fall());
    const s = fall();
    expect(s.state).toBe("paused_budget");
    expect(s.budget.usedMicros).toBe(s.budget.totalMicros);
    // What left available is exactly what the budget had left: airings plus the last hold.
    expect(avail - balanceOf(OSC_ID).availableMicros).toBe($(300) - $(176.4));
    const story = spotOut(s).pause!;
    expect(story.reason).toBe("budget_spent");
    expect(story.stations.map((x) => x.station.callSign)).toEqual(["BEAT", "CIVC", "SAZN"]);
    expect(story.stations.map((x) => x.filledWith)).toEqual(["backup_rotation", "another_spot", "station_id"]);
    if (story.lastHold) expect(balanceOf(OSC_ID).heldMicros - held).toBe(story.lastHold.amountMicros);
    expect(spotOut(s).inRotationOn).toBe(0);
  });

  it("raising the budget charges nothing; resuming tells the stations and none has it until it adds it back", () => {
    airUntilPaused(fall());
    const avail = balanceOf(OSC_ID).availableMicros;
    const movements = getDb().movements[OSC_ID]!.length;
    fall().budget.totalMicros += $(200);
    comeBack(fall());
    expect(balanceOf(OSC_ID).availableMicros).toBe(avail);
    expect(getDb().movements[OSC_ID]!.length).toBe(movements);
    const s = spotOut(fall());
    expect(s.state).toBe("listed");
    expect(s.back!.told.map((x) => x.callSign)).toEqual(["BEAT", "CIVC", "SAZN"]);
    expect(s.inRotationStations).toEqual([]);
    stationsAdd(fall(), osc());
    expect(spotOut(fall())).toMatchObject({ state: "in_rotation", inRotationOn: 3, back: null });
  });

  it("stops at the daily cap without a pause story", () => {
    const s = fall();
    s.budget.dailyCapMicros = s.budget.usedTodayMicros + $(1);
    airUntilPaused(s);
    expect(s.state).toBe("paused_daily_cap");
    expect(mockOf(s).pause).toBeNull();
  });

  it("pauses for the balance when the balance can't cover an airing", () => {
    balanceOf(OSC_ID).availableMicros = $(0.5);
    airUntilPaused(fall());
    expect(fall().state).toBe("paused_balance");
    expect(spotOut(fall()).pause!.reason).toBe("balance");
  });

  it("starts a spot's story over when the shared db moves on without it", () => {
    airUntilPaused(fall());
    expect(mockOf(fall()).pause).not.toBeNull();
    fall().state = "in_rotation";
    expect(mockOf(fall()).pause).toBeNull();
    expect(mockOf(fall()).rotation).toHaveLength(3);
  });
});

describe("the balance runs low, then it's topped up (the Money area's calls)", () => {
  const COLTON = "00000000-0000-4000-8000-000000064003";
  const colton = () => getDb().spots.find((s) => s.id === COLTON)!;

  it("does nothing while a day of pace is available", () => {
    expect(pauseForBalance(OSC_ID)).toEqual([]);
    expect(fall().state).toBe("in_rotation");
  });

  it("under a day of pace, pauses the listed and in-rotation spots; the others stay as they are", () => {
    colton().state = "listed";
    balanceOf(OSC_ID).availableMicros = balanceOf(OSC_ID).pacePerDayMicros - 1;
    const held = balanceOf(OSC_ID).heldMicros;
    expect(pauseForBalance(OSC_ID).sort()).toEqual([FALL, COLTON].sort());
    expect(fall().state).toBe("paused_balance");
    expect(colton().state).toBe("paused_balance");
    expect(getDb().spots.find((s) => s.title === "Pumpkin latte")!.state).toBe("paused_daily_cap");
    expect(getDb().spots.find((s) => s.title === "Summer cold brew")!.state).toBe("ended");
    // Held airings still air: holds are untouched.
    expect(balanceOf(OSC_ID).heldMicros).toBe(held);
    const story = spotOut(fall()).pause!;
    expect(story.reason).toBe("balance");
    expect(story.stations.map((x) => x.station.callSign)).toEqual(["BEAT", "CIVC", "SAZN"]);
  });

  it("a top-up that covers a day of pace brings them back to the market and tells the stations; none returns to a rotation by itself", () => {
    const pace = balanceOf(OSC_ID).pacePerDayMicros;
    balanceOf(OSC_ID).availableMicros = pace - 1;
    pauseForBalance(OSC_ID);
    expect(resumeAfterTopUp(OSC_ID)).toEqual([]);
    balanceOf(OSC_ID).availableMicros = pace;
    expect(resumeAfterTopUp(OSC_ID)).toEqual([FALL]);
    const s = spotOut(fall());
    expect(s.state).toBe("listed");
    expect(s.back).toMatchObject({ reason: "added_money" });
    expect(s.back!.told.map((x) => x.callSign)).toEqual(["BEAT", "CIVC", "SAZN"]);
    expect(s.inRotationStations).toEqual([]);
    expect(resumeAfterTopUp(OSC_ID)).toEqual([]);
  });

  it("a spot whose budget is also spent stays paused after a top-up", () => {
    fall().budget.usedMicros = fall().budget.totalMicros;
    balanceOf(OSC_ID).availableMicros = 0;
    pauseForBalance(OSC_ID);
    balanceOf(OSC_ID).availableMicros = $(500);
    expect(resumeAfterTopUp(OSC_ID)).toEqual([]);
    expect(fall().state).toBe("paused_balance");
  });
});

describe("who can run spots", () => {
  it("owners and managers advertise; viewers only see", () => {
    expect(can("owner", "advertise")).toBe(true);
    expect(can("manager", "advertise")).toBe(true);
    expect(can("viewer", "advertise")).toBe(false);
    expect(can("viewer", "see")).toBe(true);
  });
});
