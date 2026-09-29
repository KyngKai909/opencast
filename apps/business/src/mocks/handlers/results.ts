// airings with proof (spots.listSpotAirings), results (spots.getResults), codes and customers (saveOffer, redeemCode, scanCode), statements (ledger.listStatements).
// The Results area owns this file. Also checking a code before redeeming it (B5), the Redeem
// tool's day (P12), and a statement's CSV.

import { http, type HttpHandler } from "msw";
import { ledgerApi, spotsApi, type ResultsAiring, type ResultsCode, type StationIdent } from "@opencast/contracts";
import type { ResultsPeriod } from "../../api/types";
import { now } from "../../lib/clock";
import { roleOn } from "../access";
import { dbBusiness, getDb, membership } from "../db";
import {
  CODE_RULES,
  STATION_KIND,
  airingsOf,
  checkCode,
  connectionsOf,
  daypartOf,
  extraScans,
  heldOf,
  marketDate,
  proofFrame,
  recordSave,
  recordScan,
  redeem,
  redeemOn,
  redeemedToday,
  resultsState,
  savesOf,
  spotForCode,
  statementCsv,
  statementPdf,
  statementsOf,
  usesOf,
  working,
  type AsRun,
  type CodeCheck,
  type MockStatement
} from "../fixtures/results";
import { STATIONS } from "../fixtures/stations";
import { fail, needsUser, path, personOf, reply } from "../respond";

const DAY = 86_400_000;
const stationOf = (id: string | null): StationIdent | null => (id ? (STATIONS.find((s) => s.id === id) ?? null) : null);

// ---------------------------------------------------------------- periods (P14)

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Sunday of the week a market date is in. */
export function weekOf(date: string): string {
  return addDays(date, -new Date(`${date}T12:00:00Z`).getUTCDay());
}

export interface Range {
  period: ResultsPeriod;
  from: string;
  /** The last day of the period. */
  end: string;
  /** The last day so far. */
  to: string;
  month: string;
}

/** The dates a results request covers: a month (the contract's), a week or all time (P14). */
export function rangeFor(q: URLSearchParams, businessId: string, at: Date = now()): Range {
  const today = marketDate(at);
  const period = (["week", "month", "all"] as const).find((p) => p === q.get("period")) ?? "month";
  const month = /^\d{4}-\d{2}$/.test(q.get("month") ?? "") ? q.get("month")! : today.slice(0, 7);
  if (period === "week") {
    const from = weekOf(/^\d{4}-\d{2}-\d{2}$/.test(q.get("week") ?? "") ? q.get("week")! : today);
    const end = addDays(from, 6);
    return { period, from, end, to: end < today ? end : today, month };
  }
  if (period === "all") {
    const first = airingsOf(businessId)[0];
    const from = first ? marketDate(first.startedAt) : today;
    return { period, from, end: today, to: today, month };
  }
  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { period, from, end, to: end < today ? end : today, month };
}

const inRange = (r: Range, iso: string, at: Date) => {
  const d = marketDate(iso);
  return d >= r.from && d <= r.end && Date.parse(iso) <= at.getTime();
};

// ---------------------------------------------------------------- results

export function asResultsAiring(a: AsRun): ResultsAiring {
  const s = stationOf(a.stationId)!;
  const spot = getDb().spots.find((x) => x.id === a.spotId);
  const title = spot?.title ?? "A spot";
  const started = Date.parse(a.startedAt);
  return {
    asRunId: a.id,
    station: s,
    spot: { id: a.spotId, title, lengthSec: a.lengthSec },
    startedAt: a.startedAt,
    endedAt: new Date(started + a.airedSec * 1000).toISOString(),
    programContext: a.programContext,
    airedMs: a.airedSec * 1000,
    inFull: a.airedSec >= a.lengthSec,
    tunedIn: a.tunedIn,
    costMicros: a.costMicros,
    working: working(a),
    proofFrameUrl: proofFrame({ id: a.spotId, title }, s),
    scansNextHour: a.scans + extraScans(a),
    shortReason: a.shortReason,
    // Captured halfway through the spot (":15 in", 8:28:45 pm for 8:28:30 pm).
    proofCapturedAt: new Date(started + Math.floor(Math.min(a.airedSec, a.lengthSec) / 2) * 1000).toISOString()
  };
}

const DAYPARTS = ["mornings", "afternoons", "evenings", "late_night"] as const;

