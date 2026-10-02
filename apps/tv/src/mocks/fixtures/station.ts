// The station page, program page and search's own mock data, from viewer/opencast-station-pages.html:
// the rest of each station's week (tonight is in schedule.ts), what each station carries and
// makes for others, who makes each station possible, Saturday Reel's episodes and carriers, and the
// search frames' programs ("24 Hours", "Colton town hall").
//
// The shared schedule (schedule.ts) is left as it is; only an airing someone sets a reminder on
// joins it (registerReminded), so the account's mock (handlers/me.ts) can find it.

import { now } from "../../lib/clock";
import { getDb } from "../db";
import { AIRINGS, PROGRAMS, type MockAiring } from "./schedule";
import { stationByRef, uid } from "./stations";

// The base day, as schedule.ts works it out: the reference's Saturday in the market's zone.
const OFFSET_HOURS = 7;
const base = (() => {
  const d = new Date(now().getTime() - OFFSET_HOURS * 3600e3);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
})();

/** Day `day` after the base day at "HH:MM" ("26:00" is 2:00 am the next morning). */
export function atDay(day: number, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(base.y, base.m, base.d + day, h! + OFFSET_HOURS, m!)).toISOString();
}

/** The base day's weekday (6: the reference's Saturday). */
export const BASE_WEEKDAY = new Date(Date.UTC(base.y, base.m, base.d)).getUTCDay();

/** Programs only the station pages and search use. */
export const EXTRA_PROGRAMS: Record<string, { id: string; title: string; maker: string; description: string; category: string; live?: boolean }> = {
  "24-hours": { id: uid(760001), title: "24 Hours", maker: "SAZN", description: "A day at the county fair, hour by hour.", category: "Food" },
  colton: { id: uid(760002), title: "Colton town hall", maker: "RDLS", description: "Colton's district town halls, from the city's stream.", category: "Public affairs", live: true },
  "morning-desk": { id: uid(760003), title: "Morning desk", maker: "NITE", description: "The morning's papers, read aloud.", category: "Classic" },
  "quiet-hours": { id: uid(760004), title: "Quiet hours", maker: "HALL", description: "Slower still, until morning.", category: "Music" },
  madrugada: { id: uid(760005), title: "Madrugada", maker: "VOZE", description: "Boleros hasta el amanecer.", category: "Music" }
};

export function programByKey(key: string) {
  return PROGRAMS[key] ?? EXTRA_PROGRAMS[key];
}

export function programById(id: string) {
  return [...Object.values(PROGRAMS), ...Object.values(EXTRA_PROGRAMS)].find((p) => p.id === id);
}

// ---------------------------------------------------------------------------------------------
// The week (S5).

type Slot = [start: string, end: string, title: string, program: string | null, extra?: Partial<Pick<MockAiring, "episodeTitle" | "note" | "live" | "listed" | "carriedFrom">>];

