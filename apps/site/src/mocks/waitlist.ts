// The waitlist in mock mode: join and the call sign check, answered the way the API's waitlist
// module answers (apps/api/src/v1/modules/waitlist). Markets aren't open yet, as before launch.

import { http } from "msw";
import { CALL_SIGN_RULES_DEFAULT, callSignIdeas, callSignRefusal, waitlistApi } from "@opencast/contracts";
import { fail, path, reply } from "./respond";

const IE = { id: "00000000-0000-4000-8000-000000090001", slug: "inland-empire", name: "Inland Empire", timezone: "America/Los_Angeles", open: false };
const LA = { id: "00000000-0000-4000-8000-000000090002", slug: "los-angeles", name: "Los Angeles", timezone: "America/Los_Angeles", open: false };

/** ZIPs in a market; any other ZIP is outside every market (`market: null`). */
export const MOCK_ZIPS: Record<string, typeof IE> = {
  "92373": IE, "92374": IE, "92324": IE, "92335": IE, "92501": IE, "92507": IE, "92376": IE, "92336": IE,
  "90012": LA, "90026": LA, "90028": LA, "90291": LA
};

/** Call signs already held or on the air. */
export const TAKEN = new Set(["BEAT", "CIVC", "REEL", "SAZN", "NITE"]);

const VALID = /^[A-Z]{3,5}$/;

/** Free, allowed names in place of one that's taken or refused (the API's suggestions, as it orders them). */
const ideasFor = (callSign: string) => callSignIdeas(callSign).filter((i) => !TAKEN.has(i) && !callSignRefusal(i, CALL_SIGN_RULES_DEFAULT)).slice(0, 3);

export const handlers = [
  http.get(path(waitlistApi.checkCallSign), ({ params }) => {
    const callSign = String(params.callSign).toUpperCase();
    const valid = VALID.test(callSign);
    // Names Opencast won't allow (2026-09-29), with the registry's first rules.
    const refusal = valid ? callSignRefusal(callSign, CALL_SIGN_RULES_DEFAULT) : null;
    const available = valid && !refusal && !TAKEN.has(callSign);
    return reply(waitlistApi.checkCallSign.response, { callSign, valid, available, reservable: available, heldForYou: false, refusal, suggestions: valid && !available ? ideasFor(callSign) : [] });
  }),

  http.post(path(waitlistApi.join), async ({ request }) => {
    const parsed = waitlistApi.join.body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join(".") || "body"] = issue.message;
      return fail(400, "bad_request", `Check the form: ${parsed.error.issues[0]?.message ?? "invalid"}.`, fields);
    }
    const body = parsed.data;
    const refusal = body.callSign ? callSignRefusal(body.callSign, CALL_SIGN_RULES_DEFAULT) : null;
    if (body.callSign && refusal) {
      const ideas = ideasFor(body.callSign).slice(0, 2);
      return fail(422, "call_sign_refused", `${refusal.reason}${ideas.length ? ` Try ${ideas.join(" or ")}.` : " Try another."}`, { callSign: refusal.reason });
    }
    if (body.callSign && TAKEN.has(body.callSign)) return fail(409, "call_sign_taken", `${body.callSign} is taken. Try another.`);
    const message = {
      viewer: "You're on the list.",
      station: body.callSign ? `${body.callSign} is on hold for you.` : "Your station is on the list.",
      producer: "Your programs are on the list.",
      business: "Your business is on the list."
    }[body.role];
    if (body.role === "station" && body.callSign) TAKEN.add(body.callSign);
    return reply(
      waitlistApi.join.response,
      { role: body.role, market: MOCK_ZIPS[body.zip] ?? null, message, heldCallSign: body.role === "station" ? (body.callSign ?? null) : null },
      201
    );
  })
];
