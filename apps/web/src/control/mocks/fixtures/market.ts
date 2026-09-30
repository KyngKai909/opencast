// The syndication market on the reference's Saturday (control/opencast-market.html M, S, C;
// opencast-offering.html; master-control SYN): who offers what on which terms, who carries it,
// and the requests waiting. It agrees with the shared evening: BEAT carries Saturday Reel from REEL
// under barter and Slow Hours from HALL (the log's agreement ids); BEAT offers Late Crate, carried
// by HALL and SAZN; NITE's request to carry Late Crate waits for BEAT's answer.
//
// Offers, agreements and requests change (carrying, offering, approving), so they're kept in
// localStorage under their own versioned key. Reset: localStorage.removeItem("oc-mock-control-market").

import type { Band, CarriageRequest, CarriageTerm, CashPlusBarter, Offer, Slot, StationIdent } from "@opencast/contracts";
import type { EpisodeX } from "../../api/ext/market";
import type { CarrierProfile, ProgramFormat } from "../../api/types";
import { PROGRAM_IDS } from "./library";
import { BEAT, HALL, LAB, stationByRef, uid } from "./stations";
import { MIN, OFFSET_HOURS, SEC, at } from "./time";

const HR = 60 * MIN;

// ---- stations the market names that master control's own fixtures don't ----