/** Each station's day, by weekday (0 Sunday), by call sign (a family member's by its address). Times after 24:00 run into the next morning. */
const WEEK: Record<string, (weekday: number, day: number) => Slot[]> = {
  BEAT: (wd, day) => [
    ["06:00", "12:00", "Morning crates", "crate-session", { note: "From the library" }],
    ["12:00", "18:00", "Crate Session 02", "crate-session", { note: "From the library" }],
    ["18:00", "20:00", "Crate Session 03", "crate-session", { note: "From the library" }],
    ...(wd >= 1 && wd <= 5
      ? ([
          ["20:00", "21:00", `Late Crate, ep. ${15 + day}`, "late-crate", { episodeTitle: `ep. ${15 + day}`, note: "Beat showcase" }],
          ["21:00", "23:00", "Crate Session 04", "crate-session", { note: "From the library" }]
        ] as Slot[])
      : ([["20:00", "23:00", "Sunday crates", "crate-session", { note: "Three producers, one hour each" }]] as Slot[])),
    ["23:00", "24:00", "Slow Hours", "slow-hours", { carriedFrom: "HALL" }],
    ["24:00", "26:00", "Late Crate, repeats", "late-crate", { note: "Overnight repeat" }]
  ],
  // BEAT 12.2, the mock call-sign family member (keyed by its address, as fixtureKey files it).
  "BEAT-12-2": () => [
    ["18:00", "21:00", "Beat Tapes: side A", "beat-tapes", { note: "Back to back" }],
    ["21:00", "24:00", "Beat Tapes: side B", "beat-tapes", { note: "Back to back" }],
    ["24:00", "30:00", "Beat Tapes overnight", "beat-tapes", { note: "Overnight repeat" }]
  ],
  CIVC: (wd) => [
    ["06:00", "09:00", "Council Watch", "council-watch", { note: "Repeat" }],
    ["09:00", "12:00", "Planning Commission", "planning", { note: "Full meeting, unedited" }],
    ["18:00", "19:00", "Council Watch", "council-watch", { note: "The week's meetings in an hour" }],
    ...(wd === 3 ? ([["19:00", "21:00", "Board of Supervisors", "planning", { note: "Full meeting, unedited" }]] as Slot[]) : []),
    ["23:30", "25:00", "Council Watch", "council-watch", { note: "Repeat" }]
  ],
  RDLS: () => [
    ["09:00", "17:00", "Slide loop", null, { listed: true }],
    ["17:00", "18:00", "Community calendar", null, { listed: true }]
  ],
  SAZN: (wd, day) => [
    ...(wd === 0
      ? ([
          ["09:00", "09:30", "Saturday Reel", "saturday-reel", { carriedFrom: "REEL", episodeTitle: "Skeletons at midnight" }],
          ["14:00", "15:00", "24 hours at the fair", "24-hours", { note: "A day at the county fair" }]
        ] as Slot[])
      : []),
    ["19:00", "20:00", "Sazón archive", "sazon-archive"],
    ["20:00", "21:00", day % 2 ? "Orange Street after hours" : "Tamales for forty", day % 2 ? "orange-street" : "tamales"],
    ["21:00", "22:00", "Sazón archive", "sazon-archive"]
  ],
  REEL: () => [
    ["10:00", "12:00", "Newsreel hour", "newsreel", { note: "Morning repeat" }],
    ["19:00", "20:00", "Newsreel hour", "newsreel"],
    ["20:00", "21:00", "Cartoons from 1928 to 1934", "cartoons", { note: "Public domain, restored" }]
  ],
  PREP: (wd) => [
    ["18:00", "19:00", "Friday scoreboard", "scoreboard", { note: "Repeat" }],
    ...(wd === 5 ? ([["19:00", "22:00", "Friday night football", "football", { live: true }]] as Slot[]) : [])
  ],
  NITE: () => [
    ["06:00", "10:00", "Morning desk", "morning-desk"],
    ["20:00", "30:00", "Radio dramas from the 1940s", "radio-dramas"]
  ],
  HALL: () => [
    ["20:00", "26:00", "Slow beats for late work", "slow-beats"],
    ["26:00", "30:00", "Quiet hours", "quiet-hours"]
  ],
  CRAT: (wd) => [
    ...(wd >= 1 && wd <= 5 ? ([["20:00", "21:00", "The Producers’ Hour", "producers-hour", { live: true }]] as Slot[]) : []),
    ["21:00", "23:00", "Crate digging", "producers-hour"]
  ],
  VOZE: () => [
    ["20:00", "24:00", "Noche de oldies", "oldies"],
    ["24:00", "30:00", "Madrugada", "madrugada"]
  ],
  MOJV: () => [["20:00", "21:00", "High Desert tonight", "mojave"]],
  DUST: () => [["20:00", "24:00", "Desert rock", "desert-rock"]]
};

let n = 0;
function airing(callSign: string, day: number, [start, end, title, program, extra = {}]: Slot): MockAiring {
  const s = stationByRef(callSign)!;
  return { id: uid(860000 + ++n), stationId: s.ident.id, title, start: atDay(day, start), end: atDay(day, end), programId: program ? programByKey(program)?.id ?? null : null, ...extra };
}

function build(): MockAiring[] {
  const out: MockAiring[] = [];
  // Tonight, after what schedule.ts has: the radio band's "Next at 2:00 am Quiet hours" and "12:00 am Madrugada".
  out.push(airing("HALL", 0, ["26:00", "30:00", "Quiet hours", "quiet-hours"]));
  out.push(airing("VOZE", 0, ["24:00", "30:00", "Madrugada", "madrugada"]));
  // The next six days.
  for (let day = 1; day <= 6; day++) {
    const wd = (BASE_WEEKDAY + day) % 7;
    for (const [cs, slots] of Object.entries(WEEK)) for (const slot of slots(wd, day)) out.push(airing(cs, day, slot));
  }
  // Further out: Saturday Reel's episode 16 on REEL next Saturday, and the Colton town hall (search 03.1).
  out.push(airing("REEL", 7, ["20:00", "20:30", "Saturday Reel", "saturday-reel", { episodeTitle: "The jazz shorts" }]));
  out.push(airing("RDLS", 12, ["18:30", "20:30", "Colton town hall, district 3", "colton", { listed: true, live: true }]));
  return out;
}

const overlaps = (a: MockAiring, b: MockAiring) => a.stationId === b.stationId && a.start < b.end && b.start < a.end;

