// Times on the base day, in the station's zone: the reference's Saturday in mock mode (or today
// with the real clock). "20:28:30" is 8:28:30 pm; "26:00" is 2:00 am the next day; "+1 9:00" is
// 9:00 am tomorrow; "-1 20:00" is 8:00 pm yesterday.

import { config } from "../../config";
import { now } from "../../lib/clock";

// Pacific time, UTC-7 in September.
export const OFFSET_HOURS = 7;

// The reference's Saturday, even when `?clock=` starts the clock on another day: the evening
// stays where it's drawn.
const base = (() => {
  const d = new Date((config.mockClock ? Date.parse(config.mockClock) : now().getTime()) - OFFSET_HOURS * 3600e3);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
})();

export function at(hhmm: string): string {
  const m = /^(?:([+-]\d+) )?(\d+):(\d+)(?::(\d+))?$/.exec(hhmm.trim());
  if (!m) throw new Error(`at(): can't read ${hhmm}`);
  const days = m[1] ? Number(m[1]) : 0;
  return new Date(Date.UTC(base.y, base.m, base.d + days, Number(m[2]) + OFFSET_HOURS, Number(m[3]), Number(m[4] ?? 0))).toISOString();
}

export const MIN = 60_000;
export const SEC = 1000;
