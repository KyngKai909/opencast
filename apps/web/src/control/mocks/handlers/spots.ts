// spots, station side: open time in breaks (the rail's Breaks badge), the spot market, rotations
// (and the log placing them in tonight's breaks), sponsorships, production orders sent to this
// station, and the business side's pause and resume (the mock's pause story, biz-spots 05).
// The Money area's Spots part owns this file.

import { http } from "msw";
import { type BreakContent, SPOT_CATEGORIES, spotsApi, stationsApi } from "@opencast/contracts";
import { getDb, membership, saveDb, stationBreaks } from "../db";
import { breakSlot, type DbFill } from "../fixtures/evening";
import { stationById } from "../fixtures/stations";
import {
  BACKUP_NOTE,
  DEFAULT_BLOCKED,
  DEFAULT_RULE,
  businessOf,
  getSpots,
  heldMs,
  inMarket,
  isPaused,
  placeRotation,
  rotationOut,
  rotationsOf,
  saveSpots,
  spotById,
  spotOut,
  stationState,
  toPlaceSpot,
  type FxOrder,
  type FxSpot,
  type PlaceRule
} from "../fixtures/spots";
import { now } from "../../../lib/clock";
import { fail, needsUser, path, reply } from "../respond";
import type { MockPerson } from "../fixtures/people";

// ---- Helpers ----

/** Owners and operators act on spots (setRotation: "owner, operator"). */
function mayAct(stationId: string, p: MockPerson) {
  const role = membership(stationId, p.id)?.role;
  return role === "owner" || role === "operator";
}
const isMember = (stationId: string, p: MockPerson) => !!membership(stationId, p.id);
const isOwner = (stationId: string, p: MockPerson) => membership(stationId, p.id)?.role === "owner";

/**
 * The station's break rule and blocked categories, read through the contract (stations.getBreakRule,
 * the Station area's). Until its mock answers, the settings frame's values stand in.
 */
async function breakRuleOf(request: Request, stationId: string): Promise<{ rule: PlaceRule; blocked: string[] }> {
  try {
    const url = new URL(`/v1${stationsApi.getBreakRule.path.replace(":stationId", stationId)}`, request.url);
    const res = await fetch(url, { headers: { authorization: request.headers.get("authorization") ?? "", accept: "application/json" } });
    if (res.ok && (res.headers.get("content-type") ?? "").includes("json")) {
      const r = stationsApi.getBreakRule.response.safeParse(await res.json());
      if (r.success) return { rule: { spotMsPerHour: r.data.spotMsPerHour, sameSpotPerHour: r.data.sameSpotPerHour }, blocked: r.data.blockedCategories };
    }
  } catch {
    // Not answered yet: the defaults.
  }
  return { rule: DEFAULT_RULE, blocked: DEFAULT_BLOCKED };
}

/** Places the station's rotations in its upcoming breaks (the log does the placing). */
function place(stationId: string, rule: PlaceRule) {
  const db = getDb();
  const r = rotationsOf(stationId);
  const spots = (ids: string[]) => ids.map(spotById).filter((s): s is FxSpot => !!s).map(toPlaceSpot);
  const placed = placeRotation(stationBreaks(stationId), now().toISOString(), spots(r.main), spots(r.backup), rule);
  db.breaks = [...db.breaks.filter((b) => b.stationId !== stationId), ...placed];
  saveDb();
}

function upcoming(stationId: string) {
  return stationBreaks(stationId, now().toISOString());
}

function contentOf(f: DbFill): BreakContent {
  const biz = f.business ? getSpots().businesses.find((b) => b.name === f.business) : undefined;
  return {
    id: f.id,
    kind: f.kind,
    title: f.title,
    lengthMs: f.lengthMs,
    spotId: f.spotId ?? null,
    business: f.business ?? null,
    shortName: biz?.shortName ?? null,
    rotation: f.kind === "spot" ? (f.note === BACKUP_NOTE ? "backup" : f.spotId ? "main" : null) : null,
    note: f.note ?? null
  };
}

