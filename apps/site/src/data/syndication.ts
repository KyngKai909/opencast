// Syndication's content (docs/reference/site/source/syndication/body.py and synd.js). Copy is the
// reference's; shares come from pricing.ts; stations from stations.ts and dial.ts.
import { byCallSign } from "./stations";
import { DIAL } from "./dial";
import { pct, SHARES } from "./pricing";
import type { Qa } from "../components/Faq.astro";
import type { TickerItem } from "../components/Ticker.astro";

/** The show on the wire. */
export const SOURCE = byCallSign("SAZN")!;

/** The stations carrying it, placed around the hub (angle in degrees). Colours are the stations' own (the reference had CIVC and PREP off-palette). */
export const CARRIERS = [
  { cs: "BEAT", place: "Inland Empire", t: "cash", tv: "$2.50 an airing", a: -150 },
  { cs: "REEL", place: "Inland Empire", t: "share", tv: "30% revenue share", a: -108 },
  { cs: "MESA", place: "High Desert", t: "cash", tv: "$2.50 an airing", a: -72 },
  { cs: "ORNG", place: "Orange County", t: "cash", tv: "$1.00 + 15%", a: -30 },
  { cs: "LBCH", place: "Long Beach", t: "share", tv: "40% revenue share", a: 30 },
  { cs: "VALE", place: "Coachella Valley", t: "free", tv: "Free to carry", a: 72 },
  { cs: "PREP", place: "Inland Empire", t: "cash", tv: "$2.00 an airing", a: 108 },
  { cs: "CIVC", place: "Inland Empire", t: "free", tv: "Free to carry", a: 150 }
].map((c) => {
  const d = DIAL.find((x) => x.cs === c.cs)!;
  return { ...c, n: d.n, c: d.c ?? "#9A9CAB", t: c.t as "cash" | "share" | "free" };
});
export type Carrier = (typeof CARRIERS)[number];

/** The wire's week so far (the reference's starting figures). */
export const WIRE_START = { paid: 412.5, airings: 121 };

export const DEALS: TickerItem[] = [
  { badge: "24.1", color: "#D98A2B", html: "<b>REEL</b> picked up <b>Tamales for forty</b> <em>· 30% share · 2 min ago</em>" },
  { badge: "88.4", color: "#5B7BE0", html: "<b>NITE</b> is carrying <b>Crate Talk</b> <em>· $3.00 an airing · 9 min ago</em>" },
  { badge: "7.1", color: "#2F9A72", html: "<b>CIVC</b> added <b>Silent Hour</b> <em>· free · 14 min ago</em>" },
  { badge: "33.1", color: "#3478C6", html: "<b>MESA</b> picked up <b>Late Crate</b> <em>· 25% share · 21 min ago</em>" },
  { badge: "41.1", color: "#E0583A", html: "<b>ORNG</b> is carrying <b>Short Stack</b> <em>· $2.00 an airing · 33 min ago</em>" }
];

export const SIDES = [
  { L: "A", c: "#EBA03A", t: "You make shows", cta: "Offer it", steps: [["List it", "A series, a one-off or a weekly live show. Add the episodes, the length and a preview."], ["Set your terms", "A revenue share, a price per airing, or free. Choose where it can air and how often."], ["Approve carriers", "Say yes to each station, or let any station that fits carry it."]], go: "Offer a show" },
  { L: "B", c: "#2F9A72", t: "You run a station", cta: "Carry it", steps: [["Find what fits", "Pick an open slot and see every program that fits its length and time of day."], ["Request it", "The maker approves, and it goes in your schedule with its episodes in order."], ["Air it", "Series slots air the next episode each time. The station sells its own breaks; the maker gets their share automatically."]], go: "Browse the market" }
] as const;

export type Slot = "day" | "prime" | "late";
export type Terms = "share" | "cash" | "free";

export interface Program {
  id: string;
  t: string;
  by: string;
  c: string;
  len: number;
  eps: string;
  slot: Slot[];
  terms: Terms;
  tv: string;
  g: string;
}

