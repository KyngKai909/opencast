// Every station on the mock desk's dials (network-desk 01.1): the Inland Empire's independent
// stations, the three city streams on channel 9, LUPE (claimable, signs on Monday), FLDR and CRAT
// (claimable and on air), and the catalog station OCAT. Colours are the frame's. Waitlist holds:
// TACO, SKAT, HOOP and GOSP. The frame holds "SK8", which a call sign can't be (letters only,
// open-decisions design conflicts); the mock uses SKAT.

import type { StationIdent } from "@opencast/contracts";
import { U } from "./ids";
import { HD, IE } from "./markets";

export interface DbStation {
  ident: StationIdent;
  marketId: string;
  /** On the dial: signed on at least once (listed sources are public from the start). */
  public: boolean;
  firstSignedOnAt: string | null;
  /** Claimable stations: the station's ID in the escrow contract. */
  escrowId: number | null;
  /** A scheduled first sign-on. */
  signOnAt: string | null;
}

type Kind = StationIdent["kind"];

function st(n: number, market: string, kind: Kind, band: "tv" | "radio", channel: string | null, callSign: string, name: string, colour: string | null, extra: Partial<DbStation> = {}, homeCity: string | null = null): DbStation {
  return {
    ident: { id: U(n), kind, callSign, handle: callSign.toLowerCase(), name, colour, band, channel, marketSlug: market === IE.id ? IE.slug : HD.slug, homeCity },
    marketId: market,
    public: true,
    firstSignedOnAt: "2026-06-01T13:00:00.000Z",
    escrowId: null,
    signOnAt: null,
    ...extra
  };
}

export const STATION_IDS = {
  CIVC: U(101), RDLS: U(102), COLT: U(103), SBCO: U(104), RUSD: U(105), BEAT: U(106), SAZN: U(107), REEL: U(108), PREP: U(109),
  LUPE: U(110), OCAT: U(111), NITE: U(112), HALL: U(113), FLDR: U(114), CRAT: U(115), VOZE: U(116), MOJV: U(117)
};

/** Monday, September 28, 6:00 am in the Inland Empire: LUPE's first sign-on. */
export const LUPE_SIGN_ON = "2026-09-28T13:00:00.000Z";

export function seedStations(): DbStation[] {
  return [
    st(101, IE.id, "station", "tv", "7.1", "CIVC", "Inland Civic", "#2E6B5A", {}, "Riverside"),
    st(102, IE.id, "listed", "tv", "9.1", "RDLS", "City of Redlands", null, {}, "Redlands"),
    st(103, IE.id, "listed", "tv", "9.2", "COLT", "City of Colton", null, {}, "Colton"),
    st(104, IE.id, "listed", "tv", "9.3", "SBCO", "San Bernardino County", null, {}, "San Bernardino"),
    // Being checked: not on the dial yet, so no channel (N8 asks for this to be allowed).
    st(105, IE.id, "listed", "tv", null, "RUSD", "Riverside Unified School District", null, { public: false, firstSignedOnAt: null }, "Riverside"),
    st(106, IE.id, "station", "tv", "12.1", "BEAT", "Inland Beat", "#8C3B7A", {}, "Redlands"),
    st(107, IE.id, "station", "tv", "18.1", "SAZN", "Sazón", "#A3402A", {}, "Fontana"),
    st(108, IE.id, "station", "tv", "24.1", "REEL", "Reel Inland", "#9A5412", {}, "Riverside"),
    st(109, IE.id, "station", "tv", "31.1", "PREP", "Prep Sports Weekly", "#1F5E8C", {}, "Riverside"),
    st(110, IE.id, "claimable", "tv", "33.1", "LUPE", "Tía Lupe’s Kitchen", "#A3402A", { public: false, firstSignedOnAt: null, escrowId: 33, signOnAt: LUPE_SIGN_ON }, "Fontana"),
    st(111, IE.id, "catalog", "tv", "60.1", "OCAT", "Opencast Classics", "#1F3A5F"),
    st(112, IE.id, "station", "radio", "88.4", "NITE", "Night Shift Radio", "#33507A", {}, "San Bernardino"),
    st(113, IE.id, "station", "radio", "90.8", "HALL", "Hall Radio", "#56508A", {}, "Riverside"),
    st(114, IE.id, "claimable", "radio", "92.0", "FLDR", "Mojave Field Recordings", "#3D6547", { firstSignedOnAt: "2026-09-20T13:00:00.000Z", escrowId: 91 }, "Joshua Tree"),
    st(115, IE.id, "claimable", "radio", "102.0", "CRAT", "Marcus Reyes", "#5B3F8C", { firstSignedOnAt: "2026-08-12T13:00:00.000Z", escrowId: 101 }, "San Bernardino"),
    st(116, IE.id, "station", "radio", "104.4", "VOZE", "Voz del Inland", "#1D6A70", {}, "Ontario"),
    st(117, HD.id, "station", "tv", "14.1", "MOJV", "Mojave Community TV", "#7A4B1F", {}, "Victorville")
  ];
}

export interface DbReservation {
  id: string;
  callSign: string;
  email: string | null;
  marketId: string | null;
  band: "tv" | "radio" | null;
  channel: string | null;
  heldUntil: string | null;
  createdAt: string;
}

// The waitlist's reserved call signs: 26 in the Inland Empire ("26 people on the waitlist here"),
// four holding a channel, and a few in High Desert.
const IE_SIGNS = ["TACO", "SKAT", "HOOP", "GOSP", "BRUN", "CHLO", "DUNE", "EAST", "FARM", "GRIT", "HOME", "INKY", "JOLT", "LOCO", "MESA", "NOPL", "OPAL", "PALM", "QUIL", "ROSA", "SOLA", "TRUK", "UNDR", "VALE", "YARD", "ZINE"];
const HELD: Record<string, { band: "tv" | "radio"; channel: string }> = { TACO: { band: "tv", channel: "41.1" }, SKAT: { band: "tv", channel: "44.1" }, HOOP: { band: "tv", channel: "52.1" }, GOSP: { band: "radio", channel: "95.6" } };

export function seedReservations(): DbReservation[] {
  const ie = IE_SIGNS.map((cs, i) => ({
    id: U(3000 + i),
    callSign: cs,
    email: `${cs.toLowerCase()}@example.com`,
    marketId: IE.id,
    band: HELD[cs]?.band ?? null,
    channel: HELD[cs]?.channel ?? null,
    heldUntil: HELD[cs] ? "2027-03-31T07:00:00.000Z" : null,
    createdAt: new Date(Date.UTC(2026, 7, 1 + i, 17)).toISOString()
  }));
  const hd = ["DUST", "JOSH", "RIMS"].map((cs, i) => ({ id: U(3100 + i), callSign: cs, email: null, marketId: HD.id, band: i === 0 ? ("radio" as const) : null, channel: i === 0 ? "92.4" : null, heldUntil: i === 0 ? "2027-03-31T07:00:00.000Z" : null, createdAt: new Date(Date.UTC(2026, 8, 3 + i, 17)).toISOString() }));
  return [...ie, ...hd];
}
