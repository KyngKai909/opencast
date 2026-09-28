// catalog: browse, offers, carriage requests and agreements, placing in the log.
// The Market area owns this file. The market's own state is in fixtures/market.ts; placing a
// program writes entries into the shared db's log, so the Program log and the Monitor show them.

import { http } from "msw";
import { catalogApi, type Slot, type StationIdent } from "@opencast/contracts";
import { clock } from "@opencast/ui";
import { AgreementsX, AgreementX, BrowseX, CarriageRequestX, OfferDetailX, OfferX, RequestsX, type FitSlotX, type TermsBodyX } from "../../api/ext/market";
import { fitRank } from "../../components/market/browse";
import { formatFromLibrary } from "../../components/market/words";
import { now, STATION_TZ } from "../../lib/clock";
import { dbStation, getDb, membership, saveDb, stationLog } from "../db";
import type { DbLogEntry } from "../fixtures/evening";
import { CARRIER_PROFILES, episodesFor, getMarket, localDate, marketStation, saveMarket, type MkAgreement, type MkOffer, type MkRequest } from "../fixtures/market";
import { MIN, OFFSET_HOURS } from "../fixtures/time";
import type { MockPerson } from "../fixtures/people";
import { fail, needsUser, path, reply } from "../respond";
import { gapsIn } from "./log";

const DAY = 24 * 3600e3;

function uuid(): string {
  return crypto.randomUUID();
}

function ident(id: string): StationIdent {
  return dbStation(id)?.ident ?? marketStation(id)!;
}

/** Owners and operators act for a station (open question A5); hosts don't. */
function mayAct(p: MockPerson, stationId: string): boolean {
  const m = membership(stationId, p.id);
  return !!m && m.role !== "host";
}

// ---- where an offer fits (C1) ----

/** Dead air bounded by the log in the next day, and library repeats if the station runs any. */
export function fitFor(o: MkOffer, stationId: string | null): { fit: FitSlotX[]; fits: boolean | null } {
  if (!stationId) return { fit: [], fits: null };
  const st = dbStation(stationId);
  if (!st || st.ident.kind === "studio") return { fit: [], fits: null };
  const from = now().toISOString();
  const to = new Date(Date.parse(from) + DAY).toISOString();
  const gaps = gapsIn(stationId, from, to).filter((g) => g.endsAt < to);
  const repeats = stationLog(stationId).some((e) => e.localNote === "Overnight repeat");
  const len = o.program.format?.episodeLengthMs ?? null;
  const fit: FitSlotX[] = [];
  if (len) {
    for (const g of gaps) {
      const gapLen = Date.parse(g.endsAt) - Date.parse(g.startsAt);
      if (len <= gapLen + 2 * MIN && len >= gapLen - 30 * MIN) {
        fit.push({ reason: "dead_air", label: `${clock(g.startsAt, { timeZone: STATION_TZ })} gap`, title: "", startsAt: g.startsAt, endsAt: g.endsAt, exact: Math.abs(gapLen - len) <= 2 * MIN });
      }
    }
  }
  if (repeats && o.repeatFit) fit.push({ reason: "library_repeats", label: o.repeatFit.label, title: o.repeatFit.title, startsAt: null, endsAt: null, exact: false });
  return { fit, fits: fit.length ? true : gaps.length || repeats ? false : null };
}

// ---- serialising ----

function carriersOf(offerId: string): MkAgreement[] {
  return getMarket().agreements.filter((a) => a.offerId === offerId && !(a.endsAt && a.endsAt <= now().toISOString()));
}

export function toOffer(o: MkOffer, forStation: string | null) {
  const { repeatFit: _r, ...rest } = o;
  const { fit, fits } = fitFor(o, forStation);
  return { ...rest, carriers: carriersOf(o.id).length, fit, fitsYourSchedule: fits };
}

function termsOf(o: MkOffer) {
  const { cashPriceMicros, cashPriceUnit, barterMakerMsPerHour, airingsPerEpisode, windowDays, liveOnly, noticeDays } = o;
  return { cashPriceMicros, cashPriceUnit, barterMakerMsPerHour, airingsPerEpisode, windowDays, liveOnly, noticeDays };
}

