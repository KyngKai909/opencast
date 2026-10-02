// What the Earnings and Statement pages say for each line: grouped by where the money comes from,
// the detail under each title, undecided lines kept at $0.00, carriage netted on the phone.
// Amounts stay in micros here; the pages write them with money().

import { money } from "@opencast/ui";
import type { Statement, StationEarnings } from "@opencast/contracts";
import type { StatementGroup, StatementLine } from "../../api/types";
import { dayOf, weekdayOf, type EarningsPeriod } from "./periods";
import { priceText, quantityText } from "../account/usage";

export interface MoneyRow {
  key: string;
  title: string;
  detail?: string;
  amount: number;
  notSetYet?: boolean;
  /** Shown, not counted in the total (a statement's `includedAbove` lines: usage per type, what was charged elsewhere). */
  quiet?: boolean;
}

export interface MoneySection {
  key: string;
  title: string;
  sub?: string;
  rows: MoneyRow[];
}

/** "1 airing", "212 airings", "1 business", "5 businesses". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** "Redlands Hardware", "Redlands Hardware and Clear", "A, B and C". */
export function andList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const PERIOD_WORD: Record<EarningsPeriod, string> = { week: "this week", month: "this month", year: "this year" };

export function spotsDetail(l: StationEarnings["lines"]["spots"]): string {
  if (l.airings === 0) return "No airings yet";
  return `${plural(l.airings, "airing")} from ${plural(l.businesses, "business", "businesses")}, settled after each airing`;
}

export function sponsorsDetail(l: StationEarnings["lines"]["sponsors"]): string {
  const list = l.list;
  if (!list) return plural(l.sponsors, "sponsor");
  if (list.length === 0) return "No sponsors yet";
  const names = andList(list.map((s) => s.name));
  const same = list.every((s) => s.monthlyMicros === list[0].monthlyMicros);
  if (!same) return names;
  return `${names}, ${money(list[0].monthlyMicros)} a month${list.length > 1 ? " each" : ""}`;
}

export function pledgesDetail(l: StationEarnings["lines"]["pledges"], period: EarningsPeriod): string {
  return `${plural(l.members, "member")}, ${l.newMembers.toLocaleString("en-US")} new ${PERIOD_WORD[period]}. After card fees`;
}

/**
 * Ads from partners (earnings 02.1): paid when partners pay, never held. Off, it says where to turn
 * it on; on, what's still to come.
 */
export function partnerAdsDetail(p: NonNullable<StationEarnings["lines"]["partnerAds"]>): string {
  if (!p.on) return "Off. Turn it on in Breaks settings. Paid when partners pay, 30 to 90 days after airing";
  return p.pendingMicros > 0 ? `${money(p.pendingMicros)} to come. Paid when partners pay, 30 to 90 days after airing` : "Paid when partners pay, 30 to 90 days after airing";
}

/**
 * Relay viewers (follow-up Phase 3): per-thousand spots paid for the viewers YouTube and Twitch
 * reported, one line per platform ("Relay viewers, as reported by YouTube"), apart from Spots.
 */
export function relayViewersRows(l: StationEarnings["lines"]): MoneyRow[] {
  return (l.relayViewers ?? []).map((r) => ({
    key: `relay-${r.platform}`,
    title: r.label,
    detail: r.airings ? `${plural(r.airings, "airing")}, for viewers ${r.platform === "youtube" ? "YouTube" : "Twitch"} reported during your spots` : "No airings yet",
    amount: r.micros
  }));
}

