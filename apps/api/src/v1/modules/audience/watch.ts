// Watch data (added 2026-09-29, follow-up Phase 1): per airing of each program, what the tuned-in
// sessions did while it was on. Collected and stored only: nothing here changes what airs or how
// money is split, and nothing that pays reads it (the pool reads minute_samples).
//
// - Every minute a session counts as tuned in (the heartbeat's own rule: from its second beat, only
//   while media time moves, never a session flagged as a bot) is kept in `session_minutes`.
// - Every ten minutes, each program airing in the as-run log that ended at least five minutes ago
//   is worked out from those minutes, leaving out every session flagged as a bot (even minutes it
//   counted before it was caught), into `airing_stats`. An hour after it ended it's final: its
//   "Not for me" votes are deleted, having been counted.
// - Every day, sessions, their minutes and any votes left older than `watch_data.retention` (30
//   days) are deleted. What stays is `airing_stats`, which names no session and no person.
// - Numbers show only for an airing with `watch_data.minimum_audience` (20) viewers at once at some
//   point. A maker sees its programs added up across stations, other stations' airings only in
//   twos or more that reach the minimum between them.

import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { schema } from "@opencast/db";
import { NOT_ENOUGH_VIEWERS, type AiringWatch, type MakerProgramWatch, type MakerWatchData, type WatchTimeLabel } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { badRequest, conflict } from "../../errors.js";
import type { ProgramRow } from "../playout/service.js";
import type { OtherApps } from "./otherApps.js";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** A251: how long a search viewers settled on is kept (then only totals). */
const SEARCH_DAYS = 90;
/** An airing is worked out once it's been over this long (the last beats are in). */
export const SETTLE_MS = 5 * MINUTE;
/** ...and for the last time this long after it ended; its votes then go. */
export const FINAL_MS = HOUR;
/** How far back each run looks for airings that aren't final. */
const LOOKBACK_MS = 26 * HOUR;
/** A vote counts from a session tuned in for at least this many of the program's minutes. */
export const VOTE_MIN_MINUTES = 2;

export const timeLabel = (band: "tv" | "radio" | null | undefined): WatchTimeLabel => (band === "radio" ? "listening_time" : "watch_time");

export interface AiringNumbers {
  minutes: number;
  watchSeconds: number;
  audienceAtStart: number;
  peakAudience: number;
  audienceAtEnd: number;
  stayedToEnd: number;
  tuneAways: number[];
  notForMe: number;
}

/**
 * One airing's numbers. `segments` are its program rows (ms; breaks inside it are between them);
 * `presence` each session's counted minutes (minute starts, ms), bots already left out; `voters`
 * the sessions that voted "Not for me" on it.
 */
export function airingNumbers(segments: Array<{ start: number; end: number }>, presence: Map<string, Set<number>>, voters: Iterable<string>): AiringNumbers {
  const start = Math.min(...segments.map((s) => s.start));
  const end = Math.max(...segments.map((s) => s.end));
  const first = Math.floor(start / MINUTE) * MINUTE;
  const last = Math.floor(Math.max(start, end - 1) / MINUTE) * MINUTE;
  const n = (last - first) / MINUTE + 1;
  const buckets = Array.from({ length: n }, (_, i) => first + i * MINUTE);
  // How much of each minute the program itself was on (not a break inside it, nor the next thing).
  const onAir = buckets.map((m) => segments.reduce((sum, s) => sum + Math.max(0, Math.min(s.end, m + MINUTE) - Math.max(s.start, m)), 0));
  const audience = buckets.map((m) => {
    let count = 0;
    for (const minutes of presence.values()) if (minutes.has(m)) count++;
    return count;
  });
  const tuneAways = buckets.map((m, i) => {
    if (i === 0) return 0;
    let left = 0;
    for (const minutes of presence.values()) if (minutes.has(buckets[i - 1]) && !minutes.has(m)) left++;
    return left;
  });
  let stayedToEnd = 0;
  for (const minutes of presence.values()) if (minutes.has(first) && minutes.has(last)) stayedToEnd++;
  let notForMe = 0;
  for (const voter of new Set(voters)) {
    const minutes = presence.get(voter);
    if (minutes && buckets.filter((m) => minutes.has(m)).length >= VOTE_MIN_MINUTES) notForMe++;
  }
  return {
    minutes: n,
    watchSeconds: Math.round(audience.reduce((sum, a, i) => sum + a * onAir[i], 0) / 1000),
    audienceAtStart: audience[0],
    peakAudience: Math.max(...audience),
    audienceAtEnd: audience[n - 1],
    stayedToEnd,
    tuneAways,
    notForMe
  };
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);
const tenths = (seconds: number) => Math.round(seconds / 6) / 10;

