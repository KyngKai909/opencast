import type { Db } from "@opencast/db";
import type { EventBus } from "./events.js";
import type { TokenVerifier } from "./auth.js";
import type { ClearLinkLookup } from "./clearLink.js";
import type { MediaPipeline } from "./media.js";
import type { Storage } from "./storage.js";
import type { EscrowChain } from "./chain/index.js";
import type { Payments } from "./payments/index.js";
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
import type { TvService } from "./modules/tv/service.js";
import type { SettingsService } from "./modules/settings/service.js";
import type { ShelfService } from "./modules/shelf/service.js";
import type { MaintenanceService } from "./modules/maintenance/service.js";
import type { PinataAccount } from "./storageMaintenance.js";
import type { GeoLookup } from "./geo.js";
import type { PlaceLookup } from "./places.js";
import type { RelayBus } from "./relay.js";
import type { RouteRegistrar } from "./http.js";
import type { EmailNotice } from "./email.js";

/** A database handle, or a transaction on it. Service functions take either. */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Clock {
  now(): Date;
}

/**
 * Where push notifications and emails go. Pushes are logged; emails go through Resend with
 * RESEND_API_KEY, else the log (email.ts). `email` rejects when the email couldn't be sent.
 */
export interface Notifier {
  push(userId: string, notice: { title: string; body: string; link: string | null }): Promise<void>;
  email(to: string, notice: EmailNotice): Promise<void>;
}

export interface Deps {
  db: Db;
  bus: EventBus;
  clock: Clock;
  auth: TokenVerifier;
  /** Reads a person's linked Clear global wallet from Privy (Clear is the provider app). */
  clear: ClearLinkLookup;
  media: MediaPipeline;
  /** Object storage by content ID (R2, or local disk in development), and IPFS for publishing. */
  storage: Storage;
  /** The escrow contract and creator fund (Base; anvil locally). Null until configured. */
  chain: EscrowChain | null;
  notifier: Notifier;
  payments: Payments;
  /** Where a request comes from (GEOIP_URL), for the market from the connection. Addresses are never stored. */
  geo: GeoLookup;
  /** Addresses and cities to coordinates (PLACES_URL), for a business's locations. Nothing typed is stored. Optional: none without it. */
  places?: PlaceLookup;
  /** The TV remote's message bus: in-process, or Redis pub/sub when REDIS_URL is set. */
  relay: RelayBus;
  /**
   * Pinata (PINATA_JWT), read by the desk's Storage maintenance to copy pins off it (never to
   * unpin). Null or absent: Pinata isn't connected here. Added 2026-09-29.
   */
  pinata?: PinataAccount | null;
  config: {
    /** Where uploads and working files go. */
    storageRoot: string;
    /** Public origin of the viewer app, for links in notices and QR codes. */
    appOrigin: string;
    /**
     * Public origin of the business app (BUSINESS_ORIGIN), for business invites and business
     * notices' email links. Unset: the viewer app's origin.
     */
    businessOrigin?: string;
    /**
     * Accepting an invite made to an email needs that email on the signed-in account (a verified
     * email, Google or Apple address). On unless INVITE_EMAIL_MATCH=off (docs/open-decisions.md).
     */
    inviteEmailMatch?: boolean;
    /** The escrow contract, shown on station and claim pages. */
    escrowContractAddress: string | null;
    /** USDC on the configured chain (CHAIN_ID, USDC_ADDRESS): what a transfer from a linked Clear wallet sends. Null until set. */
    usdc: { chainId: number; address: string } | null;
    production: boolean;
    /** Event streams' heartbeat (25 s). Tests shorten it. */
    sseHeartbeatMs?: number;
    /**
     * The API's own public origin (API_PUBLIC_URL, e.g. `https://api.opencast.tv`), added 2026-09-29
     * (A117): paths the API serves itself (`/hls/…`, `/objects/…`, receipt PDFs) are sent as full
     * URLs, so apps on another host can load them. Unset: sent as paths, as before.
     */
    publicBase?: string | null;
    /** Where the worker serves each station's own HLS (HLS_PUBLIC_URL), when it isn't the API's origin. */
    hlsBase?: string | null;
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
  tv: TvService;
  /** Network desk Settings (added 2026-09-29): desk roles, the rules registry, signers, the change log. */
  settings: SettingsService;
  /** The catalog's shelf (added 2026-09-29): series, items and their rights checks, episodes. */
  shelf: ShelfService;
  /** Storage maintenance (added 2026-09-29): the one-off storage jobs, run from the desk. */
  maintenance: MaintenanceService;
}

export interface ModuleContext {
  deps: Deps;
  services: Services;
}

export interface Module<S> {
  service: S;
  routes(r: RouteRegistrar): void;
}
