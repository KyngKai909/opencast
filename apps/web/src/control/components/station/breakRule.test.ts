import { describe, expect, it } from "vitest";
import type { BreakRule, LibraryItem } from "@opencast/contracts";
import { bumpersCadence, choiceOptions, recipeOf, sameRule, upNextCadence, withChipCadence } from "./breakRule";
import {
  cadenceDetail,
  cadenceFromKey,
  cadenceKey,
  cadenceOf,
  cadenceOptions,
  cadenceWords,
  capCells,
  capMinutes,
  exampleLine,
  fillOrder,
  ladder,
  ladderWithPartners,
  moveFill,
  moveRole,
  placeFill,
  placeRole,
  roleSupply,
  ruleLabel,
  sequenceOptions,
  sequencesOf,
  spotMsPerBreak,
  upNextTwice
} from "./breakRule";

describe("what fills every break (station-settings 02.1)", () => {
  it("keeps the bumper and the station ID last, whatever it's given", () => {
    expect(fillOrder(["SID", "UND", "SPT", "BMP"])).toEqual(["UND", "SPT", "BMP", "SID"]);
    expect(fillOrder(["SPT"])).toEqual(["SPT", "UND", "BMP", "SID"]);
    expect(fillOrder(["PGM", "BMP", "BMP", "OPEN"])).toEqual(["SPT", "UND", "BMP", "SID"]);
  });

  it("moves a part up or down, but never past the station ID", () => {
    const order = ["SPT", "UND", "BMP", "SID"] as const;
    expect(moveFill(order, "UND", -1)).toEqual(["UND", "SPT", "BMP", "SID"]);
    expect(moveFill(order, "BMP", 1)).toEqual(["SPT", "UND", "BMP", "SID"]);
    expect(moveFill(order, "SPT", -1)).toEqual(["SPT", "UND", "BMP", "SID"]);
    expect(moveFill(order, "SID", -1)).toEqual(["SPT", "UND", "BMP", "SID"]);
  });

  it("places a dragged part among the spots and the credit; the bumpers and a drop past them land above the bumper out", () => {
    const order = ["SPT", "UND", "BMP", "SID"] as const;
    expect(placeFill(order, "BMP", 0)).toEqual(["SPT", "UND", "BMP", "SID"]);
    expect(placeFill(order, "SPT", 3)).toEqual(["UND", "SPT", "BMP", "SID"]);
    expect(placeFill(order, "UND", 0)).toEqual(["UND", "SPT", "BMP", "SID"]);
  });

  it("puts ads from partners at step 4 of 6, before the bumper out of the break, as the reference now draws it (A151)", () => {
    const rows = ladderWithPartners({ lengthMs: 120_000, fillOrder: ["SPT", "UND", "BMP", "SID"], adsFromPartners: false });
    expect(rows.map((r) => [r.n, r.code, r.title])).toEqual([
      [1, "BMP", "Opening the break"],
      [2, "SPT", "Spots from your rotation"],
      [3, "UND", "Thank-you credit"],
      [4, "SPT", "Ads from partners"],
      [5, "BMP", "Closing the break"],
      [6, "SID", "Station ID"]
    ]);
    expect(rows[3]).toMatchObject({ partner: true, detail: "Off. Only time still open", time: "0:00 – 1:00" });
  });

  it("gives spots what the fixed parts leave of the break (a bumper at each end)", () => {
    expect(spotMsPerBreak({ lengthMs: 120_000, fillOrder: ["SPT", "UND", "BMP", "SID"] })).toBe(80_000);
    expect(spotMsPerBreak({ lengthMs: 20_000, fillOrder: ["SPT", "UND", "BMP", "SID"] })).toBe(0);
  });

  it("draws the ladder: a bumper into the break, the spots and credit in the station's order, a bumper out, the station ID", () => {
    const rows = ladder({ lengthMs: 120_000, fillOrder: ["UND", "SPT", "BMP", "SID"] });
    expect(rows.map((r) => [r.n, r.code, r.time, r.fillIndex])).toEqual([
      [1, "BMP", ":10", null],
      [2, "UND", ":15", 0],
      [3, "SPT", "0:00 – 1:20", 1],
      [4, "BMP", ":10", null],
      [5, "SID", ":05", null]
    ]);
    expect(rows.map((r) => r.title)).toEqual(["Opening the break", "Thank-you credit", "Spots from your rotation", "Closing the break", "Station ID"]);
    expect(rows[4]!.detail).toBe("Always last, can't be removed");
  });
});