function marketSpotOut(s: FxSpot, stationId: string) {
  const b = businessOf(s);
  const r = rotationsOf(stationId);
  const st = stationState(s, stationId);
  return {
    spot: { id: s.id, title: s.title, lengthSec: s.lengthSec, category: s.category, onScreen: s.onScreen, preview: { url: null, colour: b.colour, line: s.line } },
    business: { id: b.id, name: b.name, category: b.category, city: b.city, online: b.online, shortName: b.shortName },
    miles: s.miles,
    rate: s.rate,
    upToPerDay: s.upToPerDay,
    listedUntil: s.listedUntil,
    runway: s.runway,
    inRotation: r.main.includes(s.id) ? ("main" as const) : r.backup.includes(s.id) ? ("backup" as const) : null,
    customersFromThisStation: s.customers[stationId] ?? 0,
    state: st,
    pause: s.pause && st === "paused" ? { reason: s.pause.reason, pausedAt: s.pause.pausedAt, heldTonightMs: s.pause.heldTonightMs[stationId] ?? 0, filledBy: s.pause.filledBy[stationId] ?? [] } : null,
    back: s.back && st === "its_back" ? s.back : null
  };
}

function sponsorshipOut(id: string) {
  const s = getSpots().sponsorships.find((x) => x.id === id)!;
  const b = getSpots().businesses.find((x) => x.id === s.businessId)!;
  return {
    id: s.id,
    business: { id: b.id, name: b.name },
    station: stationById(s.stationId)!,
    program: s.program,
    monthlyMicros: s.monthlyMicros,
    creditText: s.creditText,
    state: s.state,
    declineReason: s.declineReason,
    startsOn: s.startsOn,
    renewsOn: s.renewsOn,
    createdAt: s.createdAt,
    profile: { category: b.category, city: b.city, miles: getSpots().spots.find((x) => x.businessId === b.id)?.miles ?? null, elsewhere: b.sponsorsElsewhere }
  };
}

function settingsOut(stationId: string) {
  const live = getSpots().sponsorships.filter((s) => s.stationId === stationId && (s.state === "approved" || s.state === "credited"));
  return (getSpots().settings[stationId] ?? []).map((x) => ({ ...x, sponsors: live.filter((s) => (s.program?.id ?? null) === x.programId).length }));
}

function orderOut(o: FxOrder) {
  const s = o.spotId ? spotById(o.spotId) : undefined;
  return { ...o, listedRate: s && inMarket(s) ? s.rate : null };
}

const orderById = (id: string) => getSpots().orders.find((o) => o.id === id);

// ---- Handlers ----

/** Delivering a version (the form endpoint's work, and a direct upload's once its parts are in). */
export function mockDeliverOrder(request: Request, orderId: string): Response {
  const p = needsUser(request);
  if (p instanceof Response) return p;
  const o = orderById(orderId);
  if (!o || !isMember(o.maker.id, p)) return fail(404, "not_found", "That order wasn't found.");
  if (!mayAct(o.maker.id, p)) return fail(403, "forbidden", "Only owners and operators deliver.");
  if (o.state !== "accepted" && o.state !== "changes_requested") return fail(409, "not_now", "This order isn't waiting for a delivery.");
  const t = now();
  const version = o.deliveries.length + 1;
  o.deliveries.push({ id: `${o.id.slice(0, -4)}${String(version).padStart(4, "0")}`, version, url: `/mock-files/${o.title.toLowerCase().replace(/\W+/g, "-")}-v${version}.mp4`, previewUrl: null, createdAt: t.toISOString() });
  o.state = "delivered";
  o.deliveredAt = t.toISOString();
  o.autoApproveAt = new Date(t.getTime() + 7 * 86400e3).toISOString();
  saveSpots();
  return reply(spotsApi.getOrder.response, orderOut(o));
}

