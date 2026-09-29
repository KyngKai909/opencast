// What home and the radio band draw beyond the shared schedule (fixtures/schedule.ts): the radio
// rows' lines ("All night", "Live from Riverside", "Oldies en español") and what comes on after
// the night's last airing ("Next at 6:00 am Morning desk"), from station-pages 04.1. Only the dial
// handler reads these; the shared schedule is unchanged.

import { AIRINGS, type MockAiring } from "./schedule";
import { stationByRef, uid } from "./stations";

/** Notes (contract request S4) on airings the shared schedule leaves without one. */
const NOTES: Array<{ callSign: string; title: string; note: string }> = [
  { callSign: "HALL", title: "Slow beats for late work", note: "All night" },
  { callSign: "CRAT", title: "The Producers’ Hour", note: "Live from Riverside" },
  { callSign: "VOZE", title: "Noche de oldies", note: "Oldies en español" }
];

/** What follows each radio station's last airing tonight. */
const AFTER_LAST: Array<{ callSign: string; title: string; hours: number }> = [
  { callSign: "NITE", title: "Morning desk", hours: 3 },
  { callSign: "HALL", title: "Quiet hours", hours: 4 },
  { callSign: "VOZE", title: "Madrugada", hours: 4 }
];

function idOf(callSign: string): string {
  return stationByRef(callSign)!.ident.id;
}

let built: MockAiring[] | null = null;

/** The shared schedule with home's notes and the airings after the last. */
export function homeAirings(): MockAiring[] {
  if (built) return built;
  const list = AIRINGS.map((a) => {
    const n = NOTES.find((x) => idOf(x.callSign) === a.stationId && x.title === a.title);
    return n && !a.note ? { ...a, note: n.note } : a;
  });
  AFTER_LAST.forEach((x, i) => {
    const mine = list.filter((a) => a.stationId === idOf(x.callSign)).sort((p, q) => q.end.localeCompare(p.end));
    const last = mine[0];
    if (!last) return;
    const end = new Date(Date.parse(last.end) + x.hours * 3600e3).toISOString();
    list.push({ id: uid(890000 + i), stationId: last.stationId, title: x.title, start: last.end, end, programId: null });
  });
  built = list;
  return list;
}

/** The schedule changed (a sign-off matched to the mock stream, fixtures/signoff.ts): build again. */
export function resetHomeAirings() {
  built = null;
}

/** What's on at `t` and what's next, from home's schedule. Off air between airings. */
export function homeNowNext(stationId: string, t: Date): { now: MockAiring | null; next: MockAiring | null } {
  const iso = t.toISOString();
  const list = homeAirings().filter((x) => x.stationId === stationId).sort((p, q) => p.start.localeCompare(q.start));
  return { now: list.find((x) => x.start <= iso && iso < x.end) ?? null, next: list.find((x) => x.start > iso) ?? null };
}

/**
 * Where a widely carried program is on in the market: the airing on now, or the next one. Listed
 * city streams aren't carriage (Opencast lists them, it doesn't restream them), so they're skipped.
 */
export function carriedPick(airings: MockAiring[], t: Date): { airing: MockAiring; onNow: boolean } | null {
  const iso = t.toISOString();
  const later = airings.filter((a) => !a.listed && a.end > iso).sort((x, y) => x.start.localeCompare(y.start));
  const on = later.find((a) => a.start <= iso);
  if (on) return { airing: on, onNow: true };
  return later[0] ? { airing: later[0], onNow: false } : null;
}
