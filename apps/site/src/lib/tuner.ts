// The hero's tuner: a sample of the Inland Empire dial, as the reference's script draws it. Channel
// up and down step through it in channel order and wrap; numbers tune (the rules' "Numbers tune"),
// the way the player's number entry does: 1 then 2 reads "12" with ".1" filled in, and radio
// frequencies type as digits (8, 8, 4 is 88.4). The radio band is on even tenths, 88.2 to 107.8,
// so no number here is a real FM station's.

export interface SampleStation {
  channel: string;
  callSign: string;
  name: string;
  /** The picture, in the station's colour (all hold 4.5:1 against white). */
  colour: string;
  title: string;
  sub: string;
  live?: boolean;
  radio?: boolean;
}

/** The reference's eight, in channel order. Illustrations, not current stations. */
export const SAMPLE_DIAL: readonly SampleStation[] = [
  { channel: "7.1", callSign: "CIVC", name: "Inland Civic", colour: "#2E6B5A", title: "Town Hall: backyard homes and ADUs", sub: "Live from Redlands City Hall, until 9:30 pm", live: true },
  { channel: "9.1", callSign: "RDLS", name: "Redlands Public Access", colour: "#4F5B2A", title: "City Council, regular meeting", sub: "From the city’s own stream" },
  { channel: "12.1", callSign: "BEAT", name: "Inland Beat", colour: "#8C3B7A", title: "Saturday Reel", sub: "Carried from REEL 24.1, until 9:00 pm" },
  { channel: "18.1", callSign: "SAZN", name: "Sazón", colour: "#A3402A", title: "Tamales for forty", sub: "A family kitchen in Fontana, until 9:00 pm" },
  { channel: "24.1", callSign: "REEL", name: "Saturday Reel", colour: "#9A5412", title: "Cartoons from 1928 to 1934", sub: "Public domain, restored, until 9:00 pm" },
  { channel: "31.1", callSign: "PREP", name: "Inland Preps", colour: "#1F5E8C", title: "Football: Redlands East Valley at Citrus Valley", sub: "Last night’s game, until 10:00 pm" },
  { channel: "88.4", callSign: "NITE", name: "Night Desk", colour: "#33507A", title: "Radio dramas from the 1940s", sub: "Radio band, until 6:00 am", radio: true },
  { channel: "102.0", callSign: "CRAT", name: "Crate", colour: "#7E2F35", title: "The Producers’ Hour", sub: "Radio band, live", live: true, radio: true }
];

/** Channel up (+1) or down (−1) from `index`, wrapping at the ends. */
export function step(index: number, delta: number, count: number = SAMPLE_DIAL.length): number {
  return (((index + delta) % count) + count) % count;
}

/** How long a typed number waits for another key before it tunes (the player's default). */
export const NUMBER_WAIT_MS = 2000;
const MAX_TYPED = 5;

/** Adds a digit or the dot to what's typed. Null when the key can't go on (too long, a second dot, a leading dot). */
export function typeKey(typed: string, key: string): string | null {
  if (key === ".") return !typed || typed.includes(".") ? null : `${typed}.`;
  if (!/^\d$/.test(key) || typed.length >= MAX_TYPED) return null;
  return `${typed}${key}`;
}

export interface Entry {
  typed: string;
  /** What the screen fills in after the typed part: ".1", "1" after a dot, or nothing. */
  filled: string;
  /** The index of the station it tunes to, or null: "No station on 13". */
  match: number | null;
}

/** The radio band's majors, 88 to 107. */
const onRadioBand = (major: number) => major >= 88 && major <= 107;

/**
 * Reads what's typed against the dial: 12 → 12.1, 884 → 88.4, 1020 → 102.0; a dot fills the
 * major's first number, 12. → 12.1, 88. → 88.2, 99. → 99.0. An odd radio tenth (991, a real FM
 * number) is never a station: nothing is filled in, and it says so.
 */
export function readEntry(typed: string, dial: readonly SampleStation[] = SAMPLE_DIAL): Entry {
  const find = (ch: string) => {
    const i = dial.findIndex((s) => s.channel === ch);
    return i < 0 ? null : i;
  };
  if (typed.includes(".")) {
    if (typed.endsWith(".")) {
      const major = Number(typed.slice(0, -1));
      const fill = onRadioBand(major) ? (major === 88 ? "2" : "0") : "1";
      return { typed, filled: fill, match: find(`${typed}${fill}`) };
    }
    return { typed, filled: "", match: find(typed) };
  }
  const tv = find(`${typed}.1`);
  if (tv !== null) return { typed, filled: ".1", match: tv };
  if (typed.length >= 3) {
    const radio = find(`${typed.slice(0, -1)}.${typed.slice(-1)}`);
    if (radio !== null) return { typed, filled: "", match: radio };
    if (onRadioBand(Number(typed.slice(0, -1)))) return { typed, filled: "", match: null };
  }
  return { typed, filled: ".1", match: null };
}

/** The words when a number has no station (the viewer app's "No station on 13"). */
export function noStation(entry: Entry): string {
  return `No station on ${entry.typed}`;
}