type Stat = typeof schema.airingStats.$inferSelect;

/** An airing's numbers for the station, behind the minimum audience. */
export function airingWatch(stat: Stat | null, band: "tv" | "radio" | null, minimumViewers: number): AiringWatch {
  const blank = { watchMinutes: null, audienceAtStart: null, peakAudience: null, audienceAtEnd: null, stayedToTheEnd: null, tuneAways: null, notForMe: null };
  if (!stat) return { status: "counting", note: null, timeLabel: timeLabel(band), ...blank };
  if (stat.peakAudience < minimumViewers) return { status: "not_enough_viewers", note: NOT_ENOUGH_VIEWERS, timeLabel: timeLabel(stat.band), ...blank };
  return {
    status: "shown",
    note: null,
    timeLabel: timeLabel(stat.band),
    watchMinutes: tenths(stat.watchSeconds),
    audienceAtStart: stat.audienceAtStart,
    peakAudience: stat.peakAudience,
    audienceAtEnd: stat.audienceAtEnd,
    stayedToTheEnd: percent(stat.stayedToEnd, stat.audienceAtStart),
    tuneAways: stat.tuneAways,
    notForMe: stat.notForMe
  };
}

export interface WatchData {
  /** A "Not for me" on what's on the station's log now. Taken whether or not the feature flag is on. */
  vote(input: { stationId: string; sessionId: string }): Promise<{ status: "recorded" | "already_recorded" }>;
  /** Works out the airings that ended since `since` (26 hours ago) and aren't final. */
  aggregate(options?: { since?: Date }): Promise<{ computed: number; finalized: number; votesDeleted: number }>;
  /** Deletes sessions, their minutes and votes older than the retention rule (30 days). */
  purge(): Promise<{ sessions: number; minutes: number; votes: number; searches: number }>;
  /** The station's own airings (by log entry) for its Audience page. */
  forStation(stationId: string, airings: Array<{ logEntryId: string | null; endsAt: string; onNow: boolean }>): Promise<Map<string, AiringWatch>>;
  /** A maker's programs across every station that aired them, added up. */
  forMaker(makerStationId: string, from: Date, to: Date): Promise<MakerWatchData>;
}

