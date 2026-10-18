// Every number on the site (SITE-SPEC §5), in one module: prices, Dial's share, the comparisons,
// and the calculators that use them. Markup imports from here; nothing writes these as literals.
// packages/domain has none of these; the platform's rules registry differs in places
// (docs/site/open-questions.md Q1 to Q3, docs/contract-requests.md DX1 to DX3).

/** Station usage, pay as you go, one channel per station (run/run.js `PRICE`). */
export const PRICE = {
  /** Storage, per GB a month; only what's scheduled in the next 7 days is stored. */
  gb: 0.04,
  freeGb: 10,
  /** Relays of everything aired, per hour, never over the cap a month. Relays of live shows only are free. */
  relayHr: 0.05,
  relayCap: 25,
  /** Live hours, TV, per hour; radio live hours are free. */
  liveHr: 0.75,
  freeLive: 5,
  /** The month the estimates use. */
  hours: 720
} as const;

/** Days a station keeps relays and live hours after a bill can't be paid. */
export const GRACE_DAYS = 14;
/** Days a waitlist hold lasts. */
export const HOLD_DAYS = 120;

/** About this much per 1,000 tuned in, per spot (a 15-second unit). */
export const SPOT_CPM = 8;
/** Spot units in a minute of break time. */
export const UNITS_PER_MINUTE = 4;

/** What Dial keeps, per dollar earned, by source (the station keeps the rest). */
export const SHARES = {
  spotsBooked: 0.1,
  spotsSourced: 0.2,
  pledges: 0.05,
  syndicationCash: 0.05,
  backfill: 0.2
} as const;
export type ShareSource = keyof typeof SHARES;

/** The most a maker can take on revenue share, so a station always keeps the rest. */
export const MAKER_SHARE_CAP = 0.8;

/** What other platforms keep, from their published terms. */
export const ELSEWHERE = {
  youtubeAds: 0.45,
  youtubeMemberships: 0.3,
  twitchAds: 0.45,
  twitchSubs: 0.5,
  patreon: 0.1
} as const;

/** "10%" */
export const pct = (v: number) => `${Math.round(v * 100)}%`;
/** "$29.95" */
export const money = (v: number) => `$${v.toFixed(2)}`;
/** "$0.04", "$25": cents only when there are some. */
export const price = (v: number) => (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);

// ---- Run: "Estimate your month" (run/run.js calc()) ----

/** The library slider's stops, in GB. */
export const LIBRARY_STOPS = [25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000] as const;

/** Relays: off, live shows only, everything aired. */
export type RelayMode = 0 | 1 | 2;

export interface Usage {
  /** GB on air in the next 7 days. */
  gb: number;
  /** Live hours a month (TV). */
  live: number;
  relays: RelayMode;
  /** The whole library, GB; caps `gb`. */
  library?: number;
}

export interface Estimate {
  gb: number;
  storage: number;
  relays: number;
  live: number;
  total: number;
}

export function estimate(u: Usage): Estimate {
  const gb = u.library !== undefined ? Math.min(u.gb, u.library) : u.gb;
  const storage = Math.max(0, gb - PRICE.freeGb) * PRICE.gb;
  const relays = u.relays === 2 ? Math.min(PRICE.relayCap, PRICE.hours * PRICE.relayHr) : 0;
  const live = Math.max(0, u.live - PRICE.freeLive) * PRICE.liveHr;
  return { gb, storage, relays, live, total: storage + relays + live };
}

