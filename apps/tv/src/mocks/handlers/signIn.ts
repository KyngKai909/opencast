// Mock endpoints for the TV's registration and sign-in by code (B2), and the market from the
// connection (S10), in the contracts' shapes. This TV registers as MOCK_TV_ID ("Den TV").
//
// The phone that approves a code is the viewer, on another origin, so its approval can't reach
// this mock. Instead, in mock mode only (this module is loaded only by `npm run dev:mock`):
//   ?approveCode=<seconds>        in the TV's address approves each new code after that many seconds
//   window.__ocApproveTvCode()    approves the codes on screen at once
//   ?codeTtl=<seconds>            codes run out after that many seconds (the expired state)
//   ?noMarket                     the connection matches no open market

import { http, type HttpHandler } from "msw";
import { MarketLookup, Ok, RegisteredTv, stationsApi, TvCode, TvCodeStatus, tvApi } from "@opencast/contracts";
import { viewerAddress } from "../../components/settings/pairing";
import { config } from "../../config";
import { now } from "../../lib/clock";
import { getDb, MOCK_TV_ID } from "../db";
import { MARKETS } from "../fixtures/stations";
import { fail, MOCK_DEVICE_TOKEN, MOCK_TOKEN, needsDevice, path, reply } from "../respond";
import { marketOf, milesBetween } from "../view";

interface MockCode {
  code: string;
  pollToken: string;
  /** On the mock clock. */
  expiresAt: number;
  approved: boolean;
  /** The session was handed over (once): later asks say expired. */
  handedOver?: boolean;
  /** On the wall clock: ?approveCode's moment. */
  approveAt: number | null;
}

const codes = new Map<string, MockCode>();
/** The first code is the frame's; later ones are made up. No 0/O or 1/I, so it reads from a sofa. */
const FRAME_CODE = "K7Q4MP";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeCode(taken: (c: string) => boolean, random = Math.random): string {
  if (!taken(FRAME_CODE)) return FRAME_CODE;
  for (;;) {
    const c = Array.from({ length: 6 }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join("");
    if (!taken(c)) return c;
  }
}

/** Where a mock code stands at these moments. */
export function statusOf(c: MockCode, mockNow: number, wallNow: number): TvCodeStatus {
  if (c.handedOver) return { status: "expired" };
  if (c.approved || (c.approveAt !== null && wallNow >= c.approveAt)) return { status: "approved", token: MOCK_TOKEN, signedInAs: getDb().me.displayName };
  if (mockNow >= c.expiresAt) return { status: "expired" };
  return { status: "pending" };
}

// Read when the mock starts: first launch replaces the address (to /welcome) before a code is
// asked for. Only in mock mode: a production build folds this away, so none of the switches ship.
const MOCK = import.meta.env.VITE_MOCK === "true";
interface Switches {
  ttlS: number | null;
  approveInS: number | null;
  noMarket: boolean;
}
function readSwitches(q: URLSearchParams): Switches {
  const n = (k: string) => (q.get(k) !== null && q.get(k) !== "" && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : null);
  return { ttlS: n("codeTtl"), approveInS: n("approveCode"), noMarket: q.has("noMarket") };
}
const switches: Switches = MOCK && typeof window !== "undefined" ? readSwitches(new URLSearchParams(window.location.search)) : { ttlS: null, approveInS: null, noMarket: false };

/** Approves every code still waiting. Returns how many. */
export function approveAll(): number {
  let n = 0;
  const t = now().getTime();
  for (const c of codes.values())
    if (!c.approved && t < c.expiresAt) {
      c.approved = true;
      n++;
    }
  return n;
}

if (MOCK && typeof window !== "undefined") (window as unknown as { __ocApproveTvCode?: () => number }).__ocApproveTvCode = approveAll;

/** Called when the TV signs itself out (the relay mock tells account phones). */
let onSignOut: () => void = () => undefined;
export function whenTvSignsOut(fn: () => void) {
  onSignOut = fn;
}

export const signInHandlers: HttpHandler[] = [
  // Every registration is this TV: the mock has one.
  http.post(path(tvApi.registerTv), () => reply(RegisteredTv, { tvId: MOCK_TV_ID, deviceToken: MOCK_DEVICE_TOKEN }, 201)),

  http.post(path(tvApi.createTvCode), ({ request }) => {
    const denied = needsDevice(request);
    if (denied) return denied;
    const ttl = switches.ttlS || 10 * 60;
    const t = now().getTime();
    // A code is never shown twice, so a renewed one is visibly new.
    const code = makeCode((c) => [...codes.values()].some((x) => x.code === c));
    const pollToken = `poll-${code}-${Math.random().toString(36).slice(2, 10)}`;
    const c: MockCode = { code, pollToken, expiresAt: t + ttl * 1000, approved: false, approveAt: switches.approveInS !== null ? Date.now() + switches.approveInS * 1000 : null };
    codes.set(pollToken, c);
    return reply(TvCode, { code, qrUrl: `${config.viewerUrl}/tv?code=${code}`, enterAt: viewerAddress(config.viewerUrl), expiresAt: new Date(c.expiresAt).toISOString(), pollToken, pollSeconds: 3 }, 201);
  }),

  http.get(path(tvApi.pollTvCode), ({ params }) => {
    const c = codes.get(String(params.pollToken));
    if (!c) return fail(404, "not_found", "That code wasn't found. The TV will show a new one.");
    const status = statusOf(c, now().getTime(), Date.now());
    // The session is handed over once: the next ask says expired.
    if (status.status === "approved") c.handedOver = true;
    return reply(TvCodeStatus, status);
  }),

  http.delete(path(tvApi.signOutThisTv), ({ request }) => {
    const denied = needsDevice(request);
    if (denied) return denied;
    onSignOut();
    return reply(Ok, { ok: true });
  }),

  // The Inland Empire, as the frame says; ?noMarket for a connection outside every open market
  // (then the open markets, with no miles: where the TV is isn't known).
  http.get(path(stationsApi.marketForConnection), () => {
    const slug = switches.noMarket ? null : "inland-empire";
    const nearby = slug
      ? MARKETS.filter((m) => m.slug !== slug && m.open)
          .map((m) => ({ market: marketOf(m.slug)!, miles: milesBetween(slug, m.slug) }))
          .sort((a, b) => a.miles - b.miles)
          .slice(0, 2)
      : MARKETS.filter((m) => m.open).map((m) => ({ market: marketOf(m.slug)!, miles: null }));
    return reply(MarketLookup, { market: slug ? marketOf(slug)! : null, nearby });
  })
];
