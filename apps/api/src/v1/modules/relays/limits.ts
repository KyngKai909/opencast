// Restarts for platform limits (follow-up Phase 3). Pure: what the relay runner schedules.
//
// Each platform caps how long one broadcast can run, and the limits change, so they're a rule in
// the registry (`relays.platform_limits`, Open): Twitch 48 hours (a restart is required), YouTube
// no limit but only broadcasts under 12 hours are saved (with "Save relays as YouTube videos" on,
// roll about every 11 hours), Facebook 8 hours (automatic only when connected by signing in;
// otherwise the station is told when it's due), Kick and others none known.
//
// Every restart is timed to a break: during the station ID in the last break before the limit (in
// the last `windowHours`, `marginMinutes` to spare), so the few seconds of reconnection never land
// inside a program. If a live block runs past that window, the first break after it ends, still
// inside the limit.

import type { RelayPlatformKind } from "@opencast/contracts";
import { clockTime, localDate } from "../../lib/time.js";

export interface PlatformLimit {
  platform: string;
  maxHours: number | null;
  savesUnderHours: number | null;
  rollEveryHours: number | null;
  restartNeedsSignIn: boolean;
}

export interface Limits {
  platforms: Map<string, PlatformLimit>;
  windowHours: number;
  marginMinutes: number;
}

type RuleValue = {
  platforms: Array<{ platform: string; maxHours: number | null; savesUnderHours: number | null; rollEveryHours?: number | null; restartNeedsSignIn?: boolean }>;
  restart?: { windowHours: number; marginMinutes: number };
};

/** The rule's value, with fields a stored version predates read from the fallback (by platform). */
export function limitsFrom(value: RuleValue, fallback: RuleValue): Limits {
  const known = new Map(fallback.platforms.map((p) => [p.platform, p]));
  const platforms = new Map<string, PlatformLimit>();
  for (const p of value.platforms) {
    const f = known.get(p.platform);
    platforms.set(p.platform, {
      platform: p.platform,
      maxHours: p.maxHours,
      savesUnderHours: p.savesUnderHours,
      rollEveryHours: p.rollEveryHours !== undefined ? p.rollEveryHours : (f?.rollEveryHours ?? null),
      restartNeedsSignIn: p.restartNeedsSignIn ?? f?.restartNeedsSignIn ?? false
    });
  }
  const restart = value.restart ?? fallback.restart ?? { windowHours: 2, marginMinutes: 15 };
  return { platforms, windowHours: restart.windowHours, marginMinutes: restart.marginMinutes };
}

export interface RestartNeed {
  reason: "limit" | "save_video";
  /** Where the restart aims: the limit less the margin, or YouTube's roll. */
  aim: Date;
  /** The broadcast's limit: the restart is always before it. */
  deadline: Date;
  /** Opencast does it (false: the station is told when it's due). */
  automatic: boolean;
}

/** Whether a platform's current broadcast needs a restart, and by when. Null: no known limit. */
export function restartNeed(
  dest: { kind: RelayPlatformKind; connected: boolean; limitHours?: number | null },
  startedAt: Date,
  limits: Limits,
  station: { saveYoutubeVideos: boolean }
): RestartNeed | null {
  const rule = limits.platforms.get(dest.kind);
  const margin = limits.marginMinutes * 60_000;
  const maxHours = dest.limitHours ?? rule?.maxHours ?? null;
  const automatic = !(rule?.restartNeedsSignIn && !dest.connected);
  if (maxHours) {
    const deadline = new Date(startedAt.getTime() + maxHours * 3_600_000);
    return { reason: "limit", aim: new Date(deadline.getTime() - margin), deadline, automatic };
  }
  if (rule?.savesUnderHours && rule.rollEveryHours && station.saveYoutubeVideos && dest.kind === "youtube") {
    const deadline = new Date(startedAt.getTime() + rule.savesUnderHours * 3_600_000);
    const aim = new Date(Math.min(startedAt.getTime() + rule.rollEveryHours * 3_600_000, deadline.getTime() - margin));
    return { reason: "save_video", aim, deadline, automatic };
  }
  return null;
}

export interface BreakMoment {
  id: string | null;
  startsAt: Date;
  endsAt: Date;
  /** The break has a station ID (a cadence can leave it out of some breaks). */
  stationId: boolean;
}

export interface Span {
  startsAt: Date;
  endsAt: Date;
}