describe("how much advertising", () => {
  it("fills a cell a minute against broadcast TV's 16", () => {
    const cells = capCells(180_000);
    expect(cells).toHaveLength(16);
    expect(cells.filter(Boolean)).toHaveLength(3);
    expect(capMinutes(180_000)).toBe("3");
    expect(capMinutes(150_000)).toBe("2.5");
  });

  it("labels the break rule", () => {
    expect(ruleLabel("every_n_minutes", 30)).toBe("Every 30 min");
    expect(ruleLabel("every_n_minutes", null)).toBe("Every 30 min");
    expect(ruleLabel("after_every_program", null)).toBe("After every program");
    expect(ruleLabel("none", null)).toBe("None");
  });
});

describe("how often the station ID, bumpers, credit and spots air (added 2026-09-29)", () => {
  it("reads a rule without a cadence as every break, and says each choice in words", () => {
    expect(cadenceOf({})).toEqual({ stationId: { every: "break" }, bumpers: { every: "break" }, underwriting: { every: "break" }, spots: { every: "break" } });
    // A rule saved before spots had a choice: every break.
    expect(cadenceOf({ cadence: { stationId: { every: "hour" }, bumpers: { every: "break" }, underwriting: { every: "break" } } }).spots).toEqual({ every: "break" });
    expect(cadenceOf({ cadence: { stationId: { every: "hour" }, bumpers: { every: "never" }, underwriting: { every: "n_programs", n: 3 } } }).underwriting).toEqual({ every: "n_programs", n: 3 });
    expect(cadenceWords({ every: "break" })).toBe("In every break");
    expect(cadenceWords({ every: "program" })).toBe("After every program");
    expect(cadenceWords({ every: "n_programs", n: 3 })).toBe("After every 3 programs");
    expect(cadenceWords({ every: "hour" })).toBe("Once an hour");
    expect(cadenceWords({ every: "never" })).toBe("Never");
  });

  it("offers never for bumpers and the credit, not the station ID", () => {
    expect(cadenceOptions("stationId").map((o) => o.label)).toEqual(["In every break", "After every program", "After every 2 programs", "After every 3 programs", "After every 4 programs", "Once an hour"]);
    expect(cadenceOptions("bumpers").at(-1)).toEqual({ value: "never", label: "Never" });
    expect(cadenceOptions("underwriting").at(-1)).toEqual({ value: "never", label: "Never" });
    expect(cadenceOptions("spots").map((o) => o.value)).toEqual(["break", "program", "n:2", "n:3", "n:4", "hour", "never"]);
  });

  it("goes to a select's value and back", () => {
    for (const c of [{ every: "break" }, { every: "program" }, { every: "n_programs", n: 4 }, { every: "hour" }, { every: "never" }] as const) expect(cadenceFromKey(cadenceKey(c))).toEqual(c);
    expect(cadenceDetail("stationId", { every: "hour" })).toBe("Last in the first break after the top of the hour");
    expect(cadenceDetail("bumpers", { every: "never" })).toBe("No bumpers in breaks");
    expect(cadenceDetail("bumpers", { every: "break" })).toBe("One into the break and one out of it");
    expect(cadenceDetail("spots", { every: "break" })).toBe("In every break, up to the hourly cap");
    expect(cadenceDetail("spots", { every: "hour" })).toBe("Up to the hourly cap. Other breaks are only as long as the rest needs");
    expect(cadenceDetail("spots", { every: "never" })).toBe("Breaks are only as long as the rest needs. Nothing is sold in them");
  });
});