function other(n: number, callSign: string | null, channel: string | null, name: string, colour: string, band: Band | null, market: string | null, city: string | null, kind: StationIdent["kind"] = "station"): StationIdent {
  const handle = (callSign ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return { id: uid(n), kind, callSign, handle, name, colour, band, channel, marketSlug: market, homeCity: city, slug: callSign ? callSign.toLowerCase() : handle };
}

/** The viewer's DUST 96.2 (same id): High Desert, the next market over. */
export const DUST = other(961, "DUST", "96.2", "Dust Radio", "#7E2F35", "radio", "high-desert", "Apple Valley");
/** Opencast's own catalog: a maker with no channel (market 05.1). */
export const CATALOG = other(5100, null, null, "Opencast catalog", "#26345A", null, null, null, "catalog");
/** Stations in Los Angeles that carry market programs; stations see them as a count ("3 stations in Los Angeles"). */
const LA = [
  ["ECHO", "33.1", "Echo Park TV", "tv"],
  ["LOFI", "90.0", "Lo-fi LA", "radio"],
  ["PARK", "45.1", "Parkside", "tv"],
  ["SILV", "38.1", "Silver Lake", "tv"],
  ["VNCE", "91.6", "Venice Radio", "radio"],
  ["ARTS", "27.1", "Arts District", "tv"],
  ["ELYS", "93.2", "Elysian", "radio"],
  ["BOYL", "41.1", "Boyle Heights", "tv"]
].map(([cs, ch, nm, band], i) => other(7000 + i, cs!, ch!, nm!, "#33507A", band as Band, "los-angeles", "Los Angeles"));

const S = (ref: string) => stationByRef(ref)!;
const [CIVC, SAZN, REEL, PREP, NITE, CRAT, VOZE] = ["CIVC", "SAZN", "REEL", "PREP", "NITE", "CRAT", "VOZE"].map(S) as StationIdent[];

export const MARKET_STATIONS: StationIdent[] = [DUST, CATALOG, ...LA];

export function marketStation(id: string): StationIdent | undefined {
  return stationByRef(id) ?? MARKET_STATIONS.find((s) => s.id === id);
}

/** C7: what a maker sees of a station asking to carry (offering 03.1). */
export const CARRIER_PROFILES: Record<string, CarrierProfile> = {
  [NITE.id]: { description: "Old-time radio overnight", members: 96, carriesPrograms: 3, blockedCategories: ["Alcohol"] },
  [HALL.id]: { description: "Slow beats for late work", members: 64, carriesPrograms: 2, blockedCategories: [] },
  [SAZN.id]: { description: "Home cooking from Inland Empire kitchens", members: 96, carriesPrograms: 2, blockedCategories: [] }
};

// ---- the offers ----

export interface MkOffer extends Omit<Offer, "fit" | "carriers"> {
  /** Slots the offer fits besides tonight's dead air, for BEAT (library repeats). Dead air is worked out from the log. */
  repeatFit: { label: string; title: string } | null;
}

type Deal = Partial<{ cash: number; unit: "per_airing" | "per_hour"; barter: number; cpb: CashPlusBarter; creditOnly: boolean }>;

let offerN = 0;
let programN = 0;
function offer(o: {
  title: string;
  maker: StationIdent;
  kind?: Offer["makerKind"];
  programId?: string;
  colour: string;
  description?: string;
  category: string;
  live?: boolean;
  episodes: number;
  format: ProgramFormat;
  rightsNote: string;
  terms: CarriageTerm[];
  deal?: Deal;
  airings?: number | null;
  windowDays?: 7 | 30;
  liveOnly?: boolean;
  approval?: "any_station" | "i_approve";
  offeredDaysAgo: number;
  repeatFit?: MkOffer["repeatFit"];
  previews?: number;
  underwriter?: string;
}): MkOffer {
  const d = o.deal ?? {};
  const kind = o.kind ?? (o.maker.kind === "studio" ? "studio" : o.maker.kind === "catalog" ? "catalog" : "station");
  return {
    id: uid(600000 + ++offerN),
    program: {
      id: o.programId ?? uid(280200 + ++programN),
      title: o.title,
      description: o.description ?? null,
      category: o.category,
      live: o.live ?? false,
      episodeCount: o.episodes,
      rightsNote: o.rightsNote,
      format: o.format,
      colour: o.colour,
      advisory: "none"
    },
    maker: o.maker,
    makerKind: kind,
    status: "offered",
    termsOffered: o.terms,
    cashPriceMicros: d.cash ?? null,
    cashPriceUnit: d.cash != null ? (d.unit ?? "per_airing") : null,
    barterMakerMsPerHour: d.barter ?? null,
    airingsPerEpisode: o.airings === undefined ? 3 : o.airings,
    windowDays: o.windowDays ?? 7,
    liveOnly: o.liveOnly ?? false,
    noticeDays: 7,
    approval: o.approval ?? "any_station",
    radioBandAllowed: true,
    fitsYourSchedule: null,
    previews: o.previews ?? 0,
    breakMsPerHour: 4 * MIN,
    cashPlusBarter: d.cpb ?? null,
    barterFill: d.creditOnly ? "credit_only" : "spots",
    defaultTerm: o.terms[0],
    underwriter: o.underwriter ?? null,
    offeredAt: at(`-${o.offeredDaysAgo} 12:00`),
    repeatFit: o.repeatFit ?? null
  };
}

const series = (len: number, bands: Band[] = ["tv"]): ProgramFormat => ({ kind: "series", cadence: null, episodeLengthMs: len, bands });
const weekly = (len: number, bands: Band[] = ["tv"]): ProgramFormat => ({ kind: "series", cadence: "weekly", episodeLengthMs: len, bands });
const nightly = (len: number, bands: Band[]): ProgramFormat => ({ kind: "series", cadence: "nightly", episodeLengthMs: len, bands });
const oneOff = (len: number, bands: Band[] = ["tv"]): ProgramFormat => ({ kind: "one_off", cadence: null, episodeLengthMs: len, bands });
const $ = (dollars: number) => Math.round(dollars * 1_000_000);
const REPEATS = { label: "weeknights 1:00 am", title: "Weeknights after 1:00 am" };
const CLEAR = "Clear, the member-owned co-op";

export const OFFER_IDS = {} as Record<string, string>;

export function seedOffers(): MkOffer[] {
  offerN = 0;
  programN = 0;
  const list: MkOffer[] = [
    // Market M (01.1) and SYN (B.1).
    offer({ title: "Slow Hours", maker: HALL, programId: PROGRAM_IDS.slowHours, colour: "#56508A", category: "Music", episodes: 22, format: series(2 * HR + 20 * MIN, ["radio", "tv"]), description: "Unhurried beats and ambient pieces from producers in the region, sequenced for late nights. Each episode runs about two hours with no talking.", rightsNote: "Made by HALL, confirmed", terms: ["barter", "cash"], deal: { barter: 2 * MIN, cash: $(1.5), unit: "per_hour" }, airings: null, windowDays: 30, offeredDaysAgo: 120, repeatFit: REPEATS, previews: 31 }),
    offer({ title: "Nights at the observatory", maker: CATALOG, colour: "#1F3A5F", category: "Classic", episodes: 12, format: series(2 * HR), description: "Telescope footage and mission film from NASA, set to quiet music.", rightsNote: "NASA footage. US government works are public domain", terms: ["free"], airings: null, windowDays: 30, offeredDaysAgo: 60, repeatFit: REPEATS, underwriter: CLEAR, previews: 44 }),
    offer({ title: "Crate Diggers Radio Hour", maker: LAB, programId: PROGRAM_IDS.crateDiggers, colour: "#7E2F35", category: "Music", episodes: 30, format: series(HR, ["radio", "tv"]), description: "Producers dig through a crate of records, one hour at a time.", rightsNote: "Made by Inland Sound Lab, confirmed", terms: ["barter"], deal: { barter: 2 * MIN }, offeredDaysAgo: 90, repeatFit: REPEATS, previews: 12 }),
    offer({ title: "Council Watch", maker: CIVC, colour: "#2E6B5A", category: "Public affairs", episodes: 40, format: weekly(HR), description: "The week's council meetings, cut to the votes that matter.", rightsNote: "Made by CIVC, confirmed", terms: ["barter"], deal: { barter: 15 * SEC, creditOnly: true }, offeredDaysAgo: 200, previews: 9 }),
    offer({ title: "Newsreel hour", maker: REEL, colour: "#9A5412", category: "Classic", episodes: 26, format: series(HR), description: "An hour of restored newsreels from the 1930s and 1940s.", rightsNote: "Public domain, restored by REEL", terms: ["cash", "barter", "cash_plus_barter"], deal: { cash: $(2.5), barter: 2 * MIN, cpb: { priceMicros: $(1.25), unit: "per_airing", makerMsPerHour: MIN } }, offeredDaysAgo: 30, previews: 7 }),
    offer({ title: "Saturday Reel", maker: REEL, programId: PROGRAM_IDS.saturdayReel, colour: "#9A5412", category: "Classic", episodes: 40, format: series(30 * MIN), description: "Cartoons and short films from the 1920s and 1930s, restored.", rightsNote: "Public domain, restored by REEL", terms: ["barter", "cash"], deal: { barter: 2 * MIN, cash: $(4) }, offeredDaysAgo: 300, previews: 58 }),
    offer({ title: "The Producers’ Hour", maker: CRAT, colour: "#7E2F35", category: "Music", live: true, episodes: 20, format: weekly(HR, ["radio"]), description: "Producers play what they're working on, live.", rightsNote: "Made by CRAT, confirmed", terms: ["cash", "barter"], deal: { cash: $(3), barter: 2 * MIN }, approval: "i_approve", offeredDaysAgo: 150, previews: 15 }),
    offer({ title: "Night Desk", maker: NITE, colour: "#33507A", category: "Classic", episodes: 90, format: nightly(8 * HR, ["radio"]), description: "Old-time radio dramas and comedies, overnight.", rightsNote: "1940s radio, public domain", terms: ["cash_plus_barter"], deal: { cpb: { priceMicros: $(1.5), unit: "per_hour", makerMsPerHour: 30 * SEC } }, approval: "i_approve", offeredDaysAgo: 180, previews: 6 }),
    // BEAT's own (offering 01.1).
    offer({ title: "Late Crate", maker: BEAT, programId: PROGRAM_IDS.lateCrate, colour: "#8C3B7A", category: "Music", episodes: 15, format: series(30 * MIN), description: "One producer, one crate of records, one hour.", rightsNote: "Made by BEAT, confirmed", terms: ["barter", "cash"], deal: { barter: 2 * MIN, cash: $(2) }, approval: "i_approve", offeredDaysAgo: 45, previews: 11 }),
    offer({ title: "Beat Tape Live", maker: BEAT, programId: PROGRAM_IDS.beatTapeLive, colour: "#8C3B7A", category: "Music", live: true, episodes: 8, format: weekly(HR), description: "Producers play unreleased tapes and talk through how they were made. Live from the Redlands studio.", rightsNote: "Made by BEAT, confirmed", terms: ["cash"], deal: { cash: $(3) }, liveOnly: true, offeredDaysAgo: 20, previews: 4 }),
    // The studio (market 04.1, S).
    offer({ title: "Studio Notes", maker: LAB, programId: PROGRAM_IDS.studioNotes, colour: "#7E2F35", category: "Music", episodes: 8, format: series(30 * MIN, ["tv", "radio"]), description: "Short visits to producers' home studios.", rightsNote: "Made by Inland Sound Lab, confirmed", terms: ["cash"], deal: { cash: $(2) }, offeredDaysAgo: 40, previews: 5 }),
    offer({ title: "Loops for Late Nights", maker: LAB, programId: PROGRAM_IDS.loops, colour: "#7E2F35", category: "Music", episodes: 40, format: series(HR, ["tv", "radio"]), description: "Long, slow loops for the small hours.", rightsNote: "Made by Inland Sound Lab, confirmed", terms: ["barter", "cash"], deal: { barter: MIN, cash: $(1), unit: "per_hour" }, offeredDaysAgo: 75, previews: 3 }),
    // The Opencast catalog (market 05.1, C).
    offer({ title: "Cartoons, 1928 to 1936", maker: CATALOG, colour: "#9A5412", category: "Classic", episodes: 40, format: series(30 * MIN), rightsNote: "Public domain, restored by Opencast", terms: ["free"], airings: null, windowDays: 30, offeredDaysAgo: 100, underwriter: CLEAR, previews: 20 }),
    offer({ title: "The mystery hour", maker: CATALOG, colour: "#33507A", category: "Classic", episodes: 60, format: series(30 * MIN, ["radio"]), rightsNote: "1940s radio dramas, public domain", terms: ["free"], airings: null, windowDays: 30, offeredDaysAgo: 100, underwriter: CLEAR, previews: 8 }),
    offer({ title: "Newsreels, 1930 to 1950", maker: CATALOG, colour: "#525C73", category: "Classic", episodes: 26, format: series(HR), rightsNote: "Public domain", terms: ["free"], airings: null, windowDays: 30, offeredDaysAgo: 80, underwriter: CLEAR, previews: 6 }),
    offer({ title: "National parks on film", maker: CATALOG, colour: "#2E6B5A", category: "Classic", episodes: 18, format: series(HR), rightsNote: "National Park Service films, public domain", terms: ["free"], airings: null, windowDays: 30, offeredDaysAgo: 50, underwriter: CLEAR, previews: 10 }),
    // Three more that fit BEAT's 11:40 pm gap, from makers who approve each station (market 06.1:
    // "3 more need the maker's approval").
    offer({ title: "Desert country, all night", maker: DUST, colour: "#7E2F35", category: "Music", episodes: 50, format: nightly(2 * HR, ["radio"]), rightsNote: "Made by DUST, confirmed", terms: ["barter"], deal: { barter: 2 * MIN }, approval: "i_approve", offeredDaysAgo: 25 }),
    offer({ title: "Noche de oldies", maker: VOZE, colour: "#1D6A70", category: "Music", episodes: 30, format: nightly(2 * HR + 20 * MIN, ["radio"]), rightsNote: "Made by VOZE, confirmed", terms: ["barter", "cash"], deal: { barter: 2 * MIN, cash: $(1), unit: "per_hour" }, approval: "i_approve", offeredDaysAgo: 15 }),
    offer({ title: "Double feature", maker: REEL, colour: "#9A5412", category: "Classic", episodes: 1, format: oneOff(2 * HR + 15 * MIN), rightsNote: "Public domain, restored by REEL", terms: ["cash"], deal: { cash: $(6) }, approval: "i_approve", offeredDaysAgo: 10 })
  ];
  for (const o of list) OFFER_IDS[o.program.title] = o.id;
  return list;
}

// ---- episodes (getOffer) ----

const EPISODE_TITLES: Record<string, [number, string, number, string][]> = {
  // [number, title, length, first aired (at())]
  "Slow Hours": [
    [22, "Rain on Mission Blvd", 2 * HR + 18 * MIN + 40 * SEC, "-7 23:00"],
    [21, "Tape hiss and harbour lights", 2 * HR + 20 * MIN + 5 * SEC, "-14 23:00"],
    [20, "Night shift, Ontario", 2 * HR + 19 * MIN + 12 * SEC, "-21 23:00"]
  ],
  "Newsreel hour": [
    [26, "Spring, 1941", 59 * MIN + 20 * SEC, "-6 20:00"],
    [25, "The fair comes to town", 58 * MIN + 45 * SEC, "-13 20:00"],
    [24, "Harbours and ships", 59 * MIN + 5 * SEC, "-20 20:00"]
  ],
  "Nights at the observatory": [
    [12, "The rings, up close", 2 * HR - 40 * SEC, "-10 22:00"],
    [11, "A night on Mauna Kea", 2 * HR - 15 * SEC, "-17 22:00"],
    [10, "The first photographs", 2 * HR - 1 * MIN, "-24 22:00"]
  ]
};

/** Break points every 30 minutes, none in the last five. */
export function breakPoints(lengthMs: number): number[] {
  const out: number[] = [];
  for (let t = 30 * MIN; t < lengthMs - 5 * MIN; t += 30 * MIN) out.push(t);
  return out;
}

export function episodesFor(o: MkOffer): EpisodeX[] {
  const slug = (o.maker.callSign ?? "reel").toLowerCase();
  const stream = ["civc", "beat", "reel", "sazn", "prep", "nite", "hall", "crat", "voze"].includes(slug) ? slug : "reel";
  const firstOn = o.makerKind === "station" ? o.maker : null;
  const named = EPISODE_TITLES[o.program.title];
  const len = o.program.format?.episodeLengthMs ?? 30 * MIN;
  const rows: [number, string, number, string][] =
    named ?? [0, 1, 2].filter((i) => o.program.episodeCount - i > 0).map((i) => [o.program.episodeCount - i, `Episode ${o.program.episodeCount - i}`, len - (i + 1) * 20 * SEC, `-${7 * (i + 1)} 21:00`]);
  return rows.map(([n, title, ms, aired], i) => ({
    id: uid(610000 + Number(o.id.slice(-4)) * 10 + i),
    title,
    durationMs: ms,
    breakPointsMs: breakPoints(ms),
    // One preview still rendering, to show that state (Newsreel hour, ep. 24).
    previewUrl: o.program.title === "Newsreel hour" && n === 24 ? null : `/mock-hls/${stream}/master.m3u8`,
    episodeNumber: n,
    firstAiredAt: at(aired),
    firstAiredOn: firstOn,
    captions: o.program.category === "Music" ? "none" : "generated",
    speech: o.program.category !== "Music"
  }));
}

// ---- agreements ----

export interface MkAgreement {
  id: string;
  offerId: string;
  carrierId: string;
  term: CarriageTerm;
  slots: Slot[];
  startedAt: string;
  endNoticeGivenAt: string | null;
  endsAt: string | null;
  airingsThisMonth: number;
  paidThisMonthMicros: number;
  audioOnly: boolean;
  /** Slots asked for but not yet on the carrier's log (placeInLog puts them there). */
  pending: { slots: Slot[]; startsOn: string; repeatSlots?: Slot[] } | null;
  /** The next episode number to air, in order. */
  nextEpisode: number;
}

const nightlyAt = (time: string): Slot[] => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, time }));
const weeknightsAt = (time: string): Slot[] => [1, 2, 3, 4, 5].map((weekday) => ({ weekday, time }));
const on = (weekday: number, time: string): Slot[] => [{ weekday, time }];

