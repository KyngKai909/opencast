// The stations businesses see, with the same ids as the other apps' mocks
// (apps/control/src/mocks/fixtures/stations.ts): the Inland Empire. Illustrations.

import type { StationIdent } from "@opencast/contracts";
import { uid } from "./people";

function ident(n: number, callSign: string, channel: string, name: string, colour: string, band: "tv" | "radio", homeCity = "Redlands", kind: StationIdent["kind"] = "station"): StationIdent {
  return { id: uid(n), kind, callSign, handle: callSign.toLowerCase(), name, colour, band, channel, marketSlug: "inland-empire", homeCity };
}

export const STATIONS: StationIdent[] = [
  ident(7, "CIVC", "7.1", "Inland Civic", "#2E6B5A", "tv"),
  ident(12, "BEAT", "12.1", "Inland Beat", "#8C3B7A", "tv"),
  ident(18, "SAZN", "18.1", "Sazón", "#A3402A", "tv", "Fontana"),
  ident(24, "REEL", "24.1", "Saturday Reel", "#9A5412", "tv", "Riverside"),
  ident(31, "PREP", "31.1", "Inland Preps", "#1F5E8C", "tv", "Rialto"),
  ident(883, "NITE", "88.3", "Night Desk", "#33507A", "radio", "Riverside"),
  ident(907, "HALL", "90.7", "Study Hall", "#56508A", "radio"),
  ident(1043, "VOZE", "104.3", "La Voz", "#1D6A70", "radio", "San Bernardino")
];

/**
 * LUPE 33.1 joins the market on Monday (biz-spots 03.1): targeting names it ("From Monday"), but
 * it isn't on the dial yet, so it isn't in STATIONS.
 */
export const LUPE: StationIdent = { id: uid(33), kind: "station", callSign: "LUPE", handle: "lupe", name: "Lupe", colour: "#7A2E5C", band: "tv", channel: "33.1", marketSlug: "inland-empire", homeCity: "San Bernardino" };

export function stationByRef(ref: string): StationIdent | undefined {
  const r = ref.toLowerCase();
  return STATIONS.find((s) => s.id === ref || s.callSign?.toLowerCase() === r || s.handle === r);
}

export const MARKET = { id: uid(90001), slug: "inland-empire", name: "Inland Empire", timezone: "America/Los_Angeles" };