/** The earnings page's groups. A studio has no breaks or members of its own, and carries nothing. */
export function earningsSections(e: StationEarnings, period: EarningsPeriod, studio: boolean): MoneySection[] {
  const l = e.lines;
  const sections: MoneySection[] = [];
  if (!studio) {
    sections.push({
      key: "breaks",
      title: "From your breaks",
      rows: [
        { key: "spots", title: "Spots", detail: spotsDetail(l.spots), amount: l.spots.micros },
        ...relayViewersRows(l),
        { key: "sponsors", title: "Sponsors", detail: sponsorsDetail(l.sponsors), amount: l.sponsors.micros },
        ...(l.partnerAds ? [{ key: "partnerAds", title: "Ads from partners", detail: partnerAdsDetail(l.partnerAds), amount: l.partnerAds.micros }] : [])
      ]
    });
    sections.push({ key: "viewers", title: "From viewers", rows: [{ key: "pledges", title: "Pledges", detail: pledgesDetail(l.pledges, period), amount: l.pledges.micros }] });
  }
  const carriage: MoneyRow[] = [{ key: "carriageIn", title: "Your programs on other stations", detail: l.carriageIn.detail || undefined, amount: l.carriageIn.micros }];
  if (!studio || l.carriageOut.micros !== 0) carriage.push({ key: "carriageOut", title: "Programs you carry", detail: l.carriageOut.detail || undefined, amount: l.carriageOut.micros });
  sections.push({ key: "carriage", title: "Carriage", rows: carriage });
  if (l.production.micros !== 0) {
    sections.push({ key: "production", title: "Production", rows: [{ key: "production", title: "Spots you made", detail: `${plural(l.production.orders, "order")} for businesses`, amount: l.production.micros }] });
  }
  sections.push({
    key: "shared",
    title: "Shared",
    rows: [
      { key: "opencastShare", title: "Opencast's share", detail: "Of spot revenue", amount: l.opencastShare.micros, notSetYet: l.opencastShare.notSetYet },
      { key: "pool", title: "The pool", detail: "Base share, watch-time share and the fund", amount: l.pool.micros, notSetYet: l.pool.notSetYet }
    ]
  });
  return sections;
}

/**
 * The phone's compact lines (earnings 04.2): Spots, Sponsors, Pledges, and Carriage netted, in
 * less out. The shared lines are left off while they're not set yet, as drawn; once decided they
 * come back as one line, so the total always adds up.
 */
export function phoneRows(e: StationEarnings, studio: boolean): MoneyRow[] {
  const l = e.lines;
  const rows: MoneyRow[] = [];
  if (!studio) {
    rows.push({ key: "spots", title: "Spots", amount: l.spots.micros });
    // Relay viewers: one line on the phone, both platforms together.
    if (l.relayViewers?.length) rows.push({ key: "relayViewers", title: "Relay viewers", amount: l.relayViewers.reduce((a, r) => a + r.micros, 0) });
    rows.push({ key: "sponsors", title: "Sponsors", amount: l.sponsors.micros });
    rows.push({ key: "pledges", title: "Pledges", amount: l.pledges.micros });
  }
  rows.push({ key: "carriage", title: "Carriage", amount: l.carriageIn.micros + l.carriageOut.micros });
  if (l.production.micros !== 0) rows.push({ key: "production", title: "Production", amount: l.production.micros });
  const shared = l.opencastShare.micros + l.pool.micros;
  if (!(l.opencastShare.notSetYet && l.pool.notSetYet) || shared !== 0) rows.push({ key: "shared", title: "Shared", amount: shared });
  return rows;
}

/** "9 airings in 4 breaks"; "9 airings" when the API doesn't say how many breaks. */
export function heldTonightDetail(h: StationEarnings["held"]): string {
  const a = plural(h.tonightAirings, "airing");
  return h.tonightBreaks !== undefined ? `${a} in ${plural(h.tonightBreaks, "break")}` : a;
}

/** "Weekly, to Chase ending 2231". */
export function payoutDetail(p: NonNullable<StationEarnings["nextPayout"]>): string {
  const schedule = p.schedule === "weekly" ? "Weekly" : "Monthly";
  return p.destination ? `${schedule}, to ${p.destination}` : schedule;
}

// ---- Statements ----

const GROUPS: Array<{ group: StatementGroup; title: string }> = [
  { group: "spots", title: "Spots" },
  { group: "sponsors_pledges", title: "Sponsors and pledges" },
  { group: "carriage", title: "Carriage" },
  { group: "production", title: "Production" },
  { group: "shared", title: "Shared" },
  { group: "card_fees", title: "Card fees" },
  // Pay-as-you-go (follow-up Phase 2): taken from earnings before the payout.
  { group: "usage", title: "Usage" },
  { group: "other", title: "Other" }
];

/** A usage line's units and price: "38.50 GB-months, 10.00 free, at $0.04 a GB-month"; "168 hours, at $0.20 an hour". */
export function usageLineDetail(u: NonNullable<StatementLine["usage"]>): string {
  const free = u.freeQuantity > 0 ? `${u.unit === "gb_month" ? u.freeQuantity.toFixed(2) : Number(u.freeQuantity.toFixed(2)).toLocaleString("en-US")} free` : null;
  const price = priceText(u.unit, u.priceMicros);
  return [quantityText(u.unit, u.quantity), free, price === "Free" || price === "Price not set yet" ? price.toLowerCase() : `at ${price}`].filter(Boolean).join(", ");
}