/** The rest of the week, dropping anything that would overlap an airing the shared schedule has. */
export const WEEK_AIRINGS: MockAiring[] = (() => {
  const built = build();
  const ids = new Set(built.map((x) => x.id));
  const shared = AIRINGS.filter((a) => !ids.has(a.id));
  return built.filter((x) => !shared.some((y) => overlaps(x, y)));
})();

/** Tonight from the shared schedule and the rest of the week from here, in time order. */
export function weekAirings(): MockAiring[] {
  const shared = AIRINGS.filter((a) => !WEEK_AIRINGS.some((w) => w.id === a.id));
  return [...shared, ...WEEK_AIRINGS].sort((a, b) => a.start.localeCompare(b.start));
}

export function weekAiringById(id: string): MockAiring | undefined {
  return AIRINGS.find((a) => a.id === id) ?? WEEK_AIRINGS.find((a) => a.id === id);
}

/**
 * A reminder on one of this file's airings: it joins the shared schedule, so the account's mock
 * (handlers/me.ts, which looks airings up there) can find it for the reminder and for You. Only
 * airings someone has reminded are added, so the dial and the guide stay as the shared schedule
 * draws them.
 */
export function registerReminded(ids: Array<string | undefined | null>) {
  for (const id of ids) {
    const x = id ? WEEK_AIRINGS.find((w) => w.id === id) : undefined;
    if (x && !AIRINGS.some((a) => a.id === x.id)) AIRINGS.push(x);
  }
}

// ---------------------------------------------------------------------------------------------
// The station page's side column (S6, S7, S8).

export interface StationExtra {
  /** The band's line after the name: "Music from producers around the Inland Empire, on air around the clock." */
  line?: string;
  about?: string;
  onDialSince?: string;
  carries?: Array<{ from: string; program: string; slot: string }>;
  madeHere?: Array<{ program: string; carriers: number }>;
  /** Underwriters, as they're read on air. The members' credit comes first when a station has members. */
  underwriters?: string[];
  /** Search's line for the station ("Public affairs. Town halls and council meetings"). */
  searchLine?: string;
}

export const STATION_EXTRA: Record<string, StationExtra> = {
  BEAT: {
    line: "Music from producers around the Inland Empire, on air around the clock.",
    about: "Run by a producer collective in Redlands. Beat showcases on weeknights, live sets on Saturdays, and carried programs overnight.",
    onDialSince: "2026-09-05",
    carries: [
      { from: "REEL", program: "saturday-reel", slot: "Saturdays 8:30 pm" },
      { from: "HALL", program: "slow-hours", slot: "nightly 11:00 pm" }
    ],
    madeHere: [{ program: "late-crate", carriers: 2 }],
    underwriters: ["Redlands Hardware", "Orange Street Coffee"],
    searchLine: "Music. Beat showcases and live sets"
  },
  CIVC: {
    line: "Town halls and council meetings from across the Inland Empire, unedited.",
    madeHere: [
      { program: "council-watch", carriers: 6 },
      { program: "town-hall", carriers: 2 }
    ],
    underwriters: ["Inland Empire Community Foundation"],
    searchLine: "Public affairs. Town halls and council meetings"
  },
  RDLS: { searchLine: "Public affairs. External, the city's own stream" },
  COLT: { searchLine: "Public affairs. External, the city's own stream" },
  SAZN: {
    carries: [{ from: "REEL", program: "saturday-reel", slot: "Sundays 9:00 am" }],
    madeHere: [{ program: "tamales", carriers: 3 }],
    underwriters: ["Mercado Fontana"],
    searchLine: "Food. Home cooking from Inland Empire kitchens"
  },
  REEL: {
    madeHere: [
      { program: "saturday-reel", carriers: 12 },
      { program: "newsreel", carriers: 1 }
    ],
    underwriters: ["Orange Street Coffee"],
    searchLine: "Classic, public domain"
  },
  PREP: { madeHere: [{ program: "football", carriers: 3 }], underwriters: ["Rialto Auto Body"], searchLine: "Sports. High school games and the Friday scoreboard" },
  NITE: { madeHere: [{ program: "night-desk", carriers: 4 }], searchLine: "Classic. Old-time radio overnight" },
  HALL: { madeHere: [{ program: "slow-hours", carriers: 1 }], searchLine: "Music. Slow beats for late work" },
  CRAT: { madeHere: [{ program: "producers-hour", carriers: 9 }], searchLine: "Music. Producers and their tapes" },
  VOZE: { searchLine: "Music. Oldies en español" },
  // The mock call-sign families (A229), by fixtureKey: X.1's extras stay its own.
  "BEAT-12-2": { line: "Beat tapes from Inland Beat's producers, back to back, evenings and overnight.", searchLine: "Music. Beat tapes, back to back" },
  RIVC: { searchLine: "Public affairs. External, the county's own stream" },
  "RIVC-15-2": { searchLine: "Public affairs. External, the county's own stream" },
  "RIVC-15-3": { searchLine: "Public affairs. External, the county's own stream" }
};

