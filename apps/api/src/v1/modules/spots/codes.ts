// On-screen codes and what they bring in: QR scans, offers saved to a phone, and
// uses at the counter. A use counts as a customer only within the offer's window
// after an airing. Stations see customers from their own airings only.
// Results for businesses come from the as-run log, never the planned log.

import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Results, ResultsCode, StationIdent } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { conflict, notFound } from "../../errors.js";
import { localDate, localDay } from "../../lib/time.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;

export interface RedeemAnswer {
  valid: boolean;
  firstUse: boolean;
  countsAsCustomer: boolean;
  savedFrom: StationIdent | null;
  message: string;
  code: string;
  offer: string | null;
  savedAt: string | null;
  spotTitle: string | null;
  redeemedToday: number;
}

export type ResultsPeriod = { period: "week" | "month" | "all"; month: string; week?: string };

export interface CodesPart {
  scan(code: string, input: { stationId?: string; airingId?: string }): Promise<{ business: string; offer: string }>;
  saveOffer(code: string, input: { stationId?: string; customerRef?: string }): Promise<{ savedUntil: string; savedFrom: StationIdent | null }>;
  redeem(businessId: string, userId: string, input: { code: string; customerRef?: string }): Promise<RedeemAnswer>;
  /** B5: the same check as `redeem`, counting nothing. */
  checkCode(businessId: string, input: { code: string; customerRef?: string }): Promise<RedeemAnswer>;
  /** P12: the Redeem tool's switch, codes marked used today, and whether Clear Pay counts by itself. */
  redeemToday(businessId: string): Promise<{ on: boolean; redeemedToday: number; clearPay: boolean }>;
  /** Results for a month (the contract's), or (P14) a week or all time. */
  results(businessId: string, month: string, period?: ResultsPeriod): Promise<Results>;
  /** P20: a use counted by a connected checkout or Clear Pay (a webhook). False when the code isn't the business's. */
  countUse(businessId: string, input: { code: string; source: "clear_pay" | "shopify" | "stripe" | "square"; customerRef: string | null; at: Date }): Promise<boolean>;
  customersByStation(stationId: string, month: string): Promise<Map<string, number>>;
  stationCustomers(stationId: string, month: string): Promise<Array<{ spotId: string; business: string; customers: number }>>;
}

const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
};
const fmt = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const daypartOf = (at: Date, tz: string) => {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(at));
  return hour >= 6 && hour < 12 ? "Mornings" : hour >= 12 && hour < 18 ? "Afternoons" : hour >= 18 && hour < 23 ? "Evenings" : "Late night";
};

