// Catalog sponsors (desk-pages 03): the page's words, from the API's figures. Dates here are whole
// days (the 1st a month starts or renews), read in UTC.

import type { CatalogSlot, CatalogSponsors, CatalogSponsorship } from "@opencast/contracts";
import { money } from "@opencast/ui";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "September", from `2026-09-01`. */
export const monthName = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1] ?? "";
/** "October 1", from `2026-10-01`. */
export const dayMonthOf = (date: string) => `${monthName(date)} ${Number(date.slice(8, 10))}`;
/** "2,840". */
export const count = (n: number) => n.toLocaleString("en-US");
/** "0%", "12.5%". */
export const percent = (bps: number) => `${bps % 100 ? (bps / 100).toFixed(2).replace(/0+$/, "") : bps / 100}%`;

/** "Inland Empire Libraries' credit", "Clear's credit". */
export const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** Where it's credited: the series, or every catalog series. */
export const seriesWords = (s: { series: CatalogSlot["series"] }) => s.series?.title ?? "Every catalog series";

/** The line under a sponsor's name: since when, starting, ending or waiting. */
export function sponsorLine(s: CatalogSponsorship): string {
  switch (s.state) {
    case "offered":
      return "Offered, waiting for their answer";
    case "starting":
      return `Starts ${dayMonthOf(s.startsOn)}`;
    case "credited":
      return s.since ? `Since ${monthName(s.since)}` : "Credited this month";
    case "ending":
      return s.endsOn ? `Ends ${dayMonthOf(s.endsOn)}` : "Ending";
    case "ended":
      return "Ended";
    case "lapsed":
      return "Lapsed: a month it couldn't pay";
    case "declined":
      return "Said no";
  }
}

/** The four figures over the list, as drawn. */
export function sponsorStats(body: CatalogSponsors): Array<{ value: string; caption: string }> {
  return [
    { value: count(body.stats.creditsThisMonth), caption: `Catalog credits aired in ${monthName(body.month)}` },
    { value: money(body.stats.monthlyMicros), caption: "Sponsorship a month, all markets" },
    { value: String(body.stats.marketsWithOpenSlots), caption: body.stats.marketsWithOpenSlots === 1 ? "Market with a local sponsor slot open" : "Markets with a local sponsor slot open" },
    { value: percent(body.stats.fundShareBps), caption: body.stats.fundShareSet ? "Share to the creator fund" : "Share to the creator fund. Not set yet" }
  ];
}

/** A slot's cell in the grid: who it thanks, then its price or why it isn't for sale. */
export function slotCell(slot: CatalogSlot, sponsors: CatalogSponsorship[]): { who: string; line: string; open: boolean } {
  const own = sponsors.find((s) => s.id === slot.sponsorshipId);
  const offer = sponsors.find((s) => s.id === slot.offerId);
  const price = slot.priceMicros === null ? null : `${money(slot.priceMicros)} a month`;
  if (slot.creditedBy === "sponsor" && own) return { who: own.business.name, line: own.state === "ending" ? sponsorLine(own) : `${money(own.monthlyMicros)} a month`, open: slot.forSale };
  if (own && own.state === "starting") return { who: own.business.name, line: `${sponsorLine(own)}. Clear until then`, open: false };
  if (offer) return { who: "Clear", line: `Offered to ${offer.business.name}`, open: false };
  if (slot.creditedBy === "every_series") {
    const every = sponsors.find((s) => s.series === null && s.market.id === slot.market.id && (s.state === "credited" || s.state === "ending"));
    return { who: every?.business.name ?? "Every-series sponsor", line: "Its every-series sponsor", open: slot.forSale };
  }
  if (slot.forSale) return { who: "Clear", line: `Open slot, ${price}`, open: true };
  return { who: "Clear", line: price ? "Taken" : "Not for sale: no price set", open: false };
}

/** "Airs 12 times a day here, on 5 stations"; "Not airing here this week". */
export function airsLine(slot: CatalogSlot): string {
  if (!slot.stations) return "Not airing here this week";
  const times = slot.airsPerDay === 1 ? "once a day" : slot.airsPerDay ? `${slot.airsPerDay} times a day` : "less than once a day";
  return `Airs ${times} here, on ${slot.stations} ${slot.stations === 1 ? "station" : "stations"}`;
}

/** The months a sponsorship can start on: this month's 1st and the next three. */
export function startMonths(month: string): Array<{ value: string; label: string }> {
  const [y, m] = month.split("-").map(Number);
  return [0, 1, 2, 3].map((i) => {
    const value = new Date(Date.UTC(y!, m! - 1 + i, 1)).toISOString().slice(0, 10);
    return { value, label: i === 0 ? `${dayMonthOf(value)}, this month` : dayMonthOf(value) };
  });
}

/** A selection in the page's URL: a sponsor, a slot, or Clear. */
export type Selection = { kind: "sponsor"; id: string } | { kind: "slot"; seriesId: string | null; marketId: string } | { kind: "house" };

export function parseSelection(value: string | null): Selection | null {
  if (!value) return null;
  if (value === "clear") return { kind: "house" };
  const [kind, a, b] = value.split(":");
  if (kind === "sponsor" && a) return { kind: "sponsor", id: a };
  if (kind === "slot" && a && b) return { kind: "slot", seriesId: a === "every" ? null : a, marketId: b };
  return null;
}

export function selectionKey(s: Selection): string {
  return s.kind === "house" ? "clear" : s.kind === "sponsor" ? `sponsor:${s.id}` : `slot:${s.seriesId ?? "every"}:${s.marketId}`;
}
