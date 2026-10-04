// External stations' checks (follow-up Phase 6), on the leader only: every minute each listing's
// stream playlist (or embed) is fetched once, lightly (a small request with a 5-second timeout,
// never a segment); 5 minutes down takes it off the dial until it's back, and the Network desk
// hears both times (network/external.ts). 2026-10-03: the schedule pass runs every minute too, but
// reads only the feeds that are due: each hourly, or every 2 minutes while a listing has nothing
// stored past the next 5 minutes (a feed of what's on now only). Its counts are logged hourly;
// a failure or a channel freed is logged when it happens.
// Apart from the playout tick, so a slow source never holds up a channel.

import type { createV1 } from "@opencast/api/runtime";

type Services = ReturnType<typeof createV1>["services"];

const CHECK_EVERY_MS = 60_000;
const LOG_SYNCED_EVERY_MS = 60 * 60_000;

/** Starts the checks; `isLeader` is asked before each round. Returns a stop function. */
export function startExternalChecks(services: Services, isLeader: () => boolean, log: (line: string) => void = console.log): () => void {
  let running = false;
  let synced = 0;
  let lastLogged = 0;
  const round = async () => {
    if (running || !isLeader()) return;
    running = true;
    try {
      const checked = await services.network.checkExternalStations();
      if (checked.hidden || checked.back || checked.down) log(`[worker] external stations ${JSON.stringify(checked)}`);
      const pass = await services.network.syncExternalSchedules();
      // A223: the same pass frees channels held 90 days after signing off for good (external and full stations).
      synced += pass.synced;
      if (pass.failed || pass.released || pass.releasedStations || (synced && Date.now() - lastLogged >= LOG_SYNCED_EVERY_MS)) {
        log(`[worker] external schedules ${JSON.stringify({ ...pass, synced })}`);
        synced = 0;
        lastLogged = Date.now();
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