export interface RestartPlan {
  at: Date;
  duringBreak: boolean;
  breakId: string | null;
  /** How it was chosen, for the log. */
  why: "last_break" | "after_live" | "earlier_break" | "no_break";
}

/** A break's station ID: the break's last seconds (it closes the break). */
export const stationIdMoment = (b: BreakMoment, sidMs: number) => new Date(Math.max(b.startsAt.getTime(), b.endsAt.getTime() - sidMs));

/**
 * When to restart: during the station ID in the last break before the aim (within `windowHours`,
 * outside live blocks). If a live block runs past the aim, the first break after it ends, still
 * inside the limit (2 minutes to spare). Then an earlier break (within three windows of the aim);
 * with none, at the aim (planned again at every check, so a break the log adds later is taken).
 */
export function planRestart(need: RestartNeed, breaks: BreakMoment[], lives: Span[], options: { now: Date; windowHours: number; sidMs: number }): RestartPlan {
  const now = options.now.getTime();
  const aim = need.aim.getTime();
  const hard = need.deadline.getTime() - 2 * 60_000;
  const windowStart = aim - options.windowHours * 3_600_000;
  const inLive = (t: number) => lives.some((l) => l.startsAt.getTime() <= t && t < l.endsAt.getTime());
  // Breaks with a station ID first; any break if none has one.
  const withId = breaks.filter((b) => b.stationId);
  const pool = withId.length ? withId : breaks;
  const moments = pool
    .map((b) => ({ b, t: stationIdMoment(b, options.sidMs).getTime() }))
    .filter((m) => m.t > now && !inLive(m.t))
    .sort((a, b) => a.t - b.t);
  const pick = (m: { b: BreakMoment; t: number }, why: RestartPlan["why"]): RestartPlan => ({ at: new Date(m.t), duringBreak: true, breakId: m.b.id, why });

  // A live block running past the ideal window: the first break after it ends, inside the limit.
  const across = lives.find((l) => l.startsAt.getTime() < aim && l.endsAt.getTime() > aim);
  if (across) {
    const after = moments.find((m) => m.t >= across.endsAt.getTime() && m.t <= hard);
    if (after) return pick(after, "after_live");
  }
  const inWindow = moments.filter((m) => m.t >= windowStart && m.t <= aim);
  if (inWindow.length) return pick(inWindow[inWindow.length - 1], "last_break");
  // An earlier break, not too early (a log that doesn't reach the window yet is planned again as it fills).
  const earlier = moments.filter((m) => m.t < windowStart && m.t >= aim - 3 * options.windowHours * 3_600_000);
  if (earlier.length) return pick(earlier[earlier.length - 1], "earlier_break");
  return { at: new Date(Math.max(now, Math.min(aim, hard))), duringBreak: false, breakId: null, why: "no_break" };
}

const NAMES: Record<RelayPlatformKind, string> = { youtube: "YouTube", twitch: "Twitch", facebook: "Facebook", kick: "Kick", custom: "Your RTMP destination" };

/** "YouTube", "Twitch", … */
export const platformName = (kind: RelayPlatformKind, name?: string | null) => (kind === "custom" ? (name ?? NAMES.custom) : NAMES[kind]);

/**
 * "Twitch restarts Saturday at 11:59 pm, during a break" (the weekday within a week either way,
 * today's included; further out "October 9 at 11:59 pm"). A restart the station does: "Facebook needs a
 * restart by Saturday at 11:59 pm. Restart it there, during a break".
 */
export function restartLabel(input: { kind: RelayPlatformKind; name?: string | null; at: Date; deadline: Date; duringBreak: boolean; automatic: boolean; status: string }, timezone: string, now: Date): string {
  const who = platformName(input.kind, input.name);
  const when = (at: Date) => {
    const days = Math.round((Date.parse(localDate(at, timezone)) - Date.parse(localDate(now, timezone))) / 86_400_000);
    const day = days > -7 && days < 7 ? new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(at) : new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "long", day: "numeric" }).format(at);
    return `${day} at ${clockTime(at, timezone)}`;
  };
  if (!input.automatic) return `${who} needs a restart by ${when(input.deadline)}. Restart it there, during a break`;
  if (input.status === "done") return `${who} restarted ${when(input.at)}${input.duringBreak ? ", during a break" : ""}`;
  if (input.status === "failed") return `${who} couldn't restart ${when(input.at)}`;
  return `${who} restarts ${when(input.at)}${input.duringBreak ? ", during a break" : ""}`;
}