function offerOf(id: string): MkOffer | undefined {
  return getMarket().offers.find((o) => o.id === id);
}

function toAgreement(a: MkAgreement) {
  const o = offerOf(a.offerId)!;
  return {
    id: a.id,
    offerId: a.offerId,
    program: { id: o.program.id, title: o.program.title },
    maker: o.maker,
    carrier: ident(a.carrierId),
    term: a.term,
    terms: termsOf(o),
    audioOnly: a.audioOnly,
    startedAt: a.startedAt,
    endNoticeGivenAt: a.endNoticeGivenAt,
    endsAt: a.endsAt,
    airingsThisMonth: a.airingsThisMonth,
    paidThisMonthMicros: a.paidThisMonthMicros,
    slots: a.slots
  };
}

function toRequest(r: MkRequest) {
  const o = offerOf(r.offerId)!;
  const { agreementId, carrierId, offerId, ...rest } = r;
  return {
    ...rest,
    offerId,
    program: { id: o.program.id, title: o.program.title },
    carrier: ident(carrierId),
    maker: o.maker,
    agreementId,
    carrierProfile: CARRIER_PROFILES[carrierId] ?? { description: null, members: null, carriesPrograms: getMarket().agreements.filter((a) => a.carrierId === carrierId).length, blockedCategories: [] }
  };
}

// ---- placing in the log ----

/** A local date and `HH:MM` in the station's zone, as a timestamp. */
function localTime(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, d, hh + OFFSET_HOURS, mm)).toISOString();
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface Placement {
  startsAt: string;
  slot: Slot;
  repeat: boolean;
}

/**
 * Each airing the pending slots make over `weeks` weeks from `from`, in time order. A slot listed
 * in `repeatSlots` airs the week's episode again (contract request C4); the others take the next one.
 */
