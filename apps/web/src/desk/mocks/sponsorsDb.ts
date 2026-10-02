// The mock API's Catalog sponsors (desk-pages 03): the catalog's credit sold by series and market.
// The series and the rules (prices, the split) are the Settings mock's (settingsDb); the sponsors,
// the businesses and what aired are kept here, in localStorage ("oc-mock-desk-sponsors"; remove it
// to start again). Seeded from the frame: Inland Empire Libraries thanked in Nights at the
// observatory in the Inland Empire since August, Clear everywhere else.

import { CATALOG_HOUSE_SPONSOR, type CatalogSlot, type CatalogSponsorBusiness, type CatalogSponsors, type CatalogSponsorship, type RuleValue } from "@opencast/contracts";
import { now } from "../../lib/clock";
import type { MockPerson } from "../../mocks/people";
import { MARKETS, HD, IE, LA } from "./fixtures/markets";
import { U } from "./fixtures/ids";
import { DEE_ID, isAdminNow, nameOf, settingsDb, valueAt } from "./settingsDb";

export const SPONSORS_DB_KEY = "oc-mock-desk-sponsors";
const VERSION = 1;

export interface MockCatalogSponsorship {
  id: string;
  businessId: string;
  /** Null: every catalog series in the market. */
  seriesId: string | null;
  marketId: string;
  monthlyMicros: number;
  creditText: string;
  status: "requested" | "approved" | "ended" | "declined" | "lapsed";
  offeredBy: string | null;
  assigned: boolean;
  startsOn: string;
  /** Months held and paid, `YYYY-MM-01`. */
  paidMonths: string[];
  createdAt: string;
  /** Credits naming it this month (the mock doesn't air anything). */
  creditsThisMonth: number;
}

interface SponsorsDb {
  version: number;
  businesses: CatalogSponsorBusiness[];
  /** Each business's balance a month can be held from. */
  available: Record<string, number>;
  sponsorships: MockCatalogSponsorship[];
  /** How the series air, per series and market: a day, on how many stations, credits this month. */
  airs: Record<string, { perDay: number; stations: number; credits: number }>;
  seq: number;
}

const NIGHTS = U(7101);
const CARTOONS = U(7102);
const PARKS = U(7103);
const NEWSREELS = U(7104);
const MYSTERY = U(7105);
export const LIBRARIES = U(9601);
export const COFFEE = U(9602);
export const TUMBLEWEED = U(9603);

function seed(): SponsorsDb {
  const air = (perDay: number, stations: number, credits: number) => ({ perDay, stations, credits });
  // 2,840 credits this month: 428 thanked Inland Empire Libraries, the other 2,412 Clear.
  const airs: SponsorsDb["airs"] = {
    [`${NIGHTS}:${IE.id}`]: air(6, 6, 428),
    [`${CARTOONS}:${IE.id}`]: air(12, 5, 610),
    [`${PARKS}:${IE.id}`]: air(4, 4, 300),
    [`${NEWSREELS}:${IE.id}`]: air(3, 3, 250),
    [`${MYSTERY}:${IE.id}`]: air(2, 2, 180),
    [`${NIGHTS}:${HD.id}`]: air(2, 2, 200),
    [`${CARTOONS}:${HD.id}`]: air(5, 3, 180),
    [`${PARKS}:${HD.id}`]: air(2, 2, 120),
    [`${NEWSREELS}:${HD.id}`]: air(1, 1, 90),
    [`${MYSTERY}:${HD.id}`]: air(1, 1, 60),
    [`${NIGHTS}:${LA.id}`]: air(1, 1, 150),
    [`${CARTOONS}:${LA.id}`]: air(3, 2, 120),
    [`${PARKS}:${LA.id}`]: air(1, 1, 80),
    [`${NEWSREELS}:${LA.id}`]: air(1, 1, 50),
    [`${MYSTERY}:${LA.id}`]: air(1, 1, 22)
  };
  return {
    version: VERSION,
    businesses: [
      { id: LIBRARIES, name: "Inland Empire Libraries", category: "Libraries", city: "San Bernardino" },
      { id: COFFEE, name: "Orange Street Coffee", category: "Coffee and food", city: "Redlands" },
      { id: TUMBLEWEED, name: "Tumbleweed Books", category: "Books", city: "Yucca Valley" }
    ],
    available: { [LIBRARIES]: 1_200_000_000, [COFFEE]: 180_000_000, [TUMBLEWEED]: 0 },
    sponsorships: [
      {
        id: U(9701),
        businessId: LIBRARIES,
        seriesId: NIGHTS,
        marketId: IE.id,
        monthlyMicros: 150_000_000,
        creditText: "Cards, films and rooms to think, in every city in the valley.",
        status: "approved",
        offeredBy: DEE_ID,
        assigned: false,
        startsOn: "2026-08-01",
        paidMonths: ["2026-08-01", "2026-09-01"],
        createdAt: "2026-07-28T17:00:00.000Z",
        creditsThisMonth: 428
      }
    ],
    airs,
    seq: 0
  };
}

