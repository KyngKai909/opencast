// What a relay shows for each row of the channel (follow-up Phase 3). One setting for every relay
// of a station ("During breaks, relays show: Your spots / Station ID slate"), and two rules on top:
//
//   - time in a break that ads from partners would fill (the programmatic backfill is per viewer,
//     inside Opencast's player; on the channel it's the break's hold, what's left after the
//     station's spots, credits and bumpers) shows the station ID slate on relays;
//   - spots and sponsor credits that air on relays are paid promotion: connected YouTube (and
//     Twitch's equivalent) is marked automatically; manually added destinations get a reminder.

export type RelayBreakHandling = "air_spots" | "station_id_slate";

export interface RelayRowLike {
  inBreak: boolean;
  /** The log code the row carries: PGM, SPT, UND, BMP, SID, or OPEN (a hold on a slate). */
  code: string;
  kind?: string;
}

export interface RelayBreakSettings {
  breakHandling: RelayBreakHandling;
  /** The station's "Ads from partners" switch (its break rule). */
  partnerAds: boolean;
}

/** What fills a break's time besides partners: what the station itself chose to air there. */
const STATION_BREAK_CODES = new Set(["SPT", "UND", "BMP", "SID"]);
/** What counts as paid promotion when it airs on a relay. */
const PAID_CODES = new Set(["SPT", "UND"]);

export type RelayPicture =
  | { show: "as_aired"; why: "program" | "spots" }
  | { show: "station_id_slate"; why: "station_chose_slate" | "partner_time" };

/** What the relay shows for one row. */
export function relayPicture(row: RelayRowLike, settings: RelayBreakSettings): RelayPicture {
  if (!row.inBreak) return { show: "as_aired", why: "program" };
  if (settings.breakHandling === "station_id_slate") return { show: "station_id_slate", why: "station_chose_slate" };
  // Partner time: the break's hold, which the player fills per viewer when ads from partners are on.
  if (!STATION_BREAK_CODES.has(row.code) && settings.partnerAds) return { show: "station_id_slate", why: "partner_time" };
  return { show: "as_aired", why: "spots" };
}

/** A row that's paid promotion when it airs on a relay (a spot or a sponsor credit, as aired). */
export function isPaidPromotion(row: RelayRowLike, settings: RelayBreakSettings): boolean {
  return row.inBreak && PAID_CODES.has(row.code) && relayPicture(row, settings).show === "as_aired";
}
