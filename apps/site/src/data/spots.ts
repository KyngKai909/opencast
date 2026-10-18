// Spots' content (docs/reference/site/source/spots/body.py and spots.js). Copy is the reference's;
// prices and shares come from pricing.ts, station colours from stations.ts and dial.ts.
import { DIAL } from "./dial";
import { airingCost, pct, SHARES, type PlanStation, type TimeOfDay } from "./pricing";
import type { Qa } from "../components/Faq.astro";
import type { TickerItem } from "../components/Ticker.astro";

export const WHO = [
  { L: "A", c: "#E0583A", t: "You have a shop", tag: "Set a distance", h: "Down the street", p: "Pick how far your customers come from. Your spot airs on stations watched inside that circle.", rows: [["Within", "8 miles of Orange St"], ["Counted by", "Clear Pay at the counter"]], go: "Plan a spot" },
  { L: "B", c: "#5B7BE0", t: "You sell online", tag: "Pick markets", h: "Ships anywhere", p: "No storefront needed. Choose the markets you ship to, and codes used at checkout count on their own.", rows: [["Markets", "Inland Empire, Long Beach"], ["Counted by", "Shopify, Stripe or Square"]], go: "Plan a spot" },
  { L: "C", c: "#2F9A72", t: "You run an agency", tag: "One login", h: "For your clients", p: "Every business you manage in one place, each with its own balance, spots and statements. Order spots made for them too.", rows: [["Businesses", "As many as you manage"], ["Statements", "One per business, monthly"]], go: "Talk to us" }
] as const;

export const BOOKED: TickerItem[] = [
  { badge: "12.1", color: "#C04A9E", html: "<b>Juniper Barber Co.</b> is sponsoring <b>Late Crate</b> <em>· $120 a month · 3 min ago</em>" },
  { badge: "18.1", color: "#E0583A", html: "<b>Redlands Hardware</b> ordered a :30 from <b>SAZN</b> <em>· quoted $180 · 8 min ago</em>" },
  { badge: "7.1", color: "#2F9A72", html: "<b>Cuevas Bakery</b> booked a :15 on <b>CIVC and 4 more</b> <em>· $6 per 1,000 · 12 min ago</em>" },
  { badge: "88.4", color: "#5B7BE0", html: "<b>Sole Shop, online</b> booked a :30 in <b>Inland Empire</b> <em>· $9 per 1,000 · 19 min ago</em>" },
  { badge: "24.1", color: "#D98A2B", html: "<b>Magnolia Books</b> is sponsoring <b>Saturday Reel</b> <em>· $200 a month · 26 min ago</em>" }
];

/** The control room's break, in seconds (26 in all). Your spot is the cream one. */
export const SEGMENTS = [
  { d: 4, k: "prog", l: "Late Crate", c: "#C04A9E", chip: "Program" },
  { d: 2, k: "bump", l: "Bumper", c: "#7a3b8f", chip: "Bumper" },
  { d: 4, k: "jun", l: "Juniper", c: "#2F9A72", chip: "Spot, :15" },
  { d: 7, k: "you", l: "Your spot", c: "#F3EAD9", chip: "Your spot, :15" },
  { d: 4, k: "red", l: "Redlands", c: "#3478C6", chip: "Spot, :30" },
  { d: 2, k: "id", l: "ID", c: "#E0583A", chip: "Station ID" },
  { d: 3, k: "prog", l: "Late Crate", c: "#C04A9E", chip: "Program" }
] as const;
/** The room: the most tuned in for your spot, tonight's spend so far, and customers so far. */
export const ROOM = { peak: 312, tonight: 33.02, customers: 9, budget: 300 };

export const KINDS = ["Music", "Film", "Food", "Sports", "Civic", "Talk", "Radio"] as const;
export const TIMES: readonly (readonly [TimeOfDay, string])[] = [["m", "Morning"], ["d", "Daytime"], ["p", "Prime"], ["l", "Late night"]];
export const MARKETS = ["Inland Empire", "High Desert", "Orange County", "Long Beach", "Coachella Valley"] as const;