/** What a statement adds up to: lines shown for reference (`includedAbove`) aren't counted. */
export function statementTotal(s: Pick<Statement, "lines">): number {
  return s.lines.reduce((a, l) => a + (l.includedAbove ? 0 : l.amountMicros), 0);
}

/** A statement line's detail: per-thousand lines show their math ("18 airings, $8.00 per 1,000 tuned in, average 262"). */
export function statementLineDetail(l: StatementLine): string | undefined {
  if (l.usage) return usageLineDetail(l.usage);
  if (l.rate && l.airings !== undefined) {
    const airings = plural(l.airings, "airing");
    if (l.rate.kind === "per_airing") return `${airings}, ${money(l.rate.micros)} an airing`;
    if (l.averageTunedIn !== undefined) return `${airings}, ${money(l.rate.micros)} per 1,000 tuned in, average ${l.averageTunedIn.toLocaleString("en-US")}`;
  }
  return l.detail ?? undefined;
}

/** What a per-thousand spot line comes to: airings × average tuned in × rate ÷ 1,000, to the cent. */
export function perThousandMicros(rateMicros: number, airings: number, averageTunedIn: number): number {
  return Math.round((rateMicros * airings * averageTunedIn) / 1000 / 10_000) * 10_000;
}

export interface StatementSection extends MoneySection {
  /** The frame's two columns: spots, sponsors and pledges on the left; the rest on the right. */
  column: "left" | "right";
  /** A line under the rows (the usage section says what's counted). */
  note?: string;
}

/** The statement's lines under their headings. Without groups from the API, one list with no heading. */
export function statementSections(s: Statement): StatementSection[] {
  const rowOf = (l: StatementLine, i: number): MoneyRow => ({ key: `${i}`, title: l.label, detail: statementLineDetail(l), amount: l.amountMicros, notSetYet: l.notSetYet, ...(l.includedAbove ? { quiet: true } : {}) });
  if (!s.lines.some((l) => l.group)) return [{ key: "lines", title: "", column: "left", rows: s.lines.map(rowOf) }];
  const out: StatementSection[] = [];
  for (const g of GROUPS) {
    let lines = s.lines.map((l, i) => ({ l, i })).filter(({ l }) => (l.group ?? "other") === g.group);
    if (!lines.length) continue;
    // Usage: each type with its units and price, then what earnings paid (counted), then anything charged elsewhere or still owed.
    if (g.group === "usage") {
      const rank = (l: StatementLine) => (l.usage ? 0 : !l.includedAbove ? 1 : 2);
      lines = [...lines].sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i);
    }
    const airings = g.group === "spots" ? lines.reduce((a, { l }) => a + (l.airings ?? 0), 0) : 0;
    out.push({
      key: g.group,
      title: g.title,
      sub: airings ? plural(airings, "airing") : undefined,
      column: g.group === "spots" || g.group === "sponsors_pledges" ? "left" : "right",
      rows: lines.map(({ l, i }) => rowOf(l, i)),
      ...(g.group === "usage"
        ? { sub: "Taken from earnings before the payout", note: "Each type is shown with its units and price. Only what was taken from earnings counts in the total." }
        : {})
    });
  }
  return out;
}

/** "Week of September 14" (or "September" for a monthly statement). */
export function statementTitle(s: Pick<Statement, "period" | "periodStart">): string {
  return s.period === "week" ? `Week of ${dayOf(s.periodStart)}` : dayOf(s.periodStart).split(" ")[0];
}

/** "Paid Monday, September 21, to Chase ending 2231." or, before it's paid, "September 21 to September 27." (a month: "August 1 to 31.") */
export function statementSubtitle(s: Pick<Statement, "paidOn" | "destination" | "periodStart" | "periodEnd"> & { period?: Statement["period"] }): string {
  if (s.paidOn) return `Paid ${weekdayOf(s.paidOn)}${s.destination ? `, to ${s.destination}` : ""}.`;
  // A month's statement (pay-as-you-go's usage): "August 1 to 31."
  if (s.period === "month" && s.periodStart.slice(0, 7) === s.periodEnd.slice(0, 7)) return `${dayOf(s.periodStart)} to ${Number(s.periodEnd.slice(8, 10))}.`;
  return `${dayOf(s.periodStart)} to ${dayOf(s.periodEnd)}.`;
}

/** What someone typed as an amount ("$640.12", "1,200", "300.5"), in micros; null when it isn't one. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const [whole, cents = ""] = t.split(".");
  return Number(whole) * 1_000_000 + Number(cents.padEnd(2, "0")) * 10_000;
}
