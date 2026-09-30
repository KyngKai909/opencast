// External stations (network-desk 05.1, reworked in follow-up Phase 6): the reference's six rows in
// the Inland Empire. Redlands (the city's own player, embedding allowed), Colton (a stream link on
// the city's written permission; the reference draws a public basis, A215), San Bernardino County
// (its own player, no schedule found, down 14 minutes and off the dial), NASA on 61.1 (a public
// stream link with checked guide data), the school district whose terms are unclear, and Inland
// Community TV, a channel from an IPTV list waiting for its permission.
// Times are the mock clock's: Saturday, September 26, 8:42:12 pm in the Inland Empire.

import type { CreatorStage, ExternalOutage, ListedChange, StreamPermission } from "@opencast/contracts";
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
  // ---- A215 (2026-09-30): changing a listing, and taking it off for good ----
  /** Taken off the dial for good (archived, never deleted): when, by whom, and where it was. */
  removed?: { at: string; by: string | null; channel: string | null; band: "tv" | "radio" | null; marketId: string } | null;
  /** Its change history, newest first. */
  changes?: ListedChange[];
  /** Written permissions recorded before that don't cover its address now (kept, never edited), newest first. */
  earlierPermissions?: StreamPermission[];
  /** Its lead's stage before this listing put it On air. */
  leadStageBefore?: CreatorStage | null;
  /** Call signs it had before a change (or has while it's off the dial), held for it. */
  heldCallSigns?: string[];
  /** A231: taken off the dial with the listing on X.1 whose call sign it shares (that listing's id). */
  removedWith?: string | null;
}

/** The ids of the seed's listings, by call sign. */
export const LISTED_IDS = { RDLS: U(701), COLT: U(702), SBCO: U(703), RUSD: U(704), NASA: U(705), ICTV: U(706), LOMA: U(797), RIVC: U(751), RIVC_LIB: U(753) };

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
    // A215: Colton's stream link plays on the City Clerk's written permission (the reference draws a
    // public basis), so changing its address shows a listing waiting for new evidence.
    listing({
      id: LISTED_IDS.COLT, stationId: STATION_IDS.COLT, name: "City of Colton", description: "Council meetings", plays: "stream_link",
      streamUrl: "https://colton.example.gov/live/council.m3u8", embedTerms: "unclear",
      permission: {
        id: U(7201), grantedBy: "Maria Lopez, City Clerk, City of Colton", grantedOn: "2026-09-24", evidence: "Email to network@opencast.tv, Sept 24", documentUrl: null,
        streamUrl: "https://colton.example.gov/live/council.m3u8", recordedAt: "2026-09-24T17:10:00.000Z", recordedBy: "Dee A.", creatorId: null
      },
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
    }),
    // A201: a public-access channel's DASH stream link (.mpd), on the dial now that DASH stream
    // links are played (Settings, external.dash_stream_links). A mock source, with no schedule.
    listing({
      id: LISTED_IDS.LOMA, stationId: STATION_IDS.LOMA, name: "Loma Linda Community Access", description: "Public access: commissions, the school board and community notices", plays: "stream_link",
      streamUrl: "https://lomalinda.example.gov/live/manifest.mpd", embedTerms: "unclear", publicBasis: "Public access channel, stream published for the public",
      health: { state: "up", since: "2026-09-26T17:00:00.000Z", lastCheckedAt: CHECKED, detail: null }
    }),
    // A229: Riverside County's public streams, sharing RIVC on 15 (15.2 Public Works is listed in the demo).
    listing({
      id: LISTED_IDS.RIVC, stationId: STATION_IDS.RIVC, name: "Riverside County, Board of Supervisors", description: "Board meetings, from the county's own stream", plays: "stream_link",
      streamUrl: "https://riverside.example.gov/live/board/index.m3u8", embedTerms: "unclear", publicBasis: "County government, stream published for the public",
      health: { state: "up", since: "2026-09-20T17:00:00.000Z", lastCheckedAt: CHECKED, detail: null }
    }),
    listing({
      id: LISTED_IDS.RIVC_LIB, stationId: STATION_IDS.RIVC_LIB, name: "Riverside County Library Live", description: "Story times, author talks and classes", plays: "stream_link",
      streamUrl: "https://riverside.example.gov/live/library/index.m3u8", embedTerms: "unclear", publicBasis: "County library, stream published for the public",
      health: { state: "up", since: "2026-09-20T17:00:00.000Z", lastCheckedAt: CHECKED, detail: null }
    })
  ];
}