// ---------------------------------------------------------------------------------------------
// The program page (L1 to L4): Saturday Reel as drawn; other programs from the schedule alone.

const EP_TITLES = [
  "Steamboats", "Alley cats", "The circus comes to town", "Hot dogs", "Mice at sea", "Toyland", "Winter sports", "Bugs", "Moonlight", "The big parade",
  "Rain", "Haunted house", "Barnyard frolics", "River boats and paddle wheels", "Skeletons at midnight", "The jazz shorts", "Down on the farm", "Balloons",
  "The fire brigade", "Cannibal island", "Spring cleaning", "Sea shanties", "The mail pilot", "Night in the museum", "Tin can alley", "Rodeo", "Frogs",
  "The toy shop", "Snow white", "Kitchen band", "Pirates", "The old mill", "Picnic", "Trains", "Lullaby land", "Birds of a feather", "Flying mice",
  "The dance hall", "Harvest", "Goodnight"
];

export interface ProgramExtra {
  description?: string;
  rightsNote?: string;
  typicalLengthMs?: number;
  episodes?: Array<{ n: number; title: string; aired?: boolean; last?: { cs: string; day: number; at: string }; onNow?: { cs: string }; next?: { cs: string; title: string; day: number } }>;
  /** Where it airs in its market, with the slot in words. `allDay`: the maker's own station, airing it all day. */
  where?: Array<{ cs: string; slot: string; allDay?: boolean }>;
  carriers?: { total: number; outside: Array<{ callSign: string; channel: string; name: string; colour: string; market: string }> };
}

export const PROGRAM_EXTRA: Record<string, ProgramExtra> = {
  "saturday-reel": {
    description: "Animated shorts from the late silent and early sound era, cleaned up frame by frame. Each episode is three or four shorts around a theme.",
    rightsNote: "Public domain, restored",
    typicalLengthMs: 30 * 60e3,
    episodes: EP_TITLES.map((title, i) => {
      const n = i + 1;
      if (n === 13) return { n, title, aired: true, last: { cs: "REEL", day: 0, at: "20:00" } };
      if (n === 14) return { n, title, aired: true, onNow: { cs: "BEAT" } };
      if (n === 15) return { n, title, next: { cs: "SAZN", title: "Saturday Reel", day: 1 } };
      if (n === 16) return { n, title, next: { cs: "REEL", title: "Saturday Reel", day: 7 } };
      return { n, title, aired: n < 13 };
    }),
    where: [
      { cs: "BEAT", slot: "Saturdays at 8:30 pm" },
      { cs: "REEL", slot: "Saturdays, all day", allDay: true },
      { cs: "SAZN", slot: "Weekly" }
    ],
    carriers: {
      total: 12,
      outside: [
        { callSign: "LOOP", channel: "22.1", name: "Loop TV", colour: "#1F5E8C", market: "Los Angeles" },
        { callSign: "ECHO", channel: "27.1", name: "Echo Park Community", colour: "#56508A", market: "Los Angeles" },
        { callSign: "PIER", channel: "31.1", name: "Pier Television", colour: "#1D6A70", market: "Los Angeles" },
        { callSign: "VALE", channel: "40.1", name: "Valley Arts", colour: "#7E2F35", market: "Los Angeles" },
        { callSign: "MOJV", channel: "5.1", name: "Mojave Community", colour: "#4F5B2A", market: "High Desert" },
        { callSign: "CRUZ", channel: "14.1", name: "Santa Cruz Classic", colour: "#9A5412", market: "Santa Cruz" },
        { callSign: "FOGG", channel: "20.1", name: "Fog City", colour: "#33507A", market: "San Francisco" },
        { callSign: "DELT", channel: "25.1", name: "Delta Public", colour: "#2E6B5A", market: "Sacramento" },
        { callSign: "MESA", channel: "18.1", name: "Mesa Community", colour: "#A3402A", market: "Phoenix" }
      ]
    }
  }
};

/** An outside-market carrier's ident (they aren't on any dial in the mock). */
export function outsideIdent(c: { callSign: string; channel: string; name: string; colour: string }, i: number) {
  return { id: uid(770000 + i), kind: "station" as const, callSign: c.callSign, handle: c.callSign.toLowerCase(), name: c.name, colour: c.colour, band: "tv" as const, channel: c.channel, marketSlug: null, homeCity: null };
}

// Reminders kept from an earlier visit (the mock account lives in localStorage).
registerReminded(getDb().reminders.map((r) => r.airingId));
