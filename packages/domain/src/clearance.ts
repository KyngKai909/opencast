// Where an item may air (programming Phase 6). One function answers it for every outlet: the
// station's own rights to the item (its basis, and the outlets an owner or a licence record
// allows), the carriage agreement it's carried under, and the network licences that cover it (the
// licensor's outlets, territories and dates). The API reads the rows; this decides.

import type { Licence } from "./licence.js";

/** Where something airs (contracts' `Outlet`). */
export const OUTLETS = ["opencast", "other_apps", "relays", "fast", "recording"] as const;
export type Outlet = (typeof OUTLETS)[number];

/** What rights rows made before 2026-10-10 have (and carriage terms): relays already carried them. */
export const DEFAULT_OUTLETS: readonly Outlet[] = ["opencast", "relays"];

export type ClearanceBasis = "made_it" | "owner_permission" | "public_domain" | "permission_record" | "licence_record";

/** A network licence, as clearance reads it. Dates are inclusive (`endsOn` is its last day on the air). */
export interface ClearanceLicence {
  id: string;
  licensor: string;
  outlets: readonly Outlet[];
  worldwide: boolean;
  /** ISO 3166-1 alpha-2, upper case. */
  countries: readonly string[];
  startsOn: string;
  endsOn: string;
}

export interface ClearanceItem {
  /** The station's confirmation; null: not confirmed, so it can't air anywhere. */
  rights: {
    basis: ClearanceBasis;
    /** For `owner_permission`, `permission_record` and `licence_record`; null or absent: `opencast` and `relays`. */
    outlets?: readonly Outlet[] | null;
    /** For `licence_record`: the licence the work is published under. */
    licence?: Licence | null;
  } | null;
  /** Carried under an agreement: the outlets its terms allow (null or absent: `opencast` and `relays`). */
  carriage?: { outlets?: readonly Outlet[] | null } | null;
  /** Network licences covering it (its own, or its program's). None: nothing more to check. */
  licences?: readonly ClearanceLicence[];
}

export type ClearanceReason =
  | "cleared"
  /** No rights confirmed. */
  | "rights_not_confirmed"
  /** The owner's permission (or the licence record's outlets) doesn't include the outlet. */
  | "not_in_rights"
  /** A non-commercial CC licence: never on FAST platforms. */
  | "licence_not_commercial"
  /** The carriage agreement doesn't include the outlet. */
  | "not_in_carriage"
  | "licence_not_started"
  | "licence_ended"
  /** The network licence doesn't include the outlet. */
  | "not_in_licence"
  /** The viewer's country isn't in the licence's territories. */
  | "outside_territory"
  /** No viewer country to check (a relay): only a worldwide licence clears it. */
  | "territory_unknown";

export interface Clearance {
  cleared: boolean;
  reason: ClearanceReason;
  /** The network licence the answer came from, when one did. */
  licence?: { id: string; licensor: string; endsOn: string };
  /** CC BY and BY-SA (and every other CC licence but CC0): cleared, keeping its attribution. */
  attribution?: boolean;
}

export interface ClearanceOptions {
  /** When it airs. */
  at: Date;
  /** Licence dates are read in this time zone (the station's); UTC when absent. */
  timeZone?: string;
}

/** CC0, CC BY and CC BY-SA allow every outlet, keeping their attribution. */
const OPEN_LICENCES: readonly Licence[] = ["cc0", "cc_by", "cc_by_sa"];
const NON_COMMERCIAL: readonly Licence[] = ["cc_by_nc", "cc_by_nc_sa", "cc_by_nc_nd"];

