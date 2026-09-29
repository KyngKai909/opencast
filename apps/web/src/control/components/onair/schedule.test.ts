// The words for off air hours and day templates (G8, G9), the Monitor's line, the rundown's off
// air, and the sign-on line leaving informational checks out.

import { describe, expect, it } from "vitest";
import type { DayTemplate } from "@opencast/contracts";
import { monitorOffAirText, nextOffAirText, offAirSource, ruleIndexOf, ruleLines, wallClock } from "./offAir";
import { buildRundown } from "./rundown";
import { signOnSummary } from "./signOn";
import { copyDetail, copyName, datesText, dayOriginOf, generationLines, oldCopies, originOf, repeatOptions, templateDetail, templateName } from "./templates";

const TZ = "America/Los_Angeles";
const T = (hhmm: string) => `2026-09-27T${hhmm}:00.000Z`;

describe("off air words", () => {
  it("reads a rule as the frame's two lines", () => {
    expect(ruleLines({ label: "Every night, 2:00 am to 6:00 am", signOffAt: "02:00", backAt: "06:00" })).toEqual({ signOff: "Every night, 2:00 am", back: "6:00 am" });
    expect(ruleLines({ label: "Weeknights", signOffAt: "23:00", backAt: "06:00" })).toEqual({ signOff: "Weeknights, 11:00 pm", back: "6:00 am" });
    expect(wallClock("00:30")).toBe("12:30 am");
  });

  it("says when it's next off air, or that it's off now", () => {
    const span = { startsAt: T("11:00"), backAt: T("13:00") };
    expect(nextOffAirText(span, Date.parse(T("03:42")), TZ)).toBe("Sun 4:00 am to 6:00 am");
    expect(nextOffAirText(span, Date.parse(T("11:30")), TZ)).toBe("Off air now, back at 6:00 am");
    expect(nextOffAirText(null, 0, TZ)).toBeNull();
  });

  it("gives the Monitor its line: off air now, or signing off within 24 hours", () => {
    const o = { startsAt: T("09:00"), endsAt: T("13:00"), backAt: T("13:00"), source: "hours" as const, logEntryId: null };
    expect(monitorOffAirText({ ...o, now: true }, Date.parse(T("10:00")), TZ)).toBe("Off air, back at 6:00 am");
    expect(monitorOffAirText({ ...o, now: false }, Date.parse(T("03:42")), TZ)).toBe("Signs off at 2:00 am");
    expect(monitorOffAirText({ ...o, now: false }, Date.parse("2026-09-25T09:00:00Z"), TZ)).toBeNull();
    expect(monitorOffAirText(null, 0, TZ)).toBeNull();
  });

  it("tells the hours from a sign-off on the log", () => {
    expect(offAirSource({ startsAt: T("06:40"), backAt: T("13:00"), source: "sign_off" }, TZ)).toBe("Sign off at 11:40 pm. Back at 6:00 am");
    expect(offAirSource({ startsAt: T("09:00"), backAt: T("13:00"), source: "hours" }, TZ)).toBe("Off air hours. Back at 6:00 am");
  });

  it("finds the rule a 400 is about", () => {
    expect(ruleIndexOf({ "rules.2.backAt": "Same as sign off" })).toBe(2);
    expect(ruleIndexOf({ onto: "Required" })).toBeNull();
    expect(ruleIndexOf(undefined)).toBeNull();
  });
});

describe("the rundown's off air", () => {
  it("draws the hours as off air, not as time with nothing scheduled", () => {
    const e = { id: "a", kind: "program" as const, code: "PGM" as const, startsAt: T("07:00"), endsAt: T("09:00"), title: "Late Crate, ep. 12", episodeTitle: null, itemId: null, programId: null, liveSourceId: null, carriedFrom: null, carriageAgreementId: null, repeatGroupId: null, localNote: null };
    const rows = buildRundown([e], [], undefined, [{ startsAt: T("09:00"), endsAt: T("13:00"), backAt: T("13:00"), source: "hours", logEntryId: null }]);
    expect(rows.map((r) => [r.kind, r.title, r.source])).toEqual([
      ["program", "Late Crate, ep. 12", "From your library"],
      ["off_air", "Off air", "Back at 6:00 am"]
    ]);
  });
});

describe("the sign-on line", () => {
  it("leaves informational checks out of the count", () => {
    const ok = { key: "log_covers_24h", passed: true, blocking: true };
    const info = { key: "off_air_hours", passed: true, blocking: false };
    expect(signOnSummary([ok, ok, ok, ok, info])).toBe("Four checks. All four are done.");
  });
});

