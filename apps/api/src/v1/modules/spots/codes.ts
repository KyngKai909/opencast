// On-screen codes and what they bring in: QR scans, offers saved to a phone, and
// uses at the counter. A use counts as a customer only within the offer's window
// after an airing. Stations see customers from their own airings only.
// Results for businesses come from the as-run log, never the planned log.

import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Results, StationIdent } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { notFound } from "../../errors.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;

export interface CodesPart {
  scan(code: string, input: { stationId?: string; airingId?: string }): Promise<{ business: string; offer: string }>;
  saveOffer(code: string, input: { stationId?: string; customerRef?: string }): Promise<{ savedUntil: string; savedFrom: StationIdent | null }>;
  redeem(businessId: string, userId: string, input: { code: string; customerRef?: string }): Promise<{ valid: boolean; firstUse: boolean; countsAsCustomer: boolean; savedFrom: StationIdent | null; message: string }>;
  results(businessId: string, month: string): Promise<Results>;
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
      const rows = await db
        .select({ code: C, spot: SP })
        .from(C)
        .innerJoin(SP, eq(SP.id, C.spotId))
        .where(and(eq(C.code, input.code.toUpperCase()), eq(SP.advertiserId, businessId)));
      const found = rows[0];
      if (!found) return { valid: false, firstUse: false, countsAsCustomer: false, savedFrom: null, message: "That isn't one of your codes." };
      const now = deps.clock.now();
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
      await db.insert(EV).values({
        codeId: found.code.id,
        kind: "use",
        source: "marked_used",
        airingId: saved?.airingId ?? latest?.airing.id ?? null,
        stationId,
        customerRef: input.customerRef ?? null,
        countsAsCustomer,
        markedBy: userId,
        occurredAt: now
      });
      deps.bus.emit("code.used", { businessId, spotId: found.spot.id, code: found.code.code });
      const savedFrom = stationId ? ((await services.stations.idents([stationId])).get(stationId) ?? null) : null;
      return {
        valid: true,
        firstUse,
        countsAsCustomer,
        savedFrom,
        message: !firstUse ? "Already used by this customer." : countsAsCustomer ? "First use. It counts as a customer." : `First use, but not within ${found.code.windowDays} days of an airing.`
      };
    },

    async results(businessId, month) {
      const { from, to } = monthRange(month);
      const spots = await db.select().from(SP).where(eq(SP.advertiserId, businessId));
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
        const partial = airedMs < spot.lengthSec * 1000 - 100;
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
      const stationIdents = await services.stations.idents([...byStation.keys()]);
      return {
        month,
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
          return station ? [{ station, airings: r.airings, averageTunedIn: r.airings ? Math.round(r.tunedIn / r.airings) : 0, spentMicros: r.spent, customers: r.customers }] : [];
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
