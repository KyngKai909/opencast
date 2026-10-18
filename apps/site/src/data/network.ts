// The Network page's content (docs/reference/site/source/network/body.py and net.js). Copy is the
// reference's; stations come from dial.ts, money from pricing.ts.
import { DIAL, MARKETS } from "./dial";
import { GRACE_DAYS, HOLD_DAYS, POOL_SHARE_OF_OURS, PRICE, price, SHARES } from "./pricing";
import type { Qa } from "../components/Faq.astro";

export interface TunerStation {
  n: string;
  cs: string;
  name: string;
  who: string;
  c: string;
  kind: string;
  progs: readonly string[];
}

/** The markets on the tuner and in "Where", with where each stands. High Desert said "Opening first", against the FAQ's "Inland Empire first, then Los Angeles and Orange County". */
export const NET_MARKETS = [
  { id: "ie", st: "Opening first", on: true },
  { id: "la", st: "Next", on: false },
  { id: "oc", st: "Next", on: false },
  { id: "hd", st: "Later", on: false }
].map((m) => {
  const mk = MARKETS.find((x) => x.id === m.id)!;
  const stations: TunerStation[] = DIAL.filter((d) => d.mk === m.id && d.progs)
    .map((d) => ({ n: d.n, cs: d.cs, name: d.name ?? d.cs, who: d.who ?? "", c: d.c ?? "#9A9CAB", kind: d.kind ?? "Station", progs: d.progs ?? [] }))
    .sort((a, b) => parseFloat(a.n) - parseFloat(b.n));
  return { ...m, n: mk.n, d: mk.d, c: mk.c, stations };
});

export const COMPARE = [
  ["Who can start a channel", "A few licence holders per town", "Anyone, but it's a feed, not a channel", "Anyone, with a number and a call sign"],
  ["How you find it", "Flip the dial", "An algorithm picks for you", "Flip the dial, in your market"],
  ["What's on at 9 pm", "A schedule", "Whatever you search for", "A schedule, live and recorded"],
  ["Who pays for it", "Local businesses, in the breaks", "Ads the platform sells, its cut first", "Local businesses and pledges, to the station"],
  ["How shows travel", "Syndication, to affiliates", "They don't; you build your own audience", "Syndication, paid every airing"]
] as const;

export const NUMBER_RULES = [
  ["A number in your market", "TV from 2.1 to 69.9, radio from 88.2 to 107.8. Each number belongs to one station in each market."],
  ["A call sign that's yours", "Three to five letters, unique across the whole network. Pick it once: it can't change after you sign on."],
  ["Nothing that looks official", "No four-letter signs starting with K or W, which look like real FCC stations, and no network or brand names."],
  ["Hold one before you're ready", `Reserve a call sign and a number on the waitlist. It's held for ${HOLD_DAYS} days, with a reminder before it lapses.`],
  ["Sign off for good, and it's kept", "Your call sign stays yours for a year. The number goes back to the market after 90 days."]
] as const;

export const KINDS = [
  { c: "#C04A9E", n: "Stations", t: "Run by an operator", p: "A person, a club, a school or a business runs the schedule, sells the breaks and keeps what they earn.", e: "12.1 BEAT, 24.1 REEL" },
  { c: "#EBA03A", n: "Studios", t: "Make shows, no channel", p: "Offer programs to every station through the syndication market and get paid when they air.", e: "Pomona Vinyl Club" },
  { c: "#5B7BE0", n: "Claimable", t: "We run it until you claim it", p: "For creators whose work already airs with their permission. Earnings wait in escrow until they claim the station.", e: "18.1 SAZN" },
  { c: "#9A9CAB", n: "The catalog", t: "Public domain, checked twice", p: "Films and recordings the public owns, each cleared by two different people, free for any station to carry.", e: "60.1 MATN" },
  { c: "#2F9A72", n: "Listed", t: "A public source, as it is", p: "City meetings and public access, played from the source's own stream with their permission. No ads, ever.", e: "7.1 CIVC" }
] as const;

