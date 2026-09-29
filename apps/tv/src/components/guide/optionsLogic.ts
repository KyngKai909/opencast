// The options dialog's rules (tv 03.2): which reminder belongs to the airing, what Remind me and
// Switch me over say in each state, what pressing them does, and the day in words.

import { clock, type TimeInput } from "@opencast/ui";
import type { Reminder } from "@opencast/contracts";
import type { AiringX, StationIdentX } from "../../api/ext";
import { capital, dayWord } from "../station/when";
import { identText } from "./guideLogic";

/** The body that reminds this airing: a log entry, or a listed city meeting (B4). Null: it can't be. */
export function reminderTarget(a: AiringX): { logEntryId: string } | { listedAiringId: string } | null {
  if (a.logEntryId) return { logEntryId: a.logEntryId };
  if (a.listedAiringId) return { listedAiringId: a.listedAiringId };
  return null;
}

/** The account's reminder on this airing, if there is one. */
export function reminderFor(reminders: Reminder[] | undefined, a: AiringX): Reminder | null {
  if (!reminders) return null;
  return (
    reminders.find(
      (r) => (a.logEntryId && r.airing.logEntryId === a.logEntryId) || (a.listedAiringId && r.airing.listedAiringId === a.listedAiringId)
    ) ?? null
  );
}

export interface ButtonText {
  label: string;
  detail: string | null;
}

/** Remind me, and once it's set, "Reminder set", which OK removes. */
export function remindText(r: Reminder | null): ButtonText {
  return r ? { label: "Reminder set", detail: "OK to remove" } : { label: "Remind me", detail: "On this TV and your phone" };
}

/** Switch me over at 9:00, and once it's on, "Switching over at 9:00", which OK turns off. */
export function switchText(r: Reminder | null, startsAt: TimeInput, timeZone?: string): ButtonText {
  const at = clock(startsAt, { timeZone, suffix: false });
  return r?.switchMeOver ? { label: `Switching over at ${at}`, detail: "OK to turn off" } : { label: `Switch me over at ${at}`, detail: null };
}

export type ReminderAction =
  | { kind: "signIn" }
  | { kind: "add"; switchMeOver: boolean }
  | { kind: "update"; reminderId: string; switchMeOver: boolean }
  | { kind: "remove"; reminderId: string };

/** What OK on Remind me (`button: "remind"`) or Switch me over (`"switch"`) does. */
export function reminderAction(button: "remind" | "switch", r: Reminder | null, signedIn: boolean): ReminderAction {
  if (!signedIn) return { kind: "signIn" };
  if (button === "remind") return r ? { kind: "remove", reminderId: r.id } : { kind: "add", switchMeOver: false };
  if (!r) return { kind: "add", switchMeOver: true };
  return { kind: "update", reminderId: r.id, switchMeOver: !r.switchMeOver };
}

/** "Tonight, 9:00 pm, BEAT 12.1"; "Sunday, 9:00 am, …"; "October 3, 8:00 pm, …". */
export function optionsWhen(startsAt: TimeInput, s: StationIdentX, now: TimeInput, timeZone: string): string {
  return `${capital(dayWord(startsAt, now, timeZone))}, ${clock(startsAt, { timeZone })}, ${identText(s)}`;
}

/** Under "Tune to BEAT now": what's on there ("Saturday Reel is on"), or that it's off air. */
export function tuneDetail(nowTitle: string | null | undefined, onAir: boolean | undefined): string | null {
  if (onAir === false) return "Off air now";
  return nowTitle ? `${nowTitle} is on` : null;
}

// A reminder asked for while signed out: kept here while the phone signs the TV in, then set
// (the sign-in names the action and completes it afterwards).
let pending: { key: string; switchMeOver: boolean } | null = null;

export function holdReminder(key: string, switchMeOver: boolean) {
  pending = { key, switchMeOver };
}

/** The held reminder for this airing, once (it's cleared when taken). */
export function takeHeldReminder(key: string): { switchMeOver: boolean } | null {
  if (!pending || pending.key !== key) return null;
  const p = pending;
  pending = null;
  return { switchMeOver: p.switchMeOver };
}

export function heldReminderKey(): string | null {
  return pending?.key ?? null;
}