export function buildResults(businessId: string, r: Range, at: Date = now()) {
  const airings = airingsOf(businessId).filter((a) => inRange(r, a.startedAt, at));
  const byId = new Map(airingsOf(businessId).map((a) => [a.id, a]));
  const uses = usesOf(businessId).filter((u) => inRange(r, u.at, at));
  const customers = uses.filter((u) => u.airingId || u.stationId);
  const spots = getDb().spots.filter((s) => s.businessId === businessId);
  const codeSpots = spots.filter((s) => s.code);
  const saves = codeSpots.flatMap((s) => savesOf(s.code!.code)).filter((s) => inRange(r, s.at, at));
  const scansOf = (list: AsRun[]) => list.reduce((s, a) => s + a.scans + extraScans(a), 0);
  const unmatchedScans = (code: string) => resultsState().scans.filter((s) => s.code === code && !s.airingId && !s.stationId && inRange(r, s.at, at)).length;

  const stationIds = [...new Set([...airings.map((a) => a.stationId), ...customers.map((u) => u.stationId!).filter(Boolean)])];
  const spent = (l: AsRun[]) => l.reduce((s, a) => s + a.costMicros, 0);
  const byStation = stationIds
    .map((id) => {
      const list = airings.filter((a) => a.stationId === id);
      return {
        station: stationOf(id)!,
        category: STATION_KIND[id] ?? null,
        airings: list.length,
        averageTunedIn: list.length ? Math.round(list.reduce((s, a) => s + a.tunedIn, 0) / list.length) : 0,
        spentMicros: spent(list),
        customers: customers.filter((u) => u.stationId === id).length
      };
    })
    .filter((x) => x.station)
    .sort((a, b) => b.spentMicros - a.spentMicros || b.airings - a.airings);

  const partOfUse = (u: (typeof uses)[number]) => (u.airingId && byId.get(u.airingId) ? daypartOf(byId.get(u.airingId)!.startedAt) : null);
  const byDaypart = DAYPARTS.map((p) => ({ daypart: p, airings: airings.filter((a) => daypartOf(a.startedAt) === p).length, customers: customers.filter((u) => partOfUse(u) === p).length })).filter(
    (x) => x.airings > 0 || x.customers > 0
  );

  const bySpot = spots
    .map((s) => {
      const list = airings.filter((a) => a.spotId === s.id);
      return { spotId: s.id, title: s.title, airings: list.length, spentMicros: spent(list), customers: customers.filter((u) => u.spotId === s.id).length };
    })
    .filter((x) => x.airings > 0 || x.customers > 0)
    .sort((a, b) => b.airings - a.airings);

  const conn = connectionsOf(businessId);
  const codes: ResultsCode[] = codeSpots.map((s) => {
    const code = s.code!.code;
    const cu = uses.filter((u) => u.code === code);
    const cs = saves.filter((x) => x.code === code);
    const from = new Map<string, number>();
    for (const x of (cs.length ? cs : savesOf(code)).filter((x) => x.stationId)) from.set(x.stationId!, (from.get(x.stationId!) ?? 0) + 1);
    const top = [...from.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      code,
      spotId: s.id,
      spotTitle: s.title,
      offer: s.code!.offer,
      windowDays: s.code!.windowDays,
      oncePerCustomer: CODE_RULES.oncePerCustomer,
      savedForDays: CODE_RULES.savedForDays,
      scans: scansOf(airings.filter((a) => a.spotId === s.id)) + unmatchedScans(code),
      saves: cs.length,
      uses: cu.length,
      usesBy: {
        clearPay: conn.clearPay ? cu.filter((u) => u.how === "clear_pay").length : null,
        marked: cu.filter((u) => u.how === "marked").length,
        online: conn.checkout ? cu.filter((u) => u.how === "online").length : null
      },
      savedMostFrom: stationOf(top)
    };
  });

  return {
    month: r.month,
    period: r.period,
    from: r.from,
    to: r.to,
    totals: {
      airings: airings.length,
      tunedInAddedUp: airings.reduce((s, a) => s + a.tunedIn, 0),
      spentMicros: spent(airings),
      scans: codes.reduce((s, c) => s + c.scans, 0),
      saves: saves.length,
      uses: uses.length,
      customers: customers.length
    },
    byStation,
    byDaypart,
    bySpot,
    codes,
    airings: [...airings].reverse().map(asResultsAiring)
  };
}

// ---------------------------------------------------------------- statements

function asStatement(businessId: string, s: MockStatement) {
  const name = dbBusiness(businessId)?.name ?? "";
  return {
    id: s.id,
    period: "month" as const,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    openingMicros: s.openingMicros,
    closingMicros: s.closingMicros,
    lines: s.lines.map((l) => ({ label: l.label, detail: l.detail, amountMicros: l.amountMicros, notSetYet: false, group: l.group, kind: l.kind, airings: l.airings, includedAbove: l.includedAbove })),
    issuedAt: s.issuedAt,
    csvUrl: `/v1/statements/${s.id}/csv`,
    pdfUrl: statementPdf(name, s),
    inProgress: s.inProgress,
    asOf: s.asOf,
    finalOn: s.finalOn,
    closingAvailableMicros: s.closingAvailableMicros,
    closingHeldMicros: s.closingHeldMicros
  };
}

// ---------------------------------------------------------------- redeeming

const NOT_FOR_VIEWERS = "Viewers can see redemptions in Results but can't mark codes as used.";

