// Programming Phase 6 (added 2026-10-10): where a program can air. Rights used to answer only "may
// this station air it?"; outlets say where else it may go (other apps, relays, FAST platforms,
// recording), and network licences hold what Opencast licenses from distributors: the licensor,
// what it covers, outlets, territories, dates and the deal. `clearance` in `@opencast/domain` reads
// them; these are the shapes the API and the apps share.

import { z } from "zod";
import { endpoint } from "./core.js";
import { DateOnly, Id, Micros, StationIdent, Timestamp } from "./common.js";

/**
 * Where something airs. `opencast`: our own apps, web, TV and Cast (always allowed when the item can
 * air at all). `other_apps`: the M3U and XMLTV, our stream in someone else's player. `relays`:
 * YouTube, Twitch, Facebook and the other relay platforms. `fast`: FAST platforms (individual ones
 * may be named later, as `fast:<platform>`; nothing does yet). `recording`: viewers may record it.
 */
export const Outlet = z.enum(["opencast", "other_apps", "relays", "fast", "recording"]);
export type Outlet = z.infer<typeof Outlet>;

export const OUTLET_WORDS: Record<Outlet, { label: string; detail: string }> = {
  opencast: { label: "Opencast", detail: "Our own apps, web, TV and Cast. Always on" },
  other_apps: { label: "Other apps", detail: "The channel list and guide, played in apps like TiviMate, Jellyfin and VLC" },
  relays: { label: "Relays", detail: "YouTube, Twitch, Facebook and the other relay platforms" },
  fast: { label: "FAST platforms", detail: "Free ad-supported channels on other services" },
  recording: { label: "Recording", detail: "Viewers may record it" }
};

/** What rows made before 2026-10-10 have: relays already carried them. */
export const DEFAULT_OUTLETS: Outlet[] = ["opencast", "relays"];

/** Outlets, with `opencast` always in and each once, in the enum's order. */
export const outletsWithOpencast = (outlets: readonly Outlet[] | null | undefined): Outlet[] => Outlet.options.filter((o) => o === "opencast" || (outlets ?? DEFAULT_OUTLETS).includes(o));

/** An ISO 3166-1 alpha-2 country code, upper case: "US", "CA". */
export const CountryCode = z.string().regex(/^[A-Z]{2}$/, "A two-letter country code, like US");

/** The deal: plain fields, no money moves yet. */
export const LicenceDeal = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rev_share"), percent: z.number().min(0).max(100) }),
  z.object({ kind: z.literal("flat_fee"), feeMicros: Micros.nonnegative(), per: z.enum(["month", "term"]) }),
  z.object({ kind: z.literal("none") })
]);
export type LicenceDeal = z.infer<typeof LicenceDeal>;

/**
 * Where a licence stands today: `upcoming` (before its start), `active`, `ending` (it ends within
 * two weeks: the log warns), `ended` (what it covers is off the air).
 */
export const NetworkLicenceState = z.enum(["upcoming", "active", "ending", "ended"]);

/** A program or a single item a licence covers. */
export const LicenceCovered = z.object({
  kind: z.enum(["program", "item"]),
  id: Id,
  title: z.string(),
  station: StationIdent.nullable()
});

export const NetworkLicence = z.object({
  id: Id,
  /** Who licenses it to Opencast: "Prairie Films". */
  licensor: z.string(),
  /** What the deal is called, when it has a name: "Westerns package". */
  name: z.string().nullable(),
  outlets: z.array(Outlet),
  /** Worldwide, or only the countries listed. */
  worldwide: z.boolean(),
  countries: z.array(CountryCode),
  /** Inclusive, both: the last day it airs is `endsOn`. */
  startsOn: DateOnly,
  endsOn: DateOnly,
  deal: LicenceDeal,
  notes: z.string().nullable(),
  covers: z.array(LicenceCovered),
  state: NetworkLicenceState,
  /** Days left until it ends (0 on its last day), while it hasn't ended. */
  daysLeft: z.number().int().nullable(),
  updatedAt: Timestamp
});
export type NetworkLicence = z.infer<typeof NetworkLicence>;

