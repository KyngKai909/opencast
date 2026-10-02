// The stations, markets and programs in the reference files (viewer/opencast-home.html and the
// rest): the Inland Empire at 8:42 pm on a Saturday. Illustrations, used as mock data.

import type { ExternalInfo, StationIdent } from "@opencast/contracts";
import { findByRef } from "../../lib/stationRef";

export interface MockStation {
  ident: StationIdent;
  /** Station page and search (contract request S1, S6). */
  category: string;
  description: string;
  about?: string;
  members?: number;
  onDialSince?: string;
  hours?: string;
  /** Which mock stream plays it (packages/player/mock), or an embed for a listed city stream. `dash`: a DASH stream link (A201, live-dash.mjs). */
  stream: { kind: "hls"; slug: string } | { kind: "dash"; slug: string } | { kind: "embed"; url: string } | null;
  /** An external station (follow-up Phase 6): whose stream it is, how it plays, where its schedule comes from. */
  external?: ExternalInfo;
}

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function station(n: number, callSign: string, channel: string, name: string, colour: string, band: "tv" | "radio", market: string, extra: Omit<MockStation, "ident">, kind: StationIdent["kind"] = "station", homeCity = "Redlands"): MockStation {
  return {
    // `slug` (A229): the station's part of every address, its call sign in lower case; a call-sign
    // family's members get theirs (and lose the handle) in withFamilies below.
    ident: { id: uid(n), kind, callSign, handle: callSign.toLowerCase(), name, colour, band, channel, marketSlug: market, homeCity, slug: callSign.toLowerCase() },
    ...extra
  };
}

const IE = "inland-empire";
const HD = "high-desert";

/**
 * Shared call signs (A229), as the API names them: every station of a family (X.1 and the X.n
 * sharing its call sign, same market and major) has `sharesCallSign`; X.1 keeps the call sign as
 * its slug ("rivc") and each member's slug carries its channel ("rivc-15-2"). Members have no
 * handle of their own, so no two stations share one.
 */
function withFamilies(list: MockStation[]): MockStation[] {
  const major = (s: MockStation) => `${s.ident.marketSlug}:${s.ident.band}:${s.ident.callSign}:${(s.ident.channel ?? "").split(".")[0]}`;
  return list.map((s) => {
    if (s.ident.band !== "tv" || !s.ident.callSign) return s;
    const family = list.filter((o) => major(o) === major(s));
    if (family.length < 2) return s;
    const head = s.ident.channel!.endsWith(".1");
    const slug = head ? s.ident.callSign.toLowerCase() : `${s.ident.callSign.toLowerCase()}-${s.ident.channel!.replace(".", "-")}`;
    return { ...s, ident: { ...s.ident, slug, handle: head ? s.ident.handle : null, sharesCallSign: true } };
  });
}

