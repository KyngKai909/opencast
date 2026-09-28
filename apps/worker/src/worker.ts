// The playout worker. The leader (Redis lease) runs the playout engine, which airs
// every station on air from its program log, and the minute tick (reminders,
// dead-air warnings, deadlines). Followers wait. The old queue loop runs too while
// stations on the old model still need it (LEGACY_PLAYOUT=on).

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

console.log(`[worker] Opencast playout worker started`);
void tick();
const interval = setInterval(tick, TICK_MS);

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(interval);
  console.log(`[worker] ${signal}: signing stations off the worker`);
  await engine.stopAll();
  await legacy?.stop();
  await releaseLeadershipLease(workerInstanceId);
  await closeRedis();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
