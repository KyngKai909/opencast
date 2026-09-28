// The playout engine: one runner per station on air. Each tick it applies
// commands (sign on, sign off, skip, cue a break), keeps runners in step with
// who's on air, fills breaks ahead of time (holding the money), and fills dead
// air that nobody filled. Runs in the worker, under its Redis leader lock.

import path from "node:path";
import { asc, eq, isNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../../context.js";
import { ContentCache, type Need } from "./cache.js";
import { createFiller } from "./fill.js";
import { createPlanner } from "./plan.js";
import { StationRunner, type Output } from "./runner.js";

const FILL_AHEAD_MS = 20 * 60_000;
const FILL_EVERY_MS = 30_000;
/** A gap still empty this close to its start is filled from the library. */
const DEAD_AIR_FILL_AT_MS = 60_000;
/** The cache reads this far ahead, this often. */
const CACHE_AHEAD_MS = 48 * 3_600_000;
const CACHE_EVERY_MS = 3_600_000;
/** Not cached this close to air: the station and Network desk are told. */
const CACHE_WARN_MS = 3_600_000;
const CACHE_CHECK_EVERY_MS = 60_000;

export interface EngineOptions {
  /** Where the local RTMP listener for encoders binds when Livepeer isn't set up. */
  liveListen?: { host: string; port: number };
  /** The worker cache: a directory on its volume, and how much of it to use. */
  cache?: { dir?: string; capacityBytes?: number };
  log?: (line: string) => void;
}

export function createEngine(ctx: ModuleContext, options: EngineOptions = {}) {
  const { deps, services } = ctx;
  const { db } = deps;
  const log = options.log ?? ((line: string) => console.log(line));
  const gb = Number(process.env.WORKER_CACHE_GB ?? 100);
  const cache = new ContentCache(
    options.cache?.dir ?? process.env.WORKER_CACHE_DIR ?? path.join(deps.config.storageRoot, "cache"),
    // Leave a tenth of the volume free.
    options.cache?.capacityBytes ?? Math.floor(gb * 0.9 * 1024 ** 3),
    (cid, dest) => services.library.content.fetch(cid, dest),
    log
  );
  const planner = createPlanner(ctx, { cache });
  const filler = createFiller(ctx);
  const runners = new Map<string, StationRunner>();
  const lastFill = new Map<string, number>();
  let cacheReady: Promise<void> | undefined;
  let lastCacheSync = 0;
  let lastCacheCheck = 0;
  const warned = new Set<string>();

  /** What every station needs in the next 48 hours, and what's been taken down. */
  async function cacheNeeds(): Promise<{ needs: Need[]; gone: string[] }> {
    const now = deps.clock.now();
    const onAir = await services.playout.onAirStations();
    const items = await services.log.upcomingItems(now, new Date(now.getTime() + CACHE_AHEAD_MS));
    const stationIds = [...new Set([...onAir, ...items.map((i) => i.stationId)])];
    const current = await services.library.currentContent(items.map((i) => i.itemId));
    const wanted: Array<{ cid: string; airsAt: Date }> = items.flatMap((i) => (current.get(i.itemId) ? [{ cid: current.get(i.itemId)!, airsAt: i.startsAt }] : []));
    for (const stationId of stationIds) {
      // Station IDs and bumpers can air any time; so can what fills dead air, a little later.
      const { stationIds: ids, bumpers } = await services.library.fillers(stationId);
      for (const f of [...ids, ...bumpers]) if (f.contentId) wanted.push({ cid: f.contentId, airsAt: now });
      for (const r of await services.library.repeatable(stationId, 5)) if (r.contentId) wanted.push({ cid: r.contentId, airsAt: new Date(now.getTime() + 2 * 3_600_000) });
    }
    // Barter breaks inside carried programs air the producer's spots: their rotations too.
    const producers = new Set<string>();
    for (const stationId of stationIds) {
      for (const a of await services.catalog.activeAgreements(stationId)) if (a.carrierStationId === stationId && a.term !== "cash") producers.add(a.makerStationId);
    }
    for (const s of await services.spots.upcomingSpotContent([...new Set([...stationIds, ...producers])], now, new Date(now.getTime() + CACHE_AHEAD_MS))) {
      wanted.push({ cid: s.contentId, airsAt: s.airsAt ?? now });
    }
    const info = await services.library.content.info([...wanted.map((w) => w.cid), ...cache.ids()]);
    const needs = wanted.flatMap((w) => {
      const i = info.get(w.cid);
      return i && !i.deleted && !i.locked ? [{ cid: w.cid, bytes: i.bytes, airsAt: w.airsAt }] : [];
    });
    const gone = cache.ids().filter((cid) => !info.get(cid) || info.get(cid)!.deleted);
    return { needs, gone };
  }

  async function syncCache() {
    lastCacheSync = deps.clock.now().getTime();
    const before = cache.stats().files;
    const { needs, gone } = await cacheNeeds();
    await cache.sync(needs, gone);
    // New files: plan again so they air.
    if (cache.stats().files !== before) for (const runner of runners.values()) runner.replan();
  }

  /** Anything on the log within the hour that isn't cached: tell the station and Network desk, and fetch it now. */
  async function checkReady() {
    lastCacheCheck = deps.clock.now().getTime();
    const now = deps.clock.now();
    const soon = await services.log.upcomingItems(now, new Date(now.getTime() + CACHE_WARN_MS));
    const current = await services.library.currentContent(soon.map((i) => i.itemId));
    const late = soon.filter((i) => current.get(i.itemId) && !cache.has(current.get(i.itemId)!) && i.startsAt > now);
    if (!late.length) return;
    const titles = await services.library.titles({ itemIds: late.map((i) => i.itemId), programIds: [] });
    for (const i of late) {
      if (warned.has(i.entryId)) continue;
      warned.add(i.entryId);
      deps.bus.emit("station.file_not_ready", { stationId: i.stationId, itemId: i.itemId, title: titles.items.get(i.itemId) ?? "An item", airsAt: i.startsAt.toISOString(), missedAtAir: false });
    }
    void syncCache().catch((error) => log(`[cache] sync failed: ${(error as Error).message}`));
  }

  async function outputs(stationId: string): Promise<Output[]> {
    const [config] = await db.select().from(schema.livepeerConfig).where(eq(schema.livepeerConfig.stationId, stationId));
    const relays = await services.stations.relays(stationId);
    return [
      ...(config?.enabled && config.ingestUrl ? [{ kind: "livepeer" as const, url: config.ingestUrl, slateDuringBreaks: false }] : []),
      ...relays.map((r) => ({ kind: "relay" as const, url: `${r.rtmpUrl.replace(/\/+$/, "")}/${r.streamKey}`, slateDuringBreaks: r.breakHandling === "station_id_slate" }))
    ];
  }

  async function liveInput(liveSourceId: string) {
    const source = await services.stations.liveSourceSignal(liveSourceId);
    if (!source) return null;
    if (source.livepeerPlaybackId) return { url: `https://livepeercdn.studio/hls/${source.livepeerPlaybackId}/index.m3u8`, listen: false };
    if (!source.streamKey) return null;
    const { host, port } = options.liveListen ?? { host: "0.0.0.0", port: Number(process.env.LIVE_LISTEN_PORT ?? 1935) };
    return { url: `rtmp://${host}:${port}/live/${source.streamKey}`, listen: true };
  }

  async function startRunner(stationId: string) {
    const look = await services.stations.look(stationId);
    if (!look) return;
    const runner = new StationRunner(ctx, stationId, {
      hlsDir: path.join(deps.config.storageRoot, "hls", stationId),
      outputs: await outputs(stationId),
      plan: (from, to) => planner.plan(stationId, from, to),
      slates: planner.slates,
      look,
      liveInput,
      appOrigin: deps.config.appOrigin,
      onSignalLost: () => deps.bus.emit("station.signal_lost", { stationId, liveSourceId: null }),
      cache,
      onFileMissing: (m) => deps.bus.emit("station.file_not_ready", { stationId, itemId: m.itemId, title: m.title, airsAt: m.airsAt.toISOString(), missedAtAir: true }),
      log
    });
    runners.set(stationId, runner);
    runner.start();
  }

  async function applyCommands() {
    const pending = await db.select().from(schema.commands).where(isNull(schema.commands.consumedAt)).orderBy(asc(schema.commands.createdAt));
    for (const command of pending) {
      const runner = runners.get(command.stationId);
      if (command.action === "skip" || command.action === "previous") runner?.skip();
      if (command.action === "cue_break" && runner) {
        const rule = await services.stations.breakRule(command.stationId);
        const now = deps.clock.now();
        const [live] = (await services.log.entries(command.stationId, now, new Date(now.getTime() + 1))).filter((e) => e.kind === "live" && e.startsAt <= now && e.endsAt > now);
        const slot = await services.log.cueBreak(command.stationId, now, rule.lengthMs, live?.id ?? null);
        await filler.fillOne(command.stationId, slot, await services.stations.timezoneOf(command.stationId), (await services.spots.creditsFor(command.stationId)).length > 0);
        // Back to live after it: the run sheet splits the live block around the break.
        runner.replan(true);
      }
      // sign_on and sign_off change who's on air; the runners follow below.
      await db.update(schema.commands).set({ consumedAt: deps.clock.now() }).where(eq(schema.commands.id, command.id));
    }
  }

  async function fillDeadAir(stationId: string) {
    const now = deps.clock.now();
    const soon = await services.log.gaps(stationId, now, new Date(now.getTime() + DEAD_AIR_FILL_AT_MS));
    for (const gap of soon) {
      if (Date.parse(gap.startsAt) - now.getTime() > DEAD_AIR_FILL_AT_MS) continue;
      // Fill to the next thing on the log, or an hour.
      const [full] = await services.log.gaps(stationId, new Date(gap.startsAt), new Date(Date.parse(gap.startsAt) + 3_600_000));
      if (!full) continue;
      const placed = await services.log.fillDeadAir(stationId, full);
      if (placed) {
        log(`[playout] filled dead air on ${stationId} from ${full.startsAt} with ${placed} repeats`);
        runners.get(stationId)?.replan();
      }
    }
  }

  return {
    runners,
    planner,
    filler,
    cache,

    /** For the worker's health endpoint. */
    stats() {
      return { stationsOnAir: runners.size, cache: cache.stats() };
    },

    async tick() {
      // First tick: read the cache from the volume and fill it before anything airs.
      if (!cacheReady) cacheReady = cache.init().then(syncCache);
      await cacheReady;
      const clock = deps.clock.now().getTime();
      if (clock - lastCacheSync >= CACHE_EVERY_MS) void syncCache().catch((error) => log(`[cache] sync failed: ${(error as Error).message}`));
      if (clock - lastCacheCheck >= CACHE_CHECK_EVERY_MS) await checkReady();
      await applyCommands();
      const onAir = new Set(await services.playout.onAirStations());
      for (const [stationId, runner] of runners) {
        if (!onAir.has(stationId)) {
          runners.delete(stationId);
          await runner.stop();
        }
      }
      const now = deps.clock.now().getTime();
      for (const stationId of onAir) {
        if (!runners.has(stationId)) {
          await startRunner(stationId);
          // Its station IDs, bumpers and rotation may not be cached yet.
          void syncCache().catch((error) => log(`[cache] sync failed: ${(error as Error).message}`));
        }
        await fillDeadAir(stationId);
        if (now - (lastFill.get(stationId) ?? 0) >= FILL_EVERY_MS) {
          lastFill.set(stationId, now);
          const results = await filler.fillAhead(stationId, deps.clock.now(), FILL_AHEAD_MS);
          if (results.some((r) => r.placed.length)) {
            runners.get(stationId)?.replan();
            // Newly placed spots: make sure their files are here.
            void syncCache().catch((error) => log(`[cache] sync failed: ${(error as Error).message}`));
          }
        }
      }
    },

    async stopAll() {
      for (const runner of runners.values()) await runner.stop();
      runners.clear();
    }
  };
}

export type Engine = ReturnType<typeof createEngine>;
