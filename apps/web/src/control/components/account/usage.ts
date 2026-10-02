// What the Station account pane says (pay-as-you-go, follow-up Phase 2): each usage type's units,
// price and free allowance, the month's estimate, caps and what reaching one pauses, the account's
// standing (ok, grace, paused), what pays, and each month's bill. Amounts stay in micros here; the
// words are listed in docs/apps/new-copy.md. The channel is never paused, and every sentence that
// pauses something says so.

import { money } from "@opencast/ui";
import { USAGE_TYPES, type StationAccount, type UsageBill, type UsageLine, type UsageType, type UsageUnit } from "@opencast/contracts";
import { dayOf } from "../earnings/periods";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "August" for `2026-08`. */
export function monthOf(month: string): string {
  return MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
}

/** "1 hour", "3.5 hours", "156.9 hours": two decimals under 10, one above. */
export function hoursText(hours: number): string {
  const n = Number(hours.toFixed(hours < 10 ? 2 : 1));
  return `${n.toLocaleString("en-US")} ${n === 1 ? "hour" : "hours"}`;
}

/** "37.80 GB-months" (storage: each day's GB, averaged over the month). */
export function gbMonthsText(q: number): string {
  return `${q.toFixed(2)} GB-months`;
}

export function quantityText(unit: UsageUnit, q: number): string {
  return unit === "gb_month" ? gbMonthsText(q) : hoursText(q);
}

/** "$0.04", "$0.018": a unit price, to the tenth of a cent when it has one. */
export function unitPrice(micros: number): string {
  return micros % 10_000 ? `$${(micros / 1_000_000).toFixed(3)}` : money(micros);
}

/** "$0.04 a GB-month", "$0.20 an hour", "Free", "Price not set yet". */
export function priceText(unit: UsageUnit, priceMicros: number | null, free = false): string {
  if (free || priceMicros === 0) return "Free";
  if (priceMicros === null) return "Price not set yet";
  return `${unitPrice(priceMicros)} ${unit === "gb_month" ? "a GB-month" : "an hour"}`;
}

/** "10 GB free a month, all used", "3.5 of 5 free hours left". Null: the type has no allowance. */
export function allowanceText(line: Pick<UsageLine, "unit" | "allowance">): string | null {
  const a = line.allowance;
  if (!a || a.quantity <= 0) return null;
  if (line.unit === "gb_month") {
    const total = `${a.quantity.toLocaleString("en-US")} GB`;
    return a.left <= 0 ? `${total} free a month, all used` : `${Number(a.left.toFixed(2)).toLocaleString("en-US")} of ${total} free left`;
  }
  const total = a.quantity.toLocaleString("en-US");
  return a.left <= 0 ? `${total} free hours a month, all used` : `${Number(a.left.toFixed(2)).toLocaleString("en-US")} of ${total} free hours left`;
}

/**
 * A usage row's detail: what's used so far, the free allowance, the price, and what it comes to
 * at this pace. "37.80 GB-months so far, 42 GB kept today. 10 GB free a month, all used. $0.04 a GB-month."
 */
export function usageDetail(line: UsageLine): string {
  const parts: string[] = [];
  if (line.unit === "gb_month") {
    parts.push(line.currentGb !== null ? `${gbMonthsText(line.quantity)} so far, ${Number(line.currentGb.toFixed(1)).toLocaleString("en-US")} GB kept today` : `${gbMonthsText(line.quantity)} so far`);
  } else {
    const est = line.estimate.quantity;
    parts.push(est > line.quantity + 0.005 ? `${hoursText(line.quantity)} so far, about ${hoursText(est)} by the month's end` : `${hoursText(line.quantity)} so far`);
  }
  const allowance = allowanceText(line);
  if (allowance) parts.push(allowance);
  parts.push(line.type === "relay_live_only" ? "Always free" : priceText(line.unit, line.priceMicros, line.free));
  return `${parts.join(". ")}.`;
}

/** What reaching a type's cap pauses, as a sentence that ends with the channel staying on. */
const CAP_EFFECT: Partial<Record<UsageType, string>> = {
  storage: "New uploads and imports pause for the rest of the month",
  relay_everything: "Relays pause for the rest of the month",
  live_hours: "Live shows pause for the rest of the month (station ID and bumpers air instead)",
  radio_live: "Live shows pause for the rest of the month (station ID and bumpers air instead)"
};

/** "Relays pause for the rest of the month; your channel stays on air." */
export function capEffect(type: UsageType): string {
  const effect = CAP_EFFECT[type] ?? `${USAGE_TYPES[type].pauses ?? "It"} pauses for the rest of the month`;
  return `${effect}; your channel stays on air.`;
}

