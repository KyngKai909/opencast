// Programming Phase 6: how a network licence reads on the desk (the list, its page, the form).
// Pure functions, so the pages and their tests agree.

import { OUTLET_WORDS, type LicensorMinutes, type NetworkLicence, type Outlet } from "@opencast/contracts";
import { money, type TagVariant } from "@opencast/ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Oct 8, 2026": a licence date (its own calendar day, no time zone). */
export function dateWords(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "Jul 1 to Oct 8, 2026", or across years "Sep 1, 2026 to Aug 31, 2027". */
export function datesLine(l: Pick<NetworkLicence, "startsOn" | "endsOn">): string {
  const sameYear = l.startsOn.slice(0, 4) === l.endsOn.slice(0, 4);
  return `${sameYear ? dateWords(l.startsOn).replace(/, \d{4}$/, "") : dateWords(l.startsOn)} to ${dateWords(l.endsOn)}`;
}

/** "Opencast, Other apps, Relays": its outlets, in the enum's order. */
export function outletsLine(outlets: readonly Outlet[]): string {
  return outlets.map((o) => OUTLET_WORDS[o].label).join(", ");
}

/** "Worldwide", or "US, CA". */
export function territoryLine(l: Pick<NetworkLicence, "worldwide" | "countries">): string {
  return l.worldwide ? "Worldwide" : l.countries.join(", ");
}

/** "12.5% revenue share", "$500.00 a month", "$2,000.00 for the term", "No fee". */
export function dealLine(deal: NetworkLicence["deal"]): string {
  if (deal.kind === "rev_share") return `${deal.percent}% revenue share`;
  if (deal.kind === "flat_fee") return `${money(deal.feeMicros)} ${deal.per === "month" ? "a month" : "for the term"}`;
  return "No fee";
}

/** "Licensed catalogs", "Licensed catalogs and 2 more", "Nothing yet". */
export function coversLine(l: Pick<NetworkLicence, "covers">): string {
  if (!l.covers.length) return "Nothing yet";
  return l.covers.length === 1 ? l.covers[0].title : `${l.covers[0].title} and ${l.covers.length - 1} more`;
}

/** Its state as a tag: "Ends in 11 days" (amber), "Ends today", "Active", "Starts Oct 1, 2026", "Ended". */
export function stateTag(l: Pick<NetworkLicence, "state" | "daysLeft" | "startsOn">): { text: string; variant: TagVariant } {
  if (l.state === "ending") return { text: l.daysLeft === 0 ? "Ends today" : `Ends in ${l.daysLeft} ${l.daysLeft === 1 ? "day" : "days"}`, variant: "standby" };
  if (l.state === "upcoming") return { text: `Starts ${dateWords(l.startsOn)}`, variant: "next" };
  if (l.state === "ended") return { text: "Ended", variant: "off" };
  return { text: "Active", variant: "plain" };
}

/** The ending notice on its page, or null while it isn't ending. */
export function endingNotice(l: Pick<NetworkLicence, "state" | "endsOn" | "licensor">): string | null {
  if (l.state !== "ending") return null;
  return `Ends ${dateWords(l.endsOn)}. What it covers is off the air after that, and stations airing it see a warning on their log from two weeks before.`;
}

/** "October 2026". */
export function monthWords(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${LONG_MONTHS[m - 1]} ${y}`;
}

/** The month before or after ("2026-10" and -1: "2026-09"). */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** "2,790", "1,234.5": minutes and hours as the report writes them; "Not counted" without watch data. */
export function amountWords(n: number | null): string {
  if (n === null) return "Not counted";
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** The report's three numbers. */
export function minutesStats(r: LicensorMinutes): Array<{ value: string; caption: string }> {
  return [
    { value: amountWords(r.minutesAired), caption: "Minutes aired on Opencast" },
    { value: String(r.airings), caption: r.airings === 1 ? "Airing" : "Airings" },
    { value: amountWords(r.viewerHours), caption: "Viewer hours, where counted" }
  ];
}

/** "Countries: US, CA" typed as "us ca" or "US, CA": upper case, each once; null when one isn't two letters. */
export function readCountries(text: string): string[] | null {
  const codes = text
    .split(/[\s,]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (codes.some((c) => !/^[A-Z]{2}$/.test(c))) return null;
  return [...new Set(codes)];
}