const st = (cs: string, k: string, city: string, mk: string, mi: number, aud: number, t: [number, number, number, number]): PlanStation => {
  const d = DIAL.find((x) => x.cs === cs)!;
  return { n: d.n, cs, c: d.c ?? "#9A9CAB", k, city, mk, mi, aud, t: { m: t[0], d: t[1], p: t[2], l: t[3] } };
};

/** The planner's stations: distance from 1840 Orange St, viewers a spot, breaks a day by time. */
export const PLAN_STATIONS: readonly PlanStation[] = [
  st("CIVC", "Civic", "Riverside", "Inland Empire", 2, 140, [2, 4, 3, 1]),
  st("NITE", "Radio", "San Bernardino", "Inland Empire", 9, 180, [2, 2, 3, 5]),
  st("SAZN", "Food", "Fontana", "Inland Empire", 11, 260, [3, 4, 4, 1]),
  st("REEL", "Film", "Redlands", "Inland Empire", 13, 300, [0, 2, 4, 4]),
  st("MATN", "Film", "Network catalog", "Inland Empire", 15, 210, [2, 3, 3, 3]),
  st("PREP", "Sports", "Upland", "Inland Empire", 22, 520, [0, 2, 5, 1]),
  st("BEAT", "Music", "Pomona", "Inland Empire", 24, 380, [0, 2, 4, 5]),
  st("ORNG", "Talk", "Anaheim", "Orange County", 31, 340, [3, 3, 3, 1]),
  st("MESA", "Music", "Victorville", "High Desert", 46, 220, [1, 2, 4, 3]),
  st("LBCH", "Music", "Long Beach", "Long Beach", 52, 300, [1, 2, 4, 4]),
  st("FLDR", "Radio", "Mojave", "High Desert", 58, 60, [1, 1, 1, 3]),
  st("VALE", "Film", "Palm Desert", "Coachella Valley", 66, 190, [1, 2, 3, 2]),
  st("VOZE", "Radio", "Coachella", "Coachella Valley", 72, 240, [4, 3, 2, 1])
];

export const PLAN_START = { where: "shop" as const, miles: 12, markets: ["Inland Empire", "Long Beach"], rateKind: "k" as const, rate: 8, budget: 300, cap: 15 };
export const RATE_RANGE = { k: { min: 2, max: 20, step: 0.5, value: 8, label: "Rate per 1,000 tuned in" }, a: { min: 0.5, max: 8, step: 0.25, value: 2.5, label: "Rate per airing" } } as const;

interface Airing {
  b: [string, string, string];
  w: string;
  held: number;
  lines: [string, string, boolean?][];
  billed: number;
  bar: [number, string, string][];
  s: [string, string, string];
  note: string;
}

/** Three airings from the statement. What each cost is worked out from who was billed. */
export const AIRINGS: readonly (Airing & { cost: number })[] = ([
  { b: ["#C04A9E", "12.1", "BEAT"], w: "Late Crate · Tue, 8:14 pm", held: 4, lines: [["Tuned in on the dial", "268"], ["Tuned in on YouTube, through the station’s relay", "44"]], billed: 312, bar: [[268, "#C04A9E", "On the dial"], [44, "#E0583A", "YouTube"]], s: ["$4.00 held at 8:13 pm", "312 people tuned in", "$2.50 paid, $1.50 back"], note: "A normal airing. 312 people tuned in, and at $8 per 1,000 that’s $2.50. The rest of the hold went straight back to your balance." },
  { b: ["#D98A2B", "24.1", "REEL"], w: "Saturday Reel · Sat, 9:02 pm", held: 4, lines: [["Tuned in on the dial", "301"], ["Tuned in on YouTube, with a location", "37"], ["On YouTube, no location given", "21", true]], billed: 338, bar: [[301, "#D98A2B", "On the dial"], [37, "#E0583A", "YouTube"], [21, "", "Not billed"]], s: ["$4.00 held at 9:01 pm", "338 counted, 21 not", "$2.70 paid, $1.30 back"], note: "YouTube didn’t say where 21 of its viewers were, so they weren’t billed. Relay viewers count only when the platform places them in your area." },
  { b: ["#5B7BE0", "88.4", "NITE"], w: "Night Shift · Fri, 11:40 pm", held: 2, lines: [["Listening when it started", "190", true], ["Cut off at 0:09 of :15", "Live hand-off"]], billed: 0, bar: [[190, "", "Not billed"]], s: ["$2.00 held at 11:39 pm", "Cut short at 0:09", "$0.00 paid, $2.00 back"], note: "The DJs went live nine seconds into your spot. An airing that’s cut short costs nothing, so the whole hold came back." }
] as Airing[]).map((a) => ({ ...a, cost: Math.round(airingCost(a.billed) * 100) / 100 }));

