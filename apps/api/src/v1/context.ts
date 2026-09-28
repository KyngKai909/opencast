import type { Db } from "@opencast/db";
import type { EventBus } from "./events.js";
import type { TokenVerifier } from "./auth.js";
import type { MediaPipeline } from "./media.js";
import type { Payments } from "./payments.js";
import type { AccountsService } from "./modules/accounts/service.js";
import type { StationsService } from "./modules/stations/service.js";
import type { LibraryService } from "./modules/library/service.js";
import type { LogService } from "./modules/log/service.js";
import type { PlayoutService } from "./modules/playout/service.js";
import type { CatalogService } from "./modules/catalog/service.js";
import type { SpotsService } from "./modules/spots/service.js";
import type { LedgerService } from "./modules/ledger/service.js";
import type { AudienceService } from "./modules/audience/service.js";
import type { TrustService } from "./modules/trust/service.js";
import type { NotificationsService } from "./modules/notifications/service.js";
import type { WaitlistService } from "./modules/waitlist/service.js";
import type { NetworkService } from "./modules/network/service.js";
import type { RouteRegistrar } from "./http.js";

/** A database handle, or a transaction on it. Service functions take either. */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Clock {
  now(): Date;
}

/** Where push notifications and emails go. The default logs them; real providers plug in here. */
export interface Notifier {
  push(userId: string, notice: { title: string; body: string; link: string | null }): Promise<void>;
  email(to: string, notice: { title: string; body: string; link: string | null }): Promise<void>;
}

export interface Deps {
  db: Db;
  bus: EventBus;
  clock: Clock;
  auth: TokenVerifier;
  media: MediaPipeline;
  notifier: Notifier;
  payments: Payments;
  config: {
    /** Where uploads and working files go. */
    storageRoot: string;
    /** Public origin of the viewer app, for links in notices and QR codes. */
    appOrigin: string;
    /** The escrow contract, shown on station and claim pages. */
    escrowContractAddress: string | null;
    production: boolean;
  };
}

/** Every module's service. Modules call each other only through these, never each other's tables. */
export interface Services {
  accounts: AccountsService;
  stations: StationsService;
  library: LibraryService;
  log: LogService;
  playout: PlayoutService;
  catalog: CatalogService;
  spots: SpotsService;
  ledger: LedgerService;
  audience: AudienceService;
  trust: TrustService;
  notifications: NotificationsService;
  waitlist: WaitlistService;
  network: NetworkService;
}

export interface ModuleContext {
  deps: Deps;
  services: Services;
}

export interface Module<S> {
  service: S;
  routes(r: RouteRegistrar): void;
}
