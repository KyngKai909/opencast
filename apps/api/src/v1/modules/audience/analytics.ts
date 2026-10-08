// The Network desk's analytics (A251 Phase 2, 2026-10-06): the Overview and Stations tabs, read from
// the totals (totals.ts) so any span works, the year's included, and from what's kept for good
// (airing_stats, the ledger, as_run, presets, relays' samples). Admins see every market; a market
// lead sees their own market's stations, whatever they ask; rights reviewers see nothing.

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { AnalyticsGrowth, AnalyticsHealth, AnalyticsMoney, AnalyticsAiring, AnalyticsAudience, AnalyticsAudienceQuery, AnalyticsBand, AnalyticsBreakHold, AnalyticsProgram, AnalyticsProgramDetail, AnalyticsPrograms, AnalyticsFlow, AnalyticsMarket, AnalyticsOverview, AnalyticsQuery, AnalyticsScope, AnalyticsStation, AnalyticsStationKind, AnalyticsStationFile, AnalyticsStationPage, AnalyticsStationRow, AnalyticsStations, StationIdent } from "@opencast/contracts";
import type { CurrentUser } from "../../http.js";
import type { ModuleContext } from "../../context.js";
import { badRequest, forbidden, notFound } from "../../errors.js";
import { LENGTH_BUCKETS, dayOf, dayStart, nextDay, type Totals } from "./totals.js";

/** The busiest night's window: 6 pm to 2 am, the market's time. */
const NIGHT_FROM_HOUR = 18;
const NIGHT_HOURS = 8;

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** The longest span the desk asks for: a year and a little. */
const MAX_SPAN = 400 * DAY;

export interface Analytics {
  overview(user: CurrentUser, query: AnalyticsQuery): Promise<AnalyticsOverview>;
  stations(user: CurrentUser, query: AnalyticsQuery): Promise<AnalyticsStations>;
  /** The Health tab (Ref. 12d 07). */
  health(user: CurrentUser, query: AnalyticsQuery): Promise<AnalyticsHealth>;
  /** The Growth tab (A251). */
  growth(user: CurrentUser, query: AnalyticsQuery): Promise<AnalyticsGrowth>;
  /** The Money tab (Ref. 12d 06). */
  money(user: CurrentUser, query: AnalyticsQuery): Promise<AnalyticsMoney>;
  /** The Programs and breaks tab (Ref. 12d 05). */
  programs(user: CurrentUser, query: AnalyticsQuery): Promise<AnalyticsPrograms>;
  /** One program's airings in the span, still watching by the minute. */
  program(user: CurrentUser, programId: string, query: AnalyticsQuery): Promise<AnalyticsProgramDetail>;
  /** The Audience tab (Ref. 12d 04), the network or one station. */
  audience(user: CurrentUser, query: AnalyticsAudienceQuery): Promise<AnalyticsAudience>;
  /** One station's page (Ref. 12d 03); a market lead only for a station in their market. */
  station(user: CurrentUser, stationId: string, query: Omit<AnalyticsQuery, "market" | "band">): Promise<AnalyticsStationPage>;
  /** The desk's station file (added 2026-10-07): who made it, its people, uploads and log ahead. */
  stationFile(user: CurrentUser, stationId: string): Promise<AnalyticsStationFile>;
  /** Added 2026-10-07, admins only: take a station off the air and hold it there, lift that, or archive one of its uploads. */
  takeOffAir(user: CurrentUser, stationId: string, reason: string): Promise<AnalyticsStationFile>;
  liftHold(user: CurrentUser, stationId: string): Promise<AnalyticsStationFile>;
  archiveUpload(user: CurrentUser, stationId: string, itemId: string, reason: string): Promise<AnalyticsStationFile>;
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

  const service = {
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
      // The busiest minute; on a tie, the first.
      const peak = net.reduce<{ n: number; at: Date | null }>((p, r) => (r.peak > p.n || (r.peak === p.n && r.peakAt && p.at && r.peakAt < p.at) ? { n: r.peak, at: r.peakAt } : p), { n: 0, at: null });
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
  } as Analytics;
  service.health = async (user, query) => {
    const { scope, from, to, previousFrom, previousTo, market, band, markets } = await scopeOf(user, query);
    const stations = await stationsIn(market, band, previousFrom, to, markets);
    const ids = [...stations.keys()];
    const ours = ids.filter((id) => stations.get(id)!.kind !== "external");
    const external = ids.filter((id) => stations.get(id)!.kind === "external");
    const [airtime, airtimeBefore, runs, relays, relaysBefore, outages, days, daysBefore] = await Promise.all([
      services.playout.airtimeByStation(ours, from, to),
      services.playout.airtimeByStation(ours, previousFrom, previousTo),
      services.playout.fillRuns(ours, from, to),
      services.playout.relayHealth(ids, from, to),
      services.playout.relayHealth(ids, previousFrom, previousTo),
      services.network.outagesBetween(external, from, to),
      sessionDays(ids, from, to),
      sessionDays(ids, previousFrom, previousTo)
    ]);
    const total = (m: typeof airtime, k: "deadAirFill" | "slate") => [...m.values()].reduce((t, a) => t + a[k], 0);
    const withSome = (k: "deadAirFill" | "slate") => [...airtime.values()].filter((a) => a[k] > 0).length;
    // How many were tuned in when each incident began (the minute it started, from session minutes).
    const tunedAt = async (stationId: string, at: Date) => {
      const minute = new Date(Math.floor(at.getTime() / MINUTE) * MINUTE);
      const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.sessionMinutes).where(and(eq(schema.sessionMinutes.stationId, stationId), eq(schema.sessionMinutes.minute, minute)));
      return r?.n ?? 0;
    };
    const now = deps.clock.now();
    const incidents: AnalyticsHealth["incidents"] = [];
    for (const r of runs.slice(-60))
      incidents.push({ at: r.start.toISOString(), station: stations.get(r.stationId)!, kind: r.kind === "slate" ? "slate" : "dead_air", minutes: Math.max(1, Math.round((r.end.getTime() - r.start.getTime()) / MINUTE)), tunedIn: await tunedAt(r.stationId, r.start), detail: null });
    for (const d of relays.drops.slice(-30)) incidents.push({ at: d.at.toISOString(), station: stations.get(d.stationId)!, kind: "relay", minutes: null, tunedIn: null, detail: d.error });
    for (const o of outages) {
      const a = Math.max(o.downSince.getTime(), from.getTime());
      const b = Math.min((o.backAt ?? now).getTime(), to.getTime());
      incidents.push({ at: o.downSince.toISOString(), station: stations.get(o.stationId)!, kind: "external", minutes: Math.max(0, Math.round((b - a) / MINUTE)), tunedIn: await tunedAt(o.stationId, o.downSince), detail: o.backAt ? null : "Still down" });
    }
    incidents.sort((x, y) => x.at.localeCompare(y.at));
    const downBy = new Map<string, number>();
    for (const i of incidents) if (i.kind === "external") downBy.set(i.station.id, (downBy.get(i.station.id) ?? 0) + (i.minutes ?? 0));

