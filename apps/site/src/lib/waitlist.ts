// The waitlist sheet's rules, apart from the sheet: what each field accepts, what's sent to
// `waitlist.join`, and what the confirmation says. New words are in docs/site/new-copy.md.

import "./zod";
import { z } from "zod";
import type { Market } from "@contracts/common";
import type { WaitlistRole } from "@contracts/waitlist";
import { cleanCallSign } from "./callsign";

export type Role = WaitlistRole;

/** The chooser, in the reference's order. Viewer is chosen to start. */
export const ROLES: ReadonlyArray<{ value: Role; label: string }> = [
  { value: "viewer", label: "A viewer" },
  { value: "station", label: "A station" },
  { value: "producer", label: "A producer" },
  { value: "business", label: "A business" }
];

export interface WaitlistDraft {
  role: Role;
  email: string;
  zip: string;
  /** Kept while another role is chosen, so switching back doesn't lose it; only a station sends it. */
  callSign: string;
  /** The number a station holds with it ("44.1"); request D1, ignored by the API until it lands. */
  channel?: string;
  /** What it's for ("Order a spot", a program's title), as `about`. */
  about?: string;
  /** The planner's picks or a market row's program (request D2, ignored until it lands). */
  details?: Record<string, string>;
  /** The number was suggested by the sheet, not picked: it follows the call sign. */
  suggested?: boolean;
}

export type FieldName = "email" | "zip" | "callSign";
export type FieldErrors = Partial<Record<FieldName, string>>;

export { cleanCallSign };

/** A ZIP as it's typed: digits only, five at most (a ZIP+4 keeps its first five). */
export function cleanZip(value: string): string {
  return value.replace(/\D/g, "").slice(0, 5);
}

export const isCallSign = (value: string) => /^[A-Z]{3,5}$/.test(value);

export const COPY = {
  email: "Enter an email address",
  zipMissing: "Enter your ZIP code.",
  zipInvalid: "A ZIP code is five digits.",
  callSignShort: "A call sign is three to five letters.",
  callSignFree: (cs: string) => `${cs} is free.`,
  callSignTaken: (cs: string) => `${cs} is taken. Try another.`,
  callSignRefused: (reason: string, ideas: string[]) => `${reason}${ideas.length ? ` Try ${ideas.slice(0, 2).join(" or ")}.` : " Try another."}`,
  callSignAlsoAsked: (cs: string) => `Someone else asked for ${cs} too. You can still ask: Dial decides who keeps it.`,
  offline: "We couldn’t reach Dial. Check your connection and try again."
} as const;

/** What's wrong before anything is sent. Empty when the form can go. */
export function validate(draft: WaitlistDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (!z.email().safeParse(draft.email.trim()).success) errors.email = COPY.email;
  if (!draft.zip) errors.zip = COPY.zipMissing;
  else if (!/^\d{5}$/.test(draft.zip)) errors.zip = COPY.zipInvalid;
  if (draft.role === "station" && draft.callSign && !isCallSign(draft.callSign)) errors.callSign = COPY.callSignShort;
  return errors;
}

export interface JoinBody {
  role: Role;
  email: string;
  zip: string;
  callSign?: string;
  about?: string;
  channel?: string;
  details?: Record<string, string>;
}

/** The body for `waitlist.join`. The call sign and number go only with a station, and only when there are some. */
export function toBody(draft: WaitlistDraft): JoinBody {
  const body: JoinBody = { role: draft.role, email: draft.email.trim(), zip: draft.zip };
  if (draft.role === "station" && draft.callSign) body.callSign = draft.callSign;
  if (draft.role === "station" && draft.channel) body.channel = draft.channel;
  const about = draft.about?.trim().slice(0, 140);
  if (about) body.about = about;
  if (draft.details && Object.keys(draft.details).length) body.details = draft.details;
  return body;
}

export interface Joined {
  role: Role;
  market: Market | null;
  message: string;
  heldCallSign: string | null;
}

/**
 * The confirmation: the API's `message` as the headline, and the paragraph for the role. The
 * reference's paragraphs, with the market's name where it names one; a ZIP outside every market
 * and a market that's already open get new words.
 */
export function confirmation(r: Joined): { heading: string; paragraph: string } {
  const heading = r.message.replace(/'/g, "’");
  const m = r.market;
  let paragraph: string;
  switch (r.role) {
    case "station":
      paragraph = r.heldCallSign
        ? m
          ? "We’ll write when your market opens, and your call sign is held until then."
          : "Your ZIP isn’t in a market yet. We’ll write when one opens near you, and your call sign is held until then."
        : m
          ? "We’ll write when your market opens."
          : "Your ZIP isn’t in a market yet. We’ll write when one opens near you.";
      break;
    case "producer":
      paragraph = "We’ll write when the syndication market opens to makers.";
      break;
    case "business":
      paragraph = "We’ll write when the first spot market opens near you.";
      break;
    default:
      paragraph = !m
        ? "Your ZIP isn’t in a market yet. We’ll write when a dial opens near you."
        : m.open
          ? `The ${m.name} dial is already on. We’ll write when there’s more to watch.`
          : `We’ll write when the ${m.name} dial opens.`;
  }
  return { heading, paragraph };
}

/** An API error's field messages, on the form's fields; anything else is for the whole form. */
export function fieldErrorsFrom(fields: Record<string, string> | undefined): { fields: FieldErrors; rest: string[] } {
  const out: FieldErrors = {};
  const rest: string[] = [];
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (k === "email" || k === "zip" || k === "callSign") out[k] = v;
    else rest.push(v);
  }
  return { fields: out, rest };
}
