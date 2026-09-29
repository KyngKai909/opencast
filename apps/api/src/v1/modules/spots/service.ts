// Opencast for business: businesses, spots, targeting, the station side of the
// spot market, rotations, placing spots in breaks (with money held first) and
// settling what aired. Sponsorships, production orders and codes are in their own files.

import path from "node:path";
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { oneDayOfBudgetMicros } from "@opencast/domain";
import type { Business, MarketSpot, Spot, SpotState, TargetMatch } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import type { CurrentUser, UploadedFile } from "../../http.js";
import { badRequest, notFound, refused } from "../../errors.js";
import { miles } from "../network/service.js";
import { localDate, localDay } from "../../lib/time.js";
import { createSponsorships, type SponsorshipsPart } from "./sponsorships.js";
import { createOrders, type OrdersPart } from "./orders.js";
import { createCodes, type CodesPart } from "./codes.js";

type Targeting = Spot["targeting"];

export interface SpotsService extends SponsorshipsPart, OrdersPart, CodesPart {
  businessNames(ids: string[]): Promise<Map<string, string>>;
  filledMsByBreak(breakIds: string[]): Promise<Map<string, number>>;
  spotSummary(spotId: string): Promise<{ title: string; business: string }>;
  /** Pauses a business's spots it can no longer cover a day of, and resumes ones it now can. */
  /** Pauses spots the balance no longer covers for a day; a top-up (`toppedUp`) also brings paused ones back. */
  reviewBalance(businessId: string, toppedUp?: boolean): Promise<void>;
  typicalAiringCost(businessId: string): Promise<number | null>;
  heldAirings(stationId: string, from: Date, to: Date): Promise<Array<{ airingId: string; holdId: string; scheduledAt: Date }>>;
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
  upcomingSpotContent(stationIds: string[], from: Date, to: Date): Promise<Array<{ stationId: string; spotId: string; contentId: string; airsAt: Date | null }>>;
  /** What's placed in each break, in order, with what playout needs to air it. */
  breakAirings(breakIds: string[]): Promise<Map<string, BreakAiring[]>>;
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
  code: { code: string; offer: string; windowDays: number } | null;
}

