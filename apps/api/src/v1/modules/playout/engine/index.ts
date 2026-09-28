// The playout engine: one runner per station on air. Each tick it applies
// commands (sign on, sign off, skip, cue a break), keeps runners in step with
// who's on air, fills breaks ahead of time (holding the money), and fills dead
// air that nobody filled. Runs in the worker, under its Redis leader lock.

import path from "node:path";
import { asc, eq, isNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../../context.js";
import { createFiller } from "./fill.js";
import { createPlanner } from "./plan.js";
import { StationRunner, type Output } from "./runner.js";

const FILL_AHEAD_MS = 20 * 60_000;
const FILL_EVERY_MS = 30_000;
/** A gap still empty this close to its start is filled from the library. */
const DEAD_AIR_FILL_AT_MS = 60_000;

export interface EngineOptions {
  /** Where the local RTMP listener for encoders binds when Livepeer isn't set up. */
  liveListen?: { host: string; port: number };
  log?: (line: string) => void;
}

export function createEngine(ctx: ModuleContext, options: EngineOptions = {}) {
  const { deps, services } = ctx;
  const { db } = deps;
  const planner = createPlanner(ctx);
  const filler = createFiller(ctx);
  const runners = new Map<string, StationRunner>();
  const lastFill = new Map<string, number>();
  const log = options.log ?? ((line: string) => console.log(line));

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

    async tick() {
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
        if (!runners.has(stationId)) await startRunner(stationId);
        await fillDeadAir(stationId);
        if (now - (lastFill.get(stationId) ?? 0) >= FILL_EVERY_MS) {
          lastFill.set(stationId, now);
          const results = await filler.fillAhead(stationId, deps.clock.now(), FILL_AHEAD_MS);
          if (results.some((r) => r.placed.length)) runners.get(stationId)?.replan();
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