/** The date `at` falls on in `timeZone` ("2026-10-24"). */
export function dateIn(at: Date, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

const has = (outlets: readonly Outlet[] | null | undefined, outlet: Outlet) => outlet === "opencast" || (outlets ?? DEFAULT_OUTLETS).includes(outlet);

/** One licence's answer for an outlet, a country and a date. */
function byLicence(l: ClearanceLicence, outlet: Outlet, country: string | null, day: string): Clearance {
  const licence = { id: l.id, licensor: l.licensor, endsOn: l.endsOn };
  if (day < l.startsOn) return { cleared: false, reason: "licence_not_started", licence };
  if (day > l.endsOn) return { cleared: false, reason: "licence_ended", licence };
  if (!has(l.outlets, outlet)) return { cleared: false, reason: "not_in_licence", licence };
  // Opencast's own apps follow the dates only: we don't place our viewers in countries.
  if (outlet !== "opencast" && !l.worldwide) {
    if (!country) return { cleared: false, reason: "territory_unknown", licence };
    if (!l.countries.includes(country.toUpperCase())) return { cleared: false, reason: "outside_territory", licence };
  }
  return { cleared: true, reason: "cleared", licence };
}

/** How far a licence got before it said no: the closest one's reason is the one given. */
const DEPTH: Record<ClearanceReason, number> = {
  licence_not_started: 0,
  licence_ended: 0,
  not_in_licence: 1,
  territory_unknown: 2,
  outside_territory: 2,
  cleared: 3,
  rights_not_confirmed: -1,
  not_in_rights: -1,
  licence_not_commercial: -1,
  not_in_carriage: -1
};

/**
 * May `item` air on `outlet`, for a viewer in `country` (null: unknown, as on a relay), at
 * `options.at`? Cleared or not, with the reason:
 *
 *   - rights: none confirmed, nowhere. `made_it` and `public_domain` clear every outlet; so does a
 *     licence record under CC0, CC BY or CC BY-SA. A non-commercial CC licence never clears `fast`.
 *     Otherwise (`owner_permission`, `permission_record`, other licence records) the outlets
 *     recorded, `opencast` and `relays` by default;
 *   - carriage: the agreement's outlets;
 *   - network licences: one that covers it must be in force on the day (its dates are inclusive),
 *     list the outlet and, for anything but `opencast`, the viewer's country (or be worldwide).
 *
 * `opencast` is always allowed when the item can air at all: only missing rights and a licence's
 * dates take it off.
 */
export function clearance(item: ClearanceItem, outlet: Outlet, country: string | null, options: ClearanceOptions): Clearance {
  const rights = item.rights;
  if (!rights) return { cleared: false, reason: "rights_not_confirmed" };
  const licence = rights.basis === "licence_record" ? (rights.licence ?? null) : null;
  const attribution = licence !== null && licence !== "cc0" && licence.startsWith("cc_");
  if (rights.basis === "made_it" || rights.basis === "public_domain" || (licence && OPEN_LICENCES.includes(licence))) {
    // Every outlet.
  } else if (licence && NON_COMMERCIAL.includes(licence) && outlet === "fast") {
    return { cleared: false, reason: "licence_not_commercial" };
  } else if (!has(rights.outlets, outlet)) {
    return { cleared: false, reason: "not_in_rights" };
  }
  if (item.carriage && !has(item.carriage.outlets, outlet)) return { cleared: false, reason: "not_in_carriage" };
  const licences = item.licences ?? [];
  if (licences.length) {
    const day = dateIn(options.at, options.timeZone);
    const answers = licences.map((l) => byLicence(l, outlet, country, day));
    const best = answers.find((a) => a.cleared) ?? answers.reduce((a, b) => (DEPTH[b.reason] > DEPTH[a.reason] ? b : a));
    if (!best.cleared) return best;
    return attribution ? { ...best, attribution } : best;
  }
  return attribution ? { cleared: true, reason: "cleared", attribution } : { cleared: true, reason: "cleared" };
}

/**
 * A covering licence that ends within `days` of `at` (its last day included), the soonest first;
 * null when none does, or one covering it runs on past that.
 */
export function licenceEnding(licences: readonly ClearanceLicence[], options: ClearanceOptions & { days: number }): ClearanceLicence | null {
  if (!licences.length) return null;
  const today = dateIn(options.at, options.timeZone);
  const horizon = dateIn(new Date(options.at.getTime() + options.days * 86_400_000), options.timeZone);
  // The last day any of them airs it.
  const last = licences.reduce((a, b) => (b.endsOn > a.endsOn ? b : a));
  return last.endsOn >= today && last.endsOn <= horizon ? last : null;
}

/** "Not on your YouTube relay": the quiet note for an outlet it isn't cleared for. */
export function notClearedNote(outlet: Outlet, platforms: readonly string[] = []): string {
  if (outlet === "relays") {
    if (!platforms.length) return "Not on your relays";
    const names = platforms.length === 1 ? platforms[0] : `${platforms.slice(0, -1).join(", ")} and ${platforms[platforms.length - 1]}`;
    return `Not on your ${names} ${platforms.length === 1 ? "relay" : "relays"}`;
  }
  if (outlet === "other_apps") return "Not in other apps";
  if (outlet === "fast") return "Not on FAST platforms";
  if (outlet === "recording") return "Viewers can't record it";
  return "Not on Opencast";
}
