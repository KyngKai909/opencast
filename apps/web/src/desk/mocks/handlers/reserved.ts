// Reserved call signs (desk-pages 02, added 2026-09-29): the waitlist's reservations with their
// state, and the desk's Invite, Invite the next 10, Extend, Release, Decide and Suggest; call sign
// checks, refusing what `call_signs.refused` refuses. The rules are read from the Settings mock's
// registry with the contracts' own code, as the API does. A released reservation leaves the mock
// db; a name held instead keeps the old one's place in line, end and channel.
import { http, type HttpHandler } from "msw";
import { callSignIdeas, callSignRefusal, waitlistApi, type CallSignRules, type Reservation, type ReservationState } from "@opencast/contracts";
import type { MockPerson } from "../../../mocks/people";
import { now } from "../../../lib/clock";
import { getDb, newId, saveDb } from "../db";
import type { DbReservation } from "../fixtures/stations";
import { bodyOf, fail, needsDesk, path, reply } from "../respond";
import { isAdminNow, rolesOf, valueAt } from "../settingsDb";

const DAY = 86_400_000;
const rules = () => valueAt("call_signs.refused") as CallSignRules;
const hold = () => valueAt("call_signs.hold") as { days: number; reminderDays: number };

const firm = (r: DbReservation) => r.reason !== "waitlist" || !!r.stationId || r.decision === "kept";

/** The market's lead or an admin; a reservation with no market is admins'. */
function mayMarket(p: MockPerson, marketId: string | null): boolean {
  if (isAdminNow(p)) return true;
  return !!marketId && rolesOf(p).some((g) => g.role === "market_lead" && g.market?.id === marketId);
}
const noRole = () => fail(403, "desk_role", "Only this market's lead or an admin can do that.");

export function reservationView(r: DbReservation): Reservation {
  const d = getDb();
  const refusal = r.reason === "signed_off" ? null : callSignRefusal(r.callSign, rules());
  const sameName = firm(r) ? [] : d.reservations.filter((x) => x.callSign === r.callSign && x.id !== r.id).map((x) => x.id);
  const ending = !!r.heldUntil && Date.parse(r.heldUntil) - now().getTime() <= hold().reminderDays * DAY;
  const state: ReservationState =
    r.reason === "signed_off" ? "held_after_sign_off" : refusal ? "not_allowed" : sameName.length ? "same_name" : ending ? "ending" : r.stationId ? "signing_on" : r.invitedAt ? "invited" : "waiting";
  return {
    id: r.id,
    callSign: r.callSign,
    email: r.email,
    market: d.markets.find((m) => m.id === r.marketId) ?? null,
    channel: r.channel,
    heldUntil: r.heldUntil,
    createdAt: r.createdAt,
    state,
    reason: r.reason,
    name: r.name,
    about: r.about,
    invitedAt: r.invitedAt,
    remindedAt: r.remindedAt,
    extendedAt: r.extendedAt,
    stationId: r.stationId,
    sameName,
    decidedAt: r.decidedAt,
    refusal
  };
}

const byLine = (a: DbReservation, b: DbReservation) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
const invitable = (v: Reservation) => v.reason === "waitlist" && !v.invitedAt && !v.stationId && !v.refusal && !v.sameName.length && !!v.email;

function taken(callSign: string): boolean {
  const d = getDb();
  return d.stations.some((s) => s.ident.callSign === callSign) || d.reservations.some((r) => r.callSign === callSign);
}

export function suggestionsFor(callSign: string, limit = 3): string[] {
  const r = rules();
  return callSignIdeas(callSign)
    .filter((i) => !callSignRefusal(i, r) && !taken(i))
    .slice(0, limit);
}

/** The reservation, and whether this person may act on it; or the response to return. */
function reservationFor(request: Request, id: string): { p: MockPerson; r: DbReservation } | Response {
  const p = needsDesk(request);
  if (p instanceof Response) return p;
  const r = getDb().reservations.find((x) => x.id === id);
  if (!r) return fail(404, "not_found", "That reservation wasn't found.");
  if (!mayMarket(p, r.marketId)) return noRole();
  return { p, r };
}

function release(id: string) {
  const d = getDb();
  d.reservations = d.reservations.filter((r) => r.id !== id);
}

