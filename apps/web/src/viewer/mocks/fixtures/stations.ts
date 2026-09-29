// The stations, markets and programs in the reference files (viewer/opencast-home.html and the
// rest): the Inland Empire at 8:42 pm on a Saturday. Illustrations, used as mock data.

import type { StationIdent } from "@opencast/contracts";

export interface MockStation {
  ident: StationIdent;
  /** Station page and search (contract request S1, S6). */
  category: string;
  description: string;
  about?: string;
  members?: number;
  onDialSince?: string;
  hours?: string;
  /** Which mock stream plays it (packages/player/mock), or an embed for a listed city stream. */
  stream: { kind: "hls"; slug: string } | { kind: "embed"; url: string } | null;
}

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function station(n: number, callSign: string, channel: string, name: string, colour: string, band: "tv" | "radio", market: string, extra: Omit<MockStation, "ident">, kind: StationIdent["kind"] = "station", homeCity = "Redlands"): MockStation {
  return {
    ident: { id: uid(n), kind, callSign, handle: callSign.toLowerCase(), name, colour, band, channel, marketSlug: market, homeCity },
    ...extra
  };
}

const IE = "inland-empire";
const HD = "high-desert";

export const STATIONS: MockStation[] = [
  station(7, "CIVC", "7.1", "Inland Civic", "#2E6B5A", "tv", IE, { category: "Public affairs", description: "Town halls and council meetings, unedited.", about: "Inland Civic airs every public meeting in the Inland Empire in full, with questions from viewers.", members: 188, onDialSince: "2026-06-02", hours: "On air 6:00 am to 1:00 am.", stream: { kind: "hls", slug: "civc" } }),
  station(9, "RDLS", "9.1", "Redlands Public Access", "#4F5B2A", "tv", IE, { category: "Public affairs", description: "The City of Redlands' own channel.", stream: { kind: "embed", url: "/mock-embed/rdls.html" } }, "listed"),
  station(12, "BEAT", "12.1", "Inland Beat", "#8C3B7A", "tv", IE, { category: "Music", description: "Beat makers, crate diggers and the Inland Empire's producers.", about: "Inland Beat is run by a collective of producers in Redlands. Live from the studio on Saturdays.", members: 214, onDialSince: "2026-07-18", hours: "On air all day.", stream: { kind: "hls", slug: "beat" } }),
  station(18, "SAZN", "18.1", "Sazón", "#A3402A", "tv", IE, { category: "Food", description: "Home cooking from Inland Empire kitchens.", members: 96, stream: { kind: "hls", slug: "sazn" } }, "station", "Fontana"),
  station(24, "REEL", "24.1", "Saturday Reel", "#9A5412", "tv", IE, { category: "Classic", description: "Restored public-domain films, cartoons and newsreels.", members: 301, stream: { kind: "hls", slug: "reel" } }, "station", "Riverside"),
  station(31, "PREP", "31.1", "Inland Preps", "#1F5E8C", "tv", IE, { category: "Sports", description: "High school football, basketball and the Friday scoreboard.", members: 142, stream: { kind: "hls", slug: "prep" } }, "station", "Rialto"),
  station(883, "NITE", "88.3", "Night Desk", "#33507A", "radio", IE, { category: "Classic", description: "Old-time radio overnight.", members: 96, stream: { kind: "hls", slug: "nite" } }, "station", "Riverside"),
  station(907, "HALL", "90.7", "Study Hall", "#56508A", "radio", IE, { category: "Music", description: "Slow beats for late work.", members: 64, stream: { kind: "hls", slug: "hall" } }),
  station(1019, "CRAT", "101.9", "Crate", "#7E2F35", "radio", IE, { category: "Music", description: "Producers and their tapes.", stream: { kind: "hls", slug: "crat" } }, "claimable"),
  station(1043, "VOZE", "104.3", "La Voz", "#1D6A70", "radio", IE, { category: "Music", description: "Oldies en español.", stream: { kind: "hls", slug: "voze" } }, "station", "San Bernardino"),
  // A thin market (home 08.2): two stations so far.
  station(5, "MOJV", "5.1", "Mojave Community", "#4F5B2A", "tv", HD, { category: "Public affairs", description: "Victorville and the High Desert.", stream: { kind: "hls", slug: "civc" } }, "station", "Victorville"),
  station(961, "DUST", "96.1", "Dust Radio", "#7E2F35", "radio", HD, { category: "Music", description: "Desert rock and country.", stream: { kind: "hls", slug: "crat" } }, "station", "Apple Valley")
];

export const MARKETS = [
  { id: uid(90001), slug: IE, name: "Inland Empire", timezone: "America/Los_Angeles", open: true, stationCount: 9, lat: 34.0556, lng: -117.1825 },
  { id: uid(90002), slug: "los-angeles", name: "Los Angeles", timezone: "America/Los_Angeles", open: true, stationCount: 14, lat: 34.0522, lng: -118.2437 },
  { id: uid(90003), slug: HD, name: "High Desert", timezone: "America/Los_Angeles", open: true, stationCount: 2, lat: 34.5362, lng: -117.2928 }
];

export const ZIPS: Record<string, string> = {
  "92373": IE, "92374": IE, "92324": IE, "92335": IE, "92501": IE, "92507": IE, "92376": IE, "92336": IE,
  "90012": "los-angeles", "90026": "los-angeles", "90028": "los-angeles", "90291": "los-angeles",
  "92392": HD, "92395": HD, "92308": HD
};

export function stationById(id: string): MockStation | undefined {
  return STATIONS.find((s) => s.ident.id === id);
}

/** By id, call sign or handle (getStation takes any of them). */
export function stationByRef(ref: string): MockStation | undefined {
  const r = ref.toLowerCase();
  return STATIONS.find((s) => s.ident.id === ref || s.ident.callSign?.toLowerCase() === r || s.ident.handle === r);
}

export function inMarket(slug: string, band?: "tv" | "radio"): MockStation[] {
  const order = (s: MockStation) => {
    const [a, b] = (s.ident.channel ?? "0.0").split(".").map(Number);
    return a * 100 + b;
  };
  return STATIONS.filter((s) => s.ident.marketSlug === slug && (!band || s.ident.band === band)).sort((a, b) => order(a) - order(b));
}

export function playbackFor(s: MockStation) {
  if (!s.stream) return null;
  return s.stream.kind === "hls" ? { kind: "hls" as const, url: `/mock-hls/${s.stream.slug}/master.m3u8` } : { kind: "embed" as const, url: s.stream.url };
}

export { uid };
