// The Network desk's analytics (A251, added 2026-10-06; docs/analytics-map.md, the reference
// docs/reference/desk/opencast-desk-analytics.html). Opencast counts tuned-in sessions and devices,
// never people: these say "tuned in", "sessions", "devices" and "hours", never "viewers".
// Admins see every market; a market lead sees their own market's stations only (the API keeps them
// to it whatever they ask); rights reviewers don't see analytics.
import { z } from "zod";
import { endpoint } from "./core.js";
import { Id, Platform, Timestamp } from "./common.js";

/** Which band: both, TV or radio. */
export const AnalyticsBand = z.enum(["all", "tv", "radio"]);
export type AnalyticsBand = z.infer<typeof AnalyticsBand>;

/** How the desk sorts stations: `independent` (a creator's own, or a studio), `claimable`, `catalog`, `external`. */
export const AnalyticsStationKind = z.enum(["independent", "claimable", "catalog", "external"]);
export type AnalyticsStationKind = z.infer<typeof AnalyticsStationKind>;

/**
 * The filters every tab shares. `from` and `to` bound the span (hours are whole, days the market's);
 * `market` narrows to that market's stations (fixed to a market lead's own); `band` to one band.
 */
export const AnalyticsQuery = z.object({
  from: Timestamp,
  to: Timestamp,
  market: Id.optional(),
  band: AnalyticsBand.optional(),
  /**
   * Where the span compared against starts; it runs as long as the span. Left out, it's the span
   * just before. "Today" passes the same weekday last week, so it compares to the same minute.
   */
  previousFrom: Timestamp.optional()
});
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>;

export const AnalyticsMarket = z.object({ id: Id, slug: z.string(), name: z.string() });
export type AnalyticsMarket = z.infer<typeof AnalyticsMarket>;

/** What the page is showing and who's asking: the markets that can be picked, and the one fixed for a market lead. */
export const AnalyticsScope = z.object({
  from: Timestamp,
  to: Timestamp,
  /** The span before, of the same length, every change is against. */
  previousFrom: Timestamp,
  previousTo: Timestamp,
  markets: z.array(AnalyticsMarket),
  /** A market lead's market: the filter they can't remove. Null for admins. */
  fixedMarket: Id.nullable(),
  market: Id.nullable(),
  band: AnalyticsBand,
  /** When the totals were last worked out ("Updated today, 6:00 am"). */
  updatedAt: Timestamp.nullable()
});
export type AnalyticsScope = z.infer<typeof AnalyticsScope>;

/** A number with the same span before it, and its trend day by day across the span. */
export const AnalyticsMeasure = z.object({
  value: z.number().nullable(),
  previous: z.number().nullable(),
  byDay: z.array(z.number())
});
export type AnalyticsMeasure = z.infer<typeof AnalyticsMeasure>;

export const AnalyticsStation = z.object({
  id: Id,
  callSign: z.string().nullable(),
  channel: z.string().nullable(),
  name: z.string(),
  kind: AnalyticsStationKind,
  band: z.enum(["tv", "radio"]).nullable(),
  colour: z.string().nullable(),
  market: AnalyticsMarket.nullable()
});
export type AnalyticsStation = z.infer<typeof AnalyticsStation>;

export const AnalyticsOverview = z.object({
  scope: AnalyticsScope,
  /** Hours watched (listened, on the radio band): the number that adds up. */
  hoursWatched: AnalyticsMeasure,
  /** Average tuned in at once across the span. */
  averageTunedIn: AnalyticsMeasure,
  /** The busiest minute's tuned in, and when it was. */
  peakTunedIn: AnalyticsMeasure.extend({ at: Timestamp.nullable() }),
  /** Sessions counted, and how many were filtered as bots. */
  sessions: AnalyticsMeasure.extend({ botsFiltered: z.number().int() }),
  /** The median session's length, in minutes. */
  medianSessionMinutes: AnalyticsMeasure,
  /** Devices counted once across the span (the user's choice, A251); null before devices were counted. */
  devices: AnalyticsMeasure,
  /** Average tuned in, hour by hour, with the span before's at the same point. */
  tunedIn: z.array(z.object({ at: Timestamp, value: z.number(), previous: z.number().nullable() })),
  /** Hours watched by surface. */
  platforms: z.array(z.object({ platform: Platform, hours: z.number() })),
  /** Hours watched by where people are; `market` null for those Opencast couldn't place in one. */
  places: z.array(z.object({ market: AnalyticsMarket.nullable(), hours: z.number() })),
  /** Every station's hours, most first. */
  stations: z.array(z.object({ station: AnalyticsStation, hours: z.number(), previousHours: z.number().nullable() })),
  /** Counted apart, never in the totals: relays' own viewer counts. */
  relays: z.array(z.object({ station: AnalyticsStation, platform: z.enum(["youtube", "twitch"]), averageViewers: z.number(), peakViewers: z.number().int() }))
});
export type AnalyticsOverview = z.infer<typeof AnalyticsOverview>;

export const AnalyticsStationRow = z.object({
  station: AnalyticsStation,
  hours: z.number(),
  previousHours: z.number().nullable(),
  averageTunedIn: z.number(),
  peakTunedIn: z.number().int(),
  sessions: z.number().int(),
  /** Percent still there at a program's last minute of those at its first, averaged over its airings; null under the minimum or with no airings. */
  stayedToTheEnd: z.number().nullable(),
  /** "Not for me" votes per 1,000 hours watched; null under the minimum. */
  notForMePer1000Hours: z.number().nullable(),
  presets: z.number().int(),
  /** Minutes of dead-air fill and slate; null for an external station (it plays its own stream). */
  deadAirMinutes: z.number().int().nullable(),
  /** An external station's minutes down while someone was tuned in; null for the others. */
  timeDownMinutes: z.number().int().nullable(),
  /** Earned after card fees (from the ledger); null for an external station. */
  earnedMicros: z.number().int().nullable(),
  /** A claimable station's earnings are held in escrow. */
  held: z.boolean(),
  /** Never 20 tuned in at once in the span (`watch_data.minimum_audience`): no per-airing numbers. */
  underMinimum: z.boolean(),
  /** Hours watched, day by day. */
  byDay: z.array(z.number())
});
export type AnalyticsStationRow = z.infer<typeof AnalyticsStationRow>;

export const AnalyticsStations = z.object({
  scope: AnalyticsScope,
  rows: z.array(AnalyticsStationRow),
  /** The network row: hours and sessions added up; Stayed and "Not for me" weighted by hours; peak the network's own. */
  total: AnalyticsStationRow.omit({ station: true, held: true, underMinimum: true, timeDownMinutes: true })
});
export type AnalyticsStations = z.infer<typeof AnalyticsStations>;

export const analyticsApi = {
  overview: endpoint({
    method: "GET",
    path: "/desk/analytics/overview",
    auth: "desk",
    summary: "The network over a span against the span before: hours, tuned in, sessions, devices, surfaces, places, stations, relays apart (A251)",
    query: AnalyticsQuery,
    response: AnalyticsOverview
  }),
  stations: endpoint({
    method: "GET",
    path: "/desk/analytics/stations",
    auth: "desk",
    summary: "Every station's span in one table, with the network's row (A251)",
    query: AnalyticsQuery,
    response: AnalyticsStations
  })
};
