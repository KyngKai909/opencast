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
  LUPE: U(110), OCAT: U(111), NITE: U(112), HALL: U(113), FLDR: U(114), CRAT: U(115), VOZE: U(116), MOJV: U(117),
  // Follow-up Phase 6: NASA on 61.1, and Inland Community TV waiting for its permission.
  NASA: U(118), ICTV: U(119)
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
    st(117, HD.id, "station", "tv", "14.1", "MOJV", "Mojave Community TV", "#7A4B1F", {}, "Victorville"),
    // External stations added in follow-up Phase 6: NASA's public stream, and an IPTV-list channel
    // waiting for their permission (no channel yet, like RUSD).
    st(118, IE.id, "listed", "tv", "61.1", "NASA", "NASA", null),
    st(119, IE.id, "listed", "tv", null, "ICTV", "Inland Community TV", null, { public: false, firstSignedOnAt: null }, "Riverside")
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
  // Added 2026-09-29 (desk-pages 02). A released reservation leaves the list.
  name: string | null;
  about: string | null;
  reason: "waitlist" | "signed_off" | "admin";
  invitedAt: string | null;
  remindedAt: string | null;
  extendedAt: string | null;
  /** The station they're setting up with it. */
  stationId: string | null;
  decision: "kept" | null;
  decidedAt: string | null;
}

// The waitlist's reserved call signs: 26 in the Inland Empire ("26 people on the waitlist here"),
// four holding a channel, and a few in High Desert. The reference's rows (desk-pages 02) are here
// on the mock's own names and channels: HOOP 52.1 invited and signing on (the frame's HALO), DUSK
// waiting, VALE asked for twice, KFRO not allowed, TACO 41.1 ending tomorrow (the frame's GOLD;
// the mock's clock is Saturday, September 26).
const IE_SIGNS = ["TACO", "SKAT", "HOOP", "GOSP", "BRUN", "CHLO", "DUSK", "EAST", "FARM", "GRIT", "HOME", "INKY", "JOLT", "LOCO", "MESA", "NOPL", "OPAL", "PALM", "VALE", "ROSA", "SOLA", "TRUK", "KFRO", "VALE", "YARD", "ZINE"];
const HELD: Record<string, { band: "tv" | "radio"; channel: string }> = { TACO: { band: "tv", channel: "41.1" }, SKAT: { band: "tv", channel: "44.1" }, HOOP: { band: "tv", channel: "52.1" }, GOSP: { band: "radio", channel: "95.6" } };
const DAY = 86_400_000;
const at = (month: number, day: number) => new Date(Date.UTC(2026, month - 1, day, 17)).toISOString();
/** Who asked, keyed by call sign (the second VALE by index). */
const ASKED: Record<string, Partial<DbReservation>> = {
  HOOP: { name: "Ruth O.", about: "Community choir, Riverside", createdAt: at(8, 30), invitedAt: at(9, 20), stationId: U(3900) },
  DUSK: { name: "Marco T.", about: "Late-night film club, Redlands", createdAt: at(9, 3) },
  VALE: { name: "Dani R.", about: "A skate crew, Fontana", createdAt: at(9, 8) },
  "VALE#23": { name: "Pastor Ellis", about: "A church, Fontana", createdAt: at(9, 11) },
  KFRO: { name: "J. Park", about: "Wanted a real-looking call sign", createdAt: at(9, 14) },
  TACO: { name: "Hank V.", about: "Oldies, Upland", createdAt: at(5, 30) }
};

const reservation = (id: string, callSign: string, marketId: string, fields: Partial<DbReservation>): DbReservation => {
  const createdAt = fields.createdAt ?? at(8, 1);
  return {
    id,
    callSign,
    email: `${callSign.toLowerCase()}@example.com`,
    marketId,
    band: null,
    channel: null,
    heldUntil: new Date(Date.parse(createdAt) + 120 * DAY).toISOString(),
    name: null,
    about: null,
    reason: "waitlist",
    invitedAt: null,
    remindedAt: null,
    extendedAt: null,
    stationId: null,
    decision: null,
    decidedAt: null,
    ...fields,
    createdAt
  };
};

export function seedReservations(): DbReservation[] {
  const ie = IE_SIGNS.map((cs, i) => {
    const who = ASKED[i === 23 ? "VALE#23" : cs] ?? {};
    return reservation(U(3000 + i), cs, IE.id, { band: HELD[cs]?.band ?? null, channel: HELD[cs]?.channel ?? null, createdAt: at(8, 1 + i), ...who, ...(i === 23 ? { email: "grace@example.com" } : {}) });
  });
  const hd = ["DUST", "JOSH", "RIMS"].map((cs, i) => reservation(U(3100 + i), cs, HD.id, { band: i === 0 ? "radio" : null, channel: i === 0 ? "92.4" : null, createdAt: at(9, 3 + i) }));
  return [...ie, ...hd];
}
