// The playout worker: prepare once, then assemble. The leader (Redis lease) runs the playout
// engine, which prepares items for air (FFmpeg, once per content ID, into object storage),
// assembles every station on air into its playlists (pointing at prepared segments, at Livepeer's
// during a TV station's live blocks, and at its own during a radio station's: the leader takes
// radio encoders' RTMP pushes on WORKER_INGEST_PORT, 1935 by default), and runs the minute tick
// (reminders, dead-air warnings, deadlines). Followers wait. The worker needs only scratch space
// (WORKER_SCRATCH_DIR) for preparation and radio live. Relays to other platforms are the relay
// service's (apps/relay, follow-up Phase 3), never the worker's.
//
// GET /health reports leadership, stations on air, preparation (items prepared, waiting, and the
// time preparing takes) and readiness; GET /hls/<station>/master.m3u8 (and <rendition>.m3u8) serves
// a channel's playlists, rendered from the database, so any replica answers them.

import http from "node:http";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createDeps, createEngine, createJobs, createV1 } from "@opencast/api/runtime";
import { STORAGE_ROOT } from "./config.js";
import { closeRedis, refreshLeadershipLease, releaseLeadershipLease } from "./redis.js";
import { startExternalChecks } from "./externalChecks.js";

const TICK_MS = 1_000;
// This replica's name in the leadership lease.
const workerInstanceId = `${process.env.RAILWAY_REPLICA_ID ?? process.pid}-${randomUUID()}`;
const JOBS_EVERY_MS = 60_000;

const deps = createDeps(process.env, STORAGE_ROOT);
const { services } = createV1(deps);
// Radio live: encoders push to the leader's RTMP ingest (WORKER_INGEST_SERVER is the address they're given).
const ingestPort = process.env.WORKER_INGEST_PORT === "off" ? null : Number(process.env.WORKER_INGEST_PORT ?? 1935);
const engine = createEngine({ deps, services }, { log: (line) => console.log(line), ingest: ingestPort === null ? null : { port: ingestPort } });
const jobs = createJobs(deps, services);

let leader = false;
let lastJobs = 0;
let ticking = false;
// External stations' streams, checked every minute on the leader (follow-up Phase 6).
const stopExternalChecks = startExternalChecks(services, () => leader);

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
const PLAYLIST = /^\/hls\/([0-9a-f-]{36})\/([a-z0-9]+\.m3u8|empty\.vtt)$/;
const PREPARED = /^\/hls\/(prepared\/[\w-]+\/[a-z0-9]+\/seg_\d{5}\.(?:ts|vtt))$/;
const LOCAL_OBJECT = /^\/objects\/((?:prepared|proof)\/[\w/.-]+)$/;
const health = http.createServer((req, res) => {
  const url = (req.url ?? "").split("?")[0];
  if (url === "/health") {
    engine
      .stats()
      .then(({ stationsOnAir, preparation, readiness, live }) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, service: "opencast-worker", instance: workerInstanceId, leader, stationsOnAir, preparation, readiness, live, at: new Date().toISOString() }));
      })
      .catch((error) => res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: (error as Error).message })));
    return;
  }
  if (req.method !== "GET") return void res.writeHead(404).end();
  const cors = { "access-control-allow-origin": "*" };
  // A channel's playlists, from its assembled timeline (any replica can answer), with a short cache.
  const playlist = PLAYLIST.exec(url);
  if (playlist) {
    services.playout
      .playlist(playlist[1], playlist[2])
      .then((found) => {
        if (!found) return void res.writeHead(404, { ...cors, "cache-control": "no-cache" }).end();
        const headers = { ...cors, "content-type": found.contentType ?? "application/vnd.apple.mpegurl", "cache-control": `public, max-age=${found.maxAge}`, vary: "Accept-Encoding" };
        // A 30-minute window is tens of kilobytes of repetitive lines: gzip takes it to a few.
        if (/\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) res.writeHead(200, { ...headers, "content-encoding": "gzip" }).end(gzipSync(found.body));
        else res.writeHead(200, headers).end(found.body);
      })
      .catch(() => res.writeHead(500, cors).end());
    return;
  }
  // Prepared segments, when storage has no public domain; and local disk in development.
  const prepared = PREPARED.exec(url);
  const local = LOCAL_OBJECT.exec(url);
  const key = prepared?.[1] ?? local?.[1];
  if (key && deps.storage.objects.open && !key.includes("..")) {
    deps.storage.objects
      .open(key)
      .then((stream) => {
        res.writeHead(200, { ...cors, "content-type": key.endsWith(".jpg") ? "image/jpeg" : key.endsWith(".vtt") ? "text/vtt" : "video/mp2t", "cache-control": "public, max-age=31536000, immutable" });
        stream.on("error", () => res.destroy());
        stream.pipe(res);
      })
      .catch(() => res.writeHead(404, cors).end());
    return;
  }
  res.writeHead(404).end();
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
  stopExternalChecks();
  health.close();
  console.log(`[worker] ${signal}: signing stations off the worker`);
  await engine.stopAll();
  await releaseLeadershipLease(workerInstanceId);
  await closeRedis();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