/** The market's example programs, in "best fit" order. */
export const PROGRAMS: Program[] = [
  { id: "tamales-for-forty", t: "Tamales for forty", by: "18.1 SAZN", c: "#E0583A", len: 30, eps: "26 episodes", slot: ["day", "prime"], terms: "cash", tv: "$2.50 an airing", g: "Cooking" },
  { id: "late-crate", t: "Late Crate", by: "12.1 BEAT", c: "#C04A9E", len: 60, eps: "Weekly, live", slot: ["late"], terms: "share", tv: "25% revenue share", g: "Music" },
  { id: "saturday-reel", t: "Saturday Reel", by: "24.1 REEL", c: "#D98A2B", len: 120, eps: "40 films", slot: ["prime", "late"], terms: "share", tv: "40% revenue share", g: "Film" },
  { id: "game-film", t: "Game Film", by: "31.1 PREP", c: "#3478C6", len: 60, eps: "Weekly", slot: ["day", "prime"], terms: "free", tv: "Free to carry", g: "Sports" },
  { id: "silent-hour", t: "Silent Hour", by: "Network catalog", c: "#9A9CAB", len: 60, eps: "52 films, public domain", slot: ["late", "day"], terms: "free", tv: "Free to carry", g: "Film" },
  { id: "neighborhood-hour", t: "Neighborhood Hour", by: "7.1 CIVC", c: "#2F9A72", len: 60, eps: "Weekly", slot: ["day"], terms: "free", tv: "Free to carry", g: "Civic" },
  { id: "crate-talk", t: "Crate Talk", by: "Pomona Vinyl Club, a studio", c: "#7a3b8f", len: 30, eps: "12 episodes", slot: ["prime", "late"], terms: "cash", tv: "$3.00 an airing", g: "Talk" },
  { id: "wind-at-amboy", t: "Wind at Amboy", by: "92.0 FLDR", c: "#C9709A", len: 120, eps: "Field recordings, CC BY", slot: ["late"], terms: "free", tv: "Free to carry", g: "Ambient" },
  { id: "abuelas-pantry", t: "Abuela’s Pantry", by: "18.1 SAZN", c: "#E0583A", len: 30, eps: "18 episodes", slot: ["day"], terms: "share", tv: "30% revenue share", g: "Cooking" },
  { id: "serial-saturday", t: "Serial Saturday", by: "Network catalog", c: "#9A9CAB", len: 30, eps: "36 chapters, public domain", slot: ["day", "prime"], terms: "free", tv: "Free to carry", g: "Film" },
  { id: "short-stack", t: "Short Stack", by: "24.1 REEL", c: "#D98A2B", len: 30, eps: "60 shorts", slot: ["prime", "late"], terms: "cash", tv: "$2.00 an airing", g: "Film" }
];

/** Each filter's options, in order (an array, because object keys like "30" would sort first). */
export const FILTER_OPTIONS = {
  slot: [["any", "Any time"], ["day", "Daytime"], ["prime", "Prime"], ["late", "Late night"]],
  len: [["any", "Any length"], ["30", "30 min"], ["60", "60 min"], ["120", "2 h and up"]],
  terms: [["any", "Any terms"], ["share", "Revenue share"], ["cash", "Cash"], ["free", "Free"]],
  sort: [["fit", "Best fit"], ["short", "Shortest first"], ["long", "Longest first"], ["az", "A to Z"]]
} as const;
export type FilterKey = keyof typeof FILTER_OPTIONS;
export type FilterState = { [K in FilterKey]: (typeof FILTER_OPTIONS)[K][number][0] } & { q: string };
/** An option's label. */
export const optionLabel = (k: FilterKey, v: string) => (FILTER_OPTIONS[k] as readonly (readonly [string, string])[]).find((o) => o[0] === v)?.[1] ?? v;
export const FILTER_LABELS: Record<FilterKey, string> = { slot: "Slot", len: "Length", terms: "Terms", sort: "Sort" };
export const FILTER_START: FilterState = { slot: "any", len: "any", terms: "any", sort: "fit", q: "" };

/** Which programs fit, in the chosen order (synd.js fits() and sorted()). */
export function filterPrograms(f: FilterState, list: readonly Program[] = PROGRAMS): Program[] {
  const q = f.q.trim().toLowerCase();
  const r = list.filter((p) => (f.slot === "any" || p.slot.includes(f.slot)) && (f.len === "any" || (f.len === "120" ? p.len >= 120 : p.len === Number(f.len))) && (f.terms === "any" || p.terms === f.terms) && (!q || `${p.t} ${p.by} ${p.g}`.toLowerCase().includes(q)));
  if (f.sort === "short") r.sort((a, b) => a.len - b.len);
  else if (f.sort === "long") r.sort((a, b) => b.len - a.len);
  else if (f.sort === "az") r.sort((a, b) => a.t.localeCompare(b.t));
  return r;
}

export const fitCount = (n: number) => `${n}${n === 1 ? " program fits" : " programs fit"}`;
export const showCount = (n: number) => (n ? `Show ${n}${n === 1 ? " program" : " programs"}` : "Nothing fits");

