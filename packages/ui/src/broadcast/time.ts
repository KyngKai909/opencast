// Time helpers the broadcast components share. Every string still comes from lib/format.ts
// (clock, clockRange, duration); these only choose which form a place in the frames uses.

import type { CSSProperties } from "react";
import { clock, type TimeInput } from "../lib/format";

/** Milliseconds since the epoch for any time input. */
export function ms(value: TimeInput): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** "8:42": the clock without am/pm, as guide cells, schedules and log times write it. */
export function shortClock(value: TimeInput, timeZone?: string): string {
  return clock(value, { timeZone, suffix: false });
}

function period(value: TimeInput, timeZone?: string): string {
  return clock(value, { timeZone }).slice(-2);
}

/**
 * A time next to another time: "9:00" when it shares am/pm with `after`, "6:00 am" when it
 * doesn't. The dial's Next column and the radio band's "Next at" both work this way.
 */
export function clockAfter(value: TimeInput, after: TimeInput, timeZone?: string): string {
  return clock(value, { timeZone, suffix: period(value, timeZone) !== period(after, timeZone) });
}

/**
 * A column of times ("6:00 pm", "8:00", "8:30" … "12:00 am"): am/pm on the first, and again
 * wherever it changes.
 */
export function clockColumn(values: TimeInput[], timeZone?: string): string[] {
  return values.map((v, i) => clock(v, { timeZone, suffix: i === 0 || period(v, timeZone) !== period(values[i - 1], timeZone) }));
}

/** "8:00 – 9:30": a guide cell's span, without am/pm (the head row says it). */
export function shortSpan(start: TimeInput, end: TimeInput, timeZone?: string): string {
  return `${shortClock(start, timeZone)} – ${shortClock(end, timeZone)}`;
}

/** "6 pm": an hour on the log timeline. */
export function hourLabel(value: TimeInput, timeZone?: string): string {
  return clock(value, { timeZone }).replace(":00 ", " ");
}

/** "12 min", "2 hr 20 min", "1 hr": a length of time in words, rounded up to the minute. */
export function minutesText(length: number): string {
  const m = Math.max(0, Math.ceil(length / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} hr ${rest} min` : `${h} hr`;
}

/** "18 min left" (station page 01.1, the TV banner). */
export function timeLeft(now: TimeInput, end: TimeInput): string {
  return `${minutesText(ms(end) - ms(now))} left`;
}

/** Where `now` falls between `start` and `end`, from 0 to 1. */
export function fraction(now: TimeInput, start: TimeInput, end: TimeInput): number {
  const a = ms(start);
  const b = ms(end);
  if (b <= a) return 0;
  return Math.min(1, Math.max(0, (ms(now) - a) / (b - a)));
}

/** The station colour as a custom property, for components drawn in it. */
export function stationStyle(colour: string | undefined, style?: CSSProperties): CSSProperties | undefined {
  if (!colour) return style;
  return { ...style, ["--oc-station" as string]: colour } as CSSProperties;
}
