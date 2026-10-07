// A251 Phase 2 (2026-10-06): the desk's analytics totals, worked out from the per-session rows
// (`session_minutes`, `sessions`, kept 30 days) into tables kept for good that name no session,
// device or person. Every station is in them, external ones too. Hours are worked out every ten
// minutes for the last few hours; days (Pacific, the markets' time) for today and yesterday, and
// any day missing since the oldest session minute (the first run fills in the 30 days kept).

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../context.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
export const ANALYTICS_TZ = "America/Los_Angeles";

type Db = ModuleContext["deps"]["db"];
type Rows<T> = { rows: T[] };

/** "2026-10-06": the Pacific day a time falls on. */
export function dayOf(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ANALYTICS_TZ }).format(at);
}

/** Where a Pacific day starts, as an instant (midnight there, whatever the offset that day). */
export function dayStart(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  // Midnight UTC that date, moved by the Pacific offset at that time (checked twice across a change).
  const guess = Date.UTC(y, m - 1, d);
  const offset = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: ANALYTICS_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)!.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t);
}

/** The Pacific day after. */
export function nextDay(day: string): string {
  return dayOf(new Date(dayStart(day).getTime() + 30 * HOUR));
}

/** Session length bands, in minutes (the reference's; the shortest counted sessions are in "1_2"). */
export const LENGTH_BUCKETS = [
  { key: "1_2", max: 2 },
  { key: "2_5", max: 5 },
  { key: "5_15", max: 15 },
  { key: "15_30", max: 30 },
  { key: "30_60", max: 60 },
  { key: "60_120", max: 120 },
  { key: "120_plus", max: Infinity }
] as const;

/** How `station_days` rows are worked out now (2: the reference's bands, total minutes, visits). */
export const DAY_VERSION = 2;

export function lengthBucket(minutes: number): string {
  return LENGTH_BUCKETS.find((b) => minutes < b.max)!.key;
}

/** "<band>|<market>": the network scopes a station's minutes count toward. */
export function scopesFor(place: { band: "tv" | "radio" | null; marketId: string | null }): string[] {
  const bands = ["all", ...(place.band ? [place.band] : [])];
  const markets = ["all", ...(place.marketId ? [place.marketId] : [])];
  return bands.flatMap((b) => markets.map((m) => `${b}|${m}`));
}

export interface Totals {
  /** Works out what's due: the last few hours, today and yesterday, and anything missing. */
  tick(): Promise<{ hours: number; days: number }>;
  /** Hours starting in [from, to), worked out again. */
  hours(from: Date, to: Date): Promise<number>;
  /** These Pacific days worked out again. */
  days(days: string[]): Promise<void>;
  /** Each station's band and market, from its channel on the dial. */
  places(): Promise<Map<string, { band: "tv" | "radio" | null; marketId: string | null }>>;
}

/** Each station's band and market on the dial (the stations module's channels). */
type DialPlaces = () => Promise<Map<string, { band: "tv" | "radio"; marketId: string }>>;

