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
import { configApi } from "./config.js";
import { billingApi } from "./billing.js";
import { relayApi } from "./relay.js";
import { platformsApi } from "./platforms.js";
import { uploadsApi } from "./uploads.js";
import { blocksApi } from "./blocks.js";
import { analyticsApi } from "./analytics.js";

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
export * from "./manualSchedule.js";
export * from "./tv.js";
export * from "./hls.js";
export * from "./segments.js";
export * from "./desk.js";
export * from "./catalogShelf.js";
export * from "./publicDomain.js";
export * from "./rules.js";
export * from "./catalogSponsors.js";
export * from "./callSigns.js";
export * from "./config.js";
export * from "./storageMaintenance.js";
export * from "./billing.js";
export * from "./relay.js";
export * from "./platforms.js";
export * from "./uploads.js";
export * from "./blocks.js";
export * from "./analytics.js";

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
  catalogSponsors: catalogSponsorsApi,
  /** Added 2026-09-29 (follow-up Phase 1): the apps' public switches. */
  config: configApi,
  /** Added 2026-09-29 (follow-up Phase 2): pay-as-you-go, the Station account. */
  billing: billingApi,
  /** Added 2026-10-06 (A251): the Network desk's analytics. */
  analytics: analyticsApi,
  /** Added 2026-09-30 (follow-up Phase 3): platform connections for relays (YouTube, Twitch, any RTMP address). */
  platforms: platformsApi,
  /** Added 2026-09-30 (follow-up Phase 3): relays, set once for all of a station's translators (modes, breaks, the bug, restarts). */
  relay: relayApi,
  /** Added 2026-09-30 (follow-up Phase 4): direct uploads, straight from the browser to object storage in parts. */
  uploads: uploadsApi,
  /** Added 2026-10-02 (A244): programming blocks, named and branded stretches of a station's log. */
  blocks: blocksApi
} as const;

export const HealthResponse = z.object({
  ok: z.literal(true),
  service: z.string(),
  at: z.string()
});
export type HealthResponse = z.infer<typeof HealthResponse>;
