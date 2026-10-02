// Funding's words (biz-funding 02.1): the four-line promise, the button's "by bank transfer", and
// the line that turns an amount into airings.

import type { FundingSource } from "@opencast/contracts";
import { money, type PromiseLine } from "@opencast/ui";
import type { DepositQuote } from "../../api/types";

export const PROMISE: PromiseLine[] = [
  { lead: "It sits in your balance.", rest: "Nothing is spent by adding it." },
  { lead: "A station schedules your spot,", rest: "and the price of that airing is held." },
  { lead: "It airs,", rest: "and the held amount is paid to the station. If an airing is cut short, the hold comes back." },
  { lead: "Anything not held is yours", rest: "to take out at any time." }
];

/** "Add $250 by bank transfer". */
export function methodPhrase(kind: FundingSource["kind"]): string {
  return { clear_bank: "by bank transfer", card: "by card", clear_account: "from your Clear account" }[kind];
}

/**
 * "At $8.00 per 1,000 people tuned in, $250 is roughly 120 airings on a station like BEAT 12.1."
 * Without the quote's basis (E6) it says only the airings; with no estimate, nothing.
 */
export function estimateLine(q: Pick<DepositQuote, "roughAirings" | "basis">, amountMicros: number): string | null {
  if (q.roughAirings === null) return null;
  const amount = money(amountMicros, { trimCents: true });
  const airings = `roughly ${q.roughAirings} ${q.roughAirings === 1 ? "airing" : "airings"}`;
  const b = q.basis;
  if (!b) return `${amount} is ${airings}.`;
  if (b.rateKind === "per_airing") return `At ${money(b.rateMicros)} an airing, ${amount} is ${airings}.`;
  const on = b.station ? ` on a station like ${b.station.callSign ?? b.station.name} ${b.station.channel}` : "";
  return `At ${money(b.rateMicros)} per 1,000 people tuned in, ${amount} is ${airings}${on}.`;
}
