import { describe, expect, it } from "vitest";
import type { Reminder } from "@opencast/contracts";
import type { AiringX, StationIdentX } from "../../api/ext";
import { holdReminder, heldReminderKey, optionsWhen, reminderAction, reminderFor, reminderTarget, remindText, switchText, takeHeldReminder, tuneDetail } from "./optionsLogic";
import { guideStateFrom } from "../../mocks/handlers/tvGuide";

const TZ = "America/Los_Angeles";
const BEAT: StationIdentX = { id: "st-beat", kind: "station", callSign: "BEAT", handle: "beat", name: "Inland Beat", colour: null, band: "tv", channel: "12.1", marketSlug: "inland-empire", homeCity: null };
const NOW = "2026-09-27T03:42:00.000Z"; // Saturday 8:42 pm
const START = "2026-09-27T04:00:00.000Z"; // 9:00 pm

const airing = (o: Partial<AiringX> = {}): AiringX => ({ logEntryId: "log-1", title: "Beat Tape Live", episodeTitle: null, code: "PGM", kind: "live", startsAt: START, endsAt: "2026-09-27T05:00:00.000Z", live: true, carriedFrom: null, programId: "p-1", note: null, episodeDescription: null, listedAiringId: null, ...o });
const reminder = (o: Partial<Reminder["airing"]> = {}, switchMeOver = false): Reminder => ({
  id: "r-1",
  switchMeOver,
  airing: { title: "Beat Tape Live", startsAt: START, station: BEAT, listed: false, logEntryId: "log-1", listedAiringId: null, ...o },
  createdAt: NOW
});

describe("the options dialog", () => {
  it("reminds a log entry, or a listed meeting by its own id (B4)", () => {
    expect(reminderTarget(airing())).toEqual({ logEntryId: "log-1" });
    expect(reminderTarget(airing({ logEntryId: null, listedAiringId: "m-1", kind: "listed" }))).toEqual({ listedAiringId: "m-1" });
    expect(reminderTarget(airing({ logEntryId: null }))).toBeNull();
  });

  it("finds the reminder already set on this airing", () => {
    expect(reminderFor(undefined, airing())).toBeNull();
    expect(reminderFor([reminder()], airing())?.id).toBe("r-1");
    expect(reminderFor([reminder({ logEntryId: "log-2" })], airing())).toBeNull();
    const listed = airing({ logEntryId: null, listedAiringId: "m-1" });
    expect(reminderFor([reminder({ logEntryId: null, listedAiringId: "m-1", listed: true })], listed)?.id).toBe("r-1");
  });

  it("says what each button does in each state", () => {
    expect(remindText(null)).toEqual({ label: "Remind me", detail: "On this TV and your phone" });
    expect(remindText(reminder())).toEqual({ label: "Reminder set", detail: "OK to remove" });
    expect(switchText(null, START, TZ)).toEqual({ label: "Switch me over at 9:00", detail: null });
    expect(switchText(reminder({}, false), START, TZ).label).toBe("Switch me over at 9:00");
    expect(switchText(reminder({}, true), START, TZ)).toEqual({ label: "Switching over at 9:00", detail: "OK to turn off" });
  });

  it("adds, updates or removes the reminder; signed out, it hands off to signing in", () => {
    expect(reminderAction("remind", null, false)).toEqual({ kind: "signIn" });
    expect(reminderAction("switch", null, false)).toEqual({ kind: "signIn" });
    expect(reminderAction("remind", null, true)).toEqual({ kind: "add", switchMeOver: false });
    expect(reminderAction("remind", reminder(), true)).toEqual({ kind: "remove", reminderId: "r-1" });
    expect(reminderAction("switch", null, true)).toEqual({ kind: "add", switchMeOver: true });
    expect(reminderAction("switch", reminder({}, false), true)).toEqual({ kind: "update", reminderId: "r-1", switchMeOver: true });
    expect(reminderAction("switch", reminder({}, true), true)).toEqual({ kind: "update", reminderId: "r-1", switchMeOver: false });
  });

  it("says the day in words", () => {
    expect(optionsWhen(START, BEAT, NOW, TZ)).toBe("Tonight, 9:00 pm, BEAT 12.1");
    expect(optionsWhen("2026-09-27T16:00:00.000Z", BEAT, NOW, TZ)).toBe("Sunday, 9:00 am, BEAT 12.1");
    expect(optionsWhen("2026-10-04T03:00:00.000Z", BEAT, NOW, TZ)).toBe("October 3, 8:00 pm, BEAT 12.1");
  });

  it("says what's on the station now under Tune to", () => {
    expect(tuneDetail("Saturday Reel", true)).toBe("Saturday Reel is on");
    expect(tuneDetail("Saturday Reel", false)).toBe("Off air now");
    expect(tuneDetail(null, undefined)).toBeNull();
  });

  it("holds a reminder asked for while signed out, for that airing, once", () => {
    holdReminder("log-1", true);
    expect(heldReminderKey()).toBe("log-1");
    expect(takeHeldReminder("log-2")).toBeNull();
    expect(takeHeldReminder("log-1")).toEqual({ switchMeOver: true });
    expect(takeHeldReminder("log-1")).toBeNull();
    expect(heldReminderKey()).toBeNull();
  });
});

describe("the guide's mock states", () => {
  it("reads the state from the address", () => {
    expect(guideStateFrom("?guideState=error")).toBe("error");
    expect(guideStateFrom("?x=1&guideState=empty")).toBe("empty");
    expect(guideStateFrom("?guideState=loading")).toBe("loading");
    expect(guideStateFrom("?guideState=other")).toBeNull();
    expect(guideStateFrom("")).toBeNull();
  });
});