    // Bots, and press to picture, from the nightly totals.
    const counted = days.reduce((t, d) => t + d.sessions, 0);
    const bots = days.reduce((t, d) => t + d.bots, 0);
    const countedBefore = daysBefore.reduce((t, d) => t + d.sessions, 0);
    const botsBefore = daysBefore.reduce((t, d) => t + d.bots, 0);
    const reasons = new Map<string, number>();
    for (const d of days) for (const [k, n] of Object.entries(d.botReasons)) reasons.set(k, (reasons.get(k) ?? 0) + n);
    const weighted = (rs: typeof days, f: (r: (typeof days)[number]) => number | null) => {
      const w = rs.filter((r) => f(r) != null && r.sessions > 0);
      const n = w.reduce((t, r) => t + r.sessions, 0);
      return n ? Math.round(w.reduce((t, r) => t + f(r)! * r.sessions, 0) / n) : null;
    };
    const perStation = new Map<string, typeof days>();
    for (const d of days) perStation.set(d.stationId, [...(perStation.get(d.stationId) ?? []), d]);
    const slowest = [...perStation]
      .map(([id, rs]) => ({ station: stations.get(id)!, medianMs: weighted(rs, (r) => r.tuneMsMedian), p90Ms: weighted(rs, (r) => r.tuneMsP90), sessions: rs.reduce((t, r) => t + r.sessions, 0) }))
      .filter((r) => r.station && r.medianMs != null && r.sessions >= 5)
      .sort((a, b) => b.medianMs! - a.medianMs!)
      .slice(0, 5)
      .map((r) => ({ station: r.station, medianMs: r.medianMs!, p90Ms: r.p90Ms }));
    return {
      scope,
      deadAirFill: { minutes: total(airtime, "deadAirFill"), previous: airtimeBefore.size ? total(airtimeBefore, "deadAirFill") : null, stations: withSome("deadAirFill") },
      slate: { minutes: total(airtime, "slate"), previous: airtimeBefore.size ? total(airtimeBefore, "slate") : null, stations: withSome("slate") },
      relayDrops: { drops: relays.drops.length, previous: relaysBefore.sessions ? relaysBefore.drops.length : null },
      bots: { sessions: bots, share: counted + bots ? round1((bots / (counted + bots)) * 100) : null, previousShare: countedBefore + botsBefore ? round1((botsBefore / (countedBefore + botsBefore)) * 100) : null },
      pressToPicture: { medianMs: weighted(days, (r) => r.tuneMsMedian), p90Ms: weighted(days, (r) => r.tuneMsP90), previousMedianMs: weighted(daysBefore, (r) => r.tuneMsMedian) },
      airtime: ours
        .map((id) => ({ station: stations.get(id)!, ...(airtime.get(id) ?? { programs: 0, breaks: 0, live: 0, offAir: 0, deadAirFill: 0, slate: 0 }) }))
        .filter((a) => a.programs + a.breaks + a.live + a.offAir + a.deadAirFill + a.slate > 0)
        .sort((a, b) => b.deadAirFill + b.slate - (a.deadAirFill + a.slate) || (a.station.channel ?? "").localeCompare(b.station.channel ?? "")),
      externalDown: external.map((id) => ({ station: stations.get(id)!, minutes: downBy.get(id) ?? 0 })),
      incidents,
      relays: { stations: relays.stations, sessions: relays.sessions, hours: relays.hours, drops: relays.drops.length },
      botReasons: [...reasons].map(([reason, n]) => ({ reason, sessions: n, share: bots ? round1((n / bots) * 100) : 0 })).sort((a, b) => b.sessions - a.sessions),
      slowest
    };
  };

  service.growth = async (user, query) => {
    const { scope, from, to, previousFrom, previousTo, market, band, markets } = await scopeOf(user, query);
    const stations = await stationsIn(market, band, previousFrom, to, markets);
    const ids = market || band !== "all" ? [...stations.keys()] : null;
    const marketIds = scope.fixedMarket ? [scope.fixedMarket] : market ? [market] : null;
    const [accounts, accountsBefore, started, startedBefore, network, tvs, uploads, uploadsBefore] = await Promise.all([
      services.accounts.growth(from, to),
      services.accounts.growth(previousFrom, previousTo),
      services.stations.growth(from, to),
      services.stations.growth(previousFrom, previousTo),
      services.network.growth(marketIds, from, to),
      services.tv.growth(from, to),
      services.library.uploadsBetween(ids, from, to),
      services.library.uploadsBetween(ids, previousFrom, previousTo)
    ]);
    // Searches viewers settled on (kept 90 days).
    const S = schema.searches;
    const terms = await db
      .select({ term: S.term, n: sql<number>`count(*)::int`, results: sql<number>`max(${S.results})::int` })
      .from(S)
      .where(and(gte(S.at, from), lt(S.at, to)))
      .groupBy(S.term)
      .orderBy(sql`count(*) desc`)
      .limit(200);
    const spanDays = daysIn(from, to);
    return {
      scope,
      accounts: { new: accounts.newAccounts, previous: accountsBefore.newAccounts, active: accounts.activeAccounts, byDay: spanDays.map((d) => accounts.newByDay.get(d) ?? 0) },
      stations: { started: started.started, previousStarted: Object.values(startedBefore.started).reduce((t, n) => t + n, 0), signedOn: started.signedOn },
      pipeline: {
        byStage: ["found", "asked", "said_yes", "setting_up", "on_air", "claimed", "already_licensed", "declined", "no_answer"].map((stage) => ({ stage, creators: network.pipeline[stage] ?? 0 })).filter((s) => s.creators > 0),
        added: network.addedToPipeline
      },
      markets: { open: network.marketsOpen, opened: network.marketsOpened },
      tvs: { new: Object.entries(tvs.newTvs).map(([platform, n]) => ({ platform, tvs: n })).sort((a, b) => b.tvs - a.tvs), active: tvs.activeTvs, phonesPaired: tvs.phonesPaired },
      uploads: { items: uploads.items, programItems: uploads.programItems, hours: uploads.hours, previousItems: uploadsBefore.items },
      searches: {
        total: terms.reduce((t, r) => t + r.n, 0),
        noResults: terms.filter((r) => r.results === 0).reduce((t, r) => t + r.n, 0),
        top: terms.slice(0, 10).map((r) => ({ term: r.term, searches: r.n, results: r.results })),
        nothingFound: terms.filter((r) => r.results === 0).slice(0, 10).map((r) => ({ term: r.term, searches: r.n }))
      }
    };
  };

  /** What running Opencast cost over a span, estimated from what was used and the Costs rules (null while a price isn't set). */
  async function costs(at: Date, used: { gbDays: number; prepareMinutes: number; relayHours: number; liveHours: number; days: number }) {
    const [storage, preparing, relays, live, platform] = await Promise.all([
      services.settings.valueAt("costs.storage", at),
      services.settings.valueAt("costs.preparing", at),
      services.settings.valueAt("costs.relays", at),
      services.settings.valueAt("costs.live", at),
      services.settings.valueAt("costs.platform", at)
    ]);
    const times = (price: number | null, n: number) => (price == null ? null : Math.round(price * n));
    return {
      storage: times(storage.costPerGbMonthMicros, used.gbDays / 30),
      preparing: times(preparing.costPerMinuteMicros, used.prepareMinutes),
      relays: times(relays.costPerHourMicros, used.relayHours),
      live: times(live.costPerHourMicros, used.liveHours),
      platform: times(platform.costPerWeekMicros, used.days / 7)
    };
  }

  service.money = async (user, query) => {
    const { scope, from, to, previousFrom, previousTo, market, band, markets } = await scopeOf(user, query);
    const stations = await stationsIn(market, band, previousFrom, to, markets);
    const ids = [...stations.keys()];
    const now = deps.clock.now();
    const kindOfId = (id: string) => stations.get(id)?.kind;
    // Earnings: this span, the one before, and the 8 weeks to the span's end.
    const weeksFrom = new Date(to.getTime() - 8 * 7 * DAY);
    const [rows, rowsBefore, weekRows] = await Promise.all([
      services.ledger.earningRows(ids, from, to),
      services.ledger.earningRows(ids, previousFrom, previousTo),
      services.ledger.earningRows(ids, weeksFrom, to)
    ]);
    const net = (r: (typeof rows)[number]) => r.spots + r.sponsors + r.pledges + r.carriageIn + r.cardFees;
    const sumOf = (list: typeof rows, kinds: Array<string | undefined>, f = net) => list.filter((r) => kinds.includes(kindOfId(r.stationId))).reduce((t, r) => t + f(r), 0);
    const spanDays = daysIn(from, to);
    const byDay = (list: typeof rows, kinds: Array<string | undefined>) => spanDays.map((d) => sumOf(list.filter((r) => r.day === d), kinds));
    const independent = ["independent"];
    const measure = (kinds: string[]) => ({ value: sumOf(rows, kinds), previous: rowsBefore.length ? sumOf(rowsBefore, kinds) : null, byDay: byDay(rows, kinds) });

    // Pay-as-you-go and what Opencast's own running cost, estimated.
    const days = Math.max(1, (Math.min(to.getTime(), now.getTime()) - from.getTime()) / DAY);
    const daysBefore = Math.max(1, (previousTo.getTime() - previousFrom.getTime()) / DAY);
    const [usage, usageBefore, prepare, prepareBefore, share, shareRule] = await Promise.all([
      services.ledger.usageTotals(ids, from, to),
      services.ledger.usageTotals(ids, previousFrom, previousTo),
      services.playout.prepareMinutes(from, to),
      services.playout.prepareMinutes(previousFrom, previousTo),
      services.ledger.opencastShareBetween(from, to),
      services.settings.valueAt("shares.opencast", now)
    ]);
    const shareSet = !!(shareRule.spotBps || shareRule.pledgeBps || shareRule.productionBps);
    const out = await costs(now, { gbDays: usage.storage.gbDays, prepareMinutes: prepare, relayHours: usage.relays.hours, liveHours: usage.live.hours, days });
    const outBefore = await costs(now, { gbDays: usageBefore.storage.gbDays, prepareMinutes: prepareBefore, relayHours: usageBefore.relays.hours, liveHours: usageBefore.live.hours, days: daysBefore });
    const sumCosts = (c: typeof out) => Object.values(c).reduce((t: number, v) => t + (v ?? 0), 0);
    const charges = usage.storage.chargeMicros + usage.relays.chargeMicros + usage.live.chargeMicros;
    const chargesBefore = usageBefore.storage.chargeMicros + usageBefore.relays.chargeMicros + usageBefore.live.chargeMicros;

    // The spot market.
    const [aired, airedBefore, breakRows, held, hoursRows] = await Promise.all([
      services.playout.spotsAired(ids, from, to),
      services.playout.spotsAired(ids, previousFrom, previousTo),
      ids.length ? db.select({ spots: schema.breakStats.spots }).from(schema.breakStats).where(and(inArray(schema.breakStats.stationId, ids), gte(schema.breakStats.startedAt, from), lt(schema.breakStats.startedAt, to))) : Promise.resolve([]),
      services.spots.heldForPlaced(ids, to, new Date(to.getTime() + 7 * DAY)),
      stationHours(ids, from, to)
    ]);
    const [stats, statsBefore] = await Promise.all([services.spots.spotStats(aired), services.spots.spotStats(airedBefore)]);

    // Per 1,000 hours: spots and sponsors over hours watched.
    const tunedOf = new Map<string, number>();
    for (const h of hoursRows) tunedOf.set(h.stationId, (tunedOf.get(h.stationId) ?? 0) + h.tunedMinutes);
    const per1000Hours = ids
      .filter((id) => kindOfId(id) !== "external" && (tunedOf.get(id) ?? 0) > 0)
      .map((id) => {
        const ad = rows.filter((r) => r.stationId === id).reduce((t, r) => t + r.spots + r.sponsors, 0);
        return { station: stations.get(id)!, micros: Math.round((ad / (tunedOf.get(id)! / 60)) * 1000), held: kindOfId(id) === "claimable" };
      })
      .sort((a, b) => b.micros - a.micros);

    // Held for claimable stations.
    const claimable = ids.filter((id) => kindOfId(id) === "claimable");
    const [balances, since] = await Promise.all([services.ledger.escrowBalances(claimable), services.ledger.escrowSince(claimable)]);
    const heldRows = claimable
      .map((id) => {
        const b = balances.get(id) ?? { owed: 0, held: 0 };
        return { station: stations.get(id)!, since: since.get(id)?.toISOString() ?? null, balanceMicros: Math.round(b.owed + b.held), addedMicros: rows.filter((r) => r.stationId === id).reduce((t, r) => t + net(r), 0) };
      })
      .filter((r) => r.balanceMicros || r.addedMicros)
      .sort((a, b) => b.balanceMicros - a.balanceMicros);

    // Carriage: between stations, never in the totals.
    const [carriage, barterMinutes] = await Promise.all([services.ledger.carriageVolume(from, to), services.log.barterMinutes(ids, from, to)]);
    const [carried] = ids.length
      ? await db
          .select({ n: sql<number>`count(distinct ${schema.airingStats.programId})::int` })
          .from(schema.airingStats)
          .where(and(inArray(schema.airingStats.stationId, ids), eq(schema.airingStats.carried, true), gte(schema.airingStats.startedAt, from), lt(schema.airingStats.startedAt, to)))
      : [{ n: 0 }];

    const weeks = Array.from({ length: 8 }, (_, i) => {
      const a = new Date(weeksFrom.getTime() + i * 7 * DAY);
      const b = new Date(a.getTime() + 7 * DAY);
      const inWeek = weekRows.filter((r) => {
        const t = dayStart(r.day).getTime();
        return t >= a.getTime() && t < b.getTime();
      });
      const notCatalog = inWeek.filter((r) => kindOfId(r.stationId) !== "catalog");
      return {
        from: a.toISOString(),
        spots: notCatalog.reduce((t, r) => t + r.spots, 0),
        sponsors: notCatalog.reduce((t, r) => t + r.sponsors, 0),
        pledges: notCatalog.reduce((t, r) => t + r.pledges, 0),
        catalogSponsors: inWeek.filter((r) => kindOfId(r.stationId) === "catalog").reduce((t, r) => t + r.spots + r.sponsors + r.pledges, 0)
      };
    });
    const costValues = Object.values(out);
    return {
      scope,
      shareSet,
      earnedByStations: measure(independent),
      heldForClaimable: { ...measure(["claimable"]), stations: claimable.length },
      catalogSponsors: measure(["catalog"]),
      payAsYouGo: { value: charges, previous: chargesBefore, byDay: [] },
      costToRun: { value: sumCosts(out), previous: sumCosts(outBefore), byDay: [], complete: costValues.every((v) => v != null) },
      weeks,
      spotMarket: {
        breaksAired: breakRows.length,
        breaksWithSpots: breakRows.filter((b) => b.spots > 0).length,
        spotsAired: aired.length,
        spotsAiredBefore: airedBefore.length,
        perThousandMicros: stats.perThousandMicros,
        businesses: stats.businesses,
        businessesBefore: statsBefore.businesses,
        heldNextWeekMicros: Math.round(held)
      },
      per1000Hours,
      opencast: {
        in: { storage: usage.storage.chargeMicros, relays: usage.relays.chargeMicros, live: usage.live.chargeMicros, share: shareSet ? share : null },
        out,
        net: charges + (shareSet ? share : 0) - sumCosts(out),
        measured: { storageGb: round1(usage.storage.gbDays / days), prepareMinutes: prepare, relayHours: round1(usage.relays.hours), liveHours: round1(usage.live.hours) }
      },
      held: heldRows,
      carriage: { agreements: carriage.agreements, cashMicros: carriage.cashMicros, barterMicros: carriage.barterMicros, barterMinutes, programsCarried: carried?.n ?? 0 }
    };
  };

  /** The span's airings of programs in the view (stations in it), and what each program adds up to. */
  async function programsIn(user: CurrentUser, query: AnalyticsQuery, only?: string) {
    const { scope, from, to, previousFrom, market, band, markets } = await scopeOf(user, query);
    const stations = await stationsIn(market, band, previousFrom, to, markets);
    const ids = [...stations.keys()];
    const rows = ids.length
      ? await db
          .select()
          .from(schema.airingStats)
          .where(and(inArray(schema.airingStats.stationId, ids), gte(schema.airingStats.startedAt, from), lt(schema.airingStats.startedAt, to), sql`${schema.airingStats.programId} is not null`, ...(only ? [eq(schema.airingStats.programId, only)] : [])))
      : [];
    const programIds = [...new Set(rows.map((r) => r.programId!))];
    const [refs, minimum, reasons] = await Promise.all([
      services.library.programsByIds(programIds),
      services.settings.valueAt("watch_data.minimum_audience", deps.clock.now()),
      services.playout.asRunReasons(rows.map((r) => r.asRunId).filter((x): x is string => !!x))
    ]);
    const makerIds = [...new Set([...refs.values()].map((r) => r.stationId))].filter((id) => !stations.has(id));
    const extra = await services.stations.idents(makerIds);
    const identOf = (id: string): AnalyticsStation | null => {
      const s = stations.get(id);
      if (s) return s;
      const i = extra.get(id);
      return i ? { id, callSign: i.callSign ?? null, channel: i.channel ?? null, name: i.name, kind: kindOf(i.kind), band: null, colour: i.colour ?? null, market: null } : null;
    };
    const programs: AnalyticsProgram[] = [];
    const byProgram = new Map<string, typeof rows>();
    for (const r of rows) byProgram.set(r.programId!, [...(byProgram.get(r.programId!) ?? []), r]);
    for (const [programId, list] of byProgram) {
      const ref = refs.get(programId);
      const maker = ref ? identOf(ref.stationId) : null;
      const catalog = maker?.kind === "catalog";
      const airedOn = [...new Set(list.map((r) => r.stationId))].map((id) => stations.get(id)!).filter(Boolean);
      airedOn.sort((a, b) => (a.id === maker?.id ? -1 : b.id === maker?.id ? 1 : 0));
      const watchSeconds = list.reduce((t, r) => t + r.watchSeconds, 0);
      const minutes = list.reduce((t, r) => t + r.minutes, 0);
      const atStart = list.reduce((t, r) => t + r.audienceAtStart, 0);
      const stayed = list.reduce((t, r) => t + r.stayedToEnd, 0);
      const votes = list.reduce((t, r) => t + r.notForMe, 0);
      // The maker's rule: shown once its airings reach the minimum together.
      const underMinimum = list.reduce((t, r) => t + r.peakAudience, 0) < minimum.viewers;
      const hoursOf = watchSeconds / 3600;
      programs.push({
        programId,
        title: ref?.title ?? "A program",
        maker: catalog ? null : maker,
        catalog,
        live: list.some((r) => (r.asRunId && reasons.get(r.asRunId) === "live") || ref?.live),
        stations: airedOn,
        airings: list.length,
        hours: round1(hoursOf),
        averageTunedIn: round1(watchSeconds / 60 / Math.max(1, minutes)),
        stayedToTheEnd: underMinimum || !atStart ? null : Math.round((stayed / atStart) * 100),
        notForMePer1000Hours: underMinimum || !hoursOf ? null : round1((votes / hoursOf) * 1000),
        underMinimum
      });
    }
    programs.sort((a, b) => b.hours - a.hours || a.title.localeCompare(b.title));
    return { scope, from, to, stations, ids, rows, programs };
  }

  service.programs = async (user, query) => {
    const { scope, from, to, ids, programs } = await programsIn(user, query);
    const breaks = ids.length
      ? await db.select().from(schema.breakStats).where(and(inArray(schema.breakStats.stationId, ids), gte(schema.breakStats.startedAt, from), lt(schema.breakStats.startedAt, to)))
      : [];
    const hold = (list: typeof breaks): AnalyticsBreakHold => {
      const atStart = list.reduce((t, b) => t + b.tunedAtStart, 0);
      const still = list.reduce((t, b) => t + b.stillAtEnd, 0);
      return { breaks: list.length, tunedAtStart: atStart, held: atStart ? round1((still / atStart) * 100) : null };
    };
    const bands: Array<[string, (s: number) => boolean]> = [
      ["30", (s) => s <= 30],
      ["60", (s) => s > 30 && s <= 60],
      ["90", (s) => s > 60 && s <= 90],
      ["120", (s) => s > 90 && s <= 120],
      ["150_plus", (s) => s > 120]
    ];
    return {
      scope,
      programs,
      breaks: {
        all: hold(breaks),
        byLength: bands.map(([band, f]) => ({ band, ...hold(breaks.filter((b) => f(b.seconds))) })),
        byPosition: (["opening", "inside", "between"] as const).map((position) => ({ position, ...hold(breaks.filter((b) => b.position === position)) })),
        byFirst: (["bumper", "spot", "sponsor", "station_id", "other"] as const).map((first) => ({ first, ...hold(breaks.filter((b) => b.firstElement === first)) })).filter((x) => x.breaks > 0),
        bumperShare: breaks.length ? Math.round((breaks.filter((b) => b.firstElement === "bumper").length / breaks.length) * 100) : null
      }
    };
  };

  service.program = async (user, programId, query) => {
    const { scope, rows, programs } = await programsIn(user, query, programId);
    const program = programs[0];
    if (!program) throw notFound("That program didn't air in this view.");
    // Still watching: each minute, those at the first minute less everyone who has left by then, all airings added up.
    const longest = Math.min(240, Math.max(...rows.map((r) => r.minutes)));
    const tuneAways = new Array<number>(longest).fill(0);
    const base = new Array<number>(longest).fill(0);
    const gone = new Array<number>(longest).fill(0);
    for (const r of rows) {
      let left = 0;
      for (let i = 0; i < Math.min(longest, r.minutes); i++) {
        const away = r.tuneAways[i] ?? 0;
        left += away;
        tuneAways[i]! += away;
        base[i]! += r.audienceAtStart;
        gone[i]! += Math.min(left, r.audienceAtStart);
      }
    }
    const stillWatching = base.map((b, i) => (b ? round1(((b - gone[i]!) / b) * 100) : 0));
    // Its breaks, as its biggest airing aired them.
    const biggest = [...rows].sort((a, b) => b.audienceAtStart - a.audienceAtStart)[0]!;
    const spans = await services.playout.breakSpans(biggest.stationId, biggest.startedAt, biggest.endedAt);
    const breaks = spans.map((s) => ({ from: round1((s.start.getTime() - biggest.startedAt.getTime()) / MINUTE), to: round1((s.end.getTime() - biggest.startedAt.getTime()) / MINUTE) }));
    let drop: AnalyticsProgramDetail["biggestDrop"] = null;
    for (let i = 1; i < stillWatching.length; i++) {
      const points = round1(stillWatching[i - 1]! - stillWatching[i]!);
      if (points > 0 && (!drop || points > drop.points)) drop = { minute: i, points, inBreak: breaks.some((b) => i >= Math.floor(b.from) && i <= Math.ceil(b.to)) };
    }
    const atStart = rows.reduce((t, r) => t + r.audienceAtStart, 0);
    return { scope, program, stillWatching, tuneAways, breaks, atStart, stillAtEnd: rows.reduce((t, r) => t + r.stayedToEnd, 0), biggestDrop: drop };
  };

  service.audience = async (user, query) => {
    const { scope, from, to, previousFrom, previousTo, market, band, markets } = await scopeOf(user, query);
    const stations = await stationsIn(market, band, previousFrom, to, markets);
    const list = [...stations.values()].sort((a, b) => (a.band ?? "").localeCompare(b.band ?? "") || Number.parseFloat(a.channel ?? "0") - Number.parseFloat(b.channel ?? "0"));
    let station: AnalyticsStation | null = null;
    if (query.station) {
      station = stations.get(query.station) ?? null;
      if (!station) throw notFound("That station isn't in this view.");
    }
    const ids = station ? [station.id] : list.map((s) => s.id);
    const key = station ? `station:${station.id}` : `${band}|${market ?? "all"}`;
    const spanDays = daysIn(from, to);
    const daysBeforeList = daysIn(previousFrom, previousTo);
    const [hours, hoursBefore, days, daysBefore, presetTotals, presetsNew] = await Promise.all([
      stationHours(ids, from, to),
      stationHours(ids, previousFrom, previousTo),
      sessionDays(ids, from, to),
      sessionDays(ids, previousFrom, previousTo),
      services.accounts.presetCounts(ids),
      services.accounts.presetsAdded(ids, from, to)
    ]);

    // The hour-by-day grid: each weekday and hour's average across the span's (and the span before's) hours.
    const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", hourCycle: "h23" });
    const cellOf = (t: number) => {
      const p = local.formatToParts(new Date(t));
      const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.find((x) => x.type === "weekday")!.value);
      return wd * 24 + (Number(p.find((x) => x.type === "hour")!.value) % 24);
    };
    const gridOf = (rows: typeof hours, a: Date, b: Date) => {
      const sums = new Array<number>(168).fill(0);
      const counts = new Array<number>(168).fill(0);
      const until = Math.min(b.getTime(), deps.clock.now().getTime());
      for (let t = Math.floor(a.getTime() / HOUR) * HOUR; t < until; t += HOUR) counts[cellOf(t)]!++;
      // Minutes added up first (whole numbers), divided once: the same answer whatever the rows' order.
      for (const r of rows) sums[cellOf(r.hour.getTime())]! += r.tunedMinutes;
      return sums.map((s, i) => (counts[i] ? s / 60 / counts[i]! : null));
    };
    const now = gridOf(hours, from, to);
    const before = gridOf(hoursBefore, previousFrom, previousTo);
    const grid: AnalyticsAudience["grid"] = now.map((v, i) => ({ weekday: Math.floor(i / 24), hour: i % 24, value: round1(v ?? 0), previous: before[i] == null ? null : round1(before[i]!) }));

    // Sessions: length bands, median and average, bots and their reasons, how they were tuned.
    const sessions = days.reduce((t, d) => t + d.sessions, 0);
    const bands = new Map<string, number>();
    const reasons = new Map<string, number>();
    const via = new Map<string, number>();
    let bots = 0;
    let minutesTotal = 0;
    for (const d of days) {
      for (const [k, n] of Object.entries(d.lengths)) bands.set(k, (bands.get(k) ?? 0) + n);
      for (const [k, n] of Object.entries(d.botReasons)) reasons.set(k, (reasons.get(k) ?? 0) + n);
      for (const [k, n] of Object.entries(d.via)) via.set(k, (via.get(k) ?? 0) + n);
      bots += d.bots;
      minutesTotal += d.minutesTotal;
    }
    const medianOf = (rs: typeof days) => {
      const w = rs.filter((r) => r.medianMinutes != null && r.sessions > 0);
      const n = w.reduce((t, r) => t + r.sessions, 0);
      return n ? round1(w.reduce((t, r) => t + r.medianMinutes! * r.sessions, 0) / n) : null;
    };
    const told = [...via.values()].reduce((t, n) => t + n, 0);
    if (sessions > told) via.set("unknown", sessions - told);

    // Visits, devices and changes between stations.
    const deviceRows = await db
      .select()
      .from(schema.deviceDays)
      .where(and(eq(schema.deviceDays.scope, key), inArray(schema.deviceDays.day, [...new Set([...daysBeforeList, ...spanDays])])));
    const inSpan = deviceRows.filter((r) => spanDays.includes(String(r.day)));
    const visits = inSpan.reduce((t, r) => t + r.visits, 0);
    const visitSessions = inSpan.reduce((t, r) => t + r.visitSessions, 0);
    const length = to.getTime() - from.getTime();
    const devicesOn = (day: string) => {
      const r = deviceRows.find((x) => String(x.day) === day);
      if (!r) return null;
      return length <= DAY + HOUR ? r.devices : length <= 7 * DAY + HOUR ? r.devices7 : length <= 30 * DAY + HOUR ? r.devices30 : null;
    };
    const lastDay = dayOf(new Date(Math.min(to.getTime(), deps.clock.now().getTime()) - 1));
    const lastRow = deviceRows.find((r) => String(r.day) === lastDay);
    const flows = spanDays.length
      ? await db
          .select({ from: schema.stationFlows.fromStation, to: schema.stationFlows.toStation, n: sql<number>`sum(${schema.stationFlows.changes})::int` })
          .from(schema.stationFlows)
          .where(inArray(schema.stationFlows.day, spanDays))
          .groupBy(schema.stationFlows.fromStation, schema.stationFlows.toStation)
      : [];
    const inView = new Set(ids);
    const tuneIns = flows.filter((f) => f.to && inView.has(f.to));
    const tuneInsTotal = tuneIns.reduce((t, f) => t + f.n, 0);
    const changesIn = tuneIns.filter((f) => f.from).reduce((t, f) => t + f.n, 0);
    const outOf = new Map<string, number>();
    for (const f of flows) if (f.from && f.to) outOf.set(f.from, (outOf.get(f.from) ?? 0) + f.n);
    const moves = flows
      .filter((f) => f.from && f.to && stations.has(f.from) && stations.has(f.to) && (!station || f.from === station.id || f.to === station.id))
      .sort((a, b) => b.n - a.n)
      .slice(0, 10)
      .map((f) => ({ from: stations.get(f.from)!, to: stations.get(f.to)!, changes: f.n, shareOfFrom: round1((f.n / (outOf.get(f.from) || 1)) * 100) }));

    // Surfaces day by day.
    const platformsByDay = spanDays.map((d) => {
      const rs = hours.filter((h) => dayOf(h.hour) === d);
      const sum = (f: (h: (typeof hours)[number]) => number) => round1(rs.reduce((t, h) => t + f(h), 0) / 60);
      return { day: d, phone: sum((h) => h.phone), web: sum((h) => h.web), tv_app: sum((h) => h.tvApp), cast: sum((h) => h.cast), mirror: sum((h) => h.mirror) };
    });

    // Relays: each platform's own count, by day.
    const relays = (await services.stations.relaysOf(ids)).filter((r) => r.service !== "rtmp");
    const relayDay = new Map<string, { youtube: number; twitch: number }>();
    let relayMinutes = 0;
    for (const r of relays) {
      const rows = await db
        .select({ minute: schema.translatorSamples.minute, viewers: schema.translatorSamples.viewers })
        .from(schema.translatorSamples)
        .where(and(eq(schema.translatorSamples.translatorId, r.id), gte(schema.translatorSamples.minute, from), lt(schema.translatorSamples.minute, to)));
      const perDay = new Map<string, { sum: number; n: number }>();
      for (const row of rows) {
        relayMinutes += row.viewers;
        const d = dayOf(row.minute);
        const p = perDay.get(d) ?? { sum: 0, n: 0 };
        p.sum += row.viewers;
        p.n++;
        perDay.set(d, p);
      }
      for (const [d, p] of perDay) {
        const e = relayDay.get(d) ?? { youtube: 0, twitch: 0 };
        e[r.service as "youtube" | "twitch"] += p.sum / (24 * 60);
        relayDay.set(d, e);
      }
    }
    const ownMinutes = hours.reduce((t, h) => t + h.tunedMinutes, 0);
    const presetRows = list
      .filter((s) => inView.has(s.id))
      .map((s) => ({ station: s, total: presetTotals.get(s.id) ?? 0, added: presetsNew.get(s.id) ?? 0 }))
      .sort((a, b) => b.total - a.total);
    return {
      scope,
      station,
      stations: list,
      grid,
      lengths: LENGTH_BUCKETS.map((b) => ({ band: b.key, sessions: bands.get(b.key) ?? 0, share: sessions ? round1(((bands.get(b.key) ?? 0) / sessions) * 100) : 0 })),
      sessions: { value: sessions, previous: daysBefore.length ? daysBefore.reduce((t, d) => t + d.sessions, 0) : null, byDay: spanDays.map((d) => days.filter((r) => String(r.day) === d).reduce((t, r) => t + r.sessions, 0)) },
      medianMinutes: medianOf(days),
      averageMinutes: sessions ? round1(minutesTotal / sessions) : null,
      stationsPerVisit: visits ? Math.round((visitSessions / visits) * 10) / 10 : null,
      cameFromAnotherStation: tuneInsTotal ? Math.round((changesIn / tuneInsTotal) * 100) : null,
      bots: { sessions: bots, share: sessions + bots ? round1((bots / (sessions + bots)) * 100) : null, reasons: [...reasons].map(([reason, n]) => ({ reason, sessions: n })).sort((a, b) => b.sessions - a.sessions) },
      presets: { total: presetRows.reduce((t, r) => t + r.total, 0), added: presetRows.reduce((t, r) => t + r.added, 0), stations: presetRows.slice(0, 5) },
      platformsByDay,
      relays: {
        byDay: spanDays.map((d) => ({ day: d, youtube: round1(relayDay.get(d)?.youtube ?? 0), twitch: round1(relayDay.get(d)?.twitch ?? 0) })),
        youtubeStations: new Set(relays.filter((r) => r.service === "youtube").map((r) => r.stationId)).size,
        twitchStations: new Set(relays.filter((r) => r.service === "twitch").map((r) => r.stationId)).size,
        hours: round1(relayMinutes / 60),
        shareOfOwn: ownMinutes ? round1((relayMinutes / ownMinutes) * 100) : null
      },
      moves,
      devices: {
        value: devicesOn(lastDay),
        previous: devicesOn(dayOf(new Date(previousTo.getTime() - 1))),
        returningShare: lastRow && lastRow.devices ? Math.round((lastRow.returning / lastRow.devices) * 100) : null,
        byDay: spanDays.map((d) => deviceRows.find((r) => String(r.day) === d)?.devices ?? 0)
      },
      via: [...via].map(([v, n]) => ({ via: v, sessions: n, share: sessions ? round1((n / sessions) * 100) : 0 })).sort((a, b) => (a.via === "unknown" ? 1 : 0) - (b.via === "unknown" ? 1 : 0) || b.sessions - a.sessions)
    };
  };

  service.stationFile = async (user, stationId) => {
    const place = (await totals.places()).get(stationId) ?? { band: null, marketId: null };
    if (!user.isAdmin) {
      const leads = (await services.settings.rolesOf(user)).filter((g) => g.role === "market_lead" && g.market).map((g) => g.market!.id);
      if (!leads.length) throw forbidden("Analytics are for admins and market leads.");
      if (!place.marketId || !leads.includes(place.marketId)) throw forbidden("That station isn't in your market.");
    }
    const [facts, ident] = await Promise.all([services.stations.fileFacts(stationId), services.stations.idents([stationId]).then((m) => m.get(stationId))]);
    if (!facts || !ident) throw notFound("No such station.");
    const now = deps.clock.now();
    const weekEnd = new Date(now.getTime() + 7 * DAY);
    const [people, creator, uploads, entries, lastEnd, status, allMarkets] = await Promise.all([
      services.accounts.stationPeople(stationId),
      services.network.creatorOfStation(stationId),
      services.library.stationUploads(stationId),
      services.log.entries(stationId, now, weekEnd),
      services.log.lastEntryEnd(stationId),
      services.playout.statusFor([stationId]),
      services.network.allMarkets()
    ]);
    // Previews only for what's prepared already: the desk never queues preparing just to look.
    const band = place.band ?? "tv";
    const previews = await services.playout.previews(uploads.filter((u) => u.contentId && !u.archivedAt).map((u) => ({ contentId: u.contentId, mediaKind: u.mediaKind, band, durationMs: u.durationMs })));
    const titles = await services.library.titles({ itemIds: entries.flatMap((e) => (e.assetId ? [e.assetId] : [])), programIds: entries.flatMap((e) => (e.programId ? [e.programId] : [])) });
    const entry = (e: (typeof entries)[number]) => ({
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      kind: e.kind,
      code: String(e.code),
      title: e.episodeTitle ?? (e.programId ? titles.programs.get(e.programId) : undefined) ?? (e.assetId ? titles.items.get(e.assetId) : undefined) ?? (e.kind === "off_air" ? "Off air" : null)
    });
    // The next 7 days by kind, each entry clipped to the week; what nothing covers is empty.
    const week = { program: 0, live: 0, offAir: 0, empty: 0 };
    for (const e of entries) {
      const minutes = Math.max(0, (Math.min(e.endsAt.getTime(), weekEnd.getTime()) - Math.max(e.startsAt.getTime(), now.getTime())) / 60_000);
      if (e.kind === "live") week.live += minutes;
      else if (e.kind === "off_air") week.offAir += minutes;
      else week.program += minutes;
    }
    week.empty = Math.max(0, 7 * 24 * 60 - week.program - week.live - week.offAir);
    const sorted = [...entries].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const current = sorted.find((e) => e.startsAt <= now && e.endsAt > now);
    const until = now.getTime() + 2 * DAY;
    const firstOwner = people.find((p) => p.role === "owner")?.userId ?? people[0]?.userId;
    const actors = await services.accounts.peopleByIds([...new Set([facts.held?.by, ...uploads.map((u) => u.archivedBy)].filter((x): x is string => Boolean(x)))]);
    const actor = (id: string | null | undefined) => (id ? (actors.get(id)?.name ?? null) : null);
    const live = uploads.filter((u) => !u.archivedAt);
    const marketOf = (id: string | null) => (id ? (allMarkets.find((m) => m.id === id) ?? null) : null);
    const creatorMarket = marketOf(creator?.marketId ?? null);
    return {
      station: {
        id: stationId,
        callSign: ident.callSign ?? null,
        name: ident.name,
        kind: facts.kind,
        status: facts.status,
        handle: facts.handle,
        homeCity: ident.homeCity ?? null,
        description: facts.description,
        createdAt: facts.createdAt.toISOString(),
        firstSignedOnAt: facts.firstSignedOnAt?.toISOString() ?? null,
        signedOffAt: facts.signedOffAt?.toISOString() ?? null,
        onAir: status.get(stationId)?.onAir ?? false,
        held: facts.held ? { at: facts.held.at.toISOString(), reason: facts.held.reason, by: actor(facts.held.by) } : null
      },
      started: {
        how: creator ? "pipeline" : "signed_up",
        creator: creator ? { id: creator.id, name: creator.name, stage: creator.stage, sourceUrl: creator.sourceUrl, market: creatorMarket ? { id: creatorMarket.id, slug: creatorMarket.slug, name: creatorMarket.name } : null } : null
      },
      people: people.map((p) => ({
        userId: p.userId,
        name: p.name,
        email: p.email,
        role: p.role,
        joinedAt: p.joinedAt.toISOString(),
        lastInAt: p.lastInAt?.toISOString() ?? null,
        lastSeenAt: p.lastSeenAt?.toISOString() ?? null,
        accountCreatedAt: p.accountCreatedAt.toISOString(),
        madeIt: p.userId === firstOwner
      })),
      uploads: {
        total: live.length,
        hours: round1(live.reduce((t, u) => t + (u.durationMs ?? 0), 0) / 3_600_000),
        rightsToConfirm: live.filter((u) => !u.rights).length,
        archived: uploads.length - live.length,
        items: uploads.map(({ contentId, archivedBy, archivedReason, ...u }) => ({
          ...u,
          addedAt: u.addedAt.toISOString(),
          archivedAt: u.archivedAt?.toISOString() ?? null,
          archivedByOpencast: u.archivedAt && archivedReason ? { by: actor(archivedBy), reason: archivedReason } : null,
          rights: u.rights ? { ...u.rights, confirmedAt: u.rights.confirmedAt.toISOString() } : null,
          preview: (contentId && previews.get(contentId)) || null
        }))
      },
      schedule: {
        now: current ? entry(current) : null,
        week: { program: Math.round(week.program), live: Math.round(week.live), offAir: Math.round(week.offAir), empty: Math.round(week.empty) },
        entries: sorted.filter((e) => e.startsAt.getTime() < until).slice(0, 200).map(entry),
        lastScheduledAt: lastEnd?.toISOString() ?? null,
        liveSources: facts.liveSources
      }
    };
  };

  // The desk acts (added 2026-10-07): admins only, each with a reason the station's people see.
  const adminOnly = (user: CurrentUser) => {
    if (!user.isAdmin) throw forbidden("Only admins can act on a station from the desk.");
  };

  service.takeOffAir = async (user, stationId, reason) => {
    adminOnly(user);
    const facts = await services.stations.fileFacts(stationId);
    if (!facts) throw notFound("No such station.");
    if (facts.kind === "listed") throw badRequest("An external station is taken off the dial from External sources.");
    await services.stations.setHold(stationId, { by: user.id, reason });
    // Off the air now unless it's off already (or signed off for good, which stays as it is).
    if (facts.status === "on_air" || facts.status === "setting_up") await services.playout.signOff(stationId, false);
    deps.bus.emit("station.held", { stationId, reason });
    return service.stationFile(user, stationId);
  };

  service.liftHold = async (user, stationId) => {
    adminOnly(user);
    if (!(await services.stations.holdOf(stationId))) throw notFound("That station isn't held.");
    await services.stations.setHold(stationId, null);
    deps.bus.emit("station.hold_lifted", { stationId });
    return service.stationFile(user, stationId);
  };

  service.archiveUpload = async (user, stationId, itemId, reason) => {
    adminOnly(user);
    if ((await services.library.stationOfItem(itemId)) !== stationId) throw notFound("That item isn't this station's.");
    const done = await services.library.archiveByOpencast(itemId, user.id, reason);
    deps.bus.emit("item.archived_by_opencast", { stationId, itemId, title: done.title, reason, pulled: done.pulled });
    return service.stationFile(user, stationId);
  };

  service.station = async (user, stationId, query) => {
    const places = await totals.places();
    const place = places.get(stationId) ?? { band: null, marketId: null };
    const { scope, from, to, previousFrom, previousTo, markets } = await scopeOf(user, { ...query, ...(place.marketId ? { market: place.marketId } : {}) });
    if (scope.fixedMarket && place.marketId !== scope.fixedMarket) throw forbidden("That station isn't in your market.");
    const idents = await services.stations.idents([stationId]);
    const ident = idents.get(stationId);
    if (!ident) throw notFound("No such station.");
    const allMarkets = new Map((await services.network.allMarkets()).map((m) => [m.id, { id: m.id, slug: m.slug, name: m.name }]));
    const station: AnalyticsStation = {
      id: stationId,
      callSign: ident.callSign ?? null,
      channel: ident.channel ?? null,
      name: ident.name,
      kind: kindOf(ident.kind),
      band: place.band,
      colour: ident.colour ?? null,
      market: place.marketId ? (allMarkets.get(place.marketId) ?? null) : null
    };
    const external = station.kind === "external";
    const now = deps.clock.now();
    const spanDays = daysIn(from, to);
    const netScope = `all|${scope.fixedMarket ?? "all"}`;
    const network = await stationsIn(scope.fixedMarket, "all", previousFrom, to, markets);
    const networkIds = [...network.keys()];
    const [hours, hoursBefore, net, minimum, onDial] = await Promise.all([
      stationHours([stationId], from, to),
      stationHours([stationId], previousFrom, previousTo),
      db.select().from(NH).where(and(eq(NH.scope, netScope), gte(NH.hour, from), lt(NH.hour, to))),
      services.settings.valueAt("watch_data.minimum_audience", now),
      services.stations.onDialSince(stationId)
    ]);
    const tuned = hours.reduce((s, h) => s + h.tunedMinutes, 0);
    const tunedBefore = hoursBefore.reduce((s, h) => s + h.tunedMinutes, 0);
    const netTuned = net.reduce((s, h) => s + h.tunedMinutes, 0);
    // Its busiest hour; on a tie, the first.
    const peak = hours.reduce<{ n: number; hour: Date | null }>((p, h) => (h.peak > p.n || (h.peak === p.n && p.hour && h.hour < p.hour) ? { n: h.peak, hour: h.hour } : p), { n: 0, hour: null });
    const minutesOf = elapsedMinutes(from, to);
    const minutesBefore = (previousTo.getTime() - previousFrom.getTime()) / MINUTE;
    const perDay = (f: (rs: typeof hours) => number) => spanDays.map((d) => f(hours.filter((h) => dayOf(h.hour) === d)));

    // Stayed and "Not for me", the station's against the network's (weighted by watch time).
    const airingTotals = async (ids: string[], a: Date, b: Date) => {
      if (!ids.length) return { atStart: 0, stayed: 0, votes: 0, watchSeconds: 0 };
      const [r] = await db
        .select({
          atStart: sql<number>`coalesce(sum(${schema.airingStats.audienceAtStart}), 0)::int`,
          stayed: sql<number>`coalesce(sum(${schema.airingStats.stayedToEnd}), 0)::int`,
          votes: sql<number>`coalesce(sum(${schema.airingStats.notForMe}), 0)::int`,
          watchSeconds: sql<number>`coalesce(sum(${schema.airingStats.watchSeconds}), 0)::float`
        })
        .from(schema.airingStats)
        .where(and(inArray(schema.airingStats.stationId, ids), gte(schema.airingStats.startedAt, a), lt(schema.airingStats.startedAt, b)));
      return r!;
    };
    const [mine, mineBefore, all] = await Promise.all([airingTotals([stationId], from, to), airingTotals([stationId], previousFrom, previousTo), airingTotals(networkIds, from, to)]);
    const stayedOf = (t: { atStart: number; stayed: number }) => (t.atStart > 0 ? Math.round((t.stayed / t.atStart) * 100) : null);
    const nfmOf = (t: { votes: number; watchSeconds: number }) => (t.watchSeconds > 0 ? round1((t.votes / (t.watchSeconds / 3600)) * 1000) : null);
    const underMinimum = peak.n < minimum.viewers;

    // Its busiest night: the evening (6 pm to 2 am) of the day its busiest hour fell on.
    let night: AnalyticsStationPage["night"] = null;
    if (peak.hour) {
      const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(peak.hour);
      let day = dayOf(peak.hour);
      if (Number(local) < 6) day = dayOf(new Date(dayStart(day).getTime() - 12 * HOUR));
      const a = new Date(dayStart(day).getTime() + NIGHT_FROM_HOUR * HOUR);
      const b = new Date(a.getTime() + NIGHT_HOURS * HOUR);
      const perMinute = async (x: Date, y: Date) =>
        new Map(
          (
            await db
              .select({ minute: schema.sessionMinutes.minute, n: sql<number>`count(*)::int` })
              .from(schema.sessionMinutes)
              .where(and(eq(schema.sessionMinutes.stationId, stationId), gte(schema.sessionMinutes.minute, x), lt(schema.sessionMinutes.minute, y)))
              .groupBy(schema.sessionMinutes.minute)
          ).map((r) => [r.minute.getTime(), r.n])
        );
      const [thisNight, weekBefore, breaks] = await Promise.all([perMinute(a, b), perMinute(new Date(a.getTime() - 7 * DAY), new Date(b.getTime() - 7 * DAY)), external ? Promise.resolve([]) : services.playout.breakSpans(stationId, a, b)]);
      if (thisNight.size) {
        const minutes: NonNullable<AnalyticsStationPage["night"]>["minutes"] = [];
        const until = Math.min(b.getTime(), now.getTime());
        for (let t = a.getTime(); t < until; t += MINUTE) minutes.push({ at: new Date(t).toISOString(), value: thisNight.get(t) ?? 0, previous: weekBefore.size ? (weekBefore.get(t - 7 * DAY) ?? 0) : null });
        night = { from: a.toISOString(), to: b.toISOString(), minutes, breaks: breaks.map((x) => ({ start: x.start.toISOString(), end: x.end.toISOString() })), airings: await airingsOf(station, a, b) };
      }
    }

    // Surfaces and places.
    const platforms = { phone: 0, cast: 0, web: 0, tv_app: 0, mirror: 0 };
    for (const h of hours) {
      platforms.phone += h.phone;
      platforms.cast += h.cast;
      platforms.web += h.web;
      platforms.tv_app += h.tvApp;
      platforms.mirror += h.mirror;
    }
    const placeRows = await db
      .select({ market: schema.stationHourPlaces.market, minutes: sql<number>`sum(${schema.stationHourPlaces.tunedMinutes})::int` })
      .from(schema.stationHourPlaces)
      .where(and(eq(schema.stationHourPlaces.stationId, stationId), gte(schema.stationHourPlaces.hour, from), lt(schema.stationHourPlaces.hour, to)))
      .groupBy(schema.stationHourPlaces.market);

    // Came from and went to: the span's changes into and out of it.
    const flowRows = spanDays.length
      ? await db
          .select({ from: schema.stationFlows.fromStation, to: schema.stationFlows.toStation, n: sql<number>`sum(${schema.stationFlows.changes})::int` })
          .from(schema.stationFlows)
          .where(and(inArray(schema.stationFlows.day, spanDays), sql`(${schema.stationFlows.fromStation} = ${stationId} or ${schema.stationFlows.toStation} = ${stationId})`))
          .groupBy(schema.stationFlows.fromStation, schema.stationFlows.toStation)
      : [];
    const others = [...new Set(flowRows.flatMap((f) => [f.from, f.to]).filter((x) => x && x !== stationId))];
    const otherIdents = await services.stations.idents(others);
    const identOf = (id: string): AnalyticsStation | null => {
      const i = otherIdents.get(id);
      if (!i) return null;
      const p = places.get(id) ?? { band: null, marketId: null };
      return { id, callSign: i.callSign ?? null, channel: i.channel ?? null, name: i.name, kind: kindOf(i.kind), band: p.band, colour: i.colour ?? null, market: p.marketId ? (allMarkets.get(p.marketId) ?? null) : null };
    };
    const side = (rows: Array<{ other: string; n: number }>): AnalyticsFlow[] => {
      const total = rows.reduce((s, r) => s + r.n, 0);
      return rows
        .map((r) => ({ station: r.other ? identOf(r.other) : null, changes: r.n, share: total ? round1((r.n / total) * 100) : 0 }))
        .filter((f) => f.station || f.changes)
        .sort((x, y) => (x.station ? 1 : 0) - (y.station ? 1 : 0) || y.changes - x.changes);
    };
    const cameFrom = side(flowRows.filter((f) => f.to === stationId && f.from !== stationId).map((f) => ({ other: f.from, n: f.n })));
    const wentTo = side(flowRows.filter((f) => f.from === stationId && f.to !== stationId).map((f) => ({ other: f.to, n: f.n })));

    const [airingsInSpan] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.airingStats).where(and(eq(schema.airingStats.stationId, stationId), gte(schema.airingStats.startedAt, from), lt(schema.airingStats.startedAt, to)));
    const [airtime, earned, down] = await Promise.all([
      external ? Promise.resolve(null) : services.playout.airtimeMinutes(stationId, from, to),
      external ? Promise.resolve(null) : services.ledger.earnedBreakdown(stationId, from, to),
      external ? services.network.outageMinutes([stationId], from, to) : Promise.resolve(null)
    ]);
    const hoursWatched = round1(tuned / 60);
    return {
      scope,
      station: { ...station, onDialSince: onDial ? onDial.toISOString() : null },
      hoursWatched: { value: hoursWatched, previous: hoursBefore.length ? round1(tunedBefore / 60) : null, byDay: perDay((rs) => round1(rs.reduce((s, h) => s + h.tunedMinutes, 0) / 60)), shareOfNetwork: netTuned ? round1((tuned / netTuned) * 100) : null },
      averageTunedIn: { value: round1(tuned / minutesOf), previous: hoursBefore.length ? round1(tunedBefore / minutesBefore) : null, byDay: perDay((rs) => round1(rs.reduce((s, h) => s + h.tunedMinutes, 0) / (24 * 60))) },
      peakTunedIn: { value: peak.n, previous: hoursBefore.length ? hoursBefore.reduce((p, h) => Math.max(p, h.peak), 0) : null, at: peak.hour ? peak.hour.toISOString() : null, byDay: perDay((rs) => rs.reduce((p, h) => Math.max(p, h.peak), 0)) },
      stayedToTheEnd: { value: underMinimum ? null : stayedOf(mine), previous: stayedOf(mineBefore), network: stayedOf(all), byDay: [] },
      notForMePer1000Hours: { value: underMinimum ? null : nfmOf(mine), previous: nfmOf(mineBefore), network: nfmOf(all), byDay: [] },
      underMinimum,
      night,
      airingsInSpan: airingsInSpan?.n ?? 0,
      platforms: (Object.entries(platforms) as Array<[keyof typeof platforms, number]>).map(([platform, m]) => ({ platform, hours: round1(m / 60) })).sort((x, y) => y.hours - x.hours),
      places: placeRows
        .map((p) => ({ market: p.market ? (allMarkets.get(p.market) ?? null) : null, own: !!p.market && p.market === place.marketId, hours: round1(p.minutes / 60) }))
        .sort((x, y) => Number(y.own) - Number(x.own) || y.hours - x.hours),
      cameFrom,
      wentTo,
      airtime,
      earned,
      adMicrosPer1000Hours: earned && hoursWatched > 0 ? Math.round(((earned.spotsMicros + earned.sponsorsMicros) / hoursWatched) * 1000) : null,
      timeDownMinutes: down ? (down.get(stationId) ?? 0) : null,
      cost: external ? null : await stationCost(stationId, from, to)
    };
  };

  /** A station's cost to run, estimated, against what it was charged (Phase 6). */
  async function stationCost(stationId: string, from: Date, to: Date): Promise<NonNullable<AnalyticsStationPage["cost"]>> {
    const days = Math.max(1, (Math.min(to.getTime(), deps.clock.now().getTime()) - from.getTime()) / DAY);
    const [usage, brk] = await Promise.all([
      services.ledger.usageTotals([stationId], from, to),
      db.select({ spots: schema.breakStats.spots }).from(schema.breakStats).where(and(eq(schema.breakStats.stationId, stationId), gte(schema.breakStats.startedAt, from), lt(schema.breakStats.startedAt, to)))
    ]);
    const c = await costs(deps.clock.now(), { gbDays: usage.storage.gbDays, prepareMinutes: 0, relayHours: usage.relays.hours, liveHours: usage.live.hours, days: 0 });
    const parts = [c.storage, c.relays, c.live];
    return {
      storageGb: round1(usage.storage.gbDays / days),
      storageMicros: c.storage,
      relayHours: round1(usage.relays.hours),
      relayMicros: c.relays,
      liveHours: round1(usage.live.hours),
      liveMicros: c.live,
      totalMicros: parts.every((p) => p == null) ? null : parts.reduce((t: number, p) => t + (p ?? 0), 0),
      chargedMicros: usage.storage.chargeMicros + usage.relays.chargeMicros + usage.live.chargeMicros,
      breaksWithSpots: brk.length ? Math.round((brk.filter((b) => b.spots > 0).length / brk.length) * 100) : null
    };
  }

  /** A station's airings in a window, with their titles and where they came from. */
  async function airingsOf(station: AnalyticsStation, a: Date, b: Date): Promise<AnalyticsAiring[]> {
    const rows = await db
      .select()
      .from(schema.airingStats)
      .where(and(eq(schema.airingStats.stationId, station.id), gte(schema.airingStats.startedAt, a), lt(schema.airingStats.startedAt, b)))
      .orderBy(schema.airingStats.startedAt);
    if (!rows.length) return [];
    const programIds = [...new Set(rows.map((r) => r.programId).filter((x): x is string => !!x))];
    const listedIds = rows.map((r) => (r.airingKey.startsWith("listed:") ? r.airingKey.slice(7) : null)).filter((x): x is string => !!x);
    const asRunIds = rows.map((r) => r.asRunId).filter((x): x is string => !!x);
    const makers = [...new Set(rows.filter((r) => r.carried && r.makerStationId).map((r) => r.makerStationId!))];
    const [titles, listed, reasons, makerIdents] = await Promise.all([
      services.library.titles({ itemIds: [], programIds }),
      listedIds.length ? services.network.listedAiringsByIds(listedIds) : Promise.resolve(new Map()),
      services.playout.asRunReasons(asRunIds),
      services.stations.idents(makers)
    ]);
    return rows.map((r) => {
      const listedId = r.airingKey.startsWith("listed:") ? r.airingKey.slice(7) : null;
      const maker = r.carried && r.makerStationId ? makerIdents.get(r.makerStationId) : undefined;
      const source = r.external ? (listedId ? "guide" : "nothing_listed") : r.carried ? "carried" : r.asRunId && reasons.get(r.asRunId) === "live" ? "live" : "library";
      const title = listedId ? (listed.get(listedId)?.title ?? station.name) : r.programId ? (titles.programs.get(r.programId) ?? "A program") : r.external ? `${station.name}, nothing listed` : "A program";
      const hoursOf = r.watchSeconds / 3600;
      return {
        key: r.airingKey,
        title,
        source,
        from: maker ? { id: r.makerStationId!, callSign: maker.callSign ?? null, channel: maker.channel ?? null, name: maker.name, kind: kindOf(maker.kind), band: null, colour: maker.colour ?? null, market: null } : null,
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt.toISOString(),
        averageTunedIn: round1(r.watchSeconds / 60 / Math.max(1, r.minutes)),
        peakTunedIn: r.peakAudience,
        stayedToTheEnd: r.audienceAtStart > 0 ? Math.round((r.stayedToEnd / r.audienceAtStart) * 100) : null,
        notForMePer1000Hours: hoursOf > 0 ? round1((r.notForMe / hoursOf) * 1000) : null,
        hours: round1(hoursOf)
      };
    });
  }

  return service;
}
