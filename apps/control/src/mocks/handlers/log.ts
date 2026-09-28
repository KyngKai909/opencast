// log and playout: tonight's log with its breaks and dead air, the status the tally reads.
// The On air area owns this file (sign-on, the log's changes, cue a break, sign off).

import { http } from "msw";
import { logApi, playoutApi } from "@opencast/contracts";
import { dbStation, stationBreaks, stationLog } from "../db";
import { breakSlot } from "../fixtures/evening";
import { now } from "../../lib/clock";
import { fail, needsUser, path, reply } from "../respond";

/** Time with nothing on the log, between `from` and `to`. */
export function gapsIn(stationId: string, from: string, to: string) {
  const gaps: { startsAt: string; endsAt: string }[] = [];
  let cursor = from;
  for (const e of stationLog(stationId, from, to)) {
    if (e.startsAt > cursor) gaps.push({ startsAt: cursor, endsAt: e.startsAt });
    if (e.endsAt > cursor) cursor = e.endsAt;
  }
  // Breaks between programs aren't gaps: close up anything shorter than five minutes.
  const real = gaps.filter((g) => Date.parse(g.endsAt) - Date.parse(g.startsAt) >= 5 * 60_000);
  if (cursor < to) real.push({ startsAt: cursor, endsAt: to });
  return real;
}

export const logHandlers = [
  http.get(path(playoutApi.getStatus), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const st = dbStation(String(params.stationId));
    if (!st) return fail(404, "not_found", "That station wasn't found.");
    const t = now().toISOString();
    const current = stationLog(st.ident.id).find((e) => e.startsAt <= t && t < e.endsAt) ?? null;
    const nextBreak = stationBreaks(st.ident.id).find((b) => b.startsAt > t) ?? null;
    return reply(playoutApi.getStatus.response, {
      onAir: st.onAir,
      now: st.onAir && current ? { title: current.title, code: current.code, startedAt: current.startsAt, itemId: current.itemId } : null,
      lastError: null,
      output: { livepeerEnabled: false, playbackUrl: st.onAir ? `/mock-hls/${(st.ident.callSign ?? "beat").toLowerCase()}/master.m3u8` : null },
      nextBreakAt: nextBreak?.startsAt ?? null
    });
  }),

  http.get(path(logApi.getLog), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const q = new URL(request.url).searchParams;
    const from = q.get("from")!;
    const to = q.get("to")!;
    return reply(logApi.getLog.response, {
      from,
      to,
      entries: stationLog(id, from, to),
      breaks: stationBreaks(id, from, to).map(breakSlot),
      gaps: gapsIn(id, from, to)
    });
  }),

  http.get(path(logApi.getDeadAir), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const from = now().toISOString();
    const to = new Date(Date.parse(from) + 24 * 3600e3).toISOString();
    const gaps = gapsIn(id, from, to);
    const last = stationLog(id).at(-1);
    return reply(logApi.getDeadAir.response, { gaps, nextGapAt: gaps[0]?.startsAt ?? null, logRunsUntil: last?.endsAt ?? null, warnings: [] });
  })
];