let db: SponsorsDb | null = null;

export function sponsorsDb(): SponsorsDb {
  if (db) return db;
  try {
    const raw = localStorage.getItem(SPONSORS_DB_KEY);
    const saved = raw ? (JSON.parse(raw) as SponsorsDb) : null;
    db = saved && saved.version === VERSION ? saved : seed();
  } catch {
    db = seed();
  }
  return db;
}

export function saveSponsors() {
  try {
    localStorage.setItem(SPONSORS_DB_KEY, JSON.stringify(sponsorsDb()));
  } catch {
    // Private windows: kept for this visit only.
  }
}

export function resetSponsors() {
  db = seed();
  saveSponsors();
}

if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key === SPONSORS_DB_KEY || e.key === null) db = null;
  });

export function nextSponsorId(): string {
  const d = sponsorsDb();
  d.seq += 1;
  return U(960_000 + d.seq);
}

export const monthOf = (iso: string) => iso.slice(0, 7) + "-01";
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 10);
};
const lastDayOf = (month: string) => new Date(Date.parse(shiftMonth(month, 1)) - 86_400_000).toISOString().slice(0, 10);

/** Series on the shelf that can be sponsored (not "coming"). */
export function sponsorableSeries() {
  return settingsDb()
    .series.filter((s) => s.state !== "coming")
    .map((s) => ({ id: s.id, title: s.title, colour: s.colour }));
}

/** The markets a person may offer, assign and end in: every market for an admin, a market lead's own. */
export function editableMarkets(p: MockPerson): string[] {
  if (isAdminNow(p)) return MARKETS.map((m) => m.id);
  return settingsDb()
    .roles.filter((r) => r.personId === p.id && r.role === "market_lead" && r.marketId)
    .map((r) => r.marketId!);
}

export function priceOf(marketId: string, seriesId: string | null): number | null {
  const v = valueAt("catalog.sponsor_prices", now(), marketId) as RuleValue<"catalog.sponsor_prices">;
  return seriesId ? v.seriesMonthlyMicros : v.everySeriesMonthlyMicros;
}

export const isLive = (s: MockCatalogSponsorship) => s.status === "requested" || s.status === "approved";

function stateOf(s: MockCatalogSponsorship, month: string): CatalogSponsorship["state"] {
  const paid = s.paidMonths.includes(month);
  if (s.status === "requested") return "offered";
  if (s.status === "approved") return paid ? "credited" : "starting";
  if (s.status === "ended") return paid ? "ending" : "ended";
  return s.status;
}

export function sponsorshipView(s: MockCatalogSponsorship, p: MockPerson | null): CatalogSponsorship {
  const d = sponsorsDb();
  const month = monthOf(now().toISOString());
  const state = stateOf(s, month);
  const series = s.seriesId ? sponsorableSeries().find((x) => x.id === s.seriesId) ?? null : null;
  const stations = Object.entries(d.airs)
    .filter(([k]) => k.endsWith(`:${s.marketId}`) && (!s.seriesId || k.startsWith(`${s.seriesId}:`)))
    .reduce((n, [, a]) => n + a.stations, 0);
  return {
    id: s.id,
    business: { id: s.businessId, name: d.businesses.find((b) => b.id === s.businessId)?.name ?? "" },
    series,
    market: MARKETS.find((m) => m.id === s.marketId)!,
    monthlyMicros: s.monthlyMicros,
    creditText: s.creditText,
    state,
    how: s.assigned ? "assigned" : "offered",
    startsOn: s.startsOn,
    renewsOn: state === "credited" ? shiftMonth(month, 1) : state === "starting" ? (s.startsOn > month ? s.startsOn : shiftMonth(month, 1)) : null,
    endsOn: state === "ending" ? lastDayOf(month) : null,
    since: [...s.paidMonths].sort()[0] ?? null,
    offeredBy: s.offeredBy ? { userId: s.offeredBy, name: nameOf(s.offeredBy) } : null,
    createdAt: s.createdAt,
    creditsThisMonth: state === "credited" || state === "ending" ? s.creditsThisMonth : 0,
    airsOn: stations,
    canEnd: !!p && editableMarkets(p).includes(s.marketId) && (state === "offered" || state === "starting" || state === "credited")
  };
}

