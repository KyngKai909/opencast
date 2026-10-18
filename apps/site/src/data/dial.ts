// Every demo station on the network, by market: the stations on Home's dial (stations.ts) plus
// the other markets the Network page lists and the carriers the Syndication page names. One list,
// so "already on the dial" means the same thing everywhere (the call-sign checker, the Run footer,
// the waitlist mock). Demo data.
import { STATIONS } from "./stations";

export interface Market {
  id: string;
  n: string;
  d: string;
  c: string;
}

export const MARKETS: readonly Market[] = [
  { id: "ie", n: "Inland Empire", d: "Riverside and San Bernardino counties", c: "#5B7BE0" },
  { id: "la", n: "Los Angeles", d: "Los Angeles County", c: "#C04A9E" },
  { id: "oc", n: "Orange County", d: "Orange County", c: "#E0583A" },
  { id: "hd", n: "High Desert", d: "Victorville to the Mojave", c: "#C9709A" },
  { id: "cv", n: "Coachella Valley", d: "Palm Springs to Indio", c: "#EBA03A" }
];

export type Kind = "Station" | "Listed" | "Claimable" | "Catalog";

export interface DialEntry {
  cs: string;
  n: string;
  /** Market id; null for a station on the network whose market the site doesn't name. */
  mk: string | null;
  name?: string;
  who?: string;
  c?: string;
  kind?: Kind;
  progs?: readonly string[];
}

const home = (cs: string, kind: Kind, mk = "ie", who?: string): DialEntry => {
  const s = STATIONS.find((x) => x.cs === cs)!;
  return { cs, n: s.n, mk, name: s.name, who: who ?? s.who, c: s.c, kind, progs: s.p.slice(0, 3) };
};

export const DIAL: readonly DialEntry[] = [
  home("CIVC", "Listed"),
  home("BEAT", "Station"),
  home("SAZN", "Claimable", "ie", "A family kitchen in Fontana, run by us until they claim it"),
  home("REEL", "Station"),
  home("PREP", "Station"),
  home("MATN", "Catalog"),
  home("NITE", "Station"),
  { cs: "LOFI", n: "99.2", mk: "ie", name: "Lofi Hours", who: "The network’s own radio, beats to study to", c: "#7a6ad8", kind: "Catalog", progs: ["Lofi Hours", "Rain Tapes", "Late Study"] },
  home("VOZE", "Station", "cv"),
  { cs: "LBCH", n: "19.1", mk: "la", name: "Long Beach Sound", who: "Run by a record shop in Long Beach", c: "#2F9A72", kind: "Station", progs: ["Shop Sessions", "Harbor Hour", "Crate Night"] },
  { cs: "ECHO", n: "22.1", mk: "la", name: "Echo Park Sessions", who: "Run by a venue collective in Echo Park", c: "#C04A9E", kind: "Station", progs: ["Live at the Lake", "Soundcheck", "Encore"] },
  { cs: "CORT", n: "36.1", mk: "la", name: "Courtside", who: "Run by a pickup league in Inglewood", c: "#3478C6", kind: "Station", progs: ["Saturday Runs", "Pickup Live", "Tape Room"] },
  { cs: "PASA", n: "45.1", mk: "la", name: "Pasadena Access", who: "Public access, from the city’s own stream", c: "#9A9CAB", kind: "Listed", progs: ["City Council", "Arts Desk", "Community Bulletin"] },
  { cs: "SURF", n: "96.6", mk: "la", name: "Surf Report Radio", who: "Run by a surf shop in Venice", c: "#EBA03A", kind: "Station", progs: ["Dawn Patrol", "Swell Watch", "Sunset Set"] },
  { cs: "SKAT", n: "14.1", mk: "oc", name: "Skate Parks", who: "Run by a skate shop in Costa Mesa", c: "#E0583A", kind: "Station", progs: ["Park Sessions", "Bowl Jam", "Video Night"] },
  { cs: "ORNG", n: "41.1", mk: "oc", name: "Orange Talk", who: "Run by a podcast studio in Anaheim", c: "#EBA03A", kind: "Station", progs: ["Morning Desk", "Open Line", "The Late Read"] },
  { cs: "TIDE", n: "101.4", mk: "oc", name: "Tide Radio", who: "Run by a beach town collective", c: "#5B7BE0", kind: "Station", progs: ["High Tide", "Low Tide", "Night Swim"] },
  { cs: "MESA", n: "33.1", mk: "hd", name: "Mesa Music", who: "Run by a rehearsal space in Victorville", c: "#3478C6", kind: "Station", progs: ["Garage Hour", "Desert Demos", "Late Set"] },
  { cs: "ROUT", n: "66.1", mk: "hd", name: "Route 66 Reel", who: "Run by a drive-in in Barstow", c: "#D98A2B", kind: "Station", progs: ["Drive-in Double", "B-Side Cinema", "Midnight Reel"] },
  home("FLDR", "Station", "hd", "Desert sound, shared under CC BY"),
  { cs: "VALE", n: "27.1", mk: "cv", c: "#EBA03A", kind: "Station" },
  // On the network (Syndication's station squares); the site doesn't name their markets.
  ...["DUNE", "PALM", "MOJO", "FUZZ", "VINE", "HALO", "GLOW", "ROOT", "BOLT", "ARCO", "LUMA", "FADE"].map((cs, k): DialEntry => ({ cs, n: `${2 + (((k + 20) * 13) % 66)}.${1 + ((k + 20) % 3)}`, mk: null }))
];

export const DIAL_CALL_SIGNS: readonly string[] = DIAL.map((d) => d.cs);

export const marketName = (id: string | null) => MARKETS.find((m) => m.id === id)?.n ?? null;

/** "12.1 in Inland Empire", "on the network", or null when nobody has it. */
export function takenBy(cs: string): string | null {
  const d = DIAL.find((x) => x.cs === cs);
  if (!d) return null;
  const m = marketName(d.mk);
  return m ? `${d.n} in ${m}` : "on the network";
}

/** Numbers in use in the Inland Empire, for suggestions. */
export const IE_NUMBERS: ReadonlySet<string> = new Set(DIAL.filter((d) => d.mk === "ie").map((d) => d.n));
