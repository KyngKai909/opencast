// "Tuned in": players send a heartbeat every 30 seconds while tuned in, with the station and a
// session id (POST /v1/heartbeat). Stations see the count; viewers never do.

import type { Platform, TuneVia } from "@opencast/contracts";
import type { PlayerEngine } from "./engine/PlayerEngine";

export interface HeartbeatBody {
  stationId: string;
  sessionId: string;
  platform: Platform;
  mediaTimeMs: number;
  playing: boolean;
  /** A251: the device's id (deviceId()), for counts of devices; never tied to an account. */
  deviceId?: string;
  /** A251: on a station's first beat, how it was tuned and how long the picture took. */
  via?: TuneVia;
  tuneMs?: number;
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

const DEVICE_KEY = "oc-device";

/**
 * A251 (2026-10-06): a random id kept on the device (this browser, this app), for the desk's counts
 * of devices. Not the person and never tied to an account; the API keeps only a hash of it. Null
 * where the device can't keep it (private browsing): those beats count as sessions only.
 */
export function deviceId(): string | null {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id = globalThis.crypto?.randomUUID?.();
    if (!id) return null;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return null;
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
 * API can tell the two apart; or an external station's embed on screen) and waits as long as the
 * API asks. During a station's planned off air (the answer has `offAirUntil`) it stops beating for
 * that station until `nextInMs` has passed, even if you tune away and back. Returns a stop function.
 */
export function startHeartbeat(engine: PlayerEngine, send: SendHeartbeat, platform: Platform, session = sessionId(), device: string | null = deviceId()): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** A251: the station whose first beat is still to go (it carries how it was tuned). */
  let firstFor: string | null = null;
  let stopped = false;
  /** Stations off air on a schedule, and when (Date.now()) to try them again. */
  const quiet = new Map<string, number>();
  // An external station's official embed (follow-up Phase 6) is the source's own player: Opencast
  // can't see its picture, so its time on screen stands for media time (labelled external by the API).
  let embedSince: { stationId: string; at: number } | null = null;
  const beat = async () => {
    if (stopped) return;
    const s = engine.getState();
    let next = INTERVAL_MS;
    const until = s.currentId ? quiet.get(s.currentId) : undefined;
    if (until !== undefined && Date.now() < until) next = until - Date.now();
    else if (s.currentId && (s.status === "playing" || s.status === "paused" || s.status === "embed")) {
      const stationId = s.currentId;
      quiet.delete(stationId);
      const embed = s.status === "embed";
      if (embed && embedSince?.stationId !== stationId) embedSince = { stationId, at: Date.now() };
      const mediaTimeMs = embed ? Date.now() - embedSince!.at : engine.mediaTimeMs();
      try {
        const tune = firstFor === stationId && s.lastTune?.stationId === stationId ? s.lastTune : null;
        const first = firstFor === stationId;
        firstFor = null;
        const r = await send({
          stationId,
          sessionId: session,
          platform,
          mediaTimeMs,
          playing: s.status !== "paused",
          ...(device ? { deviceId: device } : {}),
          ...(first && tune?.via ? { via: tune.via } : {}),
          ...(first && tune ? { tuneMs: Math.max(0, tune.ms) } : {})
        });
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
    if (s.currentId !== lastId && (s.status === "playing" || s.status === "embed")) {
      lastId = s.currentId;
      firstFor = s.currentId;
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
