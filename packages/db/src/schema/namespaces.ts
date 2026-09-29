import { pgSchema } from "drizzle-orm/pg-core";

// The Postgres schemas, and the enums more than one of them uses. Kept
// apart from the tables so the table files can import each other freely.

export const accounts = pgSchema("accounts");
export const broadcast = pgSchema("broadcast");
export const catalog = pgSchema("catalog");
export const spots = pgSchema("spots");
export const ledger = pgSchema("ledger");
export const trust = pgSchema("trust");
export const network = pgSchema("network");
export const audience = pgSchema("audience");
export const notify = pgSchema("notify");
/** The TV app: devices, their sign-ins by code, and the phone remote's relay. */
export const tv = pgSchema("tv");

export const band = broadcast.enum("band", ["tv", "radio"]);

/** Log codes. `OPEN` is the design's "holds on the station ID slate" filler. */
export const logCode = broadcast.enum("log_code", ["PGM", "SPT", "UND", "BMP", "SID", "OPEN"]);

export const rightsBasis = broadcast.enum("rights_basis", [
  "made_it",
  "owner_permission",
  "public_domain",
  /** A claimable station's work, covered by the creator's yes. */
  "permission_record",
  /** A claimable station's work, published under a licence that allows commercial use. */
  "licence_record"
]);
