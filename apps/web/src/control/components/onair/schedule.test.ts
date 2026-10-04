// The words for off air hours and day templates (G8, G9), the Monitor's line, the rundown's off
// air, and the sign-on line leaving informational checks out. A246 (Phase 4): the Templates tab's
// cards (dates ahead, which template wins a date, the precedence note), what saving does (dates
// rebuilt, edited dates kept), and "Reset to template".

import { describe, expect, it } from "vitest";
import type { DayTemplate } from "@opencast/contracts";
import { monitorOffAirText, nextOffAirText, offAirSource, ruleIndexOf, ruleLines, wallClock } from "./offAir";
import { buildRundown } from "./rundown";
import { signOnSummary } from "./signOn";
import { cardLine, copyName, coversDate, datesText, generationLines, precedenceNote, referenceDate, repeatOptions, resetLine, saveCounts, savedLine, templateName, winnerOn } from "./templates";

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

  it("names a template, and says how it repeats and what's ahead (06's cards)", () => {
    const t = template({ dates: [{ date: "2026-10-03", edited: false, entries: 8, skipped: 2 }, { date: "2026-10-10", edited: true, entries: 10, skipped: 0 }] });
    expect(templateName(t)).toBe("Every Saturday");
    expect(cardLine(t, null)).toBe("From Sep 26. 2 dates ahead, 1 edited");
    const named = template({ name: "After work", label: "Weekdays", pattern: "weekdays", weekday: null, fromDay: "2026-09-21", until: "2026-11-20", dates: [] });
    expect(templateName(named)).toBe("After work");
    expect(cardLine(named, null)).toBe("Monday to Friday from Sep 21, until Nov 20. No dates ahead");
    expect(cardLine(template({ name: "Saturdays" }), null)).toBe("Every Saturday from Sep 26. No dates ahead");
    expect(datesText(template({ dates: [{ date: "2026-10-03", edited: false, entries: 1, skipped: 0 }] }))).toBe("1 date ahead");
    const once = template({ id: "hw", name: "Halloween", pattern: "once", weekday: null, label: "Once, Sat Oct 31", onDate: "2026-10-31" });
    expect(cardLine(once, "Overrides Every Saturday that day")).toBe("Once, Sat Oct 31. Overrides Every Saturday that day");
  });

  it("knows which template makes a date: once, then a weekday, then weekdays, then every day", () => {
    const sat = template({ id: "sat", createdAt: T("01:00") });
    const weekdays = template({ id: "wd", pattern: "weekdays", weekday: null, label: "Weekdays", fromDay: "2026-09-21" });
    const daily = template({ id: "all", pattern: "daily", weekday: null, label: "Every day", fromDay: "2026-09-20" });
    const once = template({ id: "hw", name: "Halloween", pattern: "once", weekday: null, label: "Once, Sat Oct 31", onDate: "2026-10-31" });
    const all = [sat, weekdays, daily, once];
    expect(coversDate(sat, "2026-09-26")).toBe(false);
    expect(winnerOn(all, "2026-10-03")?.id).toBe("sat");
    expect(winnerOn(all, "2026-10-05")?.id).toBe("wd");
    expect(winnerOn(all, "2026-10-04")?.id).toBe("all");
    expect(winnerOn(all, "2026-10-31")?.id).toBe("hw");
    // The note is the winner's, on dates both cover in the next three weeks.
    expect(precedenceNote(once, all, "2026-10-12")).toBe("Overrides Every Saturday and Every day that day");
    expect(precedenceNote(sat, all, "2026-09-27")).toBe("Overrides Every day on Saturdays");
    expect(precedenceNote(weekdays, all, "2026-09-27")).toBe("Overrides Every day on weekdays");
    expect(precedenceNote(daily, all, "2026-09-27")).toBeNull();
    // Halloween is beyond three weeks: nothing to say yet.
    expect(precedenceNote(once, all, "2026-09-27")).toBeNull();
  });

  it("says what saving does: how many dates are rebuilt and which edited ones are kept (decision 7)", () => {
    const dates = (edited: string[]) => ["2026-10-03", "2026-10-10", "2026-10-17", "2026-10-24"].map((date) => ({ date, edited: edited.includes(date), entries: 8, skipped: 0 }));
    expect(saveCounts(template({ dates: dates(["2026-10-03"]) }))).toEqual({ rebuilt: 3, kept: 1, line: "Saving changes here rebuilds 3 upcoming Saturdays. Oct 3, edited by hand, is kept as an exception." });
    expect(saveCounts(template({ dates: dates([]) })).line).toBe("Saving changes here rebuilds 4 upcoming Saturdays.");
    expect(saveCounts(template({ dates: dates(["2026-10-03", "2026-10-17"]) })).line).toBe("Saving changes here rebuilds 2 upcoming Saturdays. Oct 3 and Oct 17, edited by hand, are kept as exceptions.");
    expect(saveCounts(template({ pattern: "weekdays", weekday: null, dates: dates([]).slice(0, 1) })).line).toBe("Saving changes here rebuilds 1 upcoming weekday.");
    expect(saveCounts(template({ pattern: "once", weekday: null, onDate: "2026-10-31", dates: [{ date: "2026-10-31", edited: false, entries: 3, skipped: 0 }] })).line).toBe("Saving changes here rebuilds Sat Oct 31.");
    expect(savedLine(3, 1)).toBe("Template saved. 3 dates rebuilt; 1 edited date kept as an exception.");
    expect(savedLine(1, 0)).toBe("Template saved. 1 date rebuilt.");
    expect(resetLine("2026-09-30", "After work", { created: 2, removed: 1 })).toBe("Sep 30 is back to After work: 2 programs back on, 1 taken off.");
    expect(resetLine("2026-09-30", "After work", { created: 0, removed: 0 })).toBe("Sep 30 is back to After work.");
  });

  it("opens a template on the next date it makes", () => {
    expect(referenceDate(template({ dates: [{ date: "2026-10-03", edited: false, entries: 1, skipped: 0 }] }), "2026-09-26")).toBe("2026-10-03");
    expect(referenceDate(template({}), "2026-09-26")).toBe("2026-10-03");
    expect(referenceDate(template({ pattern: "once", weekday: null, onDate: "2027-01-01" }), "2026-09-26")).toBe("2026-09-26");
  });

  it("names G7's one-time copies by how they repeated", () => {
    expect(copyName({ id: "copy", day: "2026-09-19", pattern: "weekly", until: "2026-10-31", entries: 1, template: false })).toBe("Every Saturday");
    expect(copyName({ id: "copy", day: "2026-09-19", pattern: "daily", until: null, entries: 1 })).toBe("Every day");
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
