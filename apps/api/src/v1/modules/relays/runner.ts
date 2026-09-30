// The relay runner (added 2026-09-30, follow-up Phase 3): what the relay service (apps/relay) runs.
// Every few seconds, for each station on air:
//
//   - "Everything I air" (and not paused by pay-as-you-go): one sender (playout's sender.ts) makes
//     the station's one continuous stream (prepared segments, live blocks from Livepeer's playback,
//     the bug composited or stream-copied, breaks as the station chose) and pushes it to the
//     station's Livepeer relay stream (`profiles: []`, made once), whose multistream targets, one per
//     connected platform, are each `source`: Livepeer sends the same stream to every platform.
//   - "Live shows only": a TV station's live source already sends to Livepeer, so its own Livepeer
//     stream gets the platforms as multistream targets, turned on only while one of its live blocks
//     airs (the rehearsal before isn't relayed). No relay service stream. A radio station's live
//     blocks come through the worker's own ingest, not Livepeer, so the relay service relays just
//     the live block, like "Everything I air" (free: its sessions are `live_only`).
//   - With RELAY_FAN_OUT=direct (the fallback, see docs/relay.md) the sender pushes to each platform
//     itself and Livepeer isn't used for relays at all (TV live shows included).
//
// Restarts for platform limits (limits.ts) are planned for the station ID in a break, one platform
// at a time (only its Livepeer target is toggled; the others keep streaming), making a connected
// account's next broadcast before ending the current one, and logged. Spots aired mark connected
// YouTube (and Twitch) as carrying paid promotion, or remind the station for a pasted key. A relay
// that stops is reported (the station and the Network desk hear) and retried; the channel itself
// is never touched: the runner only reads the channel and writes its own tables and sessions.

import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { PlatformsSeam, RelayDestination, RelayHealth, RelayMode } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { LIVEPEER_API_BASE, LIVEPEER_API_KEY, LIVEPEER_RTMP_INGEST_BASE } from "../../../config.js";
import { type ChannelLook } from "../playout/engine/assemble.js";
import { Fanout, type FanoutDestination, type RelayOutput } from "../playout/engine/fanout.js";
import { STATION_ID_MS } from "../playout/engine/fill.js";
import { LADDER, scaledLadder, type Ladder } from "../playout/engine/ladder.js";
import { createPreparer, ffmpegTranscoder, type Preparer } from "../playout/engine/prepare.js";
import { StationSender, type SenderSettings } from "../playout/engine/sender.js";
import { Slates } from "../playout/engine/slates.js";
import { createLivepeerRelayApi, pushUrl, type LivepeerRelayApi } from "./livepeer.js";
import { planRestart, platformName, restartLabel, restartNeed, type BreakMoment, type Span } from "./limits.js";
import { platformsSeam } from "./platforms.js";
import { RELAY_DEFAULTS } from "./service.js";

const SR = schema.stationRelays;
const RT = schema.relayTargets;
const RR = schema.relayRestarts;

export type FanOutMode = "livepeer" | "direct";

/** What the runner needs of a sender (sender.ts's StationSender; tests stub it). */
export interface SenderLike {
  start(): void;
  stop(): Promise<void>;
  update(settings: SenderSettings): void;
  readonly running: boolean;
  readonly mode: "copy" | "composite";
  errors: number;
  lastError: string | null;
}

/** What the runner needs of an output (fanout.ts's Fanout; tests stub it). */
export interface OutputLike extends RelayOutput {
  set(destinations: FanoutDestination[]): void;
  restart(id: string, gapMs?: number): Promise<boolean>;
  close(): Promise<void>;
  status?(): Array<{ id: string; running: boolean; errors: number; lastError: string | null }>;
}

export interface SenderInput {
  stationId: string;
  settings: SenderSettings;
  output: OutputLike;
  look: ChannelLook;
  onPaidPromotion(): void;
  platforms(): number;
}

export interface RelayRunnerOptions {
  log?(line: string): void;
  /** The platforms seam (default: the platforms module's, else the old translators). */
  platforms?: PlatformsSeam;
  /** Livepeer's API (default: from LIVEPEER_API_KEY; none without it). */
  livepeer?: LivepeerRelayApi | null;
  /** `livepeer` (one push, split by Livepeer) or `direct` (a push per platform). Default: RELAY_FAN_OUT, else `livepeer` when Livepeer is configured. */
  fanOut?: FanOutMode;
  ladder?: Ladder;
  ladderScale?: number;
  preset?: string;
  scratchDir?: string;
  /** No bytes out for this long while it should be relaying: stopped (the station and desk are told). */
  alertAfterMs?: number;
  /** A restart's pause between a target going off and on again. */
  restartGapMs?: number;
  /** How often restarts are planned (and due ones done). */
  restartCheckMs?: number;
  makeSender?(input: SenderInput): SenderLike;
  makeOutput?(destinations: FanoutDestination[]): OutputLike;
  /** Where prepared segments are read when storage doesn't have them (default HLS_PUBLIC_URL, the worker's HLS origin). */
  segmentBase?: string | null;
}