function answer(businessId: string, c: CodeCheck, withCount = false) {
  return {
    valid: c.valid,
    firstUse: c.firstUse,
    countsAsCustomer: c.countsAsCustomer,
    savedFrom: c.savedFrom,
    message: c.message,
    code: c.code,
    offer: c.offer,
    savedAt: c.savedAt,
    spotTitle: c.spotTitle,
    ...(withCount ? { redeemedToday: redeemedToday(businessId) } : {})
  };
}

async function codeBody(request: Request): Promise<{ code: string; customerRef?: string } | null> {
  const body = (await request.json().catch(() => null)) as { code?: unknown; customerRef?: unknown } | null;
  if (!body || typeof body.code !== "string" || !body.code.trim()) return null;
  return { code: body.code, customerRef: typeof body.customerRef === "string" ? body.customerRef : undefined };
}

// ---------------------------------------------------------------- handlers

export const resultsHandlers: HttpHandler[] = [
  http.get(path(spotsApi.getResults), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "see");
    if (r instanceof Response) return r;
    const q = new URL(request.url).searchParams;
    return reply(spotsApi.getResults.response, buildResults(id, rangeFor(q, id)));
  }),

  http.get(path(spotsApi.listSpotAirings), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const spot = getDb().spots.find((s) => s.id === String(params.spotId));
    if (!spot) return fail(404, "not_found", "That spot wasn't found.");
    const r = roleOn(spot.businessId, p, "see");
    if (r instanceof Response) return r;
    const at = now();
    return reply(spotsApi.listSpotAirings.response, {
      held: heldOf(spot.businessId)
        .filter((h) => h.spotId === spot.id)
        .map((h) => ({ airingId: h.airingId, station: stationOf(h.stationId)!, scheduledAt: h.scheduledAt, heldMicros: h.heldMicros })),
      aired: airingsOf(spot.businessId)
        .filter((a) => a.spotId === spot.id && Date.parse(a.startedAt) <= at.getTime())
        .reverse()
        .map(asResultsAiring)
    });
  }),

  http.post(path(spotsApi.scanCode), async ({ request, params }) => {
    const spot = spotForCode(String(params.code));
    if (!spot?.code || spot.state === "ended") return fail(404, "not_found", "That offer isn't running.");
    const body = (await request.json().catch(() => ({}))) as { stationId?: string; airingId?: string };
    recordScan(spot.code.code, body.stationId ?? null, body.airingId ?? null);
    return reply(spotsApi.scanCode.response, { business: dbBusiness(spot.businessId)?.name ?? "", offer: spot.code.offer });
  }),

  http.post(path(spotsApi.saveOffer), async ({ request, params }) => {
    const spot = spotForCode(String(params.code));
    if (!spot?.code || spot.state === "ended") return fail(404, "not_found", "That offer isn't running.");
    const body = (await request.json().catch(() => ({}))) as { stationId?: string; customerRef?: string };
    const who = personOf(request);
    const s = recordSave(spot.code.code, body.stationId ?? null, body.customerRef ?? (who ? `person-${who.id}` : null));
    return reply(spotsApi.saveOffer.response, { savedUntil: marketDate(Date.parse(s.at) + CODE_RULES.savedForDays * DAY), savedFrom: stationOf(s.stationId) });
  }),

  http.post(path(spotsApi.redeemCheck), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "advertise", NOT_FOR_VIEWERS);
    if (r instanceof Response) return r;
    const body = await codeBody(request);
    if (!body) return fail(400, "invalid", "Type a code.");
    return reply(spotsApi.redeemCode.response, answer(id, checkCode(id, body.code, body.customerRef)));
  }),

  http.post(path(spotsApi.redeemCode), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "advertise", NOT_FOR_VIEWERS);
    if (r instanceof Response) return r;
    if (!redeemOn(id)) return fail(409, "redeem_off", "Redeem is off for this business. Turn it on in Settings.");
    const body = await codeBody(request);
    if (!body) return fail(400, "invalid", "Type a code.");
    return reply(spotsApi.redeemCode.response, answer(id, redeem(id, body.code, body.customerRef), true));
  }),

  http.get(path(spotsApi.redeemToday), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "advertise", NOT_FOR_VIEWERS);
    if (r instanceof Response) return r;
    return reply(spotsApi.redeemToday.response, { on: redeemOn(id), redeemedToday: redeemedToday(id), clearPay: connectionsOf(id).clearPay });
  }),

  http.get(path(ledgerApi.listStatements), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "see");
    if (r instanceof Response) return r;
    return reply(ledgerApi.listStatements.response, statementsOf(id).map((s) => asStatement(id, s)));
  }),

  http.get(path(ledgerApi.getStatementCsv), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const statementId = String(params.statementId);
    for (const b of getDb().businesses) {
      if (!membership(b.id, p.id)) continue;
      const st = statementsOf(b.id).find((s) => s.id === statementId);
      if (st) return reply(ledgerApi.getStatementCsv.response, statementCsv(b.id, st));
    }
    return fail(404, "not_found", "That statement wasn't found.");
  })
];
