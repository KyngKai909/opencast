// "Tuned in": players send a heartbeat every 30 seconds while tuned in, with the station and a
// session id (POST /v1/heartbeat). Stations see the count; viewers never do.

import type { Platform } from "@opencast/contracts";
import type { PlayerEngine } from "./engine/PlayerEngine";

export interface HeartbeatBody {
  stationId: string;
  sessionId: string;
  platform: Platform;
  mediaTimeMs: number;
  playing: boolean;
}

/**
 * The API's answer: when to beat next, and, during the station's planned off air (G9),
 * `offAirUntil`: the beat wasn't counted, and `nextInMs` runs until the station is back.
 */
export type SendHeartbeat = (body: HeartbeatBody) => Promise<{ nextInMs?: number; offAirUntil?: string } | void>;

const INTERVAL_MS = 30_000;
const SESSION_KEY = "oc-player-session";

/** A random id kept for the session (the tab, the TV app's run), never tied to an account. */
export function sessionId(): string {
  const make = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = make();
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return make();
  }
}

/** Sends to the API: `${apiBase}/v1/heartbeat`. */
export function httpHeartbeat(apiBase: string): SendHeartbeat {
  const url = `${apiBase.replace(/\/+$/, "")}/v1/heartbeat`;
  return async (body) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true });
    if (!res.ok) return;
    return (await res.json()) as { nextInMs?: number };
  };
}

/**
 * Starts the heartbeat for an engine. It beats while a station is tuned (playing or paused, so the
 * API can tell the two apart) and waits as long as the API asks. During a station's planned off air
 * (the answer has `offAirUntil`) it stops beating for that station until `nextInMs` has passed,
 * even if you tune away and back. Returns a stop function.
 */
export function startHeartbeat(engine: PlayerEngine, send: SendHeartbeat, platform: Platform, session = sessionId()): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  /** Stations off air on a schedule, and when (Date.now()) to try them again. */
  const quiet = new Map<string, number>();
  const beat = async () => {
    if (stopped) return;
    const s = engine.getState();
    let next = INTERVAL_MS;
    const until = s.currentId ? quiet.get(s.currentId) : undefined;
    if (until !== undefined && Date.now() < until) next = until - Date.now();
    else if (s.currentId && (s.status === "playing" || s.status === "paused")) {
      const stationId = s.currentId;
      quiet.delete(stationId);
      try {
        const r = await send({ stationId, sessionId: session, platform, mediaTimeMs: engine.mediaTimeMs(), playing: s.status === "playing" });
        if (r && typeof r.nextInMs === "number" && r.nextInMs > 0) next = r.nextInMs;
        if (r && r.offAirUntil) quiet.set(stationId, Date.now() + next);
      } catch {
        // A missed beat isn't worth interrupting anyone for; the next one goes as usual.
      }
    }
    if (!stopped) timer = setTimeout(beat, next);
  };
  // The first beat goes once the first picture is on screen.
  let lastId: string | null = null;
  const unsub = engine.subscribe(() => {
    const s = engine.getState();
    if (s.currentId !== lastId && s.status === "playing") {
      lastId = s.currentId;
      if (timer) clearTimeout(timer);
      void beat();
    }
  });
  return () => {
    stopped = true;
    unsub();
    if (timer) clearTimeout(timer);
  };
}
