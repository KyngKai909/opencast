// Off air hours and sign-offs (G9), in master control's words. Planned off air is a choice, not a
// mistake: it's drawn as a calm band on the log ("Off air", "Back at 6:00 am"), never as dead air,
// and nothing warns about it. The setting reads as the frame's pane does ("Sign off: Every night,
// 2:00 am", "Sign back on: 6:00 am"); the Monitor says "Off air, back at 6:00 am" or "Signs off
// at 2:00 am".

import type { OffAirRule, OffAirSpan, PlayoutStatus } from "@opencast/contracts";
import { clock } from "@opencast/ui";
import { STATION_TZ } from "../../../lib/clock";
import { dayClock } from "./time";

/** "2:00 am" from a rule's "02:00". */
export function wallClock(hhmm: string): string {
  return clock(`2000-01-01T${hhmm}:00Z`, { timeZone: "UTC" });
}

/** A rule as the frame's two lines: "Every night, 2:00 am" and "6:00 am", from its label. */
export function ruleLines(rule: Pick<OffAirRule, "label" | "signOffAt" | "backAt">): { signOff: string; back: string } {
  const at = rule.label.lastIndexOf(" to ");
  if (at > 0) return { signOff: rule.label.slice(0, at), back: rule.label.slice(at + 4) };
  return { signOff: `${rule.label}, ${wallClock(rule.signOffAt)}`, back: wallClock(rule.backAt) };
}

/** The next off air time: "Off air now, back at 6:00 am", or "Sun 2:00 am to 6:00 am". */
export function nextOffAirText(next: Pick<OffAirSpan, "startsAt" | "backAt"> | null, now: number, tz = STATION_TZ): string | null {
  if (!next) return null;
  const back = clock(next.backAt, { timeZone: tz });
  return Date.parse(next.startsAt) <= now ? `Off air now, back at ${back}` : `${dayClock(next.startsAt, tz)} to ${back}`;
}

const DAY = 86_400_000;

/** The Monitor's line: "Off air, back at 6:00 am" now, or "Signs off at 2:00 am" within 24 hours. */
export function monitorOffAirText(o: PlayoutStatus["offAir"], now: number, tz = STATION_TZ): string | null {
  if (!o) return null;
  if (o.now || Date.parse(o.startsAt) <= now) return `Off air, back at ${clock(o.backAt, { timeZone: tz })}`;
  if (Date.parse(o.startsAt) - now > DAY) return null;
  return `Signs off at ${clock(o.startsAt, { timeZone: tz })}`;
}

/** How a span reads on the log: the hours, or a one-off sign-off entry. */
export function offAirSource(span: Pick<OffAirSpan, "startsAt" | "backAt" | "source">, tz = STATION_TZ): string {
  const back = `Back at ${clock(span.backAt, { timeZone: tz })}`;
  return span.source === "sign_off" ? `Sign off at ${clock(span.startsAt, { timeZone: tz })}. ${back}` : `Off air hours. ${back}`;
}

/** The nights a rule can sign off on, Monday first as the log's days run; 0 is Sunday. */
export const NIGHTS: ReadonlyArray<{ value: string; label: string }> = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: String(d), label: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d] }));

/** Times on the half hour, for the sign-off and back-on selects ("02:00" reads "2:00 am"). */
export const HALF_HOURS: ReadonlyArray<{ value: string; label: string }> = Array.from({ length: 48 }, (_, i) => {
  const v = `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
  return { value: v, label: wallClock(v) };
});

/** A 400's field for a rule ("rules.0.backAt"): which rule it's about. */
export function ruleIndexOf(fields: Record<string, string> | undefined): number | null {
  for (const k of Object.keys(fields ?? {})) {
    const m = /^rules\.(\d+)\./.exec(k);
    if (m) return Number(m[1]);
  }
  return null;
}