function agreement(id: number, offerId: string, carrier: StationIdent, term: CarriageTerm, slots: Slot[], since: string, airings: number, paid: number, o: Partial<MkAgreement> = {}): MkAgreement {
  return { id: uid(id), offerId, carrierId: carrier.id, term, slots, startedAt: at(since), endNoticeGivenAt: null, endsAt: null, airingsThisMonth: airings, paidThisMonthMicros: paid, audioOnly: carrier.band === "radio", pending: null, nextEpisode: 1, ...o };
}

export function seedAgreements(offers: MkOffer[]): MkAgreement[] {
  const id = (t: string) => offers.find((o) => o.program.title === t)!.id;
  const explicit: MkAgreement[] = [
    // What BEAT carries (the log's agreement ids).
    agreement(270001, id("Saturday Reel"), BEAT, "barter", on(6, "20:30"), "-60 12:00", 4, 0, { nextEpisode: 31 }),
    agreement(270002, id("Slow Hours"), BEAT, "barter", nightlyAt("22:30"), "-40 12:00", 26, 0, { nextEpisode: 22 }),
    // Who carries BEAT's programs (offering 04.1).
    agreement(270101, id("Late Crate"), HALL, "barter", nightlyAt("03:00"), "-27 12:00", 27, $(22.4)),
    agreement(270102, id("Late Crate"), SAZN, "barter", on(0, "23:00"), "-21 12:00", 4, $(8.8)),
    agreement(270103, id("Beat Tape Live"), CRAT, "cash", on(6, "21:00"), "-18 12:00", 4, $(12)),
    // Slow Hours elsewhere (market 02.1).
    agreement(270111, id("Slow Hours"), DUST, "barter", [...on(6, "01:00"), ...on(0, "01:00")], "-50 12:00", 8, $(9.6)),
    // The studio's carriers (market 04.1): 9 stations, $186.40 in September.
    agreement(270201, id("Crate Diggers Radio Hour"), HALL, "barter", weeknightsAt("01:00"), "-80 12:00", 20, $(52.1)),
    agreement(270202, id("Crate Diggers Radio Hour"), NITE, "barter", on(0, "22:00"), "-70 12:00", 4, $(38.2)),
    agreement(270203, id("Crate Diggers Radio Hour"), VOZE, "barter", on(5, "23:00"), "-60 12:00", 4, $(21.6)),
    agreement(270204, id("Crate Diggers Radio Hour"), DUST, "barter", on(3, "22:00"), "-45 12:00", 4, $(14.3)),
    agreement(270211, id("Studio Notes"), SAZN, "cash", on(2, "19:30"), "-38 12:00", 10, $(20)),
    agreement(270212, id("Studio Notes"), REEL, "cash", on(4, "19:30"), "-30 12:00", 7, $(14)),
    agreement(270213, id("Studio Notes"), PREP, "cash", on(1, "18:30"), "-22 12:00", 4, $(8)),
    agreement(270221, id("Loops for Late Nights"), CRAT, "barter", nightlyAt("02:00"), "-40 12:00", 26, $(10.4)),
    agreement(270222, id("Loops for Late Nights"), LA[1]!, "barter", weeknightsAt("02:00"), "-33 12:00", 20, $(7.8))
  ];
  // Everyone else's carriers, to the drawn counts: in the market first, then Los Angeles.
  const counts: Record<string, number> = {
    "Slow Hours": 5,
    "Nights at the observatory": 14,
    "Council Watch": 6,
    "Newsreel hour": 3,
    "Saturday Reel": 12,
    "The Producers’ Hour": 9,
    "Night Desk": 4,
    "Cartoons, 1928 to 1936": 12,
    "The mystery hour": 6,
    "Newsreels, 1930 to 1950": 5,
    "National parks on film": 8,
    "Desert country, all night": 1,
    "Noche de oldies": 2,
    "Double feature": 1
  };
  const pool = [CIVC, SAZN, REEL, PREP, NITE, HALL, CRAT, VOZE, DUST, ...LA];
  const out = [...explicit];
  let n = 0;
  for (const o of offers) {
    const want = counts[o.program.title];
    if (!want) continue;
    const have = out.filter((a) => a.offerId === o.id);
    const taken = new Set([o.maker.id, BEAT.id, ...have.map((a) => a.carrierId)]);
    // Slow Hours' other three are in Los Angeles (market 02.1).
    const candidates = o.program.title === "Slow Hours" ? LA : pool;
    for (const st of candidates) {
      if (out.filter((a) => a.offerId === o.id).length >= want) break;
      if (taken.has(st.id)) continue;
      taken.add(st.id);
      n++;
      const term = o.termsOffered[0]!;
      const paid = term === "free" ? 0 : term === "cash" ? (o.cashPriceMicros ?? 0) * 4 : $(4.2);
      out.push(agreement(270500 + n, o.id, st, term, on(n % 7, n % 2 ? "22:00" : "01:00"), `-${20 + (n % 30)} 12:00`, 4, paid));
    }
  }
  return out;
}