interface Running {
  stationId: string;
  callSign: string | null;
  mode: RelayMode;
  signature: string;
  sender: SenderLike;
  output: OutputLike;
  dests: RelayDestination[];
  startedAt: number;
}

interface Health {
  stationId: string;
  callSign: string | null;
  mode: RelayMode;
  picture: "copy" | "composite";
  platforms: number;
  relayMs: number;
  runningSince: number | null;
  lastBytes: number;
  lastProgressAt: number;
  samples: Array<{ at: number; bytes: number }>;
  errors: number;
  lastError: string | null;
  stoppedAt: number | null;
  since: number;
  /** Bytes from outputs that were closed. */
  closedBytes: number;
}

const urlHash = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 32);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function defaultLivepeer(): LivepeerRelayApi | null {
  return LIVEPEER_API_KEY.trim() ? createLivepeerRelayApi({ apiBase: LIVEPEER_API_BASE, apiKey: LIVEPEER_API_KEY, ingestBase: LIVEPEER_RTMP_INGEST_BASE }) : null;
}

export function createRelayRunner(ctx: ModuleContext, options: RelayRunnerOptions = {}) {
  const { deps, services } = ctx;
  const { db } = deps;
  const log = options.log ?? ((line: string) => console.log(line));
  const livepeer = options.livepeer === undefined ? defaultLivepeer() : options.livepeer;
  const envFanOut = process.env.RELAY_FAN_OUT === "direct" || process.env.RELAY_FAN_OUT === "livepeer" ? (process.env.RELAY_FAN_OUT as FanOutMode) : undefined;
  const fanOut: FanOutMode = options.fanOut ?? envFanOut ?? (livepeer ? "livepeer" : "direct");
  const alertAfterMs = options.alertAfterMs ?? 45_000;
  const restartGapMs = options.restartGapMs ?? 3_000;
  const restartCheckMs = options.restartCheckMs ?? 30_000;
  const scratchDir = options.scratchDir ?? process.env.RELAY_SCRATCH_DIR ?? path.join(os.tmpdir(), "opencast-relay");
  const running = new Map<string, Running>();
  const health = new Map<string, Health>();
  const looks = new Map<string, { look: ChannelLook; at: number }>();
  const lastDests = new Map<string, RelayDestination[]>();
  /** Stream ID → the target IDs last set on it. */
  const attached = new Map<string, string>();
  /** `${stationId}|${platformId}`: restarting now (sync leaves its target alone). */
  const restarting = new Set<string>();
  const restartTimers = new Map<string, NodeJS.Timeout>();
  const paidQueue = new Set<string>();
  const instanceStart = Date.now();
  let lastRestartCheck = 0;
  let prepared: { preparer: Preparer; slates: Slates } | null = null;

  const seam = () => options.platforms ?? platformsSeam(ctx);

  function media() {
    if (prepared) return prepared;
    const scale = options.ladderScale ?? (Number(process.env.PREPARE_LADDER_SCALE) || undefined);
    const ladder = options.ladder ?? (scale ? scaledLadder(scale) : LADDER);
    const preparer = createPreparer(ctx, { ladder, transcoder: ffmpegTranscoder({ preset: options.preset ?? process.env.PREPARE_PRESET ?? "veryfast" }), scratchDir, concurrency: 1, log });
    void preparer.init();
    prepared = { preparer, slates: new Slates(path.join(deps.config.storageRoot, "slates")) };
    return prepared;
  }

  const makeOutput = options.makeOutput ?? ((d: FanoutDestination[]) => new Fanout(d, { log }));
  const makeSender =
    options.makeSender ??
    ((input: SenderInput): SenderLike => {
      const { preparer, slates } = media();
      return new StationSender(ctx, input.stationId, input.settings, input.output, {
        look: input.look,
        preparer,
        slates,
        log,
        scratchDir,
        onPaidPromotion: input.onPaidPromotion,
        platforms: input.platforms,
        segmentBase: options.segmentBase ?? deps.config.hlsBase ?? null
      });
    });

  function healthOf(stationId: string, callSign: string | null, mode: RelayMode): Health {
    let h = health.get(stationId);
    if (!h) {
      h = { stationId, callSign, mode, picture: "copy", platforms: 0, relayMs: 0, runningSince: null, lastBytes: 0, lastProgressAt: Date.now(), samples: [], errors: 0, lastError: null, stoppedAt: null, since: Date.now(), closedBytes: 0 };
      health.set(stationId, h);
    }
    return h;
  }

  async function look(stationId: string): Promise<ChannelLook | null> {
    const cached = looks.get(stationId);
    if (cached && Date.now() - cached.at < 60_000) return cached.look;
    const found = await services.stations.look(stationId);
    if (!found) return null;
    const l: ChannelLook = { ...found, bug: { ...found.bug } } as ChannelLook;
    looks.set(stationId, { look: l, at: Date.now() });
    return l;
  }

  async function liveNow(stationId: string, now: Date) {
    const entries = await services.log.entries(stationId, now, new Date(now.getTime() + 1));
    return entries.find((e) => e.kind === "live" && e.startsAt <= now && e.endsAt > now) ?? null;
  }

  async function setStatus(stationId: string, status: "off" | "relaying" | "stopped" | "paused", extra: { lastError?: string | null; stoppedAt?: Date | null } = {}) {
    const [current] = await db.select({ status: SR.status }).from(SR).where(eq(SR.stationId, stationId));
    if (current?.status === status && extra.lastError === undefined) return;
    if (!current && status === "off") return;
    const set = { status, updatedAt: deps.clock.now(), ...extra };
    await db
      .insert(SR)
      .values({ stationId, ...RELAY_DEFAULTS, ...set })
      .onConflictDoUpdate({ target: SR.stationId, set });
  }

  /** The station's Livepeer relay stream, made once (`profiles: []`: no transcoding). */
  async function relayStream(stationId: string, l: ChannelLook) {
    const [row] = await db.select().from(SR).where(eq(SR.stationId, stationId));
    if (row?.livepeerStreamId && row.livepeerStreamKey) return { id: row.livepeerStreamId, key: row.livepeerStreamKey };
    const made = await livepeer!.createRelayStream(`${l.callSign ?? l.name} relay`);
    const set = { livepeerStreamId: made.id, livepeerStreamKey: made.streamKey, livepeerPlaybackId: made.playbackId, updatedAt: deps.clock.now() };
    await db
      .insert(SR)
      .values({ stationId, ...RELAY_DEFAULTS, ...set })
      .onConflictDoUpdate({ target: SR.stationId, set });
    log(`[relay] ${l.callSign ?? stationId}: made its Livepeer relay stream (no transcoding)`);
    return { id: made.id, key: made.streamKey };
  }

  /**
   * One Livepeer stream's multistream targets: one per destination, each `source`, all on or all
   * off (a target being restarted is left alone). Destinations that went are removed.
   */
  async function syncTargets(stationId: string, stream: string, streamId: string, dests: RelayDestination[], enabled: boolean, callSign: string | null) {
    const rows = await db
      .select()
      .from(RT)
      .where(and(eq(RT.stationId, stationId), eq(RT.stream, stream)));
    const now = deps.clock.now();
    for (const d of dests) {
      if (restarting.has(`${stationId}|${d.platformId}`)) continue;
      const url = pushUrl(d.rtmpUrl, d.streamKey);
      const hash = urlHash(url);
      const r = rows.find((x) => x.platformId === d.platformId);
      if (!r || !r.livepeerTargetId) {
        const target = await livepeer!.createTarget({ name: `${callSign ?? "Opencast"} ${platformName(d.kind, d.name)}`, url, disabled: !enabled });
        const values = { stationId, platformId: d.platformId, kind: d.kind, stream, livepeerStreamId: streamId, livepeerTargetId: target.id, urlHash: hash, disabled: !enabled, broadcastStartedAt: enabled ? now : null, updatedAt: now };
        if (r) await db.update(RT).set(values).where(eq(RT.id, r.id));
        else await db.insert(RT).values(values);
        continue;
      }
      if (r.urlHash !== hash) {
        await livepeer!.updateTarget(r.livepeerTargetId, { url });
        await db.update(RT).set({ urlHash: hash, updatedAt: now }).where(eq(RT.id, r.id));
      }
      if (r.disabled === enabled) {
        await livepeer!.updateTarget(r.livepeerTargetId, { disabled: !enabled });
        await db
          .update(RT)
          .set({ disabled: !enabled, broadcastStartedAt: enabled ? now : null, ...(enabled ? {} : { broadcastId: null }), paidPromotionMarkedAt: null, paidPromotionReminderAt: null, updatedAt: now })
          .where(eq(RT.id, r.id));
      }
    }
    for (const r of rows.filter((x) => !dests.some((d) => d.platformId === x.platformId))) {
      if (r.livepeerTargetId) await livepeer!.deleteTarget(r.livepeerTargetId);
      await db.delete(RT).where(eq(RT.id, r.id));
    }
    const ids = (await db.select({ id: RT.livepeerTargetId }).from(RT).where(and(eq(RT.stationId, stationId), eq(RT.stream, stream), isNotNull(RT.livepeerTargetId))))
      .map((x) => x.id!)
      .sort();
    if (attached.get(streamId) !== ids.join(",")) {
      await livepeer!.setStreamTargets(streamId, ids);
      attached.set(streamId, ids.join(","));
    }
  }

  /** Direct fan-out: each platform's own target row (no Livepeer), so limits and paid promotion work the same. */
  async function syncDirectTargets(stationId: string, dests: RelayDestination[], enabled: boolean) {
    const rows = await db
      .select()
      .from(RT)
      .where(and(eq(RT.stationId, stationId), eq(RT.stream, "direct")));
    const now = deps.clock.now();
    for (const d of dests) {
      const r = rows.find((x) => x.platformId === d.platformId);
      if (!r) await db.insert(RT).values({ stationId, platformId: d.platformId, kind: d.kind, stream: "direct", urlHash: urlHash(pushUrl(d.rtmpUrl, d.streamKey)), disabled: !enabled, broadcastStartedAt: enabled ? now : null, updatedAt: now });
      else if (r.disabled === enabled) await db.update(RT).set({ disabled: !enabled, broadcastStartedAt: enabled ? now : null, paidPromotionMarkedAt: null, paidPromotionReminderAt: null, updatedAt: now }).where(eq(RT.id, r.id));
    }
    const gone = rows.filter((x) => !dests.some((d) => d.platformId === x.platformId));
    if (gone.length) await db.delete(RT).where(inArray(RT.id, gone.map((x) => x.id)));
  }

  async function stopSender(stationId: string) {
    const r = running.get(stationId);
    if (!r) return;
    running.delete(stationId);
    const h = health.get(stationId);
    if (h) {
      if (h.runningSince) h.relayMs += Date.now() - h.runningSince;
      h.runningSince = null;
      h.closedBytes += r.output.bytes();
    }
    await r.sender.stop();
    await r.output.close();
    log(`[relay] ${r.callSign ?? stationId}: relay closed`);
  }

  function outputDestinations(dests: RelayDestination[], streamKey: string | null): FanoutDestination[] {
    if (fanOut === "livepeer" && livepeer && streamKey) return [{ id: "livepeer", url: livepeer.ingestUrl(streamKey) }];
    return dests.map((d) => ({ id: d.platformId, url: pushUrl(d.rtmpUrl, d.streamKey) }));
  }

  async function ensureSender(stationId: string, l: ChannelLook, settings: SenderSettings, dests: RelayDestination[], streamKey: string | null) {
    const signature = `${StationSender.signature(settings, l)}|${fanOut}|${streamKey ?? ""}`;
    const current = running.get(stationId);
    const outs = outputDestinations(dests, streamKey);
    if (current && current.signature === signature) {
      current.sender.update(settings);
      current.output.set(outs);
      current.dests = dests;
      return current;
    }
    if (current) await stopSender(stationId);
    const output = makeOutput(outs);
    const r: Running = { stationId, callSign: l.callSign, mode: settings.relayMode, signature, output, dests, startedAt: Date.now(), sender: null as unknown as SenderLike };
    r.sender = makeSender({ stationId, settings, output, look: l, onPaidPromotion: () => paidQueue.add(stationId), platforms: () => r.dests.length });
    r.sender.start();
    running.set(stationId, r);
    const h = healthOf(stationId, l.callSign, settings.relayMode);
    h.mode = settings.relayMode;
    h.picture = r.sender.mode;
    h.runningSince = Date.now();
    h.lastProgressAt = Date.now();
    h.lastBytes = 0;
    log(`[relay] ${l.callSign ?? stationId}: relaying ${settings.relayMode === "everything" ? "everything it airs" : "its live show"} to ${dests.length} ${dests.length === 1 ? "platform" : "platforms"} (${fanOut === "livepeer" ? "through Livepeer" : "directly"}, ${r.sender.mode})`);
    return r;
  }

  /** One station, one tick. */
  async function syncStation(stationId: string, onAir: boolean, row: typeof SR.$inferSelect | undefined) {
    const now = deps.clock.now();
    const settings = row ? { mode: row.mode, breakHandling: row.breakHandling, bugOnRelays: row.bugOnRelays, saveYoutubeVideos: row.saveYoutubeVideos } : { ...RELAY_DEFAULTS };
    const dests = await seam().destinationsFor(stationId);
    lastDests.set(stationId, dests);
    const l = await look(stationId);
    if (!l) return;
    const paused = settings.mode === "everything" ? (await services.billing.paused(stationId)).relays : false;
    const effective: RelayMode = settings.mode === "everything" && !paused ? "everything" : "live_only";
    const live = onAir ? await liveNow(stationId, now) : null;
    const useLivepeer = fanOut === "livepeer" && Boolean(livepeer);
    const wantSender = onAir && dests.length > 0 && (effective === "everything" || (Boolean(live) && (l.band === "radio" || !useLivepeer)));

    let streamKey: string | null = null;
    if (useLivepeer) {
      // "Live shows only" on TV: the live source's own Livepeer stream sends to the platforms, only while its block airs.
      if (l.band === "tv") {
        for (const src of await services.stations.liveSourceStreams(stationId)) {
          const on = onAir && !wantSender && effective === "live_only" && live?.liveSourceId === src.id;
          const has = (await db.select({ id: RT.id }).from(RT).where(and(eq(RT.stationId, stationId), eq(RT.stream, `live:${src.id}`)))).length > 0;
          if (on || has) await syncTargets(stationId, `live:${src.id}`, src.livepeerStreamId, dests, on, l.callSign);
        }
      }
      if (wantSender) {
        const stream = await relayStream(stationId, l);
        streamKey = stream.key;
        await syncTargets(stationId, "relay", stream.id, dests, true, l.callSign);
      } else if (row?.livepeerStreamId) {
        await syncTargets(stationId, "relay", row.livepeerStreamId, dests, false, l.callSign);
      }
    } else {
      await syncDirectTargets(stationId, dests, wantSender);
    }

    if (wantSender) {
      const [background, rule, legacy] = await Promise.all([
        l.band === "radio" ? services.stations.relayBackground(stationId) : Promise.resolve(null),
        services.stations.breakRule(stationId),
        services.stations.relays(stationId).catch(() => [])
      ]);
      await ensureSender(
        stationId,
        l,
        {
          relayMode: effective,
          breakHandling: settings.breakHandling,
          bugOnRelays: settings.bugOnRelays,
          partnerAds: rule.adsFromPartners,
          // Captions drawn in (X2) stay the translators' own choice until relays have one.
          burnCaptions: legacy.some((t) => t.burnCaptions),
          background
        },
        dests,
        streamKey
      );
    } else {
      await stopSender(stationId);
    }

    const h = health.get(stationId);
    const liveOnlyTv = useLivepeer && l.band === "tv" && effective === "live_only" && Boolean(live) && dests.length > 0 && onAir;
    if (wantSender) await setStatus(stationId, h?.stoppedAt ? "stopped" : "relaying");
    else if (paused && onAir && dests.length) await setStatus(stationId, liveOnlyTv ? "relaying" : "paused");
    else await setStatus(stationId, liveOnlyTv ? "relaying" : "off");
  }

  function noteError(stationId: string, error: unknown) {
    const h = healthOf(stationId, null, "live_only");
    h.errors++;
    h.lastError = (error as Error).message.slice(0, 300);
    log(`[relay] ${stationId}: ${h.lastError}`);
  }

  /** Bytes flowing: fine. None for `alertAfterMs` while it should be relaying: stopped, and the station and desk are told. */
  async function checkHealth() {
    const nowMs = Date.now();
    for (const [stationId, r] of running) {
      const h = healthOf(stationId, r.callSign, r.mode);
      const bytes = r.output.bytes();
      h.samples.push({ at: nowMs, bytes });
      while (h.samples.length > 2 && nowMs - h.samples[0].at > 60_000) h.samples.shift();
      h.platforms = r.dests.length;
      h.picture = r.sender.mode;
      h.errors = Math.max(h.errors, r.sender.errors + (r.output.status?.() ?? []).reduce((a, p) => a + p.errors, 0));
      h.lastError = r.sender.lastError ?? (r.output.status?.() ?? []).find((p) => p.lastError)?.lastError ?? h.lastError;
      if (bytes > h.lastBytes) {
        h.lastBytes = bytes;
        h.lastProgressAt = nowMs;
        if (h.stoppedAt) {
          const gone = nowMs - h.stoppedAt;
          h.stoppedAt = null;
          await setStatus(stationId, "relaying", { lastError: null, stoppedAt: null });
          // Down long enough that the platforms ended their broadcasts: new ones start now.
          if (gone > 5 * 60_000) await db.update(RT).set({ broadcastStartedAt: deps.clock.now(), paidPromotionMarkedAt: null, paidPromotionReminderAt: null }).where(and(eq(RT.stationId, stationId), eq(RT.disabled, false)));
          deps.bus.emit("station.relay", {
            stationId,
            step: "back",
            title: `${r.callSign ?? "Your station"}'s relays are back`,
            body: "The relay to your other platforms is sending again.",
            dedupeKey: `relay-back:${stationId}:${new Date(nowMs).toISOString().slice(0, 16)}`,
            desk: true
          });
          log(`[relay] ${r.callSign ?? stationId}: sending again`);
        }
      } else if (!h.stoppedAt && nowMs - h.lastProgressAt > alertAfterMs) {
        h.stoppedAt = nowMs;
        const why = h.lastError ?? "nothing has gone out for a while";
        await setStatus(stationId, "stopped", { lastError: why, stoppedAt: deps.clock.now() });
        deps.bus.emit("station.relay", {
          stationId,
          step: "stopped",
          title: `${r.callSign ?? "Your station"}'s relays stopped`,
          body: `The relay to your other platforms stopped (${why.slice(0, 160)}). Your channel is still on air on Opencast. The relay keeps trying and starts again on its own.`,
          dedupeKey: `relay-stopped:${stationId}:${new Date(nowMs).toISOString().slice(0, 16)}`,
          desk: true
        });
        log(`[relay] ${r.callSign ?? stationId}: stopped (${why})`);
      }
    }
  }

  // ---------- paid promotion ----------

  async function markPaidPromotion() {
    const ids = [...paidQueue];
    paidQueue.clear();
    for (const stationId of ids) {
      const dests = lastDests.get(stationId) ?? [];
      const targets = await db
        .select()
        .from(RT)
        .where(and(eq(RT.stationId, stationId), eq(RT.disabled, false)));
      const done = new Set<string>();
      for (const t of targets) {
        if (done.has(t.platformId)) continue;
        done.add(t.platformId);
        const d = dests.find((x) => x.platformId === t.platformId);
        if (!d || t.paidPromotionMarkedAt) continue;
        const now = deps.clock.now();
        if (d.connected && (d.kind === "youtube" || d.kind === "twitch")) {
          const res = await seam()
            .setPaidPromotion(d.platformId, true)
            .catch(() => ({ applied: false }));
          if (res.applied) {
            await db.update(RT).set({ paidPromotionMarkedAt: now, updatedAt: now }).where(and(eq(RT.stationId, stationId), eq(RT.platformId, d.platformId)));
            log(`[relay] ${stationId}: ${platformName(d.kind)} marked as containing paid promotion`);
            continue;
          }
        }
        if (t.paidPromotionReminderAt) continue;
        await db.update(RT).set({ paidPromotionReminderAt: now, updatedAt: now }).where(and(eq(RT.stationId, stationId), eq(RT.platformId, d.platformId)));
        const name = platformName(d.kind, d.name);
        deps.bus.emit("station.relay", {
          stationId,
          step: "paid_promotion",
          title: `Mark your stream on ${name} as paid promotion`,
          body: `Spots are airing on your relay to ${name}. Opencast can't mark that stream for you, so turn on its paid promotion setting there.`,
          dedupeKey: `relay-paid:${stationId}:${d.platformId}:${t.broadcastStartedAt?.toISOString() ?? "now"}`,
          desk: false
        });
      }
    }
  }

  // ---------- restarts for platform limits ----------

  async function breaksAndLives(stationId: string, from: Date, to: Date) {
    const [breaks, entries] = await Promise.all([services.log.breaks(stationId, from, to), services.log.entries(stationId, new Date(from.getTime() - 24 * 3_600_000), to)]);
    const moments: BreakMoment[] = breaks.map((b) => ({ id: b.id, startsAt: new Date(b.startsAt), endsAt: new Date(Date.parse(b.startsAt) + b.lengthMs), stationId: b.parts?.stationId !== false }));
    const lives: Span[] = entries.filter((e) => e.kind === "live").map((e) => ({ startsAt: e.startsAt, endsAt: e.endsAt }));
    return { moments, lives };
  }

  async function executeRestart(restartId: string) {
    restartTimers.delete(restartId);
    const [row] = await db.select().from(RR).where(eq(RR.id, restartId));
    if (!row || row.status !== "scheduled") return;
    const stationId = row.stationId;
    const [t] = await db
      .select()
      .from(RT)
      .where(and(eq(RT.stationId, stationId), eq(RT.platformId, row.platformId), eq(RT.disabled, false)));
    const d = (lastDests.get(stationId) ?? []).find((x) => x.platformId === row.platformId);
    const now = deps.clock.now();
    if (!t || !d) {
      await db.update(RR).set({ status: "cancelled", detail: "The platform isn't being relayed to any more" }).where(eq(RR.id, row.id));
      return;
    }
    const name = platformName(d.kind, d.name);
    if (row.method === "remind") {
      await db.update(RR).set({ status: "due", doneAt: now }).where(eq(RR.id, row.id));
      const tz = await services.stations.timezoneOf(stationId);
      deps.bus.emit("station.relay", {
        stationId,
        step: "restart_due",
        title: `Restart your stream on ${name}`,
        body: `${restartLabel({ kind: d.kind, name: d.name, at: row.at, deadline: row.deadline, duringBreak: row.duringBreak, automatic: false, status: "due" }, tz, now)}: it can't run longer than its limit, and Opencast can't restart a stream added with a key.`,
        dedupeKey: `relay-restart-due:${row.id}`,
        desk: false
      });
      log(`[relay] ${stationId}: ${name} is due a restart (the station was told)`);
      return;
    }
    const key = `${stationId}|${row.platformId}`;
    restarting.add(key);
    try {
      // A connected account: the next broadcast first, so viewers land on it.
      const next = d.connected ? await seam().prepareNextBroadcast(d.platformId) : null;
      const url = next ? pushUrl(next.rtmpUrl, next.streamKey) : null;
      if (row.method === "pusher" || !t.livepeerTargetId) {
        const r = running.get(stationId);
        if (!r) throw new Error("the relay isn't running");
        if (next) {
          r.dests = r.dests.map((x) => (x.platformId === d.platformId ? { ...x, rtmpUrl: next.rtmpUrl, streamKey: next.streamKey } : x));
          r.output.set(outputDestinations(r.dests, null));
        }
        await r.output.restart(d.platformId, restartGapMs);
      } else {
        // Only this platform's target goes off and on: Livepeer keeps sending to the others.
        await livepeer!.updateTarget(t.livepeerTargetId, { disabled: true });
        if (url && urlHash(url) !== t.urlHash) {
          await livepeer!.updateTarget(t.livepeerTargetId, { url });
          await db.update(RT).set({ urlHash: urlHash(url) }).where(eq(RT.id, t.id));
        }
        await sleep(restartGapMs);
        await livepeer!.updateTarget(t.livepeerTargetId, { disabled: false });
      }
      if (d.connected) await seam().endBroadcast(d.platformId, t.broadcastId ?? null);
      const at = deps.clock.now();
      await db
        .update(RT)
        .set({ broadcastStartedAt: at, broadcastId: next?.broadcastId ?? t.broadcastId, paidPromotionMarkedAt: null, paidPromotionReminderAt: null, updatedAt: at })
        .where(and(eq(RT.stationId, stationId), eq(RT.platformId, row.platformId), eq(RT.disabled, false)));
      await db.update(RR).set({ status: "done", doneAt: at, detail: next ? "The next broadcast was made first, then the last one ended" : null }).where(eq(RR.id, row.id));
      log(`[relay] ${stationId}: ${name} restarted${row.duringBreak ? " during a break" : ""} (${row.reason === "limit" ? "its limit" : "to save the broadcast"})`);
    } catch (error) {
      const message = (error as Error).message.slice(0, 300);
      await db.update(RR).set({ status: "failed", doneAt: deps.clock.now(), detail: message }).where(eq(RR.id, row.id));
      deps.bus.emit("station.relay", {
        stationId,
        step: "restart_failed",
        title: `${name} couldn't restart`,
        body: `Opencast tried to restart your stream on ${name} before its limit and couldn't (${message.slice(0, 120)}). It tries again at the next break.`,
        dedupeKey: `relay-restart-failed:${row.id}`,
        desk: false
      });
      log(`[relay] ${stationId}: ${name} restart failed: ${message}`);
    } finally {
      restarting.delete(key);
    }
  }

  /** Plans each broadcast's next restart (for a break), and does the ones due. */
  async function checkRestarts() {
    const now = deps.clock.now();
    const limits = await services.relays.limits(now);
    const targets = await db
      .select()
      .from(RT)
      .where(and(eq(RT.disabled, false), isNotNull(RT.broadcastStartedAt)));
    const planned = await db
      .select()
      .from(RR)
      .where(inArray(RR.status, ["scheduled", "due"]));
    const seen = new Set<string>();
    for (const t of targets) {
      const key = `${t.stationId}|${t.platformId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = (lastDests.get(t.stationId) ?? []).find((x) => x.platformId === t.platformId);
      const mine = planned.filter((p) => p.stationId === t.stationId && p.platformId === t.platformId);
      const settings = await services.relays.settings(t.stationId);
      const need = d ? restartNeed(d, t.broadcastStartedAt!, limits, settings) : null;
      const current = need ? mine.find((p) => p.deadline.getTime() === need.deadline.getTime()) : undefined;
      // Plans for an earlier broadcast (or none needed now) are cancelled.
      const stale = mine.filter((p) => p !== current && p.status === "scheduled");
      if (stale.length) await db.update(RR).set({ status: "cancelled" }).where(inArray(RR.id, stale.map((p) => p.id)));
      if (!need || !d) continue;
      if (current?.status === "due") {
        // The station was told; past the limit, the platform ended that broadcast: the next one counts from there.
        if (now >= need.deadline) await db.update(RT).set({ broadcastStartedAt: need.deadline }).where(and(eq(RT.stationId, t.stationId), eq(RT.platformId, t.platformId), eq(RT.disabled, false)));
        continue;
      }
      let row = current;
      if (!row || row.at.getTime() > now.getTime()) {
        const { moments, lives } = await breaksAndLives(t.stationId, now, need.deadline);
        const plan = planRestart(need, moments, lives, { now, windowHours: limits.windowHours, sidMs: STATION_ID_MS });
        const method = !need.automatic ? "remind" : fanOut === "direct" || !t.livepeerTargetId ? "pusher" : d.connected ? "new_broadcast" : "toggle";
        if (!row) {
          [row] = await db
            .insert(RR)
            .values({ stationId: t.stationId, platformId: t.platformId, kind: d.kind, reason: need.reason, status: "scheduled", at: plan.at, deadline: need.deadline, duringBreak: plan.duringBreak, breakId: plan.breakId, automatic: need.automatic, method, detail: plan.why })
            .returning();
        } else if (row.at.getTime() !== plan.at.getTime() || row.method !== method) {
          [row] = await db.update(RR).set({ at: plan.at, duringBreak: plan.duringBreak, breakId: plan.breakId, method, detail: plan.why }).where(eq(RR.id, row.id)).returning();
        }
      }
      const wait = row.at.getTime() - now.getTime();
      if (wait <= 0) await executeRestart(row.id);
      else if (wait <= restartCheckMs + 5_000 && !restartTimers.has(row.id)) {
        const id = row.id;
        const timer = setTimeout(() => void executeRestart(id).catch((error) => log(`[relay] restart failed: ${(error as Error).message}`)), wait);
        timer.unref?.();
        restartTimers.set(id, timer);
      }
    }
  }

  const runner = {
    fanOut,
    /** A station's running sender (tests read what it drew). */
    sender(stationId: string): SenderLike | null {
      return running.get(stationId)?.sender ?? null;
    },
    output(stationId: string): OutputLike | null {
      return running.get(stationId)?.output ?? null;
    },

    async tick() {
      const onAir = new Set(await services.playout.onAirStations());
      const rows = await db.select().from(SR);
      const ids = new Set<string>([...onAir, ...running.keys(), ...rows.filter((r) => r.status !== "off").map((r) => r.stationId)]);
      for (const stationId of ids) {
        await syncStation(
          stationId,
          onAir.has(stationId),
          rows.find((r) => r.stationId === stationId)
        ).catch((error) => noteError(stationId, error));
      }
      await checkHealth().catch((error) => log(`[relay] health: ${(error as Error).message}`));
      if (paidQueue.size) await markPaidPromotion().catch((error) => log(`[relay] paid promotion: ${(error as Error).message}`));
      if (Date.now() - lastRestartCheck >= restartCheckMs) {
        lastRestartCheck = Date.now();
        await checkRestarts().catch((error) => log(`[relay] restarts: ${(error as Error).message}`));
      }
    },

    /** The restart check now (tests; the tick runs it every `restartCheckMs`). */
    checkRestarts,
    markPaidPromotion,

    /** For the health endpoint: relay hours, bandwidth and errors per station. */
    health(meta: { instance: string; leader: boolean }): RelayHealth {
      const nowMs = Date.now();
      const stations = [...health.values()]
        .filter((h) => running.has(h.stationId) || h.stoppedAt || h.errors)
        .map((h) => {
          const r = running.get(h.stationId);
          const bytes = h.closedBytes + (r ? r.output.bytes() : 0);
          const first = h.samples[0];
          const last = h.samples[h.samples.length - 1];
          const kbps = first && last && last.at > first.at ? Math.round(((last.bytes - first.bytes) * 8) / (last.at - first.at)) : 0;
          const ms = h.relayMs + (h.runningSince ? nowMs - h.runningSince : 0);
          return {
            stationId: h.stationId,
            callSign: h.callSign,
            mode: h.mode,
            status: (h.stoppedAt ? "stopped" : r ? "relaying" : "stopped") as "relaying" | "stopped" | "starting",
            picture: h.picture,
            platforms: h.platforms || r?.dests.length || 0,
            relayHours: Math.round((ms / 3_600_000) * 1000) / 1000,
            bytesSent: bytes,
            kbps,
            errors: h.errors,
            lastError: h.lastError,
            since: new Date(h.since).toISOString()
          };
        });
      return { ok: true, service: "opencast-relay", instance: meta.instance, leader: meta.leader, fanOut, stations, at: new Date(nowMs).toISOString() };
    },

    /** Stops every sender (shutdown, or the lease lost). Livepeer's targets are left: the next leader carries on. */
    async stopAll() {
      for (const timer of restartTimers.values()) clearTimeout(timer);
      restartTimers.clear();
      for (const stationId of [...running.keys()]) await stopSender(stationId);
    },

    startedAt: new Date(instanceStart)
  };
  return runner;
}

export type RelayRunner = ReturnType<typeof createRelayRunner>;
