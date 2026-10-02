// The relay service (follow-up Phase 3): simulcasts stations to the platforms they connect, one
// continuous stream per station, split by Livepeer (docs/relay.md). It runs unchanged as a Docker
// container anywhere (Railway first, then a host with cheap bandwidth), configured only by its
// environment (config.ts). It reads the channel and the relay settings from the database, never
// writes the channel, and pushes over RTMP: Opencast's own channel is never affected by it.
//
// GET /health reports relay hours, bandwidth and errors per station.

import { randomUUID } from "node:crypto";
import { createDeps, createRelayRunner, createV1 } from "@opencast/api/runtime";
import { relayConfig } from "./config.js";
import { createLease, redisStore } from "./lease.js";
import { healthServer } from "./server.js";

const instance = `${process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? process.pid}-${randomUUID().slice(0, 8)}`;
const config = relayConfig(process.env, instance);
// The API's runtime never runs the minute jobs here: they're the worker's.
process.env.JOBS = "off";

const deps = createDeps(process.env, config.storageRoot);
const { services } = createV1(deps);
const runner = createRelayRunner(
  { deps, services },
  { log: (line) => console.log(line), fanOut: config.fanOut ?? undefined, scratchDir: config.scratchDir, alertAfterMs: config.alertAfterMs, segmentBase: config.segmentBase }
);
const redis = await redisStore(config.redisUrl);
const lease = createLease(redis.store, config.leaseKey, instance, config.leaseSec);

let leader = false;
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const held = await lease.refresh();
    if (!held) {
      if (leader) {
        leader = false;
        console.log("[relay] the lease went to another instance: stopping");
        await runner.stopAll();
      }
      return;
    }
    if (!leader) {
      leader = true;
      console.log(`[relay] relaying (${instance}, ${runner.fanOut === "livepeer" ? "split by Livepeer" : "a push per platform"})`);
    }
    await runner.tick();
  } catch (error) {
    console.error("[relay] tick failed", error);
  } finally {
    ticking = false;
  }
}

const server = healthServer(() => {
  const h = runner.health({ instance, leader });
  return { ...h, ok: !h.stations.some((s) => s.status === "stopped") };
});
server.on("error", (error) => console.error(`[relay] the health endpoint couldn't start on ${config.port}`, error.message));
server.listen(config.port, () => console.log(`[relay] health on :${config.port}/health`));

console.log(`[relay] Opencast relay service started${config.livepeerConfigured ? "" : " (no LIVEPEER_API_KEY: pushing to each platform directly)"}`);
void tick();
const interval = setInterval(() => void tick(), config.tickMs);

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(interval);
  server.close();
  console.log(`[relay] ${signal}: closing relays`);
  await runner.stopAll();
  await lease.release();
  await redis.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