describe("the bumper sequences (A243)", () => {
  const at = new Date("2026-10-03T03:00:00Z"); // 8:00 pm in the Inland Empire.
  const bumper = (o: Partial<LibraryItem>) => ({ code: "BMP" as const, status: "ready" as const, rights: { basis: "made_it" as const, confirmedBy: null, confirmedAt: "2026-09-01T00:00:00Z", note: null }, durationMs: 5_000, bumperRole: null, airs: null, ...o });

  it("reads a rule without them as one into the break and one out of it, as often as the bumpers' cadence", () => {
    expect(sequencesOf({})).toEqual({ open: { roles: ["into_break"], every: "break" }, close: { roles: ["out_of_break"], every: "break" }, between: { roles: [], every: "program" } });
    expect(sequencesOf({ cadence: { stationId: { every: "break" }, bumpers: { every: "n_programs", n: 3 }, underwriting: { every: "break" } } }).close).toEqual({ roles: ["out_of_break"], every: "n_programs", n: 3 });
  });

  it("moves a role left or right, and places a dragged one", () => {
    expect(moveRole(["into_break", "up_next"], "up_next", -1)).toEqual(["up_next", "into_break"]);
    expect(moveRole(["into_break", "up_next"], "up_next", 1)).toEqual(["into_break", "up_next"]);
    expect(placeRole(["into_break", "up_next", "any"], "any", 0)).toEqual(["any", "into_break", "up_next"]);
  });

  it("says how often each position airs, between programs in its own words", () => {
    expect(sequenceOptions("open").map((o) => o.label)).toEqual(["Every break", "After every program", "After every 2 programs", "After every 3 programs", "After every 4 programs", "Once an hour", "Never"]);
    expect(sequenceOptions("between").map((o) => o.label)).toEqual(["Between every program", "Every 2 programs", "Every 3 programs", "Every 4 programs", "At the top of the hour", "Never"]);
  });

  it("says what fills each role: in the library, falling back to Any, nothing for up next, or not airing now", () => {
    const items = [bumper({ bumperRole: null }), bumper({ bumperRole: "any" }), bumper({ bumperRole: "up_next", airs: { from: "2026-12-01", until: "2026-12-31", dailyFrom: null, dailyUntil: null } })];
    expect(roleSupply(items, "any", at)).toBe("2 in your library");
    expect(roleSupply(items, "into_break", at)).toBe("None yet, so an Any bumper airs");
    expect(roleSupply(items, "up_next", at)).toBe("1, not airing now (from Dec 1)");
    expect(roleSupply([], "up_next", at)).toBe("None yet, so nothing airs");
    expect(roleSupply([], "out_of_break", at)).toBe("None yet, so nothing airs");
  });

  it("notes up next in two places, and gives an example break", () => {
    const seq = { open: { roles: ["into_break", "up_next"], every: "break" }, close: { roles: ["up_next", "out_of_break"], every: "break" }, between: { roles: [], every: "program" } } as const;
    expect(upNextTwice(seq as never)).toBe(true);
    expect(upNextTwice(sequencesOf({}))).toBe(false);
    const items = [bumper({ bumperRole: "into_break" }), bumper({ bumperRole: "up_next", durationMs: 8_000 }), bumper({ bumperRole: "out_of_break" })];
    expect(exampleLine({ lengthMs: 120_000, fillOrder: ["SPT", "UND", "BMP", "SID"], bumperSequences: { ...seq, close: { roles: ["out_of_break"], every: "break" } } as never }, items, at)).toBe(
      "Example, a 2:00 break: Into the break :05, Up next :08, your spots, the credit, Out of the break :05, then your station ID."
    );
  });
});

// ---- A246, Break rules with a preview ----