export const FUNNEL = [["Tuned in", 18420, "#9A9CAB"], ["Scanned the QR", 212, "#EBA03A"], ["Saved it for later", 96, "#C04A9E"], ["Used the code", 41, "#E0583A"]] as const;
export const COUNTED = [["At checkout online", "Shopify, Stripe or Square. Counted on its own", 17], ["At the counter", "Clear Pay. Counted on its own", 19], ["Anywhere else", "Marked in the app by you or a manager", 5]] as const;
/** The month's spend and what each customer cost, from the funnel. */
export const MONTH = { spent: airingCost(FUNNEL[0][1]), customers: COUNTED.reduce((a, c) => a + c[2], 0) };

export const SPOT_RULES = [
  ["Checked before it airs", "Length, loudness and picture, so it airs cleanly on every station. Your code and QR go on the end card."],
  ["Stations choose", "Each station decides which spots air in its breaks, and can turn away whole categories. Your spot only airs where it's welcome."],
  ["Counted, never guessed", "Viewers on the dial come from our own player. Relay viewers come from YouTube and Twitch, and count only when the platform says where they are."],
  ["Pay only for what aired", "Each airing settles at what it really cost. Airings cut short come back in full. Anything unspent stays yours to use or withdraw."],
  ["Stop any time", "Pause a spot and stations fill its time. Bring it back when you like. Ending a sponsorship stops the renewal; it runs to the end of the month you paid for."]
] as const;

/** Who gets what, per dollar an advertiser spends. */
export const SPEND_SHARES = [
  ["A spot you book", pct(1 - SHARES.spotsBooked), pct(SHARES.spotsBooked)],
  ["A sponsorship", pct(1 - SHARES.spotsBooked), pct(SHARES.spotsBooked)],
  ["A spot made for you", pct(1 - SHARES.spotsSourced), pct(SHARES.spotsSourced)],
  ["A deal our team brought you", pct(1 - SHARES.spotsSourced), pct(SHARES.spotsSourced)]
] as const;

export const SPOTS_FAQ: Qa[] = [
  { q: "Do I have to be local?", a: "No. Shops set a distance from their address. Online businesses pick the markets they ship to, and codes used at checkout count on their own." },
  { q: "How much should I spend?", a: "Whatever you like: there's no minimum and no contract. Set a budget and a most-per-day, and the planner shows how long it lasts. You can change both at any time." },
  { q: "What rate should I set?", a: "A rate per 1,000 tuned in means you pay for viewers, whatever the station. A rate per airing suits a small station you want to be on. Higher rates get picked by more stations." },
  { q: "What if nobody watches?", a: "Then that airing costs nothing. What was held for it comes back to your balance a few minutes after it ends." },
  { q: "Can I choose the stations?", a: "You choose the area, the kinds of station and the times of day; stations choose the spots. To be on one station or one show for sure, sponsor it." },
  { q: "Do I need a spot already?", a: "No. Order one made by a station that makes spots, or by the network's studio. They quote before anything is paid, and the finished spot is yours." },
  { q: "Where do I see results?", a: "Every airing, with the station, the time, how many tuned in and what it cost. Customers from your code, and what each one cost. A statement every month." }
];
