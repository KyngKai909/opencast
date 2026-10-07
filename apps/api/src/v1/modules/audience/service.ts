// Tuned in: players send a heartbeat every 30 seconds. A session counts from its
// second heartbeat, and only while its media time moves, so tabs left on a paused
// player and scripts sending beats never count. Per-minute concurrency is kept per
// station; billing per thousand tuned in reads it.

import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { AudienceReport } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { badRequest } from "../../errors.js";
import { createWatchData, recordSessionMinute, type WatchData } from "./watch.js";

type Platform = "phone" | "cast" | "web" | "tv_app" | "mirror";
type TuneVia = import("@opencast/contracts").TuneVia;

/**
 * A251 (2026-10-06): a session is one station's. A player keeps one id for the tab (or the TV app's
 * run), so a second station it beats for gets a session of its own: an id worked out from the two,
 * the same every time. Before, those beats were refused and never counted.
 */
export function stationSessionId(visitId: string, stationId: string): string {
  const h = createHash("sha256").update(`${visitId}:${stationId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** A251: the device id as kept, a hash of it: counts of devices only, never the id. */
export function deviceHash(deviceId: string): string {
  return createHash("sha256").update(`opencast-device:${deviceId}`).digest("hex").slice(0, 32);
}

export const HEARTBEAT_MS = 30_000;
/** Closer beats than this aren't a real player. */
const MIN_GAP_MS = 10_000;
/** Media time can't move faster than the clock (with slack for buffering catch-up). */
const MAX_RATE = 1.5;
const MINUTE = 60_000;

export interface AudienceService {
  /** Not counted during the station's planned off air time: then it says when the station is back. */
  heartbeat(
    input: { stationId: string; sessionId: string; platform: Platform; mediaTimeMs: number; playing: boolean; deviceId?: string; via?: TuneVia; tuneMs?: number },
    /**
     * Added 2026-09-30 (follow-up Phase 3): where the viewer is, asked once when their session
     * starts: their chosen market, or a coarse location from the connection. Only the market is kept.
     */
    options?: { place?: () => Promise<string | null> }
  ): Promise<{ offAirUntil: string | null }>;
  /** Tuned in, averaged over a window (e.g. one airing of a spot). */
  averageTunedIn(stationId: string, from: Date, to: Date): Promise<number>;
  /**
   * Added 2026-09-30 (follow-up Phase 3): tuned in over a window, counting only viewers placed in
   * these markets (a local business's area). Viewers Opencast can't place aren't in it.
   */
  placedTunedIn(stationId: string, from: Date, to: Date, marketIds: string[]): Promise<number>;
  /** People tuned in, added up minute by minute, per station (the pool's watch-time share). */
  watchMinutes(from: Date, to: Date): Promise<Map<string, number>>;
  /** The usual tuned in for a station at this hour, from the last week: for estimates and holds. */
  typicalTunedIn(stationIds: string[], at: Date): Promise<Map<string, number>>;
  report(stationId: string, from: Date, to: Date): Promise<AudienceReport>;
  /** A251: the session a player's id stands for on this station (its own, or the one made for the station), if there is one. */
  sessionOn(sessionId: string, stationId: string): Promise<string | null>;
  /** Watch data (added 2026-09-29, follow-up Phase 1): per airing of each program; votes; the daily purge. */
  watch: WatchData;
}

export function createAudienceService({ deps, services }: ModuleContext): AudienceService {
  const { db } = deps;
  const S = schema.sessions;
  const M = schema.minuteSamples;
  const MM = schema.minuteMarkets;

  const minuteOf = (at: Date) => new Date(Math.floor(at.getTime() / MINUTE) * MINUTE);

  const service: AudienceService = {
    watch: createWatchData({ deps, services }),

    async heartbeat(input, options = {}) {
      const now = deps.clock.now();
      // Planned off air (off air hours, a sign-off on the log): nothing's on, so nobody's tuned in.
      const off = await services.log.offAirAt(input.stationId, now);
      if (off) return { offAirUntil: off.backAt };
      // A251: the tab's id is the first station's session; any other station's is made from both.
      let [existing] = await db.select().from(S).where(eq(S.id, input.sessionId));
      let sessionId = input.sessionId;
      if (existing && existing.stationId !== input.stationId) {
        sessionId = stationSessionId(input.sessionId, input.stationId);
        [existing] = await db.select().from(S).where(eq(S.id, sessionId));
      }
      if (!existing) {
        // Placed once, by market only: the address it came from is never kept.
        const marketId = options.place ? await options.place().catch(() => null) : null;
        await db
          .insert(S)
          .values({
            id: sessionId,
            stationId: input.stationId,
            platform: input.platform,
            startedAt: now,
            lastBeatAt: now,
            beats: 1,
            lastMediaTimeMs: input.mediaTimeMs,
            marketId,
            visitId: input.sessionId,
            deviceHash: input.deviceId ? deviceHash(input.deviceId) : null,
            via: input.via ?? null,
            tuneMs: input.tuneMs ?? null
          })
          // Two first beats at once (a retry): the first one stands.
          .onConflictDoNothing();
        return { offAirUntil: null };
      }
      const gap = now.getTime() - existing.lastBeatAt.getTime();
      const progress = input.mediaTimeMs - (existing.lastMediaTimeMs ?? 0);
      let flagReason: string | null = null;
      if (gap < MIN_GAP_MS) flagReason = "beats too close together";
      else if (progress > gap * MAX_RATE + 5_000) flagReason = "media time moving faster than the clock";
      const counts = !existing.flaggedBot && !flagReason && input.playing && progress > 0;

      await db
        .update(S)
        .set({
          lastBeatAt: now,
          beats: existing.beats + 1,
          lastMediaTimeMs: input.mediaTimeMs,
          ...(flagReason ? { flaggedBot: true, flagReason } : {})
        })
        .where(eq(S.id, sessionId));

      // Count each session once per minute it's watching.
      // The first heartbeat never counts, so the second always does; after that, once a minute.
      if (counts && (existing.beats === 1 || minuteOf(existing.lastBeatAt).getTime() !== minuteOf(now).getTime())) {
        const key = ({ phone: "phone", cast: "cast", web: "web", tv_app: "tvApp", mirror: "mirror" } as const)[input.platform];
        // An external station's minutes (follow-up Phase 6) are watch data only, labelled external:
        // never in the tuned-in counts the pool and per-thousand billing read.
        const external = (await services.stations.kindOf(input.stationId)) === "listed";
        const count = async (minute: Date) => {
          if (external) return recordSessionMinute(db, { sessionId, stationId: input.stationId, minute });
          await db
            .insert(M)
            .values({ stationId: input.stationId, minute, tunedIn: 1, [key]: 1 })
            .onConflictDoUpdate({ target: [M.stationId, M.minute], set: { tunedIn: sql`${M.tunedIn} + 1`, [key]: sql`${M[key]} + 1` } });
          // Where they are (2026-09-30): the same minute by market, for local businesses' spots.
          if (existing.marketId) {
            await db
              .insert(MM)
              .values({ stationId: input.stationId, minute, marketId: existing.marketId, tunedIn: 1 })
              .onConflictDoUpdate({ target: [MM.stationId, MM.minute, MM.marketId], set: { tunedIn: sql`${MM.tunedIn} + 1` } });
          }
          // Watch data: the same minute, for this session, kept 30 days (watch.ts).
          await recordSessionMinute(db, { sessionId, stationId: input.stationId, minute });
        };
        await count(minuteOf(now));
        // A beat covers the half minute before it too.
        const previous = minuteOf(new Date(now.getTime() - HEARTBEAT_MS));
        if (previous.getTime() !== minuteOf(now).getTime() && previous.getTime() > minuteOf(existing.lastBeatAt).getTime()) {
          await count(previous);
        }
      }
      return { offAirUntil: null };
    },

    async sessionOn(sessionId, stationId) {
      for (const id of [sessionId, stationSessionId(sessionId, stationId)]) {
        const [row] = await db.select({ stationId: S.stationId }).from(S).where(eq(S.id, id));
        if (row?.stationId === stationId) return id;
      }
      return null;
    },

    async watchMinutes(from, to) {
      const rows = await db
        .select({ stationId: M.stationId, minutes: sql<string>`coalesce(sum(${M.tunedIn}), 0)` })
        .from(M)
        .where(and(gte(M.minute, from), lt(M.minute, to)))
        .groupBy(M.stationId);
      // Never an external station's (they're not counted into minute_samples; this keeps it so).
      const external = new Set(await services.stations.idsOfKinds(["listed"]));
      return new Map(rows.filter((r) => !external.has(r.stationId)).map((r) => [r.stationId, Number(r.minutes)]));
    },

    async averageTunedIn(stationId, from, to) {
      const rows = await db
        .select()
        .from(M)
        .where(and(eq(M.stationId, stationId), gte(M.minute, minuteOf(from)), lt(M.minute, to)));
      if (!rows.length) return 0;
      // Weight each minute by how much of the window it covers.
      let weighted = 0;
      let covered = 0;
      for (const row of rows) {
        const start = Math.max(row.minute.getTime(), from.getTime());
        const end = Math.min(row.minute.getTime() + MINUTE, to.getTime());
        if (end <= start) continue;
        weighted += row.tunedIn * (end - start);
        covered += end - start;
      }
      const span = to.getTime() - from.getTime();
      return span > 0 ? weighted / span : covered ? weighted / covered : 0;
    },

    async placedTunedIn(stationId, from, to, marketIds) {
      if (!marketIds.length) return 0;
      const rows = await db
        .select({ minute: MM.minute, tunedIn: sql<number>`sum(${MM.tunedIn})::int` })
        .from(MM)
        .where(and(eq(MM.stationId, stationId), inArray(MM.marketId, marketIds), gte(MM.minute, minuteOf(from)), lt(MM.minute, to)))
        .groupBy(MM.minute);
      // Weighted as averageTunedIn is: each minute by how much of the window it covers.
      let weighted = 0;
      for (const row of rows) {
        const start = Math.max(row.minute.getTime(), from.getTime());
        const end = Math.min(row.minute.getTime() + MINUTE, to.getTime());
        if (end > start) weighted += Number(row.tunedIn) * (end - start);
      }
      const span = to.getTime() - from.getTime();
      return span > 0 ? weighted / span : 0;
    },

    async typicalTunedIn(stationIds, at) {
      if (!stationIds.length) return new Map();
      const weekAgo = new Date(at.getTime() - 7 * 86_400_000);
      const hour = at.getUTCHours();
      const rows = await db
        .select({ stationId: M.stationId, avg: sql<number>`avg(${M.tunedIn})::float` })
        .from(M)
        .where(and(inArray(M.stationId, stationIds), gte(M.minute, weekAgo), lt(M.minute, at), sql`extract(hour from ${M.minute} at time zone 'UTC') = ${hour}`))
        .groupBy(M.stationId);
      const result = new Map(rows.map((r) => [r.stationId, Math.round(r.avg)]));
      // No history at this hour: the week's average across all hours.
      const missing = stationIds.filter((id) => !result.has(id));
      if (missing.length) {
        const overall = await db
          .select({ stationId: M.stationId, avg: sql<number>`avg(${M.tunedIn})::float` })
          .from(M)
          .where(and(inArray(M.stationId, missing), gte(M.minute, weekAgo), lt(M.minute, at)))
          .groupBy(M.stationId);
        for (const r of overall) result.set(r.stationId, Math.round(r.avg));
      }
      return result;
    },

    async report(stationId, from, to) {
      if (to <= from || to.getTime() - from.getTime() > 32 * 86_400_000) throw badRequest("Ask for up to a month.");
      const now = deps.clock.now();
      const weekMs = 7 * 86_400_000;
      const [samples, lastWeek, live, presetCounts, breaks, entries] = await Promise.all([
        db.select().from(M).where(and(eq(M.stationId, stationId), gte(M.minute, from), lt(M.minute, to))).orderBy(asc(M.minute)),
        db
          .select()
          .from(M)
          .where(and(eq(M.stationId, stationId), gte(M.minute, new Date(from.getTime() - weekMs)), lt(M.minute, new Date(to.getTime() - weekMs)))),
        db
          .select({ platform: S.platform, n: sql<number>`count(*)::int` })
          .from(S)
          .where(and(eq(S.stationId, stationId), eq(S.flaggedBot, false), gte(S.lastBeatAt, new Date(now.getTime() - 2 * HEARTBEAT_MS)), sql`${S.beats} > 1`))
          .groupBy(S.platform),
        services.accounts.presetCounts([stationId]),
        services.log.breaks(stationId, from, to),
        services.log.entries(stationId, from, to)
      ]);
      const lastWeekBy = new Map(lastWeek.map((r) => [r.minute.getTime() + weekMs, r.tunedIn]));
      const inBreak = (minute: Date) =>
        breaks.some((b) => Date.parse(b.startsAt) < minute.getTime() + MINUTE && Date.parse(b.startsAt) + b.lengthMs > minute.getTime());
      const peak = samples.reduce<(typeof samples)[number] | null>((best, s) => (!best || s.tunedIn > best.tunedIn ? s : best), null);
      const byPlatform = { phone: 0, cast: 0, web: 0, tv_app: 0, mirror: 0 };
      for (const row of live) byPlatform[row.platform] = row.n;

      // Stayed to the end: tuned in over a program's last minute against its first.
      const sampleAt = new Map(samples.map((s) => [s.minute.getTime(), s.tunedIn]));
      const titles = await services.library.titles({
        itemIds: [],
        programIds: entries.map((e) => e.programId).filter((v): v is string => Boolean(v))
      });
      const stayed = new Map<string, { first: number; last: number }>();
      for (const e of entries) {
        if (!e.programId || e.endsAt > now) continue;
        const first = sampleAt.get(minuteOf(e.startsAt).getTime()) ?? 0;
        const last = sampleAt.get(minuteOf(new Date(e.endsAt.getTime() - MINUTE)).getTime()) ?? 0;
        const acc = stayed.get(e.programId) ?? { first: 0, last: 0 };
        stayed.set(e.programId, { first: acc.first + first, last: acc.last + last });
      }

      // U1: by program, one row per airing that has started, newest first.
      const airings = ((await services.log.window([stationId], from, to)).get(stationId) ?? []).filter(
        (a) => a.kind !== "off_air" && a.code === "PGM" && Date.parse(a.startsAt) <= now.getTime()
      );
      const byProgram = airings
        .map((a) => {
          const start = Date.parse(a.startsAt);
          const end = Math.min(Date.parse(a.endsAt), now.getTime());
          const over = samples.filter((m) => m.minute.getTime() >= minuteOf(new Date(start)).getTime() && m.minute.getTime() < end);
          const minutes = Math.max(1, Math.ceil((end - minuteOf(new Date(start)).getTime()) / MINUTE));
          const onNow = Date.parse(a.endsAt) > now.getTime();
          const first = sampleAt.get(minuteOf(new Date(start)).getTime()) ?? 0;
          const last = sampleAt.get(minuteOf(new Date(Date.parse(a.endsAt) - MINUTE)).getTime()) ?? 0;
          return {
            key: a.logEntryId ?? `${a.startsAt}:${a.title}`,
            programId: a.programId,
            title: a.title,
            airedAt: a.startsAt,
            airings: 1,
            source: a.live ? ("live" as const) : a.carriedFrom ? ("carried" as const) : ("library" as const),
            carriedFrom: a.carriedFrom,
            averageTunedIn: Math.round(over.reduce((sum, m) => sum + m.tunedIn, 0) / minutes),
            peakTunedIn: over.reduce((max, m) => Math.max(max, m.tunedIn), 0),
            stayedToTheEnd: onNow || first === 0 ? null : Math.round((last / first) * 100),
            onNow
          };
        })
        .sort((a, b) => (b.airedAt ?? "").localeCompare(a.airedAt ?? ""));
      // Watch data: each airing's own numbers, behind the minimum audience.
      const watch = await service.watch.forStation(
        stationId,
        airings.map((a) => ({ logEntryId: a.logEntryId, endsAt: a.endsAt, onNow: Date.parse(a.endsAt) > now.getTime() }))
      );
      const byProgramWithWatch = byProgram.map((row) => {
        const w = row.key && watch.get(row.key);
        return w ? { ...row, watch: w } : row;
      });

      const translators = await services.stations.translators(stationId);
      const translatorCounts = translators.length
        ? await db
            .select()
            .from(schema.translatorSamples)
            .where(inArray(schema.translatorSamples.translatorId, translators.map((t) => t.id)))
            .orderBy(desc(schema.translatorSamples.minute))
        : [];

      return {
        tunedInNow: Object.values(byPlatform).reduce((a, b) => a + b, 0),
        peak: peak ? { tunedIn: peak.tunedIn, at: peak.minute.toISOString() } : null,
        hoursWatched: Math.round((samples.reduce((sum, s) => sum + s.tunedIn, 0) / 60) * 10) / 10,
        presetCount: presetCounts.get(stationId) ?? 0,
        series: samples.map((s) => ({
          minute: s.minute.toISOString(),
          tunedIn: s.tunedIn,
          lastWeek: lastWeekBy.get(s.minute.getTime()) ?? null,
          inBreak: inBreak(s.minute)
        })),
        byPlatform,
        stayedToTheEnd: [...stayed].flatMap(([programId, v]) =>
          v.first > 0 ? [{ programId, title: titles.programs.get(programId) ?? "", percent: Math.round((v.last / v.first) * 100) }] : []
        ),
        translators: [
          ...translators.map((t) => ({
            translatorId: t.id,
            name: t.name,
            viewers: translatorCounts.find((c) => c.translatorId === t.id)?.viewers ?? 0
          })),
          // Connected YouTube and Twitch (2026-09-30): the viewers each reported last, shown apart from Opencast's.
          ...(await services.platforms.latestViewers(stationId)).map((p) => ({ translatorId: p.platformId, name: p.name, viewers: p.viewers }))
        ],
        byProgram: byProgramWithWatch,
        // U3: the same window a week earlier, the whole way (minutes with anyone tuned in), and every break.
        comparison: lastWeek
          .map((r) => ({ minute: new Date(r.minute.getTime() + weekMs).toISOString(), tunedIn: r.tunedIn }))
          .sort((a, b) => a.minute.localeCompare(b.minute)),
        breaks: breaks.map((b) => ({ startsAt: b.startsAt, endsAt: new Date(Date.parse(b.startsAt) + b.lengthMs).toISOString() }))
      };
    }
  };
  return service;
}