export function createCodes({ deps, services }: ModuleContext): CodesPart {
  const { db } = deps;
  const C = schema.codes;
  const EV = schema.codeEvents;
  const AI = schema.airings;
  const SP = schema.spotsTable;

  async function findCode(code: string) {
    const rows = await db
      .select({ code: C, spot: SP })
      .from(C)
      .innerJoin(SP, eq(SP.id, C.spotId))
      .where(eq(C.code, code.toUpperCase()))
      .orderBy(desc(C.createdAt));
    const live = rows.find((r) => r.spot.status !== "draft") ?? rows[0];
    if (!live) throw notFound("That code");
    return live;
  }

  /** The airing a scan belongs to: the one given, or the spot's latest on that station in the last hour. */
  async function attribute(spotId: string, stationId?: string, airingId?: string) {
    if (airingId) {
      const [airing] = await db.select().from(AI).where(and(eq(AI.id, airingId), eq(AI.spotId, spotId)));
      if (airing) return { airingId: airing.id, stationId: airing.stationId };
    }
    if (stationId) {
      const now = deps.clock.now();
      const [airing] = await db
        .select()
        .from(AI)
        .where(and(eq(AI.spotId, spotId), eq(AI.stationId, stationId), gte(AI.scheduledAt, new Date(now.getTime() - HOUR)), lt(AI.scheduledAt, now)))
        .orderBy(desc(AI.scheduledAt))
        .limit(1);
      return { airingId: airing?.id ?? null, stationId };
    }
    return { airingId: null, stationId: null };
  }

  async function airedAirings(spotIds: string[], from: Date, to: Date) {
    if (!spotIds.length) return [];
    const airings = await db.select().from(AI).where(and(inArray(AI.spotId, spotIds), gte(AI.scheduledAt, new Date(from.getTime() - HOUR)), lt(AI.scheduledAt, to)));
    const asRun = await services.playout.asRunForAirings(airings.map((a) => a.id));
    return airings.flatMap((a) => {
      const run = asRun.get(a.id);
      return run && run.startedAt >= from && run.startedAt < to ? [{ airing: a, run }] : [];
    });
  }

  /** The business's market day (its first market's time zone, or Los Angeles). */
  async function timezoneOf(businessId: string) {
    const [market] = await db.select().from(schema.advertiserMarkets).where(eq(schema.advertiserMarkets.advertiserId, businessId)).limit(1);
    return market ? ((await services.network.marketsByIds([market.marketId])).get(market.marketId)?.timezone ?? "America/Los_Angeles") : "America/Los_Angeles";
  }

  async function redeemOn(businessId: string) {
    const [row] = await db.select({ redeemOn: schema.advertisers.redeemOn, where: schema.advertisers.customersWhere }).from(schema.advertisers).where(eq(schema.advertisers.id, businessId));
    return row ? (row.redeemOn ?? row.where !== "online") : false;
  }

  async function connected(businessId: string, kind: "clear_pay" | "checkout") {
    const [row] = await db
      .select({ id: schema.connections.id })
      .from(schema.connections)
      .where(and(eq(schema.connections.advertiserId, businessId), eq(schema.connections.kind, kind), isNull(schema.connections.disconnectedAt)))
      .limit(1);
    return Boolean(row);
  }

  async function markedToday(businessId: string) {
    const tz = await timezoneOf(businessId);
    const { from } = localDay(localDate(deps.clock.now(), tz), tz);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(EV)
      .innerJoin(C, eq(C.id, EV.codeId))
      .innerJoin(SP, eq(SP.id, C.spotId))
      .where(and(eq(SP.advertiserId, businessId), eq(EV.kind, "use"), eq(EV.source, "marked_used"), gte(EV.occurredAt, from)));
    return row.n;
  }

  /** B5 and the counter: checks a code for this business, and (with `markedBy`) counts the use. */
  async function answer(businessId: string, input: { code: string; customerRef?: string }, markedBy: string | null): Promise<RedeemAnswer> {
    const typed = input.code.trim().toUpperCase();
    const rows = await db
      .select({ code: C, spot: SP })
      .from(C)
      .innerJoin(SP, eq(SP.id, C.spotId))
      .where(and(eq(C.code, typed), eq(SP.advertiserId, businessId)));
    const found = rows[0];
    const base = { code: typed, offer: null, savedAt: null, spotTitle: null, savedFrom: null, firstUse: false, countsAsCustomer: false };
    if (!found) return { ...base, valid: false, message: `${typed} isn't one of your codes. Check it with the customer.`, redeemedToday: await markedToday(businessId) };
    const now = deps.clock.now();
    // An ended spot's offer keeps for its window after it ended.
    if (found.spot.status === "ended" && found.spot.endedAt && now.getTime() > found.spot.endedAt.getTime() + found.code.windowDays * DAY) {
      return { ...base, offer: found.code.offer, spotTitle: found.spot.title, valid: false, message: `${typed} has ended.`, redeemedToday: await markedToday(businessId) };
    }
    const priorUses = input.customerRef
      ? await db.select().from(EV).where(and(eq(EV.codeId, found.code.id), eq(EV.kind, "use"), eq(EV.customerRef, input.customerRef)))
      : [];
    const firstUse = priorUses.length === 0;
    // A customer only within the offer's window after an airing.
    const recent = await airedAirings([found.spot.id], new Date(now.getTime() - found.code.windowDays * DAY), now);
    const [saved] = input.customerRef
      ? await db.select().from(EV).where(and(eq(EV.codeId, found.code.id), eq(EV.kind, "save"), eq(EV.customerRef, input.customerRef))).orderBy(desc(EV.occurredAt)).limit(1)
      : [];
    const latest = recent.sort((a, b) => b.run.startedAt.getTime() - a.run.startedAt.getTime())[0];
    const stationId = saved?.stationId ?? latest?.airing.stationId ?? null;
    const countsAsCustomer = firstUse && recent.length > 0;
    if (markedBy) {
      await db.insert(EV).values({
        codeId: found.code.id,
        kind: "use",
        source: "marked_used",
        airingId: saved?.airingId ?? latest?.airing.id ?? null,
        stationId,
        customerRef: input.customerRef ?? null,
        countsAsCustomer,
        markedBy,
        occurredAt: now
      });
      deps.bus.emit("code.used", { businessId, spotId: found.spot.id, code: found.code.code });
    }
    const savedFrom = stationId ? ((await services.stations.idents([stationId])).get(stationId) ?? null) : null;
    return {
      valid: true,
      firstUse,
      countsAsCustomer,
      savedFrom,
      message: !firstUse ? "Already used by this customer." : countsAsCustomer ? "First use. It counts as a customer." : `First use, but not within ${found.code.windowDays} days of an airing.`,
      code: found.code.code,
      offer: found.code.offer,
      savedAt: saved?.occurredAt.toISOString() ?? null,
      spotTitle: found.spot.title,
      redeemedToday: await markedToday(businessId)
    };
  }

  /** P14: the dates a results request covers (UTC days, as months always were). */
  async function rangeOf(period: ResultsPeriod, spots: Array<typeof SP.$inferSelect>): Promise<{ from: Date; to: Date; shownFrom?: Date }> {
    if (period.period === "month") return monthRange(period.month);
    if (period.period === "week") {
      const today = deps.clock.now().toISOString().slice(0, 10);
      const day = period.week ?? today;
      const start = new Date(`${day}T00:00:00Z`);
      start.setUTCDate(start.getUTCDate() - start.getUTCDay());
      return { from: start, to: new Date(start.getTime() + 7 * DAY) };
    }
    // All time: everything so far, shown from the first airing (or, before one, the first spot).
    const first = spots.reduce<Date | null>((min, s) => (!min || s.createdAt < min ? s.createdAt : min), null);
    return { from: new Date(0), to: new Date(deps.clock.now().getTime() + 1), shownFrom: first ?? deps.clock.now() };
  }

  /** P13: each code's scans, saves and uses in the period, and how the uses were counted. */
  async function codeFunnels(
    businessId: string,
    spots: Array<typeof SP.$inferSelect>,
    events: Array<{ event: typeof EV.$inferSelect; spotId: string }>,
    from: Date
  ): Promise<ResultsCode[]> {
    if (!spots.length) return [];
    const codes = await db.select().from(C).where(inArray(C.spotId, spots.map((s) => s.id)));
    if (!codes.length) return [];
    const [clearPay, checkout] = await Promise.all([connected(businessId, "clear_pay"), connected(businessId, "checkout")]);
    const saveStations = new Map<string, Map<string, number>>();
    for (const e of events) {
      if (e.event.kind !== "save" || !e.event.stationId) continue;
      const counts = saveStations.get(e.event.codeId) ?? new Map<string, number>();
      counts.set(e.event.stationId, (counts.get(e.event.stationId) ?? 0) + 1);
      saveStations.set(e.event.codeId, counts);
    }
    const topStations = new Map([...saveStations].map(([codeId, counts]) => [codeId, [...counts].sort((a, b) => b[1] - a[1])[0][0]]));
    const idents = await services.stations.idents([...topStations.values()]);
    void from;
    return codes.map((c) => {
      const spot = spots.find((s) => s.id === c.spotId)!;
      const mine = events.filter((e) => e.event.codeId === c.id);
      const uses = mine.filter((e) => e.event.kind === "use");
      const clearPayUses = uses.filter((e) => e.event.source === "clear_pay").length;
      const onlineUses = uses.filter((e) => ["shopify", "stripe", "square"].includes(e.event.source)).length;
      const top = topStations.get(c.id);
      return {
        code: c.code,
        spotId: c.spotId,
        spotTitle: spot.title,
        offer: c.offer,
        windowDays: c.windowDays,
        oncePerCustomer: true,
        savedForDays: c.windowDays,
        scans: mine.filter((e) => e.event.kind === "scan").length,
        saves: mine.filter((e) => e.event.kind === "save").length,
        uses: uses.length,
        usesBy: {
          clearPay: clearPay || clearPayUses ? clearPayUses : null,
          marked: uses.filter((e) => e.event.source === "marked_used").length,
          online: checkout || onlineUses ? onlineUses : null
        },
        savedMostFrom: top ? (idents.get(top) ?? null) : null
      };
    });
  }

  const part: CodesPart = {
    async scan(code, input) {
      const found = await findCode(code);
      const where = await attribute(found.spot.id, input.stationId, input.airingId);
      await db.insert(EV).values({ codeId: found.code.id, kind: "scan", source: "qr", airingId: where.airingId, stationId: where.stationId, occurredAt: deps.clock.now() });
      const business = (await services.spots.businessNames([found.spot.advertiserId])).get(found.spot.advertiserId) ?? "";
      return { business, offer: found.code.offer };
    },

    async saveOffer(code, input) {
      const found = await findCode(code);
      const where = await attribute(found.spot.id, input.stationId);
      await db.insert(EV).values({
        codeId: found.code.id,
        kind: "save",
        source: "qr",
        airingId: where.airingId,
        stationId: where.stationId,
        customerRef: input.customerRef ?? null,
        occurredAt: deps.clock.now()
      });
      const until = new Date(deps.clock.now().getTime() + found.code.windowDays * DAY).toISOString().slice(0, 10);
      const savedFrom = where.stationId ? ((await services.stations.idents([where.stationId])).get(where.stationId) ?? null) : null;
      return { savedUntil: until, savedFrom };
    },

    async redeem(businessId, userId, input) {
      if (!(await redeemOn(businessId))) throw conflict("redeem_off", "Redeem is off for this business. Turn it on in Settings.");
      return answer(businessId, input, userId);
    },

    async checkCode(businessId, input) {
      return answer(businessId, input, null);
    },

    async redeemToday(businessId) {
      const [on, today, clearPay] = await Promise.all([redeemOn(businessId), markedToday(businessId), connected(businessId, "clear_pay")]);
      return { on, redeemedToday: today, clearPay };
    },

    async countUse(businessId, input) {
      const rows = await db
        .select({ code: C, spot: SP })
        .from(C)
        .innerJoin(SP, eq(SP.id, C.spotId))
        .where(and(eq(C.code, input.code.trim().toUpperCase()), eq(SP.advertiserId, businessId)));
      const found = rows[0];
      if (!found) return false;
      const prior = input.customerRef ? await db.select({ id: EV.id }).from(EV).where(and(eq(EV.codeId, found.code.id), eq(EV.kind, "use"), eq(EV.customerRef, input.customerRef))).limit(1) : [];
      const recent = await airedAirings([found.spot.id], new Date(input.at.getTime() - found.code.windowDays * DAY), input.at);
      const [saved] = input.customerRef
        ? await db.select().from(EV).where(and(eq(EV.codeId, found.code.id), eq(EV.kind, "save"), eq(EV.customerRef, input.customerRef))).orderBy(desc(EV.occurredAt)).limit(1)
        : [];
      const latest = recent.sort((a, b) => b.run.startedAt.getTime() - a.run.startedAt.getTime())[0];
      await db.insert(EV).values({
        codeId: found.code.id,
        kind: "use",
        source: input.source,
        airingId: saved?.airingId ?? latest?.airing.id ?? null,
        stationId: saved?.stationId ?? latest?.airing.stationId ?? null,
        customerRef: input.customerRef,
        // Only a customer's first use, within the offer's window after an airing.
        countsAsCustomer: prior.length === 0 && recent.length > 0,
        occurredAt: input.at
      });
      deps.bus.emit("code.used", { businessId, spotId: found.spot.id, code: found.code.code });
      return true;
    },

    async results(businessId, month, period = { period: "month", month }) {
      const spots = await db.select().from(SP).where(eq(SP.advertiserId, businessId));
      const { from, to, shownFrom } = await rangeOf(period, spots);
      const spotIds = spots.map((s) => s.id);
      const aired = await airedAirings(spotIds, from, to);
      const [costs, idents, contexts, events] = await Promise.all([
        services.ledger.costsOfAsRun(aired.map((a) => a.run.id)),
        services.stations.idents(aired.map((a) => a.airing.stationId)),
        services.log.breakContexts(aired.map((a) => a.airing.breakId)),
        spotIds.length
          ? db
              .select({ event: EV, spotId: C.spotId })
              .from(EV)
              .innerJoin(C, eq(C.id, EV.codeId))
              .where(and(inArray(C.spotId, spotIds), gte(EV.occurredAt, from), lt(EV.occurredAt, to)))
          : Promise.resolve([])
      ]);
      const tz = "America/Los_Angeles";
      const airings: Results["airings"] = [];
      for (const { airing, run } of aired) {
        const spot = spots.find((s) => s.id === airing.spotId)!;
        const station = idents.get(airing.stationId);
        if (!station) continue;
        const airedMs = Math.min(run.endedAt.getTime() - run.startedAt.getTime(), spot.lengthSec * 1000);
        const tunedIn = await services.audience.averageTunedIn(airing.stationId, run.startedAt, run.endedAt);
        const cost = costs.get(run.id) ?? 0;
        const partial = airedMs < spot.lengthSec * 1000 - 500;
        const working =
          airing.rateKind === "per_thousand"
            ? `${Math.round(tunedIn)} × ${fmt(airing.rateMicros)} ÷ 1,000${partial ? ` × ${Math.round(airedMs / 1000)}/${spot.lengthSec}s` : ""} = ${fmt(cost)}`
            : `${fmt(airing.rateMicros)} an airing${partial ? ` × ${Math.round(airedMs / 1000)}/${spot.lengthSec}s` : ""} = ${fmt(cost)}`;
        airings.push({
          asRunId: run.id,
          station,
          spot: { id: spot.id, title: spot.title, lengthSec: spot.lengthSec },
          startedAt: run.startedAt.toISOString(),
          endedAt: run.endedAt.toISOString(),
          programContext: contexts.get(airing.breakId) ?? null,
          airedMs,
          inFull: !partial,
          tunedIn: Math.round(tunedIn),
          costMicros: cost,
          working,
          proofFrameUrl: run.proofFrameUrl,
          // P15: why it ran short, and when the proof frame was captured.
          shortReason: partial ? "The break was cut short" : null,
          proofCapturedAt: run.proofFrameAt?.toISOString() ?? null,
          scansNextHour: events.filter(
            (e) =>
              e.event.kind === "scan" &&
              (e.event.airingId === airing.id ||
                (e.event.stationId === airing.stationId && e.event.occurredAt >= run.startedAt && e.event.occurredAt.getTime() < run.startedAt.getTime() + HOUR))
          ).length
        });
      }
      airings.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      const customers = events.filter((e) => e.event.kind === "use" && e.event.countsAsCustomer);
      const byStation = new Map<string, { airings: number; tunedIn: number; spent: number; customers: number }>();
      for (const a of airings) {
        const row = byStation.get(a.station.id) ?? { airings: 0, tunedIn: 0, spent: 0, customers: 0 };
        row.airings++;
        row.tunedIn += a.tunedIn;
        row.spent += a.costMicros;
        byStation.set(a.station.id, row);
      }
      for (const c of customers) {
        if (!c.event.stationId) continue;
        const row = byStation.get(c.event.stationId) ?? { airings: 0, tunedIn: 0, spent: 0, customers: 0 };
        row.customers++;
        byStation.set(c.event.stationId, row);
      }
      const byDaypart = new Map<string, { airings: number; customers: number }>();
      for (const a of airings) {
        const key = daypartOf(new Date(a.startedAt), tz);
        const row = byDaypart.get(key) ?? { airings: 0, customers: 0 };
        row.airings++;
        byDaypart.set(key, row);
      }
      const [stationIdents, profiles] = await Promise.all([services.stations.idents([...byStation.keys()]), services.stations.profiles([...byStation.keys()])]);
      const codes = await codeFunnels(businessId, spots, events, from);
      const today = new Date(Math.min(to.getTime() - 1, deps.clock.now().getTime()));
      return {
        month,
        period: period.period,
        from: (period.period === "all" && airings.length ? new Date(airings[0].startedAt) : (shownFrom ?? from)).toISOString().slice(0, 10),
        to: (today < from ? from : today).toISOString().slice(0, 10),
        codes,
        totals: {
          airings: airings.length,
          // People tuned in, added up across airings: never reach or unique viewers.
          tunedInAddedUp: airings.reduce((s, a) => s + a.tunedIn, 0),
          spentMicros: airings.reduce((s, a) => s + a.costMicros, 0),
          scans: events.filter((e) => e.event.kind === "scan").length,
          saves: events.filter((e) => e.event.kind === "save").length,
          uses: events.filter((e) => e.event.kind === "use").length,
          customers: customers.length
        },
        byStation: [...byStation].flatMap(([id, r]) => {
          const station = stationIdents.get(id);
          return station
            ? [{ station, airings: r.airings, averageTunedIn: r.airings ? Math.round(r.tunedIn / r.airings) : 0, spentMicros: r.spent, customers: r.customers, category: profiles.get(id)?.category ?? null }]
            : [];
        }),
        byDaypart: [...byDaypart].map(([daypart, r]) => ({ daypart, airings: r.airings, customers: r.customers })),
        bySpot: spots
          .map((s) => ({
            spotId: s.id,
            title: s.title,
            airings: airings.filter((a) => a.spot.id === s.id).length,
            spentMicros: airings.filter((a) => a.spot.id === s.id).reduce((sum, a) => sum + a.costMicros, 0),
            customers: customers.filter((c) => c.spotId === s.id).length
          }))
          .filter((s) => s.airings || s.customers),
        airings
      };
    },

    async customersByStation(stationId, month) {
      const { from, to } = monthRange(month);
      const rows = await db
        .select({ spotId: C.spotId })
        .from(EV)
        .innerJoin(C, eq(C.id, EV.codeId))
        .where(and(eq(EV.stationId, stationId), eq(EV.kind, "use"), eq(EV.countsAsCustomer, true), gte(EV.occurredAt, from), lt(EV.occurredAt, to)));
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(r.spotId, (counts.get(r.spotId) ?? 0) + 1);
      return counts;
    },

    async stationCustomers(stationId, month) {
      const counts = await part.customersByStation(stationId, month);
      const spots = counts.size ? await db.select().from(SP).where(inArray(SP.id, [...counts.keys()])) : [];
      const names = await services.spots.businessNames(spots.map((s) => s.advertiserId));
      return spots.map((s) => ({ spotId: s.id, business: names.get(s.advertiserId) ?? "", customers: counts.get(s.id) ?? 0 }));
    }
  };
  return part;
}
