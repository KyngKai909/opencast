// Run's repeated content (docs/reference/site/source/run/body.py). Copy is the reference's;
// every price and share comes from pricing.ts.
import { ELSEWHERE, estimate, GRACE_DAYS, PRICE, pct, price, SHARES, SPOT_CPM } from "./pricing";
import type { Qa } from "../components/Faq.astro";

export const AUDIENCES = [
  { L: "A", c: "#C04A9E", t: "You loop a library to YouTube", sub: "Lofi, mixes, long-stream archives, podcast reruns", tag: "Switching from Livepush, Upstream or Gyre", pts: ["Storage counts what airs, not your whole library", "A week laid out by the hour, not one long playlist", "Breaks that pay you, on every platform you relay to"], href: "#switch", cta: "See the switch" },
  { L: "B", c: "#EBA03A", t: "You build webchannels", sub: "ErsatzTV, Tunarr and Plex channels with bumpers", tag: "Keep the bumpers. Lose the server.", pts: ["No transcoding box at home, no GPU", "Your bumpers, IDs and blocks carried over", "On the dial, in Plex, and in IPTV apps"], href: "#control", cta: "See master control" },
  { L: "C", c: "#2F9A72", t: "You run a community channel", sub: "City hall, a school, a church, a radio collective", tag: "Public access, without the studio", pts: ["Go live from a phone inside the schedule", "Replays fill the rest of the day on their own", "Members and underwriters credited on air"], href: "#earn", cta: "See how it pays" }
] as const;

const relayedMonth = Math.round(estimate({ gb: 40, live: 0, relays: 2 }).total);

/** The comparison table: feature, Dial, Livepush, Upstream, Gyre (HTML). Competitor figures: their pricing pages, October 2026. */
export const COMPARISON: readonly (readonly [string, string, string, string, string])[] = [
  ["One 24/7 1080p channel", `From <b class="tab">$0</b><small>Grows with what is on air and relay hours. About $${relayedMonth} for 40 GB on air, relayed all month.</small>`, '<b class="tab">$39</b> to <b class="tab">$119</b>/mo<small>Looping starts on Editors (20 GB), then Creators (50 GB) and Business (100 GB)</small>', '<b class="tab">$30</b>/mo<small>Per 1080p 30 fps stream. 60 fps and 4K cost extra.</small>', '<b class="tab">$99</b> to <b class="tab">$169</b>/mo<small>Playlists and the scheduler start on Start+ (75 GB), then PRO+ (150 GB)</small>'],
  ["Biggest library it holds", '<b class="tab">No limit</b><small>It stays on your NAS. We store the next 7 days on air.</small>', '<b class="tab">100 GB</b><small>Business plan</small>', "<b class=\"tab\">100 GB</b><small>On its free plan. Paid storage isn't published.</small>", '<b class="tab">150 GB</b><small>PRO+ plan</small>'],
  ["Library at home", "Yes. A small agent on your NAS or computer sends what's about to air.", "No. Upload everything first.", "No. Upload everything first.", "No. Upload everything first."],
  ["Hours on air", "All of them, free. Every plan, every day.", "20 a month free. 24/7 looping from $39.", "24 a month free. Unlimited from $30.", "7-day trial. 24/7 from $49; playlists from $99."],
  ["How you program it", "A weekly schedule by the hour, with dayparts, series slots and live blocks", "Events queued from merged videos", "Looping playlists, started on a daily or weekly schedule", "Playlists and a scheduler"],
  ["Breaks with bumpers and IDs", "Built in, placed at natural break points", "Not listed", "Stings and jingles every N videos or minutes, and YouTube ad-break triggers", "Not listed"],
  ["Who pays for your breaks", "Advertisers in the spot market, paid to you, on every platform you relay to", "Not listed", "YouTube's own ads, on YouTube only", "Not listed"],
  ["A home viewers tune into", "A number on the dial", "No", "No", "No"]
];

export const SWITCH_STEPS = [
  { h: "Point us at your folder", p: "Install the agent on your NAS or computer and pick the folders. Nothing uploads until it's scheduled.", d: 4, t: 3 },
  { h: "Lay out your week", p: "Turn your playlists into blocks. Bumpers and IDs go in as break rules.", d: 4, t: 3 },
  { h: "Paste your stream keys", p: "Connect YouTube and Twitch, or add any RTMP address.", d: 4, t: 3 },
  { h: "Run both for a day", p: "Air on the dial while your old tool keeps the platforms. Check the schedule.", d: 6, t: 3 },
  { h: "Flip the relays", p: "Switch the platforms over at a break. Cancel the old plan.", d: 6, t: 6 }
] as const;

/** The rate card: name, what it is, price, and the free part. */
export const RATE_CARD = [
  { n: "Being on air", d: "On the dial, scheduled, with breaks, files prepared", p: "Free", f: "" },
  { n: "Storage", d: "Per GB a month, prepared copies of what airs", p: price(PRICE.gb), f: `${PRICE.freeGb} GB free` },
  { n: "Relays, live shows only", d: "Simulcast just your live blocks", p: "Free", f: "" },
  { n: "Relays, everything you air", d: "Per hour, all platforms together", p: price(PRICE.relayHr), f: `never over ${price(PRICE.relayCap)} a month` },
  { n: "Live hours, TV", d: "Per hour you broadcast live", p: price(PRICE.liveHr), f: `${PRICE.freeLive} hours free` },
  { n: "Live hours, radio", d: "Per hour on the FM band", p: "Free", f: "" },
  { n: "Number and call sign", d: "Yours while you're on air", p: "Included", f: "licences come later" }
] as const;

