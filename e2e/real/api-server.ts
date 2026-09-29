// The real API for the real-API runs: the v1 API (apps/api/src/v1, the same routers, services and
// contracts the API server mounts) on a throwaway database, with the fakes the API's own tests use
// for everything outside (payments, Clear, IPFS, geo, notices). Started by global-setup.ts with
// `tsx --conditions=source`; never in production.
//
// It creates the database, migrates it with the repo's migrations (packages/db/scripts/migrate.ts)
// and seeds it (packages/db/scripts/seed.ts for the markets, then seed.ts here), listens, and drops
// the database when it's stopped (SIGTERM or SIGINT) or when the process that started it goes away.
//
// Environment (global-setup.ts sets it):
//   E2E_RUN                 the run's id; the database is opencast_e2e_<run>
//   E2E_ADMIN_DATABASE_URL  a database on the Docker Postgres to create it from
//   PORT                    8788
//   PRIVY_APP_ID            opencast-e2e
//   PRIVY_VERIFICATION_KEY  the public half (SPKI PEM) of the run's ES256 key
//   E2E_SIGNING_JWK         the private half (JWK), only to sign the seed's own requests
//   REDIS_URL               the Docker Redis, a db index of its own; relay channels prefixed by run
//   WEB_ORIGIN              the apps' e2e origins (CORS)
//   APP_ORIGIN              the viewer's e2e origin (links in notices)
//   STORAGE_ROOT            a temp directory, removed at the end
//   E2E_SEED_FILE           where the seed's ids are written
//   E2E_STATE_FILE          the run's state (run.ts writes it), removed when this stops
//   E2E_PARENT_PID          stop when this process is gone

// Nothing outside is ever called: blank every provider key before anything reads the repo's .env
// (its loader never overrides a variable that's set), as the API's tests do (apps/api/test/setup.ts).
for (const key of [
  "LIVEPEER_API_KEY",
  "PINATA_JWT",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_ENDPOINT",
  "R2_PUBLIC_BASE",
  "PRIVY_APP_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "CLEAR_PRIVY_PROVIDER_APP_ID",
  "CLEAR_WALLET_ACCESS",
  "CHAIN_RPC_URL",
  "ESCROW_CONTRACT_ADDRESS",
  "GEOIP_URL",
  "LIVE_INGEST_SERVER"
]) {
  process.env[key] = "";
}
process.env.PAYMENTS_PROVIDER = "fake";
process.env.JOBS = "off";

import { spawnSync } from "node:child_process";
import { promises as fs, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const env = (key: string) => {
  const v = process.env[key];
  if (!v) throw new Error(`api-server: ${key} is required`);
  return v;
};

// A guard on every outside request this process could make with fetch: only this machine answers.
const realFetch = globalThis.fetch;
const outside: string[] = [];
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    outside.push(url.origin);
    console.error(`[e2e-api] refused a request to ${url.origin}: the real-API runs never call outside services`);
    throw new Error(`The e2e API doesn't call outside services (${url.origin}).`);
  }
  return realFetch(input, init);
}) as typeof fetch;

const run = env("E2E_RUN");
const adminUrl = env("E2E_ADMIN_DATABASE_URL");
const database = `opencast_e2e_${run}`;
const databaseUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${database}`;
  return u.toString();
})();
const port = Number(env("PORT"));
const storageRoot = process.env.STORAGE_ROOT || path.join(os.tmpdir(), `opencast-e2e-${run}`);
process.env.STORAGE_ROOT = storageRoot;
process.env.DATABASE_URL = databaseUrl;
mkdirSync(storageRoot, { recursive: true });

const pg = (await import("pg")).default;

async function admin<T>(fn: (c: InstanceType<typeof pg.Client>) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

// --- The database: created, migrated and given its markets by the repo's own scripts.
await admin((c) => c.query(`CREATE DATABASE ${database}`));
let dropped = false;
async function dropDatabase() {
  if (dropped) return;
  dropped = true;
  await admin((c) => c.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)).catch((e) => console.error(`[e2e-api] dropping ${database}: ${(e as Error).message}`));
  await fs.rm(storageRoot, { recursive: true, force: true }).catch(() => undefined);
}

function script(file: string) {
  const r = spawnSync(path.join(root, "node_modules/.bin/tsx"), [file], { cwd: path.join(root, "packages/db"), env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${file} failed:\n${r.stdout}\n${r.stderr}`);
  process.stdout.write(`[e2e-api] ${r.stdout.trim()}\n`);
}
try {
  script("scripts/migrate.ts");
  script("scripts/seed.ts");
} catch (e) {
  await dropDatabase();
  throw e;
}

// --- The API, built as the API server builds it (src/v1/boot.ts), with the tests' fakes outside.
const express = (await import("express")).default;
const cors = (await import("cors")).default;
const { createDb } = await import("@opencast/db");
const { privyVerifier } = await import("../../apps/api/src/v1/auth.js");
const { fakeClearLookup } = await import("../../apps/api/src/v1/clearLink.js");
const { EventBus } = await import("../../apps/api/src/v1/events.js");
const { createV1 } = await import("../../apps/api/src/v1/index.js");
const { ffmpegPipeline } = await import("../../apps/api/src/v1/media.js");
const { fakePayments } = await import("../../apps/api/src/v1/payments/index.js");
const { localObjectStore } = await import("../../apps/api/src/v1/storage.js");
const { noGeoLookup } = await import("../../apps/api/src/v1/geo.js");
const { redisRelayBus, memoryRelayBus } = await import("../../apps/api/src/v1/relay.js");
const { fakeIpfs } = await import("../../apps/api/test/harness.js");
type Deps = import("../../apps/api/src/v1/context.js").Deps;

