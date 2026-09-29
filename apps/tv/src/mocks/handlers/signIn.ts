// Mock endpoints for TV sign-in by code (B2) and the market from the connection (S10).
//
// The phone that approves a code is the viewer, on another origin, so its approval can't reach
// this mock. Instead, in mock mode only (this module is loaded only by `npm run dev:mock`):
//   ?approveCode=<seconds>        in the TV's address approves each new code after that many seconds
//   window.__ocApproveTvCode()    approves the codes on screen at once
//   ?codeTtl=<seconds>            codes run out after that many seconds (the expired state)
//   ?noMarket                     the connection matches no open market

import { http, type HttpHandler } from "msw";
import { Ok } from "@opencast/contracts";
import { MarketByConnection, marketsApiX, TvCode, TvCodeStatus, tvCodesApi } from "../../api/ext/signIn";
import { config } from "../../config";
import { now } from "../../lib/clock";
import { getDb } from "../db";
import { MARKETS } from "../fixtures/stations";
import { fail, MOCK_TOKEN, needsUser, path, reply } from "../respond";
import { marketOf, milesBetween } from "../view";

interface MockCode {
  code: string;
  pollToken: string;
  /** On the mock clock. */
  expiresAt: number;
  approved: boolean;
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

export const signInHandlers: HttpHandler[] = [
  http.post(path(tvCodesApi.createCode), () => {
    const ttl = switches.ttlS || 10 * 60;
    const t = now().getTime();
    // A code is never shown twice, so a renewed one is visibly new.
    const code = makeCode((c) => [...codes.values()].some((x) => x.code === c));
    const pollToken = `poll-${code}-${Math.random().toString(36).slice(2, 10)}`;
    const c: MockCode = { code, pollToken, expiresAt: t + ttl * 1000, approved: false, approveAt: switches.approveInS !== null ? Date.now() + switches.approveInS * 1000 : null };
    codes.set(pollToken, c);
    return reply(TvCode, { code, qrUrl: `${config.viewerUrl}/tv?code=${code}`, expiresAt: new Date(c.expiresAt).toISOString(), pollToken, enterAt: "useopencast.org/tv", pollSeconds: 2 }, 201);
  }),

  http.get(path(tvCodesApi.pollCode), ({ params }) => {
    const c = codes.get(String(params.pollToken));
    if (!c) return fail(404, "not_found", "That code wasn't found. The TV will show a new one.");
    return reply(TvCodeStatus, statusOf(c, now().getTime(), Date.now()));
  }),

  http.delete(path(tvCodesApi.signOutThisTv), ({ request }) => needsUser(request) ?? reply(Ok, { ok: true })),

  // The Inland Empire, as the frame says; ?noMarket for a connection outside every open market.
  http.get(path(marketsApiX.byConnection), () => {
    const slug = switches.noMarket ? null : "inland-empire";
    const nearby = MARKETS.filter((m) => m.slug !== slug && m.open)
      .map((m) => ({ market: marketOf(m.slug)!, miles: slug ? milesBetween(slug, m.slug) : 40 }))
      .sort((a, b) => a.miles - b.miles)
      .slice(0, 2);
    return reply(MarketByConnection, { market: slug ? marketOf(slug)! : null, nearby });
  })
];
