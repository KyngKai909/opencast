// The relay service's configuration: environment only, so the same image runs on Railway or on a
// plain Linux server (docs/relay.md). Nothing here is specific to a host.
//
//   DATABASE_URL            Postgres (required): the channel's timeline, the relay settings, sessions
//   REDIS_URL               optional: a lease, so only one relay instance sends at a time
//   LIVEPEER_API_KEY        Livepeer Studio (the per-station relay streams and their targets)
//   LIVEPEER_API_BASE       default https://livepeer.studio/api
//   LIVEPEER_RTMP_INGEST_BASE  default rtmp://rtmp.livepeer.com/live
//   LIVEPEER_PLAYBACK_BASE  Livepeer's playback (default https://livepeercdn.studio/hls); not read by
//                           the relay: live blocks come from the worker's copies in storage
//   HLS_PUBLIC_URL          the channel playlist base (the worker's HLS origin): prepared segments
//                           are read there when object storage isn't configured here
//   R2_* / S3_*             optional: object storage, read directly (cheaper than through the worker)
//   RELAY_FAN_OUT           `livepeer` (default with a Livepeer key) or `direct` (a push per platform)
//   PORT / RELAY_PORT       the health endpoint (default 8789)
//   RELAY_SCRATCH_DIR       scratch space (default /tmp/opencast-relay)
//   STORAGE_ROOT            local storage and slates (default /tmp/opencast-relay/storage)
//   RELAY_TICK_MS           how often stations are checked (default 5000)
//   RELAY_ALERT_AFTER_MS    no bytes out this long: the relay stopped, the station and desk are told (default 45000)

import os from "node:os";
import path from "node:path";

export interface RelayConfig {
  port: number;
  instance: string;
  redisUrl: string | null;
  leaseKey: string;
  leaseSec: number;
  tickMs: number;
  alertAfterMs: number;
  storageRoot: string;
  scratchDir: string;
  fanOut: "livepeer" | "direct" | null;
  livepeerConfigured: boolean;
  segmentBase: string | null;
}

export function relayConfig(env: NodeJS.ProcessEnv, instanceId: string): RelayConfig {
  const number = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const scratchDir = env.RELAY_SCRATCH_DIR?.trim() || path.join(os.tmpdir(), "opencast-relay");
  const fanOut = env.RELAY_FAN_OUT?.trim().toLowerCase();
  if (fanOut && fanOut !== "livepeer" && fanOut !== "direct") throw new Error(`RELAY_FAN_OUT is "${fanOut}": use "livepeer" or "direct".`);
  if (!env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required");
  return {
    port: number(env.RELAY_PORT ?? env.PORT, 8789),
    instance: instanceId,
    redisUrl: env.REDIS_URL?.trim() || null,
    leaseKey: env.RELAY_LEADER_KEY?.trim() || "opencast:relay:leader",
    leaseSec: number(env.RELAY_LEASE_SEC, 20),
    tickMs: number(env.RELAY_TICK_MS, 5_000),
    alertAfterMs: number(env.RELAY_ALERT_AFTER_MS, 45_000),
    storageRoot: env.STORAGE_ROOT?.trim() || path.join(scratchDir, "storage"),
    scratchDir,
    fanOut: (fanOut as "livepeer" | "direct" | undefined) ?? null,
    livepeerConfigured: Boolean(env.LIVEPEER_API_KEY?.trim()),
    segmentBase: env.HLS_PUBLIC_URL?.trim().replace(/\/+$/, "") || null
  };
}