/** Holds `callSign` for the same person in place of `old`: the same place in line, end and channel. */
function holdInstead(old: DbReservation, callSign: string): DbReservation {
  const next: DbReservation = { ...old, id: newId(), callSign, decision: null, decidedAt: null, remindedAt: null, extendedAt: null, stationId: null };
  release(old.id);
  getDb().reservations.push(next);
  return next;
}

function freeProblem(callSign: string): Response | null {
  const refusal = callSignRefusal(callSign, rules());
  if (refusal) return fail(422, "call_sign_refused", `${callSign} isn't allowed either. ${refusal.reason}`);
  if (taken(callSign)) return fail(409, "call_sign_taken", `${callSign} is taken. Choose another.`);
  return null;
}

export const reservedHandlers: HttpHandler[] = [
  http.get(path(waitlistApi.listReservations), ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const marketId = new URL(request.url).searchParams.get("marketId");
    if (!marketId ? !isAdminNow(p) : !mayMarket(p, marketId)) return noRole();
    const d = getDb();
    const rows = d.reservations.filter((r) => !marketId || r.marketId === marketId).sort(byLine);
    return reply(waitlistApi.listReservations.response, rows.map(reservationView));
  }),

  http.get(path(waitlistApi.reservationsOverview), ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const marketId = new URL(request.url).searchParams.get("marketId") ?? "";
    const d = getDb();
    const market = d.markets.find((m) => m.id === marketId);
    if (!market) return fail(404, "not_found", "That market wasn't found.");
    if (!mayMarket(p, marketId)) return noRole();
    const views = d.reservations.filter((r) => r.marketId === marketId).map(reservationView);
    const r = rules();
    const flaggedStations = d.stations
      .filter((s) => s.marketId === marketId && s.public && s.ident.callSign)
      .flatMap((s) => {
        const refusal = callSignRefusal(s.ident.callSign!, r);
        return refusal ? [{ stationId: s.ident.id, callSign: s.ident.callSign!, name: s.ident.name, channel: s.ident.channel, refusal }] : [];
      })
      .sort((a, b) => a.callSign.localeCompare(b.callSign));
    return reply(waitlistApi.reservationsOverview.response, {
      market,
      held: views.length,
      withChannel: views.filter((v) => v.channel).length,
      toInvite: views.filter(invitable).length,
      needsDecision: views.filter((v) => v.state === "same_name" || v.state === "not_allowed").length,
      holdDays: hold().days,
      reminderDays: hold().reminderDays,
      flaggedStations
    });
  }),

  http.get(path(waitlistApi.callSignSuggestions), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const callSign = String(params.callSign).toUpperCase();
    return reply(waitlistApi.callSignSuggestions.response, { callSign, refusal: /^[A-Z]{3,5}$/.test(callSign) ? callSignRefusal(callSign, rules()) : null, suggestions: suggestionsFor(callSign) });
  }),

  http.post(path(waitlistApi.inviteNextReservations), async ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const body = (await bodyOf<{ marketId: string; count?: number }>(request)) ?? { marketId: "" };
    if (!mayMarket(p, body.marketId)) return noRole();
    const d = getDb();
    const next = d.reservations
      .filter((r) => r.marketId === body.marketId)
      .sort(byLine)
      .filter((r) => invitable(reservationView(r)));
    const count = Math.min(50, Math.max(1, body.count ?? 10));
    const at = now().toISOString();
    for (const r of next.slice(0, count)) r.invitedAt = at;
    saveDb();
    return reply(waitlistApi.inviteNextReservations.response, { invited: next.slice(0, count).map(reservationView), left: Math.max(0, next.length - count) });
  }),

  http.post(path(waitlistApi.inviteReservation), ({ request, params }) => {
    const found = reservationFor(request, String(params.reservationId));
    if (found instanceof Response) return found;
    const v = reservationView(found.r);
    if (v.state === "not_allowed") return fail(422, "not_allowed", `${v.callSign} isn't allowed. Suggest another name first.`);
    if (v.state === "same_name") return fail(422, "same_name", `Two people asked for ${v.callSign}. Decide who keeps it first.`);
    if (!found.r.email) return fail(422, "no_email", "There's no email to send the invite to.");
    found.r.invitedAt = now().toISOString();
    saveDb();
    return reply(waitlistApi.inviteReservation.response, reservationView(found.r));
  }),

  http.post(path(waitlistApi.extendReservation), async ({ request, params }) => {
    const found = reservationFor(request, String(params.reservationId));
    if (found instanceof Response) return found;
    const t = now();
    const from = Math.max(t.getTime(), found.r.heldUntil ? Date.parse(found.r.heldUntil) : t.getTime());
    found.r.heldUntil = new Date(from + hold().days * DAY).toISOString();
    found.r.extendedAt = t.toISOString();
    found.r.remindedAt = null;
    saveDb();
    return reply(waitlistApi.extendReservation.response, reservationView(found.r));
  }),

  http.post(path(waitlistApi.releaseReservation), ({ request, params }) => {
    const found = reservationFor(request, String(params.reservationId));
    if (found instanceof Response) return found;
    release(found.r.id);
    saveDb();
    return reply(waitlistApi.releaseReservation.response, { ok: true, callSign: found.r.callSign, channel: found.r.channel });
  }),

  http.post(path(waitlistApi.decideReservation), async ({ request, params }) => {
    const found = reservationFor(request, String(params.reservationId));
    if (found instanceof Response) return found;
    const body = (await bodyOf<{ suggestions?: Array<{ reservationId: string; callSign: string }>; note?: string }>(request)) ?? {};
    const v = reservationView(found.r);
    if (!v.sameName.length) return fail(422, "not_same_name", `Nobody else is waiting for ${v.callSign}.`);
    const others = getDb().reservations.filter((r) => v.sameName.includes(r.id));
    if (others.some((o) => !mayMarket(found.p, o.marketId))) return noRole();
    const chosen = new Map((body.suggestions ?? []).map((s) => [s.reservationId, s.callSign]));
    for (const c of chosen.values()) {
      const problem = freeProblem(c);
      if (problem) return problem;
    }
    const pool = suggestionsFor(v.callSign, others.length + 3).filter((s) => ![...chosen.values()].includes(s));
    const told = others.map((o) => ({ reservationId: o.id, email: o.email, suggestion: chosen.get(o.id) ?? pool.shift() ?? null }));
    const at = now().toISOString();
    found.r.decision = "kept";
    found.r.decidedAt = at;
    for (const t of told) {
      const o = others.find((x) => x.id === t.reservationId)!;
      if (t.suggestion) holdInstead(o, t.suggestion);
      else release(o.id);
    }
    saveDb();
    return reply(waitlistApi.decideReservation.response, { kept: reservationView(found.r), told });
  }),

  http.post(path(waitlistApi.suggestCallSign), async ({ request, params }) => {
    const found = reservationFor(request, String(params.reservationId));
    if (found instanceof Response) return found;
    const body = (await bodyOf<{ callSign: string; alternatives?: string[] }>(request)) ?? { callSign: "" };
    const v = reservationView(found.r);
    if (!v.refusal) return fail(422, "allowed", `${v.callSign} is allowed: there's nothing to suggest.`);
    const problem = freeProblem(body.callSign);
    if (problem) return problem;
    const next = holdInstead(found.r, body.callSign);
    saveDb();
    return reply(waitlistApi.suggestCallSign.response, reservationView(next));
  }),

  http.get(path(waitlistApi.checkCallSign), ({ params }) => {
    const callSign = String(params.callSign).toUpperCase();
    const valid = /^[A-Z]{3,5}$/.test(callSign);
    if (!valid) return reply(waitlistApi.checkCallSign.response, { callSign, valid, available: false, reservable: false, heldForYou: false, refusal: null, suggestions: [] });
    const d = getDb();
    const refusal = callSignRefusal(callSign, rules());
    const onStation = d.stations.some((s) => s.ident.callSign === callSign);
    const held = d.reservations.filter((r) => r.callSign === callSign);
    const available = !refusal && !onStation && !held.length;
    return reply(waitlistApi.checkCallSign.response, {
      callSign,
      valid,
      available,
      reservable: !refusal && !onStation && !held.some(firm),
      heldForYou: false,
      refusal,
      suggestions: available ? [] : suggestionsFor(callSign)
    });
  })
];
