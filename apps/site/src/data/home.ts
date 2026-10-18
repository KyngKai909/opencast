// Home's repeated content (from docs/reference/site/source/home/body.html and home.js). Copy is
// the reference's. Counts come from the station list, not literals.
import { STATIONS } from "./stations";

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
/** "Nine" for 9, digits past twelve. */
export const numberWord = (n: number) => WORDS[n] ?? String(n);

export const COUNTS = {
  all: STATIONS.length,
  tv: STATIONS.filter((s) => s.b === "tv").length,
  fm: STATIONS.filter((s) => s.b === "fm").length
};

/** The station the break plays on (BEAT in the reference). */
export const BREAK_STATION = "BEAT";

/** One part of the break: name, seconds, accent colour, caption headline and paragraph. */
export interface BreakPart {
  name: string;
  secs: number;
  color: string;
  head: string;
  body: string;
  /** Which renderer draws it (src/pages/home/break.ts). */
  kind: "program" | "bumper" | "juniper" | "redlands" | "members" | "id" | "back";
  /** The label under its timeline segment, if it has room. */
  label?: string;
}

export const BREAK_PARTS: readonly BreakPart[] = [
  { kind: "program", name: "Late Crate", secs: 10, color: "#C04A9E", head: "And now, a break.", body: "Late Crate wraps a segment. The break starts on time, because the station scheduled it.", label: "Late Crate" },
  { kind: "bumper", name: "Bumper", secs: 5, color: "#C04A9E", head: "The bumper.", body: "Five seconds in BEAT’s own look, so you always know where you are and when the show is back." },
  { kind: "juniper", name: "Juniper Barber Co.", secs: 30, color: "#E08A2C", head: "A spot from down the street.", body: "A barbershop bought thirty seconds on the station its customers watch. The code on the end card tells them it worked.", label: "Spot, 0:30" },
  { kind: "redlands", name: "Redlands Hardware", secs: 30, color: "#E8402F", head: "And a proper commercial.", body: "Shot like the ads you grew up with. Shops nearby and brands online buy spots by the station and the hour in the spot market.", label: "Spot, 0:30" },
  { kind: "members", name: "Members", secs: 15, color: "#5B7BE0", head: "A thank-you.", body: "Underwriters and members keep the station on, so they get a credit, like public television.", label: "Members" },
  { kind: "id", name: "Station ID", secs: 5, color: "#C04A9E", head: "The station ID.", body: "Call sign, number, market. The break ends where it started: on 12.1." },
  { kind: "back", name: "Late Crate", secs: 10, color: "#C04A9E", head: "And we’re back.", body: "A minute and forty-five seconds, all of it local, all of it paying the people who make the channel.", label: "Late Crate" }
];

export const BREAK_TOTAL = BREAK_PARTS.reduce((a, p) => a + p.secs, 0);

/** "1:45" */
export function mmss(s: number): string {
  s = Math.round(s);
  return `${Math.floor(s / 60)}:${s % 60 < 10 ? "0" : ""}${s % 60}`;
}

export const MEMBERS = ["Ana R.", "Luis M.", "Dee W.", "Marcus T.", "Priya S.", "The Okafor family", "Jo L.", "Ray C.", "Tomás A.", "Kim N.", "Bea F.", "Sam & Lu", "Hector V.", "Noor H.", "Grace P.", "Eli D.", "Rosa G.", "Ken Y.", "Maya B.", "Otis J.", "Lena K.", "Frank Q.", "Ivy Z.", "Pomona Vinyl Club", "Dario E.", "June A.", "Will S.", "Carmen O.", "Ty R.", "Ines L."];

/** The manifesto; `*word*` is lit hot. */
export const MANIFESTO = "Free to watch, every station *earns*, creators get *paid*, *rights* come first and the software stays *open*.";

export const PROMISES = [
  { title: "Free to watch", body: "No account to tune in, on a phone, a TV or a browser.", c: "#5B7BE0", d: 4, t: 2, m: 1 },
  { title: "Earned by the station", body: "Spots, sponsors and members' pledges go to the station that aired them.", c: "#E0583A", d: 4, t: 2, m: 1 },
  { title: "Paid before joining", body: "Shows aired with a creator's permission earn from day one. The money waits in escrow.", c: "#C04A9E", d: 4, t: 2, m: 1 },
  { title: "Rights first", body: "A claim takes a program off the air everywhere at once while it's sorted out.", c: "#2F9A72", d: 6, t: 3, m: 1 },
  { title: "Open source", body: "Anyone can see how the dial works and help make it better.", c: "#EBA03A", d: 6, t: 3, m: 2 }
] as const;
