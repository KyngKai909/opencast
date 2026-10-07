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

/** A number for one station, with the span before and the network's for comparison (Ref. 12d 03). */
export const AnalyticsVsNetwork = AnalyticsMeasure.extend({ network: z.number().nullable() });
export type AnalyticsVsNetwork = z.infer<typeof AnalyticsVsNetwork>;

/** Where an airing came from: its own library, carried from another station, live, or an external station's guide. */
export const AnalyticsAiringSource = z.enum(["library", "carried", "live", "guide", "nothing_listed"]);
export type AnalyticsAiringSource = z.infer<typeof AnalyticsAiringSource>;

export const AnalyticsAiring = z.object({
  key: z.string(),
  title: z.string(),
  source: AnalyticsAiringSource,
  /** The station it was carried from. */
  from: AnalyticsStation.nullable(),
  startedAt: Timestamp,
  endedAt: Timestamp,
  averageTunedIn: z.number(),
  peakTunedIn: z.number().int(),
  /** Percent of those at its first minute still there at its last; null with nobody at the start. */
  stayedToTheEnd: z.number().int().nullable(),
  notForMePer1000Hours: z.number().nullable(),
  hours: z.number()
});
export type AnalyticsAiring = z.infer<typeof AnalyticsAiring>;

/** One end of a change between stations: another station, or null for "Started here" / "Stopped here". */
export const AnalyticsFlow = z.object({ station: AnalyticsStation.nullable(), changes: z.number().int(), share: z.number() });
export type AnalyticsFlow = z.infer<typeof AnalyticsFlow>;

export const AnalyticsStationPage = z.object({
  scope: AnalyticsScope,
  station: AnalyticsStation.extend({ onDialSince: Timestamp.nullable() }),
  hoursWatched: AnalyticsMeasure.extend({ shareOfNetwork: z.number().nullable() }),
  averageTunedIn: AnalyticsMeasure,
  peakTunedIn: AnalyticsMeasure.extend({ at: Timestamp.nullable() }),
  stayedToTheEnd: AnalyticsVsNetwork,
  notForMePer1000Hours: AnalyticsVsNetwork,
  underMinimum: z.boolean(),
  /**
   * Its busiest night in the span (6 pm to 2 am, the market's time), minute by minute, against the
   * same night a week before, with its breaks. Null when the span's minutes are past the 30 days kept.
   */
  night: z
    .object({
      from: Timestamp,
      to: Timestamp,
      minutes: z.array(z.object({ at: Timestamp, value: z.number().int(), previous: z.number().int().nullable() })),
      breaks: z.array(z.object({ start: Timestamp, end: Timestamp })),
      airings: z.array(AnalyticsAiring)
    })
    .nullable(),
  /** Airings in the whole span. */
  airingsInSpan: z.number().int(),
  platforms: z.array(z.object({ platform: Platform, hours: z.number() })),
  /** By where viewers are; `own` marks the station's own market. */
  places: z.array(z.object({ market: AnalyticsMarket.nullable(), own: z.boolean(), hours: z.number() })),
  /** Where its sessions came from and went to: "Started here" and "Stopped here" (station null), then other stations, most first. */
  cameFrom: z.array(AnalyticsFlow),
  wentTo: z.array(AnalyticsFlow),
  /** How its airtime was filled, minutes from the as-run log; null for an external station. */
  airtime: z.object({ programs: z.number().int(), breaks: z.number().int(), live: z.number().int(), deadAir: z.number().int() }).nullable(),
  /** Earned in the span after card fees, by kind; null for an external station. */
  earned: z
    .object({
      spotsMicros: z.number().int(),
      sponsorsMicros: z.number().int(),
      pledgesMicros: z.number().int(),
      pledgeMembers: z.number().int(),
      carriageInMicros: z.number().int(),
      cardFeesMicros: z.number().int(),
      totalMicros: z.number().int(),
      held: z.boolean()
    })
    .nullable(),
  /** Spots and sponsors per 1,000 hours watched; null with no hours or no earnings. */
  adMicrosPer1000Hours: z.number().int().nullable(),
  /** An external station's minutes down in the span. */
  timeDownMinutes: z.number().int().nullable(),
  /**
   * Added Phase 6: what it cost Opencast to run, estimated from what it used and the Costs rules
   * (each null while its price is "Not set yet"), against what it was charged. Null for an external station.
   */
  cost: z
    .object({
      storageGb: z.number(),
      storageMicros: z.number().int().nullable(),
      relayHours: z.number(),
      relayMicros: z.number().int().nullable(),
      liveHours: z.number(),
      liveMicros: z.number().int().nullable(),
      totalMicros: z.number().int().nullable(),
      chargedMicros: z.number().int(),
      /** Percent of its breaks that had spots in them. */
      breaksWithSpots: z.number().nullable()
    })
    .nullable()
    .optional()
});
export type AnalyticsStationPage = z.infer<typeof AnalyticsStationPage>;