/** "500 GB", "1 TB", "1.5 TB" */
export const size = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(g % 1000 ? 1 : 0)} TB` : `${g} GB`);

// ---- Run: the same channel elsewhere (run/run.js COMP and vs()) ----

export interface Competitor {
  n: string;
  /** [GB held, $ a month, plan name], cheapest first. */
  tiers: readonly (readonly [number, number, string])[];
  note?: string;
}

/** Published plans for one 24/7 1080p channel, October 2026. */
export const COMPETITORS: readonly Competitor[] = [
  { n: "Livepush", tiers: [[20, 39, "Editors"], [50, 69, "Creators"], [100, 119, "Business"]] },
  { n: "Upstream", tiers: [[100, 30, "1 stream"]], note: "100 GB is its free plan; paid storage not published" },
  { n: "Gyre", tiers: [[75, 99, "Start+"], [150, 169, "PRO+"]] }
];

export interface Comparison {
  n: string;
  fits: boolean;
  price: number | null;
  plan: string;
  /** Positive: they cost that much more than Dial. */
  diff: number;
  over: number;
}

export function compare(library: number, total: number): Comparison[] {
  return COMPETITORS.map((c) => {
    const tier = c.tiers.find((t) => library <= t[0]);
    const top = c.tiers[c.tiers.length - 1]![0];
    if (!tier) return { n: c.n, fits: false, price: null, plan: `Largest published plan holds ${top} GB`, diff: 0, over: library - top };
    return { n: c.n, fits: true, price: tier[1], plan: `${tier[2]}, ${tier[0]} GB${c.note ? ` · ${c.note}` : ""}`, diff: tier[1] - total, over: 0 };
  });
}

// ---- Run: "Does it cover your costs?" (run/run.js pay()) ----

export interface Takings {
  /** People tuned in, on average. */
  tuned: number;
  /** Minutes of spot time sold each hour. */
  minutes: number;
  /** Pledges a month, $. */
  pledges: number;
  /** The month's usage bill (the estimate). */
  bill: number;
}

export interface Coverage {
  spots: number;
  pledges: number;
  earned: number;
  /** The part of the bill earnings pay. */
  paid: number;
  left: number;
  verdict: string;
}

export function coverage(t: Takings): Coverage {
  const spots = ((t.minutes * UNITS_PER_MINUTE * PRICE.hours * t.tuned * SPOT_CPM) / 1000) * (1 - SHARES.spotsBooked);
  const pledges = t.pledges * (1 - SHARES.pledges);
  const earned = spots + pledges, cost = t.bill, left = Math.max(0, earned - cost);
  let verdict: string;
  if (cost <= 0) verdict = "Your month costs nothing to run";
  else if (earned >= cost) {
    const x = earned / cost;
    verdict = x >= 2 ? `Covers your month ${x >= 10 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, "")}× over` : "Covers your month, with some left";
  } else verdict = `Covers ${Math.round((earned / cost) * 100)}% of your month`;
  return { spots, pledges, earned, paid: Math.min(cost, earned), left, verdict };
}

/** The spot-time slider's label: "None", "30 sec", "1 min", "1.25 min". */
export function minutesLabel(m: number): string {
  if (m === 0) return "None";
  if (m < 1) return `${Math.round(m * 60)} sec`;
  return `${m % 1 ? m.toFixed(2).replace(/0$/, "") : m} min`;
}

/** The Run calculators' starting values (the reference's). */
export const RUN_DEFAULTS = {
  libraryStop: 7,
  gb: 40,
  live: 10,
  relays: 2 as RelayMode,
  tuned: 10,
  minutes: 0.5,
  pledges: 50
};

// ---- Syndication: what a show earns across the network (syndication/synd.js #earn) ----

/** Revenue share: each station's ad revenue (after Dial's share) × the show's share of watch time × the maker's share. Cash: airings a month × price, less Dial's share. */
export interface CarriageInput {
  mode: "share" | "cash";
  stations: number;
  /** Share: each station's ad revenue a month, $. */
  revenue: number;
  /** Share: the show's share of what's watched, 0 to 1. */
  watch: number;
  /** Share: the maker's share, capped at MAKER_SHARE_CAP. */
  share: number;
  /** Cash: airings a week, per station. */
  airings: number;
  /** Cash: price per airing, $. */
  price: number;
}

export interface CarriageEarnings {
  /** Airings a month, one station (cash). */
  monthly: number;
  /** Dial's cut, one station (cash). */
  fee: number;
  one: number;
  total: number;
  year: number;
}

export function carriage(c: CarriageInput): CarriageEarnings {
  if (c.mode === "share") {
    const one = c.revenue * c.watch * Math.min(c.share, MAKER_SHARE_CAP);
    return { monthly: 0, fee: 0, one, total: one * c.stations, year: one * c.stations * 12 };
  }
  const monthly = (c.airings * 52) / 12;
  const one = monthly * c.price * (1 - SHARES.syndicationCash);
  return { monthly, fee: monthly * c.price * SHARES.syndicationCash, one, total: one * c.stations, year: one * c.stations * 12 };
}

/** "$1,284.60" */
export const moneyC = (v: number) => `$${v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
/** "$6,912" */
export const wholeC = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export const SYND_DEFAULTS: CarriageInput = { mode: "share", stations: 12, revenue: 600, watch: 0.2, share: 0.4, airings: 3, price: 2.5 };

// ---- Spots: the planner (spots/spots.js planner) ----

/** What one airing costs at the spot market's rate: 312 tuned in → $2.50. */
export const airingCost = (viewers: number, cpm = SPOT_CPM) => (viewers * cpm) / 1000;

export type TimeOfDay = "m" | "d" | "p" | "l";

export interface PlanStation {
  n: string;
  cs: string;
  c: string;
  /** Kind of station. */
  k: string;
  city: string;
  mk: string;
  /** Miles from the shop. */
  mi: number;
  /** Viewers a spot. */
  aud: number;
  /** Breaks a day, by time of day. */
  t: Record<TimeOfDay, number>;
}

export interface PlanInput {
  where: "shop" | "online";
  miles: number;
  markets: ReadonlySet<string>;
  kinds: ReadonlySet<string>;
  times: ReadonlySet<TimeOfDay>;
  /** Per 1,000 tuned in ("k") or per airing ("a"). */
  rateKind: "k" | "a";
  rate: number;
  budget: number;
  cap: number;
}

export interface PlanRow {
  s: PlanStation;
  why: string;
  /** Airings a day before the cap. */
  ad: number;
  /** Chance a station picks it. */
  p: number;
  cost: number;
}

export interface Plan {
  fits: PlanRow[];
  out: PlanRow[];
  airings: number;
  tuned: number;
  spend: number;
  /** What the daily cap scaled everything by (1 when it didn't bite). */
  scale: number;
  days: number;
  /** Average chance of being picked, 0 to 1. */
  pick: number;
}

/** How likely a station is to pick the spot at this rate (spots.js chance()). */
export function pickChance(s: PlanStation, rateKind: PlanInput["rateKind"], rate: number): number {
  const v = rateKind === "k" ? (rate - 2) / 9 : (rate / airingCost(s.aud) - 0.3) / 1.1;
  return Math.max(0.08, Math.min(0.97, 0.12 + v * 0.85));
}

export function plan(stations: readonly PlanStation[], f: PlanInput): Plan {
  const cap = Math.min(f.cap, f.budget);
  const fits: PlanRow[] = [], out: PlanRow[] = [];
  for (const s of stations) {
    let why = "";
    if (f.where === "shop" && s.mi > f.miles) why = `Farther than ${f.miles} mi`;
    else if (f.where === "online" && !f.markets.has(s.mk)) why = "Not in your markets";
    else if (!f.kinds.has(s.k)) why = "Not a kind you picked";
    let slots = 0;
    for (const t of f.times) slots += s.t[t];
    if (!why && !slots) why = "No breaks at those times";
    const p = pickChance(s, f.rateKind, f.rate);
    (why ? out : fits).push({ s, why, ad: slots * p, p, cost: f.rateKind === "k" ? (s.aud * f.rate) / 1000 : f.rate });
  }
  let airings = 0, tuned = 0, spend = 0, pk = 0;
  for (const r of fits) {
    airings += r.ad;
    tuned += r.ad * r.s.aud;
    spend += r.ad * r.cost;
    pk += r.p;
  }
  const scale = spend > cap ? cap / spend : 1;
  airings *= scale;
  tuned *= scale;
  spend *= scale;
  fits.sort((a, b) => b.ad - a.ad);
  return { fits, out, airings, tuned, spend, scale, days: spend > 0 ? f.budget / spend : 0, pick: fits.length ? pk / fits.length : 0 };
}

/** "9.5", "12" */
export const airingsLabel = (a: number) => (a >= 10 ? String(Math.round(a)) : a.toFixed(1));
/** "20 days", "1 day", "90+ days", "—" */
export const daysLabel = (p: Plan) => (p.spend > 0 ? (p.days >= 90 ? "90+ days" : `${Math.max(1, Math.round(p.days))}${Math.round(p.days) === 1 ? " day" : " days"}`) : "—");
/** "Many will" */
export const pickLabel = (p: Plan) => (!p.fits.length ? "No one yet" : p.pick > 0.75 ? "Most will" : p.pick > 0.5 ? "Many will" : p.pick > 0.3 ? "Some will" : "Few will");

/** The part of Dial's share of spots that goes back to stations through the co-op pool (the Network page's "Follow the dollar"). */
export const POOL_SHARE_OF_OURS = 0.25;
