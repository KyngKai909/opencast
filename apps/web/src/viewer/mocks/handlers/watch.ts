// Watch data in the viewer's mock (added 2026-09-29, follow-up Phase 1): the apps' public switches
// (`GET /config`: "Not for me" is off until it's turned on in the desk's Settings, Rules, Features,
// as the API reads the registry) and the "Not for me" vote, taken whether or not the control shows.
// A vote is tied to the player's session (the one its heartbeats carry), never to the person: one
// per session per airing; a session is one station's, and something has to be on.
// Mock-only switch in the app's address, read once at start: `?notForMe=on` turns the control on
// for this page whatever the desk's rule says (the e2e flow uses it); `?notForMe=off` turns it off.

import { http } from "msw";
import { audienceApi, configApi, RULES } from "@opencast/contracts";
import { now } from "../../../lib/clock";
import { valueAt } from "../../../desk/mocks/settingsDb";
import { nowNext } from "../fixtures/schedule";
import { syncStreamSignOff } from "../fixtures/signoff";
import { fail, path, reply } from "../respond";

/** Sessions the heartbeat has seen (session → station), and votes (session:airing). */
const sessions = new Map<string, string>();
const votes = new Set<string>();

/** The heartbeat's session, remembered for votes (me.ts calls it). */
export function rememberSession(sessionId: string, stationId: string) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, stationId);
}

/** Tests start from nothing. */
export function resetWatch() {
  sessions.clear();
  votes.clear();
}

/** The address's `notForMe` switch: true, false, or null to follow the desk's rule. */
export function notForMeAsked(search: string): boolean | null {
  const v = new URLSearchParams(search).get("notForMe")?.trim().toLowerCase();
  if (!v) return null;
  return ["1", "on", "true", "yes"].includes(v) ? true : ["0", "off", "false", "no"].includes(v) ? false : null;
}

const asked = typeof window === "undefined" ? null : notForMeAsked(window.location.search);

export function notForMeOn(): boolean {
  if (asked !== null) return asked;
  try {
    return (valueAt("features.not_for_me") as { enabled: boolean }).enabled;
  } catch {
    return RULES["features.not_for_me"].fallback.enabled;
  }
}

export const watchHandlers = [
  http.get(path(configApi.getConfig), () => reply(configApi.getConfig.response, { features: { notForMe: notForMeOn() } })),

  http.post(path(audienceApi.voteNotForMe), async ({ request, params }) => {
    const stationId = String(params.stationId);
    const body = audienceApi.voteNotForMe.body.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "bad_request", "Send the player's session.");
    if (sessions.get(body.data.sessionId) !== stationId) return fail(400, "bad_request", "Tune in to this station first.", { sessionId: "Not a session on this station" });
    await syncStreamSignOff();
    const on = nowNext(stationId, now()).now;
    if (!on || on.offAir) return fail(409, "nothing_on", "There's nothing on the log to vote on right now.");
    const key = `${body.data.sessionId}:${on.id}`;
    const status = votes.has(key) ? ("already_recorded" as const) : ("recorded" as const);
    votes.add(key);
    return reply(audienceApi.voteNotForMe.response, { ok: true, status });
  })
];