export function createWatchData({ deps, services }: ModuleContext, otherApps?: Pick<OtherApps, "forget">): WatchData {
  const { db } = deps;
  const S = schema.sessions;
  const SM = schema.sessionMinutes;
  const V = schema.notForMeVotes;
  const A = schema.airingStats;

  const keyOf = (row: ProgramRow) => (row.logEntryId ? `entry:${row.logEntryId}` : `as_run:${row.id}`);

  async function compute(rows: ProgramRow[]): Promise<AiringNumbers> {
    return computeSegments(rows[0].stationId, rows.map((r) => ({ start: r.startedAt.getTime(), end: r.endedAt.getTime() })), rows[0].logEntryId);
  }

  /** One airing's numbers from its segments (ms) on a station; votes only for a log entry's. */
  async function computeSegments(stationId: string, segments: Array<{ start: number; end: number }>, entryId: string | null): Promise<AiringNumbers> {
    const first = Math.floor(Math.min(...segments.map((s) => s.start)) / MINUTE) * MINUTE;
    const last = Math.max(...segments.map((s) => s.end));
    // Bot filtering first: a session ever flagged is left out altogether.
    const minutes = await db
      .select({ sessionId: SM.sessionId, minute: SM.minute })
      .from(SM)
      .innerJoin(S, eq(S.id, SM.sessionId))
      .where(and(eq(SM.stationId, stationId), gte(SM.minute, new Date(first)), lt(SM.minute, new Date(last)), eq(S.flaggedBot, false)));
    const presence = new Map<string, Set<number>>();
    for (const m of minutes) {
      const set = presence.get(m.sessionId) ?? new Set<number>();
      set.add(m.minute.getTime());
      presence.set(m.sessionId, set);
    }
    const voters = entryId ? (await db.select({ sessionId: V.sessionId }).from(V).where(and(eq(V.logEntryId, entryId), eq(V.stationId, stationId)))).map((v) => v.sessionId) : [];
    return airingNumbers(segments, presence, voters);
  }

  /** Program airings in the as-run log that ended since `since`. */
  async function aggregatePrograms(now: Date, since: Date): Promise<{ computed: number; finalized: number; votesDeleted: number }> {
    const recent = await services.playout.programRows({ endedFrom: since, endedTo: now });
    // Each log entry's rows, all of them (a long program's first rows may have ended earlier).
    const entryIds = [...new Set(recent.map((r) => r.logEntryId).filter((v): v is string => !!v))];
    const all = [...recent.filter((r) => !r.logEntryId), ...(entryIds.length ? await services.playout.programRows({ logEntryIds: entryIds }) : [])];
    const groups = new Map<string, ProgramRow[]>();
    for (const row of all) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
    if (!groups.size) return { computed: 0, finalized: 0, votesDeleted: 0 };

    const done = new Set((await db.select({ key: A.airingKey }).from(A).where(and(inArray(A.airingKey, [...groups.keys()]), eq(A.final, true)))).map((r) => r.key));
    const pending = [...groups].filter(([key]) => !done.has(key));
    if (!pending.length) return { computed: 0, finalized: 0, votesDeleted: 0 };
    const stationIds = [...new Set(pending.map(([, rows]) => rows[0].stationId))];
    const programIds = [...new Set(pending.flatMap(([, rows]) => rows.map((r) => r.programId)).filter((v): v is string => !!v))];
    const [idents, programs] = await Promise.all([services.stations.idents(stationIds), services.library.programsByIds(programIds)]);

    let computed = 0;
    let finalized = 0;
    let votesDeleted = 0;
    for (const [key, rows] of pending) {
      rows.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
      const head = rows[0];
      const lastEnd = Math.max(...rows.map((r) => r.endedAt.getTime()));
      // Still on (by the log), or just over: not yet.
      const span = head.logEntryId ? await services.log.entrySpan(head.logEntryId) : null;
      const ends = Math.max(lastEnd, span && span.startsAt.getTime() <= lastEnd ? span.endsAt.getTime() : 0);
      if (now.getTime() < ends + SETTLE_MS) continue;
      const numbers = await compute(rows);
      const final = now.getTime() >= ends + FINAL_MS;
      const ident = idents.get(head.stationId);
      const programId = rows.find((r) => r.programId)?.programId ?? null;
      const values = {
        airingKey: key,
        stationId: head.stationId,
        logEntryId: head.logEntryId,
        asRunId: head.id,
        programId,
        makerStationId: programId ? (programs.get(programId)?.stationId ?? null) : null,
        carried: rows.some((r) => r.carried),
        band: ident?.band ?? "tv",
        // Phase 6's external stations come in as `listed` stations; labelled, never paid from.
        external: ident?.kind === "listed",
        startedAt: head.startedAt,
        endedAt: new Date(lastEnd),
        ...numbers,
        final,
        computedAt: now
      };
      await db.transaction(async (tx) => {
        await tx.insert(A).values(values).onConflictDoUpdate({ target: A.airingKey, set: { ...values } });
        if (final && head.logEntryId) {
          // Counted: the votes (tied to sessions) go now, not in 30 days.
          const gone = await tx.delete(V).where(and(eq(V.logEntryId, head.logEntryId), eq(V.stationId, head.stationId))).returning({ sessionId: V.sessionId });
          votesDeleted += gone.length;
        }
      });
      computed++;
      if (final) finalized++;
    }
    return { computed, finalized, votesDeleted };
  }

  /**
   * External stations (follow-up Phase 6) have no as-run log: each scheduled airing from the
   * source's own schedule (`listed:<airing>`), and each hour outside them (`external:<station>:<hour>`),
   * worked out from the tuned-in minutes Opencast's player sent. Labelled external; nothing that
   * pays reads them. Only what someone watched gets a row.
   */
  async function aggregateExternal(now: Date, since: Date): Promise<{ computed: number; finalized: number }> {
    const external = await services.stations.idsOfKinds(["listed"]);
    if (!external.length) return { computed: 0, finalized: 0 };
    const watched = await db
      .selectDistinct({ stationId: SM.stationId })
      .from(SM)
      .where(and(gte(SM.minute, since), lt(SM.minute, now), inArray(SM.stationId, external)));
    if (!watched.length) return { computed: 0, finalized: 0 };
    const stationIds = watched.map((w) => w.stationId);
    const [airings, idents, minutes] = await Promise.all([
      services.network.listedAiringsInWindow(stationIds, since, now),
      services.stations.idents(stationIds),
      db.select({ stationId: SM.stationId, minute: SM.minute }).from(SM).where(and(inArray(SM.stationId, stationIds), gte(SM.minute, since), lt(SM.minute, now)))
    ]);
    type Piece = { key: string; stationId: string; segments: Array<{ start: number; end: number }> };
    const pieces: Piece[] = [];
    for (const stationId of stationIds) {
      const seen = minutes.filter((m) => m.stationId === stationId).map((m) => m.minute.getTime());
      const watchedIn = (segments: Piece["segments"]) => seen.some((t) => segments.some((g) => t + MINUTE > g.start && t < g.end));
      const scheduled = (airings.get(stationId) ?? []).map((a) => ({ id: a.id, start: Date.parse(a.startsAt), end: a.endsAt ? Date.parse(a.endsAt) : Date.parse(a.startsAt) + HOUR }));
      for (const a of scheduled) {
        const segments = [{ start: a.start, end: a.end }];
        if (a.end > since.getTime() && now.getTime() >= a.end + SETTLE_MS && watchedIn(segments)) pieces.push({ key: `listed:${a.id}`, stationId, segments });
      }
      // The hours around them, whatever the source showed (no title: it's "Live").
      for (let h = Math.floor(since.getTime() / HOUR) * HOUR; h + HOUR + SETTLE_MS <= now.getTime(); h += HOUR) {
        let segments = [{ start: h, end: h + HOUR }];
        for (const a of scheduled) {
          segments = segments.flatMap((g) => (a.end <= g.start || a.start >= g.end ? [g] : [...(a.start > g.start ? [{ start: g.start, end: a.start }] : []), ...(a.end < g.end ? [{ start: a.end, end: g.end }] : [])]));
        }
        if (segments.length && watchedIn(segments)) pieces.push({ key: `external:${stationId}:${new Date(h).toISOString()}`, stationId, segments });
      }
    }
    if (!pieces.length) return { computed: 0, finalized: 0 };
    const done = new Set((await db.select({ key: A.airingKey }).from(A).where(and(inArray(A.airingKey, pieces.map((p) => p.key)), eq(A.final, true)))).map((r) => r.key));
    let computed = 0;
    let finalized = 0;
    for (const piece of pieces) {
      if (done.has(piece.key)) continue;
      const numbers = await computeSegments(piece.stationId, piece.segments, null);
      const start = Math.min(...piece.segments.map((g) => g.start));
      const end = Math.max(...piece.segments.map((g) => g.end));
      const final = now.getTime() >= end + FINAL_MS;
      const values = {
        airingKey: piece.key,
        stationId: piece.stationId,
        logEntryId: null,
        asRunId: null,
        programId: null,
        makerStationId: null,
        carried: false,
        band: idents.get(piece.stationId)?.band ?? "tv",
        external: true,
        startedAt: new Date(start),
        endedAt: new Date(end),
        ...numbers,
        final,
        computedAt: now
      };
      await db.insert(A).values(values).onConflictDoUpdate({ target: A.airingKey, set: { ...values } });
      computed++;
      if (final) finalized++;
    }
    return { computed, finalized };
  }

  const service: WatchData = {
    async vote({ stationId, sessionId }) {
      const [session] = await db.select({ stationId: S.stationId }).from(S).where(eq(S.id, sessionId));
      if (!session || session.stationId !== stationId) throw badRequest("Tune in to this station first.", { sessionId: "Not a session on this station" });
      const now = deps.clock.now();
      const on = (await services.log.nowNext([stationId], now)).get(stationId)?.now ?? null;
      if (!on || !on.logEntryId || on.kind === "off_air" || on.code !== "PGM") throw conflict("nothing_on", "There's nothing on the log to vote on right now.");
      const inserted = await db.insert(V).values({ sessionId, stationId, logEntryId: on.logEntryId, votedAt: now }).onConflictDoNothing().returning({ sessionId: V.sessionId });
      return { status: inserted.length ? "recorded" : "already_recorded" };
    },

    async aggregate(options = {}) {
      const now = deps.clock.now();
      const retention = (await services.settings.valueAt("watch_data.retention", now)).days * DAY;
      // Never earlier than the sessions still kept: numbers from purged minutes would be zeros.
      const since = new Date(Math.max(options.since?.getTime() ?? now.getTime() - LOOKBACK_MS, now.getTime() - retention + DAY));
      const programs = await aggregatePrograms(now, since);
      const external = await aggregateExternal(now, since);
      return { computed: programs.computed + external.computed, finalized: programs.finalized + external.finalized, votesDeleted: programs.votesDeleted };
    },
    async purge() {
      const now = deps.clock.now();
      const days = (await services.settings.valueAt("watch_data.retention", now)).days;
      const cutoff = new Date(now.getTime() - days * DAY);
      // Anything not worked out yet is worked out first (it may be the last chance).
      await service.aggregate({ since: new Date(cutoff.getTime() + DAY) });
      const minutes = await db.delete(SM).where(lt(SM.minute, cutoff)).returning({ id: SM.sessionId });
      const votes = await db.delete(V).where(lt(V.votedAt, cutoff)).returning({ id: V.sessionId });
      const sessions = await db.delete(S).where(lt(S.lastBeatAt, cutoff)).returning({ id: S.id });
      // A251: searches viewers settled on go after 90 days, whatever the retention rule says.
      const searches = await db.delete(schema.searches).where(lt(schema.searches.at, new Date(now.getTime() - SEARCH_DAYS * DAY))).returning({ id: schema.searches.id });
      // Programming Phase 5: other apps' sessions keep their counts, not the hashed key of where they came from.
      await otherApps?.forget();
      return { sessions: sessions.length, minutes: minutes.length, votes: votes.length, searches: searches.length };
    },

    async forStation(stationId, airings) {
      const entryIds = airings.map((a) => a.logEntryId).filter((v): v is string => !!v);
      const out = new Map<string, AiringWatch>();
      if (!entryIds.length) return out;
      const now = deps.clock.now();
      const [stats, idents, minimum] = await Promise.all([
        db.select().from(A).where(and(eq(A.stationId, stationId), inArray(A.logEntryId, entryIds))),
        services.stations.idents([stationId]),
        services.settings.valueAt("watch_data.minimum_audience", now)
      ]);
      const band = idents.get(stationId)?.band ?? null;
      const byEntry = new Map(stats.map((s) => [s.logEntryId!, s]));
      for (const a of airings) {
        if (!a.logEntryId) continue;
        const stat = byEntry.get(a.logEntryId) ?? null;
        // Not worked out yet: on now, or over within the last couple of hours. Older airings with
        // no numbers (before watch data, or never in the as-run log) say nothing.
        if (!stat && !a.onNow && now.getTime() - Date.parse(a.endsAt) > 2 * HOUR) continue;
        out.set(a.logEntryId, airingWatch(stat, band, minimum.viewers));
      }
      return out;
    },

    async forMaker(makerStationId, from, to) {
      const now = deps.clock.now();
      const [programs, minimum] = await Promise.all([services.library.programsForStation(makerStationId), services.settings.valueAt("watch_data.minimum_audience", now)]);
      const titles = new Map(programs.map((p) => [p.id, p.title]));
      const stats = titles.size
        ? await db
            .select()
            .from(A)
            .where(and(inArray(A.programId, [...titles.keys()]), gte(A.startedAt, from), lt(A.startedAt, to), eq(A.external, false)))
        : [];
      const groups = new Map<string, Stat[]>();
      for (const s of stats) groups.set(`${s.programId}:${s.band}`, [...(groups.get(`${s.programId}:${s.band}`) ?? []), s]);

      const rows: MakerProgramWatch[] = [...groups.values()].map((list) => {
        const { programId, band } = list[0];
        const own = list.filter((s) => s.stationId === makerStationId);
        const others = list.filter((s) => s.stationId !== makerStationId);
        // Other stations' airings only together: never few enough to single one out.
        const othersCount = others.length >= minimum.carriedAirings && others.reduce((sum, s) => sum + s.peakAudience, 0) >= minimum.viewers;
        const counted = othersCount ? [...own, ...others] : own;
        const combinedPeak = counted.reduce((sum, s) => sum + s.peakAudience, 0);
        const base = { programId: programId!, title: titles.get(programId!) ?? "", band, timeLabel: timeLabel(band), notCounted: { airings: othersCount ? 0 : others.length } };
        if (!counted.length || combinedPeak < minimum.viewers) {
          return { ...base, status: "not_enough_viewers" as const, note: NOT_ENOUGH_VIEWERS, stations: 0, airings: 0, totals: null };
        }
        const sum = (f: (s: Stat) => number) => counted.reduce((total, s) => total + f(s), 0);
        const tuneAways = Array.from({ length: Math.max(...counted.map((s) => s.tuneAways.length)) }, (_, i) => sum((s) => s.tuneAways[i] ?? 0));
        return {
          ...base,
          status: "shown" as const,
          note: null,
          stations: new Set(counted.map((s) => s.stationId)).size,
          airings: counted.length,
          totals: {
            watchMinutes: tenths(sum((s) => s.watchSeconds)),
            audienceAtStart: sum((s) => s.audienceAtStart),
            combinedPeak,
            audienceAtEnd: sum((s) => s.audienceAtEnd),
            stayedToTheEnd: percent(sum((s) => s.stayedToEnd), sum((s) => s.audienceAtStart)),
            tuneAways,
            notForMe: sum((s) => s.notForMe)
          }
        };
      });
      rows.sort((a, b) => a.title.localeCompare(b.title) || a.band.localeCompare(b.band));
      return { from: from.toISOString(), to: to.toISOString(), programs: rows };
    }
  };
  return service;
}

/** Counts a session's minute for watch data (inside the heartbeat, with the tuned-in count). */
export async function recordSessionMinute(db: ModuleContext["deps"]["db"], input: { sessionId: string; stationId: string; minute: Date }) {
  await db.insert(schema.sessionMinutes).values(input).onConflictDoNothing();
}
