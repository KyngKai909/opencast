// Tuned in: players send a heartbeat every 30 seconds. A session counts from its
// second heartbeat, and only while its media time moves, so tabs left on a paused
// player and scripts sending beats never count. Per-minute concurrency is kept per
// station; billing per thousand tuned in reads it.

import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { AudienceReport } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { badRequest } from "../../errors.js";

type Platform = "phone" | "cast" | "web" | "tv_app" | "mirror";

export const HEARTBEAT_MS = 30_000;
/** Closer beats than this aren't a real player. */
const MIN_GAP_MS = 10_000;
/** Media time can't move faster than the clock (with slack for buffering catch-up). */
const MAX_RATE = 1.5;
const MINUTE = 60_000;

export interface AudienceService {
  heartbeat(input: { stationId: string; sessionId: string; platform: Platform; mediaTimeMs: number; playing: boolean }): Promise<void>;
  /** Tuned in, averaged over a window (e.g. one airing of a spot). */
  averageTunedIn(stationId: string, from: Date, to: Date): Promise<number>;
  /** People tuned in, added up minute by minute, per station (the pool's watch-time share). */
  watchMinutes(from: Date, to: Date): Promise<Map<string, number>>;
  /** The usual tuned in for a station at this hour, from the last week: for estimates and holds. */
  typicalTunedIn(stationIds: string[], at: Date): Promise<Map<string, number>>;
  report(stationId: string, from: Date, to: Date): Promise<AudienceReport>;
}

export function createAudienceService({ deps, services }: ModuleContext): AudienceService {
  const { db } = deps;
  const S = schema.sessions;
  const M = schema.minuteSamples;

  const minuteOf = (at: Date) => new Date(Math.floor(at.getTime() / MINUTE) * MINUTE);

  const service: AudienceService = {
    async heartbeat(input) {
      const now = deps.clock.now();
      const [existing] = await db.select().from(S).where(eq(S.id, input.sessionId));
      if (!existing) {
        await db.insert(S).values({
          id: input.sessionId,
          stationId: input.stationId,
          platform: input.platform,
          startedAt: now,
          lastBeatAt: now,
          beats: 1,
          lastMediaTimeMs: input.mediaTimeMs
        });
        return;
      }
      if (existing.stationId !== input.stationId) {
        throw badRequest("A session is for one station; start a new one when you change channel.");
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
        .where(eq(S.id, input.sessionId));

      // Count each session once per minute it's watching.
      // The first heartbeat never counts, so the second always does; after that, once a minute.
      if (counts && (existing.beats === 1 || minuteOf(existing.lastBeatAt).getTime() !== minuteOf(now).getTime())) {
        const key = ({ phone: "phone", cast: "cast", web: "web", tv_app: "tvApp", mirror: "mirror" } as const)[input.platform];
        const count = async (minute: Date) => {
          await db
            .insert(M)
            .values({ stationId: input.stationId, minute, tunedIn: 1, [key]: 1 })
            .onConflictDoUpdate({ target: [M.stationId, M.minute], set: { tunedIn: sql`${M.tunedIn} + 1`, [key]: sql`${M[key]} + 1` } });
        };
        await count(minuteOf(now));
        // A beat covers the half minute before it too.
        const previous = minuteOf(new Date(now.getTime() - HEARTBEAT_MS));
        if (previous.getTime() !== minuteOf(now).getTime() && previous.getTime() > minuteOf(existing.lastBeatAt).getTime()) {
          await count(previous);
        }
      }
    },

    async watchMinutes(from, to) {
      const rows = await db
        .select({ stationId: M.stationId, minutes: sql<string>`coalesce(sum(${M.tunedIn}), 0)` })
        .from(M)
        .where(and(gte(M.minute, from), lt(M.minute, to)))
        .groupBy(M.stationId);
      return new Map(rows.map((r) => [r.stationId, Number(r.minutes)]));
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
        translators: translators.map((t) => ({
          translatorId: t.id,
          name: t.name,
          viewers: translatorCounts.find((c) => c.translatorId === t.id)?.viewers ?? 0
        }))
      };
    }
  };
  return service;
}