describe("Break rules' chips and recipe (A246)", () => {
  const base: BreakRule = {
    mode: "after_every_program",
    everyMinutes: null,
    lengthMs: 120_000,
    spotMsPerHour: 180_000,
    sameSpotPerHour: 2,
    fillOrder: ["SPT", "UND", "BMP", "SID"],
    openTimeTo: "spot_market",
    blockedCategories: ["Alcohol", "Gambling"],
    adsFromPartners: false,
    cadence: { stationId: { every: "break" }, bumpers: { every: "break" }, underwriting: { every: "hour" }, spots: { every: "break" } },
    bumperSequences: { open: { roles: ["into_break"], every: "break" }, close: { roles: ["out_of_break"], every: "break" }, between: { roles: ["up_next", "any"], every: "program" } }
  };
  const bmp = (title: string, bumperRole: LibraryItem["bumperRole"], durationMs: number) => ({ code: "BMP", bumperRole, airs: null, status: "ready", rights: { kind: "own" }, durationMs, title }) as never;
  const lib = [bmp("Right back", "into_break", 5_000), bmp("Up next", "up_next", 5_000), bmp("Back to it", "out_of_break", 5_000), bmp("Sting", "any", 3_000)];
  const now = new Date("2026-10-03T03:00:00Z");

  it("the station ID's never is there, crossed out (disabled)", () => {
    expect(choiceOptions("stationId", 2).find((o) => o.value === "never")).toEqual({ value: "never", label: "Never", disabled: true });
    expect(choiceOptions("spots", 3).map((o) => o.label)).toEqual(["Every break", "After each program", "Every 3 programs", "Once an hour", "Never"]);
  });

  it("S20: Up next's cadence is its own when set; left out, its position's; nowhere, never", () => {
    expect(upNextCadence(base)).toEqual({ every: "program" });
    expect(upNextCadence({ ...base, cadence: { ...base.cadence!, upNext: { every: "hour" } } })).toEqual({ every: "hour" });
    expect(upNextCadence({ ...base, bumperSequences: { ...base.bumperSequences!, between: { roles: ["any"], every: "program" } } })).toEqual({ every: "never" });
    // Up next's chips never touch the between sequence.
    const next = withChipCadence(base, "upNext", { every: "n_programs", n: 3 });
    expect(next.cadence?.upNext).toEqual({ every: "n_programs", n: 3 });
    expect(next.bumperSequences).toEqual(base.bumperSequences);
  });

  it("the Bumpers chips set opening and closing together; differing, no chip is theirs", () => {
    const next = withChipCadence(base, "bumpers", { every: "n_programs", n: 2 });
    expect(next.bumperSequences?.open).toEqual({ roles: ["into_break"], every: "n_programs", n: 2 });
    expect(next.bumperSequences?.close).toEqual({ roles: ["out_of_break"], every: "n_programs", n: 2 });
    expect(bumpersCadence(next)).toEqual({ every: "n_programs", n: 2 });
    expect(bumpersCadence({ ...base, bumperSequences: { ...base.bumperSequences!, close: { roles: [], every: "hour" } } })).toBeNull();
  });

  it("draws every break to scale, then between programs; Up next where its own cadence puts it", () => {
    const r = recipeOf(base, lib, now);
    expect(r.inBreak.map((p) => `${p.label} ${p.detail}`)).toEqual(["Bumper 0:05", "Spots up to 1:30", "Credit 0:15", "Bumper 0:05", "ID 0:05"]);
    expect(r.between.map((p) => `${p.label} ${p.detail}`)).toEqual(["Up next 0:05", "Bumper 0:03"]);
    // Never: off the picture. With its own cadence and between programs never, Up next still airs there.
    const own = recipeOf({ ...base, cadence: { ...base.cadence!, upNext: { every: "program" }, underwriting: { every: "never" } }, bumperSequences: { ...base.bumperSequences!, between: { roles: ["up_next", "any"], every: "never" } } }, lib, now);
    expect(own.inBreak.map((p) => p.label)).toEqual(["Bumper", "Spots", "Bumper", "ID"]);
    expect(own.between.map((p) => p.label)).toEqual(["Up next"]);
    // The credit first.
    expect(recipeOf({ ...base, fillOrder: ["UND", "SPT", "BMP", "SID"] }, lib, now).inBreak.map((p) => p.label)).toEqual(["Bumper", "Credit", "Spots", "Bumper", "ID"]);
  });

  it("two rules are the same whatever order their blocked categories are in", () => {
    expect(sameRule(base, { ...base, blockedCategories: ["Gambling", "Alcohol"] })).toBe(true);
    expect(sameRule(base, { ...base, lengthMs: 90_000 })).toBe(false);
  });
});
