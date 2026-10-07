// The Network desk's analytics (A251 Phase 2, 2026-10-06): the Overview and Stations tabs, read from
// the totals (totals.ts) so any span works, the year's included, and from what's kept for good
// (airing_stats, the ledger, as_run, presets, relays' samples). Admins see every market; a market
// lead sees their own market's stations, whatever they ask; rights reviewers see nothing.

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { AnalyticsBand, AnalyticsMarket, AnalyticsOverview, AnalyticsQuery, AnalyticsScope, AnalyticsStation, AnalyticsStationKind, AnalyticsStationRow, AnalyticsStations, StationIdent } from "@opencast/contracts";
import type { CurrentUser } from "../../http.js";
import type { ModuleContext } from "../../context.js";
import { badRequest, forbidden } from "../../errors.js";
import { dayOf, dayStart, nextDay, type Totals } from "./totals.js";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** The longest span the desk asks for: a year and a little. */
const MAX_SPAN = 400 * DAY;

export interface Analytics {
  overview(user: CurrentUser, query: AnalyticsQuery): Promise<AnalyticsOverview>;
  stations(user: CurrentUser, query: AnalyticsQuery): Promise<AnalyticsStations>;
}

/** How the desk sorts a station kind. */
export function kindOf(kind: string): AnalyticsStationKind {
  if (kind === "listed") return "external";
  if (kind === "claimable") return "claimable";
  if (kind === "catalog") return "catalog";
  return "independent";
}

/** The Pacific days a span covers, first to last (a span ending at midnight doesn't take the next day). */
export function daysIn(from: Date, to: Date): string[] {
  const out: string[] = [];
  const last = dayOf(new Date(to.getTime() - 1));
  for (let d = dayOf(from); d <= last; d = nextDay(d)) out.push(d);
  return out;
}