/** The page: every slot, who its credit thanks, the price, and the sponsors. */
export function sponsorsView(p: MockPerson, marketId?: string): CatalogSponsors {
  const d = sponsorsDb();
  const month = monthOf(now().toISOString());
  const series = sponsorableSeries();
  const editable = new Set(editableMarkets(p));
  const paidNow = (s: MockCatalogSponsorship) => (s.status === "approved" || s.status === "ended") && s.paidMonths.includes(month);
  const slots: CatalogSlot[] = [];
  for (const market of MARKETS) {
    for (const s of [...series, null]) {
      const mine = d.sponsorships.filter((x) => x.marketId === market.id && x.seriesId === (s?.id ?? null));
      const offer = mine.find((x) => x.status === "requested") ?? null;
      const own = mine.find((x) => x.status === "approved") ?? null;
      const paid = mine.find(paidNow) ?? null;
      const every = s ? d.sponsorships.find((x) => x.marketId === market.id && x.seriesId === null && paidNow(x)) : null;
      const airs = Object.entries(d.airs).filter(([k]) => k.endsWith(`:${market.id}`) && (!s || k.startsWith(`${s.id}:`)));
      const price = priceOf(market.id, s?.id ?? null);
      slots.push({
        series: s,
        market,
        creditedBy: paid ? "sponsor" : every ? "every_series" : "house",
        sponsorshipId: (paid ?? own)?.id ?? null,
        offerId: offer?.id ?? null,
        priceMicros: price,
        forSale: price !== null && price > 0 && !offer && !own,
        airsPerDay: airs.reduce((n, [, a]) => n + a.perDay, 0),
        stations: airs.reduce((n, [, a]) => n + a.stations, 0),
        creditsThisMonth: airs.reduce((n, [, a]) => n + a.credits, 0),
        canEdit: editable.has(market.id)
      });
    }
  }
  const total = Object.values(d.airs).reduce((n, a) => n + a.credits, 0);
  const sponsored = d.sponsorships.filter(paidNow).reduce((n, x) => n + x.creditsThisMonth, 0);
  const split = valueAt("shares.catalog_sponsorship", now()) as RuleValue<"shares.catalog_sponsorship">;
  const inScope = (id: string) => !marketId || id === marketId;
  return {
    month,
    stats: {
      creditsThisMonth: total,
      monthlyMicros: d.sponsorships.filter(paidNow).reduce((n, x) => n + x.monthlyMicros, 0),
      marketsWithOpenSlots: new Set(slots.filter((x) => x.forSale).map((x) => x.market.id)).size,
      fundShareBps: split.fundBps,
      fundShareSet: !!(split.opencastBps || split.poolBps || split.fundBps)
    },
    house: {
      name: CATALOG_HOUSE_SPONSOR.name,
      creditText: CATALOG_HOUSE_SPONSOR.creditText,
      creditsThisMonth: total - sponsored,
      billedMicros: null,
      lastMonth: { month: shiftMonth(month, -1), slots: 14, credits: 2_298 }
    },
    sponsors: d.sponsorships.filter((x) => (isLive(x) || paidNow(x)) && inScope(x.marketId)).map((x) => sponsorshipView(x, p)),
    slots: slots.filter((x) => inScope(x.market.id)),
    series,
    markets: MARKETS,
    editableMarketIds: [...editable]
  };
}

/** The mock's credit check: prices, offers and calls to action (the API's is @opencast/domain's). */
export function creditProblem(text: string): string | null {
  const m = /\$\s?\d[\d,.]*|\b\d+\s?%|\b(?:free|sales?|deals?|discounts?|off|save|call(?: us)?|visit(?: us)?|order|shop|buy|now)\b/i.exec(text);
  return m ? `The credit can't be sent yet: "${m[0]}". A credit names who they are and where, never what they sell.` : null;
}

/** "$150.00". */
export const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

export { NIGHTS as MOCK_NIGHTS, CARTOONS as MOCK_CARTOONS };
