// How the Settings pages write days, people and money sources: "Now", "Yesterday", "Monday",
// "Invited Friday", "Sept 24", "5 people on Orange Street Coffee.", "Chase ending 8810. No fee".
// Calendar days are counted in the market's time zone.

import type { Business, FundingSource, Market } from "@opencast/contracts";

type T = string | number | Date;
const ms = (t: T) => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t));
const DAY = 86_400_000;

function dayNumber(t: T, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(ms(t)));
  const get = (k: string) => Number(p.find((x) => x.type === k)?.value);
  return Math.round(Date.UTC(get("year"), get("month") - 1, get("day")) / DAY);
}

function weekday(t: T, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(new Date(ms(t)));
}

// The style guide's short months: "Sept 24", "Oct 1".
const MONTHS = ["Jan", "Feb", "March", "April", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];

/** "Sept 24", "Oct 1". */
export function shortDay(t: T, timeZone: string): string {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, month: "numeric", day: "numeric" }).formatToParts(new Date(ms(t)));
  const get = (k: string) => Number(p.find((x) => x.type === k)?.value);
  return `${MONTHS[get("month") - 1]} ${get("day")}`;
}

/** A day as the team list says it: "Today", "Yesterday", "Monday", "Last Friday", "Aug 19". */
export function dayWord(t: T, now: T, timeZone: string): string {
  const d = dayNumber(t, timeZone) - dayNumber(now, timeZone);
  if (d === 0) return "Today";
  if (d === -1) return "Yesterday";
  if (d < 0 && d >= -6) return weekday(t, timeZone);
  if (d < 0 && d >= -13) return `Last ${weekday(t, timeZone)}`;
  return shortDay(t, timeZone);
}

/** When someone was last in (biz-settings 02.1): "Now", "Yesterday", "Monday", "Thursday". */
export function lastIn(t: T | null, now: T, timeZone: string): string {
  if (t === null) return "Not yet";
  if (ms(now) - ms(t) < 5 * 60_000) return "Now";
  return dayWord(t, now, timeZone);
}

/** "Invited Friday" (the frame names the day, yesterday included), "Invited today", "Invited Aug 19". */
export function invitedLine(createdAt: T, now: T, timeZone: string): string {
  const d = dayNumber(createdAt, timeZone) - dayNumber(now, timeZone);
  if (d === 0) return "Invited today";
  if (d < 0 && d >= -6) return `Invited ${weekday(createdAt, timeZone)}`;
  return `Invited ${dayWord(createdAt, now, timeZone)}`;
}

/** The invite row's "Last in": "Not joined yet", or "Invite expired" after a week. */
export function inviteState(expiresAt: T, now: T): "Not joined yet" | "Invite expired" {
  return ms(expiresAt) > ms(now) ? "Not joined yet" : "Invite expired";
}

/** "5 people on Orange Street Coffee." (members and invites waiting, as the frame counts sam@). */
export function peopleLine(n: number, name: string): string {
  return `${n} ${n === 1 ? "person" : "people"} on ${name}.`;
}

/** "Jess" from "Jess Lin"; null without a name. */
export function firstName(displayName: string | null | undefined): string | null {
  const w = displayName?.trim().split(/\s+/)[0];
  return w ? w : null;
}

/** "Bank, through Clear", "Card", "Clear business account" (biz-settings 03.1). */
export function fundingTitle(kind: FundingSource["kind"]): string {
  return { clear_bank: "Bank, through Clear", card: "Card", clear_account: "Clear business account" }[kind];
}

/** "Chase ending 8810. No fee", "Visa ending 4417. Stripe's fee at cost". */
export function fundingDetail(f: Pick<FundingSource, "kind" | "label">): string {
  const where = f.label.replace(/^Clear,\s*/, "");
  return `${where}. ${f.kind === "card" ? "Stripe's fee at cost" : "No fee"}`;
}

/** The pause warning's line: "At 3 days and 1 day of airings left". */
export function warnLine(warnDays: number[]): string {
  const days = [...warnDays].sort((a, b) => b - a).map((d) => `${d} ${d === 1 ? "day" : "days"}`);
  if (!days.length) return "Before a spot pauses";
  const list = days.length === 1 ? days[0] : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
  return `At ${list} of airings left`;
}

/** "orangestreet.example" from "https://orangestreet.example/". */
export function websiteShown(url: string | null): string {
  return (url ?? "").replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/** What the API takes (a full URL), from what someone typed; null when it's cleared. */
export function websiteToSave(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** The line stations see under the name: "Coffee and food. Redlands", "Plumbing. Riverside, 20 miles", "Online". */
export function whereLine(b: Pick<Business, "category" | "customersWhere" | "locations">): string {
  const first = b.locations[0];
  const where =
    b.customersWhere === "online" || !first ? "Online" : b.customersWhere === "service_area" && first.radiusMiles ? `${first.city}, ${first.radiusMiles} miles` : first.city;
  return `${b.category}. ${where}`;
}

/** The address as the field shows it: "204 Orange St, Redlands". */
export function addressLine(l: { streetAddress: string | null; city: string }): string {
  return l.streetAddress ? `${l.streetAddress}, ${l.city}` : l.city;
}

/** "Inland Empire", "Inland Empire and High Desert", "Inland Empire, High Desert and Los Angeles", in the markets' order. */
export function marketNames(ids: readonly string[], markets: readonly Pick<Market, "id" | "name">[]): string {
  const names = markets.filter((m) => ids.includes(m.id)).map((m) => m.name);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The market a business is in, by name: an online business's first chosen market; otherwise the
 * signed-in person's market (a location's market isn't stored on the business), else the first
 * open one. Null until the markets are known.
 */
export function homeMarketName(b: Pick<Business, "customersWhere" | "marketIds">, markets: readonly Pick<Market, "id" | "name" | "open">[], mine?: Pick<Market, "id"> | null): string | null {
  const byId = (id: string | undefined) => (id ? markets.find((m) => m.id === id) : undefined);
  const m = byId(b.customersWhere === "online" ? b.marketIds[0] : undefined) ?? byId(mine?.id) ?? byId(b.marketIds[0]) ?? markets.find((x) => x.open);
  return m?.name ?? null;
}
