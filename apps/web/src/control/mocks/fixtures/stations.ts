// The stations in the reference files: the Inland Empire at 8:42 pm on a Saturday, as master
// control sees it. Ids match the viewer's mock (viewer/mocks/fixtures/stations.ts), so
// the two apps' mocks describe the same stations. Illustrations, used as mock data.

import type { StationIdent } from "@opencast/contracts";
import { findByStationRef } from "../../station/slug";

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function ident(n: number, callSign: string | null, channel: string | null, name: string, colour: string, band: "tv" | "radio" | null, kind: StationIdent["kind"] = "station", homeCity: string | null = "Redlands", market: string | null = "inland-empire"): StationIdent {
  const handle = (callSign ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  // The station's part of its addresses: its call sign in lower case (a studio's handle).
  return { id: uid(n), kind, callSign, handle, name, colour, band, channel, marketSlug: market, homeCity, slug: callSign ? callSign.toLowerCase() : handle };
}

export const STATIONS: StationIdent[] = [
  ident(7, "CIVC", "7.1", "Inland Civic", "#2E6B5A", "tv"),
  ident(9, "RDLS", "9.1", "Redlands Public Access", "#4F5B2A", "tv", "listed"),
  // BEAT's two streams share its call sign (A229): 12.1 Inland Beat keeps /control/beat, 12.2 Beat
  // Tapes is /control/beat-12-2. Kai M. owns both.
  { ...ident(12, "BEAT", "12.1", "Inland Beat", "#8C3B7A", "tv"), slug: "beat", sharesCallSign: true },
  { ...ident(122, "BEAT", "12.2", "Beat Tapes", "#8C3B7A", "tv"), handle: "beat-tapes", slug: "beat-12-2", sharesCallSign: true },
  ident(18, "SAZN", "18.1", "Sazón", "#A3402A", "tv", "station", "Fontana"),
  ident(24, "REEL", "24.1", "Saturday Reel", "#9A5412", "tv", "station", "Riverside"),
  ident(31, "PREP", "31.1", "Inland Preps", "#1F5E8C", "tv", "station", "Rialto"),
  ident(883, "NITE", "88.4", "Night Desk", "#33507A", "radio", "station", "Riverside"),
  ident(907, "HALL", "90.8", "Study Hall", "#56508A", "radio"),
  ident(1019, "CRAT", "102.0", "Crate", "#7E2F35", "radio", "claimable"),
  ident(1043, "VOZE", "104.4", "La Voz", "#1D6A70", "radio", "station", "San Bernardino"),
  // A studio: a station with no channel (market 04.1).
  { ...ident(5001, null, null, "Inland Sound Lab", "#7E2F35", null, "studio"), handle: "inland-sound-lab" }
];

export function stationById(id: string): StationIdent | undefined {
  return STATIONS.find((s) => s.id === id);
}

/**
 * By slug ("beat-12-2"), call sign (a bare one is the station on X.1: "BEAT" is 12.1), handle or
 * id, as the API takes them (station/slug.ts).
 */
export function stationByRef(ref: string): StationIdent | undefined {
  return findByStationRef(STATIONS, ref, (s) => s);
}

export const BEAT = stationByRef("BEAT")!;
/** 12.2 BEAT, Beat Tapes: shares 12.1 BEAT's call sign. */
export const TAPE = stationByRef("beat-12-2")!;
export const HALL = stationByRef("HALL")!;
export const CRAT = stationByRef("CRAT")!;
export const LAB = stationByRef("inland-sound-lab")!;

export const MARKET = { id: uid(90001), slug: "inland-empire", name: "Inland Empire", timezone: "America/Los_Angeles" };
