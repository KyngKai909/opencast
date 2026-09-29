// Sign-in's last step (you 01.3), as rules: when to ask the two questions, what they say, and the
// order things happen in when the person goes back: keep what's on this device, save the name,
// then finish the action that opened sign-in.

import type { DeviceState } from "../../device/store";

export type Held = Pick<DeviceState, "presets" | "reminders">;

export interface Questions {
  /** "Keep what's on this phone": only when there's something on it. */
  keep: boolean;
  /** The account has no name yet. The name field is shown whenever the step is (prefilled if there is one). */
  nameMissing: boolean;
}

/**
 * The step is a first sign-in's: asked when this device holds presets or reminders made signed
 * out, or the account has no name yet. Anything else is a returning sign-in, which goes straight
 * to the action.
 */
export function firstSignInQuestions(held: Held, me: { displayName: string | null } | null): Questions {
  return { keep: held.presets.length + held.reminders.length > 0, nameMissing: !me?.displayName };
}

export function asksAnything(q: Questions): boolean {
  return q.keep || q.nameMissing;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 presets and 1 reminder you made before signing in". */
export function keepLine(held: Held): string {
  const parts = [held.presets.length ? count(held.presets.length, "preset", "presets") : null, held.reminders.length ? count(held.reminders.length, "reminder", "reminders") : null].filter(Boolean);
  return `${parts.join(" and ")} you made before signing in`;
}

/** "Two things before you go back to CIVC." (the name, and keeping what's here when there's any). */
export function introLine(q: Questions, backTo: string | undefined): string {
  const n = q.keep ? "Two things" : "One thing";
  return backTo ? `${n} before you go back to ${backTo}.` : `${n} before you go back.`;
}

export interface FirstSignInIo {
  mergeDevice(held: Held): Promise<void>;
  clearDevice(): void;
  updateName(name: string): Promise<void>;
  /** Runs the action that opened sign-in, and closes it. */
  finish(): Promise<void>;
}

/**
 * The button that names the action ("Save CIVC 7.1 and go back"). What's on the device is added
 * to the account first, so the pending save lands after it; then the device copy is cleared (the
 * account has it now). An unchanged or empty name isn't sent. Both questions can be skipped.
 */
export async function completeFirstSignIn(input: { keep: boolean; held: Held; name: string; currentName: string | null }, io: FirstSignInIo): Promise<void> {
  if (input.keep && input.held.presets.length + input.held.reminders.length > 0) {
    await io.mergeDevice(input.held);
    io.clearDevice();
  }
  const name = input.name.trim();
  if (name && name !== input.currentName) await io.updateName(name);
  await io.finish();
}

/** An email address that could work: something@something.something. */
export function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
