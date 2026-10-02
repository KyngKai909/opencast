// Call signs Opencast won't allow (added 2026-09-29, Network desk "Reserved call signs",
// desk-pages 02). The rule set lives in the rules registry (`call_signs.refused`); this is how a
// call sign is read against it, and where alternatives come from. Shared by the API (the waitlist,
// station setup, the desk) and the desk's mocks, so both refuse exactly the same names.
//
// Three kinds of name are refused:
// - four letters starting with K or W: they look like a real broadcast call sign (the FCC's);
// - impersonation: a known brand, network, station or agency. A name of three letters or fewer
//   must match exactly (so FOXY is fine and FOX isn't); a longer one anywhere in the call sign
//   (ESPNX is refused);
// - the denylist, matched the same way.
// Stations already on the dial keep theirs: the desk sees them flagged, nothing changes.

import { z } from "zod";

/** A word in the impersonation list or the denylist: capital letters. */
const Word = z.string().regex(/^[A-Z]{2,12}$/, "Capital letters only");

export const CallSignRules = z.object({
  /** Four letters starting with K or W (KFRO, WAVE). */
  refuseKwFourLetters: z.boolean(),
  /** Brands, networks, stations and agencies a call sign mustn't pass for. */
  impersonation: z.array(Word).max(500),
  /** Names Opencast doesn't allow for any other reason. */
  denylist: z.array(Word).max(2000)
});
export type CallSignRules = z.infer<typeof CallSignRules>;

/** The first version (migration 0029). The lists are a start; the desk adds to them in Settings. */
export const CALL_SIGN_RULES_DEFAULT: CallSignRules = {
  refuseKwFourLetters: true,
  impersonation: ["ABC", "AMC", "BBC", "BET", "CBC", "CBS", "CNN", "CSPAN", "ESPN", "FCC", "FEMA", "FOX", "HBO", "HULU", "MSNBC", "MTV", "NBC", "NOAA", "NPR", "NWS", "PBS", "ROKU", "TBS", "TNT", "TUBI"],
  denylist: ["ALERT", "EAS", "SOS"]
};

export const CallSignRefusalRule = z.enum(["kw_four_letters", "impersonation", "denylist"]);
export type CallSignRefusalRule = z.infer<typeof CallSignRefusalRule>;

export const CallSignRefusal = z.object({
  rule: CallSignRefusalRule,
  /** Why, in a sentence ("Four letters starting with K or W look like a real broadcast call sign."). */
  reason: z.string(),
  /** The brand or station it passes for; null for the other rules (the denylist's word is never shown). */
  match: z.string().nullable()
});
export type CallSignRefusal = z.infer<typeof CallSignRefusal>;

const matches = (callSign: string, word: string) => (word.length <= 3 ? callSign === word : callSign.includes(word));

/** Why this call sign isn't allowed, or null when it is. Only the pattern's letters are read. */
export function callSignRefusal(callSign: string, rules: CallSignRules): CallSignRefusal | null {
  const cs = callSign.toUpperCase();
  if (rules.denylist.some((w) => matches(cs, w))) return { rule: "denylist", reason: "Opencast doesn't allow that name.", match: null };
  const brand = rules.impersonation.find((w) => matches(cs, w));
  if (brand) return { rule: "impersonation", reason: cs === brand ? `${brand} belongs to someone else.` : `${cs} looks like ${brand}, which belongs to someone else.`, match: brand };
  if (rules.refuseKwFourLetters && /^[KW][A-Z]{3}$/.test(cs)) return { rule: "kw_four_letters", reason: "Four letters starting with K or W look like a real broadcast call sign.", match: null };
  return null;
}

/**
 * Names to offer in place of this one, best first, before anyone checks they're free: for a K or
 * W name, the letters after it (KFRO: FRO, FROS, FROY); otherwise one more letter (VALE: VALES,
 * VALEY), the last letter changed (VALA, VALO), a letter in front, the first three. Every idea is
 * 3 to 5 capital letters and not the name itself; the caller drops refused and taken ones.
 */
export function callSignIdeas(callSign: string): string[] {
  const cs = callSign.toUpperCase().replace(/[^A-Z]/g, "");
  const base = /^[KW][A-Z]{3}$/.test(cs) ? cs.slice(1) : cs;
  const out: string[] = [];
  const add = (s: string) => {
    if (/^[A-Z]{3,5}$/.test(s) && s !== cs && !out.includes(s)) out.push(s);
  };
  add(base);
  for (const l of "SYOXAE") add(base + l);
  for (const l of "SYOXAEI") add(base.slice(0, -1) + l);
  for (const l of "NOAE") add(l + base);
  add(base.slice(0, 3));
  for (const l of "RTLMDK") add(base.slice(0, 3) + l);
  return out;
}