export interface BreakAiring {
  airingId: string;
  spotId: string;
  title: string;
  lengthSec: number;
  /** The spot's file by content ID (the worker cache has it), or a legacy path. */
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

const SP = schema.spotsTable;
const AD = schema.advertisers;
const AI = schema.airings;
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
      createdAt: row.createdAt.toISOString()
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
          excludedStationIds: row.excludedStationIds
        }
      : { ...EMPTY_TARGETING };
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
        return row.pauseReason === "daily_cap" ? "paused_daily_cap" : row.pauseReason === "budget_spent" ? "paused_budget" : "paused_balance";
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
    const spend = await services.ledger.spotSpend(ids, await dayStartFor(rows[0].advertiserId));
    const content = services.library.content;
    const urls = new Map(await Promise.all(files.map(async (f) => [f.id, { url: f.contentId ? await content.url(f.contentId) : (f.location ?? ""), previewUrl: await content.previewUrl(f.contentId) }] as const)));
    return rows.map((r) => {
      const file = files.find((f) => f.spotId === r.id);
      const code = codes.find((c) => c.spotId === r.id);
      const inRotationOn = rotation.get(r.id)?.size ?? 0;
      const t = targetingOf(targeting.find((x) => x.spotId === r.id));
      t.marketIds = markets.filter((m) => m.advertiserId === r.advertiserId).map((m) => m.marketId);
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
        code: code ? { code: code.code, offer: code.offer, windowDays: code.windowDays } : null,
        file: file
          ? {
              url: urls.get(file.id)?.url ?? "",
              previewUrl: urls.get(file.id)?.previewUrl ?? null,
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
        createdAt: r.createdAt.toISOString()
      };
    });
  }

  async function saveTargeting(tx: Executor, spotId: string, t: Partial<Targeting>) {
    const values = {
      spotId,
      withinMiles: t.withinMiles ?? null,
      locationIds: t.locationIds ?? [],
      stationCategories: t.stationCategories ?? [],
      dayparts: t.dayparts ?? [],
      excludedStationIds: t.excludedStationIds ?? []
    };
    await tx.insert(schema.targeting).values(values).onConflictDoUpdate({ target: schema.targeting.spotId, set: values });
  }

  async function saveCode(tx: Executor, spotId: string, code: SpotInput["code"]) {
    await tx.delete(schema.codes).where(and(eq(schema.codes.spotId, spotId), sql`not exists (select 1 from spots.code_events e where e.code_id = ${schema.codes.id})`));
    if (!code) return;
    await tx
      .insert(schema.codes)
      .values({ spotId, code: code.code, offer: code.offer, windowDays: code.windowDays })
      .onConflictDoUpdate({ target: schema.codes.spotId, set: { code: code.code, offer: code.offer, windowDays: code.windowDays } });
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
    const typical = await services.audience.typicalTunedIn(candidates.map((c) => c.id), deps.clock.now());
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
      } else if (targeting.stationCategories.length && (!station.category || !targeting.stationCategories.includes(station.category))) {
        included = false;
        reason = reason ?? "not chosen";
      }
      if (station.blockedCategories.map((c) => c.toLowerCase()).includes(row.category.toLowerCase())) {
        included = false;
        reason = "doesn't carry this category";
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

  async function pauseFor(row: typeof SP.$inferSelect, reason: "daily_cap" | "budget_spent" | "balance") {
    if (row.status !== "listed") return;
    await setStatus(row.id, { status: "paused", pauseReason: reason, pausedAt: deps.clock.now() });
    const stationIds = [...((await rotationMembership([row.id])).get(row.id) ?? [])];
    deps.bus.emit("spot.paused", { spotId: row.id, businessId: row.advertiserId, reason, stationIds });
  }

  async function resumeRow(row: typeof SP.$inferSelect) {
    await setStatus(row.id, { status: "listed", pauseReason: null, pausedAt: null });
    const stationIds = [...((await rotationMembership([row.id])).get(row.id) ?? [])];
    // Stations are told it's back; it's never put back in a rotation by itself.
    await db
      .update(schema.rotationSpots)
      .set({ removedAt: deps.clock.now() })
      .where(and(eq(schema.rotationSpots.spotId, row.id), isNull(schema.rotationSpots.removedAt)));
    deps.bus.emit("spot.resumed", { spotId: row.id, businessId: row.advertiserId, stationIds });
  }

  const parts = {
    sponsorships: createSponsorships(ctx),
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
    codes: createCodes(ctx)
  };

  const service: SpotsService = {
    ...parts.sponsorships,
    ...parts.orders,
    ...parts.codes,

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
        else if (toppedUp && row.status === "paused" && row.pauseReason === "balance" && availableMicros >= needed) await resumeRow(row);
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
        .select({ airingId: AI.id, holdId: AI.holdId, scheduledAt: AI.scheduledAt })
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
        for (const key of ["name", "category", "about", "website", "logoUrl", "customersWhere", "warnDays", "receiptsEmail", "legalName"] as const) {
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
        if (spent < updated.totalBudgetMicros) await resumeRow(updated);
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
      const kept = path.join(deps.config.storageRoot, "uploads", `business-${row.advertiserId}`, "spots");
      const { promises: fs } = await import("node:fs");
      await fs.mkdir(kept, { recursive: true });
      const copy = path.join(kept, `${spotId}-${Date.now()}${path.extname(file.originalName)}`);
      await fs.copyFile(file.path, copy);
      const prepared = await deps.media.prepare(copy, { scope: `business-${row.advertiserId}`, itemId: `${spotId}-${Date.now()}`, mediaKind: probe.mediaKind });
      // Stored by content ID: the same spot uploaded twice is stored once.
      const stored = await services.library.content.store(prepared.file, { storageClass: "standard" });
      await Promise.all([fs.rm(prepared.file, { force: true }), fs.rm(copy, { force: true })]);
      const code = (await db.select().from(schema.codes).where(eq(schema.codes.spotId, spotId)))[0];

      // The checks on arrival.
      const lengthOff = Math.abs(durationMs - row.lengthSec * 1000);
      const checks: Array<{ check: "length" | "picture" | "safe_area" | "captions" | "loudness" | "code"; result: "fine" | "fixed" | "for_you" | "pending"; detail: Record<string, unknown> }> = [
        { check: "length", result: lengthOff <= 100 ? "fine" : "for_you", detail: { durationMs: probe.durationMs, expectedSec: row.lengthSec } },
        {
          check: "picture",
          result: probe.mediaKind === "audio" ? "for_you" : probe.width === 1920 && probe.height === 1080 ? "fine" : probe.width && probe.height && probe.width / probe.height > 1.7 ? "fixed" : "for_you",
          detail: { width: probe.width, height: probe.height }
        },
        // Where text falls against title safe needs a reviewer's eye until frame analysis is built.
        { check: "safe_area", result: scaleToFit ? "fixed" : "pending", detail: { scaledToFit: scaleToFit } },
        { check: "captions", result: "pending", detail: {} },
        { check: "loudness", result: loudness === null ? "pending" : Math.abs(loudness + 24) <= 2 ? "fine" : "fixed", detail: { measuredLufs: loudness, targetLufs: -24 } },
        ...(code ? [{ check: "code" as const, result: "fine" as const, detail: { code: code.code, placement: "bottom left, for the last :10" } }] : [])
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
      const current = (await spotViews([row]))[0].targeting;
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
      // The review screen plays a preview, kept only while it's in review.
      if (file.contentId) await services.library.content.needPreview([file.contentId], "review", spotId);
      return service.spot(spotId);
    },

    async pause(spotId) {
      const row = await spotRow(spotId);
      if (row.status !== "listed") throw refused("not_listed", "Only a spot in the market can be paused.");
      // A manual pause reads like a spent budget: it waits for the business.
      await pauseFor(row, "budget_spent");
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
      await resumeRow(row);
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
        // The database refuses this unless the balance covers a day of its budget.
        await setStatus(spotId, { status: "listed", listedAt: deps.clock.now() });
        await services.spots.notifyMakerListed(spotId);
      }
      await services.library.content.dropPreview("review", spotId);
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
      for (const row of listed) {
        const matched = (await match(row, (await spotViews([row]))[0].targeting)).find((m) => m.stationId === stationId);
        if (!matched?.included) continue;
        if (row.status === "paused" && !inMain.has(row.id) && !inBackup.has(row.id)) continue;
        if (filter.category && row.category !== filter.category) continue;
        if (filter.withinMiles && matched.miles !== null && matched.miles > filter.withinMiles) continue;
        const business = businesses.find((b) => b.id === row.advertiserId)!;
        const [location] = await db.select().from(schema.advertiserLocations).where(eq(schema.advertiserLocations.advertiserId, row.advertiserId)).limit(1);
        const code = (await db.select().from(schema.codes).where(eq(schema.codes.spotId, row.id)))[0];
        const runway = business.autoTopUp ? null : (await services.ledger.runwayDays([business.id])).get(business.id);
        result.push({
          spot: { id: row.id, title: row.title, lengthSec: row.lengthSec, category: row.category, onScreen: code ? `A code for ${code.offer}` : null },
          business: { id: business.id, name: business.name, category: business.category, city: business.customersWhere === "online" ? null : (location?.city ?? null), online: business.customersWhere === "online" },
          miles: matched.miles,
          rate: { kind: row.rateKind, micros: row.rateMicros },
          upToPerDay: row.dailyCapMicros && row.rateKind === "per_airing" ? Math.floor(row.dailyCapMicros / row.rateMicros) : null,
          listedUntil: row.endsOn,
          // Never the balance itself: roughly how long it lasts, or that it tops up.
          runway: business.autoTopUp ? { kind: "tops_up" } : { kind: "days", days: runway ?? 30 },
          inRotation: inMain.has(row.id) ? "main" : inBackup.has(row.id) ? "backup" : null,
          customersFromThisStation: customers.get(row.id) ?? 0,
          state: row.status === "paused" ? "paused" : inMain.has(row.id) ? "in_rotation" : "in_the_market"
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
        if (spotIds.length) await tx.insert(schema.rotationSpots).values(spotIds.map((spotId, position) => ({ rotationId: rotation.id, spotId, position })));
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
      let released = 0;
      for (const airing of past) {
        if (!(open.get(airing.holdId) ?? 0)) continue;
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
          .select({ stationId: AI.stationId, spotId: AI.spotId, contentId: SF.contentId, airsAt: AI.scheduledAt })
          .from(AI)
          .innerJoin(SF, and(eq(SF.spotId, AI.spotId), eq(SF.current, true)))
          .where(and(inArray(AI.stationId, stationIds), gte(AI.scheduledAt, from), lt(AI.scheduledAt, to))),
        db
          .select({ stationId: schema.rotations.stationId, spotId: schema.rotationSpots.spotId, contentId: SF.contentId })
          .from(schema.rotationSpots)
          .innerJoin(schema.rotations, eq(schema.rotations.id, schema.rotationSpots.rotationId))
          .innerJoin(SP, eq(SP.id, schema.rotationSpots.spotId))
          .innerJoin(SF, and(eq(SF.spotId, schema.rotationSpots.spotId), eq(SF.current, true)))
          .where(and(inArray(schema.rotations.stationId, stationIds), isNull(schema.rotationSpots.removedAt), eq(SP.status, "listed")))
      ]);
      return [
        ...placed.flatMap((r) => (r.contentId ? [{ stationId: r.stationId, spotId: r.spotId, contentId: r.contentId, airsAt: r.airsAt }] : [])),
        // In rotation: could be placed in any break from now on.
        ...rotated.flatMap((r) => (r.contentId ? [{ stationId: r.stationId, spotId: r.spotId, contentId: r.contentId, airsAt: null }] : []))
      ];
    },

    async breakAirings(breakIds) {
      const result = new Map<string, BreakAiring[]>();
      if (!breakIds.length) return result;
      const rows = await db
        .select({ airing: AI, spot: SP, file: schema.spotFiles, code: schema.codes })
        .from(AI)
        .innerJoin(SP, eq(SP.id, AI.spotId))
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
      if (row.rateKind === "per_airing") {
        holdMicros = row.rateMicros;
      } else {
        // An estimate from the station's recent tuned in for this hour, capped at the per-airing maximum.
        const tunedIn = (await services.audience.typicalTunedIn([stationId], scheduledAt)).get(stationId) ?? 0;
        holdMicros = Math.max(1, Math.round((tunedIn * row.rateMicros) / 1000));
        if (row.perAiringMaxMicros) holdMicros = Math.min(holdMicros, row.perAiringMaxMicros);
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
            .values({ spotId, stationId, breakId, holdId, scheduledAt, rateKind: row.rateKind, rateMicros: row.rateMicros, carriageAgreementId: carriageAgreementId ?? null })
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
        const tunedIn = await services.audience.averageTunedIn(airing.airing.stationId, startedAt, endedAt);
        const full = (tunedIn * airing.airing.rateMicros) / 1000;
        cost = Math.round(Math.min(full, airing.spot.perAiringMaxMicros ?? Number.MAX_SAFE_INTEGER) * fraction);
        working = `${Math.round(tunedIn)} × ${fmt(airing.airing.rateMicros)} ÷ 1,000${fraction < 1 ? ` × ${Math.round(airedMs / 1000)}/${airing.spot.lengthSec}s` : ""} = ${fmt(cost)}`;
      }
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
          barter
        })
      );
      await services.ledger.checkRunway(airing.spot.advertiserId);
      return { costMicros: cost, working };
    },

    async resumeDailyCaps() {
      const rows = await db.select().from(SP).where(and(eq(SP.status, "paused"), eq(SP.pauseReason, "daily_cap")));
      for (const row of rows) {
        // Resumes by itself at midnight; no one is told.
        await setStatus(row.id, { status: "listed", pauseReason: null, pausedAt: null });
      }
      return rows.length;
    }
  };
  return service;
}

const fmt = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

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
      return `Code ${detail?.code} added, with a QR, ${detail?.placement}`;
    default:
      return check;
  }
}