export function placements(slots: Slot[], repeatSlots: Slot[], from: string, weeks: number): Placement[] {
  const isRepeat = (s: Slot) => repeatSlots.some((r) => r.weekday === s.weekday && r.time === s.time);
  const out: Placement[] = [];
  for (const slot of slots) {
    let first = from;
    while (weekdayOf(first) !== slot.weekday) first = addDays(first, 1);
    for (let w = 0; w < weeks; w++) out.push({ startsAt: localTime(addDays(first, 7 * w), slot.time), slot, repeat: isRepeat(slot) });
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

function place(a: MkAgreement, from: string, weeks: number, replaceExisting: boolean) {
  const o = offerOf(a.offerId)!;
  const pending = a.pending ?? { slots: a.slots, startsOn: from, repeatSlots: [] };
  const start = pending.startsOn > from ? pending.startsOn : from;
  const eps = episodesFor(o);
  const lengthOf = (n: number) => eps.find((e) => e.episodeNumber === n)?.durationMs ?? o.program.format?.episodeLengthMs ?? 30 * MIN;
  const db = getDb();
  let placed = 0;
  let replaced = 0;
  let episode = a.nextEpisode - 1;
  let group: string | null = null;
  for (const p of placements(pending.slots, pending.repeatSlots ?? [], start, weeks)) {
    if (!p.repeat) {
      episode = episode >= o.program.episodeCount ? 1 : episode + 1;
      group = uuid();
    }
    const n = Math.max(1, episode);
    const ends = new Date(Date.parse(p.startsAt) + Math.ceil(lengthOf(n) / MIN) * MIN).toISOString();
    const clashes = db.log.filter((e) => e.stationId === a.carrierId && e.startsAt < ends && e.endsAt > p.startsAt);
    if (clashes.length && !replaceExisting) continue;
    replaced += clashes.length;
    db.log = db.log.filter((e) => !clashes.includes(e));
    const entry: DbLogEntry = {
      id: uuid(),
      stationId: a.carrierId,
      kind: "program",
      code: "PGM",
      startsAt: p.startsAt,
      endsAt: ends,
      title: o.program.title,
      episodeTitle: `ep. ${n}`,
      itemId: null,
      programId: o.program.id,
      liveSourceId: null,
      carriedFrom: o.maker,
      carriageAgreementId: a.id,
      repeatGroupId: group,
      localNote: p.repeat ? "Repeat" : null
    };
    db.log.push(entry);
    placed++;
  }
  a.nextEpisode = episode + 1;
  // What was asked for is now the agreement's schedule.
  if (a.pending) {
    const known = (s: Slot) => a.slots.some((x) => x.weekday === s.weekday && x.time === s.time);
    if (weeks > 1) a.slots = [...a.slots, ...a.pending.slots.filter((s) => !known(s))];
    a.pending = null;
  }
  saveDb();
  return { placed, replaced, blockedByLimit: 0 };
}

// ---- the handlers ----

export const marketHandlers = [
  http.get(path(catalogApi.browse), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const q = new URL(request.url).searchParams;
    const forStation = q.get("forStation");
    const maker = q.get("maker");
    const makerKind = q.get("makerKind");
    const band = q.get("band");
    const category = q.get("category");
    const term = q.get("term");
    const text = (q.get("q") ?? "").trim().toLowerCase();
    const gap = q.get("gap");
    const fitsOnly = q.get("fitsSchedule") === "true";
    let list = getMarket()
      .offers.filter((o) => (maker ? o.maker.id === maker : o.status === "offered"))
      .filter((o) => !makerKind || o.makerKind === makerKind)
      .filter((o) => !band || (o.program.format?.bands ?? []).includes(band as "tv" | "radio"))
      .filter((o) => !category || o.program.category === category)
      .filter((o) => !term || o.termsOffered.includes(term as MkOffer["termsOffered"][number]))
      .filter((o) => !text || `${o.program.title} ${o.maker.name} ${o.maker.callSign ?? ""}`.toLowerCase().includes(text))
      .map((o) => toOffer(o, forStation));
    if (fitsOnly) list = list.filter((o) => o.fit.length).sort((a, b) => fitRank(a.fit) - fitRank(b.fit) || b.carriers - a.carriers);
    if (gap) list = list.filter((o) => o.fit.some((f) => f.reason === "dead_air" && f.startsAt && Date.parse(f.startsAt) === Date.parse(gap)));
    return reply(BrowseX, list);
  }),

  http.get(path(catalogApi.getOffer), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = offerOf(String(params.offerId));
    if (!o) return fail(404, "not_found", "That program isn't offered.");
    const forStation = new URL(request.url).searchParams.get("forStation");
    return reply(OfferDetailX, {
      ...toOffer(o, forStation),
      episodes: episodesFor(o),
      carriedBy: carriersOf(o.id).map((a) => ({ station: ident(a.carrierId), since: a.startedAt, slots: a.slots }))
    });
  }),

  http.post(path(catalogApi.countPreview), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = offerOf(String(params.offerId));
    if (!o) return fail(404, "not_found", "That program isn't offered.");
    o.previews++;
    saveMarket();
    return reply(catalogApi.countPreview.response, { previews: o.previews });
  }),

  http.post(path(catalogApi.offerProgram), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const db = getDb();
    const program = db.library.programs.find((x) => x.id === String(params.programId));
    if (!program) return fail(404, "not_found", "That program wasn't found.");
    if (!mayAct(p, program.station.id)) return fail(403, "forbidden", "Only owners and operators can offer a program.");
    if (db.library.items.some((i) => i.programId === program.id && i.source === "link"))
      return fail(409, "link_import", `${program.title} can't be offered: an episode was imported from a link. Link imports stay local.`);
    const body = (await request.json()) as TermsBodyX;
    if (!body.termsOffered?.length) return fail(400, "no_deal", "Choose at least one deal.");
    const m = getMarket();
    const items = db.library.items.filter((i) => i.programId === program.id);
    const existing = m.offers.find((o) => o.program.id === program.id);
    const fields = {
      termsOffered: body.termsOffered,
      cashPriceMicros: body.cashPriceMicros,
      cashPriceUnit: body.cashPriceUnit,
      barterMakerMsPerHour: body.barterMakerMsPerHour,
      airingsPerEpisode: body.airingsPerEpisode,
      windowDays: body.windowDays,
      liveOnly: body.liveOnly,
      noticeDays: body.noticeDays,
      approval: body.approval,
      radioBandAllowed: body.radioBandAllowed,
      cashPlusBarter: body.cashPlusBarter ?? null,
      defaultTerm: body.termsOffered[0]
    };
    let o: MkOffer;
    if (existing) {
      Object.assign(existing, fields, { status: "offered" });
      o = existing;
    } else {
      o = {
        id: uuid(),
        program: {
          id: program.id,
          title: program.title,
          description: program.description,
          category: program.category,
          live: program.live,
          episodeCount: program.episodeCount,
          rightsNote: `Made by ${program.station.callSign ?? program.station.name}, confirmed`,
          format: formatFromLibrary(program, items.map((i) => i.durationMs)),
          colour: program.station.colour,
          advisory: program.advisory
        },
        maker: program.station,
        makerKind: program.station.kind === "studio" ? "studio" : "station",
        status: "offered",
        fitsYourSchedule: null,
        previews: 0,
        breakMsPerHour: 4 * MIN,
        barterFill: "spots",
        underwriter: null,
        offeredAt: now().toISOString(),
        repeatFit: null,
        ...fields
      };
      m.offers.push(o);
    }
    saveMarket();
    return reply(OfferX, toOffer(o, null), 201);
  }),

  http.patch(path(catalogApi.updateOffer), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = offerOf(String(params.offerId));
    if (!o) return fail(404, "not_found", "That program isn't offered.");
    if (!mayAct(p, o.maker.id)) return fail(403, "forbidden", "Only the maker's owners and operators can change its terms.");
    const body = (await request.json()) as Partial<TermsBodyX> & { status?: "offered" | "withdrawn" };
    for (const [k, v] of Object.entries(body)) if (v !== undefined) (o as unknown as Record<string, unknown>)[k] = v;
    if (body.termsOffered?.length) o.defaultTerm = body.termsOffered[0];
    saveMarket();
    return reply(OfferX, toOffer(o, null));
  }),

  http.post(path(catalogApi.requestCarriage), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = offerOf(String(params.offerId));
    if (!o || o.status !== "offered") return fail(404, "not_found", "That program isn't offered any more.");
    const body = (await request.json()) as { carrierStationId: string; term: MkRequest["term"]; slots: Slot[]; startsOn: string; audioOnly?: boolean; repeatSlots?: Slot[] };
    const carrier = dbStation(body.carrierStationId);
    if (!carrier || !mayAct(p, carrier.ident.id)) return fail(403, "forbidden", "Only owners and operators can carry a program.");
    if (carrier.ident.kind === "studio") return fail(409, "studio", "Studios don't broadcast, so they can't carry a program.");
    if (!o.termsOffered.includes(body.term)) return fail(400, "term", "That deal isn't offered.");
    if (!body.slots?.length) return fail(400, "slots", "Choose when it airs.");
    const m = getMarket();
    const t = now().toISOString();
    const existing = m.agreements.find((a) => a.offerId === o.id && a.carrierId === carrier.ident.id && !a.endsAt);
    const pending = { slots: body.slots, startsOn: body.startsOn, repeatSlots: body.repeatSlots ?? [] };
    let agreement: MkAgreement | null = null;
    if (existing) {
      // Carried already: another airing under the same agreement, no new terms (market 02.1).
      existing.pending = pending;
      agreement = existing;
    } else if (o.approval === "any_station") {
      agreement = { id: uuid(), offerId: o.id, carrierId: carrier.ident.id, term: body.term, slots: [], startedAt: t, endNoticeGivenAt: null, endsAt: null, airingsThisMonth: 0, paidThisMonthMicros: 0, audioOnly: !!body.audioOnly, pending, nextEpisode: 1 };
      m.agreements.push(agreement);
    }
    const r: MkRequest = {
      id: uuid(),
      offerId: o.id,
      carrierId: carrier.ident.id,
      term: existing?.term ?? body.term,
      slots: body.slots,
      startsOn: body.startsOn,
      audioOnly: !!body.audioOnly,
      status: agreement ? "approved" : "asked",
      declineReason: null,
      carrierSpotMsPerHour: 2 * MIN,
      createdAt: t,
      decidedAt: agreement ? t : null,
      agreementId: agreement?.id ?? null
    };
    m.requests.push(r);
    saveMarket();
    return reply(CarriageRequestX, toRequest(r), 201);
  }),

  http.get(path(catalogApi.listRequests), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    if (!membership(id, p.id)) return fail(403, "forbidden", "That station isn't one of yours.");
    const m = getMarket();
    const makerOf = (r: MkRequest) => offerOf(r.offerId)?.maker.id;
    return reply(RequestsX, {
      incoming: m.requests.filter((r) => makerOf(r) === id && r.carrierId !== id).map(toRequest),
      outgoing: m.requests.filter((r) => r.carrierId === id).map(toRequest)
    });
  }),

  http.post(path(catalogApi.decideRequest), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const m = getMarket();
    const r = m.requests.find((x) => x.id === String(params.requestId));
    if (!r) return fail(404, "not_found", "That request wasn't found.");
    const o = offerOf(r.offerId)!;
    if (!mayAct(p, o.maker.id)) return fail(403, "forbidden", "Only the maker's owners and operators can answer a request.");
    if (r.status !== "asked") return fail(409, "decided", "That request has already been answered.");
    const body = (await request.json()) as { decision: "approve" } | { decision: "decline"; reason: MkRequest["declineReason"] };
    const t = now().toISOString();
    r.decidedAt = t;
    if (body.decision === "approve") {
      r.status = "approved";
      const a: MkAgreement = { id: uuid(), offerId: o.id, carrierId: r.carrierId, term: r.term, slots: r.slots, startedAt: localTime(r.startsOn, "00:00"), endNoticeGivenAt: null, endsAt: null, airingsThisMonth: 0, paidThisMonthMicros: 0, audioOnly: r.audioOnly, pending: null, nextEpisode: 1 };
      m.agreements.push(a);
      r.agreementId = a.id;
    } else {
      r.status = "declined";
      r.declineReason = body.reason ?? null;
    }
    saveMarket();
    return reply(CarriageRequestX, toRequest(r));
  }),

  http.get(path(catalogApi.listAgreements), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    if (!membership(id, p.id)) return fail(403, "forbidden", "That station isn't one of yours.");
    const m = getMarket();
    return reply(AgreementsX, {
      carrying: m.agreements.filter((a) => a.carrierId === id).map(toAgreement),
      carriedBy: m.agreements.filter((a) => offerOf(a.offerId)?.maker.id === id).map(toAgreement)
    });
  }),

  http.post(path(catalogApi.endAgreement), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const a = getMarket().agreements.find((x) => x.id === String(params.agreementId));
    if (!a) return fail(404, "not_found", "That agreement wasn't found.");
    const o = offerOf(a.offerId)!;
    if (!mayAct(p, a.carrierId) && !mayAct(p, o.maker.id)) return fail(403, "forbidden", "Only either side's owners and operators can end carriage.");
    if (a.endNoticeGivenAt) return fail(409, "ending", "Notice has already been given.");
    const t = now();
    a.endNoticeGivenAt = t.toISOString();
    a.endsAt = new Date(t.getTime() + o.noticeDays * DAY).toISOString();
    saveMarket();
    return reply(AgreementX, toAgreement(a));
  }),

  http.post(path(catalogApi.placeInLog), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const a = getMarket().agreements.find((x) => x.id === String(params.agreementId));
    if (!a) return fail(404, "not_found", "That agreement wasn't found.");
    if (!mayAct(p, a.carrierId)) return fail(403, "forbidden", "Only the carrier's owners and operators can change its log.");
    const body = (await request.json()) as { from?: string; weeks?: number; replaceExisting?: boolean };
    const result = place(a, body.from ?? localDate(now().toISOString()), Math.min(12, Math.max(1, body.weeks ?? 4)), !!body.replaceExisting);
    saveMarket();
    return reply(catalogApi.placeInLog.response, result);
  })
];