export const NetworkLicenceInput = z.object({
  licensor: z.string().trim().min(1).max(120),
  name: z.string().trim().max(120).nullable().optional(),
  outlets: z.array(Outlet).max(5),
  worldwide: z.boolean(),
  countries: z.array(CountryCode).max(250),
  startsOn: DateOnly,
  endsOn: DateOnly,
  deal: LicenceDeal,
  notes: z.string().max(1000).nullable().optional(),
  /** Programs (every episode) and single items it covers. */
  programIds: z.array(Id).max(500),
  itemIds: z.array(Id).max(2000)
});
export type NetworkLicenceInput = z.infer<typeof NetworkLicenceInput>;

/**
 * One line of the licensor's monthly report: minutes aired and viewer hours, for one station on
 * one outlet. `viewerHours` is null where there's no watch data for it (an outlet nothing counts).
 */
export const LicensorMinutesRow = z.object({
  station: StationIdent,
  outlet: Outlet,
  airings: z.number().int(),
  minutesAired: z.number(),
  viewerHours: z.number().nullable()
});

export const LicensorMinutes = z.object({
  licenceId: Id,
  licensor: z.string(),
  name: z.string().nullable(),
  /** "2026-10". */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  /** The month's first and last days the licence was in force. */
  from: DateOnly,
  to: DateOnly,
  /** Every airing on Opencast, each outlet's share of it below. */
  minutesAired: z.number(),
  airings: z.number().int(),
  viewerHours: z.number().nullable(),
  stations: z.array(z.object({ station: StationIdent, airings: z.number().int(), minutesAired: z.number(), viewerHours: z.number().nullable() })),
  /** Each outlet it went out on: minutes it carried, viewer hours where counted. */
  outlets: z.array(z.object({ outlet: Outlet, minutesAired: z.number(), viewerHours: z.number().nullable() })),
  rows: z.array(LicensorMinutesRow)
});
export type LicensorMinutes = z.infer<typeof LicensorMinutes>;

const LicenceParams = z.object({ licenceId: Id });
const MonthQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM").optional() });

export const licencesApi = {
  listLicences: endpoint({
    method: "GET",
    path: "/admin/licences",
    auth: "desk",
    summary: "Programming Phase 6: network licences, ending soonest first, ended ones last",
    response: z.array(NetworkLicence)
  }),
  getLicence: endpoint({ method: "GET", path: "/admin/licences/:licenceId", auth: "desk", summary: "A network licence and what it covers", params: LicenceParams, response: NetworkLicence }),
  createLicence: endpoint({
    method: "POST",
    path: "/admin/licences",
    auth: "desk",
    summary: "A new network licence (rights reviewers and admins). `opencast` is always among its outlets; 400 when it ends before it starts, or lists no countries and isn't worldwide",
    body: NetworkLicenceInput,
    response: NetworkLicence,
    status: 201
  }),
  updateLicence: endpoint({
    method: "PATCH",
    path: "/admin/licences/:licenceId",
    auth: "desk",
    summary: "Changes a network licence (rights reviewers and admins). What it covers is replaced when sent",
    params: LicenceParams,
    body: NetworkLicenceInput.partial(),
    response: NetworkLicence
  }),
  licenceMinutes: endpoint({
    method: "GET",
    path: "/admin/licences/:licenceId/minutes",
    auth: "desk",
    summary: "The licensor's monthly report from the as-run log: minutes aired by station and outlet, viewer hours where watch data has them (`month` defaults to this one)",
    params: LicenceParams,
    query: MonthQuery,
    response: LicensorMinutes
  }),
  licenceMinutesCsv: endpoint({
    method: "GET",
    path: "/admin/licences/:licenceId/minutes/csv",
    auth: "desk",
    summary: "The same report as CSV, a row per station and outlet",
    params: LicenceParams,
    query: MonthQuery,
    response: z.object({ filename: z.string(), csv: z.string() })
  })
};
