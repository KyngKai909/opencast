// Watch data (added 2026-09-29, follow-up Phase 1) for the mock evening, in the contract's shapes:
// each airing's watch time (listening time on the radio band), audience at start, peak and end,
// stayed to the end, tune-aways by minute and "Not for me" votes (`AiringWatch`, on the Audience
// page's program rows), and a maker's programs across every station that aired them
// (`MakerWatchData`, Offering your programs).
//
// The rules are the API's: numbers show only for an airing with `watch_data.minimum_audience`
// viewers at once at some point (20; read from the desk's rules, so raising it in the desk's
// Settings shows "Not enough viewers yet" here too); an airing on now is `counting`; a maker sees
// other stations' airings only added together, two or more reaching the minimum between them.
//
// The states, as the fixtures have them: BEAT tonight, Crate Session 02 and Late Crate ep. 14 shown
// (watch time), Saturday Reel counting (on now); HALL tonight (the radio band) in listening time.
// BEAT as a maker: Late Crate across BEAT, HALL and SAZN; Beat Tape Live with CRAT's airings left
// out (one station's alone); Crate Talk under the minimum. Inland Sound Lab (a studio): Crate
// Diggers Radio Hour on four radio stations (listening time), Studio Notes on SAZN and REEL.

import { NOT_ENOUGH_VIEWERS, RULES, type AiringWatch, type Band, type MakerProgramWatch, type MakerWatchData } from "@opencast/contracts";
import { valueAt } from "../../../desk/mocks/settingsDb";
import { PROGRAM_IDS } from "./library";
import { BEAT, LAB } from "./stations";

type Minimum = { viewers: number; carriedAirings: number };

/** The registry's minimum audience (the desk's mock rules, as the API reads the registry). */
export function minimumAudience(): Minimum {
  try {
    return valueAt("watch_data.minimum_audience") as Minimum;
  } catch {
    return RULES["watch_data.minimum_audience"].fallback;
  }
}

const timeLabel = (band: Band | null) => (band === "radio" ? ("listening_time" as const) : ("watch_time" as const));

/** Tonight's "Not for me" votes that counted, by airing title. */
const NOT_FOR_ME: Record<string, number> = { "Crate Session 02": 4, "Late Crate, ep. 14": 2, "Study Beats": 1 };

/** People who leave while others arrive: a small, steady churn on top of the line's own drops. */
const churn = (i: number, v: number) => Math.round(v * 0.01 * (1 + ((i * 7) % 5) / 2));

/**
 * An airing's watch data from its minutes on the line (viewers each minute, as the Audience page
 * draws them). `stayed` is the percent still there at the end (the fixture's frame number).
 */
export function airingWatchOf(title: string, values: number[], o: { onNow: boolean; band: Band | null; stayed: number | null }): AiringWatch {
  const blank = { watchMinutes: null, audienceAtStart: null, peakAudience: null, audienceAtEnd: null, stayedToTheEnd: null, tuneAways: null, notForMe: null };
  if (o.onNow || !values.length) return { status: "counting", note: null, timeLabel: timeLabel(o.band), ...blank };
  const peak = Math.max(...values);
  if (peak < minimumAudience().viewers) return { status: "not_enough_viewers", note: NOT_ENOUGH_VIEWERS, timeLabel: timeLabel(o.band), ...blank };
  return {
    status: "shown",
    note: null,
    timeLabel: timeLabel(o.band),
    watchMinutes: values.reduce((a, v) => a + v, 0),
    audienceAtStart: values[0],
    peakAudience: peak,
    audienceAtEnd: values[values.length - 1],
    stayedToTheEnd: o.stayed,
    tuneAways: values.map((v, i) => (i === 0 ? 0 : Math.max(0, values[i - 1] - v) + churn(i, v))),
    notForMe: NOT_FOR_ME[title] ?? 0
  };
}

// ---------------------------------------------------------------- the maker's view

interface Airings {
  /** The station, by name only here: the answer never names it. */
  station: string;
  own: boolean;
  band: Band;
  perMonth: number;
  /** One airing's typical numbers. */
  start: number;
  peak: number;
  end: number;
  stayedPercent: number;
  notForMePerAiring: number;
}

interface MakerProgram {
  programId: string;
  title: string;
  minutes: number;
  airings: Airings[];
}

const air = (station: string, own: boolean, band: Band, perMonth: number, start: number, peak: number, end: number, stayedPercent: number, notForMePerAiring = 0): Airings => ({ station, own, band, perMonth, start, peak, end, stayedPercent, notForMePerAiring });

