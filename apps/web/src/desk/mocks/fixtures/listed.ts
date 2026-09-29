// Listed sources (network-desk 05.1): three city streams on channel 9, and the school district
// whose terms are being checked (no channel yet).
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
  listingState: "not_listed" | "checking" | "listed";
  lastSyncedAt: string | null;
  upcoming: number;
}

export function seedListed(): DbListed[] {
  return [
    { id: U(701), stationId: STATION_IDS.RDLS, name: "City of Redlands", description: "Council and planning meetings, the city's official stream", streamUrl: "https://www.cityofredlands.org/meetings/live", embedTerms: "allowed", calendarUrl: "https://redlands.example.gov/agenda/calendar.ics", calendarSync: "synced", listingState: "listed", lastSyncedAt: "2026-09-27T02:00:00.000Z", upcoming: 6 },
    { id: U(702), stationId: STATION_IDS.COLT, name: "City of Colton", description: "Council meetings", streamUrl: "https://www.coltonca.gov/meetings/live", embedTerms: "allowed", calendarUrl: "https://colton.example.gov/agenda/calendar.ics", calendarSync: "synced", listingState: "listed", lastSyncedAt: "2026-09-27T02:00:00.000Z", upcoming: 2 },
    { id: U(703), stationId: STATION_IDS.SBCO, name: "San Bernardino County", description: "Board of Supervisors", streamUrl: "https://sanbernardino.example.gov/live", embedTerms: "allowed", calendarUrl: "https://sanbernardino.example.gov/board/agenda", calendarSync: "calendar_not_found", listingState: "listed", lastSyncedAt: null, upcoming: 0 },
    { id: U(704), stationId: STATION_IDS.RUSD, name: "Riverside Unified School District", description: "Board meetings", streamUrl: "https://rusd.example.org/board/live", embedTerms: "unclear", calendarUrl: null, calendarSync: "not_set", listingState: "checking", lastSyncedAt: null, upcoming: 0 }
  ];
}
