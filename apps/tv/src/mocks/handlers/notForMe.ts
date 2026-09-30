// Watch data in TV mode's mock (follow-up Phase 1, 2026-09-29): the apps' public switches
// (`GET /config`) and the "Not for me" vote. "Not for me" is off, as the rules registry starts it,
// unless the TV's address turns it on (read once at start, like the other mock switches):
//   ?notForMe=on   the menu offers "Not for me" (the e2e flow uses it)
// A vote is tied to the player's session, never the person: one per session per airing, taken
// whether or not the switch is on; something has to be on (a station signed off by `?offAir=`, or
// in its planned off air, answers 409 `nothing_on`).

import { http } from "msw";
import { audienceApi, configApi } from "@opencast/contracts";
import { now } from "../../lib/clock";
import { nowNext } from "../fixtures/schedule";
import { syncStreamSignOff } from "../fixtures/signoff";
import { stationById } from "../fixtures/stations";
import { fail, path, reply } from "../respond";
import { switches } from "./watching";

/** The address's `notForMe` switch: on, or off (the registry's default). */
export function notForMeAsked(search: string): boolean {
  const v = new URLSearchParams(search).get("notForMe")?.trim().toLowerCase();
  return !!v && ["1", "on", "true", "yes"].includes(v);
}

const flag = { on: typeof window === "undefined" ? false : notForMeAsked(window.location.search) };

/** Tests turn it on and off. */
export function setNotForMe(on: boolean) {
  flag.on = on;
}

/** Votes (session:airing). */
const votes = new Set<string>();

/** Tests start from nothing. */
export function resetNotForMe() {
  votes.clear();
  flag.on = typeof window === "undefined" ? false : notForMeAsked(window.location.search);
}

export const notForMeHandlers = [
  http.get(path(configApi.getConfig), () => reply(configApi.getConfig.response, { features: { notForMe: flag.on } })),

  http.post(path(audienceApi.voteNotForMe), async ({ request, params }) => {
    const stationId = String(params.stationId);
    const body = audienceApi.voteNotForMe.body.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "bad_request", "Send the player's session.");
    const st = stationById(stationId);
    if (!st) return fail(404, "not_found", "That station wasn't found.");
    await syncStreamSignOff();
    const on = nowNext(stationId, now()).now;
    if (!on || on.offAir || switches.offAir.includes((st.ident.callSign ?? "").toUpperCase())) return fail(409, "nothing_on", "There's nothing on the log to vote on right now.");
    const key = `${body.data.sessionId}:${on.id}`;
    const status = votes.has(key) ? ("already_recorded" as const) : ("recorded" as const);
    votes.add(key);
    return reply(audienceApi.voteNotForMe.response, { ok: true, status });
  })
];
