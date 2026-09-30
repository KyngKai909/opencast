// Opencast for business: businesses, spots, targeting, the station side of the
// spot market, rotations, placing spots in breaks (with money held first) and
// settling what aired. Sponsorships, production orders and codes are in their own files.

import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { oneDayOfBudgetMicros } from "@opencast/domain";
import type { Business, MarketSpot, Spot, SpotState, TargetMatch } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import type { CurrentUser, UploadedFile } from "../../http.js";
import { badRequest, notFound, refused } from "../../errors.js";
import { miles } from "../network/service.js";
import { localDate, localDay } from "../../lib/time.js";

/** P23: a business's colour for its still while there's no picture: one of these, by its id. All hold 4.5:1 on white. */
const STILL_COLOURS = ["#9A5412", "#33507A", "#2F6B3F", "#7A3366", "#5B4A99", "#8A3B2E", "#1F6570", "#6B5A1E"];
export function colourFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return STILL_COLOURS[hash % STILL_COLOURS.length];
}

/** P11: a business's initials for its logo mark ("Orange Street Coffee" is OSC). */
export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  const letters = (words.length > 1 ? words.slice(0, 3).map((w) => w.replace(/[^A-Za-z0-9]/g, "")[0] ?? "") : [name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2)]).join("");
  return letters.toUpperCase() || "?";
}

/** P4: where a spot's code and QR sit (inside title safe, bottom left) and for how long at its end. */
export const CODE_PLACEMENT = { placement: "bottom_left" as const, box: { x: 0.1, y: 0.72, w: 0.2, h: 0.18 }, lastMs: 10_000 };
import { createSponsorships, type SponsorshipsPart } from "./sponsorships.js";
import { createCatalogSponsors, monthOf as catalogMonthOf, type CatalogSponsorsPart } from "./catalogSponsors.js";
import { createOrders, type OrdersPart } from "./orders.js";
import { createCodes, type CodesPart } from "./codes.js";
import { createBusinessPart, type BusinessPart } from "./business.js";
import { createRelayViewers } from "./relayViewers.js";

type Targeting = Spot["targeting"];

export interface SpotsService extends SponsorshipsPart, CatalogSponsorsPart, OrdersPart, CodesPart, BusinessPart {
  businessNames(ids: string[]): Promise<Map<string, string>>;
  /** E4: signs a business's receipt links (made on first use). */
  receiptsKey(businessId: string): Promise<string>;
  /** E4: what a receipt names, open or closed. */
  businessForBooks(businessId: string): Promise<{ name: string; legalName: string | null; einLast4: string | null }>;
  /** E6: what an airings estimate is based on: the rate of a listed or paused spot, and for per-thousand the station it last aired on. */
  airingCostBasis(businessId: string): Promise<{ rateKind: "per_thousand" | "per_airing"; rateMicros: number; stationId: string | null } | null>;
  filledMsByBreak(breakIds: string[]): Promise<Map<string, number>>;
  spotSummary(spotId: string): Promise<{ title: string; business: string }>;
  /** Pauses a business's spots it can no longer cover a day of, and resumes ones it now can. */
  /** Pauses spots the balance no longer covers for a day; a top-up (`toppedUp`) also brings paused ones back. */
  reviewBalance(businessId: string, toppedUp?: boolean): Promise<void>;
  typicalAiringCost(businessId: string): Promise<number | null>;
  heldAirings(stationId: string, from: Date, to: Date): Promise<Array<{ airingId: string; holdId: string; scheduledAt: Date; breakId: string }>>;
  businessesAiredOn(stationId: string, from: Date, to: Date): Promise<number>;
  businessOfSpot(spotId: string): Promise<string>;
  /** What the ledger needs to warn a business: its thresholds, auto top-up, and when it started. */
  moneySettings(businessId: string): Promise<{ warnDays: number[]; autoTopUp: boolean; autoTopUpMicros: number | null; autoTopUpBelowDays: number; createdAt: Date } | null>;
  heldAiringsForSpot(spotId: string, from: Date): Promise<Array<{ airingId: string; station: import("@opencast/contracts").StationIdent; scheduledAt: string; heldMicros: number }>>;

  createBusiness(user: CurrentUser, input: BusinessInput): Promise<Business>;
  business(businessId: string): Promise<Business>;
  updateBusiness(businessId: string, input: Partial<BusinessPatch>): Promise<Business>;
  addLocation(businessId: string, input: LocationInput): Promise<Business>;
  removeLocation(businessId: string, locationId: string): Promise<Business>;

  spots(businessId: string): Promise<Spot[]>;
  spot(spotId: string): Promise<Spot>;
  createSpot(businessId: string, input: SpotInput): Promise<Spot>;
  updateSpot(spotId: string, input: Partial<SpotInput>): Promise<Spot>;
  uploadSpotFile(spotId: string, file: UploadedFile, scaleToFit: boolean): Promise<Spot>;
  matches(spotId: string, targeting: Partial<Targeting>): Promise<TargetMatch[]>;
  submit(spotId: string): Promise<Spot>;
  pause(spotId: string): Promise<Spot>;
  resume(spotId: string): Promise<Spot>;
  end(spotId: string): Promise<Spot>;
  reviewQueue(): Promise<Spot[]>;
  review(spotId: string, decision: "approve" | "send_back"): Promise<Spot>;

  stationMarket(stationId: string, filter: { withinMiles?: number; category?: string }): Promise<MarketSpot[]>;
  rotations(stationId: string): Promise<{ main: RotationView; backup: RotationView }>;
  setRotation(stationId: string, kind: "main" | "backup", spotIds: string[]): Promise<RotationView>;
  /** The spots a station's rotation (then backup) offers for a break, in order. For playout. */
  rotationFor(stationId: string, kind: "main" | "backup"): Promise<Array<{ spotId: string; lengthSec: number; category: string; dayparts: string[] }>>;
  /** How much break time a spot has filled on a station lately, per day (the last 7 days). */
  recentAirTimePerDay(spotId: string, stationId: string): Promise<number>;
  /** Held airings more than an hour past their slot that never aired: their holds go back. */
  releaseUnaired(): Promise<number>;
  /** The files of every spot a station could air soon: placed airings, and its rotations. */
  upcomingSpotContent(stationIds: string[], from: Date, to: Date): Promise<Array<{ stationId: string; spotId: string; contentId: string; airsAt: Date | null; durationMs?: number }>>;
  /** What's placed in each break, in order, with what playout needs to air it. */
  breakAirings(breakIds: string[]): Promise<Map<string, BreakAiring[]>>;
  /**
   * Added 2026-09-29 (the log's edit mode): a held airing whose break went airs in another break
   * instead, at `scheduledAt`. Its hold, rate and spot are unchanged.
   */
  moveAiring(airingId: string, breakId: string, scheduledAt: Date): Promise<void>;
  /** Spots placed on a station in a window (for the hourly cap and same-spot limit). */
  placedOnStation(stationId: string, from: Date, to: Date): Promise<Array<{ spotId: string; lengthSec: number; scheduledAt: Date }>>;
  /**
   * Places a spot in a stored break, holding the money first. Refused (and nothing
   * changes) if the spot can't be placed or the money can't be held; playout then
   * tries the next spot, the backup rotation, then station ID and bumpers.
   */
  place(input: { spotId: string; stationId: string; breakId: string; scheduledAt: Date; carriageAgreementId?: string }): Promise<{ airingId: string; holdMicros: number }>;
  /** Pays for an airing from the as-run log: prorated if cut short, per thousand from the tuned-in numbers. */
  settleAiring(input: { airingId: string; asRunId: string; startedAt: Date; endedAt: Date; barter?: { producerStationId: string; producerShare: number; agreementId: string } }): Promise<{ costMicros: number; working: string }>;
  /** Resumes spots paused for their daily cap. Run at each market's midnight. */
  resumeDailyCaps(): Promise<number>;
  /**
   * Relay viewers (added 2026-09-30, follow-up Phase 3): settles each airing's relay part per
   * platform as its numbers come in (online businesses) or YouTube's location data arrives (local
   * ones); not billed, or returned after `relays.location_wait`. Run every minute.
   */
  settleRelayViewers(): Promise<{ settled: number; notBilled: number; returned: number }>;
  /** What's still held for a business's relay viewers waiting for location data, per platform. */
  relayWaiting(businessId: string): Promise<Array<{ platform: "youtube" | "twitch"; heldMicros: number; airings: number }>>;
}

export interface BusinessInput {
  name: string;
  category: string;
  about?: string;
  website?: string;
  customersWhere: "location" | "service_area" | "online";
  locations: LocationInput[];
  marketIds: string[];
}

export type BusinessPatch = {
  name: string;
  category: string;
  about: string | null;
  website: string | null;
  logoUrl: string | null;
  customersWhere: "location" | "service_area" | "online";
  marketIds: string[];
  warnDays: number[];
  autoTopUp: { on: boolean; amountMicros: number | null; belowDays: number };
  receiptsEmail: string | null;
  legalName: string | null;
  ein: string | null;
  shortName: string | null;
  redeemOn: boolean;
};

export interface LocationInput {
  kind: "location" | "service_area";
  label?: string;
  streetAddress?: string;
  city: string;
  latitude: number;
  longitude: number;
  radiusMiles?: number;
}

export interface SpotInput {
  title: string;
  lengthSec: 15 | 30 | 60;
  category: string;
  rate: { kind: "per_thousand" | "per_airing"; micros: number; perAiringMaxMicros: number | null };
  budget: { totalMicros: number; dailyCapMicros: number | null };
  startsOn: string | null;
  endsOn: string | null;
  targeting: Partial<Targeting>;
  /** P4: without `code`, Opencast picks the letters. */
  code: { code?: string; offer: string; windowDays: number } | null;
}

export interface BreakAiring {
  airingId: string;
  spotId: string;
  title: string;
  /** The business, and its short name (P25). */
  business: string;
  shortName: string;
  lengthSec: number;
  /** The spot's file (its original) by content ID, which playout prepares for air; or a legacy path. */
  contentId: string | null;
  location: string | null;
  code: { code: string; offer: string } | null;
  carriageAgreementId: string | null;
  scheduledAt: Date;
}