function template(o: Partial<DayTemplate>): DayTemplate {
  return { id: "t", name: null, pattern: "weekly", weekday: 6, label: "Every Saturday", fromDay: "2026-09-26", onDate: null, until: null, timezone: TZ, entries: [], dates: [], createdAt: T("00:00"), updatedAt: null, ...o };
}

describe("day template words", () => {
  it("offers the frame's four choices, with the day's own weekday", () => {
    expect(repeatOptions(6).map((o) => o.label)).toEqual(["Every Saturday", "Weekdays", "Every day", "Once"]);
    expect(repeatOptions(0)[0]).toEqual({ value: "weekly", label: "Every Sunday" });
  });

  it("names a template, and says where it's from and what's ahead", () => {
    const t = template({ dates: [{ date: "2026-10-03", edited: false, entries: 8, skipped: 2 }, { date: "2026-10-10", edited: true, entries: 10, skipped: 0 }] });
    expect(templateName(t)).toBe("Every Saturday");
    expect(templateDetail(t)).toBe("Built from Sat Sep 26. 2 dates ahead, 1 edited.");
    const named = template({ name: "After work", label: "Weekdays", pattern: "weekdays", weekday: null, fromDay: "2026-09-21", until: "2026-11-20", dates: [] });
    expect(templateName(named)).toBe("After work");
    expect(templateDetail(named)).toBe("Weekdays. Built from Mon Sep 21, until Fri Nov 20. No dates ahead.");
    expect(datesText(template({ dates: [{ date: "2026-10-03", edited: false, entries: 1, skipped: 0 }] }))).toBe("1 date ahead");
  });

  it("says which template made a date, and whether it was edited", () => {
    const t = template({ dates: [{ date: "2026-10-03", edited: false, entries: 8, skipped: 2 }, { date: "2026-10-10", edited: true, entries: 10, skipped: 0 }] });
    expect(originOf([t], "2026-10-03")).toEqual({ template: t, edited: false });
    expect(originOf([t], "2026-10-10")).toEqual({ template: t, edited: true });
    expect(originOf([t], "2026-09-26")).toBeNull();
  });

  it("reads which template made a day from the log's days first, today and past days too (G11)", () => {
    const t = template({ id: "sat", dates: [{ date: "2026-10-03", edited: false, entries: 8, skipped: 2 }] });
    const days = [
      { date: "2026-09-19", templateId: "old", templateName: "After work", label: "Weekdays", edited: true },
      { date: "2026-09-26", templateId: null, templateName: null, label: null, edited: false }
    ];
    expect(dayOriginOf(days, [t], "2026-09-19")).toEqual({ templateId: "old", name: "After work", edited: true });
    expect(dayOriginOf(days, [t], "2026-09-26")).toBeNull();
    // A day the log didn't list: the templates' dates.
    expect(dayOriginOf(days, [t], "2026-10-03")).toEqual({ templateId: "sat", name: "Every Saturday", edited: false });
    expect(dayOriginOf(undefined, [t], "2026-10-03")).toEqual({ templateId: "sat", name: "Every Saturday", edited: false });
  });

  it("keeps G7's one-time copies apart from templates", () => {
    const t = template({ id: "tmpl" });
    const repeats = [
      { id: "tmpl", day: "2026-09-26", pattern: "weekly" as const, until: null, entries: 30, template: true, weekday: 6, label: "Every Saturday" },
      { id: "copy", day: "2026-09-19", pattern: "weekly" as const, until: "2026-10-31", entries: 1, template: false }
    ];
    const copies = oldCopies(repeats, [t]);
    expect(copies.map((r) => r.id)).toEqual(["copy"]);
    expect(copyName(copies[0])).toBe("Every Saturday");
    expect(copyDetail(copies[0])).toBe("Copied from Sat Sep 19, until Sat Oct 31. 1 entry to come.");
  });

  it("lists what a write made, with removals and exceptions only when there are some", () => {
    expect(generationLines({ dates: 3, created: 24, removed: 0, skippedForConflicts: 2, exceptions: 0 })).toEqual([
      { label: "Dates made", value: "3" },
      { label: "Entries placed", value: "24" },
      { label: "Skipped for conflicts", value: "2" }
    ]);
    expect(generationLines({ dates: 1, created: 0, removed: 3, skippedForConflicts: 0, exceptions: 1 }).map((l) => l.label)).toEqual(["Dates made", "Entries placed", "Skipped for conflicts", "Taken off the log", "Edited dates left as they are"]);
  });
});