// ---- requests ----

export interface MkRequest {
  id: string;
  offerId: string;
  carrierId: string;
  term: CarriageTerm;
  slots: Slot[];
  startsOn: string;
  audioOnly: boolean;
  status: CarriageRequest["status"];
  declineReason: CarriageRequest["declineReason"];
  carrierSpotMsPerHour: number;
  createdAt: string;
  decidedAt: string | null;
  agreementId: string | null;
}

/** The local date of a moment, in the station's zone: "2026-09-28". */
export function localDate(iso: string): string {
  const d = new Date(Date.parse(iso) - OFFSET_HOURS * 3600e3);
  return d.toISOString().slice(0, 10);
}

export function seedRequests(offers: MkOffer[]): MkRequest[] {
  const lateCrate = offers.find((o) => o.program.title === "Late Crate")!;
  return [
    // NITE asked two hours ago to carry Late Crate weeknights at 1:00 am, on barter, from Monday.
    { id: uid(620001), offerId: lateCrate.id, carrierId: NITE.id, term: "barter", slots: weeknightsAt("01:00"), startsOn: localDate(at("+2 12:00")), audioOnly: true, status: "asked", declineReason: null, carrierSpotMsPerHour: 2 * MIN, createdAt: at("18:42"), decidedAt: null, agreementId: null }
  ];
}

// ---- saved state ----

export interface MarketState {
  version: number;
  offers: MkOffer[];
  agreements: MkAgreement[];
  requests: MkRequest[];
}

export const MARKET_VERSION = 1;
const KEY = "oc-mock-control-market";
let state: MarketState | null = null;

export function seedMarket(): MarketState {
  const offers = seedOffers();
  return { version: MARKET_VERSION, offers, agreements: seedAgreements(offers), requests: seedRequests(offers) };
}

export function getMarket(): MarketState {
  if (state) return state;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    const saved = raw ? (JSON.parse(raw) as MarketState) : null;
    state = saved && saved.version === MARKET_VERSION ? saved : seedMarket();
  } catch {
    state = seedMarket();
  }
  return state;
}

export function saveMarket() {
  try {
    localStorage.setItem(KEY, JSON.stringify(getMarket()));
  } catch {
    // Private windows: the mock keeps state for this visit only.
  }
}

/** Tests start from the seed. */
export function resetMarket() {
  state = seedMarket();
}

export const MARKET_KEY = KEY;
