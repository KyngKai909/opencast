// Other apps (programming Phase 5): viewers tuned from the channel list (`/v1/iptv/channels.m3u`)
// in TiviMate, Jellyfin, Channels DVR, Kodi or VLC. Those apps send no heartbeats, so a session is a
// run of playlist polls carrying `via=iptv` from one connection (its address, the app's user agent
// and the station): a gap of two minutes ends it, and it counts once its polls span a minute. Placed
// by market from the connection, as the viewer's sessions are. The address is never kept, only a
// hash of it salted with the day, cleared a day after the session (`forget`). Counted apart as
// "Other apps": never in `minute_samples` or `minute_markets`, so the pool and the tuned-in totals
// don't read them. Per-thousand spots do (P5.1, the user's decision, docs/open-decisions.md,
// programming Phase 5): `throughSpot` says which sessions watched through an airing, and the spots
// module bills them as the airing's Other apps part (`spots/otherAppViewers.ts`).

import { createHash } from "node:crypto";
import { and, eq, gt, gte, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../context.js";
import { isPrivateAddress } from "../../geo.js";

/** A longer gap between polls ends the session (players poll every few seconds; a master at most every 30). */
export const OTHER_APPS_GAP_MS = 120_000;
/** Polls spanning less than this don't count (an app checking the stream, then leaving). */
export const OTHER_APPS_COUNTS_AFTER_MS = 60_000;
/** Billed for a spot only when its polls average at least one this often (a player reloads a live playlist every few seconds). */
export const OTHER_APPS_BILLED_POLL_EVERY_MS = 30_000;
/** A session's row is written at most this often; the polls between are added up in memory. */
const WRITE_EVERY_MS = 15_000;
const DAY = 86_400_000;

export interface OtherAppsCount {
  stationId: string;
  marketId: string | null;
  sessions: number;
  minutes: number;
}

export interface OtherApps {
  /** A playlist poll that carried `via=iptv` (the master or a rendition's). */
  poll(input: { stationId: string; ip: string | null; userAgent: string | null }): Promise<void>;
  /** Sessions that counted and their minutes in a window (the part inside it), by station and market; all stations, or these. */
  counts(from: Date, to: Date, stationIds?: string[]): Promise<OtherAppsCount[]>;
  /**
   * P5.1: the sessions that watched through a spot on a station, one per connection: their polls ran
   * from the spot's start (or before) to its end (or after), they count (a minute of polls), and
   * their polls average at least one every 30 seconds. `placed`: of those, the ones placed in these
   * markets (a local business's area); a session that couldn't be placed is never in it.
   */
  throughSpot(stationId: string, from: Date, to: Date, marketIds?: string[]): Promise<{ sessions: number; placed: number }>;
  /** P5.1: sessions on a station that began by `from` and were still polling at `to` (those a spot then may be billed for, once their later polls are in). */
  watchingThrough(stationId: string, from: Date, to: Date): Promise<number>;
  /** P5.1: the usual Other apps sessions on a station at this hour (UTC), from the last week: for holds. */
  typical(stationId: string, at: Date): Promise<number>;
  /** Sessions that count and are still polling, by station. */
  tunedInNow(stationIds: string[]): Promise<Map<string, number>>;
  /** Clears the hashed keys of sessions over a day old (the daily purge). */
  forget(): Promise<number>;
}

/** The connection's key for a day: a hash, never the address. */
export function otherAppsKey(ip: string, userAgent: string | null, stationId: string, at: Date): string {
  const day = at.toISOString().slice(0, 10);
  return createHash("sha256").update(`opencast-other-apps:${day}:${ip}:${userAgent ?? ""}:${stationId}`).digest("hex").slice(0, 32);
}

export function createOtherApps({ deps, services }: ModuleContext): OtherApps {
  const { db } = deps;
  const O = schema.otherAppSessions;
  /** Runs this process has seen, by key: the session, its last poll, when its row was written and the polls since. */
  const open = new Map<string, { id: string; lastPoll: number; written: number; pending: number }>();
  /** One poll per key at a time (a master and its first rendition arrive together). */
  const busy = new Map<string, Promise<void>>();

  /** The market from the connection, as the heartbeat places a signed-out viewer. */
  async function place(ip: string): Promise<string | null> {
    if (isPrivateAddress(ip) || !deps.geo.configured) return null;
    const found = await deps.geo.lookup(ip).catch(() => null);
    if (found?.zip) {
      const market = await services.network.marketForZip(found.zip);
      if (market) return market.id;
    }
    return found?.point ? ((await services.network.marketNear(found.point)).market?.id ?? null) : null;
  }

  async function record(stationId: string, ip: string, userAgent: string | null) {
    const now = deps.clock.now();
    const at = now.getTime();
    const key = otherAppsKey(ip, userAgent, stationId, now);
    const hit = open.get(key);
    const running = hit && at - hit.lastPoll < OTHER_APPS_GAP_MS;
    if (running && at - hit.written < WRITE_EVERY_MS) {
      hit.lastPoll = at;
      hit.pending += 1;
      return;
    }
    // Planned off air (off air hours, a sign-off on the log): nobody's counted, as with heartbeats.
    if (await services.log.offAirAt(stationId, now)) return;
    let id = running ? hit.id : null;
    let pending = running ? hit.pending : 0;
    if (!id) {
      // Another replica (or this one, before a restart) may have the run; yesterday's key carries it over midnight.
      const keys = [key, otherAppsKey(ip, userAgent, stationId, new Date(at - DAY))];
      const [row] = await db
        .select({ id: O.id })
        .from(O)
        .where(and(inArray(O.clientKey, keys), eq(O.stationId, stationId), gt(O.lastPollAt, new Date(at - OTHER_APPS_GAP_MS))))
        .orderBy(sql`${O.lastPollAt} desc`)
        .limit(1);
      id = row?.id ?? null;
      pending = 0;
    }
    if (id) {
      await db
        .update(O)
        .set({ lastPollAt: now, polls: sql`${O.polls} + ${pending + 1}`, clientKey: key })
        .where(eq(O.id, id));
    } else {
      const marketId = await place(ip);
      [{ id }] = await db.insert(O).values({ stationId, marketId, clientKey: key, startedAt: now, lastPollAt: now, polls: 1 }).returning({ id: O.id });
    }
    if (open.size > 50_000) open.clear();
    open.set(key, { id: id!, lastPoll: at, written: at, pending: 0 });
  }

  return {
    async poll({ stationId, ip, userAgent }) {
      // Without an address there's no telling one viewer's polls from another's: not counted.
      if (!ip) return;
      const key = `${ip}|${userAgent ?? ""}|${stationId}`;
      const before = busy.get(key) ?? Promise.resolve();
      const mine = before.then(() => record(stationId, ip, userAgent));
      const settled = mine.catch(() => undefined);
      busy.set(key, settled);
      void settled.then(() => {
        if (busy.get(key) === settled) busy.delete(key);
      });
      return mine;
    },

    async counts(from, to, stationIds) {
      if (stationIds && !stationIds.length) return [];
      const rows = await db
        .select({
          stationId: O.stationId,
          marketId: O.marketId,
          sessions: sql<number>`count(*)::int`,
          minutes: sql<number>`coalesce(sum(extract(epoch from (least(${O.lastPollAt}, ${to}) - greatest(${O.startedAt}, ${from})))), 0)::float / 60`
        })
        .from(O)
        .where(
          and(
            lt(O.startedAt, to),
            gt(O.lastPollAt, from),
            sql`${O.lastPollAt} - ${O.startedAt} >= ${`${OTHER_APPS_COUNTS_AFTER_MS / 1000} seconds`}::interval`,
            ...(stationIds ? [inArray(O.stationId, stationIds)] : [])
          )
        )
        .groupBy(O.stationId, O.marketId);
      return rows.map((r) => ({ stationId: r.stationId, marketId: r.marketId, sessions: Number(r.sessions), minutes: Number(r.minutes) }));
    },

    async throughSpot(stationId, from, to, marketIds = []) {
      // One per connection: a key only ever has one run going (a run another replica began is joined).
      const one = sql`coalesce(${O.clientKey}, ${O.id}::text)`;
      const [row] = await db
        .select({
          sessions: sql<number>`count(distinct ${one})::int`,
          placed: marketIds.length ? sql<number>`(count(distinct ${one}) filter (where ${inArray(O.marketId, marketIds)}))::int` : sql<number>`0`
        })
        .from(O)
        .where(
          and(
            eq(O.stationId, stationId),
            lte(O.startedAt, from),
            gte(O.lastPollAt, to),
            sql`${O.lastPollAt} - ${O.startedAt} >= ${`${OTHER_APPS_COUNTS_AFTER_MS / 1000} seconds`}::interval`,
            sql`${O.polls} * ${OTHER_APPS_BILLED_POLL_EVERY_MS / 1000} >= extract(epoch from (${O.lastPollAt} - ${O.startedAt}))`
          )
        );
      return { sessions: Number(row?.sessions ?? 0), placed: Number(row?.placed ?? 0) };
    },

    async watchingThrough(stationId, from, to) {
      // Within the gap of `to`: a run that's still going may not have written its latest polls yet.
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(O)
        .where(and(eq(O.stationId, stationId), lte(O.startedAt, from), gt(O.lastPollAt, new Date(to.getTime() - OTHER_APPS_GAP_MS))));
      return Number(row?.n ?? 0);
    },

    async typical(stationId, at) {
      // The same hour on each of the last seven days: the counted sessions' minutes inside it, averaged.
      const hour = Math.floor(at.getTime() / 3_600_000) * 3_600_000;
      const [row] = await db
        .select({ minutes: sql<number>`coalesce(sum(extract(epoch from (least(${O.lastPollAt}, d.t + interval '1 hour') - greatest(${O.startedAt}, d.t)))), 0)::float / 60` })
        .from(sql`generate_series(${new Date(hour - 7 * DAY)}::timestamptz, ${new Date(hour - DAY)}::timestamptz, interval '1 day') as d(t)`)
        .innerJoin(
          O,
          and(
            eq(O.stationId, stationId),
            sql`${O.startedAt} < d.t + interval '1 hour'`,
            sql`${O.lastPollAt} > d.t`,
            sql`${O.lastPollAt} - ${O.startedAt} >= ${`${OTHER_APPS_COUNTS_AFTER_MS / 1000} seconds`}::interval`
          )
        );
      return Math.round(Number(row?.minutes ?? 0) / (7 * 60));
    },

    async tunedInNow(stationIds) {
      if (!stationIds.length) return new Map();
      const now = deps.clock.now();
      const rows = await db
        .select({ stationId: O.stationId, n: sql<number>`count(*)::int` })
        .from(O)
        .where(
          and(
            inArray(O.stationId, stationIds),
            gt(O.lastPollAt, new Date(now.getTime() - OTHER_APPS_GAP_MS)),
            sql`${O.lastPollAt} - ${O.startedAt} >= ${`${OTHER_APPS_COUNTS_AFTER_MS / 1000} seconds`}::interval`
          )
        )
        .groupBy(O.stationId);
      return new Map(rows.map((r) => [r.stationId, Number(r.n)]));
    },

    async forget() {
      const cutoff = new Date(deps.clock.now().getTime() - DAY);
      const rows = await db
        .update(O)
        .set({ clientKey: null })
        .where(and(isNotNull(O.clientKey), lt(O.lastPollAt, cutoff)))
        .returning({ id: O.id });
      return rows.length;
    }
  };
}