export const STATIONS: MockStation[] = withFamilies([
  station(7, "CIVC", "7.1", "Inland Civic", "#2E6B5A", "tv", IE, { category: "Public affairs", description: "Town halls and council meetings, unedited.", about: "Inland Civic airs every public meeting in the Inland Empire in full, with questions from viewers.", members: 188, onDialSince: "2026-06-02", hours: "On air 6:00 am to 1:00 am.", stream: { kind: "hls", slug: "civc" } }),
  station(9, "RDLS", "9.1", "Redlands Public Access", "#4F5B2A", "tv", IE, { category: "Public affairs", description: "The City of Redlands' own channel.", stream: { kind: "embed", url: "/mock-embed/rdls.html" }, external: { source: "City of Redlands", plays: "embed", schedule: "feed" } }, "listed"),
  // An external station's stream link (follow-up Phase 6): the city's own HLS, played in Opencast's player (packages/player/mock's "colt").
  station(92, "COLT", "9.2", "City of Colton", "#3F5A6E", "tv", IE, { category: "Public affairs", description: "Colton's council meetings, from the city's own stream.", stream: { kind: "hls", slug: "colt" }, external: { source: "City of Colton", plays: "stream_link", schedule: "feed" } }, "listed", "Colton"),
  // A DASH stream link (A201): a public-access channel's own DASH, played in Opencast's player
  // (packages/player/mock's "loma", served live by live-dash.mjs). A mock station, with no schedule.
  station(97, "LOMA", "9.7", "Loma Linda Community Access", "#5A4E7A", "tv", IE, { category: "Public affairs", description: "Public access from Loma Linda: commissions, the school board and community notices.", stream: { kind: "dash", slug: "loma" }, external: { source: "Loma Linda Community Access", plays: "stream_link", schedule: "none" } }, "listed", "Loma Linda"),
  station(12, "BEAT", "12.1", "Inland Beat", "#8C3B7A", "tv", IE, { category: "Music", description: "Beat makers, crate diggers and the Inland Empire's producers.", about: "Inland Beat is run by a collective of producers in Redlands. Live from the studio on Saturdays.", members: 214, onDialSince: "2026-07-18", hours: "On air all day.", stream: { kind: "hls", slug: "beat" } }),
  // A mock call-sign family (A229): the owner's own second station on 12.2, sharing BEAT's call sign
  // ("BEAT 12.2", /watch/beat-12-2). Its stream is packages/player/mock's "tape" alias, whose tags carry BEAT 12.2.
  station(122, "BEAT", "12.2", "Beat Tapes", "#8C3B7A", "tv", IE, { category: "Music", description: "Beat tapes from Inland Beat's producers, back to back.", members: 41, onDialSince: "2026-09-30", hours: "On air evenings and overnight.", stream: { kind: "hls", slug: "tape" } }),
  // A mock external call-sign family (A229): one county's three streams on 15.1, 15.2 and 15.3, all
  // RIVC (/watch/rivc, /watch/rivc-15-2, /watch/rivc-15-3). The mock stream server's "rivc", "rvpw"
  // and "rvlb" aliases: a source's own streams, with no Opencast tags. Nothing scheduled.
  station(151, "RIVC", "15.1", "Riverside County, Board of Supervisors", "#355C7D", "tv", IE, { category: "Public affairs", description: "The Board of Supervisors' meetings, from the county's own stream.", stream: { kind: "hls", slug: "rivc" }, external: { source: "Riverside County", plays: "stream_link", schedule: "none" } }, "listed", "Riverside"),
  station(152, "RIVC", "15.2", "Riverside County, Public Works", "#355C7D", "tv", IE, { category: "Public affairs", description: "Public Works hearings and project updates, from the county's own stream.", stream: { kind: "hls", slug: "rvpw" }, external: { source: "Riverside County", plays: "stream_link", schedule: "none" } }, "listed", "Riverside"),
  station(153, "RIVC", "15.3", "Riverside County Library Live", "#355C7D", "tv", IE, { category: "Public affairs", description: "Story times, author talks and classes from the county's libraries, from the county's own stream.", stream: { kind: "hls", slug: "rvlb" }, external: { source: "Riverside County", plays: "stream_link", schedule: "none" } }, "listed", "Riverside"),
  station(18, "SAZN", "18.1", "Sazón", "#A3402A", "tv", IE, { category: "Food", description: "Home cooking from Inland Empire kitchens.", members: 96, stream: { kind: "hls", slug: "sazn" } }, "station", "Fontana"),
  station(24, "REEL", "24.1", "Saturday Reel", "#9A5412", "tv", IE, { category: "Classic", description: "Restored public-domain films, cartoons and newsreels.", members: 301, stream: { kind: "hls", slug: "reel" } }, "station", "Riverside"),
  station(31, "PREP", "31.1", "Inland Preps", "#1F5E8C", "tv", IE, { category: "Sports", description: "High school football, basketball and the Friday scoreboard.", members: 142, stream: { kind: "hls", slug: "prep" } }, "station", "Rialto"),
  station(883, "NITE", "88.4", "Night Desk", "#33507A", "radio", IE, { category: "Classic", description: "Old-time radio overnight.", members: 96, stream: { kind: "hls", slug: "nite" } }, "station", "Riverside"),
  station(907, "HALL", "90.8", "Study Hall", "#56508A", "radio", IE, { category: "Music", description: "Slow beats for late work.", members: 64, stream: { kind: "hls", slug: "hall" } }),
  station(1019, "CRAT", "102.0", "Crate", "#7E2F35", "radio", IE, { category: "Music", description: "Producers and their tapes.", stream: { kind: "hls", slug: "crat" } }, "claimable"),
  station(1043, "VOZE", "104.4", "La Voz", "#1D6A70", "radio", IE, { category: "Music", description: "Oldies en español.", stream: { kind: "hls", slug: "voze" } }, "station", "San Bernardino"),
  // A thin market (home 08.2): two stations so far.
  station(5, "MOJV", "5.1", "Mojave Community", "#4F5B2A", "tv", HD, { category: "Public affairs", description: "Victorville and the High Desert.", stream: { kind: "hls", slug: "civc" } }, "station", "Victorville"),
  station(961, "DUST", "96.2", "Dust Radio", "#7E2F35", "radio", HD, { category: "Music", description: "Desert rock and country.", stream: { kind: "hls", slug: "crat" } }, "station", "Apple Valley")
]);

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

/**
 * By id, slug ("rivc-15-2"), call sign and channel, call sign (any case; a shared one is X.1's:
 * "BEAT" is 12.1, "RIVC" 15.1) or handle, as getStation takes them.
 */
export function stationByRef(ref: string): MockStation | undefined {
  return findByRef(STATIONS, ref, (s) => s.ident) ?? undefined;
}

/**
 * The key the fixtures file a station's extras under (STATION_EXTRA, WEEK): its call sign ("BEAT"),
 * or a call-sign family member's slug in capitals ("BEAT-12-2"), so a family's X.1 extras stay its own.
 */
export function fixtureKey(s: MockStation): string {
  return (s.ident.slug ?? s.ident.callSign ?? s.ident.id).toUpperCase();
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
  if (s.stream.kind === "dash") return { kind: "hls" as const, url: `/mock-dash/${s.stream.slug}/manifest.mpd`, format: "dash" as const };
  return s.stream.kind === "hls" ? { kind: "hls" as const, url: `/mock-hls/${s.stream.slug}/master.m3u8` } : { kind: "embed" as const, url: s.stream.url };
}

export { uid };