/** The Audience tab's filters: the shared ones, and one station to narrow every chart to. */
export const AnalyticsAudienceQuery = AnalyticsQuery.extend({ station: Id.optional() });
export type AnalyticsAudienceQuery = z.infer<typeof AnalyticsAudienceQuery>;

/** Ref. 12d 04 Audience: when, how long, on what, and from where (and, A251's additions, devices and how people tuned in). */
export const AnalyticsAudience = z.object({
  scope: AnalyticsScope,
  /** The station every chart is narrowed to, if one is; and the stations that can be picked. */
  station: AnalyticsStation.nullable(),
  stations: z.array(AnalyticsStation),
  /**
   * Average tuned in by day of the week and hour (the market's time): `weekday` 0 is Monday. With
   * the span before's at the same hour, when it has one.
   */
  grid: z.array(z.object({ weekday: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23), value: z.number(), previous: z.number().nullable() })),
  /** Sessions by length band: `1_2` (the shortest counted, under 2 minutes), `2_5`, `5_15`, `15_30`, `30_60`, `60_120`, `120_plus`. */
  lengths: z.array(z.object({ band: z.string(), sessions: z.number().int(), share: z.number() })),
  sessions: AnalyticsMeasure,
  medianMinutes: z.number().nullable(),
  averageMinutes: z.number().nullable(),
  /** Stations a visit (a tab's or TV app run's sessions) tuned, on average. */
  stationsPerVisit: z.number().nullable(),
  /** Percent of tune-ins that came from another station (a change, not a start). */
  cameFromAnotherStation: z.number().nullable(),
  bots: z.object({ sessions: z.number().int(), share: z.number().nullable(), reasons: z.array(z.object({ reason: z.string(), sessions: z.number().int() })) }),
  presets: z.object({ total: z.number().int(), added: z.number().int(), stations: z.array(z.object({ station: AnalyticsStation, total: z.number().int(), added: z.number().int() })) }),
  /** Hours by surface, day by day. */
  platformsByDay: z.array(z.object({ day: z.string(), phone: z.number(), web: z.number(), tv_app: z.number(), cast: z.number(), mirror: z.number() })),
  /** Relays: average viewers on each platform, day by day; never billed, never in the totals. */
  relays: z.object({
    byDay: z.array(z.object({ day: z.string(), youtube: z.number(), twitch: z.number() })),
    youtubeStations: z.number().int(),
    twitchStations: z.number().int(),
    hours: z.number(),
    /** Relay hours as a percent of Opencast's own hours in the same view. */
    shareOfOwn: z.number().nullable()
  }),
  /** The most common changes from one station to another, with each as a share of the From station's changes to other stations. */
  moves: z.array(z.object({ from: AnalyticsStation, to: AnalyticsStation, changes: z.number().int(), shareOfFrom: z.number() })),
  /** Devices counted once (A251): the span's (up to 30 days), the span before's, and the share seen in the 30 days before. */
  devices: z.object({ value: z.number().int().nullable(), previous: z.number().int().nullable(), returningShare: z.number().nullable(), byDay: z.array(z.number()) }),
  /** How sessions were tuned (A251, `Heartbeat.via`, counted since it was added), most first; `unknown` for players that don't say. */
  via: z.array(z.object({ via: z.string(), sessions: z.number().int(), share: z.number() }))
});
export type AnalyticsAudience = z.infer<typeof AnalyticsAudience>;