export const spotsHandlers = [
  http.get(path(spotsApi.getAvails), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const hours = Number(new URL(request.url).searchParams.get("hours") ?? 24);
    const from = now().toISOString();
    const to = new Date(Date.parse(from) + hours * 3600e3).toISOString();
    const breaks = stationBreaks(String(params.stationId), from, to);
    const slots = breaks.map(breakSlot);
    return reply(spotsApi.getAvails.response, {
      totalOpenMs: slots.reduce((a, b) => a + b.openMs, 0),
      breaks: breaks.map((b, i) => ({
        breakStartsAt: b.startsAt,
        context: b.context,
        lengthMs: b.lengthMs,
        openMs: slots[i].openMs,
        producerShareMs: b.producerShareMs,
        breakId: b.id,
        origin: b.origin,
        contents: b.fills.map(contentOf)
      }))
    });
  }),

  http.get(path(spotsApi.stationMarket), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    if (!isMember(id, p)) return fail(403, "forbidden", "That station isn't one of yours.");
    const q = new URL(request.url).searchParams;
    const within = q.get("withinMiles") ? Number(q.get("withinMiles")) : null;
    const category = q.get("category");
    const { blocked } = await breakRuleOf(request, id);
    const r = rotationsOf(id);
    const list = getSpots()
      .spots.filter((s) => inMarket(s) && (!isPaused(s) || r.main.includes(s.id) || r.backup.includes(s.id)))
      .filter((s) => !blocked.includes(s.category))
      .filter((s) => within === null || (s.miles !== null && s.miles <= within))
      .filter((s) => !category || s.category === category)
      .map((s) => marketSpotOut(s, id));
    return reply(spotsApi.stationMarket.response, list);
  }),

  http.get(path(spotsApi.getRotations), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    if (!isMember(id, p)) return fail(403, "forbidden", "That station isn't one of yours.");
    return reply(spotsApi.getRotations.response, { main: rotationOut(id, "main"), backup: rotationOut(id, "backup") });
  }),

  http.put(path(spotsApi.setRotation), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const kind = String(params.kind) as "main" | "backup";
    if (!mayAct(id, p)) return fail(403, "forbidden", "Only owners and operators change rotations.");
    const body = spotsApi.setRotation.body.safeParse(await request.json());
    if (!body.success) return fail(400, "invalid", "That rotation isn't valid.");
    const ids = [...new Set(body.data.spotIds)];
    const unknown = ids.find((x) => !spotById(x));
    if (unknown) return fail(404, "not_found", "One of those spots isn't in the market.");
    const r = rotationsOf(id);
    const added = ids.filter((x) => !r[kind].includes(x));
    if (added.some((x) => isPaused(spotById(x)!))) return fail(409, "paused", "That spot is paused. It can go back in when its business brings it back.");
    r[kind] = ids;
    // A spot in one rotation leaves the other.
    const other = kind === "main" ? "backup" : "main";
    r[other] = r[other].filter((x) => !ids.includes(x));
    // Adding back a spot that came back answers its "It's back".
    for (const x of added) {
      const s = spotById(x)!;
      s.backFor = s.backFor.filter((st) => st !== id);
    }
    saveSpots();
    place(id, (await breakRuleOf(request, id)).rule);
    return reply(spotsApi.setRotation.response, rotationOut(id, kind));
  }),

  // ---- Sponsorships ----

  http.post(path(spotsApi.checkCredit), async ({ request }) => {
    const body = spotsApi.checkCredit.body.safeParse(await request.json());
    if (!body.success) return fail(400, "invalid", "That credit is too long.");
    const text = body.data.text;
    const flags: { kind: "price_or_offer" | "comparison" | "call_to_action"; text: string; start: number; end: number; suggestion: string }[] = [];
    const rules: [RegExp, "price_or_offer" | "comparison" | "call_to_action", string][] = [
      [/\$\d+(\.\d\d)?|\d+% off|\bfree\b|\bsale\b|\bdiscount\b/gi, "price_or_offer", "Say what you do, not the price"],
      [/\bbest\b|\bcheapest\b|\bnumber one\b|\bbetter than\b/gi, "comparison", "Leave out comparisons"],
      [/\bcall\b|\bvisit\b|\bcome in\b|\bstop by\b|\bbuy\b/gi, "call_to_action", "Say where you are instead"]
    ];
    for (const [re, kind, suggestion] of rules) for (const m of text.matchAll(re)) flags.push({ kind, text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, suggestion });
    return reply(spotsApi.checkCredit.response, { passes: flags.length === 0, flags });
  }),

  http.get(path(spotsApi.listStationSponsorships), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    if (!isMember(id, p)) return fail(403, "forbidden", "That station isn't one of yours.");
    const list = getSpots().sponsorships.filter((s) => s.stationId === id).map((s) => sponsorshipOut(s.id));
    return reply(spotsApi.listStationSponsorships.response, { sponsorships: list, settings: settingsOut(id), members: getSpots().members[id] ?? null });
  }),

  http.post(path(spotsApi.decideSponsorship), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const s = getSpots().sponsorships.find((x) => x.id === String(params.sponsorshipId));
    if (!s) return fail(404, "not_found", "That request wasn't found.");
    if (!mayAct(s.stationId, p)) return fail(403, "forbidden", "Only owners and operators answer sponsors.");
    if (s.state !== "requested") return fail(409, "already_answered", "That request has already been answered.");
    const body = spotsApi.decideSponsorship.body.safeParse(await request.json());
    if (!body.success) return fail(400, "invalid", "Choose a reason to decline.");
    if (body.data.decision === "approve") {
      s.state = "approved";
      s.renewsOn = s.startsOn;
    } else {
      s.state = "declined";
      s.declineReason = body.data.reason;
    }
    saveSpots();
    return reply(spotsApi.decideSponsorship.response, sponsorshipOut(s.id));
  }),

  http.post(path(spotsApi.endSponsorship), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const s = getSpots().sponsorships.find((x) => x.id === String(params.sponsorshipId));
    if (!s) return fail(404, "not_found", "That sponsorship wasn't found.");
    if (!isOwner(s.stationId, p)) return fail(403, "forbidden", "Only the station's owners end a sponsorship.");
    s.renewsOn = null;
    saveSpots();
    return reply(spotsApi.endSponsorship.response, sponsorshipOut(s.id));
  }),

  http.put(path(spotsApi.setSponsorshipSettings), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    if (!isOwner(id, p)) return fail(403, "forbidden", "Only the station's owners change sponsorship minimums.");
    const body = spotsApi.setSponsorshipSettings.body.safeParse(await request.json());
    if (!body.success) return fail(400, "invalid", "Check the amounts: a minimum is in dollars, and most sponsors is a whole number.");
    const list = (getSpots().settings[id] ??= []);
    for (const row of body.data) {
      const x = list.find((s) => s.programId === row.programId);
      if (!x || x.sponsoredThrough) continue;
      Object.assign(x, { minMonthlyMicros: row.minMonthlyMicros, maxSponsors: row.maxSponsors, closed: row.closed });
    }
    saveSpots();
    return reply(spotsApi.setSponsorshipSettings.response, settingsOut(id));
  }),

  // ---- Production orders (this station as the maker) ----

  http.get(path(spotsApi.listMakerOrders), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    if (!isMember(id, p)) return fail(403, "forbidden", "That station isn't one of yours.");
    const list = getSpots()
      .orders.filter((o) => o.maker.id === id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(orderOut);
    return reply(spotsApi.listMakerOrders.response, list);
  }),

  http.get(path(spotsApi.getOrder), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = orderById(String(params.orderId));
    if (!o || !isMember(o.maker.id, p)) return fail(404, "not_found", "That order wasn't found.");
    return reply(spotsApi.getOrder.response, orderOut(o));
  }),

  http.post(path(spotsApi.quoteOrder), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = orderById(String(params.orderId));
    if (!o || !isMember(o.maker.id, p)) return fail(404, "not_found", "That order wasn't found.");
    if (!mayAct(o.maker.id, p)) return fail(403, "forbidden", "Only owners and operators quote.");
    if (o.state !== "asked") return fail(409, "already_answered", "This order has already been answered.");
    const body = spotsApi.quoteOrder.body.safeParse(await request.json());
    if (!body.success) return fail(400, "invalid", "Add a price and a delivery date.");
    if (body.data.action === "pass") o.state = "passed";
    else {
      o.state = "quoted";
      o.quote = { priceMicros: body.data.priceMicros, deliverBy: body.data.deliverBy, roundsIncluded: body.data.roundsIncluded, voicedBy: body.data.voicedBy };
    }
    saveSpots();
    return reply(spotsApi.getOrder.response, orderOut(o));
  }),

  http.post(path(spotsApi.deliverOrder), ({ request, params }) => mockDeliverOrder(request, String(params.orderId))),

  http.post(path(spotsApi.addOrderNote), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = orderById(String(params.orderId));
    if (!o || !isMember(o.maker.id, p)) return fail(404, "not_found", "That order wasn't found.");
    const body = spotsApi.addOrderNote.body.safeParse(await request.json());
    if (!body.success) return fail(400, "invalid", "Write a note first.");
    o.notes.push({ id: `${o.id.slice(0, -4)}${String(9000 + o.notes.length).padStart(4, "0")}`, timecodeMs: body.data.timecodeMs, author: p.displayName, body: body.data.body, makersMistake: false, round: o.roundsUsed, createdAt: now().toISOString() });
    saveSpots();
    return reply(spotsApi.getOrder.response, orderOut(o));
  }),

  // S17: the one list of spot categories.
  http.get(path(spotsApi.listSpotCategories), () => reply(spotsApi.listSpotCategories.response, [...SPOT_CATEGORIES])),

  http.post(path(spotsApi.tellMeWhenListed), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const o = orderById(String(params.orderId));
    if (!o || !isMember(o.maker.id, p)) return fail(404, "not_found", "That order wasn't found.");
    o.makerToldWhenListed = true;
    saveSpots();
    return reply(spotsApi.getOrder.response, orderOut(o));
  }),

  http.get(path(spotsApi.stationCustomers), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    if (!isMember(id, p)) return fail(403, "forbidden", "That station isn't one of yours.");
    const list = getSpots()
      .spots.filter((s) => (s.customers[id] ?? 0) > 0)
      .map((s) => ({ spotId: s.id, business: businessOf(s).name, customers: s.customers[id] }));
    return reply(spotsApi.stationCustomers.response, list);
  }),

  // ---- The business side's pause and resume (the pause story on mocks) ----

  http.post(path(spotsApi.pauseSpot), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const s = spotById(String(params.spotId));
    if (!s) return fail(404, "not_found", "That spot wasn't found.");
    if (isPaused(s)) return reply(spotsApi.pauseSpot.response, spotOut(s));
    const all = getSpots().rotations;
    const stations = Object.keys(all).filter((id) => all[id].main.includes(s.id) || all[id].backup.includes(s.id));
    const before = new Map(stations.map((id) => [id, new Set(upcoming(id).flatMap((b) => b.fills.map((f) => f.id)))]));
    const held = Object.fromEntries(stations.map((id) => [id, heldMs(upcoming(id), s.id)]));
    s.state = "paused_budget";
    s.back = null;
    s.pause = { reason: "budget_spent", pausedAt: now().toISOString(), heldTonightMs: held, filledBy: {} };
    for (const id of stations) {
      place(id, (await breakRuleOf(request, id)).rule);
      const added = upcoming(id).flatMap((b) => b.fills).filter((f) => f.note === BACKUP_NOTE && !before.get(id)!.has(f.id));
      s.pause.filledBy[id] = [...new Set(added.map((f) => f.business ?? f.title))];
    }
    saveSpots();
    return reply(spotsApi.pauseSpot.response, spotOut(s));
  }),

  http.post(path(spotsApi.resumeSpot), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const s = spotById(String(params.spotId));
    if (!s) return fail(404, "not_found", "That spot wasn't found.");
    if (!isPaused(s)) return reply(spotsApi.resumeSpot.response, spotOut(s));
    const all = getSpots().rotations;
    const stations = Object.keys(all).filter((id) => all[id].main.includes(s.id) || all[id].backup.includes(s.id));
    // Back in the market. It never returns to a rotation by itself: each station adds it back.
    s.state = "listed";
    s.pause = null;
    s.back = { reason: "raised_budget", backAt: now().toISOString() };
    s.backFor = stations;
    s.runway = { kind: "days", days: 17 };
    for (const id of stations) {
      all[id].main = all[id].main.filter((x) => x !== s.id);
      all[id].backup = all[id].backup.filter((x) => x !== s.id);
    }
    saveSpots();
    for (const id of stations) place(id, (await breakRuleOf(request, id)).rule);
    return reply(spotsApi.resumeSpot.response, spotOut(s));
  })
];