export function createTotals(db: Db, clock: { now(): Date }, dialPlaces: DialPlaces): Totals {
  const SM = schema.sessionMinutes;
  const S = schema.sessions;

  async function places() {
    return (await dialPlaces()) as Map<string, { band: "tv" | "radio" | null; marketId: string | null }>;
  }

  async function hours(from: Date, to: Date): Promise<number> {
    const a = new Date(Math.floor(from.getTime() / HOUR) * HOUR);
    const b = new Date(Math.ceil(to.getTime() / HOUR) * HOUR);
    if (b <= a) return 0;
    // Each minute: tuned in per station, platform and where they are.
    const minutes = (await db.execute(sql`
      select sm.station_id as "stationId", sm.minute as "minute", s.platform as "platform", coalesce(s.market_id::text, '') as "market", count(*)::int as "n"
      from ${SM} sm join ${S} s on s.id = sm.session_id
      where sm.minute >= ${a} and sm.minute < ${b}
      group by 1, 2, 3, 4`)) as unknown as Rows<{ stationId: string; minute: Date | string; platform: string; market: string; n: number }>;
    const started = (await db.execute(sql`
      select s.station_id as "stationId", date_trunc('hour', s.started_at) as "hour", count(*)::int as "n"
      from ${S} s
      where s.started_at >= ${a} and s.started_at < ${b} and not s.flagged_bot
        and exists (select 1 from ${SM} sm where sm.session_id = s.id)
      group by 1, 2`)) as unknown as Rows<{ stationId: string; hour: Date | string; n: number }>;
    const where = await places();

    const hourKey = (t: Date | string) => Math.floor(new Date(t).getTime() / HOUR) * HOUR;
    type Station = { tuned: number; perMinute: Map<number, number>; platforms: Record<string, number>; places: Map<string, number>; sessions: number };
    const stations = new Map<string, Station>();
    const station = (id: string, h: number) => {
      const k = `${id}@${h}`;
      let s = stations.get(k);
      if (!s) stations.set(k, (s = { tuned: 0, perMinute: new Map(), platforms: {}, places: new Map(), sessions: 0 }));
      return s;
    };
    type Net = { perMinute: Map<number, number> };
    const network = new Map<string, Net>();
    for (const r of minutes.rows) {
      const t = new Date(r.minute).getTime();
      const h = hourKey(r.minute);
      const s = station(r.stationId, h);
      s.tuned += r.n;
      s.perMinute.set(t, (s.perMinute.get(t) ?? 0) + r.n);
      s.platforms[r.platform] = (s.platforms[r.platform] ?? 0) + r.n;
      s.places.set(r.market, (s.places.get(r.market) ?? 0) + r.n);
      for (const scope of scopesFor(where.get(r.stationId) ?? { band: null, marketId: null })) {
        const k = `${scope}@${h}`;
        let n = network.get(k);
        if (!n) network.set(k, (n = { perMinute: new Map() }));
        n.perMinute.set(t, (n.perMinute.get(t) ?? 0) + r.n);
      }
    }
    for (const r of started.rows) station(r.stationId, hourKey(r.hour)).sessions += r.n;

    await db.transaction(async (tx) => {
      await tx.delete(schema.stationHours).where(and(gte(schema.stationHours.hour, a), lt(schema.stationHours.hour, b)));
      await tx.delete(schema.stationHourPlaces).where(and(gte(schema.stationHourPlaces.hour, a), lt(schema.stationHourPlaces.hour, b)));
      await tx.delete(schema.networkHours).where(and(gte(schema.networkHours.hour, a), lt(schema.networkHours.hour, b)));
      const stationRows = [...stations].map(([k, s]) => {
        const [stationId, h] = k.split("@") as [string, string];
        return {
          stationId,
          hour: new Date(Number(h)),
          tunedMinutes: s.tuned,
          peak: Math.max(0, ...s.perMinute.values()),
          phone: s.platforms.phone ?? 0,
          cast: s.platforms.cast ?? 0,
          web: s.platforms.web ?? 0,
          tvApp: s.platforms.tv_app ?? 0,
          mirror: s.platforms.mirror ?? 0,
          sessions: s.sessions
        };
      });
      for (let i = 0; i < stationRows.length; i += 500) await tx.insert(schema.stationHours).values(stationRows.slice(i, i + 500));
      const placeRows = [...stations].flatMap(([k, s]) => {
        const [stationId, h] = k.split("@") as [string, string];
        return [...s.places].map(([market, tunedMinutes]) => ({ stationId, hour: new Date(Number(h)), market, tunedMinutes }));
      });
      for (let i = 0; i < placeRows.length; i += 500) await tx.insert(schema.stationHourPlaces).values(placeRows.slice(i, i + 500));
      const netRows = [...network].map(([k, n]) => {
        const at = k.lastIndexOf("@");
        let peak = 0;
        let peakAt: Date | null = null;
        let tuned = 0;
        for (const [t, v] of n.perMinute) {
          tuned += v;
          // The busiest minute; on a tie, the first (rows come in no order).
          if (v > peak || (v === peak && peakAt && t < peakAt.getTime())) [peak, peakAt] = [v, new Date(t)];
        }
        return { scope: k.slice(0, at), hour: new Date(Number(k.slice(at + 1))), tunedMinutes: tuned, peak, peakAt };
      });
      for (let i = 0; i < netRows.length; i += 500) await tx.insert(schema.networkHours).values(netRows.slice(i, i + 500));
    });
    return stations.size;
  }

  async function days(list: string[]): Promise<void> {
    if (!list.length) return;
    const where = await places();
    for (const day of list) {
      const from = dayStart(day);
      const to = dayStart(nextDay(day));
      // Sessions started that day: counted ones (a minute counted) and bots.
      const sessions = await db
        .select({ id: S.id, stationId: S.stationId, startedAt: S.startedAt, lastBeatAt: S.lastBeatAt, flaggedBot: S.flaggedBot, flagReason: S.flagReason, via: S.via, tuneMs: S.tuneMs, deviceHash: S.deviceHash, marketId: S.marketId, visitId: S.visitId })
        .from(S)
        .where(and(gte(S.startedAt, from), lt(S.startedAt, to)));
      const counted = new Set(
        sessions.length
          ? (
              await db
                .selectDistinct({ id: SM.sessionId })
                .from(SM)
                .where(inArray(SM.sessionId, sessions.map((s) => s.id)))
            ).map((r) => r.id)
          : []
      );
      type Acc = { sessions: number; lengths: Record<string, number>; minutes: number[]; bots: number; botReasons: Record<string, number>; via: Record<string, number>; tune: number[] };
      /** Visits: each scope's counted sessions, by the visit they're in. */
      const visitsBy = new Map<string, Map<string, number>>();
      const acc = new Map<string, Acc>();
      const of = (id: string) => {
        let a = acc.get(id);
        if (!a) acc.set(id, (a = { sessions: 0, lengths: {}, minutes: [], bots: 0, botReasons: {}, via: {}, tune: [] }));
        return a;
      };
      for (const s of sessions) {
        const a = of(s.stationId);
        if (s.flaggedBot) {
          a.bots++;
          const reason = s.flagReason ?? "other";
          a.botReasons[reason] = (a.botReasons[reason] ?? 0) + 1;
          continue;
        }
        if (!counted.has(s.id)) continue;
        a.sessions++;
        const minutes = Math.max(0, (s.lastBeatAt.getTime() - s.startedAt.getTime()) / 60_000);
        a.minutes.push(minutes);
        const bucket = lengthBucket(minutes);
        a.lengths[bucket] = (a.lengths[bucket] ?? 0) + 1;
        if (s.via) a.via[s.via] = (a.via[s.via] ?? 0) + 1;
        if (s.tuneMs != null) a.tune.push(s.tuneMs);
        if (s.visitId) {
          for (const scope of [`station:${s.stationId}`, ...scopesFor(where.get(s.stationId) ?? { band: null, marketId: null })]) {
            let v = visitsBy.get(scope);
            if (!v) visitsBy.set(scope, (v = new Map()));
            v.set(s.visitId, (v.get(s.visitId) ?? 0) + 1);
          }
        }
      }
      const pct = (xs: number[], p: number) => {
        if (!xs.length) return null;
        const s = [...xs].sort((x, y) => x - y);
        return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]!);
      };
      await db.delete(schema.stationDays).where(eq(schema.stationDays.day, day));
      const rows = [...acc].map(([stationId, a]) => ({
        day,
        stationId,
        sessions: a.sessions,
        lengths: a.lengths,
        medianMinutes: pct(a.minutes, 0.5),
        minutesTotal: Math.round(a.minutes.reduce((t, m) => t + m, 0)),
        version: DAY_VERSION,
        bots: a.bots,
        botReasons: a.botReasons,
        via: a.via,
        tuneMsMedian: pct(a.tune, 0.5),
        tuneMsP90: pct(a.tune, 0.9),
        computedAt: clock.now()
      }));
      if (rows.length) await db.insert(schema.stationDays).values(rows);

      // Devices: that day, the 7 and 30 days to it, and returning (seen in the 30 days before).
      const deviceRows = (await db.execute(sql`
        select s.device_hash as "device", s.station_id as "stationId", s.started_at as "at"
        from ${S} s
        where s.device_hash is not null and not s.flagged_bot and s.started_at >= ${new Date(from.getTime() - 60 * DAY)} and s.started_at < ${to}
          and exists (select 1 from ${SM} sm where sm.session_id = s.id)`)) as unknown as Rows<{ device: string; stationId: string; at: Date | string }>;
      const scopesOf = (stationId: string) => [`station:${stationId}`, ...scopesFor(where.get(stationId) ?? { band: null, marketId: null })];
      const windows = { d1: from.getTime(), d7: to.getTime() - 7 * DAY, d30: to.getTime() - 30 * DAY, before: from.getTime() - 30 * DAY };
      const sets = new Map<string, { d1: Set<string>; d7: Set<string>; d30: Set<string>; before: Set<string> }>();
      const setOf = (scope: string) => {
        let s = sets.get(scope);
        if (!s) sets.set(scope, (s = { d1: new Set(), d7: new Set(), d30: new Set(), before: new Set() }));
        return s;
      };
      for (const r of deviceRows.rows) {
        const t = new Date(r.at).getTime();
        for (const scope of scopesOf(r.stationId)) {
          const s = setOf(scope);
          if (t >= windows.d1) s.d1.add(r.device);
          if (t >= windows.d7) s.d7.add(r.device);
          if (t >= windows.d30) s.d30.add(r.device);
          if (t < windows.d1 && t >= windows.before) s.before.add(r.device);
        }
      }
      await db.delete(schema.deviceDays).where(eq(schema.deviceDays.day, day));
      for (const scope of visitsBy.keys()) setOf(scope);
      const dRows = [...sets]
        .filter(([scope, s]) => s.d1.size || s.d7.size || s.d30.size || visitsBy.has(scope))
        .map(([scope, s]) => {
          const v = visitsBy.get(scope);
          return {
            day,
            scope,
            devices: s.d1.size,
            devices7: s.d7.size,
            devices30: s.d30.size,
            returning: [...s.d1].filter((d) => s.before.has(d)).length,
            visits: v?.size ?? 0,
            visitSessions: v ? [...v.values()].reduce((t, n) => t + n, 0) : 0
          };
        });
      for (let i = 0; i < dRows.length; i += 500) await db.insert(schema.deviceDays).values(dRows.slice(i, i + 500));

      // Moving around the dial: a visit's minutes in a row, station to station (with a margin so a
      // visit crossing midnight isn't counted as stopping or starting at it).
      const flows = (await db.execute(sql`
        with v as (
          select s.visit_id, sm.minute, sm.station_id, s.started_at
          from ${SM} sm join ${S} s on s.id = sm.session_id
          where s.visit_id is not null and sm.minute >= ${new Date(from.getTime() - 6 * HOUR)} and sm.minute < ${new Date(to.getTime() + 6 * HOUR)}
        ), seq as (
          select visit_id, minute, station_id,
            lag(station_id) over (partition by visit_id order by minute, started_at) as prev,
            lead(station_id) over (partition by visit_id order by minute, started_at) as next
          from v
        )
        select coalesce(prev::text, '') as "from", station_id::text as "to", count(*)::int as "n"
          from seq where (prev is null or prev <> station_id) and minute >= ${from} and minute < ${to} group by 1, 2
        union all
        select station_id::text as "from", '' as "to", count(*)::int as "n"
          from seq where next is null and minute >= ${from} and minute < ${to} group by 1`)) as unknown as Rows<{ from: string; to: string; n: number }>;
      await db.delete(schema.stationFlows).where(eq(schema.stationFlows.day, day));
      const merged = new Map<string, number>();
      for (const f of flows.rows) merged.set(`${f.from}>${f.to}`, (merged.get(`${f.from}>${f.to}`) ?? 0) + f.n);
      const fRows = [...merged].map(([k, changes]) => {
        const [fromStation, toStation] = k.split(">") as [string, string];
        return { day, fromStation, toStation, changes };
      });
      for (let i = 0; i < fRows.length; i += 500) await db.insert(schema.stationFlows).values(fRows.slice(i, i + 500));
    }
  }

  return {
    places,
    hours,
    days,
    async tick() {
      const now = clock.now();
      // The first run fills in from the oldest minute kept; after that, the last few hours.
      const [last] = await db.select({ hour: sql<Date | string | null>`max(${schema.stationHours.hour})` }).from(schema.stationHours);
      const [oldest] = await db.select({ minute: sql<Date | string | null>`min(${SM.minute})` }).from(SM);
      const since = last?.hour ? new Date(new Date(last.hour).getTime() - 2 * HOUR) : oldest?.minute ? new Date(oldest.minute) : new Date(now.getTime() - 3 * HOUR);
      const hoursDone = await hours(since, new Date(now.getTime() + 1));
      // Days: today and yesterday every time; any day without totals since the oldest session.
      const today = dayOf(now);
      const yesterday = dayOf(new Date(dayStart(today).getTime() - 12 * HOUR));
      const due = new Set([yesterday, today]);
      const [firstSession] = await db.select({ at: sql<Date | string | null>`min(${S.startedAt})` }).from(S);
      if (firstSession?.at) {
        // Days missing, or worked out by an older version, while their sessions are kept.
        const have = new Set(
          (await db.selectDistinct({ day: schema.stationDays.day }).from(schema.stationDays).where(sql`${schema.stationDays.version} >= ${DAY_VERSION}`)).map((r) => String(r.day))
        );
        for (let d = dayOf(new Date(firstSession.at)); d < yesterday; d = nextDay(d)) if (!have.has(d)) due.add(d);
      }
      await days([...due].sort());
      return { hours: hoursDone, days: due.size };
    }
  };
}