export interface RotationView {
  kind: "main" | "backup";
  spots: Array<{ spotId: string; title: string; business: string; lengthSec: number; paused: boolean }>;
}

/** A spot's preview: the TV band's picture, or the radio band's sound for a spot with no picture. */
function spotBand(file: { widthPx?: number | null }): { mediaKind: "video" | "audio"; band: "tv" | "radio" } {
  return file.widthPx ? { mediaKind: "video", band: "tv" } : { mediaKind: "audio", band: "radio" };
}

const SP = schema.spotsTable;
const AD = schema.advertisers;
const AI = schema.airings;
/** Why a station whose break rule never airs spots is left out of a spot's stations (added 2026-09-29). */
const NO_SPOTS = "doesn't air spots";
const EMPTY_TARGETING: Targeting = { withinMiles: null, locationIds: [], marketIds: [], stationCategories: [], dayparts: [], excludedStationIds: [] };

export function createSpotsService(ctx: ModuleContext): SpotsService {
  const { deps, services } = ctx;
  const { db } = deps;

  async function businessRow(businessId: string) {
    const [row] = await db.select().from(AD).where(and(eq(AD.id, businessId), isNull(AD.closedAt)));
    if (!row) throw notFound("That business");
    return row;
  }

  async function spotRow(spotId: string) {
    const [row] = await db.select().from(SP).where(eq(SP.id, spotId));
    if (!row) throw notFound("That spot");
    return row;
  }

  async function businessView(row: typeof AD.$inferSelect): Promise<Business> {
    const [locations, markets] = await Promise.all([
      db.select().from(schema.advertiserLocations).where(eq(schema.advertiserLocations.advertiserId, row.id)).orderBy(asc(schema.advertiserLocations.createdAt)),
      db.select().from(schema.advertiserMarkets).where(eq(schema.advertiserMarkets.advertiserId, row.id))
    ]);
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      about: row.about,
      website: row.website,
      logoUrl: row.logoUrl,
      customersWhere: row.customersWhere,
      locations: locations.map((l) => ({
        id: l.id,
        kind: l.kind,
        label: l.label,
        streetAddress: l.streetAddress,
        city: l.city,
        latitude: l.latitude,
        longitude: l.longitude,
        radiusMiles: l.radiusMiles
      })),
      marketIds: markets.map((m) => m.marketId),
      warnDays: row.warnDays as number[],
      autoTopUp: { on: row.autoTopUp, amountMicros: row.autoTopUpMicros, belowDays: row.autoTopUpBelowDays },
      receiptsEmail: row.receiptsEmail,
      legalName: row.legalName,
      einLast4: row.einLast4,
      createdAt: row.createdAt.toISOString(),
      shortName: row.shortName ?? row.name,
      // P11: the square drawn until a logo is uploaded.
      logoMark: { initials: initialsOf(row.shortName ?? row.name), colour: colourFor(row.id) },
      // P12: on unless the business turned it off; online businesses start with it off.
      redeemOn: row.redeemOn ?? row.customersWhere !== "online"
    };
  }

  function targetingOf(row: typeof schema.targeting.$inferSelect | undefined): Targeting {
    return row
      ? {
          withinMiles: row.withinMiles,
          locationIds: row.locationIds,
          marketIds: [],
          stationCategories: row.stationCategories,
          dayparts: row.dayparts as Targeting["dayparts"],
          excludedStationIds: row.excludedStationIds,
          bands: row.bands ?? []
        }
      : { ...EMPTY_TARGETING, bands: [] };
  }

  async function rotationMembership(spotIds: string[]) {
    if (!spotIds.length) return new Map<string, Set<string>>();
    const rows = await db
      .select({ spotId: schema.rotationSpots.spotId, stationId: schema.rotations.stationId })
      .from(schema.rotationSpots)
      .innerJoin(schema.rotations, eq(schema.rotations.id, schema.rotationSpots.rotationId))
      .where(and(inArray(schema.rotationSpots.spotId, spotIds), isNull(schema.rotationSpots.removedAt), eq(schema.rotations.kind, "main")));
    const by = new Map<string, Set<string>>();
    for (const r of rows) by.set(r.spotId, (by.get(r.spotId) ?? new Set()).add(r.stationId));
    return by;
  }

  function stateOf(row: typeof SP.$inferSelect, inRotation: number): SpotState {
    switch (row.status) {
      case "paused":
        // A115: a spot the business paused itself waits for it.
        return row.pauseReason === "daily_cap"
          ? "paused_daily_cap"
          : row.pauseReason === "budget_spent"
            ? "paused_budget"
            : row.pauseReason === "by_hand"
              ? "waiting_for_you"
              : "paused_balance";
      case "listed":
        return inRotation > 0 ? "in_rotation" : "listed";
      default:
        return row.status;
    }
  }

  async function dayStartFor(businessId: string) {
    // Midnight where the business is; its first market's time zone, or Los Angeles.
    const [market] = await db.select().from(schema.advertiserMarkets).where(eq(schema.advertiserMarkets.advertiserId, businessId)).limit(1);
    const tz = market ? ((await services.network.marketsByIds([market.marketId])).get(market.marketId)?.timezone ?? "America/Los_Angeles") : "America/Los_Angeles";
    return localDay(localDate(deps.clock.now(), tz), tz).from;
  }

  async function spotViews(rows: Array<typeof SP.$inferSelect>): Promise<Spot[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [targeting, codes, files, rotation, markets] = await Promise.all([
      db.select().from(schema.targeting).where(inArray(schema.targeting.spotId, ids)),
      db.select().from(schema.codes).where(inArray(schema.codes.spotId, ids)),
      db.select().from(schema.spotFiles).where(and(inArray(schema.spotFiles.spotId, ids), eq(schema.spotFiles.current, true))),
      rotationMembership(ids),
      db.select().from(schema.advertiserMarkets).where(inArray(schema.advertiserMarkets.advertiserId, rows.map((r) => r.advertiserId)))
    ]);
    const checks = files.length ? await db.select().from(schema.uploadChecks).where(inArray(schema.uploadChecks.spotFileId, files.map((f) => f.id))) : [];
    const now = deps.clock.now();
    const [spend, week, stories, lastAired] = await Promise.all([
      services.ledger.spotSpend(ids, await dayStartFor(rows[0].advertiserId)),
      // P7: spent over the last 7 days (held and settled), for the pace.
      services.ledger.spotSpend(ids, new Date(now.getTime() - 7 * 86_400_000)),
      businessStories(rows),
      latestProofFrames(ids)
    ]);
    const stationIdents = await services.stations.idents([...new Set([...rotation.values()].flatMap((set) => [...set]))]);
    const content = services.library.content;
    // Previews play the spot's prepared segments (TV's 360p, or the 64k sound of a spot with no
    // picture). A spot in review has its preparation asked for; any other shows its preview once it's prepared.
    const previews = await services.playout.previews(
      files.map((f) => ({ contentId: f.contentId, ...spotBand(f) })),
      { prepare: false }
    );
    const inReview = new Set(rows.filter((r) => r.status === "in_review").map((r) => r.id));
    const reviewPreviews = inReview.size
      ? await services.playout.previews(files.filter((f) => inReview.has(f.spotId)).map((f) => ({ contentId: f.contentId, durationMs: f.durationMs, ...spotBand(f) })), { prepare: true })
      : new Map();
    const previewOf = (f: (typeof files)[number]) => (f.contentId ? (reviewPreviews.get(f.contentId) ?? previews.get(f.contentId) ?? null) : null);
    const urls = new Map(await Promise.all(files.map(async (f) => [f.id, { url: f.contentId ? await content.url(f.contentId) : (f.location ?? ""), preview: previewOf(f) }] as const)));
    return rows.map((r) => {
      const file = files.find((f) => f.spotId === r.id);
      const code = codes.find((c) => c.spotId === r.id);
      const inRotationOn = rotation.get(r.id)?.size ?? 0;
      const t = targetingOf(targeting.find((x) => x.spotId === r.id));
      t.marketIds = markets.filter((m) => m.advertiserId === r.advertiserId).map((m) => m.marketId);
      const used = spend.get(r.id)?.used ?? 0;
      const days = r.listedAt ? Math.min(7, Math.max(1, Math.ceil((now.getTime() - r.listedAt.getTime()) / 86_400_000))) : 7;
      const story = stories.get(r.id);
      return {
        id: r.id,
        businessId: r.advertiserId,
        title: r.title,
        lengthSec: r.lengthSec as 15 | 30 | 60,
        category: r.category,
        state: stateOf(r, inRotationOn),
        inRotationOn,
        rate: { kind: r.rateKind, micros: r.rateMicros, perAiringMaxMicros: r.perAiringMaxMicros },
        budget: {
          totalMicros: r.totalBudgetMicros,
          dailyCapMicros: r.dailyCapMicros,
          usedMicros: spend.get(r.id)?.used ?? 0,
          usedTodayMicros: spend.get(r.id)?.usedToday ?? 0
        },
        startsOn: r.startsOn,
        endsOn: r.endsOn,
        targeting: t,
        code: code
          ? {
              code: code.code,
              offer: code.offer,
              windowDays: code.windowDays,
              pickedBy: code.pickedBy,
              oncePerCustomer: true,
              savedForDays: code.windowDays,
              placement: CODE_PLACEMENT.placement,
              showsForLastMs: CODE_PLACEMENT.lastMs
            }
          : null,
        file: file
          ? {
              url: urls.get(file.id)?.url ?? "",
              previewUrl: urls.get(file.id)?.preview?.url ?? null,
              previewStatus: urls.get(file.id)?.preview?.status ?? null,
              durationMs: file.durationMs,
              originalFilename: file.originalFilename,
              checks: checks
                .filter((c) => c.spotFileId === file.id)
                .map((c) => {
                  const detail = (c.detail as Record<string, unknown>) ?? null;
                  // Checks that need a person (title safe, captions) are stored as "for you" and shown as pending.
                  const result = detail?.pending ? ("pending" as const) : c.result;
                  return { check: c.check, result, label: checkLabel(c.check, result, detail), detail };
                })
            }
          : null,
        productionOrderId: r.productionOrderId,
        createdAt: r.createdAt.toISOString(),
        still: { stillUrl: lastAired.get(r.id) ?? null, colour: colourFor(r.advertiserId), label: r.title, headline: null, line: code?.offer ?? null },
        inRotationStations: [...(rotation.get(r.id) ?? [])].flatMap((id) => {
          const ident = stationIdents.get(id);
          return ident ? [ident] : [];
        }),
        pause: story?.pause ?? null,
        back: story?.back ?? null,
        pacePerDayMicros: used > 0 ? Math.round((week.get(r.id)?.usedToday ?? 0) / days) : null
      };
    });
  }

  /** P23: each spot's latest proof frame, from the as-run log of its airings. */
  async function latestProofFrames(spotIds: string[]) {
    const result = new Map<string, string>();
    if (!spotIds.length) return result;
    const latest = await db
      .selectDistinctOn([AI.spotId], { id: AI.id, spotId: AI.spotId })
      .from(AI)
      .where(and(inArray(AI.spotId, spotIds), lt(AI.scheduledAt, deps.clock.now())))
      .orderBy(AI.spotId, desc(AI.scheduledAt));
    const runs = await services.playout.asRunForAirings(latest.map((a) => a.id));
    for (const a of latest) {
      const url = runs.get(a.id)?.proofFrameUrl;
      if (url) result.set(a.spotId, url);
    }
    return result;
  }

  /**
   * P6: the business's side of a pause (while paused for its budget, its balance or by hand) and
   * of the comeback after one.
   */
  async function businessStories(rows: Array<typeof SP.$inferSelect>) {
    const result = new Map<string, { pause: NonNullable<Spot["pause"]> | null; back: NonNullable<Spot["back"]> | null }>();
    const now = deps.clock.now();
    for (const row of rows) {
      const paused = row.status === "paused" && row.pauseReason !== "daily_cap" && row.pausedAt;
      const back = row.status === "listed" && row.resumedAt && row.resumeReason && row.resumeReason !== "midnight";
      if (!paused && !back) continue;
      const pausedAt = paused ? row.pausedAt! : row.lastPausedAt;
      if (back && !pausedAt) {
        result.set(row.id, { pause: null, back: { backAt: row.resumedAt!.toISOString(), reason: backReason(row.resumeReason!), told: [] } });
        continue;
      }
      // Who had it in their rotation when it paused (and, once back, who was told).
      const had = await db
        .select({ stationId: schema.rotations.stationId, removedAt: schema.rotationSpots.removedAt })
        .from(schema.rotationSpots)
        .innerJoin(schema.rotations, eq(schema.rotations.id, schema.rotationSpots.rotationId))
        .where(
          and(
            eq(schema.rotationSpots.spotId, row.id),
            eq(schema.rotations.kind, "main"),
            lte(schema.rotationSpots.addedAt, pausedAt!),
            or(isNull(schema.rotationSpots.removedAt), gte(schema.rotationSpots.removedAt, pausedAt!))
          )
        );
      const stationIds = [...new Set(had.map((h) => h.stationId))];
      const told = new Set(back ? had.filter((h) => h.removedAt && h.removedAt.getTime() === row.resumedAt!.getTime()).map((h) => h.stationId) : []);
      const idents = await services.stations.idents(stationIds);
      if (back) {
        result.set(row.id, {
          pause: null,
          back: { backAt: row.resumedAt!.toISOString(), reason: backReason(row.resumeReason!), told: stationIds.filter((id) => told.has(id)).flatMap((id) => (idents.get(id) ? [idents.get(id)!] : [])) }
        });
        continue;
      }
      const at = row.pausedAt!;
      // The last money held before the pause, and the held airings that still air.
      const [lastHold] = await db.select().from(AI).where(and(eq(AI.spotId, row.id), lte(AI.createdAt, at))).orderBy(desc(AI.createdAt)).limit(1);
      const held = await db.select().from(AI).where(and(eq(AI.spotId, row.id), lte(AI.createdAt, at), gte(AI.scheduledAt, at)));
      const [amounts, runs] = await Promise.all([
        services.ledger.holdAmounts(lastHold ? [lastHold.holdId] : []),
        services.playout.asRunForAirings(held.map((a) => a.id))
      ]);
      const lastStation = lastHold ? (await services.stations.idents([lastHold.stationId])).get(lastHold.stationId) : undefined;
      const allAired = held.length > 0 && held.every((a) => runs.has(a.id));
      const stations = [];
      for (const stationId of stationIds) {
        const ident = idents.get(stationId);
        if (!ident) continue;
        // What the station aired in its place since: its backup rotation, another spot, or station ID and bumpers.
        const aired = await services.playout.asRun(stationId, at, now);
        const others = aired.filter((a) => a.airingId && !held.some((h) => h.id === a.airingId));
        const filledWith = others.some((a) => a.reason === "backup_rotation") ? ("backup_rotation" as const) : others.some((a) => a.reason === "rotation") ? ("another_spot" as const) : ("station_id" as const);
        stations.push({ station: ident, filledWith, toldWhenBack: false });
      }
      result.set(row.id, {
        pause: {
          reason: row.pauseReason === "by_hand" ? "by_you" : row.pauseReason === "budget_spent" ? "budget_spent" : "balance",
          pausedAt: at.toISOString(),
          lastHold: lastHold && lastStation ? { amountMicros: amounts.get(lastHold.holdId) ?? 0, station: lastStation } : null,
          held: { airings: held.length, airedAt: allAired ? new Date(Math.max(...held.map((a) => runs.get(a.id)!.endedAt.getTime()))).toISOString() : null },
          stations
        },
        back: null
      });
    }
    return result;
  }

  /** A spot's targeting, with its business's markets (what matching needs, without the rest of the view). */
  async function targetingFor(row: typeof SP.$inferSelect): Promise<Targeting> {
    const [[t], markets] = await Promise.all([
      db.select().from(schema.targeting).where(eq(schema.targeting.spotId, row.id)),
      db.select().from(schema.advertiserMarkets).where(eq(schema.advertiserMarkets.advertiserId, row.advertiserId))
    ]);
    return { ...targetingOf(t), marketIds: markets.map((m) => m.marketId) };
  }

  async function saveTargeting(tx: Executor, spotId: string, t: Partial<Targeting>) {
    const values = {
      spotId,
      withinMiles: t.withinMiles ?? null,
      locationIds: t.locationIds ?? [],
      stationCategories: t.stationCategories ?? [],
      dayparts: t.dayparts ?? [],
      excludedStationIds: t.excludedStationIds ?? [],
      bands: t.bands?.length ? [...new Set(t.bands)] : null
    };
    await tx.insert(schema.targeting).values(values).onConflictDoUpdate({ target: schema.targeting.spotId, set: values });
  }

  /**
   * P4: the letters Opencast picks for a spot's code: the business's first word and a number,
   * unused by any other code ("ORANGE10", "ORANGE11").
   */
  async function pickCode(tx: Executor, businessId: string): Promise<string> {
    const [business] = await tx.select({ name: AD.name, shortName: AD.shortName }).from(AD).where(eq(AD.id, businessId));
    const word = (business?.shortName ?? business?.name ?? "").split(/\s+/)[0] ?? "";
    const base = word.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "SPOT";
    const taken = new Set((await tx.select({ code: schema.codes.code }).from(schema.codes).where(sql`${schema.codes.code} like ${`${base}%`}`)).map((c) => c.code));
    for (let n = 10; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
  }

  async function saveCode(tx: Executor, spotId: string, code: SpotInput["code"]) {
    const [current] = await tx.select().from(schema.codes).where(eq(schema.codes.spotId, spotId));
    await tx.delete(schema.codes).where(and(eq(schema.codes.spotId, spotId), sql`not exists (select 1 from spots.code_events e where e.code_id = ${schema.codes.id})`));
    if (!code) return;
    const [spot] = await tx.select({ advertiserId: SP.advertiserId }).from(SP).where(eq(SP.id, spotId));
    // Letters the business typed are its own; without them the spot keeps Opencast's, or gets new ones.
    const letters = code.code ?? current?.code ?? (await pickCode(tx, spot.advertiserId));
    const pickedBy = code.code && code.code !== current?.code ? "business" : (current?.pickedBy ?? (code.code ? "business" : "opencast"));
    await tx
      .insert(schema.codes)
      .values({ spotId, code: letters, offer: code.offer, windowDays: code.windowDays, pickedBy })
      .onConflictDoUpdate({ target: schema.codes.spotId, set: { code: letters, offer: code.offer, windowDays: code.windowDays, pickedBy } });
  }

  /** Which stations a spot's targeting reaches, with the reason any nearby one is left out. */
  async function match(row: typeof SP.$inferSelect, targeting: Targeting): Promise<Array<TargetMatch & { stationId: string }>> {
    const business = await businessView(await businessRow(row.advertiserId));
    const allLocations = business.locations;
    const locations = targeting.locationIds.length ? allLocations.filter((l) => targeting.locationIds.includes(l.id)) : allLocations;
    let candidates;
    if (business.customersWhere === "online") {
      candidates = await services.stations.inMarkets(targeting.marketIds.length ? targeting.marketIds : business.marketIds);
    } else {
      const markets = await services.network.allMarkets();
      candidates = await services.stations.inMarkets(markets.map((m) => m.id));
    }
    const [typical, noSpots] = await Promise.all([
      services.audience.typicalTunedIn(candidates.map((c) => c.id), deps.clock.now()),
      // Stations whose breaks never air spots (their break rule, added 2026-09-29) aren't promised.
      services.stations.withoutSpots(candidates.map((c) => c.id))
    ]);
    const reach = targeting.withinMiles ?? null;
    const results: Array<TargetMatch & { stationId: string }> = [];
    for (const station of candidates) {
      if (station.kind === "studio" || station.kind === "listed" || station.status === "signed_off") continue;
      const distance =
        business.customersWhere === "online" || !station.location
          ? null
          : Math.min(...locations.map((l) => miles({ lat: l.latitude, lng: l.longitude }, station.location!)));
      const limit = business.customersWhere === "service_area" ? Math.max(reach ?? 0, ...locations.map((l) => l.radiusMiles ?? 0)) : reach;
      let reason: string | null = null;
      let included = true;
      if (business.customersWhere !== "online" && limit !== null && distance !== null && distance > limit) {
        if (distance > limit * 2) continue; // Not nearby: don't list it at all.
        included = false;
        reason = `${Math.round(distance)} miles away`;
      }
      if (targeting.excludedStationIds.includes(station.id)) {
        included = false;
        reason = "not chosen";
      } else if (targeting.bands?.length && station.ident.band && !targeting.bands.includes(station.ident.band)) {
        // P8: "Radio band, not chosen".
        included = false;
        reason = `${station.ident.band === "radio" ? "Radio" : "TV"} band, not chosen`;
      } else if (targeting.stationCategories.length && (!station.category || !targeting.stationCategories.includes(station.category))) {
        included = false;
        reason = reason ?? "not chosen";
      }
      if (station.blockedCategories.map((c) => c.toLowerCase()).includes(row.category.toLowerCase())) {
        included = false;
        reason = "doesn't carry this category";
      }
      if (noSpots.has(station.id)) {
        included = false;
        reason = NO_SPOTS;
      }
      if (included && !station.public) {
        reason = "Not on air yet";
      }
      const tunedIn = typical.get(station.id) ?? 0;
      const estimate =
        row.rateKind === "per_airing"
          ? { low: row.rateMicros, high: row.rateMicros }
          : tunedIn > 0
            ? {
                low: Math.round((tunedIn * 0.7 * row.rateMicros) / 1000),
                high: Math.min(Math.round((tunedIn * 1.3 * row.rateMicros) / 1000), row.perAiringMaxMicros ?? Number.MAX_SAFE_INTEGER)
              }
            : null;
      results.push({
        stationId: station.id,
        station: station.ident,
        category: station.category,
        miles: distance === null ? null : Math.round(distance * 10) / 10,
        included,
        reason,
        estimatedCostPerAiringMicros: estimate
      });
    }
    return results.sort((a, b) => Number(b.included) - Number(a.included) || (a.miles ?? 0) - (b.miles ?? 0));
  }

  async function setStatus(spotId: string, patch: Partial<typeof SP.$inferInsert>) {
    await db.update(SP).set(patch).where(eq(SP.id, spotId));
  }

  async function pauseFor(row: typeof SP.$inferSelect, reason: "daily_cap" | "budget_spent" | "balance" | "by_hand") {
    if (row.status !== "listed") return;
    const now = deps.clock.now();
    // P6: the story is kept past the resume.
    await setStatus(row.id, { status: "paused", pauseReason: reason, pausedAt: now, lastPauseReason: reason, lastPausedAt: now, resumedAt: null, resumeReason: null });
    const stationIds = [...((await rotationMembership([row.id])).get(row.id) ?? [])];
    deps.bus.emit("spot.paused", { spotId: row.id, businessId: row.advertiserId, reason, stationIds });
  }

  async function resumeRow(row: typeof SP.$inferSelect, reason: "raised_budget" | "added_money" | "by_hand") {
    const now = deps.clock.now();
    await setStatus(row.id, { status: "listed", pauseReason: null, pausedAt: null, resumedAt: now, resumeReason: reason });
    const stationIds = [...((await rotationMembership([row.id])).get(row.id) ?? [])];
    // Stations are told it's back; it's never put back in a rotation by itself.
    await db
      .update(schema.rotationSpots)
      .set({ removedAt: now })
      .where(and(eq(schema.rotationSpots.spotId, row.id), isNull(schema.rotationSpots.removedAt)));
    deps.bus.emit("spot.resumed", { spotId: row.id, businessId: row.advertiserId, stationIds });
  }

  /**
   * P6: why each paused spot paused, as this station sees it, and why a resumed one is back (when
   * the station had it in its rotation before). Daily-cap pauses tell no one.
   */
  async function pauseStories(stationId: string, rows: Array<typeof SP.$inferSelect>) {
    const stories = new Map<string, { pause: MarketSpot["pause"]; back: MarketSpot["back"] }>();
    const now = deps.clock.now();
    const tz = await services.stations.timezoneOf(stationId);
    for (const row of rows) {
      if (row.status === "paused" && row.pausedAt && (row.pauseReason === "budget_spent" || row.pauseReason === "balance")) {
        const endOfDay = localDay(localDate(row.pausedAt, tz), tz).to;
        const [held] = await db
          .select({ ms: sql<number>`coalesce(sum(${SP.lengthSec}), 0)::int * 1000` })
          .from(AI)
          .innerJoin(SP, eq(SP.id, AI.spotId))
          .where(and(eq(AI.spotId, row.id), eq(AI.stationId, stationId), gte(AI.scheduledAt, row.pausedAt), lt(AI.scheduledAt, endOfDay)));
        // What the backup rotation aired here since.
        const backups = (await services.playout.asRun(stationId, row.pausedAt, now)).filter((r) => r.reason === "backup_rotation" && r.airingId);
        const spotIds = backups.length
          ? (await db.select({ spotId: AI.spotId }).from(AI).where(inArray(AI.id, backups.map((b) => b.airingId!)))).map((a) => a.spotId)
          : [];
        const owners = spotIds.length ? await db.select({ advertiserId: SP.advertiserId }).from(SP).where(inArray(SP.id, [...new Set(spotIds)])) : [];
        const names = await service.businessNames(owners.map((o) => o.advertiserId));
        stories.set(row.id, { pause: { reason: row.pauseReason, pausedAt: row.pausedAt.toISOString(), heldTonightMs: held?.ms ?? 0, filledBy: [...new Set(names.values())] }, back: null });
      } else if (row.status === "listed" && row.resumedAt && (row.resumeReason === "raised_budget" || row.resumeReason === "added_money")) {
        // Back, and this station had it in its rotation when it came back.
        const [had] = await db
          .select({ id: schema.rotationSpots.id })
          .from(schema.rotationSpots)
          .innerJoin(schema.rotations, eq(schema.rotations.id, schema.rotationSpots.rotationId))
          .where(and(eq(schema.rotationSpots.spotId, row.id), eq(schema.rotations.stationId, stationId), eq(schema.rotationSpots.removedAt, row.resumedAt)))
          .limit(1);
        if (had) stories.set(row.id, { pause: null, back: { reason: row.resumeReason, backAt: row.resumedAt.toISOString() } });
      }
    }
    return stories;
  }

  const relay = createRelayViewers(ctx);

  const parts = {
    sponsorships: createSponsorships(ctx),
    catalogSponsors: createCatalogSponsors(ctx),
    orders: createOrders(ctx, {
      createSpotFromOrder: async (input) => {
        const [row] = await db
          .insert(SP)
          .values({
            advertiserId: input.businessId,
            title: input.title,
            lengthSec: input.lengthSec,
            category: input.category,
            status: "draft",
            rateKind: "per_airing",
            rateMicros: 1,
            totalBudgetMicros: 1,
            productionOrderId: input.orderId
          })
          .returning();
        if (input.file) {
          const [saved] = await db.insert(schema.spotFiles).values({ spotId: row.id, version: 1, contentId: input.file.contentId, durationMs: input.file.durationMs, originalFilename: input.file.filename, current: true }).returning();
          await services.library.content.addRef(db, input.file.contentId, "spot_file", saved.id);
        }
        return row.id;
      }
    }),
    codes: createCodes(ctx),
    business: createBusinessPart(ctx)
  };

  const service: SpotsService = {
    ...parts.sponsorships,
    ...parts.catalogSponsors,
    ...parts.orders,
    ...parts.codes,
    ...parts.business,

    // Catalog sponsors (added 2026-09-29): on the month's roll, last month's Clear-filled slots are
    // recorded, and markets whose catalog credit changed (a month held, one lapsed) plan again.
    async rollSponsorships() {
      const SS = schema.sponsorships;
      const before = await db.select({ id: SS.id, status: SS.status, marketId: SS.marketId }).from(SS).where(sql`${SS.marketId} is not null`);
      const result = await parts.sponsorships.rollSponsorships();
      const previous = new Date(Date.parse(catalogMonthOf(deps.clock.now())) - 86_400_000);
      await parts.catalogSponsors.recordHouseCredits(catalogMonthOf(previous)).catch((error) => console.error("[spots] recording Clear-filled slots failed", error));
      if (before.length) await parts.catalogSponsors.replanMarkets(before.flatMap((r) => (r.status === "approved" && r.marketId ? [r.marketId] : [])));
      return result;
    },

    async businessNames(ids) {
      const unique = [...new Set(ids)];
      if (!unique.length) return new Map();
      const rows = await db.select({ id: AD.id, name: AD.name }).from(AD).where(inArray(AD.id, unique));
      return new Map(rows.map((r) => [r.id, r.name]));
    },

    async filledMsByBreak(breakIds) {
      if (!breakIds.length) return new Map();
      const rows = await db
        .select({ breakId: AI.breakId, ms: sql<number>`sum(${SP.lengthSec} * 1000)::int` })
        .from(AI)
        .innerJoin(SP, eq(SP.id, AI.spotId))
        .where(inArray(AI.breakId, breakIds))
        .groupBy(AI.breakId);
      return new Map(rows.map((r) => [r.breakId, r.ms]));
    },

    async receiptsKey(businessId) {
      const [row] = await db.select({ key: AD.receiptsKey }).from(AD).where(eq(AD.id, businessId));
      if (!row) throw notFound("That business");
      if (row.key) return row.key;
      const key = (await import("node:crypto")).randomBytes(24).toString("base64url");
      await db.update(AD).set({ receiptsKey: key }).where(and(eq(AD.id, businessId), isNull(AD.receiptsKey)));
      const [again] = await db.select({ key: AD.receiptsKey }).from(AD).where(eq(AD.id, businessId));
      return again.key!;
    },

    async businessForBooks(businessId) {
      const [row] = await db.select({ name: AD.name, legalName: AD.legalName, einLast4: AD.einLast4 }).from(AD).where(eq(AD.id, businessId));
      if (!row) throw notFound("That business");
      return row;
    },

    async airingCostBasis(businessId) {
      const rows = await db.select().from(SP).where(and(eq(SP.advertiserId, businessId), inArray(SP.status, ["listed", "paused"]))).orderBy(asc(SP.createdAt));
      if (!rows.length) return null;
      const flat = rows.filter((r) => r.rateKind === "per_airing");
      if (flat.length) return { rateKind: "per_airing", rateMicros: Math.round(flat.reduce((a, r) => a + r.rateMicros, 0) / flat.length), stationId: null };
      const [last] = await db.select({ stationId: AI.stationId }).from(AI).where(eq(AI.spotId, rows[0].id)).orderBy(desc(AI.scheduledAt)).limit(1);
      return { rateKind: "per_thousand", rateMicros: rows[0].rateMicros, stationId: last?.stationId ?? null };
    },

    async spotSummary(spotId) {
      const row = await spotRow(spotId);
      const business = (await service.businessNames([row.advertiserId])).get(row.advertiserId) ?? "";
      return { title: row.title, business };
    },

    async reviewBalance(businessId, toppedUp = false) {
      const rows = await db.select().from(SP).where(and(eq(SP.advertiserId, businessId), inArray(SP.status, ["listed", "paused"])));
      if (!rows.length) return;
      const { availableMicros } = await services.ledger.balance(businessId);
      for (const row of rows) {
        const needed = oneDayOfBudgetMicros({ totalBudgetMicros: row.totalBudgetMicros, dailyCapMicros: row.dailyCapMicros, startsOn: row.startsOn, endsOn: row.endsOn });
        if (row.status === "listed" && availableMicros < needed) await pauseFor(row, "balance");
        // Only a top-up brings a spot back: money returning from a hold isn't one, and would flap it.
        else if (toppedUp && row.status === "paused" && row.pauseReason === "balance" && availableMicros >= needed) await resumeRow(row, "added_money");
      }
    },

    async typicalAiringCost(businessId) {
      const rows = await db.select().from(SP).where(and(eq(SP.advertiserId, businessId), inArray(SP.status, ["listed", "paused"])));
      if (!rows.length) return null;
      const perAiring = rows.filter((r) => r.rateKind === "per_airing").map((r) => r.rateMicros);
      if (perAiring.length) return Math.round(perAiring.reduce((a, b) => a + b, 0) / perAiring.length);
      // Per thousand: a typical 262 tuned in, as the funding page illustrates, until there's history.
      return Math.round((262 * rows[0].rateMicros) / 1000);
    },

    async heldAirings(stationId, from, to) {
      const rows = await db
        .select({ airingId: AI.id, holdId: AI.holdId, scheduledAt: AI.scheduledAt, breakId: AI.breakId })
        .from(AI)
        .where(and(eq(AI.stationId, stationId), gte(AI.scheduledAt, from), lt(AI.scheduledAt, to)));
      const open = await services.ledger.openAmount(rows.map((r) => r.holdId));
      return rows.filter((r) => (open.get(r.holdId) ?? 0) > 0);
    },

    async businessesAiredOn(stationId, from, to) {
      const [row] = await db
        .select({ n: sql<number>`count(distinct ${SP.advertiserId})::int` })
        .from(AI)
        .innerJoin(SP, eq(SP.id, AI.spotId))
        .where(and(eq(AI.stationId, stationId), gte(AI.scheduledAt, from), lt(AI.scheduledAt, to)));
      return row.n;
    },

    async businessOfSpot(spotId) {
      return (await spotRow(spotId)).advertiserId;
    },

    async moneySettings(businessId) {
      const [row] = await db.select().from(AD).where(eq(AD.id, businessId));
      return row
        ? { warnDays: row.warnDays as number[], autoTopUp: row.autoTopUp, autoTopUpMicros: row.autoTopUpMicros, autoTopUpBelowDays: row.autoTopUpBelowDays, createdAt: row.createdAt }
        : null;
    },

    async heldAiringsForSpot(spotId, from) {
      const rows = await db.select().from(AI).where(and(eq(AI.spotId, spotId), gte(AI.scheduledAt, from))).orderBy(asc(AI.scheduledAt));
      const [open, idents] = await Promise.all([services.ledger.openAmount(rows.map((r) => r.holdId)), services.stations.idents(rows.map((r) => r.stationId))]);
      return rows.flatMap((r) => {
        const station = idents.get(r.stationId);
        const heldMicros = open.get(r.holdId) ?? 0;
        return station && heldMicros > 0 ? [{ airingId: r.id, station, scheduledAt: r.scheduledAt.toISOString(), heldMicros }] : [];
      });
    },

    async createBusiness(user, input) {
      if (input.customersWhere !== "online" && !input.locations.length) throw badRequest("Add where your customers are.", { locations: "Required" });
      if (input.customersWhere === "online" && !input.marketIds.length) throw badRequest("Choose the markets you serve.", { marketIds: "Required" });
      const businessId = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(AD)
          .values({ name: input.name, category: input.category, about: input.about ?? null, website: input.website ?? null, customersWhere: input.customersWhere })
          .returning();
        await services.accounts.addBusinessMember(tx, row.id, user.id, "owner");
        for (const location of input.locations) {
          await tx.insert(schema.advertiserLocations).values({ advertiserId: row.id, ...location, label: location.label ?? null, streetAddress: location.streetAddress ?? null, radiusMiles: location.radiusMiles ?? null });
        }
        if (input.marketIds.length) await tx.insert(schema.advertiserMarkets).values(input.marketIds.map((marketId) => ({ advertiserId: row.id, marketId })));
        await services.ledger.account(tx, "advertiser_available", { advertiserId: row.id });
        return row.id;
      });
      return service.business(businessId);
    },

    async business(businessId) {
      return businessView(await businessRow(businessId));
    },

    async updateBusiness(businessId, input) {
      await businessRow(businessId);
      await db.transaction(async (tx) => {
        const patch: Partial<typeof AD.$inferInsert> = {};
        for (const key of ["name", "category", "about", "website", "logoUrl", "customersWhere", "warnDays", "receiptsEmail", "legalName", "shortName", "redeemOn"] as const) {
          if (input[key] !== undefined) (patch as Record<string, unknown>)[key] = input[key];
        }
        if (input.autoTopUp) {
          patch.autoTopUp = input.autoTopUp.on;
          patch.autoTopUpMicros = input.autoTopUp.amountMicros;
          patch.autoTopUpBelowDays = input.autoTopUp.belowDays;
        }
        // Only the last four digits stay here.
        if (input.ein !== undefined) patch.einLast4 = input.ein ? input.ein.replace(/\D/g, "").slice(-4) : null;
        if (Object.keys(patch).length) await tx.update(AD).set(patch).where(eq(AD.id, businessId));
        if (input.marketIds) {
          await tx.delete(schema.advertiserMarkets).where(eq(schema.advertiserMarkets.advertiserId, businessId));
          if (input.marketIds.length) await tx.insert(schema.advertiserMarkets).values(input.marketIds.map((marketId) => ({ advertiserId: businessId, marketId })));
        }
      });
      return service.business(businessId);
    },

    async addLocation(businessId, input) {
      await businessRow(businessId);
      await db.insert(schema.advertiserLocations).values({ advertiserId: businessId, ...input, label: input.label ?? null, streetAddress: input.streetAddress ?? null, radiusMiles: input.radiusMiles ?? null });
      return service.business(businessId);
    },

    async removeLocation(businessId, locationId) {
      await db
        .delete(schema.advertiserLocations)
        .where(and(eq(schema.advertiserLocations.id, locationId), eq(schema.advertiserLocations.advertiserId, businessId)));
      return service.business(businessId);
    },

    async spots(businessId) {
      const rows = await db.select().from(SP).where(eq(SP.advertiserId, businessId)).orderBy(desc(SP.createdAt));
      return spotViews(rows);
    },

    async spot(spotId) {
      return (await spotViews([await spotRow(spotId)]))[0];
    },

    async createSpot(businessId, input) {
      await businessRow(businessId);
      const spotId = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(SP)
          .values({
            advertiserId: businessId,
            title: input.title,
            lengthSec: input.lengthSec,
            category: input.category,
            status: "draft",
            rateKind: input.rate.kind,
            rateMicros: input.rate.micros,
            perAiringMaxMicros: input.rate.perAiringMaxMicros,
            totalBudgetMicros: input.budget.totalMicros,
            dailyCapMicros: input.budget.dailyCapMicros,
            startsOn: input.startsOn,
            endsOn: input.endsOn
          })
          .returning();
        await saveTargeting(tx, row.id, input.targeting);
        await saveCode(tx, row.id, input.code);
        return row.id;
      });
      return service.spot(spotId);
    },

    async updateSpot(spotId, input) {
      const row = await spotRow(spotId);
      if (row.status === "ended") throw refused("ended", "An ended spot can't change. Make a new one.");
      await db.transaction(async (tx) => {
        const patch: Partial<typeof SP.$inferInsert> = {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.rate) {
          patch.rateKind = input.rate.kind;
          patch.rateMicros = input.rate.micros;
          patch.perAiringMaxMicros = input.rate.perAiringMaxMicros;
        }
        if (input.budget) {
          patch.totalBudgetMicros = input.budget.totalMicros;
          patch.dailyCapMicros = input.budget.dailyCapMicros;
        }
        if (input.startsOn !== undefined) patch.startsOn = input.startsOn;
        if (input.endsOn !== undefined) patch.endsOn = input.endsOn;
        if (Object.keys(patch).length) await tx.update(SP).set(patch).where(eq(SP.id, spotId));
        if (input.targeting) await saveTargeting(tx, spotId, { ...targetingOf((await tx.select().from(schema.targeting).where(eq(schema.targeting.spotId, spotId)))[0]), ...input.targeting });
        if (input.code !== undefined) await saveCode(tx, spotId, input.code);
      });
      // Raising the budget uses money already available; a spot paused for its budget comes back.
      const updated = await spotRow(spotId);
      if (updated.status === "paused" && updated.pauseReason === "budget_spent") {
        const spent = (await services.ledger.spotSpend([spotId], new Date(0))).get(spotId)?.used ?? 0;
        if (spent < updated.totalBudgetMicros) await resumeRow(updated, "raised_budget");
      }
      return service.spot(spotId);
    },

    async uploadSpotFile(spotId, file, scaleToFit) {
      if (!file) throw badRequest("Choose the spot's file.", { file: "Required" });
      const row = await spotRow(spotId);
      const probe = await deps.media.probe(file.path).catch(() => null);
      if (!probe?.durationMs) throw refused("unreadable_file", "That file can't be read as video or audio.");
      const durationMs = probe.durationMs;
      const loudness = await deps.media.loudness(file.path).catch(() => null);
      // The original, kept as it came, by content ID in Infrequent Access (the same spot uploaded
      // twice is stored once). Playout prepares it for air from this original, once; the checks
      // below read it too.
      const stored = await services.library.content.store(file.path, { storageClass: "infrequent", contentType: file.mimeType || undefined });
      // P4: every spot gets its own code as it's checked: Opencast's letters, and its title as the
      // offer until the business names one (nothing is promised for it).
      if (!(await db.select({ id: schema.codes.id }).from(schema.codes).where(eq(schema.codes.spotId, spotId))).length) {
        await db.transaction((tx) => saveCode(tx, spotId, { offer: row.title.slice(0, 80), windowDays: 7 }));
      }
      const code = (await db.select().from(schema.codes).where(eq(schema.codes.spotId, spotId)))[0];

      // The checks on arrival.
      const lengthOff = Math.abs(durationMs - row.lengthSec * 1000);
      // P1: each check's detail carries its second line (`note`), and the code's box and timing (P4).
      const pictureResult = probe.mediaKind === "audio" ? "for_you" : probe.width === 1920 && probe.height === 1080 ? "fine" : probe.width && probe.height && probe.width / probe.height > 1.7 ? "fixed" : "for_you";
      const loudnessResult = loudness === null ? "pending" : Math.abs(loudness + 24) <= 2 ? "fine" : "fixed";
      const checks: Array<{ check: "length" | "picture" | "safe_area" | "captions" | "loudness" | "code"; result: "fine" | "fixed" | "for_you" | "pending"; detail: Record<string, unknown> }> = [
        {
          check: "length",
          result: lengthOff <= 100 ? "fine" : "for_you",
          detail: { durationMs: probe.durationMs, expectedSec: row.lengthSec, note: lengthOff <= 100 ? `Exactly a :${row.lengthSec} spot` : `It has to be exactly :${row.lengthSec}. Upload a new cut` }
        },
        {
          check: "picture",
          result: pictureResult,
          detail: {
            width: probe.width,
            height: probe.height,
            note: pictureResult === "fine" ? "Airs full screen on TV and web" : pictureResult === "fixed" ? "Scaled to 1920 by 1080 to air full screen" : "A spot needs a widescreen picture"
          }
        },
        // Where text falls against title safe needs a reviewer's eye until frame analysis is built.
        {
          check: "safe_area",
          result: scaleToFit ? "fixed" : "pending",
          detail: { scaledToFit: scaleToFit, note: scaleToFit ? "The whole spot is slightly smaller, so everything is inside title safe" : "Checked in review, before any station sees it" }
        },
        { check: "captions", result: "pending", detail: { note: "Made in review from the voiceover" } },
        {
          check: "loudness",
          result: loudnessResult,
          detail: {
            measuredLufs: loudness,
            targetLufs: -24,
            note: loudnessResult === "fine" ? "Already at broadcast level" : loudnessResult === "fixed" ? "Brought to broadcast level so it won't jump out" : "Measured in review"
          }
        },
        ...(code
          ? [
              {
                check: "code" as const,
                result: "fine" as const,
                detail: {
                  code: code.code,
                  note: "With a QR, bottom left, for the last :10",
                  placement: CODE_PLACEMENT.placement,
                  box: CODE_PLACEMENT.box,
                  fromMs: Math.max(0, row.lengthSec * 1000 - CODE_PLACEMENT.lastMs),
                  toMs: row.lengthSec * 1000
                }
              }
            ]
          : [])
      ];
      await db.transaction(async (tx) => {
        const [{ version }] = await tx.select({ version: sql<number>`coalesce(max(${schema.spotFiles.version}), 0)::int` }).from(schema.spotFiles).where(eq(schema.spotFiles.spotId, spotId));
        await tx.update(schema.spotFiles).set({ current: false }).where(eq(schema.spotFiles.spotId, spotId));
        const [saved] = await tx
          .insert(schema.spotFiles)
          .values({ spotId, version: version + 1, originalFilename: file.originalName, contentId: stored.cid, durationMs, widthPx: probe.width, heightPx: probe.height, loudnessLufs: loudness, scaledToFit: scaleToFit, current: true })
          .returning();
        await services.library.content.addRef(tx, stored.cid, "spot_file", saved.id);
        await tx.insert(schema.uploadChecks).values(checks.map((c) => ({ spotFileId: saved.id, check: c.check, result: c.result === "pending" ? "for_you" : c.result, detail: { ...c.detail, pending: c.result === "pending" } })));
      });
      return service.spot(spotId);
    },

    async matches(spotId, targeting) {
      const row = await spotRow(spotId);
      const current = await targetingFor(row);
      const found = await match(row, { ...current, ...targeting });
      return found.map(({ stationId: _stationId, ...m }) => m);
    },

    async submit(spotId) {
      const row = await spotRow(spotId);
      if (row.status !== "draft") throw refused("not_draft", "Only a draft can be sent for review.");
      const [file] = await db.select().from(schema.spotFiles).where(and(eq(schema.spotFiles.spotId, spotId), eq(schema.spotFiles.current, true)));
      if (!file) throw refused("no_file", "Upload the spot first.");
      const lengthCheck = await db
        .select()
        .from(schema.uploadChecks)
        .where(and(eq(schema.uploadChecks.spotFileId, file.id), eq(schema.uploadChecks.check, "length")));
      if (lengthCheck[0]?.result === "for_you") throw refused("wrong_length", `It has to be exactly :${row.lengthSec}.`);
      await setStatus(spotId, { status: "in_review" });
      // The review screen plays its prepared segments: asked for now ("Being prepared" until then).
      if (file.contentId) await services.playout.previews([{ contentId: file.contentId, durationMs: file.durationMs, ...spotBand(file) }], { prepare: true });
      return service.spot(spotId);
    },

    async pause(spotId) {
      const row = await spotRow(spotId);
      if (row.status !== "listed") throw refused("not_listed", "Only a spot in the market can be paused.");
      // A115: paused by hand, it waits for the business ("Waiting for you").
      await pauseFor(row, "by_hand");
      return service.spot(spotId);
    },

    async resume(spotId) {
      const row = await spotRow(spotId);
      if (row.status !== "paused") throw refused("not_paused", "It isn't paused.");
      const { availableMicros } = await services.ledger.balance(row.advertiserId);
      const needed = oneDayOfBudgetMicros({ totalBudgetMicros: row.totalBudgetMicros, dailyCapMicros: row.dailyCapMicros, startsOn: row.startsOn, endsOn: row.endsOn });
      if (availableMicros < needed) throw refused("insufficient_balance", "Add money first: your balance has to cover a day of its budget.");
      const spent = (await services.ledger.spotSpend([spotId], new Date(0))).get(spotId)?.used ?? 0;
      if (spent >= row.totalBudgetMicros) throw refused("budget_spent", "Its budget is spent. Raise the budget to put it back.");
      await resumeRow(row, row.pauseReason === "balance" ? "added_money" : "by_hand");
      return service.spot(spotId);
    },

    async end(spotId) {
      await spotRow(spotId);
      await setStatus(spotId, { status: "ended", pauseReason: null, endedAt: deps.clock.now() });
      await db
        .update(schema.rotationSpots)
        .set({ removedAt: deps.clock.now() })
        .where(and(eq(schema.rotationSpots.spotId, spotId), isNull(schema.rotationSpots.removedAt)));
      return service.spot(spotId);
    },

    async reviewQueue() {
      return spotViews(await db.select().from(SP).where(eq(SP.status, "in_review")).orderBy(asc(SP.createdAt)));
    },

    async review(spotId, decision) {
      const row = await spotRow(spotId);
      if (row.status !== "in_review") throw refused("not_in_review", "It isn't waiting for review.");
      if (decision === "send_back") {
        await setStatus(spotId, { status: "draft" });
      } else {
        await db.transaction(async (tx) => {
          // The database refuses this unless the balance covers a day of its budget.
          await tx.update(SP).set({ status: "listed", listedAt: deps.clock.now() }).where(eq(SP.id, spotId));
          // A116: every listed spot has its own code. One without gets Opencast's letters, and its
          // title as the offer until the business names one (nothing is promised for it).
          const [code] = await tx.select({ id: schema.codes.id }).from(schema.codes).where(eq(schema.codes.spotId, spotId));
          if (!code) await saveCode(tx, spotId, { offer: row.title.slice(0, 80), windowDays: 7 });
        });
        await services.spots.notifyMakerListed(spotId);
      }
      return service.spot(spotId);
    },

    async stationMarket(stationId, filter) {
      const listed = await db.select().from(SP).where(inArray(SP.status, ["listed", "paused"]));
      const profile = (await services.stations.profiles([stationId])).get(stationId);
      if (!profile) throw notFound("That station");
      const [rotation, businesses] = await Promise.all([
        service.rotations(stationId),
        db.select().from(AD).where(inArray(AD.id, [...new Set(listed.map((s) => s.advertiserId))].length ? [...new Set(listed.map((s) => s.advertiserId))] : ["00000000-0000-0000-0000-000000000000"]))
      ]);
      const inMain = new Set(rotation.main.spots.map((s) => s.spotId));
      const inBackup = new Set(rotation.backup.spots.map((s) => s.spotId));
      const result: MarketSpot[] = [];
      const month = deps.clock.now().toISOString().slice(0, 7);
      const customers = await service.customersByStation(stationId, month);
      const stories = await pauseStories(stationId, listed);
      for (const row of listed) {
        const matched = (await match(row, await targetingFor(row))).find((m) => m.stationId === stationId);
        // A station that doesn't air spots now still sees what's listed for it (its rotations stay).
        if (!matched || (!matched.included && matched.reason !== NO_SPOTS)) continue;
        if (row.status === "paused" && !inMain.has(row.id) && !inBackup.has(row.id)) continue;
        if (filter.category && row.category !== filter.category) continue;
        if (filter.withinMiles && matched.miles !== null && matched.miles > filter.withinMiles) continue;
        const business = businesses.find((b) => b.id === row.advertiserId)!;
        const [location] = await db.select().from(schema.advertiserLocations).where(eq(schema.advertiserLocations.advertiserId, row.advertiserId)).limit(1);
        const code = (await db.select().from(schema.codes).where(eq(schema.codes.spotId, row.id)))[0];
        const runway = business.autoTopUp ? null : (await services.ledger.runwayDays([business.id])).get(business.id);
        const [file] = await db.select({ contentId: schema.spotFiles.contentId, location: schema.spotFiles.location, widthPx: schema.spotFiles.widthPx, durationMs: schema.spotFiles.durationMs }).from(schema.spotFiles).where(and(eq(schema.spotFiles.spotId, row.id), eq(schema.spotFiles.current, true)));
        // Its prepared segments, once it's prepared (a listed spot is prepared to air).
        const preview = file?.contentId ? (await services.playout.previews([{ contentId: file.contentId, durationMs: file.durationMs, ...spotBand(file) }])).get(file.contentId) : undefined;
        const story = stories.get(row.id);
        const back = story?.back && !inMain.has(row.id) ? story.back : null;
        result.push({
          spot: {
            id: row.id,
            title: row.title,
            lengthSec: row.lengthSec,
            category: row.category,
            onScreen: code ? `A code for ${code.offer}` : null,
            // P23: the file itself, and the still's colour and line.
            preview: {
              url: file?.contentId ? await services.library.content.url(file.contentId) : (file?.location ?? null),
              colour: colourFor(business.id),
              line: code ? code.offer : row.title,
              previewUrl: preview?.url ?? null,
              previewStatus: preview?.status ?? null
            }
          },
          business: {
            id: business.id,
            name: business.name,
            category: business.category,
            city: business.customersWhere === "online" ? null : (location?.city ?? null),
            online: business.customersWhere === "online",
            shortName: business.shortName ?? business.name
          },
          pause: story?.pause ?? null,
          back,
          miles: matched.miles,
          rate: { kind: row.rateKind, micros: row.rateMicros },
          upToPerDay: row.dailyCapMicros && row.rateKind === "per_airing" ? Math.floor(row.dailyCapMicros / row.rateMicros) : null,
          listedUntil: row.endsOn,
          // Never the balance itself: roughly how long it lasts, or that it tops up.
          runway: business.autoTopUp ? { kind: "tops_up" } : { kind: "days", days: runway ?? 30 },
          inRotation: inMain.has(row.id) ? "main" : inBackup.has(row.id) ? "backup" : null,
          customersFromThisStation: customers.get(row.id) ?? 0,
          state: row.status === "paused" ? "paused" : inMain.has(row.id) ? "in_rotation" : back ? "its_back" : "in_the_market"
        });
      }
      return result;
    },

    async rotations(stationId) {
      const view = async (kind: "main" | "backup"): Promise<RotationView> => {
        const rows = await db
          .select({ spot: SP, position: schema.rotationSpots.position })
          .from(schema.rotationSpots)
          .innerJoin(schema.rotations, eq(schema.rotations.id, schema.rotationSpots.rotationId))
          .innerJoin(SP, eq(SP.id, schema.rotationSpots.spotId))
          .where(and(eq(schema.rotations.stationId, stationId), eq(schema.rotations.kind, kind), isNull(schema.rotationSpots.removedAt)))
          .orderBy(asc(schema.rotationSpots.position));
        const names = await service.businessNames(rows.map((r) => r.spot.advertiserId));
        return {
          kind,
          spots: rows.map((r) => ({ spotId: r.spot.id, title: r.spot.title, business: names.get(r.spot.advertiserId) ?? "", lengthSec: r.spot.lengthSec, paused: r.spot.status !== "listed" }))
        };
      };
      return { main: await view("main"), backup: await view("backup") };
    },

    async setRotation(stationId, kind, spotIds) {
      const available = new Set((await service.stationMarket(stationId, {})).map((m) => m.spot.id));
      const current = kind === "main" ? (await service.rotations(stationId)).main : (await service.rotations(stationId)).backup;
      const already = new Set(current.spots.map((s) => s.spotId));
      const refusedIds = spotIds.filter((id) => !available.has(id) && !already.has(id));
      if (refusedIds.length) throw refused("not_in_your_market", "Only spots listed for your station can go in a rotation.");
      await db.transaction(async (tx) => {
        await tx.insert(schema.rotations).values({ stationId, kind }).onConflictDoNothing();
        const [rotation] = await tx.select().from(schema.rotations).where(and(eq(schema.rotations.stationId, stationId), eq(schema.rotations.kind, kind)));
        await tx
          .update(schema.rotationSpots)
          .set({ removedAt: deps.clock.now() })
          .where(and(eq(schema.rotationSpots.rotationId, rotation.id), isNull(schema.rotationSpots.removedAt)));
        if (spotIds.length) await tx.insert(schema.rotationSpots).values(spotIds.map((spotId, position) => ({ rotationId: rotation.id, spotId, position, addedAt: deps.clock.now() })));
      });
      // The business hears about spots newly added (O1).
      const added = spotIds.filter((id) => !already.has(id));
      if (added.length) {
        const owners = await db.select({ id: SP.id, advertiserId: SP.advertiserId }).from(SP).where(inArray(SP.id, added));
        for (const o of owners) deps.bus.emit("spot.added_to_rotation", { spotId: o.id, businessId: o.advertiserId, stationId, backup: kind === "backup" });
      }
      const views = await service.rotations(stationId);
      return kind === "main" ? views.main : views.backup;
    },

    async rotationFor(stationId, kind) {
      const view = (await service.rotations(stationId))[kind];
      const live = view.spots.filter((s) => !s.paused);
      if (!live.length) return [];
      const [rows, targeting] = await Promise.all([
        db.select().from(SP).where(inArray(SP.id, live.map((s) => s.spotId))),
        db.select().from(schema.targeting).where(inArray(schema.targeting.spotId, live.map((s) => s.spotId)))
      ]);
      return live.map((s) => ({
        spotId: s.spotId,
        lengthSec: s.lengthSec,
        category: rows.find((r) => r.id === s.spotId)?.category ?? "",
        dayparts: (targeting.find((t) => t.spotId === s.spotId)?.dayparts as string[] | undefined) ?? []
      }));
    },

    async recentAirTimePerDay(spotId, stationId) {
      const since = new Date(deps.clock.now().getTime() - 7 * 86_400_000);
      const [row] = await db
        .select({ n: sql<number>`count(*)::int`, length: SP.lengthSec })
        .from(AI)
        .innerJoin(SP, eq(SP.id, AI.spotId))
        .where(and(eq(AI.spotId, spotId), eq(AI.stationId, stationId), gte(AI.scheduledAt, since)))
        .groupBy(SP.lengthSec);
      return row ? Math.round((row.n * row.length * 1000) / 7) : 0;
    },

    async releaseUnaired() {
      const cutoff = new Date(deps.clock.now().getTime() - 3_600_000);
      // A week back is plenty: the job runs every minute.
      const since = new Date(cutoff.getTime() - 7 * 86_400_000);
      const past = await db.select({ id: AI.id, holdId: AI.holdId }).from(AI).where(and(gte(AI.scheduledAt, since), lt(AI.scheduledAt, cutoff)));
      const open = await services.ledger.openHolds(past.map((a) => a.holdId));
      // Aired, with relay parts still waiting for their numbers (2026-09-30): held for those, not unaired.
      const waiting = await relay.openAirings(past.filter((a) => (open.get(a.holdId) ?? 0) > 0).map((a) => a.id));
      let released = 0;
      for (const airing of past) {
        if (!(open.get(airing.holdId) ?? 0) || waiting.has(airing.id)) continue;
        await db.transaction((tx) => services.ledger.release(tx, airing.holdId, undefined, { sourceType: "airing", sourceId: airing.id, memo: "Returned: didn't air" }));
        released++;
      }
      return released;
    },

    async upcomingSpotContent(stationIds, from, to) {
      if (!stationIds.length) return [];
      const SF = schema.spotFiles;
      const [placed, rotated] = await Promise.all([
        db
          .select({ stationId: AI.stationId, spotId: AI.spotId, contentId: SF.contentId, airsAt: AI.scheduledAt, durationMs: SF.durationMs })
          .from(AI)
          .innerJoin(SF, and(eq(SF.spotId, AI.spotId), eq(SF.current, true)))
          .where(and(inArray(AI.stationId, stationIds), gte(AI.scheduledAt, from), lt(AI.scheduledAt, to))),
        db
          .select({ stationId: schema.rotations.stationId, spotId: schema.rotationSpots.spotId, contentId: SF.contentId, durationMs: SF.durationMs })
          .from(schema.rotationSpots)
          .innerJoin(schema.rotations, eq(schema.rotations.id, schema.rotationSpots.rotationId))
          .innerJoin(SP, eq(SP.id, schema.rotationSpots.spotId))
          .innerJoin(SF, and(eq(SF.spotId, schema.rotationSpots.spotId), eq(SF.current, true)))
          .where(and(inArray(schema.rotations.stationId, stationIds), isNull(schema.rotationSpots.removedAt), eq(SP.status, "listed")))
      ]);
      return [
        ...placed.flatMap((r) => (r.contentId ? [{ stationId: r.stationId, spotId: r.spotId, contentId: r.contentId, airsAt: r.airsAt, durationMs: r.durationMs }] : [])),
        // In rotation: could be placed in any break from now on.
        ...rotated.flatMap((r) => (r.contentId ? [{ stationId: r.stationId, spotId: r.spotId, contentId: r.contentId, airsAt: null, durationMs: r.durationMs }] : []))
      ];
    },

    async breakAirings(breakIds) {
      const result = new Map<string, BreakAiring[]>();
      if (!breakIds.length) return result;
      const rows = await db
        .select({ airing: AI, spot: SP, file: schema.spotFiles, code: schema.codes, business: { name: schema.advertisers.name, shortName: schema.advertisers.shortName } })
        .from(AI)
        .innerJoin(SP, eq(SP.id, AI.spotId))
        .innerJoin(schema.advertisers, eq(schema.advertisers.id, SP.advertiserId))
        .leftJoin(schema.spotFiles, and(eq(schema.spotFiles.spotId, AI.spotId), eq(schema.spotFiles.current, true)))
        .leftJoin(schema.codes, eq(schema.codes.spotId, AI.spotId))
        .where(inArray(AI.breakId, breakIds))
        .orderBy(asc(AI.createdAt));
      for (const r of rows) {
        const list = result.get(r.airing.breakId) ?? [];
        list.push({
          airingId: r.airing.id,
          spotId: r.spot.id,
          title: r.spot.title,
          business: r.business.name,
          shortName: r.business.shortName ?? r.business.name,
          lengthSec: r.spot.lengthSec,
          contentId: r.file?.contentId ?? null,
          location: r.file?.location ?? null,
          code: r.code ? { code: r.code.code, offer: r.code.offer } : null,
          carriageAgreementId: r.airing.carriageAgreementId,
          scheduledAt: r.airing.scheduledAt
        });
        result.set(r.airing.breakId, list);
      }
      return result;
    },

    async moveAiring(airingId, breakId, scheduledAt) {
      await db.update(AI).set({ breakId, scheduledAt }).where(eq(AI.id, airingId));
    },

    async placedOnStation(stationId, from, to) {
      const rows = await db
        .select({ spotId: AI.spotId, lengthSec: SP.lengthSec, scheduledAt: AI.scheduledAt })
        .from(AI)
        .innerJoin(SP, eq(SP.id, AI.spotId))
        .where(and(eq(AI.stationId, stationId), gte(AI.scheduledAt, from), lt(AI.scheduledAt, to)));
      return rows;
    },

    async place({ spotId, stationId, breakId, scheduledAt, carriageAgreementId }) {
      const row = await spotRow(spotId);
      if (row.status !== "listed") throw refused("not_listed", "Only spots in the market are placed.");
      const spent = (await services.ledger.spotSpend([spotId], await dayStartFor(row.advertiserId))).get(spotId) ?? { used: 0, usedToday: 0 };
      let holdMicros: number;
      let relayEstimateMicros = 0;
      if (row.rateKind === "per_airing") {
        holdMicros = row.rateMicros;
      } else {
        // An estimate from the station's recent tuned in for this hour, capped at the per-airing maximum.
        const tunedIn = (await services.audience.typicalTunedIn([stationId], scheduledAt)).get(stationId) ?? 0;
        holdMicros = Math.max(1, Math.round((tunedIn * row.rateMicros) / 1000));
        if (row.perAiringMaxMicros) holdMicros = Math.min(holdMicros, row.perAiringMaxMicros);
        // Relay viewers (2026-09-30): plus an estimate for the viewers connected YouTube and Twitch report, inside the same maximum.
        const relayEstimate = await relay.holdEstimate(row, stationId, scheduledAt);
        relayEstimateMicros = row.perAiringMaxMicros ? Math.max(0, Math.min(relayEstimate, row.perAiringMaxMicros - holdMicros)) : relayEstimate;
        holdMicros += relayEstimateMicros;
      }
      if (spent.used + holdMicros > row.totalBudgetMicros) {
        await pauseFor(row, "budget_spent");
        throw refused("budget_spent", "Its budget is spent.");
      }
      if (row.dailyCapMicros && spent.usedToday + holdMicros > row.dailyCapMicros) {
        await pauseFor(row, "daily_cap");
        throw refused("daily_cap", "It's reached its daily cap.");
      }
      const airingId = await db
        .transaction(async (tx) => {
          const holdId = await services.ledger.hold(tx, {
            businessId: row.advertiserId,
            purpose: "airing",
            spotId,
            stationId,
            amountMicros: holdMicros,
            isEstimate: row.rateKind === "per_thousand",
            memo: `Held for an airing`
          });
          const [airing] = await tx
            .insert(AI)
            .values({ spotId, stationId, breakId, holdId, scheduledAt, rateKind: row.rateKind, rateMicros: row.rateMicros, carriageAgreementId: carriageAgreementId ?? null, createdAt: deps.clock.now(), relayEstimateMicros })
            .returning({ id: AI.id });
          return airing.id;
        })
        .catch(async (error) => {
          if ((error as { code?: string }).code === "insufficient_balance") await pauseFor(row, "balance");
          throw error;
        });
      await services.ledger.checkRunway(row.advertiserId);
      return { airingId, holdMicros };
    },

    async settleAiring({ airingId, asRunId, startedAt, endedAt, barter }) {
      const [airing] = await db.select({ airing: AI, spot: SP }).from(AI).innerJoin(SP, eq(SP.id, AI.spotId)).where(eq(AI.id, airingId));
      if (!airing) throw notFound("That airing");
      // Within half a second of its length is in full (process timing, not a cut).
      const measured = endedAt.getTime() - startedAt.getTime();
      const airedMs = Math.max(0, measured >= airing.spot.lengthSec * 1000 - 500 ? airing.spot.lengthSec * 1000 : measured);
      const fraction = airedMs / (airing.spot.lengthSec * 1000);
      let cost: number;
      let working: string;
      if (airing.airing.rateKind === "per_airing") {
        cost = Math.round(airing.airing.rateMicros * fraction);
        working = `${fmt(airing.airing.rateMicros)} an airing${fraction < 1 ? ` × ${Math.round(airedMs / 1000)}/${airing.spot.lengthSec}s` : ""} = ${fmt(cost)}`;
      } else {
        // Online businesses: every viewer. Local ones (2026-09-30): the viewers placed inside the area.
        const viewers = await relay.opencastViewers(airing.spot, airing.airing.stationId, startedAt, endedAt);
        const full = (viewers.billed * airing.airing.rateMicros) / 1000;
        cost = Math.round(Math.min(full, airing.spot.perAiringMaxMicros ?? Number.MAX_SAFE_INTEGER) * fraction);
        const who = Math.round(viewers.billed) === Math.round(viewers.tunedIn) ? `${Math.round(viewers.billed)}` : `${Math.round(viewers.billed)} in your area (of ${Math.round(viewers.tunedIn)} tuned in)`;
        working = `${who} × ${fmt(airing.airing.rateMicros)} ÷ 1,000${fraction < 1 ? ` × ${Math.round(airedMs / 1000)}/${airing.spot.lengthSec}s` : ""} = ${fmt(cost)}`;
      }
      // Relay viewers (2026-09-30): each counted platform's part stays held until its numbers are in.
      const openHold = (await services.ledger.openAmount([airing.airing.holdId])).get(airing.airing.holdId) ?? 0;
      const keepHeldMicros =
        airing.airing.rateKind === "per_thousand"
          ? await relay.open({ airing: airing.airing, spot: airing.spot, startedAt, endedAt, fraction, opencastCostMicros: cost, openHoldMicros: openHold })
          : 0;
      const station = (await services.stations.idents([airing.airing.stationId])).get(airing.airing.stationId);
      if (!barter && airing.airing.carriageAgreementId) {
        // It filled the producer's barter share: the producer is paid.
        const agreement = (await services.catalog.agreementsByIds([airing.airing.carriageAgreementId])).get(airing.airing.carriageAgreementId);
        if (agreement) barter = { producerStationId: agreement.makerStationId, producerShare: 1, agreementId: agreement.id };
      }
      await db.transaction((tx) =>
        services.ledger.settle(tx, {
          holdId: airing.airing.holdId,
          stationId: airing.airing.stationId,
          costMicros: cost,
          kind: "airing",
          source: { sourceType: "as_run", sourceId: asRunId, memo: `Aired on ${station?.callSign ?? station?.name ?? "a station"}${station?.channel ? ` ${station.channel}` : ""}`, idempotencyKey: `settle:${airingId}` },
          barter,
          keepHeldMicros
        })
      );
      await services.ledger.checkRunway(airing.spot.advertiserId);
      return { costMicros: cost, working };
    },

    settleRelayViewers: () => relay.settleDue(),
    relayWaiting: (businessId) => relay.waiting(businessId),

    async resumeDailyCaps() {
      const rows = await db.select().from(SP).where(and(eq(SP.status, "paused"), eq(SP.pauseReason, "daily_cap")));
      for (const row of rows) {
        // Resumes by itself at midnight; no one is told.
        await setStatus(row.id, { status: "listed", pauseReason: null, pausedAt: null, resumedAt: deps.clock.now(), resumeReason: "midnight" });
      }
      return rows.length;
    }
  };
  return service;
}

const fmt = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const backReason = (reason: "raised_budget" | "added_money" | "by_hand" | "midnight") => (reason === "raised_budget" || reason === "added_money" ? reason : "resumed");

function checkLabel(check: string, result: string, detail: Record<string, unknown> | null): string {
  switch (check) {
    case "length":
      return result === "fine" ? `Exactly a :${detail?.expectedSec}` : `It runs ${((Number(detail?.durationMs) || 0) / 1000).toFixed(1)}s; it has to be :${detail?.expectedSec}`;
    case "picture":
      return `Picture ${detail?.width ?? "?"} by ${detail?.height ?? "?"}`;
    case "safe_area":
      return detail?.pending ? "Title safe: checked in review" : "Shrunk to fit inside title safe";
    case "captions":
      return "Captions: generated in review";
    case "loudness":
      return result === "fine" ? "Loudness is at broadcast level" : "Loudness levelled";
    case "code":
      // Details stored before P4 carried the placement in words.
      return typeof detail?.placement === "string" && detail.placement.includes(" ") ? `Code ${detail?.code} added, with a QR, ${detail.placement}` : `Code ${detail?.code} added`;
    default:
      return check;
  }
}

