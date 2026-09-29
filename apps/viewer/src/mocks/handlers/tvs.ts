// TVs on the account and the phone remote's relay (B2), in the API's words: Your TVs (listTvs,
// signOutTv), signing a TV in by its code (approveTvCode), remembering cast targets
// (recordCastTarget), and a guest's phone pairing with a TV's 4-digit code (pairPhone). The relay's
// stream and commands don't come here: dev:mock's relay reaches TV mode through its bridge page
// (cast/mockRelay.ts).

import { http } from "msw";
import { tvApi, type Tv } from "@opencast/contracts";
import { now } from "../../lib/clock";
import { DEN_TV_ID, getDb, saveDb, type DbTv } from "../db";
import { uid } from "../fixtures/stations";
import { fail, MOCK_TOKEN, path, reply } from "../respond";

/** The pair code Den TV shows in the mock (Settings, Remote and phones). */
export const MOCK_PAIR_CODE = "4821";

// The API's words (apps/api/src/v1/modules/tv).
const WRONG_CODE = "That code isn't right, or it's run out. Check the code on the TV.";
const USED_CODE = "That code has been used. The TV will show a new one.";
const TOO_MANY = "Too many wrong codes. Wait a few minutes and try again.";

/** Mock state that isn't worth keeping over a reload: codes used and wrong tries. */
const tries = { signIn: 0, pair: 0, used: new Set<string>() };

export function resetTvMockForTests() {
  tries.signIn = 0;
  tries.pair = 0;
  tries.used.clear();
}

function tvsView(): Tv[] {
  return getDb().tvs.map((t) => tvApi.listTvs.response.element.parse(t));
}

const signedIn = (request: Request) => request.headers.get("authorization") === `Bearer ${MOCK_TOKEN}`;
const needsUser = (request: Request) => (signedIn(request) ? null : fail(401, "unauthorized", "Sign in to do that."));

export const tvHandlers = [
  http.get(path(tvApi.listTvs), ({ request }) => needsUser(request) ?? reply(tvApi.listTvs.response, tvsView())),

  http.delete(path(tvApi.signOutTv), ({ request, params }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const db = getDb();
    const tv = db.tvs.find((t) => t.id === params.tvId);
    if (!tv) return fail(404, "not_found", "That TV wasn't found.");
    db.tvs = db.tvs.filter((t) => t.id !== tv.id);
    saveDb();
    return reply(tvApi.signOutTv.response, tvsView());
  }),

  http.post(path(tvApi.approveTvCode), ({ request, params }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    if (tries.signIn >= 10) return fail(429, "too_many_tries", TOO_MANY);
    const code = String(params.code).replace(/[\s-]/g, "").toUpperCase();
    // Any six letters or digits sign a TV in, except 000000 (wrong) and a code already used.
    if (!/^[A-Z0-9]{6}$/.test(code) || code === "000000") {
      tries.signIn++;
      return fail(404, "code_not_found", WRONG_CODE);
    }
    if (tries.used.has(code)) return fail(409, "code_used", USED_CODE);
    tries.used.add(code);
    const db = getDb();
    const tv: DbTv = { id: uid(70000 + db.tvs.length + Math.floor(Math.random() * 9000)), name: "Android TV", kind: "tv_app", platform: "android_tv", signedIn: true, lastUsedAt: now().toISOString(), online: false, castingNow: false };
    db.tvs.push(tv);
    saveDb();
    return reply(tvApi.approveTvCode.response, tv);
  }),

  http.post(path(tvApi.recordCastTarget), async ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const body = tvApi.recordCastTarget.body.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "validation", "Check the TV's name.");
    const db = getDb();
    const at = now().toISOString();
    // The same name again, any case, is the same target, marked used now.
    const same = db.tvs.find((t) => t.kind === body.data.kind && t.name.toLowerCase() === body.data.name.toLowerCase());
    const tv: DbTv = same ?? { id: uid(80000 + db.tvs.length + Math.floor(Math.random() * 9000)), name: body.data.name, kind: body.data.kind, platform: null, signedIn: false, lastUsedAt: at, online: false, castingNow: false };
    tv.lastUsedAt = at;
    if (!same) db.tvs.push(tv);
    saveDb();
    return reply(tvApi.recordCastTarget.response, tv, 201);
  }),

  // A guest's phone (signed in or not) pairs with the TV showing the code. TV mode's mock knows its
  // codes, so it's asked through the bridge (as the same phone the remote will be); when TV mode
  // doesn't answer, Den TV's first code, 4821, pairs.
  http.post(path(tvApi.pairPhone), async ({ request }) => {
    const body = tvApi.pairPhone.body.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "validation", "Enter the 4-digit code the TV shows.");
    if (tries.pair >= 10) return fail(429, "too_many_tries", TOO_MANY);
    if (import.meta.env.VITE_MOCK === "true" && typeof window !== "undefined") {
      const [{ sharedMockRelay }, { config }] = await Promise.all([import("../../cast/mockRelay"), import("../../config")]);
      const answer = await sharedMockRelay(config.tvUrl)
        .pair(body.data.code, body.data.name)
        .catch(() => null);
      if (answer && "phoneToken" in answer) return reply(tvApi.pairPhone.response, answer, 201);
      if (answer) {
        if (answer.code === "code_not_found") tries.pair++;
        return fail(answer.status, answer.code, answer.message);
      }
    }
    if (body.data.code !== MOCK_PAIR_CODE) {
      tries.pair++;
      return fail(404, "code_not_found", WRONG_CODE);
    }
    const phoneToken = `tvp_mock_${Math.random().toString(36).slice(2, 12)}`;
    return reply(tvApi.pairPhone.response, { tvId: DEN_TV_ID, tvName: "Den TV", phoneToken }, 201);
  })
];
