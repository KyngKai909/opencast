// Tonight on every station, from the reference files (the home file's guide grid, the station
// page's schedule for BEAT, the radio rows). Times are local to the market on the base day: the
// reference's Saturday in mock mode, or today with the real clock.

import type { Airing, StationIdent } from "@opencast/contracts";
import { now } from "../../../lib/clock";
import { STATIONS, stationByRef, uid } from "./stations";

export interface MockAiring {
  id: string;
  stationId: string;
  title: string;
  episodeTitle?: string | null;
  /** The line under the title ("Beat showcase", "Overnight repeat"): contract request S4. */
  note?: string | null;
  /** Tonight's episode, described: contract request G5. */
  episodeDescription?: string | null;
  start: string;
  end: string;
  live?: boolean;
  listed?: boolean;
  carriedFrom?: string;
  programId: string | null;
  /** Planned off air (G9): its off air hours, or a sign-off on its log. `end` is when it's back. */
  offAir?: boolean;
}

// The base day, in the market's zone (Pacific time, UTC-7 in September).
const OFFSET_HOURS = 7;
const base = (() => {
  const d = new Date(now().getTime() - OFFSET_HOURS * 3600e3);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
})();

/** "20:30" (or "26:00" for 2:00 am the next day, "+2 18:00" for two days on) to an ISO time. */
function at(hhmm: string): string {
  const days = hhmm.startsWith("+") ? Number(hhmm.slice(1, hhmm.indexOf(" "))) : 0;
  const [h, m] = hhmm.replace(/^\+\d+ /, "").split(":").map(Number);
  return new Date(Date.UTC(base.y, base.m, base.d + days, h + OFFSET_HOURS, m)).toISOString();
}

let n = 0;
const P = (slug: string) => uid(700000 + [...slug].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 99999);

/** Programs (series) and who makes them. */
export const PROGRAMS: Record<string, { id: string; title: string; maker: string; description: string; live?: boolean; category: string }> = {
  "town-hall": { id: P("town-hall"), title: "Town Hall", maker: "CIVC", description: "Residents question the Planning Commission on the new accessory dwelling rules. Questions from the room and from viewers.", live: true, category: "Public affairs" },
  "planning": { id: P("planning"), title: "Planning Commission", maker: "CIVC", description: "The full meeting, unedited.", category: "Public affairs" },
  "council-watch": { id: P("council-watch"), title: "Council Watch", maker: "CIVC", description: "The week's council meetings across the Inland Empire, in an hour.", category: "Public affairs" },
  "coop-town-hall": { id: P("coop-town-hall"), title: "Co-op town hall", maker: "CIVC", description: "Members' questions, live.", live: true, category: "Public affairs" },
  "city-council": { id: P("city-council"), title: "City Council", maker: "RDLS", description: "Redlands City Council, from the city's own stream.", category: "Public affairs" },
  "late-crate": { id: P("late-crate"), title: "Late Crate", maker: "BEAT", description: "One producer, one crate of records, one hour.", category: "Music" },
  "saturday-reel": { id: P("saturday-reel"), title: "Saturday Reel", maker: "REEL", description: "Cartoons from 1928 to 1934, restored from the original prints.", category: "Classic" },
  "beat-tape-live": { id: P("beat-tape-live"), title: "Beat Tape Live", maker: "BEAT", description: "Producers play unreleased tapes and talk through how they were made. Live from the Redlands studio.", live: true, category: "Music" },
  "crate-session": { id: P("crate-session"), title: "Crate Session", maker: "BEAT", description: "Sessions from the Inland Beat library.", category: "Music" },
  // A229: Beat Tapes, BEAT 12.2 (the maker is named by its address: it shares BEAT's call sign).
  "beat-tapes": { id: P("beat-tapes"), title: "Beat Tapes", maker: "beat-12-2", description: "A producer's tape, start to finish, from the Inland Beat collective.", category: "Music" },
  "slow-hours": { id: P("slow-hours"), title: "Slow Hours", maker: "HALL", description: "Slow beats for late work.", category: "Music" },
  "tamales": { id: P("tamales"), title: "Tamales for forty", maker: "SAZN", description: "A family kitchen in Fontana makes tamales for a party of forty.", category: "Food" },
  "orange-street": { id: P("orange-street"), title: "Orange Street after hours", maker: "SAZN", description: "Redlands' Orange Street, after the kitchens close.", category: "Food" },
  "sazon-archive": { id: P("sazon-archive"), title: "Sazón archive", maker: "SAZN", description: "Recipes from the first season.", category: "Food" },
  "cartoons": { id: P("cartoons"), title: "Cartoons from 1928 to 1934", maker: "REEL", description: "Public domain, restored.", category: "Classic" },
  "newsreel": { id: P("newsreel"), title: "Newsreel hour", maker: "REEL", description: "Newsreels from the 1930s and 1940s.", category: "Classic" },
  "football": { id: P("football"), title: "Friday night football", maker: "PREP", description: "Inland Empire high school football.", category: "Sports" },
  "scoreboard": { id: P("scoreboard"), title: "Friday scoreboard", maker: "PREP", description: "Every score from the Inland Empire.", category: "Sports" },
  "radio-dramas": { id: P("radio-dramas"), title: "Radio dramas from the 1940s", maker: "NITE", description: "Old-time radio, overnight.", category: "Classic" },
  "night-desk": { id: P("night-desk"), title: "Night Desk", maker: "NITE", description: "Radio dramas from the 1940s.", category: "Classic" },
  "slow-beats": { id: P("slow-beats"), title: "Slow beats for late work", maker: "HALL", description: "All night.", category: "Music" },
  "producers-hour": { id: P("producers-hour"), title: "The Producers’ Hour", maker: "CRAT", description: "Producers play their tapes, live.", live: true, category: "Music" },
  "oldies": { id: P("oldies"), title: "Noche de oldies", maker: "VOZE", description: "Oldies en español.", category: "Music" },
  "mojave": { id: P("mojave"), title: "Victorville council", maker: "MOJV", description: "Victorville and Apple Valley meetings, in full.", live: true, category: "Public affairs" },
  "desert-rock": { id: P("desert-rock"), title: "Desert country, all night", maker: "DUST", description: "All night.", category: "Music" }
};