/** Follow the dollar: per $100, by kind of money. */
const per100 = (share: number) => Math.round(share * 100);
export const DOLLAR = [
  { label: "A spot it booked", to: "To the station", ours: per100(SHARES.spotsBooked), pool: true, note: `A business booked a spot on its own, in the spot market or straight with the station. The station keeps $${100 - per100(SHARES.spotsBooked)}.` },
  { label: "A spot we brought", to: "To the station", ours: per100(SHARES.spotsSourced), pool: true, note: "Our team found the advertiser, or our studio made the spot. We keep more because we did more of the work." },
  { label: "A pledge", to: "To the station", ours: per100(SHARES.pledges), pool: false, note: `A viewer pledged to keep the station on the air. Card fees come off at cost; the rest is the station’s, less our ${per100(SHARES.pledges)}%.` },
  { label: "Cash carriage", to: "To the maker", ours: per100(SHARES.syndicationCash), pool: false, note: `A station paid to carry someone else’s show. The maker gets $${100 - per100(SHARES.syndicationCash)} every time it airs. Revenue shares between stations cost nothing extra.` }
].map((d) => ({ ...d, theirs: 100 - d.ours, poolPart: d.pool ? d.ours * POOL_SHARE_OF_OURS : 0 }));

/** What stations pay, from the price sheet. */
export const USAGE = [
  ["Storage, after " + PRICE.freeGb + " GB", `${price(PRICE.gb)} a GB a month`],
  ["Relays to YouTube and the rest", `${price(PRICE.relayHr)} an hour, ${price(PRICE.relayCap)} most`],
  ["Live hours, after " + PRICE.freeLive, `${price(PRICE.liveHr)} an hour`]
] as const;
export const USAGE_NOTE = `Paid from earnings first. Run short and the channel stays on the air; relays pause after a ${GRACE_DAYS}-day grace.`;

export const STANDARDS = [
  ["Every break has a station ID", "Viewers always know what they're watching. A station can choose how often, never \"never\"."],
  ["Every program has a rights record", "Who made it, who owns the music and footage, and the licence it airs under. No record, no air."],
  ["A claim stops a program everywhere", "Anyone can file one. The program comes off every station at once while the station answers. The channel keeps running."],
  ["Repeat claims pause carriage", "Three upheld claims in a year and a station can't offer shows to others until it's sorted."],
  ["Ratings and advisories on every show", "From TV-Y to TV-MA, with language and mature flags. Children's programs never get personalized ads."],
  ["Breaks stay short", "Each station sets its own breaks, starting from three minutes of spots an hour, and can turn whole categories of ads away."],
  ["A bill never takes a channel dark", `Run short and you stay on the air. Relays and live hours pause after a ${GRACE_DAYS}-day grace; the dial never does.`]
] as const;

export const NETWORK_FAQ: Qa[] = [
  { q: "Who runs the network?", a: "A small team in Southern California. We run the network desk: rights checks, the catalog, markets and the rules on this page. Stations run themselves." },
  { q: "Where are you starting?", a: "The Inland Empire first, then Los Angeles and Orange County. Anyone anywhere can sign on; those are the markets we're filling first." },
  { q: "Is it really free to watch?", a: "Yes. No account, no subscription. Spots, sponsors and pledges pay for the stations, and stations pay for the storage they use." },
  { q: "Can I watch on my TV?", a: "On Android TV, Google TV and Fire TV in the browser, or cast from your phone and use the phone as the remote." },
  { q: "Do I own my station?", a: "Your number, call sign, schedule and earnings are yours. You decide what airs and who can carry it." },
  { q: "Can my city or school be on the dial?", a: "Yes. Public meetings and public access can be listed from their own stream, with no ads, or run as a full station." },
  { q: "Is the software open?", a: "That's the plan: the apps and the code, open for anyone to read and improve. When the money contracts go live, every payment they make can be read by anyone." }
];

/** The checker's first call sign. */
export const CHECK_START = "TACO";
