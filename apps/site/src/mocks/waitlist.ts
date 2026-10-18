// The waitlist in mock mode: join and the call-sign check, answered the way the API's waitlist
// module answers (apps/api/src/v1/modules/waitlist), with its rules from the contracts. Markets
// aren't open yet, as before launch. Taken: every call sign on the site's demo dial.
import { CALL_SIGN_RULES_DEFAULT, callSignIdeas, callSignRefusal } from "@contracts/callSigns";
import { waitlistApi } from "@contracts/waitlist";
import { DIAL_CALL_SIGNS } from "../data/dial";
import type { MockReply } from "../lib/api";

const IE = { id: "00000000-0000-4000-8000-000000090001", slug: "inland-empire", name: "Inland Empire", timezone: "America/Los_Angeles", open: false };
const LA = { id: "00000000-0000-4000-8000-000000090002", slug: "los-angeles", name: "Los Angeles", timezone: "America/Los_Angeles", open: false };

/** ZIPs in a market; any other ZIP is outside every market (`market: null`). */
export const MOCK_ZIPS: Record<string, typeof IE> = {
  "92373": IE, "92374": IE, "92324": IE, "92335": IE, "92501": IE, "92507": IE, "92376": IE, "92336": IE,
  "90012": LA, "90026": LA, "90028": LA, "90291": LA
};

const taken = new Set(DIAL_CALL_SIGNS);
const VALID = /^[A-Z]{3,5}$/;
const ideasFor = (cs: string) => callSignIdeas(cs).filter((i) => !taken.has(i) && !callSignRefusal(i, CALL_SIGN_RULES_DEFAULT)).slice(0, 3);
const fail = (status: number, code: string, message: string, fields?: Record<string, string>): MockReply => ({ status, json: { error: { code, message, ...(fields ? { fields } : {}) } } });

export function checkCallSign(raw: string): MockReply {
  const callSign = raw.toUpperCase();
  const valid = VALID.test(callSign);
  const refusal = valid ? callSignRefusal(callSign, CALL_SIGN_RULES_DEFAULT) : null;
  const available = valid && !refusal && !taken.has(callSign);
  return { status: 200, json: waitlistApi.checkCallSign.response.parse({ callSign, valid, available, reservable: available, heldForYou: false, refusal, suggestions: valid && !available ? ideasFor(callSign) : [] }) };
}

export function join(raw: unknown): MockReply {
  const parsed = waitlistApi.join.body.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "body"] = issue.message;
    return fail(400, "bad_request", `Check the form: ${parsed.error.issues[0]?.message ?? "invalid"}.`, fields);
  }
  const body = parsed.data;
  const refusal = body.callSign ? callSignRefusal(body.callSign, CALL_SIGN_RULES_DEFAULT) : null;
  if (body.callSign && refusal) return fail(422, "call_sign_refused", refusal.reason, { callSign: refusal.reason });
  if (body.callSign && taken.has(body.callSign)) return fail(409, "call_sign_taken", `${body.callSign} is taken. Try another.`);
  const message = {
    viewer: "You're on the list.",
    station: body.callSign ? `${body.callSign} is on hold for you.` : "Your station is on the list.",
    producer: "Your programs are on the list.",
    business: "Your business is on the list."
  }[body.role];
  if (body.role === "station" && body.callSign) taken.add(body.callSign);
  return { status: 201, json: waitlistApi.join.response.parse({ role: body.role, market: MOCK_ZIPS[body.zip] ?? null, message, heldCallSign: body.role === "station" ? (body.callSign ?? null) : null }) };
}
