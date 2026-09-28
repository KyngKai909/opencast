// spots, station side: open time in breaks (the rail's Breaks badge). The Money area owns this
// file (the spot market, rotations, sponsors, production orders).

import { http } from "msw";
import { spotsApi } from "@opencast/contracts";
import { stationBreaks } from "../db";
import { breakSlot } from "../fixtures/evening";
import { now } from "../../lib/clock";
import { needsUser, path, reply } from "../respond";

export const spotsHandlers = [
  http.get(path(spotsApi.getAvails), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const hours = Number(new URL(request.url).searchParams.get("hours") ?? 24);
    const from = now().toISOString();
    const to = new Date(Date.parse(from) + hours * 3600e3).toISOString();
    const breaks = stationBreaks(String(params.stationId), from, to).map(breakSlot);
    return reply(spotsApi.getAvails.response, {
      totalOpenMs: breaks.reduce((a, b) => a + b.openMs, 0),
      breaks: breaks.map((b) => ({ breakStartsAt: b.startsAt, context: b.context, lengthMs: b.lengthMs, openMs: b.openMs, producerShareMs: b.producerShareMs }))
    });
  })
];
