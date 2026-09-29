// Mock endpoints for Watching and menus. The dial as the TV's watching screen needs it:
// - a station signed off by the switch below gets planned off air as the contract has it (G9):
//   `now` is an "Off air" airing (kind "off_air", code OPEN) running until it's back (the next
//   6:00 am in the market, or its next airing if that's sooner), with `backAt` on the airing and
//   the row, so "CIVC 7.1 signs on again at 6:00 am" has a time to say. Planned off air in the
//   schedule (PREP's nights) comes from the shared dial handler already;
// - `signal` (S13): "standby" for a live block waiting for its signal, "ok" otherwise on air,
//   absent when the station isn't on air.
// Mock-only switches in the TV's address, read once at start:
//   ?offAir=CIVC   that station is signed off now (tv 05.2 at the reference moment)
//   ?standby=CIVC  that station is on air but waiting for its signal (the stand-by variant)
// The shared dial handler answers first; this patches its rows.

import { getResponse, http, HttpResponse } from "msw";
import { stationsApi } from "@opencast/contracts";
import { DialX as DialSchema, type DialRowX, type DialX } from "../../api/ext";
import { now } from "../../lib/clock";
import { path, reply } from "../respond";
import { dialHandlers } from "./dial";

/** The market's offset from UTC in the mock (Pacific daylight time, as the fixtures use). */
const OFFSET_HOURS = 7;

/** The next 6:00 am in the market after `t`. */
export function nextSixAm(t: Date): string {
  const local = new Date(t.getTime() - OFFSET_HOURS * 3600e3);
  let at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 6 + OFFSET_HOURS, 0);
  if (at <= t.getTime()) at += 86_400_000;
  return new Date(at).toISOString();
}

export interface Switches {
  offAir: string[];
  standby: string[];
}

function readSwitches(): Switches {
  if (typeof window === "undefined") return { offAir: [], standby: [] };
  const q = new URLSearchParams(window.location.search);
  const list = (k: string) => (q.get(k) ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  return { offAir: list("offAir"), standby: list("standby") };
}

const switches = readSwitches();

/** One row as the watching screen gets it. */
export function patchRow(r: DialRowX, t: Date, sw: Switches): DialRowX {
  const cs = (r.station.callSign ?? "").toUpperCase();
  let row: DialRowX = { ...r, signal: "ok" };
  if (sw.offAir.includes(cs)) {
    const six = nextSixAm(t);
    const back = row.next && row.next.startsAt < six ? row.next.startsAt : six;
    const now = { logEntryId: null, title: "Off air", episodeTitle: null, code: "OPEN" as const, kind: "off_air" as const, startsAt: t.toISOString(), endsAt: back, live: false, carriedFrom: null, programId: null, backAt: back };
    row = { ...row, onAir: false, playback: null, now, backAt: back };
  }
  // The contract leaves `signal` out when the station isn't on air.
  if (!row.onAir) delete row.signal;
  if (row.onAir && sw.standby.includes(cs)) row = { ...row, signal: "standby" };
  return row;
}

export function patchDial(d: DialX, t: Date, sw: Switches): DialX {
  return { ...d, rows: d.rows.map((r) => patchRow(r, t, sw)) };
}

export const watchingHandlers = [
  http.get(path(stationsApi.getDial), async ({ request }) => {
    const res = await getResponse(dialHandlers, request.clone());
    if (!res || !res.ok) return res ?? HttpResponse.json({ error: { code: "not_found", message: "That market wasn't found." } }, { status: 404 });
    const body = DialSchema.parse(await res.json());
    return reply(DialSchema, patchDial(body, now(), switches));
  })
];
