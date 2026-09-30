// Viewers for watch data tests and the Phase 1 STOP demo: each tunes in and out on the frozen clock
// through the audience service's own heartbeat (so the tuned-in rules and bot flags are the real
// ones). A viewer beats when it tunes in, 30 seconds later, then once a minute (a player beats every
// 30 seconds; the count is once a minute either way, so this halves the work and counts the same).
import { randomUUID } from "node:crypto";
import type { Harness } from "./harness.js";

type Platform = "phone" | "cast" | "web" | "tv_app" | "mirror";

export interface SimViewer {
  sessionId?: string;
  stationId: string;
  /** Tunes in at (a first beat), and stops beating after `to`. */
  from: string;
  to: string;
  platform?: Platform;
  /**
   * `fast`: a script beating every 5 seconds (flagged at its second beat, never counted).
   * `jump`: plays normally, then its media time jumps 10 minutes at `jumpAt` (flagged then; the
   * minutes it counted before stay in the station's tuned-in count, but watch data leaves it out).
   */
  bot?: "fast" | "jump";
  jumpAt?: string;
}

interface Beat {
  at: number;
  sessionId: string;
  stationId: string;
  platform: Platform;
  mediaTimeMs: number;
}

const PLATFORMS: Platform[] = ["phone", "tv_app", "web", "cast", "phone", "web"];

export function beatsOf(viewer: SimViewer, index = 0): Beat[] {
  const sessionId = viewer.sessionId ?? (viewer.sessionId = randomUUID());
  const start = Date.parse(viewer.from);
  const end = Date.parse(viewer.to);
  const platform = viewer.platform ?? PLATFORMS[index % PLATFORMS.length];
  const out: Beat[] = [];
  if (viewer.bot === "fast") {
    for (let t = start; t <= end; t += 5_000) out.push({ at: t, sessionId, stationId: viewer.stationId, platform, mediaTimeMs: t - start });
    return out;
  }
  const jump = viewer.jumpAt ? Date.parse(viewer.jumpAt) : Infinity;
  for (let t = start, k = 0; t <= end; t = start + 30_000 + k * 60_000, k++) {
    const jumped = t >= jump;
    out.push({ at: t, sessionId, stationId: viewer.stationId, platform, mediaTimeMs: t - start + (jumped ? 600_000 : 0) });
    if (jumped) break;
  }
  return out;
}

/**
 * Plays every viewer's beats in time order (those at the same moment together), leaving the clock
 * at the last. `events` run on the clock at their moment, between beats (votes, a look at the report).
 */
export async function simulate(h: Harness, viewers: SimViewer[], events: Array<{ at: string; run: () => Promise<unknown> }> = []): Promise<{ beats: number }> {
  const beats = viewers.flatMap((v, i) => beatsOf(v, i)).sort((a, b) => a.at - b.at);
  const queue = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const due = async (until: number) => {
    while (queue.length && Date.parse(queue[0].at) <= until) {
      const event = queue.shift()!;
      h.clock.set(event.at);
      await event.run();
    }
  };
  let i = 0;
  while (i < beats.length) {
    const at = beats[i].at;
    await due(at - 1);
    const batch: Beat[] = [];
    while (i < beats.length && beats[i].at === at) batch.push(beats[i++]);
    h.clock.set(new Date(at).toISOString());
    // A session's beats are never in one batch twice (one beat per session per moment).
    for (let j = 0; j < batch.length; j += 16) {
      await Promise.all(batch.slice(j, j + 16).map((b) => h.services.audience.heartbeat({ stationId: b.stationId, sessionId: b.sessionId, platform: b.platform, mediaTimeMs: b.mediaTimeMs, playing: true })));
    }
  }
  await due(Infinity);
  return { beats: beats.length };
}

/** `n` viewers alike. */
export const crowd = (n: number, viewer: Omit<SimViewer, "sessionId">): SimViewer[] => Array.from({ length: n }, () => ({ ...viewer }));
