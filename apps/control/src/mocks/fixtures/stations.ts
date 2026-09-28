// The stations in the reference files: the Inland Empire at 8:42 pm on a Saturday, as master
// control sees it. Ids match the viewer's mock (apps/viewer/src/mocks/fixtures/stations.ts), so
// the two apps' mocks describe the same stations. Illustrations, used as mock data.

import type { StationIdent } from "@opencast/contracts";

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function ident(n: number, callSign: string | null, channel: string | null, name: string, colour: string, band: "tv" | "radio" | null, kind: StationIdent["kind"] = "station", homeCity: string | null = "Redlands", market: string | null = "inland-empire"): StationIdent {
  return { id: uid(n), kind, callSign, handle: (callSign ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, colour, band, channel, marketSlug: market, homeCity };
}

export const STATIONS: StationIdent[] = [
  ident(7, "CIVC", "7.1", "Inland Civic", "#2E6B5A", "tv"),
  ident(9, "RDLS", "9.1", "Redlands Public Access", "#4F5B2A", "tv", "listed"),
  ident(12, "BEAT", "12.1", "Inland Beat", "#8C3B7A", "tv"),
  ident(18, "SAZN", "18.1", "Sazón", "#A3402A", "tv", "station", "Fontana"),
  ident(24, "REEL", "24.1", "Saturday Reel", "#9A5412", "tv", "station", "Riverside"),
  ident(31, "PREP", "31.1", "Inland Preps", "#1F5E8C", "tv", "station", "Rialto"),
  ident(883, "NITE", "88.3", "Night Desk", "#33507A", "radio", "station", "Riverside"),
  ident(907, "HALL", "90.7", "Study Hall", "#56508A", "radio"),
  ident(1019, "CRAT", "101.9", "Crate", "#7E2F35", "radio", "claimable"),
  ident(1043, "VOZE", "104.3", "La Voz", "#1D6A70", "radio", "station", "San Bernardino"),
  // A studio: a station with no channel (market 04.1).
  { ...ident(5001, null, null, "Inland Sound Lab", "#7E2F35", null, "studio"), handle: "inland-sound-lab" }
];

export function stationById(id: string): StationIdent | undefined {
  return STATIONS.find((s) => s.id === id);
}

/** By id, call sign or handle, as the API takes them. */
export function stationByRef(ref: string): StationIdent | undefined {
  const r = ref.toLowerCase();
  return STATIONS.find((s) => s.id === ref || s.callSign?.toLowerCase() === r || s.handle === r);
}

export const BEAT = stationByRef("BEAT")!;
export const HALL = stationByRef("HALL")!;
export const CRAT = stationByRef("CRAT")!;
export const LAB = stationByRef("inland-sound-lab")!;

export const MARKET = { id: uid(90001), slug: "inland-empire", name: "Inland Empire", timezone: "America/Los_Angeles" };
