// External stations (network-desk 05.1, reworked in follow-up Phase 6): the reference's six rows in
// the Inland Empire. Redlands (the city's own player, embedding allowed), Colton (a public body's
// stream link), San Bernardino County (its own player, no schedule found, down 14 minutes and off
// the dial), NASA on 61.1 (a public stream link with checked guide data), the school district whose
// terms are unclear, and Inland Community TV, a channel from an IPTV list waiting for its permission.
// Times are the mock clock's: Saturday, September 26, 8:42:12 pm in the Inland Empire.

import type { ExternalOutage, StreamPermission } from "@opencast/contracts";
import { CREATOR_IDS, ICTV_STREAM } from "./creators";
import { U } from "./ids";
import { STATION_IDS } from "./stations";

export interface DbListed {
  id: string;
  stationId: string;
  name: string;
  description: string | null;
  streamUrl: string;
  embedTerms: "allowed" | "unclear";
  calendarUrl: string | null;
  calendarSync: "synced" | "calendar_not_found" | "not_set";
  lastSyncedAt: string | null;
  upcoming: number;
  plays: "embed" | "stream_link";
  termsUrl: string | null;
  termsCheckedOn: string | null;
  publicBasis: string | null;
  permission: StreamPermission | null;
  /** What's being waited on: "Asked Sept 22". */
  note: string | null;
  schedule: { source: "feed" | "guide_data" | "none"; format: "ical" | "rss" | "json" | "xmltv" | null; checkedAgainst: string | null; checkedOn: string | null };
  /** The source is outside its market (waits unless Settings allows other markets' streams). */
  outsideMarket: boolean;
  health: { state: "unchecked" | "up" | "down" | "hidden"; since: string | null; lastCheckedAt: string | null; detail: string | null };
  /** Every outage, newest first. */
  outages: ExternalOutage[];
  /** The pipeline lead it came from. */
  creatorId: string | null;
  /** When the desk added it (a new listing is checked a minute later). */
  addedAt?: string;
}

/** The ids of the seed's listings, by call sign. */
export const LISTED_IDS = { RDLS: U(701), COLT: U(702), SBCO: U(703), RUSD: U(704), NASA: U(705), ICTV: U(706) };

/** The last minute's check, just before the mock clock's 8:42:12 pm. */
const CHECKED = "2026-09-27T03:42:00.000Z";

const listing = (fields: Partial<DbListed> & Pick<DbListed, "id" | "stationId" | "name" | "streamUrl" | "plays">): DbListed => ({
  description: null,
  embedTerms: "allowed",
  calendarUrl: null,
  calendarSync: "not_set",
  lastSyncedAt: null,
  upcoming: 0,
  termsUrl: null,
  termsCheckedOn: null,
  publicBasis: null,
  permission: null,
  note: null,
  schedule: { source: "none", format: null, checkedAgainst: null, checkedOn: null },
  outsideMarket: false,
  health: { state: "unchecked", since: null, lastCheckedAt: null, detail: null },
  outages: [],
  creatorId: null,
  ...fields
});

export function seedListed(): DbListed[] {
  return [
    listing({
      id: LISTED_IDS.RDLS, stationId: STATION_IDS.RDLS, name: "City of Redlands", description: "Council and planning meetings", plays: "embed",
      streamUrl: "https://redlands.example.gov/meetings/live", termsUrl: "https://redlands.example.gov/terms-of-use", termsCheckedOn: "2026-09-21",
      calendarUrl: "https://redlands.example.gov/agenda/calendar.ics", calendarSync: "synced", lastSyncedAt: "2026-09-27T02:00:00.000Z", upcoming: 6,
      schedule: { source: "feed", format: "ical", checkedAgainst: null, checkedOn: null },
      health: { state: "up", since: "2026-09-20T17:00:00.000Z", lastCheckedAt: CHECKED, detail: null }
    }),
    listing({
      id: LISTED_IDS.COLT, stationId: STATION_IDS.COLT, name: "City of Colton", description: "Council meetings", plays: "stream_link",
      streamUrl: "https://colton.example.gov/live/council.m3u8", embedTerms: "unclear", publicBasis: "Public body, stream published for the public",
      calendarUrl: "https://colton.example.gov/agenda/calendar.ics", calendarSync: "synced", lastSyncedAt: "2026-09-27T02:00:00.000Z", upcoming: 2,
      schedule: { source: "feed", format: "ical", checkedAgainst: null, checkedOn: null },
      health: { state: "up", since: "2026-09-26T02:12:00.000Z", lastCheckedAt: CHECKED, detail: null },
      // A blip on Friday evening: back before it left the dial.
      outages: [{ id: U(7101), downSince: "2026-09-26T02:10:00.000Z", hiddenAt: null, backAt: "2026-09-26T02:12:00.000Z", detail: "No answer in 5 seconds" }]
    }),
    listing({
      id: LISTED_IDS.SBCO, stationId: STATION_IDS.SBCO, name: "San Bernardino County", description: "Board of Supervisors", plays: "embed",
      streamUrl: "https://sanbernardino.example.gov/live", termsUrl: "https://sanbernardino.example.gov/website-terms", termsCheckedOn: "2026-09-18",
      // Down since 8:28 pm, off the dial since 8:33 pm: "Down 14 min" at the mock clock.
      health: { state: "hidden", since: "2026-09-27T03:28:00.000Z", lastCheckedAt: CHECKED, detail: "HTTP 503" },
      outages: [
        { id: U(7103), downSince: "2026-09-27T03:28:00.000Z", hiddenAt: "2026-09-27T03:33:00.000Z", backAt: null, detail: "HTTP 503" },
        { id: U(7102), downSince: "2026-09-25T03:43:00.000Z", hiddenAt: "2026-09-25T03:48:00.000Z", backAt: "2026-09-25T04:02:00.000Z", detail: "HTTP 503" }
      ]
    }),
    listing({
      id: LISTED_IDS.NASA, stationId: STATION_IDS.NASA, name: "NASA", description: "Launches and live coverage", plays: "stream_link",
      streamUrl: "https://nasa.example.gov/live/public/master.m3u8", embedTerms: "unclear", publicBasis: "US government, public",
      calendarUrl: "https://guide.example.net/nasa/guide.xml", calendarSync: "synced", lastSyncedAt: "2026-09-27T02:00:00.000Z", upcoming: 5,
      schedule: { source: "guide_data", format: "xmltv", checkedAgainst: "https://nasa.example.gov/live/schedule", checkedOn: "2026-09-25" },
      health: { state: "up", since: "2026-09-15T17:00:00.000Z", lastCheckedAt: CHECKED, detail: null }
    }),
    listing({
      id: LISTED_IDS.RUSD, stationId: STATION_IDS.RUSD, name: "Riverside Unified School District", description: "Board meetings", plays: "embed",
      streamUrl: "https://rusd.example.org/board/live", embedTerms: "unclear", note: "Asked Sept 22"
    }),
    listing({
      id: LISTED_IDS.ICTV, stationId: STATION_IDS.ICTV, name: "Inland Community TV", description: "A community channel's raw stream", plays: "stream_link",
      streamUrl: ICTV_STREAM, embedTerms: "unclear", creatorId: CREATOR_IDS.ictv
    })
  ];
}
