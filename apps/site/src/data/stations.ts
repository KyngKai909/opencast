// The stations on the site's dial: demo data, the one copy every page reads (from
// docs/reference/site/source/shared/shared_data.js). Stations, shows and people are examples.

export type Band = "tv" | "fm";

/** The canvas scene a station's picture is drawn with (src/lib/scenes.ts). */
export type SceneName = "civic" | "crate" | "kitchen" | "reel" | "field" | "matinee" | "radio" | "radio2" | "dunes";

export interface Station {
  /** Channel number as it reads on the dial ("12.1", "88.4"). */
  n: string;
  b: Band;
  cs: string;
  name: string;
  who: string;
  /** The station colour: pictures, marks, the room's tint (`--st`, `--np`). */
  c: string;
  /**
   * The colour for text in the station colour on night. Lighter only where `c` is under 4.5:1
   * on the grounds (BEAT, PREP); everywhere else it's `c` (docs/site/open-questions.md Q5).
   */
  ink: string;
  sc: SceneName;
  /** Minutes per program; the schedule repeats `p` all day. */
  len: number;
  p: readonly string[];
}

export const STATIONS: readonly Station[] = [
  { n: "7.1", b: "tv", cs: "CIVC", name: "Civic Channel", who: "Run by a residents’ group in Riverside", c: "#2F9A72", ink: "#2F9A72", sc: "civic", len: 120, p: ["Council Watch", "Neighborhood Hour", "Library Talks", "Council Watch, replay"] },
  { n: "12.1", b: "tv", cs: "BEAT", name: "Beat Tape TV", who: "Run by a crate digger in Pomona", c: "#C04A9E", ink: "#C75FA6", sc: "crate", len: 60, p: ["Late Crate", "Crate Session", "Beat Tape Live", "Overnight Crates"] },
  { n: "18.1", b: "tv", cs: "SAZN", name: "Sazón", who: "Run by a family kitchen in Fontana", c: "#E0583A", ink: "#E0583A", sc: "kitchen", len: 30, p: ["Tamales for forty", "Sunday Pozole", "Abuela’s Pantry", "Salsa School"] },
  { n: "24.1", b: "tv", cs: "REEL", name: "Saturday Reel", who: "Run by a film club in Redlands", c: "#D98A2B", ink: "#D98A2B", sc: "reel", len: 120, p: ["Saturday Reel", "Short Stack", "The Late Show", "Projector Room"] },
  { n: "31.1", b: "tv", cs: "PREP", name: "Prep Sports", who: "Run by high-school students in Upland", c: "#3478C6", ink: "#4D87C8", sc: "field", len: 180, p: ["Prep Football Live", "Game Film", "Locker Room"] },
  // Renamed from OCAT, which read as "Opencast" (open-questions Q11, docs/site/new-copy.md).
  { n: "60.1", b: "tv", cs: "MATN", name: "Classic Matinee", who: "Public-domain films from the network’s catalog", c: "#9A9CAB", ink: "#9A9CAB", sc: "matinee", len: 90, p: ["Classic Matinee", "Silent Hour", "Serial Saturday"] },
  { n: "88.4", b: "fm", cs: "NITE", name: "Night Shift Radio", who: "Run by two DJs in San Bernardino", c: "#5B7BE0", ink: "#5B7BE0", sc: "radio", len: 180, p: ["Night Shift", "Request Line", "Dawn Patrol"] },
  { n: "92.0", b: "fm", cs: "FLDR", name: "Mojave Field Recordings", who: "Desert sound, recorded and shared under CC BY", c: "#C9709A", ink: "#C9709A", sc: "dunes", len: 60, p: ["Wind at Amboy", "Joshua Tree, 4 am", "Kelso Dunes"] },
  { n: "104.2", b: "fm", cs: "VOZE", name: "La Voz del Valle", who: "Run by a radio collective in Coachella", c: "#EBA03A", ink: "#EBA03A", sc: "radio2", len: 60, p: ["Mañanitas", "La Hora Norteña", "Voces del Valle"] }
];

/** The station the nav's tuner shows on every page but Home (the reference pins it to BEAT). */
export const NOW_PLAYING = STATIONS[1]!;

export const byCallSign = (cs: string) => STATIONS.find((s) => s.cs === cs);

export interface Slot {
  i: number;
  /** Minutes after midnight. */
  start: number;
  end: number;
  prog: string;
  next: string;
  /** How far through the program, 0 to 1. */
  pct: number;
  /** Whole minutes left. */
  left: number;
}

/** What's on a station at `min` minutes after midnight (`slot()` in the reference). */
export function slot(s: Station, min: number): Slot {
  const i = Math.floor(min / s.len);
  return {
    i,
    start: i * s.len,
    end: (i + 1) * s.len,
    prog: s.p[i % s.p.length]!,
    next: s.p[(i + 1) % s.p.length]!,
    pct: (min - i * s.len) / s.len,
    left: Math.ceil((i + 1) * s.len - min)
  };
}