function a(callSign: string, start: string, end: string, title: string, program: keyof typeof PROGRAMS | null, o: Partial<Pick<MockAiring, "episodeTitle" | "episodeDescription" | "note" | "live" | "listed" | "carriedFrom" | "offAir">> = {}): MockAiring {
  const s = stationByRef(callSign)!;
  return { id: uid(800000 + ++n), stationId: s.ident.id, title, start: at(start), end: at(end), programId: program ? PROGRAMS[program].id : null, ...o };
}

export const AIRINGS: MockAiring[] = [
  // CIVC 7.1 (on air 6:00 am to 1:00 am)
  a("CIVC", "18:00", "20:00", "Council Watch", "council-watch", { note: "The week's meetings in an hour" }),
  a("CIVC", "20:00", "21:30", "Town Hall: backyard homes and ADUs", "town-hall", { live: true, note: "Live from Redlands City Hall" }),
  a("CIVC", "21:30", "23:00", "Planning Commission, Sept 24", "planning", { note: "Full meeting, unedited" }),
  a("CIVC", "23:00", "23:30", "Community notices", null),
  a("CIVC", "23:30", "24:30", "Council Watch", "council-watch", { note: "Repeat" }),
  a("CIVC", "+3 19:00", "+3 20:30", "Co-op town hall: members’ questions", "coop-town-hall", { live: true }),
  // RDLS 9.1 (external, the city's own stream)
  a("RDLS", "19:00", "21:15", "City Council, Sept 16 meeting", "city-council", { listed: true }),
  a("RDLS", "21:15", "21:45", "Community calendar", null, { listed: true }),
  a("RDLS", "21:45", "23:45", "Council Watch", "council-watch", { listed: true, carriedFrom: "CIVC" }),
  a("RDLS", "23:45", "26:00", "Slide loop", null, { listed: true }),
  a("RDLS", "+2 18:00", "+2 21:00", "City Council, regular meeting", "city-council", { listed: true, live: true }),
  // COLT 9.2 (external, the city's own stream link), from the city's agenda calendar.
  a("COLT", "18:00", "21:30", "City Council, regular meeting", null, { listed: true, live: true }),
  a("COLT", "+3 18:00", "+3 20:00", "Planning Commission", null, { listed: true, live: true }),
  // BEAT 12.1 (the station page's schedule)
  a("BEAT", "18:00", "20:00", "Crate Session 02", "crate-session", { note: "From the library" }),
  a("BEAT", "20:00", "20:30", "Late Crate, ep. 14", "late-crate", { episodeTitle: "ep. 14", note: "Beat showcase" }),
  a("BEAT", "20:30", "21:00", "Saturday Reel", "saturday-reel", { carriedFrom: "REEL", episodeTitle: "Cartoons from 1928 to 1934", episodeDescription: "Animated shorts from the late silent and early sound era, restored and in the public domain. Tonight: a steamboat, a haunted barn and a long-lost jazz short." }),
  a("BEAT", "21:00", "22:00", "Beat Tape Live", "beat-tape-live", { live: true, note: "Live from the Redlands studio" }),
  a("BEAT", "22:00", "23:00", "Late Crate, ep. 15", "late-crate", { episodeTitle: "ep. 15", note: "Beat showcase" }),
  a("BEAT", "23:00", "24:00", "Slow Hours", "slow-hours", { carriedFrom: "HALL" }),
  a("BEAT", "24:00", "26:00", "Late Crate, eps. 12 to 15", "late-crate", { note: "Overnight repeat" }),
  // BEAT 12.2 Beat Tapes (A229: the same owner's second station, sharing BEAT's call sign)
  a("beat-12-2", "18:00", "20:00", "Tape 31: Redlands summer", "beat-tapes"),
  a("beat-12-2", "20:00", "22:00", "Tape 32: Night drive", "beat-tapes"),
  a("beat-12-2", "22:00", "26:00", "Tapes all night", "beat-tapes"),
  // SAZN 18.1
  a("SAZN", "19:00", "20:00", "Sazón archive", "sazon-archive"),
  a("SAZN", "20:00", "21:00", "Tamales for forty", "tamales", { note: "A family kitchen in Fontana" }),
  a("SAZN", "21:00", "22:00", "Orange Street after hours", "orange-street"),
  a("SAZN", "22:00", "23:00", "Sazón archive", "sazon-archive"),
  // REEL 24.1
  a("REEL", "19:00", "20:00", "Newsreel hour", "newsreel"),
  a("REEL", "20:00", "21:00", "Cartoons from 1928 to 1934", "cartoons", { note: "Public domain, restored" }),
  a("REEL", "21:00", "22:00", "Newsreel hour", "newsreel"),
  a("REEL", "22:00", "23:00", "Cartoons from 1935", "cartoons"),
  // PREP 31.1
  a("PREP", "19:30", "22:00", "Football: Redlands East Valley at Citrus Valley", "football"),
  a("PREP", "22:00", "22:30", "Friday scoreboard", "scoreboard"),
  a("PREP", "22:30", "23:00", "Highlights", "scoreboard"),
  // Its off air hours (G9): every night, 11:00 pm to 6:00 am. One airing, sign-off to sign-on.
  a("PREP", "23:00", "30:00", "Off air", null, { offAir: true }),
  // Radio
  a("NITE", "20:00", "30:00", "Radio dramas from the 1940s", "radio-dramas", { episodeTitle: "The Hollow Door, part 2" }),
  a("HALL", "20:00", "26:00", "Slow beats for late work", "slow-beats"),
  a("CRAT", "20:00", "21:00", "The Producers’ Hour", "producers-hour", { live: true }),
  a("CRAT", "21:00", "23:00", "Sample Sunday", "producers-hour"),
  a("VOZE", "20:00", "24:00", "Noche de oldies", "oldies"),
  // High Desert
  a("MOJV", "20:00", "21:30", "Victorville council, special session", "mojave", { live: true }),
  a("MOJV", "21:30", "22:30", "Council Watch", "council-watch", { carriedFrom: "CIVC" }),
  a("DUST", "20:00", "30:00", "Desert country, all night", "desert-rock")
];