/** A program across every station that aired it (Ref. 12d 05): its own airings and carriers' added up. */
export const AnalyticsProgram = z.object({
  programId: Id,
  title: z.string(),
  /** The station that makes it (null for a catalog program: "Opencast catalog"). */
  maker: AnalyticsStation.nullable(),
  catalog: z.boolean(),
  /** Any of its airings was live. */
  live: z.boolean(),
  /** Every station that aired it in the span, the maker first. */
  stations: z.array(AnalyticsStation),
  airings: z.number().int(),
  hours: z.number(),
  averageTunedIn: z.number(),
  /** Percent of those at its airings' first minutes still there at their last; null under the minimum. */
  stayedToTheEnd: z.number().nullable(),
  notForMePer1000Hours: z.number().nullable(),
  underMinimum: z.boolean()
});
export type AnalyticsProgram = z.infer<typeof AnalyticsProgram>;

/** Break hold: of those tuned in when breaks started, the percent still there when they ended. */
export const AnalyticsBreakHold = z.object({ breaks: z.number().int(), tunedAtStart: z.number().int(), held: z.number().nullable() });
export type AnalyticsBreakHold = z.infer<typeof AnalyticsBreakHold>;

export const AnalyticsPrograms = z.object({
  scope: AnalyticsScope,
  /** Every program aired in the span, most hours first. */
  programs: z.array(AnalyticsProgram),
  breaks: z.object({
    all: AnalyticsBreakHold,
    /** By length: `30` (up to 0:30), `60`, `90`, `120`, `150_plus` (2:30 and longer). */
    byLength: z.array(AnalyticsBreakHold.extend({ band: z.string() })),
    byPosition: z.array(AnalyticsBreakHold.extend({ position: z.enum(["opening", "inside", "between"]) })),
    byFirst: z.array(AnalyticsBreakHold.extend({ first: z.enum(["bumper", "spot", "sponsor", "station_id", "other"]) })),
    /** Percent of breaks that opened with a bumper. */
    bumperShare: z.number().nullable()
  })
});
export type AnalyticsPrograms = z.infer<typeof AnalyticsPrograms>;

/** One program's airings in the span, still watching minute by minute (Ref. 12d 05's curve). */
export const AnalyticsProgramDetail = z.object({
  scope: AnalyticsScope,
  program: AnalyticsProgram,
  /** Percent of the first minute's audience still there at each minute (index 0 is the first minute, 100). */
  stillWatching: z.array(z.number()),
  /** Tune-aways at each minute, all airings added up. */
  tuneAways: z.array(z.number().int()),
  /** Its breaks, minutes from the start, as its biggest airing aired them. */
  breaks: z.array(z.object({ from: z.number(), to: z.number() })),
  atStart: z.number().int(),
  stillAtEnd: z.number().int(),
  /** The minute that lost the most, in points, and whether a break was on then. */
  biggestDrop: z.object({ minute: z.number().int(), points: z.number(), inBreak: z.boolean() }).nullable()
});
export type AnalyticsProgramDetail = z.infer<typeof AnalyticsProgramDetail>;

