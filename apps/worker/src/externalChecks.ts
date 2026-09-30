// External stations' checks (follow-up Phase 6), on the leader only: every minute each listing's
// stream playlist (or embed) is fetched once, lightly (a small request with a 5-second timeout,
// never a segment); 5 minutes down takes it off the dial until it's back, and the Network desk
// hears both times (network/external.ts). Every hour their schedule feeds are read again.
// Apart from the playout tick, so a slow source never holds up a channel.

import type { createV1 } from "@opencast/api/runtime";

type Services = ReturnType<typeof createV1>["services"];

const CHECK_EVERY_MS = 60_000;
const SYNC_EVERY_MS = 60 * 60_000;

/** Starts the checks; `isLeader` is asked before each round. Returns a stop function. */
export function startExternalChecks(services: Services, isLeader: () => boolean, log: (line: string) => void = console.log): () => void {
  let running = false;
  let lastSync = 0;
  const round = async () => {
    if (running || !isLeader()) return;
    running = true;
    try {
      const checked = await services.network.checkExternalStations();
      if (checked.hidden || checked.back || checked.down) log(`[worker] external stations ${JSON.stringify(checked)}`);
      if (Date.now() - lastSync >= SYNC_EVERY_MS) {
        lastSync = Date.now();
        const synced = await services.network.syncExternalSchedules();
        if (synced.synced || synced.failed) log(`[worker] external schedules ${JSON.stringify(synced)}`);
      }
    } catch (error) {
      console.error("[worker] external station checks failed", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void round(), CHECK_EVERY_MS);
  return () => clearInterval(timer);
}
