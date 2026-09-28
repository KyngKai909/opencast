// The playout worker. The leader (Redis lease) runs the playout engine, which airs
// every station on air from its program log from files in its cache, and the minute
// tick (reminders, dead-air warnings, deadlines). Followers wait. The old queue loop
// runs too while stations on the old model still need it (LEGACY_PLAYOUT=on).
// GET /health reports leadership, stations on air and the cache.

import http from "node:http";
import { createDeps, createEngine, createJobs, createV1 } from "@opencast/api/runtime";
import { STORAGE_ROOT } from "./config.js";
import { startLegacyPlayout, workerInstanceId } from "./legacy.js";
import { closeRedis, refreshLeadershipLease, releaseLeadershipLease } from "./redis.js";

const TICK_MS = 1_000;
const JOBS_EVERY_MS = 60_000;

const deps = createDeps(process.env, STORAGE_ROOT);
const { services } = createV1(deps);
const engine = createEngine({ deps, services }, { log: (line) => console.log(line) });
const jobs = createJobs(deps, services);
const legacy = process.env.LEGACY_PLAYOUT === "off" ? null : startLegacyPlayout();

let leader = false;
let lastJobs = 0;
let ticking = false;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const lease = await refreshLeadershipLease(workerInstanceId);
    if (!lease) {
      if (leader) {
        leader = false;
        console.log("[worker] leadership lost; stopping stations");
        await engine.stopAll();
      }
      return;
    }
    if (!leader) {
      leader = true;
      console.log(`[worker] leader (${workerInstanceId})`);
    }
    await engine.tick();
    if (Date.now() - lastJobs >= JOBS_EVERY_MS) {
      lastJobs = Date.now();
      const results = await jobs.tick();
      if (results.reminders || results.claimsExpired || results.ordersApproved || results.dailyCapsResumed) {
        console.log("[worker] jobs", JSON.stringify(results));
      }
    }
  } catch (error) {
    console.error("[worker] tick failed", error);
  } finally {
    ticking = false;
  }
}

// Railway gives the worker a PORT; locally it's WORKER_HEALTH_PORT (the dev stack's PORT belongs to the web app).
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? (process.env.RAILWAY_ENVIRONMENT ? process.env.PORT : undefined) ?? 8788);
const health = http.createServer((req, res) => {
  if (req.url !== "/health") {
    res.writeHead(404).end();
    return;
  }
  const { stationsOnAir, cache } = engine.stats();
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "opencast-worker", instance: workerInstanceId, leader, stationsOnAir, cache, at: new Date().toISOString() }));
});
health.on("error", (error) => console.error(`[worker] health endpoint couldn't start on ${healthPort}`, error.message));
health.listen(healthPort, () => console.log(`[worker] health on :${healthPort}/health`));

console.log(`[worker] Opencast playout worker started`);
void tick();
const interval = setInterval(tick, TICK_MS);

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(interval);
  health.close();
  console.log(`[worker] ${signal}: signing stations off the worker`);
  await engine.stopAll();
  await legacy?.stop();
  await releaseLeadershipLease(workerInstanceId);
  await closeRedis();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
