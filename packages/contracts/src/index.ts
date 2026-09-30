// Request and response schemas shared by the apps and the API. Owned by the
// platform prompt; the apps prompt reads these and never edits them. Changes to
// a published shape go in docs/contracts-changelog.md as a new version or field.
//
// Every endpoint is under `/v1`. Each `*Api` object maps a name to an endpoint
// definition: method, path, who can call it, and the Zod schemas for params,
// query, body and response.

import { z } from "zod";
import { accountsApi } from "./accounts.js";
import { audienceApi } from "./audience.js";
import { catalogApi } from "./catalog.js";
import { ledgerApi } from "./ledger.js";
import { libraryApi } from "./library.js";
import { logApi, playoutApi } from "./log.js";
import { networkApi } from "./network.js";
import { notificationsApi } from "./notifications.js";
import { spotsApi } from "./spots.js";
import { stationsApi } from "./stations.js";
import { trustApi } from "./trust.js";
import { waitlistApi } from "./waitlist.js";
import { tvApi } from "./tv.js";
import { deskApi } from "./desk.js";
import { catalogShelfApi } from "./catalogShelf.js";
import { catalogSponsorsApi } from "./catalogSponsors.js";

export * from "./core.js";
export * from "./common.js";
export * from "./states.js";
export * from "./accounts.js";
export * from "./stations.js";
export * from "./library.js";
export * from "./log.js";
export * from "./catalog.js";
export * from "./spots.js";
export * from "./ledger.js";
export * from "./audience.js";
export * from "./trust.js";
export * from "./notifications.js";
export * from "./waitlist.js";
export * from "./network.js";
export * from "./tv.js";
export * from "./hls.js";
export * from "./segments.js";
export * from "./desk.js";
export * from "./catalogShelf.js";
export * from "./publicDomain.js";
export * from "./rules.js";
export * from "./catalogSponsors.js";
export * from "./callSigns.js";

export const API_PREFIX = "/v1";

/** Every endpoint, by module. */
export const api = {
  accounts: accountsApi,
  stations: stationsApi,
  library: libraryApi,
  log: logApi,
  playout: playoutApi,
  catalog: catalogApi,
  spots: spotsApi,
  ledger: ledgerApi,
  audience: audienceApi,
  trust: trustApi,
  notifications: notificationsApi,
  waitlist: waitlistApi,
  network: networkApi,
  tv: tvApi,
  desk: deskApi,
  catalogShelf: catalogShelfApi,
  catalogSponsors: catalogSponsorsApi
} as const;

export const HealthResponse = z.object({
  ok: z.literal(true),
  service: z.string(),
  at: z.string()
});
export type HealthResponse = z.infer<typeof HealthResponse>;
