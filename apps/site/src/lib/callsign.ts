// The one call-sign check on the site (SITE-SPEC §6): the Network page's checker, the Run
// footer's box and the waitlist sheet all use it. The rules are the API's own
// (`callSignRefusal()` and `CALL_SIGN_RULES_DEFAULT` in packages/contracts), so the site refuses
// exactly what the waitlist would; the messages are the Network checker's (network/net.js).
import { CALL_SIGN_RULES_DEFAULT, callSignRefusal } from "@contracts/callSigns";

/** As it's typed: letters only, in capitals, five at most ("be-at1" → "BEAT"). */
export function cleanCallSign(value: string): string {
  return value.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 5);
}

export interface CallSignRow {
  ok: boolean;
  text: string;
}

export interface CallSignCheck {
  value: string;
  /** Three to five letters, A to Z. */
  letters: boolean;
  /** Four letters starting with K or W. */
  kw: boolean;
  /** A network, a brand or an alert word. */
  brand: boolean;
  /** Who has it ("12.1 in Inland Empire"), or null. */
  taken: string | null;
  ok: boolean;
  rows: CallSignRow[];
  message: string;
}

/**
 * Check `raw` against the rules. `takenBy` says who's already on the dial with it (the demo
 * stations on the site; the API has the real answer).
 */
export function checkCallSign(raw: string, takenBy: (cs: string) => string | null): CallSignCheck {
  const v = raw.toUpperCase().replace(/\s/g, "");
  const letters = /^[A-Z]{3,5}$/.test(v);
  const refusal = /^[A-Z]+$/.test(v) ? callSignRefusal(v, CALL_SIGN_RULES_DEFAULT) : null;
  const kw = refusal?.rule === "kw_four_letters";
  const brand = refusal?.rule === "impersonation" || refusal?.rule === "denylist";
  const taken = v ? takenBy(v) : null;
  const rows: CallSignRow[] = [
    { ok: letters, text: "Three to five letters, A to Z" },
    { ok: !kw, text: "Not four letters starting with K or W" },
    { ok: !brand, text: "Not a network, a brand or an alert word" },
    { ok: !taken, text: taken ? `Already ${taken}` : "Not on the dial yet" }
  ];
  const ok = v.length > 0 && rows.every((r) => r.ok);
  const message = !v.length
    ? "Type a call sign to check it."
    : ok
      ? `${v} is free. Reserve it and we hold it for 120 days.`
      : kw
        ? "Too close to a real FCC call sign. Try three or five letters."
        : !letters
          ? "Letters only, three to five of them."
          : brand
            ? "That one belongs to someone else."
            : `${v} is taken. Try another.`;
  return { value: v, letters, kw, brand, taken, ok, rows, message };
}

/** A free TV number for a call sign, the same one every time (net.js `freeNum`), avoiding `used`. */
export function suggestNumber(cs: string, used: ReadonlySet<string>): string {
  let h = 0;
  for (let i = 0; i < cs.length; i++) h = (h * 31 + cs.charCodeAt(i)) % 997;
  for (let t = 0; t < 70; t++) {
    const c = `${2 + ((h + t * 7) % 66)}.${1 + (h % 4)}`;
    if (!used.has(c)) return c;
  }
  return "50.1";
}