const MAKERS: Record<string, MakerProgram[]> = {
  [BEAT.id]: [
    // Late Crate: BEAT nightly, HALL nightly at 3:00 am (radio: listening time), SAZN Sundays.
    { programId: PROGRAM_IDS.lateCrate, title: "Late Crate", minutes: 30, airings: [air("BEAT", true, "tv", 30, 240, 301, 226, 79, 1), air("SAZN", false, "tv", 4, 38, 52, 41, 71), air("HALL", false, "radio", 27, 14, 21, 12, 64)] },
    // Crate Session: BEAT's own only.
    { programId: PROGRAM_IDS.crateSession, title: "Crate Session", minutes: 120, airings: [air("BEAT", true, "tv", 6, 150, 241, 180, 62, 2)] },
    // Beat Tape Live: BEAT's own, and CRAT's one airing a week (one station alone: left out).
    { programId: PROGRAM_IDS.beatTapeLive, title: "Beat Tape Live", minutes: 60, airings: [air("BEAT", true, "tv", 4, 290, 410, 340, 74), air("CRAT", false, "radio", 1, 30, 44, 35, 70)] },
    // Crate Talk: a handful live, under the minimum.
    { programId: PROGRAM_IDS.crateTalk, title: "Crate Talk", minutes: 30, airings: [air("BEAT", true, "tv", 2, 6, 9, 5, 50)] }
  ],
  [LAB.id]: [
    { programId: PROGRAM_IDS.crateDiggers, title: "Crate Diggers Radio Hour", minutes: 60, airings: [air("HALL", false, "radio", 20, 22, 31, 20, 68), air("NITE", false, "radio", 4, 40, 55, 44, 72, 1), air("VOZE", false, "radio", 4, 25, 33, 26, 70), air("DUST", false, "radio", 4, 12, 18, 11, 61)] },
    { programId: PROGRAM_IDS.studioNotes, title: "Studio Notes", minutes: 30, airings: [air("SAZN", false, "tv", 10, 20, 27, 19, 66), air("REEL", false, "tv", 7, 31, 40, 30, 70)] }
  ]
};

/** A tune-away line for one airing: a few at the start, a dip in the middle (the break), more near the end. */
function tuneAwayShape(minutes: number, start: number, end: number): number[] {
  const leaving = Math.max(0, start - end) + Math.round(start * 0.2);
  const weights = Array.from({ length: minutes }, (_, i): number => (i === 0 ? 0 : i < 4 ? 3 : Math.abs(i - minutes / 2) < 2 ? 4 : i > minutes - 5 ? 2 : 1));
  const total = weights.reduce((a, w) => a + w, 0);
  const out = weights.map((w) => Math.floor((w / total) * leaving));
  let left = leaving - out.reduce((a, v) => a + v, 0);
  for (let i = 1; left > 0; i = (i % (minutes - 1)) + 1, left--) out[i]++;
  return out;
}

/** A maker's programs across every station that aired them in the window (the API's rules). */
export function makerWatchData(stationId: string, fromIso: string, toIso: string): MakerWatchData {
  const days = Math.max(0, (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
  const min = minimumAudience();
  const programs: MakerProgramWatch[] = [];
  for (const p of MAKERS[stationId] ?? []) {
    for (const band of ["tv", "radio"] as const) {
      const rows = p.airings
        .filter((a) => a.band === band)
        .map((a) => ({ ...a, n: Math.round((a.perMonth * days) / 30) }))
        .filter((a) => a.n > 0);
      if (!rows.length) continue;
      const own = rows.filter((a) => a.own);
      const others = rows.filter((a) => !a.own);
      const otherAirings = others.reduce((s, a) => s + a.n, 0);
      const othersCount = otherAirings >= min.carriedAirings && others.reduce((s, a) => s + a.n * a.peak, 0) >= min.viewers;
      const counted = othersCount ? rows : own;
      const sum = (f: (a: (typeof rows)[number]) => number) => counted.reduce((s, a) => s + a.n * f(a), 0);
      const combinedPeak = sum((a) => a.peak);
      const base = { programId: p.programId, title: p.title, band, timeLabel: timeLabel(band), notCounted: { airings: othersCount ? 0 : otherAirings } };
      if (!counted.length || combinedPeak < min.viewers) {
        programs.push({ ...base, status: "not_enough_viewers", note: NOT_ENOUGH_VIEWERS, stations: 0, airings: 0, totals: null });
        continue;
      }
      const shapes = counted.map((a) => ({ n: a.n, line: tuneAwayShape(p.minutes, a.start, a.end) }));
      programs.push({
        ...base,
        status: "shown",
        note: null,
        stations: counted.length,
        airings: counted.reduce((s, a) => s + a.n, 0),
        totals: {
          // Each airing's average audience over its minutes.
          watchMinutes: sum((a) => Math.round(((a.start + a.peak + a.end) / 3) * p.minutes)),
          audienceAtStart: sum((a) => a.start),
          combinedPeak,
          audienceAtEnd: sum((a) => a.end),
          stayedToTheEnd: Math.round((sum((a) => (a.start * a.stayedPercent) / 100) / sum((a) => a.start)) * 100),
          tuneAways: Array.from({ length: p.minutes }, (_, i) => shapes.reduce((s, x) => s + x.n * x.line[i], 0)),
          notForMe: sum((a) => a.notForMePerAiring)
        }
      });
    }
  }
  programs.sort((a, b) => a.title.localeCompare(b.title) || a.band.localeCompare(b.band));
  return { from: fromIso, to: toIso, programs };
}