/** A cap row's detail: none yet, set, or reached (and what that paused). */
export function capDetail(line: UsageLine): string {
  const cap = line.cap;
  if (cap.micros === null) return `No cap. At a cap: ${lowerFirst(capEffect(line.type))}`;
  if (cap.reached) return `Reached ${money(cap.micros)}. ${capEffect(line.type)} Raise the cap to bring it back.`;
  return `${money(line.soFarMicros)} of ${money(cap.micros)} so far. At the cap: ${lowerFirst(capEffect(line.type))}`;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** The months with something due, oldest first: "August", "July and August". */
export function dueMonthsText(bills: UsageBill[]): string | null {
  const due = bills.filter((b) => b.status === "due" && b.dueMicros > 0).map((b) => b.month).sort();
  if (!due.length) return null;
  const names = due.map(monthOf);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What's paused while a bill is unpaid past the grace period ("Relays of everything you air; Live shows (…)"). */
export function pausedList(usage: UsageLine[]): string[] {
  return usage.filter((l) => l.paused === "unpaid" && l.pauses).map((l) => l.pauses!).filter((p, i, all) => all.indexOf(p) === i);
}

export interface StandingWords {
  tone: "standby" | "plain";
  title: string;
  detail: string;
}

/**
 * The account's standing, as a notice: in grace (the date relays and live shows pause), paused
 * (what's paused, the channel still on air), or something due while it's ok. Null: nothing to say.
 * `owner` adds how to fix it; operators are told an owner pays.
 */
export function standingWords(a: Pick<StationAccount, "standing" | "grace" | "dueMicros" | "bills" | "usage" | "funding">, owner: boolean): StandingWords | null {
  const months = dueMonthsText(a.bills);
  const forWhat = months ? `for ${months}'s usage` : "for usage";
  const attempt = a.bills.find((b) => b.status === "due" && b.lastAttempt?.result === "failed")?.lastAttempt ?? null;
  const tried = attempt?.reason ? ` ${attempt.method === "card" ? (a.funding.card?.label ?? "The card") : "Clear"}: ${attempt.reason}` : "";
  const fix = owner ? (a.funding.source ? "" : " Add a card or connect Clear with full access to pay it.") : " An owner can pay it here.";
  if (a.standing === "grace" && a.grace) {
    return {
      tone: "standby",
      title: `${money(a.grace.dueMicros)} is due ${forWhat}`,
      detail: `Relays and live shows keep going until ${dayOf(a.grace.pausesOn)} (${a.grace.daysLeft === 1 ? "1 day" : `${a.grace.daysLeft} days`}), then pause until it's paid. Your channel stays on air.${tried}${fix}`
    };
  }
  if (a.standing === "paused") {
    const paused = pausedList(a.usage);
    return {
      tone: "standby",
      title: "Relays and live shows are paused",
      detail: `${money(a.dueMicros)} is still due ${forWhat}. Your channel is still on air.${paused.length ? ` Paused: ${paused.join("; ")}.` : ""}${tried}${owner ? (a.funding.source ? " Pay it to bring them back." : fix) : fix}`
    };
  }
  if (a.dueMicros > 0) return { tone: "plain", title: `${money(a.dueMicros)} is due ${forWhat}`, detail: `Nothing is paused.${owner ? "" : " An owner can pay it here."}` };
  return null;
}

/** The Monitor's banner (grace or paused only). */
export function bannerWords(a: Pick<StationAccount, "standing" | "grace" | "dueMicros" | "bills">): { title: string; detail: string } | null {
  const months = dueMonthsText(a.bills);
  const forWhat = months ? `for ${months}'s usage` : "for usage";
  if (a.standing === "grace" && a.grace) return { title: `Relays and live shows pause on ${dayOf(a.grace.pausesOn)}`, detail: `${money(a.grace.dueMicros)} is due ${forWhat}. Your channel stays on air.` };
  if (a.standing === "paused") return { title: "Relays and live shows are paused", detail: `${money(a.dueMicros)} is still due ${forWhat}. Your channel is still on air.` };
  return null;
}

/** A bill's line: where its money came from. "$29.20 from earnings, $5.84 due", "Inside the free allowance". */
export function billDetail(b: UsageBill, cardLabel: string | null): string {
  const parts: string[] = [];
  if (b.fromEarningsMicros > 0) parts.push(`${money(b.fromEarningsMicros)} from earnings`);
  if (b.fromClearMicros > 0) parts.push(`${money(b.fromClearMicros)} from Clear`);
  if (b.fromCardMicros > 0) parts.push(`${money(b.fromCardMicros)} charged to ${cardLabel ?? "the card"}`);
  if (b.dueMicros > 0) parts.push(b.status === "open" ? `${money(b.dueMicros)} to take at the month's end` : `${money(b.dueMicros)} due`);
  let text = parts.length ? parts.join(", ") : b.amountMicros === 0 ? "Inside the free allowance" : b.status === "open" ? "Taken from earnings before each payout" : "Paid";
  if (b.status === "open") text = `So far. ${text}`;
  if (b.status === "due" && b.lastAttempt?.result === "failed" && b.lastAttempt.reason) text += `. ${b.lastAttempt.method === "card" ? (cardLabel ?? "The card") : "Clear"}: ${b.lastAttempt.reason.replace(/\.$/, "")}`;
  return `${text}.`;
}

/** "Expires August 2029", "Expired March 2027". */
export function cardExpiry(card: NonNullable<StationAccount["funding"]["card"]>): string | null {
  if (!card.expiresOn) return null;
  const when = `${monthOf(card.expiresOn.slice(0, 7))} ${card.expiresOn.slice(0, 4)}`;
  return card.expired ? `Expired ${when}` : `Expires ${when}`;
}

/** The "month so far" line: "September so far" (and the month's end, "to September 30"). */
export function monthSoFar(a: Pick<StationAccount, "month" | "monthEnd">): string {
  return `${monthOf(a.month)} so far, estimated to ${dayOf(a.monthEnd)}`;
}