function identOf(callSign: string): StationIdent | null {
  return stationByRef(callSign)?.ident ?? null;
}

/** An airing as the contract's Airing. */
export function toAiring(x: MockAiring): Airing {
  // Planned off air: one "Off air" airing (code OPEN) from sign-off to when it's back (G9).
  if (x.offAir) return { logEntryId: x.id, title: "Off air", episodeTitle: null, code: "OPEN", kind: "off_air", startsAt: x.start, endsAt: x.end, live: false, carriedFrom: null, programId: null, backAt: x.end };
  return {
    logEntryId: x.listed ? null : x.id,
    title: x.title,
    episodeTitle: x.episodeTitle ?? null,
    code: "PGM",
    kind: x.listed ? "listed" : x.live ? "live" : "program",
    startsAt: x.start,
    endsAt: x.end,
    live: !!x.live,
    carriedFrom: x.carriedFrom ? identOf(x.carriedFrom) : null,
    programId: x.programId
  };
}

export function airingsFor(stationId: string): MockAiring[] {
  return AIRINGS.filter((x) => x.stationId === stationId).sort((p, q) => p.start.localeCompare(q.start));
}

/** What's on at `t`, and what's next. Off air between airings. */
export function nowNext(stationId: string, t: Date = now()): { now: MockAiring | null; next: MockAiring | null } {
  const iso = t.toISOString();
  const list = airingsFor(stationId);
  return { now: list.find((x) => x.start <= iso && iso < x.end) ?? null, next: list.find((x) => x.start > iso) ?? null };
}

export function inWindow(stationId: string, from: string, to: string): MockAiring[] {
  return airingsFor(stationId).filter((x) => x.end > from && x.start < to);
}

export function airingById(id: string): MockAiring | undefined {
  return AIRINGS.find((x) => x.id === id);
}

export { STATIONS };