export const TERMS_CARDS = [
  { n: "Revenue share", c: "#EBA03A", t: "A cut of what it earns", p: "The maker gets a share of the money the show brings the station, worked out by how much of the station's viewing it accounts for. Nothing up front.", ex: "Like 40% of the show's revenue", bar: [[40, "#EBA03A", "To the maker"], [60, "#C04A9E", "To the carrier"]] },
  { n: "Cash", c: "#2F9A72", t: "A price per airing", p: "A set price each time an episode airs, charged when it airs, never before. Add a smaller revenue share on top if you like.", ex: "Like $2.50 an airing, or $1 + 15%", bar: [[100, "#2F9A72", "Same price every airing"]] },
  { n: "Free", c: "#9A9CAB", t: "Just carry it", p: "No charge and no split. For public-domain films, city meetings and makers who want reach first.", ex: "Free to carry", bar: [[100, "#C04A9E", "To the carrier"]] }
] as const;

/** The station squares: 48 numbers, the first 32 on the network. Known stations show their real number and colour. */
const SQUARE_CS = ["BEAT", "REEL", "MESA", "ORNG", "LBCH", "VALE", "PREP", "CIVC", "NITE", "FLDR", "VOZE", "MATN", "ECHO", "CORT", "PASA", "SURF", "SKAT", "TIDE", "ROUT", "LOFI", "DUNE", "PALM", "MOJO", "FUZZ", "VINE", "HALO", "GLOW", "ROOT", "BOLT", "ARCO", "LUMA", "FADE", "RIFF", "LOOP", "TAPE", "ZINE", "PIER", "YUCA", "JADE", "OPAL", "SAGE", "PINE", "ROSA", "CRUZ", "VIBE", "NOOK", "MINT", "SODA"];
const COLS = ["#EBA03A", "#C04A9E", "#D98A2B", "#2F9A72", "#3478C6", "#E0583A", "#5B7BE0", "#C9709A"];
export const ON_NETWORK = 32;
export const SQUARES = SQUARE_CS.map((cs, i) => {
  const d = DIAL.find((x) => x.cs === cs);
  return { cs, n: d?.n ?? `${2 + ((i * 13) % 66)}.${1 + (i % 3)}`, c: d?.c ?? COLS[(i * 5) % COLS.length]!, open: i >= ON_NETWORK, delay: (i % 8) * 14 };
});

export const RIGHTS_RULES = [
  ["Every program has a rights record", "Who made it, who owns the music and footage, and the licence it airs under. No record, no carriage."],
  ["The maker decides where it airs", "Markets, TV or radio band, time of day, how many airings a week, and which outlets beyond the dial."],
  ["Every carrier is approved", "Approve each request, or let any station that fits carry it. A decline tells the station the reason you pick, never a note."],
  ["Ending is fair to both sides", "Give notice and the carrier keeps the show until the end date. Nobody wakes up to dead air."],
  ["A claim stops it everywhere at once", "If someone claims a program, it comes off every station's schedule while it's sorted out. The channel keeps running."]
] as const;

export const OUTLETS = [
  { n: "The dial", d: "Every market that carries it", on: true },
  { n: "Relays", d: "YouTube, Twitch and more, through each carrier", on: true },
  { n: "On demand", d: "The network's library of series and films", on: true },
  { n: "Plex and IPTV", d: "In each station's M3U playlist and guide", on: true },
  { n: "FAST channels", d: "Network channels on free streaming TV services", on: false }
] as const;

/** Who gets what on carriage: source, maker keeps, Dial keeps. */
export const CARRIAGE_SHARES = [
  ["Cash carriage, per airing", pct(1 - SHARES.syndicationCash), pct(SHARES.syndicationCash)],
  ["Revenue share, by watch time", "Their share", "0%"],
  ["Free carriage", "—", "0%"]
] as const;
export const CARRIAGE_NOTE = `Shares come from the carrier's earnings after the network's ${pct(SHARES.spotsBooked)} on spots, so nothing is taken twice. Card fees are passed through.`;

export const ESCROW_START = 1284.6;

export const SYND_FAQ: Qa[] = [
  { q: "Do I need a station to offer a show?", a: "No. Studios offer programs without a channel. If you run a station too, your shows can still travel to others." },
  { q: "What can I offer?", a: "A series, a one-off, or a weekly live show. Live programs air at the same time on every carrier; recorded ones air when each station schedules them." },
  { q: "How should I price it?", a: "A revenue share costs a new station nothing up front, so it's the easiest yes. A cash rate suits shows a station already wants. You can change terms at any time; new terms apply to new carriers." },
  { q: "Who pays if a carrier's balance runs out?", a: "Cash is charged when an episode airs, from the carrier's earnings first. A carrier that can't pay stops airing new episodes, and you're told." },
  { q: "Can I take a show back?", a: "Yes. Stop offering it and no one new can carry it. Stations already carrying it keep it until the notice you gave ends." },
  { q: "What about the public-domain catalog?", a: "The network keeps a catalog of public-domain films and recordings that any station can carry for free." }
];
