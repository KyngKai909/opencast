// Starts and stops one real-API run: a signing key, the API on :8788 over a throwaway database
// (api-server.ts creates, migrates, seeds and drops it), and the state file the tests read.
// global-setup.ts and global-teardown.ts call these; so does up.ts, for people.

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { exportJWK, exportSPKI, generateKeyPair } from "jose";
import { ADMIN_DATABASE_URL, API_BASE, API_PORT, PRIVY_APP_ID, REAL_PORTS, REDIS_BASE_URL, ROOT, STATE_DIR, STATE_FILE, type RunState, type Seed } from "./shared.js";

/** The Redis db index the runs use (the dev API uses 0). The relay's channels are prefixed by run too. */
const REDIS_DB = 9;

async function up(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

function tail(file: string, lines = 40) {
  try {
    return readFileSync(file, "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

export async function startRun(o: { parentPid?: number } = {}): Promise<RunState> {
  if (await up(`${API_BASE}/e2e/ready`).catch(() => false)) {
    throw new Error(`Something already answers on :${API_PORT}. Stop the other real-API run first (npm run real:down -w @opencast/e2e).`);
  }
  mkdirSync(STATE_DIR, { recursive: true });
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const privateJwk = { ...(await exportJWK(privateKey)), alg: "ES256" };
  const seedFile = path.join(STATE_DIR, `seed-${run}.json`);
  const logFile = path.join(STATE_DIR, "api.log");
  const redisUrl = `${REDIS_BASE_URL}/${REDIS_DB}`;
  const origins = Object.values(REAL_PORTS).flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]);

  const log = openSync(logFile, "w");
  const child = spawn(path.join(ROOT, "node_modules/.bin/tsx"), ["--conditions=source", path.join(ROOT, "e2e/real/api-server.ts")], {
    cwd: ROOT,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      NODE_ENV: "test",
      E2E_RUN: run,
      E2E_ADMIN_DATABASE_URL: ADMIN_DATABASE_URL,
      PORT: String(API_PORT),
      PRIVY_APP_ID,
      PRIVY_VERIFICATION_KEY: await exportSPKI(publicKey),
      E2E_SIGNING_JWK: JSON.stringify(privateJwk),
      REDIS_URL: redisUrl,
      WEB_ORIGIN: origins.join(","),
      APP_ORIGIN: `http://localhost:${REAL_PORTS.web}`,
      STORAGE_ROOT: path.join(os.tmpdir(), `opencast-e2e-${run}`),
      E2E_SEED_FILE: seedFile,
      E2E_STATE_FILE: STATE_FILE,
      E2E_PARENT_PID: String(o.parentPid ?? process.pid)
    }
  });
  closeSync(log);
  let exited: number | null = null;
  child.on("exit", (code) => (exited = code ?? 1));

  const deadline = Date.now() + 180_000;
  while (!(await up(`${API_BASE}/e2e/ready`))) {
    if (exited !== null) throw new Error(`The e2e API stopped (exit ${exited}) before it was ready. ${logFile}:\n${tail(logFile)}`);
    if (Date.now() > deadline) {
      child.kill("SIGTERM");
      throw new Error(`The e2e API wasn't ready in 3 minutes. ${logFile}:\n${tail(logFile)}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const seed = JSON.parse(readFileSync(seedFile, "utf8")) as Seed;
  rmSync(seedFile, { force: true });
  const state: RunState = { run, database: `opencast_e2e_${run}`, apiBase: API_BASE, redisUrl, privateJwk, seed, apiPid: child.pid };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  child.unref();
  return state;
}

/** Stops the API (it drops its database on the way out) and forgets the run. */
export async function stopRun(): Promise<void> {
  if (!existsSync(STATE_FILE)) return;
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as RunState;
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  if (state.apiPid && alive(state.apiPid)) {
    // Say so if anything tried to reach outside this machine (the API refused it).
    const r = await fetch(`${API_BASE}/e2e/ready`).then((x) => x.json() as Promise<{ outside?: string[] }>).catch(() => null);
    if (r?.outside?.length) console.warn(`[real] the API refused requests to ${[...new Set(r.outside)].join(", ")}: the real-API runs never call outside services`);
    process.kill(state.apiPid, "SIGTERM");
    const deadline = Date.now() + 20_000;
    while (alive(state.apiPid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    if (alive(state.apiPid)) process.kill(state.apiPid, "SIGKILL");
  }
  // If the API couldn't drop it (killed, crashed), drop it here.
  const pg = (await import("pg")).default;
  const c = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await c.connect();
  try {
    await c.query(`DROP DATABASE IF EXISTS ${state.database} WITH (FORCE)`);
  } finally {
    await c.end();
  }
  rmSync(STATE_FILE, { force: true });
}