export function createAnalytics({ deps, services }: ModuleContext, totals: Totals): Analytics {
  const { db } = deps;
  const SH = schema.stationHours;
  const NH = schema.networkHours;

  async function scopeOf(user: CurrentUser, query: AnalyticsQuery) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (!(to > from)) throw badRequest("The span has to end after it starts.");
    if (to.getTime() - from.getTime() > MAX_SPAN) throw badRequest("Ask for up to a year.");
    const all = await services.network.allMarkets();
    let markets: AnalyticsMarket[] = all.map((m) => ({ id: m.id, slug: m.slug, name: m.name }));
    let fixed: string | null = null;
    if (!user.isAdmin) {
      const leads = (await services.settings.rolesOf(user)).filter((g) => g.role === "market_lead" && g.market).map((g) => g.market!.id);
      if (!leads.length) throw forbidden("Analytics are for admins and market leads.");
      markets = markets.filter((m) => leads.includes(m.id));
      fixed = query.market && leads.includes(query.market) ? query.market : leads[0]!;
    }
    const market = fixed ?? (query.market && markets.some((m) => m.id === query.market) ? query.market : null);
    const band: AnalyticsBand = query.band ?? "all";
    const length = to.getTime() - from.getTime();
    const previousFrom = query.previousFrom ? new Date(query.previousFrom) : new Date(from.getTime() - length);
    if (previousFrom.getTime() + length > from.getTime()) throw badRequest("The span compared against has to end before this one starts.");
    const [updated] = await db.select({ at: sql<Date | string | null>`max(${schema.stationDays.computedAt})` }).from(schema.stationDays);
    const scope: AnalyticsScope = {
      from: from.toISOString(),
      to: to.toISOString(),
      previousFrom: previousFrom.toISOString(),
      previousTo: new Date(previousFrom.getTime() + length).toISOString(),
      markets,
      fixedMarket: fixed,
      market,
      band,
      updatedAt: updated?.at ? new Date(updated.at).toISOString() : null
    };
    return { scope, from, to, previousFrom, previousTo: new Date(previousFrom.getTime() + length), market, band, markets };
  }

  /** The stations the filters take in: those on the dial in the market and band, and any with hours in the spans. */
  async function stationsIn(market: string | null, band: AnalyticsBand, from: Date, to: Date, markets: AnalyticsMarket[]) {
    const places = await totals.places();
    const withHours = (await db.selectDistinct({ id: SH.stationId }).from(SH).where(and(gte(SH.hour, from), lt(SH.hour, to)))).map((r) => r.id);
    const ids = [...new Set([...places.keys(), ...withHours])];
    const idents = await services.stations.idents(ids);
    const byId = new Map(markets.map((m) => [m.id, m]));
    const out = new Map<string, AnalyticsStation>();
    for (const id of ids) {
      const ident = idents.get(id) as StationIdent | undefined;
      if (!ident) continue;
      const place = places.get(id) ?? { band: null, marketId: null };
      if (market && place.marketId !== market) continue;
      if (band !== "all" && place.band !== band) continue;
      out.set(id, {
        id,
        callSign: ident.callSign ?? null,
        channel: ident.channel ?? null,
        name: ident.name,
        kind: kindOf(ident.kind),
        band: place.band,
        colour: ident.colour ?? null,
        market: place.marketId ? (byId.get(place.marketId) ?? null) : null
      });
    }
    return out;
  }

  /** The span's end for averages: no later than now (a span running on counts only what's gone). */
  const elapsedMinutes = (from: Date, to: Date) => Math.max(1, (Math.min(to.getTime(), deps.clock.now().getTime()) - from.getTime()) / MINUTE);

  async function stationHours(ids: string[], from: Date, to: Date) {
    if (!ids.length) return [];
    return db.select().from(SH).where(and(inArray(SH.stationId, ids), gte(SH.hour, from), lt(SH.hour, to)));
  }

  async function sessionDays(ids: string[], from: Date, to: Date) {
    const days = daysIn(from, to);
    if (!ids.length || !days.length) return [];
    return db.select().from(schema.stationDays).where(and(inArray(schema.stationDays.stationId, ids), inArray(schema.stationDays.day, days)));
  }

  const round1 = (n: number) => Math.round(n * 10) / 10;

  const service: Analytics = {
    async overview(user, query) {
      const { scope, from, to, previousFrom, previousTo, market, band, markets } = await scopeOf(user, query);
      const stations = await stationsIn(market, band, previousFrom, to, markets);
      const ids = [...stations.keys()];
      const key = `${band}|${market ?? "all"}`;
      const [net, netBefore, hours, hoursBefore, days, daysBefore] = await Promise.all([
        db.select().from(NH).where(and(eq(NH.scope, key), gte(NH.hour, from), lt(NH.hour, to))),
        db.select().from(NH).where(and(eq(NH.scope, key), gte(NH.hour, previousFrom), lt(NH.hour, previousTo))),
        stationHours(ids, from, to),
        stationHours(ids, previousFrom, previousTo),
        sessionDays(ids, from, to),
        sessionDays(ids, previousFrom, previousTo)
      ]);
      const spanDays = daysIn(from, to);
      const tuned = net.reduce((s, r) => s + r.tunedMinutes, 0);
      const tunedBefore = netBefore.reduce((s, r) => s + r.tunedMinutes, 0);
      const peak = net.reduce<{ n: number; at: Date | null }>((p, r) => (r.peak > p.n ? { n: r.peak, at: r.peakAt } : p), { n: 0, at: null });
      const peakBefore = netBefore.reduce((p, r) => Math.max(p, r.peak), 0);
      const minutesOf = elapsedMinutes(from, to);
      const minutesBefore = (previousTo.getTime() - previousFrom.getTime()) / MINUTE;
      const perDay = (rows: Array<{ hour: Date; tunedMinutes: number; peak?: number }>, f: (rs: typeof rows) => number) =>
        spanDays.map((d) => f(rows.filter((r) => dayOf(r.hour) === d)));
      const sessionsOf = (rs: typeof days) => rs.reduce((s, r) => s + r.sessions, 0);
      const botsOf = (rs: typeof days) => rs.reduce((s, r) => s + r.bots, 0);
      // The median session: each station-day's median, weighted by its sessions.
      const medianOf = (rs: typeof days) => {
        const weighted = rs.filter((r) => r.medianMinutes != null && r.sessions > 0);
        const n = weighted.reduce((s, r) => s + r.sessions, 0);
        return n ? round1(weighted.reduce((s, r) => s + r.medianMinutes! * r.sessions, 0) / n) : null;
      };
      // Devices counted once: a day's, 7 days', 30 days' as kept; a longer span can't be counted once.
      const length = to.getTime() - from.getTime();
      const deviceRows = await db.select().from(schema.deviceDays).where(and(eq(schema.deviceDays.scope, key), inArray(schema.deviceDays.day, [...new Set([...daysIn(previousFrom, previousTo), ...daysIn(from, to)])])));
      const lastDay = dayOf(new Date(Math.min(to.getTime(), deps.clock.now().getTime()) - 1));
      const lastBefore = dayOf(new Date(previousTo.getTime() - 1));
      const devicesAt = (day: string) => {
        const r = deviceRows.find((x) => String(x.day) === day);
        if (!r) return null;
        return length <= DAY + HOUR ? r.devices : length <= 7 * DAY + HOUR ? r.devices7 : length <= 30 * DAY + HOUR ? r.devices30 : null;
      };

      // The hour-by-hour line, with the span before at the same point.
      const hourly = new Map(net.map((r) => [r.hour.getTime(), r.tunedMinutes / 60]));
      const hourlyBefore = new Map(netBefore.map((r) => [r.hour.getTime(), r.tunedMinutes / 60]));
      const series: AnalyticsOverview["tunedIn"] = [];
      const until = Math.min(to.getTime(), deps.clock.now().getTime());
      const shift = from.getTime() - previousFrom.getTime();
      for (let t = Math.floor(from.getTime() / HOUR) * HOUR; t < until; t += HOUR) {
        series.push({ at: new Date(t).toISOString(), value: round1(hourly.get(t) ?? 0), previous: t - shift < previousTo.getTime() ? round1(hourlyBefore.get(t - shift) ?? 0) : null });
      }

      const platformMinutes = { phone: 0, cast: 0, web: 0, tv_app: 0, mirror: 0 };
      for (const r of hours) {
        platformMinutes.phone += r.phone;
        platformMinutes.cast += r.cast;
        platformMinutes.web += r.web;
        platformMinutes.tv_app += r.tvApp;
        platformMinutes.mirror += r.mirror;
      }
      const placeRows = ids.length
        ? await db
            .select({ market: schema.stationHourPlaces.market, minutes: sql<number>`sum(${schema.stationHourPlaces.tunedMinutes})::int` })
            .from(schema.stationHourPlaces)
            .where(and(inArray(schema.stationHourPlaces.stationId, ids), gte(schema.stationHourPlaces.hour, from), lt(schema.stationHourPlaces.hour, to)))
            .groupBy(schema.stationHourPlaces.market)
        : [];
      const allMarkets = new Map((await services.network.allMarkets()).map((m) => [m.id, { id: m.id, slug: m.slug, name: m.name }]));

      const byStation = (rows: typeof hours) => {
        const m = new Map<string, number>();
        for (const r of rows) m.set(r.stationId, (m.get(r.stationId) ?? 0) + r.tunedMinutes);
        return m;
      };
      const now = byStation(hours);
      const before = byStation(hoursBefore);
      const stationList = [...stations.values()]
        .map((station) => ({ station, hours: round1((now.get(station.id) ?? 0) / 60), previousHours: before.has(station.id) ? round1(before.get(station.id)! / 60) : null }))
        .sort((a, b) => b.hours - a.hours || (a.station.channel ?? "").localeCompare(b.station.channel ?? ""));

      // Relays: each platform's own count, never in the totals.
      const translators = await services.stations.relaysOf(ids);
      const relays: AnalyticsOverview["relays"] = [];
      for (const t of translators) {
        if (t.service === "rtmp") continue;
        const [r] = await db
          .select({ avg: sql<number | null>`avg(${schema.translatorSamples.viewers})::float`, peak: sql<number | null>`max(${schema.translatorSamples.viewers})` })
          .from(schema.translatorSamples)
          .where(and(eq(schema.translatorSamples.translatorId, t.id), gte(schema.translatorSamples.minute, from), lt(schema.translatorSamples.minute, to)));
        if (r?.avg == null) continue;
        relays.push({ station: stations.get(t.stationId)!, platform: t.service, averageViewers: round1(r.avg), peakViewers: Number(r.peak ?? 0) });
      }

      return {
        scope,
        hoursWatched: { value: round1(tuned / 60), previous: netBefore.length ? round1(tunedBefore / 60) : null, byDay: perDay(net, (rs) => round1(rs.reduce((s, r) => s + r.tunedMinutes, 0) / 60)) },
        averageTunedIn: {
          value: round1(tuned / minutesOf),
          previous: netBefore.length ? round1(tunedBefore / minutesBefore) : null,
          byDay: perDay(net, (rs) => round1(rs.reduce((s, r) => s + r.tunedMinutes, 0) / (24 * 60)))
        },
        peakTunedIn: { value: peak.n, previous: netBefore.length ? peakBefore : null, at: peak.at ? peak.at.toISOString() : null, byDay: perDay(net, (rs) => rs.reduce((p, r) => Math.max(p, r.peak ?? 0), 0)) },
        sessions: { value: sessionsOf(days), previous: daysBefore.length ? sessionsOf(daysBefore) : null, botsFiltered: botsOf(days), byDay: spanDays.map((d) => sessionsOf(days.filter((r) => String(r.day) === d))) },
        medianSessionMinutes: { value: medianOf(days), previous: medianOf(daysBefore), byDay: spanDays.map((d) => medianOf(days.filter((r) => String(r.day) === d)) ?? 0) },
        devices: { value: devicesAt(lastDay), previous: devicesAt(lastBefore), byDay: spanDays.map((d) => deviceRows.find((x) => String(x.day) === d)?.devices ?? 0) },
        tunedIn: series,
        platforms: (Object.entries(platformMinutes) as Array<[keyof typeof platformMinutes, number]>).map(([platform, m]) => ({ platform, hours: round1(m / 60) })).sort((a, b) => b.hours - a.hours),
        places: placeRows
          .map((p) => ({ market: p.market ? (allMarkets.get(p.market) ?? null) : null, hours: round1(p.minutes / 60) }))
          .sort((a, b) => b.hours - a.hours),
        stations: stationList,
        relays
      };
    },

    async stations(user, query) {
      const { scope, from, to, previousFrom, previousTo, market, band, markets } = await scopeOf(user, query);
      const stations = await stationsIn(market, band, previousFrom, to, markets);
      const ids = [...stations.keys()];
      const key = `${band}|${market ?? "all"}`;
      const now = deps.clock.now();
      const [hours, hoursBefore, days, net, presets, minimum, stats, deadAir, outages, earned] = await Promise.all([
        stationHours(ids, from, to),
        stationHours(ids, previousFrom, previousTo),
        sessionDays(ids, from, to),
        db.select().from(NH).where(and(eq(NH.scope, key), gte(NH.hour, from), lt(NH.hour, to))),
        services.accounts.presetCounts(ids),
        services.settings.valueAt("watch_data.minimum_audience", now),
        ids.length
          ? db
              .select({
                stationId: schema.airingStats.stationId,
                atStart: sql<number>`sum(${schema.airingStats.audienceAtStart})::int`,
                stayed: sql<number>`sum(${schema.airingStats.stayedToEnd})::int`,
                votes: sql<number>`sum(${schema.airingStats.notForMe})::int`,
                watchSeconds: sql<number>`sum(${schema.airingStats.watchSeconds})::float`
              })
              .from(schema.airingStats)
              .where(and(inArray(schema.airingStats.stationId, ids), gte(schema.airingStats.startedAt, from), lt(schema.airingStats.startedAt, to)))
              .groupBy(schema.airingStats.stationId)
          : Promise.resolve([]),
        services.playout.fillMinutes(ids, from, to),
        services.network.outageMinutes(ids, from, to),
        services.ledger.earnedBetween(ids, from, to)
      ]);
      const spanDays = daysIn(from, to);
      const minutesOf = elapsedMinutes(from, to);
      const statOf = new Map(stats.map((s) => [s.stationId, s]));
      const deadOf = deadAir;
      const earnedOf = earned;
      const downOf = outages;

      const rows: AnalyticsStationRow[] = [...stations.values()].map((station) => {
        const mine = hours.filter((h) => h.stationId === station.id);
        const tuned = mine.reduce((s, h) => s + h.tunedMinutes, 0);
        const before = hoursBefore.filter((h) => h.stationId === station.id);
        const peak = mine.reduce((p, h) => Math.max(p, h.peak), 0);
        const underMinimum = peak < minimum.viewers;
        const stat = statOf.get(station.id);
        const external = station.kind === "external";
        const watchHours = (stat?.watchSeconds ?? 0) / 3600;
        return {
          station,
          hours: round1(tuned / 60),
          previousHours: before.length ? round1(before.reduce((s, h) => s + h.tunedMinutes, 0) / 60) : null,
          averageTunedIn: round1(tuned / minutesOf),
          peakTunedIn: peak,
          sessions: days.filter((d) => d.stationId === station.id).reduce((s, d) => s + d.sessions, 0),
          stayedToTheEnd: !underMinimum && stat && stat.atStart > 0 ? Math.round((stat.stayed / stat.atStart) * 100) : null,
          notForMePer1000Hours: !underMinimum && stat && watchHours > 0 ? round1((stat.votes / watchHours) * 1000) : null,
          presets: presets.get(station.id) ?? 0,
          deadAirMinutes: external ? null : (deadOf.get(station.id) ?? 0),
          timeDownMinutes: external ? (downOf.get(station.id) ?? 0) : null,
          earnedMicros: external ? null : (earnedOf.get(station.id) ?? 0),
          held: station.kind === "claimable",
          underMinimum,
          byDay: spanDays.map((d) => round1(mine.filter((h) => dayOf(h.hour) === d).reduce((s, h) => s + h.tunedMinutes, 0) / 60))
        };
      });
      rows.sort((a, b) => b.hours - a.hours || (a.station.channel ?? "").localeCompare(b.station.channel ?? ""));

      // The network row: hours and sessions added up, Stayed and "Not for me" weighted by hours,
      // the network's own busiest minute.
      const sum = (f: (r: AnalyticsStationRow) => number) => rows.reduce((s, r) => s + f(r), 0);
      const weighted = (f: (r: AnalyticsStationRow) => number | null) => {
        const counted = rows.filter((r) => f(r) != null && r.hours > 0);
        const h = counted.reduce((s, r) => s + r.hours, 0);
        return h ? round1(counted.reduce((s, r) => s + f(r)! * r.hours, 0) / h) : null;
      };
      const tunedAll = net.reduce((s, r) => s + r.tunedMinutes, 0);
      const anyBefore = rows.some((r) => r.previousHours != null);
      return {
        scope,
        rows,
        total: {
          hours: round1(sum((r) => r.hours)),
          previousHours: anyBefore ? round1(sum((r) => r.previousHours ?? 0)) : null,
          averageTunedIn: round1(tunedAll / minutesOf),
          peakTunedIn: net.reduce((p, r) => Math.max(p, r.peak), 0),
          sessions: sum((r) => r.sessions),
          stayedToTheEnd: weighted((r) => r.stayedToTheEnd),
          notForMePer1000Hours: weighted((r) => r.notForMePer1000Hours),
          presets: sum((r) => r.presets),
          deadAirMinutes: sum((r) => r.deadAirMinutes ?? 0),
          earnedMicros: sum((r) => r.earnedMicros ?? 0),
          byDay: spanDays.map((_, i) => round1(sum((r) => r.byDay[i] ?? 0)))
        }
      };
    }
  };
  return service;
}
