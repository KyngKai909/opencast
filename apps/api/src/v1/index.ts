import express from "express";
// The v1 API: one router per module, mounted at /v1. Modules own their tables and
// call each other through `services`.

import { webhookHandler } from "./webhooks.js";
import type { Router } from "express";
import type { Deps, ModuleContext, Services } from "./context.js";
import { errorHandler, RouteRegistrar } from "./http.js";
import { createAccountsService } from "./modules/accounts/service.js";
import { accountsRoutes } from "./modules/accounts/routes.js";
import { createStationsService } from "./modules/stations/service.js";
import { stationsRoutes } from "./modules/stations/routes.js";
import { createLibraryService } from "./modules/library/service.js";
import { libraryRoutes } from "./modules/library/routes.js";
import { createLogService } from "./modules/log/service.js";
import { logRoutes } from "./modules/log/routes.js";
import { createPlayoutService } from "./modules/playout/service.js";
import { playoutRoutes } from "./modules/playout/routes.js";
import { createCatalogService } from "./modules/catalog/service.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { createSpotsService } from "./modules/spots/service.js";
import { spotsRoutes } from "./modules/spots/routes.js";
import { createLedgerService } from "./modules/ledger/service.js";
import { ledgerRoutes } from "./modules/ledger/routes.js";
import { createAudienceService } from "./modules/audience/service.js";
import { audienceRoutes } from "./modules/audience/routes.js";
import { createTrustService } from "./modules/trust/service.js";
import { trustRoutes } from "./modules/trust/routes.js";
import { createNotificationsService } from "./modules/notifications/service.js";
import { notificationsRoutes } from "./modules/notifications/routes.js";
import { createWaitlistService } from "./modules/waitlist/service.js";
import { waitlistRoutes } from "./modules/waitlist/routes.js";
import { createNetworkService } from "./modules/network/service.js";
import { networkRoutes } from "./modules/network/routes.js";

export function createV1(deps: Deps): { router: Router; services: Services; deps: Deps } {
  const services = {} as Services;
  const ctx: ModuleContext = { deps, services };
  services.accounts = createAccountsService(ctx);
  services.stations = createStationsService(ctx);
  services.library = createLibraryService(ctx);
  services.log = createLogService(ctx);
  services.playout = createPlayoutService(ctx);
  services.catalog = createCatalogService(ctx);
  services.spots = createSpotsService(ctx);
  services.ledger = createLedgerService(ctx);
  services.audience = createAudienceService(ctx);
  services.trust = createTrustService(ctx);
  services.notifications = createNotificationsService(ctx);
  services.waitlist = createWaitlistService(ctx);
  services.network = createNetworkService(ctx);

  const router = express.Router();
  // Webhooks first: they need the raw body, before anything reads it as JSON.
  router.post("/webhooks/:provider", ...webhookHandler(deps, services));
  router.use(express.json({ limit: "2mb" }));
  const registrar = new RouteRegistrar(router, deps, services);
  accountsRoutes(registrar, ctx);
  stationsRoutes(registrar, ctx);
  libraryRoutes(registrar, ctx);
  logRoutes(registrar, ctx);
  playoutRoutes(registrar, ctx);
  catalogRoutes(registrar, ctx);
  spotsRoutes(registrar, ctx);
  ledgerRoutes(registrar, ctx);
  audienceRoutes(registrar, ctx);
  trustRoutes(registrar, ctx);
  notificationsRoutes(registrar, ctx);
  waitlistRoutes(registrar, ctx);
  networkRoutes(registrar, ctx);
  router.use(errorHandler(deps.config.production));
  return { router, services, deps };
}