const { db, pool } = createDb(databaseUrl);
pool.on("error", () => undefined); // the database going away at the end ends idle connections
const clock = { now: () => new Date() };
const verifier = privyVerifier({ privyAppId: env("PRIVY_APP_ID"), verificationKey: env("PRIVY_VERIFICATION_KEY") });
// What Privy would report as linked: `did:privy:<name>` signed in with <name>@example.com.
verifier.linkedAccounts = async (did) => {
  const name = did.replace(/^did:privy:/, "");
  return /^[a-z0-9._-]+$/i.test(name) ? [{ kind: "email", value: `${name.toLowerCase()}@example.com` }] : [];
};
const sent: Array<{ channel: "push" | "email"; to: string; title: string; at: string }> = [];
const redisUrl = process.env.REDIS_URL?.trim();
const deps: Deps = {
  db,
  bus: new EventBus(),
  clock,
  media: ffmpegPipeline(storageRoot),
  storage: { objects: localObjectStore(path.join(storageRoot, "objects")), ipfs: fakeIpfs() },
  chain: null,
  notifier: {
    push: async (userId, n) => void sent.push({ channel: "push", to: userId, title: n.title, at: clock.now().toISOString() }),
    email: async (to, n) => void sent.push({ channel: "email", to, title: n.title, at: clock.now().toISOString() })
  },
  payments: fakePayments(clock),
  auth: verifier,
  // Clear is set up (so Connect Clear answers), and nobody has linked it.
  clear: fakeClearLookup(),
  geo: noGeoLookup,
  relay: redisUrl ? redisRelayBus(redisUrl, `opencast:e2e:${run}:relay:`) : memoryRelayBus(),
  config: {
    storageRoot,
    appOrigin: process.env.APP_ORIGIN ?? "http://localhost:5274",
    escrowContractAddress: null,
    usdc: { chainId: 84532, address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
    production: false
  }
};
const v1 = createV1(deps);

const app = express();
const origins = new Set((process.env.WEB_ORIGIN ?? "").split(",").map((o) => o.trim()).filter(Boolean));
app.use(cors({ origin: (origin, cb) => cb(null, !origin || origins.size === 0 || origins.has(origin)) }));
// As the API server: live playlists with their break cues, and objects from local storage.
app.get("/hls/:stationId/index.m3u8", async (req, res, next) => {
  try {
    const playlist = await v1.services.playout.playlistWithCues(req.params.stationId);
    if (playlist === null) return next();
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-store");
    res.send(playlist);
  } catch (error) {
    next(error);
  }
});
app.use("/objects", express.static(path.join(storageRoot, "objects")));

// The harness's own endpoints (never the API's): whether the seed is in, and the notices sent.
let ready = false;
app.get("/e2e/ready", (_req, res) => void res.status(ready ? 200 : 503).json({ ready, database, outside }));
app.get("/e2e/sent", (_req, res) => void res.json(sent));

app.use("/v1", v1.router);

const server = await new Promise<import("node:http").Server>((resolve, reject) => {
  const s = app.listen(port, () => resolve(s));
  s.on("error", reject);
}).catch(async (e) => {
  await dropDatabase();
  throw e;
});
console.log(`[e2e-api] listening on :${port} with ${database}`);

let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections?.();
  server.close();
  await v1.services.library.settle().catch(() => undefined);
  await deps.bus.settle().catch(() => undefined);
  await deps.relay.close().catch(() => undefined);
  await pool.end().catch(() => undefined);
  await dropDatabase();
  // The run's state goes with it (unless it's another run's by now).
  const stateFile = process.env.E2E_STATE_FILE;
  if (stateFile) {
    try {
      if (JSON.parse(await fs.readFile(stateFile, "utf8")).run === run) await fs.rm(stateFile, { force: true });
    } catch {
      /* not written yet, or gone */
    }
  }
  console.log(`[e2e-api] stopped; dropped ${database}`);
  process.exit(code);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
const parent = Number(process.env.E2E_PARENT_PID);
if (parent) {
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      console.log("[e2e-api] the process that started me is gone");
      void stop();
    }
  }, 2000).unref();
}

// --- The seed, through the API itself where it can (seed.ts).
try {
  const { seed } = await import("./seed.js");
  const ids = await seed({ db, services: v1.services, deps, apiBase: `http://localhost:${port}`, signingJwk: JSON.parse(env("E2E_SIGNING_JWK")), appId: env("PRIVY_APP_ID") });
  writeFileSync(env("E2E_SEED_FILE"), JSON.stringify(ids, null, 2));
  ready = true;
  console.log("[e2e-api] seeded; ready");
} catch (e) {
  console.error(`[e2e-api] seeding failed: ${(e as Error).stack ?? e}`);
  await stop(1);
}
