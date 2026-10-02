// Reminders on the TV (tv 03 note "Reminders reach the TV"): a signed-in TV reads the account's
// reminders and times the card itself. A minute before the start a card slides in ("Beat Tape
// Live is starting on BEAT 12.1. OK to switch."); with "Switch me over" the TV tunes by itself at
// the start. A Cast receiver has no account, so it gets neither (the phone would forward them).

import type { Reminder } from "@opencast/contracts";
import { identText } from "./offAir";

/** The card comes up a minute before the start… */
export const CARD_BEFORE_MS = 60_000;
/** …and goes two minutes after it. */
export const CARD_AFTER_MS = 120_000;
/** Switch me over still happens if the TV comes on within five minutes of the start. */
export const SWITCH_WITHIN_MS = 5 * 60_000;

type R = Pick<Reminder, "id" | "switchMeOver" | "airing">;

const start = (r: R) => Date.parse(r.airing.startsAt);

/** The reminder to show a card for now, if any: not dismissed, and not already on its station. */
export function reminderCard<T extends R>(list: T[], now: number, currentId: string | null, dismissed: ReadonlySet<string>): T | null {
  return (
    list
      .filter((r) => !dismissed.has(r.id) && r.airing.station.id !== currentId)
      .filter((r) => now >= start(r) - CARD_BEFORE_MS && now < start(r) + CARD_AFTER_MS)
      .sort((a, b) => start(a) - start(b))[0] ?? null
  );
}

/** A switch-me-over reminder whose start has come, not yet acted on (or waved away). */
export function switchDue<T extends R>(list: T[], now: number, done: ReadonlySet<string>): T | null {
  return list.find((r) => r.switchMeOver && !done.has(r.id) && now >= start(r) && now < start(r) + SWITCH_WITHIN_MS) ?? null;
}

/** "Beat Tape Live is starting on BEAT 12.1." */
export function cardText(r: R): string {
  return `${r.airing.title} is starting on ${identText(r.airing.station)}.`;
}