export const BILLING = [
  { h: "Earnings first", p: "Usage comes out of what your breaks earned before it touches your card." },
  { h: "Caps per usage", p: "Set a monthly cap on relays or live hours. Hitting one pauses that, never the channel." },
  { h: `${GRACE_DAYS}-day grace`, p: "Run out of funds and you keep airing on the dial while we remind you." },
  { h: "No contract", p: "Month to month. Export your schedule and leave whenever you like." }
] as const;

export const EARNERS = [
  { c: "#E0583A", h: "Spots", p: "Businesses buy spots on your station in the spot market: the shop down the street, an online store, an app. You choose which ones air.", l: "Spot market", href: "/spots" },
  { c: "#EBA03A", h: "Syndication", p: "Offer your shows to the network. Every station that carries them pays you when they air.", l: "Syndication", href: "/syndication" },
  { c: "#5B7BE0", h: "Members", p: "Viewers pledge to keep you on. Members and underwriters get a credit in your breaks.", l: "The network", href: "/network" },
  { c: "#2F9A72", h: "Backfill", p: "Turn it on and break time the market hasn't sold is filled by the network's video ad partners. Off until you say so.", l: "Spot market", href: "/spots" }
] as const;

/** Who gets what: source, Dial's share, and what platforms keep elsewhere. */
export const SHARE_ROWS = [
  { n: "Spots the advertiser books", ours: SHARES.spotsBooked, el: [["YouTube", ELSEWHERE.youtubeAds], ["Twitch", ELSEWHERE.twitchAds]] },
  { n: "Spots we sourced, or ads our agency made", ours: SHARES.spotsSourced, el: [["YouTube", ELSEWHERE.youtubeAds]] },
  { n: "Pledges and members", ours: SHARES.pledges, el: [["Patreon", ELSEWHERE.patreon], ["YouTube", ELSEWHERE.youtubeMemberships], ["Twitch", ELSEWHERE.twitchSubs]] },
  { n: "Syndication paid in cash, to the maker", ours: SHARES.syndicationCash, el: [] },
  { n: "Ads from partners (backfill)", ours: SHARES.backfill, el: [["YouTube", ELSEWHERE.youtubeAds]] }
] as const;

export const SHARE_NOTE = `Card fees are passed through. Part of what we keep goes back to stations through the co-op pool. Other platforms' cuts are from their published terms: YouTube's Partner Program (ads ${pct(ELSEWHERE.youtubeAds)}, memberships ${pct(ELSEWHERE.youtubeMemberships)}), Twitch's standard subs and its ad incentive split, Patreon's fee for new creators.`;

export const OWNERSHIP = [
  { c: "#C04A9E", k: "Stations", h: "Your channel is yours", p: "Your number, call sign, schedule, audience and earnings belong to you. Export it all and leave whenever you like." },
  { c: "#EBA03A", k: "Makers", h: "Your shows stay yours", p: "You set the terms on every program. Each station that carries it pays you, and you can stop offering it at any time." },
  { c: "#5B7BE0", k: "Members", h: "Viewers back the station", p: `Pledges go to the station people watch, ${Math.round((1 - SHARES.pledges) * 100)} cents of every dollar, and members are thanked by name in the breaks.` },
  { c: "#2F9A72", k: "The pool", h: "Part of ours comes back", p: "A share of what we keep goes into a co-op pool, paid out monthly: an equal share for every station on air, a share by watch time, and a creator fund." }
] as const;

export const SPOT_HINT = `Your breaks hold up to 3 minutes an hour. Advertisers pay about $${SPOT_CPM} per 1,000 tuned in.`;

export const RUN_FAQ: Qa[] = [
  { q: "Do I need a GPU or a server?", a: "No. Files are prepared once on our side. The library agent only copies files and runs on any NAS, Mac, PC or Raspberry Pi." },
  { q: "Will my YouTube or Twitch stream drop?", a: "No. Platforms see one continuous stream, even when a live block starts or ends. Where a platform caps stream length, like Twitch at 48 hours, we restart ahead of it at a break." },
  { q: "Can I bring my ErsatzTV or Tunarr channels?", a: "Yes. Bring your collections, bumpers and blocks; they become schedule blocks and break rules. Your channel shows up on the dial and still works in Plex." },
  { q: "Who buys the spots in my breaks?", a: "Anyone with something to sell: a shop near your viewers, an online store, an app. They buy in the spot market and you approve what airs. Local ads are priced on viewers we can place nearby; online advertisers pay for every viewer. If you turn on backfill, unsold time goes to the network's video ad partners." },
  { q: "What about music and film rights?", a: "Every program has a rights record. If someone files a claim, that program comes off the air everywhere at once while it's sorted out, and your channel keeps running." },
  { q: "What happens if I stop paying?", a: `Your channel stays on the dial. After a ${GRACE_DAYS}-day grace period, paid relays and live hours pause until the account is topped up.` },
  { q: "Can I leave?", a: "Yes. The software is open source, and you can export your schedule and library list at any time." }
];

/** The footer's open numbers in the Inland Empire, and the ones taken. */
export const PICK_NUMBERS = ["14.1", "16.1", "19.1", "22.1", "27.1", "31.1", "33.1", "38.1", "41.1", "44.1", "47.1", "52.1"] as const;
export const PICK_TAKEN = new Set(["16.1", "31.1", "41.1"]);
export const PICK_DEFAULT = "44.1";
