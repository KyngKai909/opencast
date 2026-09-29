// The playout engine: prepare once, then assemble (platform prompt, Phase 5). Runs in the worker,
// under its Redis leader lock. Each tick it:
//
//   - prepares what's queued (prepare.ts: FFmpeg, once per content ID, earliest airtime first);
//   - every hour checks the next 48 hours of every station's log and queues anything not prepared;
//     every minute warns the station and the Network desk about anything airing within the hour
//     that still isn't; every few minutes queues items whose rights were just confirmed;
//   - applies commands (sign on and off, skip, cue a break, end a live block early, replan);
//   - fills breaks ahead of time (holding the money) and fills dead air nobody filled;
//   - assembles every station on air (assemble.ts): its playlists point at prepared segments;
//   - runs the translators that are on (translator.ts).
//
// The old worker cache and continuous encode are gone: the worker needs only scratch space.

import os from "node:os";
import path from "node:path";
import { asc, eq, isNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../../context.js";
import { ChannelAssembler, pruneChannelItems, type ChannelLook } from "./assemble.js";
import { createFiller } from "./fill.js";
import { LADDER, scaledLadder, type Band, type Ladder } from "./ladder.js";
import { createPlanner } from "./plan.js";
import { createPreparer, ffmpegTranscoder, refKey, type PreparationStats, type Transcoder, type WantRef } from "./prepare.js";
import { TranslatorRelay } from "./translator.js";

const FILL_AHEAD_MS = 20 * 60_000;
const FILL_EVERY_MS = 30_000;
/** A gap still empty this close to its start is filled from the library. */
const DEAD_AIR_FILL_AT_MS = 60_000;
/** The readiness check reads this far ahead, this often. */
const READY_AHEAD_MS = 48 * 3_600_000;
const READY_EVERY_MS = 3_600_000;
/** Not prepared this close to air: the station and Network desk are told. */
const READY_WARN_MS = 3_600_000;
const READY_WARN_EVERY_MS = 60_000;
/** Items whose rights were just confirmed are queued this often. */
const RIGHTS_EVERY_MS = 5 * 60_000;
const TRANSLATORS_EVERY_MS = 10_000;
const LIVEPEER_PLAYBACK = (process.env.LIVEPEER_PLAYBACK_BASE ?? "https://livepeercdn.studio/hls").replace(/\/+$/, "");

export interface EngineOptions {
  log?: (line: string) => void;
  /** The rendition ladder (tests shrink it: `ladderScale`). */
  ladder?: Ladder;
  ladderScale?: number;
  /** How items are transcoded (FFmpeg on the worker by default). */
  transcoder?: Transcoder;
  /** x264 preset for preparation (veryfast by default; tests use ultrafast). */
  preset?: string;
  /** Preparation scratch space (WORKER_SCRATCH_DIR). */
  scratchDir?: string;
  prepareConcurrency?: number;
  /** Where a live source's HLS is read (tests point at a local fake); Livepeer's playback by default. */
  liveUrl?: (liveSourceId: string) => Promise<string | null>;
  /** Translators on (default) or off. */
  translators?: boolean;
  /** How far ahead the channel's rows are written. */
  leadMs?: number;
}

export interface ReadinessSummary {
  checkedAt: string | null;
  /** Items on the logs in the next 48 hours (programs, spots placed or in rotation, fillers). */
  items: number;
  ready: number;
  waiting: number;
  firstNotReady: { stationId: string; title: string; airsAt: string } | null;
}

export function createEngine(ctx: ModuleContext, options: EngineOptions = {}) {
  const { deps, services } = ctx;
  const { db } = deps;
  const log = options.log ?? ((line: string) => console.log(line));
  const scratchDir = options.scratchDir ?? process.env.WORKER_SCRATCH_DIR ?? path.join(os.tmpdir(), "opencast-worker");
  // PREPARE_LADDER_SCALE (development only) shrinks the ladder; the API reads the same variable for the master playlist.
  const scale = options.ladderScale ?? (Number(process.env.PREPARE_LADDER_SCALE) || undefined);
  const ladder = options.ladder ?? (scale ? scaledLadder(scale) : LADDER);
  const preparer = createPreparer(ctx, {
    ladder,
    transcoder: options.transcoder ?? ffmpegTranscoder({ preset: options.preset ?? process.env.PREPARE_PRESET ?? "veryfast" }),
    scratchDir,
    concurrency: options.prepareConcurrency ?? Number(process.env.PREPARE_CONCURRENCY ?? 1),
    log
  });
  const bands = new Map<string, Band>();
  const planner = createPlanner(ctx, { isReady: (ref, stationId) => preparer.isReady(ref, bands.get(stationId) ?? "tv") });
  const filler = createFiller(ctx);
  const assemblers = new Map<string, ChannelAssembler>();
  const looks = new Map<string, ChannelLook>();
  const translators = new Map<string, Map<string, { relay: TranslatorRelay; signature: string }>>();
  const lastFill = new Map<string, number>();
  const warned = new Set<string>();
  let initialized = false;
  let lastSweep = 0;
  let lastWarn = 0;
  let lastRights = 0;
  let lastPrune = 0;
  let lastTranslators = 0;
  let rightsSince = new Date(deps.clock.now().getTime() - 7 * 86_400_000);
  let readiness: ReadinessSummary = { checkedAt: null, items: 0, ready: 0, waiting: 0, firstNotReady: null };

  // A program that just became ready airs from its next segment boundary: plan again.
  preparer.onReady((key) => {
    if (!key.startsWith("slate-")) for (const a of assemblers.values()) a.replan();
  });

  async function bandOf(stationIds: string[]) {
    const unknown = stationIds.filter((id) => !bands.has(id));
    if (unknown.length) for (const [id, ident] of await services.stations.idents(unknown)) bands.set(id, ident.band ?? "tv");
    return (id: string) => bands.get(id) ?? "tv";
  }

  /** Everything every station can air in the next 48 hours, earliest first; queued unless prepared. */
  async function sweep() {
    const now = deps.clock.now();
    const to = new Date(now.getTime() + READY_AHEAD_MS);
    const onAir = await services.playout.onAirStations();
    const entries = await services.log.upcomingItems(now, to);
    const stationIds = [...new Set([...onAir, ...entries.map((e) => e.stationId)])];
    const band = await bandOf(stationIds);
    const items = await services.library.itemsByIds([...new Set(entries.map((e) => e.itemId))]);
    const wants: WantRef[] = [];
    const logWants: Array<WantRef & { stationId: string; title: string }> = [];
    for (const e of entries) {
      const item = items.get(e.itemId);
      if (!item || item.contentUnavailable || item.archived) continue;
      const want = { contentId: item.contentId, location: item.location, mediaKind: item.mediaKind, band: band(e.stationId), durationMs: item.durationMs, neededAt: e.startsAt };
      wants.push(want);
      logWants.push({ ...want, stationId: e.stationId, title: item.title });
    }
    for (const stationId of stationIds) {
      // Station IDs and bumpers can air any time; so can what fills dead air, a little later.
      const { stationIds: ids, bumpers } = await services.library.fillers(stationId);
      for (const f of [...ids, ...bumpers]) wants.push({ contentId: f.contentId, location: f.location, mediaKind: f.mediaKind, band: band(stationId), durationMs: f.durationMs, neededAt: now });
      for (const r of await services.library.repeatable(stationId, 5)) wants.push({ contentId: r.contentId, location: r.location, mediaKind: r.mediaKind, band: band(stationId), durationMs: r.durationMs, neededAt: new Date(now.getTime() + 2 * 3_600_000) });
    }
    // Barter breaks inside carried programs air the producer's spots: their rotations too.
    const producers = new Map<string, Band>();
    for (const stationId of stationIds) {
      for (const a of await services.catalog.activeAgreements(stationId)) if (a.carrierStationId === stationId && a.term !== "cash") producers.set(a.makerStationId, band(stationId));
    }
    wants.push(...(await spotWants([...new Set([...stationIds, ...producers.keys()])], now, to, producers)));
    await preparer.want(wants);
    await preparer.refresh(wants.map((w) => refKey(w)).filter((k): k is string => Boolean(k)));
    const keys = new Map<string, boolean>();
    for (const w of wants) {
      const key = refKey(w);
      if (key) keys.set(`${key}/${w.band}`, (keys.get(`${key}/${w.band}`) ?? true) && preparer.isReady(key, w.band));
    }
    const notReady = logWants.filter((w) => !preparer.isReady(w, w.band)).sort((a, b) => a.neededAt!.getTime() - b.neededAt!.getTime())[0];
    const ready = [...keys.values()].filter(Boolean).length;
    readiness = {
      checkedAt: now.toISOString(),
      items: keys.size,
      ready,
      waiting: keys.size - ready,
      firstNotReady: notReady ? { stationId: notReady.stationId, title: notReady.title, airsAt: notReady.neededAt!.toISOString() } : null
    };
  }

  /** Spots placed in the window (money held) and spots in rotation, for these stations. */
  async function spotWants(stationIds: string[], from: Date, to: Date, producers = new Map<string, Band>()): Promise<WantRef[]> {
    const wants: WantRef[] = [];
    for (const s of await services.spots.upcomingSpotContent(stationIds, from, to)) {
      const b = bands.get(s.stationId) ?? producers.get(s.stationId) ?? "tv";
      wants.push({ contentId: s.contentId, mediaKind: "video", band: b, durationMs: s.durationMs, neededAt: s.airsAt ?? from });
      if (producers.has(s.stationId) && producers.get(s.stationId) !== b) wants.push({ contentId: s.contentId, mediaKind: "video", band: producers.get(s.stationId)!, durationMs: s.durationMs, neededAt: s.airsAt ?? from });
    }
    return wants;
  }

  /**
   * Spots just placed in a station's breaks: prepared before they air. (The hourly readiness check
   * would find them too, but a break is filled only 20 minutes ahead: a held airing mustn't wait
   * for it and air the station ID instead.)
   */
  async function queuePlaced(stationId: string) {
    const now = deps.clock.now();
    await bandOf([stationId]);
    const placed = (await spotWants([stationId], now, new Date(now.getTime() + FILL_AHEAD_MS + 60_000))).filter((w) => w.neededAt && w.neededAt.getTime() > now.getTime());
    await preparer.want(placed);
  }

  /** Anything on the log within the hour that isn't prepared: the station and Network desk are told. */
  async function warnNotReady() {
    const now = deps.clock.now();
    const soon = (await services.log.upcomingItems(now, new Date(now.getTime() + READY_WARN_MS))).filter((i) => i.startsAt > now && !warned.has(i.entryId));
    if (!soon.length) return;
    const band = await bandOf(soon.map((i) => i.stationId));
    const items = await services.library.itemsByIds(soon.map((i) => i.itemId));
    const late = soon.filter((i) => {
      const item = items.get(i.itemId);
      return item && !item.contentUnavailable && refKey(item) && !preparer.isReady(item, band(i.stationId));
    });
    if (!late.length) return;
    await preparer.refresh(late.map((i) => refKey(items.get(i.itemId)!)!));
    for (const i of late) {
      const item = items.get(i.itemId)!;
      if (preparer.isReady(item, band(i.stationId))) continue;
      warned.add(i.entryId);
      deps.bus.emit("station.file_not_ready", { stationId: i.stationId, itemId: i.itemId, title: item.title, airsAt: i.startsAt.toISOString(), missedAtAir: false });
    }
    // First in the queue.
    await preparer.want(late.map((i) => {
      const item = items.get(i.itemId)!;
      return { contentId: item.contentId, location: item.location, mediaKind: item.mediaKind, band: band(i.stationId), durationMs: item.durationMs, neededAt: i.startsAt };
    }));
  }

  /** Items whose rights were confirmed (or files replaced) lately: prepared before anyone schedules them. */
  async function queueConfirmed() {
    const since = rightsSince;
    rightsSince = deps.clock.now();
    const items = await services.library.preparableSince(since, 500);
    if (!items.length) return;
    const band = await bandOf(items.map((i) => i.stationId));
    await preparer.want(items.map((i) => ({ contentId: i.contentId, location: i.location, mediaKind: i.mediaKind, band: band(i.stationId), durationMs: i.durationMs, neededAt: null })));
  }

  async function liveUrl(liveSourceId: string) {
    if (options.liveUrl) return options.liveUrl(liveSourceId);
    const source = await services.stations.liveSourceSignal(liveSourceId);
    // Livepeer's playback of the source. No Livepeer: the source can't air (the stand-by slate does).
    return source?.livepeerPlaybackId ? `${LIVEPEER_PLAYBACK}/${source.livepeerPlaybackId}/index.m3u8` : null;
  }

  async function startAssembler(stationId: string) {
    const found = await services.stations.look(stationId);
    if (!found) return;
    const look: ChannelLook = { ...found, bug: { ...found.bug } };
    bands.set(stationId, look.band);
    looks.set(stationId, look);
    const assembler = new ChannelAssembler(ctx, stationId, {
      look,
      plan: (from, to) => planner.plan(stationId, from, to),
      preparer,
      slates: planner.slates,
      liveUrl,
      appOrigin: deps.config.appOrigin,
      scratchDir,
      leadMs: options.leadMs,
      onMissing: (m) => deps.bus.emit("station.file_not_ready", { stationId, itemId: m.itemId, title: m.title, airsAt: m.airsAt.toISOString(), missedAtAir: true }),
      onSignalLost: (liveSourceId) => deps.bus.emit("station.signal_lost", { stationId, liveSourceId }),
      log
    });
    assemblers.set(stationId, assembler);
    // A station that just went on air: its station IDs, bumpers and rotations are checked (and
    // queued) on this tick, not at the next hourly readiness check.
    lastSweep = 0;
    await assembler.start();
  }

  async function applyCommands() {
    const pending = await db.select().from(schema.commands).where(isNull(schema.commands.consumedAt)).orderBy(asc(schema.commands.createdAt));
    for (const command of pending) {
      const assembler = assemblers.get(command.stationId);
      if (command.action === "skip" || command.action === "previous") await assembler?.skip();
      if (command.action === "cue_break" && assembler) {
        const rule = await services.stations.breakRule(command.stationId);
        const now = deps.clock.now();
        const [live] = (await services.log.entries(command.stationId, now, new Date(now.getTime() + 1))).filter((e) => e.kind === "live" && e.startsAt <= now && e.endsAt > now);
        const slot = await services.log.cueBreak(command.stationId, now, rule.lengthMs, live?.id ?? null);
        const filled = await filler.fillOne(command.stationId, slot, await services.stations.timezoneOf(command.stationId), (await services.spots.creditsFor(command.stationId)).length > 0);
        if (filled.placed.length) await queuePlaced(command.stationId);
        // Back to live after it: the run sheet splits the live block around the break.
        assembler.replan(true);
      }
      // G3: a live block ended early. The log already moved up: hand back to it now.
      if (command.action === "end_live") assembler?.replan(true);
      // The log or the off air hours changed: read the log again (a station off air notices at once).
      if (command.action === "replan") assembler?.replan();
      // sign_on and sign_off change who's on air; the assemblers follow below.
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
      // Repeats of what's prepared (anything else would air station ID and bumpers anyway).
      const band = bands.get(stationId) ?? "tv";
      const placed = await services.log.fillDeadAir(stationId, full, { usable: (item) => preparer.isReady(item, band) });
      if (placed) {
        log(`[playout] filled dead air on ${stationId} from ${full.startsAt} with ${placed} repeats`);
        assemblers.get(stationId)?.replan();
      }
    }
  }

  async function stopTranslators(stationId: string) {
    const running = translators.get(stationId);
    if (!running) return;
    translators.delete(stationId);
    await Promise.all([...running.values()].map((t) => t.relay.stop()));
  }

  /** Relays for translators that are on, for stations on air. */
  async function syncTranslators(onAir: Set<string>) {
    for (const stationId of [...translators.keys()]) if (!onAir.has(stationId)) await stopTranslators(stationId);
    if (options.translators === false) return;
    for (const stationId of onAir) {
      const look = looks.get(stationId);
      if (!look) continue;
      const targets = await services.stations.relays(stationId);
      const running = translators.get(stationId) ?? new Map();
      for (const [id, t] of running) {
        const target = targets.find((x) => x.id === id);
        if (!target || TranslatorRelay.signature(target) !== t.signature) {
          running.delete(id);
          await t.relay.stop();
        }
      }
      for (const target of targets) {
        if (running.has(target.id)) continue;
        const relay = new TranslatorRelay(ctx, stationId, target, { look, preparer, slates: planner.slates, log });
        relay.start();
        running.set(target.id, { relay, signature: TranslatorRelay.signature(target) });
      }
      translators.set(stationId, running);
    }
  }

  const engine = {
    assemblers,
    planner,
    filler,
    preparer,

    /** For the worker's health endpoint. */
    async stats(): Promise<{ stationsOnAir: number; preparation: PreparationStats; readiness: ReadinessSummary; translators: Array<{ stationId: string; translatorId: string; bytesThisSession: number }> }> {
      return {
        stationsOnAir: assemblers.size,
        preparation: await preparer.stats(),
        readiness,
        translators: [...translators].flatMap(([stationId, running]) => [...running].map(([translatorId, t]) => ({ stationId, translatorId, bytesThisSession: t.relay.bytesSent })))
      };
    },

    /** The readiness check now (tests; the tick runs it hourly). */
    sweep,
    warnNotReady,

    async tick() {
      if (!initialized) {
        await preparer.init();
        initialized = true;
      }
      const now = deps.clock.now().getTime();
      if (now - lastRights >= RIGHTS_EVERY_MS) {
        lastRights = now;
        await queueConfirmed().catch((error) => log(`[prepare] queueing confirmed items failed: ${(error as Error).message}`));
      }
      if (now - lastSweep >= READY_EVERY_MS) {
        lastSweep = now;
        await sweep().catch((error) => log(`[ready] the readiness check failed: ${(error as Error).message}`));
      }
      if (now - lastWarn >= READY_WARN_EVERY_MS) {
        lastWarn = now;
        await warnNotReady().catch((error) => log(`[ready] warning failed: ${(error as Error).message}`));
      }
      if (now - lastPrune >= 3_600_000) {
        lastPrune = now;
        await pruneChannelItems(ctx).catch(() => undefined);
      }
      void preparer.pump().catch((error) => log(`[prepare] ${(error as Error).message}`));
      await applyCommands();
      const onAir = new Set(await services.playout.onAirStations());
      for (const [stationId, assembler] of assemblers) {
        if (!onAir.has(stationId)) {
          assemblers.delete(stationId);
          // Signed off: the playlist ends.
          await assembler.stop({ signOff: true });
          await db
            .update(schema.playoutState)
            .set({ currentAssetId: null, currentLogEntryId: null, currentStartedAt: null, standingBy: false, updatedAt: deps.clock.now() })
            .where(eq(schema.playoutState.stationId, stationId));
        }
      }
      for (const stationId of onAir) {
        if (!assemblers.has(stationId)) await startAssembler(stationId);
        await fillDeadAir(stationId);
        if (now - (lastFill.get(stationId) ?? 0) >= FILL_EVERY_MS) {
          lastFill.set(stationId, now);
          const results = await filler.fillAhead(stationId, deps.clock.now(), FILL_AHEAD_MS);
          if (results.some((r) => r.placed.length)) {
            await queuePlaced(stationId).catch((error) => log(`[prepare] queueing placed spots failed: ${(error as Error).message}`));
            assemblers.get(stationId)?.replan();
          }
        }
        await assemblers
          .get(stationId)
          ?.tick()
          .catch((error) => log(`[assemble] ${stationId}: ${(error as Error).message}`));
      }
      if (now - lastTranslators >= TRANSLATORS_EVERY_MS || [...translators.keys()].some((id) => !onAir.has(id))) {
        lastTranslators = now;
        await syncTranslators(onAir).catch((error) => log(`[translator] ${(error as Error).message}`));
      }
    },

    /** Stops everything without ending the playlists (shutdown, or leadership lost). */
    async stopAll() {
      for (const stationId of [...translators.keys()]) await stopTranslators(stationId);
      for (const assembler of assemblers.values()) await assembler.stop({ signOff: false });
      assemblers.clear();
      // Preparations under way are left: the next leader queues them again.
    }
  };
  return engine;
}

export type Engine = ReturnType<typeof createEngine>;
