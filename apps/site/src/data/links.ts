// Every link target on the site (SITE-SPEC §6). Pages never write an app URL themselves: they ask
// for a call to action here, which in `waitlist` mode opens the waitlist sheet and in `live` mode
// links into the apps. Set by the PUBLIC_ variables in .env.example, read at build time.

import type { WaitlistRole } from "@contracts/waitlist";

export type LaunchMode = "waitlist" | "live";

const env = import.meta.env;
const trim = (v: string | undefined) => (v ?? "").trim().replace(/\/+$/, "");

export const LAUNCH_MODE: LaunchMode = env.PUBLIC_LAUNCH_MODE === "live" ? "live" : "waitlist";
/** Open (docs/site/open-questions.md O1): the app hosts aren't decided. */
export const WATCH_URL = trim(env.PUBLIC_WATCH_URL) || "/";
export const APP_URL = trim(env.PUBLIC_APP_URL);
export const BUSINESS_URL = trim(env.PUBLIC_BUSINESS_URL);
/** Blank: the forms run on the in-page mocks. */
export const API_URL = trim(env.PUBLIC_API_URL);

export const SITE_URL = "https://usedial.com";

/** The pages, in the nav's order. */
export const ROUTES = {
  home: "/",
  run: "/run",
  syndication: "/syndication",
  spots: "/spots",
  network: "/network",
  contact: "/contact"
} as const;
export type PageKey = keyof typeof ROUTES;

/** The anchors on Home the footers link to; Home must keep these ids (SITE-SPEC §8). */
export const HOME_ANCHORS = { guide: "/#guide", stations: "/#stations", breaks: "/#breaks", public: "/#public" } as const;

/** What the waitlist sheet opens with. */
export interface WaitlistIntent {
  role: WaitlistRole;
  /** A station's held number and call sign. */
  number?: string;
  callSign?: string;
  /** What it's about: the program asked for, the spot planned ("order a spot"). */
  about?: string;
  /** Anything else to carry: the spot planner's picks, a market row's program id. */
  details?: Record<string, string>;
}

/** A call to action, ready for markup: an `href`, plus the data attribute that opens the sheet. */
export interface Cta {
  href: string;
  attrs: Record<string, string>;
}

const withQuery = (base: string, q: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `${base}?${s}` : base;
};

/** Opens the waitlist sheet. `#waitlist` is the no-JS fallback, the sheet's own section. */
export function waitlist(intent: WaitlistIntent): Cta {
  return { href: "#waitlist", attrs: { "data-waitlist": JSON.stringify(intent) } };
}

const app = (path: string, q: Record<string, string | undefined> = {}): Cta => ({ href: withQuery(`${APP_URL}${path}`, q), attrs: {} });
const business = (path: string, q: Record<string, string | undefined> = {}): Cta => ({ href: withQuery(`${BUSINESS_URL}${path}`, q), attrs: {} });
const page = (href: string): Cta => ({ href, attrs: {} });

/** Open the dial / Watch. In live mode the nav's tuner passes the channel it shows. */
export function watch(channel?: string, mode: LaunchMode = LAUNCH_MODE): Cta {
  if (mode === "live" && channel) return page(withQuery(WATCH_URL === "/" ? "/" : `${WATCH_URL}/`, { ch: channel }));
  return page(WATCH_URL);
}

/** Claim a number (Run hero and footer, Network) and a free result in the call-sign checker. */
export function claim(hold: { number?: string; callSign?: string } = {}, mode: LaunchMode = LAUNCH_MODE): Cta {
  if (mode === "live") return app("/control/claim", { number: hold.number, callsign: hold.callSign });
  return waitlist({ role: "station", ...(hold.number ? { number: hold.number } : {}), ...(hold.callSign ? { callSign: hold.callSign } : {}) });
}

/** Offer a show (Syndication). */
export function offerShow(mode: LaunchMode = LAUNCH_MODE): Cta {
  return mode === "live" ? app("/control/offer") : waitlist({ role: "producer" });
}

/** Request / Add it, on a market row (Syndication #fits). */
export function requestProgram(program: { id: string; title: string }, mode: LaunchMode = LAUNCH_MODE): Cta {
  return mode === "live" ? app("/control/market", { program: program.id }) : waitlist({ role: "station", about: program.title, details: { program: program.id } });
}

/** The spot planner's picks, as Start a spot carries them. */
export interface SpotPlan {
  where: string;
  kind: string;
  times: string;
  budget: string;
  cap: string;
}

/** Start a spot (Spots), prefilled from the planner. */
export function startSpot(plan?: SpotPlan, mode: LaunchMode = LAUNCH_MODE): Cta {
  if (mode === "live") return business("/spots/new", plan ? { ...plan } : {});
  return waitlist({ role: "business", ...(plan ? { details: { ...plan } } : {}) });
}

/** Order one made (Spots). */
export function orderSpot(mode: LaunchMode = LAUNCH_MODE): Cta {
  return mode === "live" ? business("/orders/new") : waitlist({ role: "business", about: "Order a spot" });
}

/** Talk to a person / Contact us: the Contact page in both modes. */
export function contact(desk?: string): Cta {
  return page(desk ? `${ROUTES.contact}?desk=${desk}` : ROUTES.contact);
}
