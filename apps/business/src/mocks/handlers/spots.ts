// spots for a business: listing, creating, uploading, checks, matching stations, submitting,
// pausing and resuming, ending. The Spots area owns this file.
//
// Plus one mock-only endpoint (/v1/mock/spots/:spotId/:action) standing in for what review and
// stations do on their side: pass review, add it to their rotations, air it. Review also passes by
// itself REVIEW_MS after submitting.

import { http, type HttpHandler } from "msw";
import { spotsApi, type Spot } from "@opencast/contracts";
import { MockSpotAction, mockSpotAction, SpotsX, SpotX, TargetingX } from "../../api/ext/spots";
import { now } from "../../lib/clock";
import { roleOn } from "../access";
import { balanceOf, dbBusiness, getDb } from "../db";
import {
  airOnce,
  airUntilPaused,
  codeFor,
  comeBack,
  matchStations,
  midnight,
  mockOf,
  newSpotId,
  passReview,
  pauseByYou,
  REVIEW_MS,
  saveSpots,
  spotOut,
  stationsAdd,
  stillFor,
  uploadChecks
} from "../fixtures/spots";
import type { MockPerson } from "../fixtures/people";
import { fail, needsUser, path, reply } from "../respond";

const money = (m: number) => `$${(m / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Ability = Parameters<typeof roleOn>[2];

/** The spot, if the person is on its business's team with the ability; otherwise the response to send. */
function spotFor(id: string, p: MockPerson, ability: Ability): Spot | Response {
  const s = getDb().spots.find((x) => x.id === id);
  if (!s) return fail(404, "not_found", "That spot wasn't found.");
  const r = roleOn(s.businessId, p, ability, "Viewers see results, airings and statements. Spots are for owners and managers.");
  if (r instanceof Response) return r.status === 404 ? fail(404, "not_found", "That spot wasn't found.") : r;
  return s;
}

const PAUSED = ["paused_budget", "paused_balance", "waiting_for_you"] as const;
const isPaused = (s: Spot) => (PAUSED as readonly string[]).includes(s.state);

/** Today in the market, as a date ("2026-09-26"). */
function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now());
}

/** A day of budget: the daily cap, or what the spot has been spending a day. */
function dayOfBudget(s: Spot): number {
  return s.budget.dailyCapMicros ?? mockOf(s).pace ?? Math.min(s.budget.totalMicros, 10_000_000);
}

export const spotsHandlers: HttpHandler[] = [
  http.get(path(spotsApi.listSpots), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "see");
    if (r instanceof Response) return r;
    return reply(SpotsX, getDb().spots.filter((s) => s.businessId === id).map(spotOut));
  }),

  http.post(path(spotsApi.createSpot), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "advertise", "Viewers can't make spots.");
    if (r instanceof Response) return r;
    const body = spotsApi.createSpot.body.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "invalid", "Check the spot's details and try again.");
    const b = dbBusiness(id)!;
    const d = body.data;
    const mine = getDb().spots.filter((s) => s.businessId === id);
    const code = d.code ?? { code: codeFor(b, getDb().spots.map((s) => s.code?.code ?? "")), offer: "10% off", windowDays: 7 };
    const spot: Spot = {
      id: newSpotId(),
      businessId: id,
      title: d.title,
      lengthSec: d.lengthSec,
      category: d.category,
      state: "draft",
      inRotationOn: 0,
      rate: d.rate,
      budget: { ...d.budget, usedMicros: 0, usedTodayMicros: 0 },
      startsOn: d.startsOn,
      endsOn: d.endsOn,
      targeting: {
        withinMiles: d.targeting.withinMiles ?? (b.customersWhere === "online" ? null : 10),
        locationIds: d.targeting.locationIds ?? (b.customersWhere === "online" ? [] : b.locations.slice(0, 1).map((l) => l.id)),
        marketIds: d.targeting.marketIds ?? (b.customersWhere === "online" ? b.marketIds : []),
        stationCategories: d.targeting.stationCategories ?? [],
        dayparts: d.targeting.dayparts ?? [],
        excludedStationIds: d.targeting.excludedStationIds ?? []
      },
      code,
      file: null,
      productionOrderId: null,
      createdAt: now().toISOString()
    };
    getDb().spots.push(spot);
    const m = mockOf(spot);
    m.still = stillFor(spot.title, b.name, mine.length);
    saveSpots();
    return reply(SpotX, spotOut(spot), 201);
  }),

  http.get(path(spotsApi.getSpot), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const s = spotFor(String(params.spotId), p, "see");
    if (s instanceof Response) return s;
    return reply(SpotX, spotOut(s));
  }),

  http.patch(path(spotsApi.updateSpot), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const s = spotFor(String(params.spotId), p, "advertise");
    if (s instanceof Response) return s;
    const body = spotsApi.updateSpot.body.extend({ targeting: TargetingX.partial() }).partial().safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "invalid", "Check the rate and budget and try again.");
    const d = body.data;
    if (s.state === "ended") return fail(409, "ended", "It's ended. Its results stay, but it can't change.");
    if (d.budget && d.budget.totalMicros < s.budget.usedMicros) return fail(409, "budget_below_used", `The budget can't be less than the ${money(s.budget.usedMicros)} already used.`);
    if (d.budget?.dailyCapMicros && d.budget.dailyCapMicros > d.budget.totalMicros) return fail(400, "cap_over_total", "The most per day can't be more than the total.");
    if (d.title !== undefined) s.title = d.title;
    if (d.rate) s.rate = { kind: d.rate.kind, micros: d.rate.micros, perAiringMaxMicros: d.rate.perAiringMaxMicros ?? null };
    if (d.budget) s.budget = { ...s.budget, totalMicros: d.budget.totalMicros, dailyCapMicros: d.budget.dailyCapMicros ?? null };
    if (d.startsOn !== undefined) s.startsOn = d.startsOn;
    if (d.endsOn !== undefined) s.endsOn = d.endsOn;
    if (d.code !== undefined) {
      s.code = d.code;
      // The code check names the code on the frame.
      if (s.file) s.file = { ...s.file, checks: s.file.checks.map((c) => (c.check === "code" && d.code ? { ...c, label: `Code ${d.code.code} added` } : c)) };
    }
    if (d.targeting) {
      const { bands, ...t } = d.targeting;
      s.targeting = { ...s.targeting, ...t };
      if (bands) mockOf(s).bands = bands;
    }
    // A daily cap raised past today's spending: back in rotation now, not at midnight.
    if (s.state === "paused_daily_cap" && (s.budget.dailyCapMicros === null || s.budget.usedTodayMicros < s.budget.dailyCapMicros)) s.state = "in_rotation";
    saveSpots();
    return reply(SpotX, spotOut(s));
  }),

  http.post(path(spotsApi.uploadSpotFile), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const s = spotFor(String(params.spotId), p, "advertise");
    if (s instanceof Response) return s;
    if (s.state !== "draft") return fail(409, "not_draft", "A listed spot's file can't change. Make a new spot instead.");
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return fail(400, "no_file", "Choose the spot's file to upload.");
    const scaled = form?.get("scaleToFit") === "true";
    const m = mockOf(s);
    m.scaled = scaled;
    let url = "/mock-media/spot.mp4";
    try {
      url = URL.createObjectURL(file);
    } catch {
      // No object URLs (tests): the still stands in.
    }
    s.file = { url, previewUrl: null, durationMs: s.lengthSec * 1000, originalFilename: file.name || null, checks: uploadChecks(s.lengthSec, s.code?.code ?? null, scaled) };
    saveSpots();
    return reply(SpotX, spotOut(s));
  }),

  http.post(path(spotsApi.matchStations), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const s = spotFor(String(params.spotId), p, "advertise");
    if (s instanceof Response) return s;
    const body = TargetingX.partial().safeParse((await request.json().catch(() => null)) ?? {});
    if (!body.success) return fail(400, "invalid", "Check who it's for and try again.");
    const b = dbBusiness(s.businessId)!;
    return reply(spotsApi.matchStations.response, { stations: matchStations(b, s.rate, { ...s.targeting, bands: mockOf(s).bands, ...body.data }) });
  }),

  http.post(path(spotsApi.submitSpot), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const s = spotFor(String(params.spotId), p, "advertise");
    if (s instanceof Response) return s;
    if (s.state !== "draft") return fail(409, "not_draft", "It's already been sent.");
    if (!s.file) return fail(409, "no_file", "Upload the spot first.");
    if (s.file.checks.some((c) => (c.check === "length" || c.check === "picture") && c.result === "for_you")) return fail(409, "checks", "Upload a new cut first: the length or picture won't air.");
    if (balanceOf(s.businessId).availableMicros < dayOfBudget(s)) return fail(409, "balance", "Listing needs a day of budget available. Add money first.");
    mockOf(s).reviewReadyAt = Date.now() + REVIEW_MS;
    s.state = "in_review";
    saveSpots();
    return reply(SpotX, spotOut(s));
  }),

  http.post(path(spotsApi.pauseSpot), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const s = spotFor(String(params.spotId), p, "advertise");
    if (s instanceof Response) return s;
    if (s.state !== "listed" && s.state !== "in_rotation" && s.state !== "paused_daily_cap") return reply(SpotX, spotOut(s));
    pauseByYou(s);
    return reply(SpotX, spotOut(s));
  }),

  http.post(path(spotsApi.resumeSpot), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const s = spotFor(String(params.spotId), p, "advertise");
    if (s instanceof Response) return s;
    if (!isPaused(s)) return reply(SpotX, spotOut(s));
    if (s.budget.usedMicros >= s.budget.totalMicros) return fail(409, "budget_spent", "Raise the budget first.");
    const available = balanceOf(s.businessId).availableMicros;
    if (available <= 0) return fail(409, "balance", `Add money first. Your available balance is ${money(Math.max(0, available))}.`);
    comeBack(s);
    return reply(SpotX, spotOut(s));
  }),

  http.post(path(spotsApi.endSpot), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const s = spotFor(String(params.spotId), p, "advertise");
    if (s instanceof Response) return s;
    if (s.state !== "ended") {
      const m = mockOf(s);
      s.state = "ended";
      s.endsOn = today();
      m.rotation = [];
      m.pause = null;
      m.back = null;
      m.reviewReadyAt = null;
      saveSpots();
    }
    return reply(SpotX, spotOut(s));
  }),

  // Mock mode only: review and stations.
  http.post(path(mockSpotAction), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const s = spotFor(String(params.spotId), p, "advertise");
    if (s instanceof Response) return s;
    const action = MockSpotAction.safeParse(params.action);
    if (!action.success) return fail(404, "not_found", "No such mock action.");
    const b = dbBusiness(s.businessId)!;
    switch (action.data) {
      case "pass_review":
        if (s.state === "in_review") passReview(s);
        break;
      case "stations_add":
        if (s.state === "listed") stationsAdd(s, b);
        break;
      case "air_one":
        airOnce(s);
        break;
      case "air_all":
        airUntilPaused(s);
        break;
      case "midnight":
        midnight(s);
        break;
    }
    return reply(SpotX, spotOut(s));
  })
];
