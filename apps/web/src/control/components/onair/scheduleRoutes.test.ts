import { describe, expect, it } from "vitest";
import { logQuery, oldRouteTarget, scheduleHref, SCHEDULE_TABS } from "./scheduleRoutes";

describe("the Schedule's tabs (A246)", () => {
  it("are Log, Templates, Blocks and Break rules, each a route", () => {
    expect(SCHEDULE_TABS.map((t) => t.label)).toEqual(["Log", "Templates", "Blocks", "Break rules"]);
    expect(scheduleHref("/control/beat")).toBe("/control/beat/schedule");
    expect(scheduleHref("/control/beat", "templates")).toBe("/control/beat/schedule/templates");
    expect(scheduleHref("/control/beat", "blocks")).toBe("/control/beat/schedule/blocks");
    expect(scheduleHref("/control/beat", "rules")).toBe("/control/beat/schedule/rules");
  });
});

describe("old routes land on the Schedule's tabs, with their query", () => {
  const cases: Array<[string, string, string]> = [
    ["log", "", "schedule"],
    ["log", "?view=day", "schedule?view=day"],
    ["log", "?view=week", "schedule?view=week"],
    // Evening went: it's the Day.
    ["log", "?view=evening&day=sat", "schedule?view=day&day=sat"],
    ["log", "?day=2026-10-03", "schedule?day=2026-10-03"],
    ["log", "?edit=1", "schedule?edit=1"],
    ["log", "?fill=2026-10-04T06%3A40%3A00.000Z", "schedule?fill=2026-10-04T06%3A40%3A00.000Z"],
    ["log", "?day=2026-09-26&view=day&entry=e15r", "schedule?day=2026-09-26&view=day&entry=e15r"],
    ["log", "?block=span-1", "schedule?block=span-1"],
    // The library's "Schedule": edit mode with the item to add.
    ["log", "?place=item-7", "schedule?edit=1&add=item-7"],
    // Anything else on any page (the switcher, Sign off) comes along.
    ["log", "?switch=1&modal=sign-off", "schedule?switch=1&modal=sign-off"],
    ["log/place/o1", "?term=barter", "schedule/place/o1?term=barter"],
    ["breaks", "", "schedule"],
    ["breaks", "?switch=1", "schedule?switch=1"],
    ["breaks", "?rotation=backup", "spot-market/rotation?show=backup"],
    ["breaks", "?rotation=main", "spot-market/rotation?show=main"],
    ["blocks", "", "schedule/blocks"],
    ["blocks/new", "", "schedule/blocks/new"],
    ["blocks/b1", "?switch=1", "schedule/blocks/b1?switch=1"]
  ];
  it.each(cases)("/%s%s lands on /%s", (rest, search, to) => {
    expect(oldRouteTarget(rest, search)).toBe(to);
  });

  it("sends a studio's Breaks to its Spot rotation", () => {
    expect(oldRouteTarget("breaks", "", { studio: true })).toBe("spot-rotation");
  });

  it("knows only the old pages", () => {
    expect(oldRouteTarget("monitor", "")).toBeNull();
    expect(oldRouteTarget("log/elsewhere", "")).toBeNull();
    expect(oldRouteTarget("blocks/b1/more", "")).toBeNull();
  });

  it("reads the old log's query as the Log tab does", () => {
    expect(logQuery("?view=evening").get("view")).toBe("day");
    expect(Object.fromEntries(logQuery("?place=i1&day=sat"))).toEqual({ day: "sat", edit: "1", add: "i1" });
  });
});