/** Ref. 12d 06 Money: what stations earned, what Opencast took, and what it cost. Amounts in micros. */
export const AnalyticsMoney = z.object({
  scope: AnalyticsScope,
  /** Opencast's share of earnings is set (the shares rule). Unset, nothing is taken and its line says "Not set yet". */
  shareSet: z.boolean(),
  /** Independent stations' earnings after card fees. */
  earnedByStations: AnalyticsMeasure,
  /** Claimable stations' earnings, into escrow, and how many stations. */
  heldForClaimable: AnalyticsMeasure.extend({ stations: z.number().int() }),
  /** Catalog stations' earnings (catalog sponsors, until the catalog sponsorship share is set). */
  catalogSponsors: AnalyticsMeasure,
  /** Pay-as-you-go charges (storage, relays, live). */
  payAsYouGo: AnalyticsMeasure,
  /** Opencast's cost to run, estimated; `complete` false while some Costs rules are "Not set yet". */
  costToRun: AnalyticsMeasure.extend({ complete: z.boolean() }),
  /** Earnings week by week (before card fees), the 8 weeks to the span's end. */
  weeks: z.array(z.object({ from: Timestamp, spots: z.number().int(), sponsors: z.number().int(), pledges: z.number().int(), catalogSponsors: z.number().int() })),
  spotMarket: z.object({
    breaksAired: z.number().int(),
    breaksWithSpots: z.number().int(),
    spotsAired: z.number().int(),
    spotsAiredBefore: z.number().int().nullable(),
    /** The average per-thousand rate of the spots that aired. */
    perThousandMicros: z.number().int().nullable(),
    businesses: z.number().int(),
    businessesBefore: z.number().int().nullable(),
    /** Money set aside for spots placed to air in the week after the span. */
    heldNextWeekMicros: z.number().int()
  }),
  /** Spots and sponsors per 1,000 hours watched, by station, most first. */
  per1000Hours: z.array(z.object({ station: AnalyticsStation, micros: z.number().int(), held: z.boolean() })),
  /** Opencast's span: charges in, estimated costs out (null: price not set yet), and what's measured. */
  opencast: z.object({
    in: z.object({ storage: z.number().int(), relays: z.number().int(), live: z.number().int(), share: z.number().int().nullable() }),
    out: z.object({ storage: z.number().int().nullable(), preparing: z.number().int().nullable(), relays: z.number().int().nullable(), live: z.number().int().nullable(), platform: z.number().int().nullable() }),
    net: z.number().int(),
    measured: z.object({ storageGb: z.number(), prepareMinutes: z.number().int(), relayHours: z.number(), liveHours: z.number() })
  }),
  /** Claimable stations' money in escrow until each creator claims. */
  held: z.array(z.object({ station: AnalyticsStation, since: Timestamp.nullable(), balanceMicros: z.number().int(), addedMicros: z.number().int() })),
  /** Carriage, between stations, so never in the totals. */
  carriage: z.object({ agreements: z.number().int(), cashMicros: z.number().int(), barterMicros: z.number().int(), barterMinutes: z.number().int(), programsCarried: z.number().int() })
});
export type AnalyticsMoney = z.infer<typeof AnalyticsMoney>;

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
  }),
  programs: endpoint({
    method: "GET",
    path: "/desk/analytics/programs",
    auth: "desk",
    summary: "Programs across every station that aired them, and break hold by length, position and first element (A251, Ref. 12d 05)",
    query: AnalyticsQuery,
    response: AnalyticsPrograms
  }),
  program: endpoint({
    method: "GET",
    path: "/desk/analytics/programs/:programId",
    auth: "desk",
    summary: "One program's airings in the span: still watching minute by minute, tune-aways, its breaks, the biggest drop (A251, Ref. 12d 05)",
    params: z.object({ programId: Id }),
    query: AnalyticsQuery,
    response: AnalyticsProgramDetail
  }),
  money: endpoint({
    method: "GET",
    path: "/desk/analytics/money",
    auth: "desk",
    summary: "Stations' earnings by kind, held for claimable stations, catalog sponsors, the spot market, per 1,000 hours, Opencast's charges against its estimated cost to run, carriage (A251, Ref. 12d 06)",
    query: AnalyticsQuery,
    response: AnalyticsMoney
  }),
  audience: endpoint({
    method: "GET",
    path: "/desk/analytics/audience",
    auth: "desk",
    summary: "The network's audience in depth: the hour-by-day grid, session lengths, presets, surfaces and relays by day, moves between stations, devices, how people tuned in (A251, Ref. 12d 04)",
    query: AnalyticsAudienceQuery,
    response: AnalyticsAudience
  }),
  station: endpoint({
    method: "GET",
    path: "/desk/analytics/stations/:stationId",
    auth: "desk",
    summary: "One station's span: its numbers against the network's, its busiest night by the minute, airings, surfaces, places, flow, airtime and earnings (A251, Ref. 12d 03)",
    params: z.object({ stationId: Id }),
    query: AnalyticsQuery.omit({ market: true, band: true }),
    response: AnalyticsStationPage
  })
};
