import { randomBytes } from "node:crypto";
import { and, asc, eq, ilike, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { blockedIabAdProducts, CHANNEL_HOLD_AFTER_SIGN_OFF_MS, familyHeadTenths, formatChannelNumber, iabContentCategories, isSubchannel, isValidStationColour, parseChannelNumber, parseStationSlug, radioBandTenths, stationSlugOf, type Band } from "@opencast/domain";
import type { StationIdent } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import { createLivepeerStream, hasLivepeerApiKey } from "../../../livepeer.js";
import type { CurrentUser } from "../../http.js";
import { badRequest, conflict, notFound, refused } from "../../errors.js";
import { createRelayBackgrounds, type RelayBackgroundView } from "./relayBackground.js";
import { cadenceOf, type BreakCadence } from "../playout/engine/cadence.js";
import { defaultSequences, sequenceProblems, sequencesOf, type BumperSequences } from "../playout/engine/sequence.js";
import { kindOfTranslator } from "../relays/platforms.js";

export type StationKind = "station" | "studio" | "claimable" | "listed" | "catalog";
type LogCode = "PGM" | "SPT" | "UND" | "BMP" | "SID" | "OPEN";

export interface BreakRuleView {
  mode: "after_every_program" | "every_n_minutes" | "none";
  everyMinutes: number | null;
  lengthMs: number;
  spotMsPerHour: number;
  sameSpotPerHour: number;
  fillOrder: LogCode[];
  openTimeTo: "spot_market" | "station_id_and_bumpers";
  blockedCategories: string[];
  /** "Ads from partners" (the programmatic backfill): off by default, and only a switch until it's built. */
  adsFromPartners: boolean;
  /** How often the station ID, bumpers, credit and spots air in breaks (added 2026-09-29): every break by default. */
  cadence: BreakCadence;
  /** A242: at sign-on, the opener and then the station ID (off by default: the opener replaces it). */
  stationIdAfterOpener: boolean;
  /** A242: the opener at the start of each broadcast day, for a channel that never goes off air. Off by default. */
  dailyOpener: boolean;
  /** A243: the bumper sequences (open, close, between), the defaults filled in. `cadence.bumpers` reads as `open.every`. */
  bumperSequences: BumperSequences;
}

/** A break rule as `setBreakRule` takes it: what an older app leaves out stays as set. */
export type BreakRuleInput = Omit<BreakRuleView, "adsFromPartners" | "cadence" | "stationIdAfterOpener" | "dailyOpener" | "bumperSequences"> & {
  adsFromPartners?: boolean;
  /** S20: `upNext` left out stays as set; null clears it (Up next follows its position again). */
  cadence?: Omit<BreakCadence, "spots" | "upNext"> & { spots?: BreakCadence["spots"]; upNext?: BreakCadence["upNext"] | null };
  stationIdAfterOpener?: boolean;
  dailyOpener?: boolean;
  /** A243: left out (an app from before), they stay as set; `cadence.bumpers` alone sets `open.every` and `close.every`. */
  bumperSequences?: BumperSequences;
};

type BreakRuleRow = typeof schema.breakRules.$inferSelect;

/** A stored break rule (or none: the defaults) as `getBreakRule` reads it, with its blocked categories. */
function breakRuleView(rule: Partial<BreakRuleRow> | undefined, blockedCategories: string[]): BreakRuleView {
  return {
    mode: rule?.mode ?? "after_every_program",
    everyMinutes: rule?.everyMinutes ?? null,
    lengthMs: rule?.lengthMs ?? 120_000,
    spotMsPerHour: rule?.spotMsPerHour ?? 180_000,
    sameSpotPerHour: rule?.sameSpotPerHour ?? 2,
    fillOrder: (rule?.fillOrder as LogCode[] | undefined) ?? ["SPT", "UND", "BMP", "SID"],
    openTimeTo: rule?.openTimeTo ?? "spot_market",
    blockedCategories: [...blockedCategories].sort(),
    adsFromPartners: rule?.adsFromPartners ?? false,
    // A243: `cadence.bumpers` reads as the opening sequence's cadence.
    ...(() => {
      const cadence = cadenceOf(rule?.cadence);
      const bumperSequences = sequencesOf(rule?.bumperSequences, cadence.bumpers);
      const open = bumperSequences.open;
      return { cadence: { ...cadence, bumpers: open.every === "n_programs" ? { every: open.every, n: open.n } : { every: open.every } }, bumperSequences };
    })(),
    stationIdAfterOpener: rule?.stationIdAfterOpener ?? false,
    dailyOpener: rule?.dailyOpener ?? false
  };
}

/** What an ad request for ads from partners would carry about a station (nothing sends one yet). */
export interface StationAdProfile {
  /** IAB Content Taxonomy 3.0 ids. */
  iabCategories: string[];
  /** IAB Ad Product Taxonomy 2.0 ids for the station's blocked spot categories. */
  blockedIabAdProducts: string[];
  adsFromPartners: boolean;
  spotMsPerHour: number;
}

export interface StationSetupView {
  station: StationIdent;
  description: string | null;
  status: "setting_up" | "on_air" | "off_air" | "signed_off";
  firstSignedOnAt: string | null;
  fixed: boolean;
  bug: { mode: "off" | "call_sign_and_channel" | "logo"; position: string; opacity: number };
  logoUrl: string | null;
  category: string | null;
  studioLocation: { latitude: number; longitude: number } | null;
  legalName: string | null;
  legalContact: string | null;
  pledgesTaxDeductible: boolean | null;
  memberCreditStyle: "voice" | "text";
  orders: { takesOrders: boolean; turnaround: string | null; fromMicros: number | null };
  /** IAB Content Taxonomy 3.0 ids: the station's own, or derived from its category. */
  iabCategories: string[];
  /** A229: the station on X.1 whose call sign this one shares, or null. */
  sharesCallSignWith?: StationIdent | null;
  /** A229: the stations on its subchannels that share its call sign. */
  callSignFamily?: StationIdent[];
}

/** What spot targeting and the market board need about a station. */
export interface StationProfile {
  id: string;
  ident: StationIdent;
  kind: StationKind;
  status: StationSetupView["status"];
  category: string | null;
  marketId: string | null;
  location: { lat: number; lng: number } | null;
  firstSignedOnAt: Date | null;
  public: boolean;
  blockedCategories: string[];
  description: string | null;
  pledgesTaxDeductible: boolean | null;
  /** The station's key in the escrow contract. */
  escrowId: number;
  /** A229: the station on X.1 whose call sign this one shares, or null. */
  sharesCallSignWith: string | null;
}

/** A234: a station sharing X.1's call sign whose owners no longer match X.1's (contracts `CallSignOwnersApart`). */
export interface CallSignOwnersApartView {
  head: StationIdent;
  member: StationIdent;
  since: string;
  headOwners: string[];
  memberOwners: string[];
  fixed: boolean;
}

export interface StationsService {
  idents(ids: string[]): Promise<Map<string, StationIdent>>;
  kindOf(stationId: string): Promise<StationKind | null>;
  /** Every station of these kinds (for Opencast admins: the stations Opencast runs). */
  idsOfKinds(kinds: StationKind[]): Promise<string[]>;
  removeHost(stationId: string, userId: string): Promise<void>;
  /** Signed on at least once and not signed off for good. Nothing is public before that. */
  isPublic(stationId: string): Promise<boolean>;
  profiles(ids: string[]): Promise<Map<string, StationProfile>>;
  /** Public stations in a market and band, in channel order. */
  onDial(marketId: string, band: Band): Promise<StationProfile[]>;
  /** Public stations in these markets (both bands), for targeting and the market board. */
  inMarkets(marketIds: string[]): Promise<StationProfile[]>;
  /**
   * By id, call sign or address (A229): `sbco` is the station on X.1 (or the one alone with it),
   * `sbco-15-2` the one sharing it on 15.2. A call sign that changed (A222) still finds its station
   * through the year it's held for it.
   */
  byRef(ref: string): Promise<StationProfile | null>;
  /** A229: the stations that have this call sign (X.1 and its family, or the one). */
  stationsWithCallSign(callSign: string): Promise<string[]>;
  /** A229: the station's call-sign family (X.1 and every station sharing it, signed off or not); just itself when it shares nothing. */
  familyIds(stationId: string): Promise<Set<string>>;
  /** A229: X.1 and the stations sharing its call sign now (not signed off for good), by any of them; null when it shares nothing. */
  callSignFamily(stationId: string): Promise<{ head: StationProfile; members: StationProfile[] } | null>;
  /**
   * A234 (added 2026-09-30): after a station's owners changed (`change`: its owners before and
   * after, for the notice's words), whether X.1 and each full station sharing its call sign still
   * have an owner in common. A member that no longer does is marked (`owners_split_at`) and the
   * Network desk told once (`station.call_sign_owners`); one that does again is cleared, so a
   * later split is told again. Nothing on air changes: no call sign changes, nothing is unlinked.
   * External families, and stations that share nothing, are left alone.
   */
  checkCallSignOwners(stationId: string, change?: { before: string[]; after: string[] }): Promise<void>;
  /** A234: a market's full stations sharing X.1's call sign whose owners no longer match X.1's, longest apart first. */
  callSignOwnersApart(marketId: string): Promise<CallSignOwnersApartView[]>;
  /** Added 2026-09-29 (reserved call signs): of these call signs, the ones a station has. */
  takenCallSigns(callSigns: string[]): Promise<Set<string>>;
  search(q: string, marketId?: string): Promise<{ tuneTo: StationProfile | null; stations: StationProfile[] }>;
  timezoneOf(stationId: string): Promise<string>;
  breakRule(stationId: string): Promise<BreakRuleView>;
  /** For ads from partners, once built: the station's IAB categories, blocked IAB ad products and its switch. */
  adProfile(stationId: string): Promise<StationAdProfile>;
  /** Added 2026-09-29: of these stations, the ones whose break rule never airs spots (`cadence.spots`). */
  withoutSpots(stationIds: string[]): Promise<Set<string>>;
  liveSourceBelongs(stationId: string, sourceId: string): Promise<boolean>;
  /** For playout: where a live source's signal comes from. */
  liveSourceSignal(sourceId: string): Promise<{ streamKey: string | null; livepeerPlaybackId: string | null } | null>;
  /** For the worker's radio ingest: the live source a stream key belongs to, and its station's band. */
  liveSourceByKey(streamKey: string): Promise<{ id: string; stationId: string; band: Band | null } | null>;
  isHost(userId: string, stationId: string, programId: string | null): Promise<boolean>;
  /** For sign-on checks. */
  identityReady(stationId: string): Promise<{ callSign: boolean; channel: boolean }>;
  markSignedOn(db: Executor, stationId: string): Promise<{ first: boolean }>;
  markSignedOff(db: Executor, stationId: string, permanently: boolean): Promise<void>;
  /** Stations by their escrow IDs (the escrow contract's keys). */
  byEscrowIds(ids: number[]): Promise<Map<number, string>>;
  /** A claimed station becomes its creator's own: an ordinary station, earning into its own account. */
  handOver(db: Executor, stationId: string): Promise<void>;
  /** How playout draws the station: colour, bug, city. */
  look(stationId: string): Promise<{
    callSign: string | null;
    channel: string | null;
    name: string;
    homeCity: string | null;
    colour: string | null;
    bug: { mode: "off" | "call_sign_and_channel" | "logo"; opacity: number; position: string };
    logoUrl: string | null;
    /** The band it's on (TV unless it has a radio channel): what it's prepared and assembled for. */
    band: Band;
    /** A229: its call sign is shared (name it with its channel where only a call sign would show). */
    sharesCallSign?: boolean;
  } | null>;
  /** Added 2026-09-29: stations that air (a station or a claimable one, setting up or on air, not signed off for good). */
  airingStationIds(): Promise<string[]>;
  /** Stations that take orders, and studios. */
  makers(): Promise<Array<{ profile: StationProfile; turnaround: string | null; fromMicros: number | null }>>;
  /** For playout: every enabled relay, with its key (and a radio station's background, once prepared). */
  relays(stationId: string): Promise<Array<{ id: string; rtmpUrl: string; streamKey: string; breakHandling: "air_spots" | "station_id_slate"; burnCaptions: boolean; background: { loopKey: string; frames: number } | null }>>;
  /**
   * Pay-as-you-go (added 2026-09-29): what each relay session's translator relayed, for sessions
   * that don't say (`translator_sessions.relay_mode` is null: a worker translator, before relay
   * modes, which relayed everything). Since 2026-09-30 (Phase 3) the relay service records the mode
   * on each session, and its sessions carry the station's ID: a station ID here reads the station's
   * relay mode (the relays module's setting).
   */
  relayModes(translatorIds: string[]): Promise<Map<string, "everything" | "live_only">>;
  /**
   * Added 2026-09-30 (Phase 3): old translators whose key hasn't moved to the platforms module yet
   * (no PLATFORM_SECRETS_KEY to seal it with), enabled, as relay destinations. Moved ones are
   * platform connections (`platform_id`) and come from the platforms module.
   */
  translatorDestinations(stationId: string): Promise<Array<{ id: string; service: "youtube" | "twitch" | "rtmp"; name: string; rtmpUrl: string; streamKey: string }>>;
  /** Added 2026-09-30: the platform connections of translators turned off (the relay leaves them out). */
  disabledTranslatorPlatforms(stationId: string): Promise<Set<string>>;
  /**
   * Added 2026-09-30: moves every translator's plain stream key into the platforms module's sealed
   * storage (a manual connection, linked by `platform_id`), checks the sealed copy, then nulls the
   * plain one; carries the station's break setting (and "Everything I air", which translators did)
   * to its relay setting. Idempotent. Without PLATFORM_SECRETS_KEY nothing moves (a warning).
   */
  moveTranslatorKeys(): Promise<{ moved: number; waiting: number; failed: number }>;
  /** Added 2026-09-30 (Phase 3): the station's live sources that send through Livepeer, with their Livepeer stream (for "Live shows only" multistream). */
  liveSourceStreams(stationId: string): Promise<Array<{ id: string; livepeerStreamId: string }>>;
  /** A radio station's relay background (added 2026-09-29). */
  getRelayBackground(stationId: string): Promise<RelayBackgroundView | null>;
  setRelayBackground(stationId: string, file: import("../../http.js").UploadedFile | null): Promise<RelayBackgroundView>;
  removeRelayBackground(stationId: string): Promise<void>;
  /** For playout: the prepared background loop, when ready. */
  relayBackground(stationId: string): Promise<{ loopKey: string; frames: number } | null>;
  settleRelayBackgrounds(): Promise<void>;
  /** Used by Network desk to set up claimable, listed and catalog stations. */
  createManaged(db: Executor, input: { kind: StationKind; name: string; callSign: string; colour?: string; marketId: string; band: Band; tenths: number; description?: string; sharesCallSignWith?: string | null }): Promise<string>;
  /**
   * A215 (added 2026-09-30): an external station's listing changed on Network desk: its name,
   * description, call sign (the old one is the caller's to hold) or channel (the old channel row is
   * released and a new one made: a channel is otherwise fixed after first sign-on). External stations only.
   */
  changeManaged(db: Executor, stationId: string, input: { name?: string; description?: string | null; callSign?: string; channel?: { marketId: string; band: Band; tenths: number }; sharesCallSignWith?: string | null }): Promise<void>;
  /** A215: a station's channel is let go (an external station taken off the dial, 90 days on). */
  releaseChannel(db: Executor, stationId: string): Promise<void>;
  /**
   * A223 (closed 2026-09-30): frees the channels of stations that signed off for good at least 90
   * days ago (not external stations: theirs go with their listing, A221). X.1 whose call sign is
   * shared by a station still on the air keeps its number until that one signs off too (A233).
   * Idempotent. Returns how many stations' channels were freed.
   */
  releaseSignedOffChannels(): Promise<number>;

  /** `reservationId` (added 2026-09-29): started from a waitlist invite, with the call sign and any channel held. */
  create(user: CurrentUser, input: { kind: "station" | "studio"; name: string; description?: string; colour?: string; handle?: string; reservationId?: string }): Promise<StationSetupView>;
  setup(stationId: string): Promise<StationSetupView>;
  updateSetup(user: CurrentUser, stationId: string, input: SetupPatch): Promise<StationSetupView>;
  availableChannels(marketId: string, band: Band): Promise<Array<{ channel: string; state: "open" | "taken" | "held" }>>;
  /** A230: the owner's own subchannels in a market: the next free X.n beside each station they own on X.1. */
  ownSubchannels(user: CurrentUser, marketId: string, band: Band): Promise<Array<{ channel: string; beside: StationIdent }>>;
  /** `user` (A230): the owner, for a subchannel beside their own X.1; `shareCallSign` shares its call sign. */
  chooseChannel(stationId: string, input: { marketId: string; band: Band; channel: string; shareCallSign?: boolean }, user?: CurrentUser): Promise<StationSetupView>;
  /** `adsFromPartners` left out keeps the station's current switch (older apps don't send it). */
  setBreakRule(stationId: string, rule: BreakRuleInput): Promise<BreakRuleView>;
  /**
   * A246: the rule `setBreakRule` would save, as `breakRule` would read it after: the same checks
   * (and 400s) and the same merging with what's stored. Nothing is written (`previewBreakRule`).
   */
  resolveBreakRule(stationId: string, rule: BreakRuleInput): Promise<BreakRuleView>;
  translators(stationId: string): Promise<TranslatorView[]>;
  addTranslator(stationId: string, input: TranslatorInput): Promise<TranslatorView>;
  updateTranslator(stationId: string, translatorId: string, input: Partial<TranslatorInput & { enabled: boolean }>): Promise<TranslatorView>;
  removeTranslator(stationId: string, translatorId: string): Promise<void>;
  liveSources(stationId: string): Promise<LiveSourceView[]>;
  addLiveSource(stationId: string, input: { kind: "encoder" | "browser"; name: string }): Promise<{ source: LiveSourceView; streamKey: string | null }>;
  resetLiveSourceKey(stationId: string, sourceId: string): Promise<{ source: LiveSourceView; streamKey: string }>;
  removeLiveSource(stationId: string, sourceId: string): Promise<void>;
  setHosts(stationId: string, programId: string, userIds: string[]): Promise<string[]>;
  speakers(programId: string): Promise<SpeakerView[]>;
  setSpeakers(programId: string, speakers: Array<{ name: string; title: string | null }>): Promise<SpeakerView[]>;
  /** A4: each host's live programs on a station. */
  hostPrograms(stationId: string): Promise<Map<string, string[]>>;
  /** A4: makes someone a host of these programs too (an accepted invite). Programs that aren't the station's are skipped. */
  addHost(db: Executor, stationId: string, userId: string, programIds: string[]): Promise<void>;
  /** A4: every live program and who hosts it; `onlyFor` limits it to one host's programs. */
  hosts(stationId: string, onlyFor?: string): Promise<Array<{ programId: string; title: string; hosts: Array<{ userId: string; displayName: string | null }> }>>;
  /** S15: the lower third on a live block (the default before anyone sets it: the first speaker). */
  lowerThird(stationId: string, entryId: string, programId: string | null): Promise<LowerThirdView>;
  setLowerThird(stationId: string, entryId: string, programId: string | null, userId: string, input: { hidden: boolean; speakerId: string | null; name: string; title: string | null }): Promise<LowerThirdView>;
}

export type SetupPatch = Partial<{
  name: string;
  description: string | null;
  colour: string;
  callSign: string;
  bug: Partial<StationSetupView["bug"]>;
  logoUrl: string | null;
  category: string | null;
  homeCity: string | null;
  studioLocation: { latitude: number; longitude: number } | null;
  legalName: string | null;
  legalContact: string | null;
  pledgesTaxDeductible: boolean | null;
  memberCreditStyle: "voice" | "text";
  orders: Partial<{ takesOrders: boolean; turnaround: string | null; fromMicros: number | null }>;
  iabCategories: string[] | null;
}>;

export interface TranslatorInput {
  service: "youtube" | "twitch" | "rtmp";
  name: string;
  rtmpUrl: string;
  streamKey: string;
  breakHandling: "air_spots" | "station_id_slate";
  prerecordedLabel: boolean;
  /** Captions drawn into the relayed picture (added 2026-09-29; off by default). */
  burnCaptions?: boolean;
}

export interface TranslatorView {
  id: string;
  service: "youtube" | "twitch" | "rtmp";
  name: string;
  rtmpUrl: string;
  hasStreamKey: boolean;
  breakHandling: "air_spots" | "station_id_slate";
  prerecordedLabel: boolean;
  enabled: boolean;
  status: "not_connected" | "connected" | "relaying";
  burnCaptions: boolean;
}

export interface LiveSourceView {
  id: string;
  kind: "encoder" | "browser";
  name: string;
  server: string | null;
  streamKeyPreview: string | null;
  signal: "not_connected" | "receiving";
  createdAt: string;
  quality?: string | null;
  previewUrl?: string | null;
  ingest?: { whipUrl: string; token: string } | null;
  route?: "livepeer" | "opencast" | null;
}

export interface LowerThirdView {
  entryId: string;
  hidden: boolean;
  speakerId: string | null;
  name: string;
  title: string | null;
  updatedAt: string | null;
}

export interface SpeakerView {
  id: string;
  name: string;
  title: string | null;
  position: number;
}

const S = schema.stations;
const C = schema.channels;
const DEFAULT_TZ = "America/Los_Angeles";
const PUBLIC_STATUSES = new Set(["on_air", "off_air"]);
const INGEST_SERVER = process.env.LIVE_INGEST_SERVER ?? (hasLivepeerApiKey() ? "rtmp://rtmp.livepeer.com/live" : "rtmp://localhost:1935/live");
/** Radio: the worker's own RTMP ingest (radio never goes through Livepeer), as encoders reach it. */
const WORKER_INGEST_SERVER = (process.env.WORKER_INGEST_SERVER ?? `rtmp://localhost:${process.env.WORKER_INGEST_PORT ?? 1935}/live`).replace(/\/+$/, "");
/** B3: Livepeer's WebRTC ingest (WHIP), by stream key. */
const WHIP_BASE = (process.env.LIVEPEER_WHIP_BASE ?? "https://livepeer.studio/webrtc").replace(/\/+$/, "");
/** S14: a source's own playback on Livepeer, the team's private preview of what it's sending. */
const LIVEPEER_PLAYBACK = (process.env.LIVEPEER_PLAYBACK_BASE ?? "https://livepeercdn.studio/hls").replace(/\/+$/, "");

/**
 * What `setBreakRule` writes for a body (A246: split out so `previewBreakRule` checks and merges
 * the same way without writing): the 400s, the station ID last in the fill order, the cadence (left
 * out, what's stored stays; spots and S20's Up next too when only they're left out), and the bumper
 * sequences (sent, stored as sent, the bumpers' cadence following the opening one's; left out,
 * they stay, except that a body from before them that changes how often bumpers air changes both
 * the opening and closing sequence's). `undefined` in `set`: left as stored. Stored only once
 * they're not the defaults (null: the defaults, from `cadence.bumpers`).
 */
function resolveBreakRuleWrite(rule: BreakRuleInput, stored: BreakRuleRow | undefined) {
  if (rule.mode === "every_n_minutes" && !rule.everyMinutes) throw badRequest("Say how often.", { everyMinutes: "Required" });
  const fillOrder = [...rule.fillOrder.filter((c) => c !== "SID"), "SID" as const];
  const was = cadenceOf(stored?.cadence);
  let cadence: BreakCadence | undefined;
  if (rule.cadence) {
    if ((rule.cadence.stationId.every as string) === "never") throw badRequest("The station ID can't be turned off. Choose how often it airs.", { "cadence.stationId": "Required" });
    for (const [part, c] of Object.entries(rule.cadence)) {
      if (c && c.every === "n_programs" && !c.n) throw badRequest("Say after how many programs.", { [`cadence.${part}.n`]: "Required" });
    }
    // S20: Up next's own cadence left out stays as set; null clears it.
    const upNext = rule.cadence.upNext === undefined ? was.upNext : (rule.cadence.upNext ?? undefined);
    cadence = cadenceOf({ ...rule.cadence, spots: rule.cadence.spots ?? was.spots, upNext });
  }
  let bumperSequences: BumperSequences | null | undefined;
  if (rule.bumperSequences) {
    const problems = sequenceProblems(rule.bumperSequences);
    if (problems) throw badRequest("Each bumper role can be in a position once, four at most. Say after how many programs.", problems);
    bumperSequences = sequencesOf(rule.bumperSequences);
    if (cadence) {
      cadence = { ...cadence, bumpers: { every: bumperSequences.open.every, ...(bumperSequences.open.n ? { n: bumperSequences.open.n } : {}) } };
      if (JSON.stringify(bumperSequences) === JSON.stringify(defaultSequences(cadence.bumpers))) bumperSequences = null;
    }
  } else if (cadence) {
    if (stored?.bumperSequences) {
      const before = sequencesOf(stored.bumperSequences);
      const every = { every: cadence.bumpers.every, ...(cadence.bumpers.every === "n_programs" ? { n: cadence.bumpers.n } : {}) };
      if (before.open.every !== every.every || before.open.n !== every.n) bumperSequences = { ...before, open: { ...before.open, ...every }, close: { ...before.close, ...every } };
    }
  }
  const set = {
    mode: rule.mode,
    everyMinutes: rule.mode === "every_n_minutes" ? rule.everyMinutes : null,
    lengthMs: rule.lengthMs,
    spotMsPerHour: rule.spotMsPerHour,
    sameSpotPerHour: rule.sameSpotPerHour,
    fillOrder,
    openTimeTo: rule.openTimeTo,
    adsFromPartners: rule.adsFromPartners,
    cadence,
    // A242: left out (an app from before), each stays as set.
    stationIdAfterOpener: rule.stationIdAfterOpener,
    dailyOpener: rule.dailyOpener,
    bumperSequences
  };
  const categories = [...new Set(rule.blockedCategories.map((c) => c.trim()).filter(Boolean))];
  return { set, categories };
}

export function createStationsService({ deps, services }: ModuleContext): StationsService {
  const { db } = deps;

  async function rows(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    return db
      .select({ station: S, channel: C })
      .from(S)
      .leftJoin(C, and(eq(C.stationId, S.id), eq(C.isPrimary, true), isNull(C.releasedAt)))
      .where(inArray(S.id, unique));
  }

  async function build(found: Awaited<ReturnType<typeof rows>>): Promise<StationProfile[]> {
    const markets = await services.network.marketsByIds(found.map((r) => r.channel?.marketId).filter((v): v is string => Boolean(v)));
    const blocked = found.length
      ? await db.select().from(schema.blockedCategories).where(inArray(schema.blockedCategories.stationId, found.map((r) => r.station.id)))
      : [];
    // A229: X.1 stations whose call sign is shared by a station on the air (not signed off for good).
    const heads = found.length
      ? new Set(
          (
            await db
              .select({ head: S.sharesCallSignWith })
              .from(S)
              .where(and(inArray(S.sharesCallSignWith, found.map((r) => r.station.id)), sql`${S.status} <> 'signed_off'`))
          ).map((r) => r.head)
        )
      : new Set<string | null>();
    return found.map(({ station, channel }) => {
      const channelText = channel ? formatChannelNumber({ band: channel.band, tenths: channel.tenths }) : null;
      const member = station.sharesCallSignWith !== null;
      const ident: StationIdent = {
        id: station.id,
        kind: station.kind,
        callSign: station.callSign,
        handle: station.handle,
        name: station.name,
        colour: station.colour,
        band: channel?.band ?? null,
        channel: channelText,
        marketSlug: channel ? (markets.get(channel.marketId)?.slug ?? null) : null,
        homeCity: station.homeCity,
        // A229: its addresses' part (`sbco`, `sbco-15-2`), and whether its call sign is shared.
        slug: stationSlugOf({ id: station.id, callSign: station.callSign, handle: station.handle, channel: channelText, familyMember: member }),
        ...(member || heads.has(station.id) ? { sharesCallSign: true } : {})
      };
      return {
        id: station.id,
        ident,
        kind: station.kind,
        status: station.status,
        category: station.category,
        marketId: channel?.marketId ?? null,
        location: station.studioLatitude != null && station.studioLongitude != null ? { lat: station.studioLatitude, lng: station.studioLongitude } : null,
        firstSignedOnAt: station.firstSignedOnAt,
        public: station.firstSignedOnAt !== null && PUBLIC_STATUSES.has(station.status),
        blockedCategories: blocked.filter((b) => b.stationId === station.id).map((b) => b.category),
        description: station.description,
        pledgesTaxDeductible: station.pledgesTaxDeductible,
        escrowId: station.escrowId,
        sharesCallSignWith: station.sharesCallSignWith
      };
    });
  }

  function setupView(profile: StationProfile, station: typeof S.$inferSelect, family?: { head: StationIdent | null; members: StationIdent[] }): StationSetupView {
    return {
      station: profile.ident,
      description: station.description,
      status: station.status,
      firstSignedOnAt: station.firstSignedOnAt?.toISOString() ?? null,
      fixed: station.firstSignedOnAt !== null,
      bug: { mode: station.bugMode, position: station.bugPosition, opacity: station.bugOpacity },
      logoUrl: station.logoUrl,
      category: station.category,
      studioLocation: station.studioLatitude != null && station.studioLongitude != null ? { latitude: station.studioLatitude, longitude: station.studioLongitude } : null,
      legalName: station.legalName,
      legalContact: station.legalContact,
      pledgesTaxDeductible: station.pledgesTaxDeductible,
      memberCreditStyle: station.memberCreditStyle,
      orders: { takesOrders: station.kind === "studio" || station.takesOrders, turnaround: station.orderTurnaround, fromMicros: station.orderFromMicros },
      iabCategories: iabContentCategories({ override: station.iabCategories, category: station.category }),
      ...(family ? { sharesCallSignWith: family.head, callSignFamily: family.members } : {})
    };
  }

  /** `sealed`: its key is stored, sealed, in the platforms module (the translator's `platform_id`). */
  function translatorView(row: typeof schema.translators.$inferSelect, onAir: boolean, sealed: boolean): TranslatorView {
    const hasKey = Boolean(row.streamKey) || sealed;
    return {
      id: row.id,
      service: row.service,
      name: row.name,
      rtmpUrl: row.rtmpUrl,
      hasStreamKey: hasKey,
      breakHandling: row.breakHandling,
      prerecordedLabel: row.prerecordedLabel,
      enabled: row.enabled,
      status: !row.enabled || !hasKey ? "not_connected" : onAir ? "relaying" : "connected",
      burnCaptions: row.burnCaptions
    };
  }

  // ---- The old translators' keys, in the platforms module's sealed storage (2026-09-30) ----

  /** A configured PLATFORM_SECRETS_KEY (the development key doesn't count for moving keys). */
  const secretsConfigured = () => deps.platforms?.secrets.configured ?? Boolean(process.env.PLATFORM_SECRETS_KEY?.trim());
  let warnedNoSecretsKey = false;

  /** Who the connection says added it: the station's owner (the translator doesn't record who did). */
  async function connectedBy(stationId: string): Promise<string> {
    const [owner] = await services.accounts.stationMemberIds(stationId, ["owner"]);
    // The column is nullable: a station with no owner (a claimable one) has none.
    return owner ?? (null as unknown as string);
  }

  /** Seals a translator's key as a manual platform connection; its ID. 409 `secrets_key_missing` when keys can't be stored. */
  async function sealTranslator(row: typeof schema.translators.$inferSelect, streamKey: string): Promise<string> {
    const connection = await services.platforms.addManual(row.stationId, await connectedBy(row.stationId), { kind: kindOfTranslator(row.service, row.rtmpUrl), name: row.name, rtmpUrl: row.rtmpUrl, streamKey });
    return connection.id;
  }

  /** The key the platforms module holds for a connection, opened in memory only. */
  async function sealedKey(stationId: string, platformId: string): Promise<string | null> {
    const found = (await services.platforms.destinationsFor(stationId)).find((d) => d.platformId === platformId);
    return found?.streamKey ?? null;
  }

  async function sealedIds(stationId: string): Promise<Set<string>> {
    const { platforms } = await services.platforms.list(stationId);
    return new Set(platforms.filter((p) => p.hasStreamKey).map((p) => p.id));
  }

  const preview = (key: string | null) => (key ? `${key.slice(0, 8)}…` : null);
  /** The station's band (its primary channel's), for how its live sources are reached. */
  async function bandOfStation(stationId: string): Promise<Band | null> {
    const [row] = await db
      .select({ band: C.band })
      .from(C)
      .where(and(eq(C.stationId, stationId), eq(C.isPrimary, true), isNull(C.releasedAt)));
    return row?.band ?? null;
  }

  function liveSourceView(row: typeof schema.liveSources.$inferSelect, band: Band | null = null): LiveSourceView {
    // Radio: the worker's own ingest takes the sound. TV: Livepeer, when it's set up.
    const radio = band === "radio";
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      server: row.kind === "encoder" ? (radio ? WORKER_INGEST_SERVER : INGEST_SERVER) : null,
      route: radio ? "opencast" : row.livepeerStreamId ? "livepeer" : null,
      streamKeyPreview: preview(row.streamKey),
      signal: "not_connected",
      createdAt: row.createdAt.toISOString(),
      // S14: signal quality isn't measured yet.
      quality: null,
      previewUrl: !radio && row.livepeerPlaybackId ? `${LIVEPEER_PLAYBACK}/${row.livepeerPlaybackId}/index.m3u8` : null,
      // B3: a browser source sent through Livepeer publishes over WHIP with its stream key (TV only).
      ingest: !radio && row.kind === "browser" && row.livepeerStreamId && row.streamKey ? { whipUrl: `${WHIP_BASE}/${row.streamKey}`, token: row.streamKey } : null
    };
  }

  const newKey = (prefix: string) => `${prefix.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}-${randomBytes(12).toString("hex")}`;

  /**
   * A234: the notice's words when a member no longer shares an owner with X.1: "12.2 BEAT Beat
   * Tapes no longer shares an owner with 12.1 BEAT Inland Beat", what changed, who owns each now,
   * and that nothing changes by itself.
   */
  async function ownersApartWords(p: {
    head: typeof S.$inferSelect;
    member: typeof S.$inferSelect;
    headOwners: string[];
    memberOwners: string[];
    changed: string;
    change?: { before: string[]; after: string[] };
  }): Promise<{ title: string; body: string }> {
    const idents = await service.idents([p.head.id, p.member.id]);
    const h = idents.get(p.head.id);
    const m = idents.get(p.member.id);
    const short = (i: StationIdent | undefined, row: typeof S.$inferSelect) => [i?.channel, row.callSign].filter(Boolean).join(" ");
    const full = (i: StationIdent | undefined, row: typeof S.$inferSelect) => [short(i, row), row.name].filter(Boolean).join(" ");
    const people = await services.accounts.peopleByIds([...p.headOwners, ...p.memberOwners, ...(p.change?.before ?? []), ...(p.change?.after ?? [])]);
    const name = (u: string) => people.get(u)?.name ?? "Someone on the team";
    const list = (ids: string[]) => {
      const n = ids.map(name);
      return n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}` : (n[0] ?? "");
    };
    const owns = (ids: string[], what: string) => (ids.length ? `${list(ids)} ${ids.length === 1 ? "owns" : "own"} ${what}` : `Nobody owns ${what}`);
    const changedRow = p.changed === p.head.id ? p.head : p.member;
    const changedName = short(changedRow === p.head ? h : m, changedRow);
    let what = "";
    if (p.change) {
      const gone = p.change.before.filter((u) => !p.change!.after.includes(u));
      const added = p.change.after.filter((u) => !p.change!.before.includes(u));
      if (gone.length && added.length) what = `Ownership of ${changedName} moved from ${list(gone)} to ${list(added)}.`;
      else if (gone.length) what = `${list(gone)} no longer ${gone.length === 1 ? "owns" : "own"} ${changedName}.`;
      else if (added.length) what = `${list(added)} now ${added.length === 1 ? "owns" : "own"} ${changedName}.`;
    }
    const now = `${owns(p.memberOwners, short(m, p.member))}. ${owns(p.headOwners, short(h, p.head))}.`;
    const channel = m?.channel ?? "It";
    const after = p.member.firstSignedOnAt
      ? `${p.member.callSign} is fixed on air, so nothing changes by itself. Whether ${channel} keeps it is for you and the owners to decide.`
      : `Nothing changes by itself. Before ${channel} signs on, its owner can give it a call sign of its own.`;
    return { title: `${full(m, p.member)} no longer shares an owner with ${full(h, p.head)}`, body: [what, now, after].filter(Boolean).join(" ") };
  }

  const service: StationsService = {
    ...createRelayBackgrounds({ deps, services }),

    async idents(ids) {
      return new Map((await build(await rows(ids))).map((p) => [p.id, p.ident]));
    },

    async kindOf(stationId) {
      const [row] = await db.select({ kind: S.kind }).from(S).where(eq(S.id, stationId));
      return row?.kind ?? null;
    },

    async idsOfKinds(kinds) {
      if (!kinds.length) return [];
      return (await db.select({ id: S.id }).from(S).where(inArray(S.kind, kinds))).map((r) => r.id);
    },

    async removeHost(stationId, userId) {
      await db.delete(schema.hostAssignments).where(and(eq(schema.hostAssignments.stationId, stationId), eq(schema.hostAssignments.userId, userId)));
    },

    async isPublic(stationId) {
      return (await service.profiles([stationId])).get(stationId)?.public ?? false;
    },

    async profiles(ids) {
      return new Map((await build(await rows(ids))).map((p) => [p.id, p]));
    },

    async onDial(marketId, band) {
      const found = await db
        .select({ station: S, channel: C })
        .from(C)
        .innerJoin(S, eq(S.id, C.stationId))
        .where(and(eq(C.marketId, marketId), eq(C.band, band), eq(C.isPrimary, true), isNull(C.releasedAt)))
        .orderBy(asc(C.tenths));
      return (await build(found)).filter((p) => p.public);
    },

    async inMarkets(marketIds) {
      if (!marketIds.length) return [];
      const found = await db
        .select({ station: S, channel: C })
        .from(C)
        .innerJoin(S, eq(S.id, C.stationId))
        .where(and(inArray(C.marketId, marketIds), eq(C.isPrimary, true), isNull(C.releasedAt)))
        .orderBy(asc(C.band), asc(C.tenths));
      return build(found);
    },

    async byRef(ref) {
      if (/^[0-9a-f-]{36}$/i.test(ref)) {
        const [row] = await db.select({ id: S.id }).from(S).where(eq(S.id, ref));
        return row ? ((await service.profiles([row.id])).get(row.id) ?? null) : null;
      }
      // A229: a call sign (`sbco`) or a call sign and channel (`sbco-15-2`).
      const parsed = parseStationSlug(ref);
      if (!parsed) return null;
      let ids = await service.stationsWithCallSign(parsed.callSign);
      if (!ids.length) {
        // An address from before a call sign changed (A222): the name is held a year for the station
        // that had it, and a family's for X.1, so its family's addresses find their stations too.
        const holders = await services.waitlist.stationsHolding(parsed.callSign);
        if (holders.length) ids = (await db.select({ id: S.id }).from(S).where(or(inArray(S.id, holders), inArray(S.sharesCallSignWith, holders)))).map((r) => r.id);
      }
      const found = [...(await service.profiles(ids)).values()];
      if (parsed.tenths !== null) {
        const channel = formatChannelNumber({ band: "tv", tenths: parsed.tenths });
        return found.find((p) => p.ident.band === "tv" && p.ident.channel === channel) ?? null;
      }
      // The bare call sign is X.1's (or the one station's).
      return found.find((p) => !p.sharesCallSignWith) ?? found[0] ?? null;
    },

    async stationsWithCallSign(callSign) {
      return (await db.select({ id: S.id }).from(S).where(eq(S.callSign, callSign))).map((r) => r.id);
    },

    async familyIds(stationId) {
      const [row] = await db.select({ id: S.id, head: S.sharesCallSignWith }).from(S).where(eq(S.id, stationId));
      if (!row) return new Set();
      const head = row.head ?? row.id;
      const members = await db.select({ id: S.id }).from(S).where(eq(S.sharesCallSignWith, head));
      return new Set([head, ...members.map((m) => m.id)]);
    },

    async callSignFamily(stationId) {
      const [row] = await db.select({ id: S.id, head: S.sharesCallSignWith }).from(S).where(eq(S.id, stationId));
      if (!row) return null;
      const headId = row.head ?? row.id;
      const members = await db
        .select({ id: S.id })
        .from(S)
        .where(and(eq(S.sharesCallSignWith, headId), sql`${S.status} <> 'signed_off'`));
      if (!members.length && !row.head) return null;
      const all = await service.profiles([headId, ...members.map((m) => m.id)]);
      const head = all.get(headId);
      if (!head) return null;
      const tenths = (p: StationProfile) => (p.ident.channel ? Math.round(Number(p.ident.channel) * 10) : 0);
      return { head, members: members.flatMap((m) => all.get(m.id) ?? []).sort((a, b) => tenths(a) - tenths(b)) };
    },

    async checkCallSignOwners(stationId, change) {
      const [row] = await db.select({ id: S.id, head: S.sharesCallSignWith }).from(S).where(eq(S.id, stationId));
      if (!row) return;
      const headId = row.head ?? row.id;
      const [head] = await db.select().from(S).where(eq(S.id, headId));
      // Only an owner's own stations share by owner; an external family is the desk's own (A229).
      if (!head || head.kind !== "station") return;
      // Signed off for good: archived, as the family check treats it.
      const members = await db
        .select()
        .from(S)
        .where(and(eq(S.sharesCallSignWith, headId), eq(S.kind, "station"), sql`${S.status} <> 'signed_off'`));
      if (!members.length) return;
      const ownersOf = new Map<string, string[]>();
      for (const id of [headId, ...members.map((m) => m.id)]) ownersOf.set(id, await services.accounts.stationMemberIds(id, ["owner"]));
      const headOwners = new Set(ownersOf.get(headId));
      for (const m of members) {
        const together = ownersOf.get(m.id)!.some((u) => headOwners.has(u));
        if (together) {
          // An owner in common again: the next split is told again.
          if (m.ownersSplitAt) await db.update(S).set({ ownersSplitAt: null }).where(eq(S.id, m.id));
          continue;
        }
        // Told already for this split.
        if (m.ownersSplitAt) continue;
        const at = deps.clock.now();
        const [marked] = await db
          .update(S)
          .set({ ownersSplitAt: at })
          .where(and(eq(S.id, m.id), isNull(S.ownersSplitAt)))
          .returning({ id: S.id });
        if (!marked) continue;
        const words = await ownersApartWords({ head, member: m, headOwners: ownersOf.get(headId)!, memberOwners: ownersOf.get(m.id)!, changed: stationId, change });
        deps.bus.emit("station.call_sign_owners", {
          stationId: m.id,
          headId,
          step: "split",
          title: words.title,
          body: words.body,
          dedupeKey: `call-sign-owners:${m.id}:${at.getTime()}`
        });
      }
    },

    async callSignOwnersApart(marketId) {
      const apart = await db
        .select({ id: S.id, head: S.sharesCallSignWith, since: S.ownersSplitAt, firstSignedOnAt: S.firstSignedOnAt })
        .from(S)
        .innerJoin(C, and(eq(C.stationId, S.id), eq(C.isPrimary, true), isNull(C.releasedAt)))
        .where(and(eq(C.marketId, marketId), isNotNull(S.ownersSplitAt), isNotNull(S.sharesCallSignWith), eq(S.kind, "station"), sql`${S.status} <> 'signed_off'`))
        .orderBy(asc(S.ownersSplitAt));
      if (!apart.length) return [];
      const heads = [...new Set(apart.map((a) => a.head!))];
      const idents = await service.idents([...heads, ...apart.map((a) => a.id)]);
      const owners = new Map<string, string[]>();
      for (const id of [...heads, ...apart.map((a) => a.id)]) owners.set(id, await services.accounts.stationMemberIds(id, ["owner"]));
      const people = await services.accounts.peopleByIds([...owners.values()].flat());
      const names = (id: string) => (owners.get(id) ?? []).map((u) => people.get(u)?.name ?? "Someone on the team");
      return apart.flatMap((a) => {
        const head = idents.get(a.head!);
        const member = idents.get(a.id);
        if (!head || !member) return [];
        return [{ head, member, since: a.since!.toISOString(), headOwners: names(a.head!), memberOwners: names(a.id), fixed: a.firstSignedOnAt !== null }];
      });
    },

    async takenCallSigns(callSigns) {
      if (!callSigns.length) return new Set();
      const rows = await db.select({ callSign: S.callSign }).from(S).where(inArray(S.callSign, callSigns));
      return new Set(rows.map((r) => r.callSign).filter((c): c is string => !!c));
    },

    async search(q, marketId) {
      const text = q.trim();
      let tuneTo: StationProfile | null = null;
      // Numbers tune: "12.1", "12" or "88.4". An odd radio tenth ("99.1") is never a station here.
      const numeric = /^(\d{1,3})(?:\.(\d))?$/.exec(text);
      if (numeric) {
        const candidates: Array<{ band: Band; tenths: number }> = [];
        const major = Number(numeric[1]);
        const minor = numeric[2] !== undefined ? Number(numeric[2]) : null;
        const tv = parseChannelNumber("tv", `${major}.${minor ?? 1}`);
        const radio = minor !== null ? parseChannelNumber("radio", `${major}.${minor}`) : null;
        if (tv) candidates.push(tv);
        if (radio) candidates.push(radio);
        for (const c of candidates) {
          const found = await db
            .select({ station: S, channel: C })
            .from(C)
            .innerJoin(S, eq(S.id, C.stationId))
            .where(and(eq(C.band, c.band), eq(C.tenths, c.tenths), isNull(C.releasedAt), ...(marketId ? [eq(C.marketId, marketId)] : [])))
            .limit(1);
          const [profile] = (await build(found)).filter((p) => p.public);
          if (profile) {
            tuneTo = profile;
            break;
          }
        }
      }
      const pattern = `%${text.replace(/[%_]/g, "")}%`;
      const matches = await db
        .select({ id: S.id })
        .from(S)
        .where(or(ilike(S.callSign, `${text.replace(/[%_]/g, "").toUpperCase()}%`), ilike(S.name, pattern)))
        .limit(20);
      const stations = [...(await service.profiles(matches.map((m) => m.id))).values()].filter(
        (p) => p.public && (!marketId || p.marketId === marketId)
      );
      return { tuneTo, stations };
    },

    async timezoneOf(stationId) {
      const [row] = await db
        .select({ marketId: C.marketId })
        .from(C)
        .where(and(eq(C.stationId, stationId), eq(C.isPrimary, true), isNull(C.releasedAt)));
      if (!row) return DEFAULT_TZ;
      return (await services.network.marketsByIds([row.marketId])).get(row.marketId)?.timezone ?? DEFAULT_TZ;
    },

    async breakRule(stationId) {
      const [rule] = await db.select().from(schema.breakRules).where(eq(schema.breakRules.stationId, stationId));
      const blocked = await db.select().from(schema.blockedCategories).where(eq(schema.blockedCategories.stationId, stationId));
      return breakRuleView(rule, blocked.map((b) => b.category));
    },

    async adProfile(stationId) {
      const [station] = await db.select({ category: S.category, iabCategories: S.iabCategories }).from(S).where(eq(S.id, stationId));
      if (!station) throw notFound("That station");
      const rule = await service.breakRule(stationId);
      return {
        iabCategories: iabContentCategories({ override: station.iabCategories, category: station.category }),
        blockedIabAdProducts: blockedIabAdProducts(rule.blockedCategories),
        adsFromPartners: rule.adsFromPartners,
        // A station that never airs spots has no spot time to offer.
        spotMsPerHour: rule.cadence.spots.every === "never" ? 0 : rule.spotMsPerHour
      };
    },

    async withoutSpots(stationIds) {
      if (!stationIds.length) return new Set();
      const R = schema.breakRules;
      const rows = await db
        .select({ stationId: R.stationId })
        .from(R)
        .where(and(inArray(R.stationId, stationIds), sql`${R.cadence}->'spots'->>'every' = 'never'`));
      return new Set(rows.map((r) => r.stationId));
    },

    async liveSourceBelongs(stationId, sourceId) {
      const [row] = await db
        .select({ id: schema.liveSources.id })
        .from(schema.liveSources)
        .where(and(eq(schema.liveSources.id, sourceId), eq(schema.liveSources.stationId, stationId)));
      return Boolean(row);
    },

    async liveSourceSignal(sourceId) {
      const [row] = await db
        .select({ streamKey: schema.liveSources.streamKey, livepeerPlaybackId: schema.liveSources.livepeerPlaybackId })
        .from(schema.liveSources)
        .where(eq(schema.liveSources.id, sourceId));
      return row ?? null;
    },

    async liveSourceByKey(streamKey) {
      if (!streamKey) return null;
      const [row] = await db
        .select({ id: schema.liveSources.id, stationId: schema.liveSources.stationId })
        .from(schema.liveSources)
        .where(and(eq(schema.liveSources.streamKey, streamKey), eq(schema.liveSources.kind, "encoder")));
      return row ? { ...row, band: await bandOfStation(row.stationId) } : null;
    },

    async isHost(userId, stationId, programId) {
      if (!programId) return false;
      const [row] = await db
        .select({ userId: schema.hostAssignments.userId })
        .from(schema.hostAssignments)
        .where(
          and(eq(schema.hostAssignments.userId, userId), eq(schema.hostAssignments.stationId, stationId), eq(schema.hostAssignments.programId, programId))
        );
      return Boolean(row);
    },

    async identityReady(stationId) {
      const [found] = await rows([stationId]);
      return { callSign: Boolean(found?.station.callSign), channel: Boolean(found?.channel) };
    },

    async markSignedOn(tx, stationId) {
      const [station] = await tx.select().from(S).where(eq(S.id, stationId));
      if (!station) throw notFound("That station");
      if (station.kind === "studio") throw refused("studio", "A studio doesn't sign on.");
      const first = station.firstSignedOnAt === null;
      await tx
        .update(S)
        .set({ status: "on_air", updatedAt: deps.clock.now(), ...(first ? { firstSignedOnAt: deps.clock.now() } : {}) })
        .where(eq(S.id, stationId));
      return { first };
    },

    async byEscrowIds(ids) {
      if (!ids.length) return new Map();
      const rows = await db.select({ id: schema.stations.id, escrowId: schema.stations.escrowId }).from(schema.stations).where(inArray(schema.stations.escrowId, ids));
      return new Map(rows.map((r) => [r.escrowId, r.id]));
    },

    async handOver(tx, stationId) {
      await tx.update(schema.stations).set({ kind: "station" }).where(and(eq(schema.stations.id, stationId), eq(schema.stations.kind, "claimable")));
    },

    async markSignedOff(tx, stationId, permanently) {
      await tx
        .update(S)
        .set({ status: permanently ? "signed_off" : "off_air", signedOffAt: permanently ? deps.clock.now() : null, updatedAt: deps.clock.now() })
        .where(eq(S.id, stationId));
    },

    async look(stationId) {
      const [found] = await rows([stationId]);
      if (!found) return null;
      const [profile] = await build([found]);
      return {
        callSign: profile.ident.callSign,
        channel: profile.ident.channel,
        name: profile.ident.name,
        homeCity: profile.ident.homeCity,
        colour: profile.ident.colour,
        bug: { mode: found.station.bugMode, opacity: found.station.bugOpacity, position: found.station.bugPosition },
        logoUrl: found.station.logoUrl,
        band: found.channel?.band ?? "tv",
        ...(profile.ident.sharesCallSign ? { sharesCallSign: true } : {})
      };
    },

    async airingStationIds() {
      const rows = await db
        .select({ id: S.id })
        .from(S)
        .where(and(inArray(S.kind, ["station", "claimable"]), sql`${S.status} <> 'signed_off'`));
      return rows.map((r) => r.id);
    },

    async makers() {
      const rows = await db
        .select({ id: S.id, turnaround: S.orderTurnaround, fromMicros: S.orderFromMicros })
        .from(S)
        .where(or(eq(S.kind, "studio"), eq(S.takesOrders, true)));
      const profiles = await service.profiles(rows.map((r) => r.id));
      return rows.flatMap((r) => {
        const profile = profiles.get(r.id);
        return profile ? [{ profile, turnaround: r.turnaround, fromMicros: r.fromMicros }] : [];
      });
    },

    async relayModes(translatorIds) {
      // A station's ID (the relay service's sessions): the station's relay mode. A translator's
      // (a worker translator's session, before relay modes): it relayed everything.
      const stations = translatorIds.length ? await db.select({ id: S.id }).from(S).where(inArray(S.id, translatorIds)) : [];
      const modes = stations.length ? await services.relays.modes(stations.map((s) => s.id)) : new Map<string, "everything" | "live_only">();
      return new Map(translatorIds.map((id) => [id, modes.get(id) ?? ("everything" as const)]));
    },

    async translatorDestinations(stationId) {
      const rows = await db
        .select()
        .from(schema.translators)
        .where(and(eq(schema.translators.stationId, stationId), eq(schema.translators.enabled, true)));
      return rows.filter((r) => r.streamKey && !r.platformId).map((r) => ({ id: r.id, service: r.service, name: r.name, rtmpUrl: r.rtmpUrl, streamKey: r.streamKey! }));
    },

    async disabledTranslatorPlatforms(stationId) {
      const rows = await db
        .select({ platformId: schema.translators.platformId })
        .from(schema.translators)
        .where(and(eq(schema.translators.stationId, stationId), eq(schema.translators.enabled, false)));
      return new Set(rows.flatMap((r) => (r.platformId ? [r.platformId] : [])));
    },

    async liveSourceStreams(stationId) {
      const rows = await db
        .select({ id: schema.liveSources.id, livepeerStreamId: schema.liveSources.livepeerStreamId })
        .from(schema.liveSources)
        .where(eq(schema.liveSources.stationId, stationId));
      return rows.flatMap((r) => (r.livepeerStreamId ? [{ id: r.id, livepeerStreamId: r.livepeerStreamId }] : []));
    },

    async relays(stationId) {
      const all = await db
        .select()
        .from(schema.translators)
        .where(and(eq(schema.translators.stationId, stationId), eq(schema.translators.enabled, true)));
      // Pay-as-you-go: relays of everything the station airs pause at their cap, or past the grace
      // period of an unpaid bill (relays of live shows only are free and keep going). The channel doesn't.
      const paused = all.length ? (await services.billing.paused(stationId)).relays : false;
      const modes = paused ? await service.relayModes(all.map((r) => r.id)) : null;
      const rows = modes ? all.filter((r) => modes.get(r.id) === "live_only") : all;
      const background = rows.length && (await bandOfStation(stationId)) === "radio" ? await service.relayBackground(stationId) : null;
      // Keys moved to the platforms module are opened there (in memory only).
      const sealed = rows.some((r) => r.platformId) ? new Map((await services.platforms.destinationsFor(stationId)).map((d) => [d.platformId, d.streamKey])) : new Map<string, string>();
      return rows.flatMap((r) => {
        const streamKey = r.streamKey ?? (r.platformId ? sealed.get(r.platformId) : undefined);
        return streamKey ? [{ id: r.id, rtmpUrl: r.rtmpUrl, streamKey, breakHandling: r.breakHandling, burnCaptions: r.burnCaptions, background }] : [];
      });
    },

    async changeManaged(tx, stationId, input) {
      const [station] = await tx.select().from(S).where(eq(S.id, stationId));
      if (!station) throw notFound("That station");
      if (station.kind !== "listed") throw refused("not_external", "Only an external station's listing changes this way.");
      const patch = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.callSign !== undefined ? { callSign: input.callSign } : {}),
        // A229: joining X.1's family (its call sign) or leaving it (its own).
        ...(input.sharesCallSignWith !== undefined ? { sharesCallSignWith: input.sharesCallSignWith } : {})
      };
      if (Object.keys(patch).length) await tx.update(S).set({ ...patch, updatedAt: deps.clock.now() }).where(eq(S.id, stationId));
      if (input.channel) {
        await tx.update(C).set({ releasedAt: deps.clock.now() }).where(and(eq(C.stationId, stationId), eq(C.isPrimary, true), isNull(C.releasedAt)));
        await tx.insert(C).values({ stationId, marketId: input.channel.marketId, band: input.channel.band, tenths: input.channel.tenths });
      }
    },

    async releaseChannel(tx, stationId) {
      await tx.update(C).set({ releasedAt: deps.clock.now() }).where(and(eq(C.stationId, stationId), isNull(C.releasedAt)));
    },

    async releaseSignedOffChannels() {
      const before = new Date(deps.clock.now().getTime() - CHANNEL_HOLD_AFTER_SIGN_OFF_MS);
      const due = await db
        .selectDistinct({ id: S.id })
        .from(S)
        .innerJoin(C, and(eq(C.stationId, S.id), isNull(C.releasedAt)))
        .where(and(inArray(S.kind, ["station", "claimable", "catalog"]), eq(S.status, "signed_off"), isNotNull(S.signedOffAt), lte(S.signedOffAt, before)));
      if (!due.length) return 0;
      // A233: X.1 stays while a station sharing its call sign is on the air (the family hangs off its number).
      const onAir = await db
        .select({ head: S.sharesCallSignWith })
        .from(S)
        .where(and(inArray(S.sharesCallSignWith, due.map((d) => d.id)), sql`${S.status} <> 'signed_off'`));
      const keep = new Set(onAir.map((r) => r.head));
      const free = due.filter((d) => !keep.has(d.id));
      for (const d of free) await db.transaction((tx) => service.releaseChannel(tx, d.id));
      return free.length;
    },

    async createManaged(tx, input) {
      if (input.colour && !isValidStationColour(input.colour)) throw badRequest("That colour doesn't hold 4.5:1 against white.");
      const [station] = await tx
        .insert(S)
        .values({ kind: input.kind, name: input.name, callSign: input.callSign, colour: input.colour ?? null, description: input.description ?? null, sharesCallSignWith: input.sharesCallSignWith ?? null })
        .returning();
      await tx.insert(C).values({ stationId: station.id, marketId: input.marketId, band: input.band, tenths: input.tenths });
      await tx.insert(schema.breakRules).values({ stationId: station.id }).onConflictDoNothing();
      return station.id;
    },

    async create(user, input) {
      if (input.colour && !isValidStationColour(input.colour)) {
        throw badRequest("That colour doesn't hold 4.5:1 against white. Choose a darker one.", { colour: "Needs 4.5:1" });
      }
      if (input.kind === "studio" && !input.handle) throw badRequest("A studio needs a short handle.", { handle: "Required" });
      if (input.kind === "studio" && input.reservationId) throw refused("studio", "A studio has a handle, not a call sign.");
      // From a waitlist invite (added 2026-09-29): checked first, so nothing is made when it can't be used.
      const held = input.reservationId ? await services.waitlist.inviteFor(user, input.reservationId) : null;
      const stationId = await db.transaction(async (tx) => {
        const [station] = await tx
          .insert(S)
          .values({
            kind: input.kind,
            name: input.name,
            description: input.description ?? null,
            colour: input.colour?.toUpperCase() ?? null,
            handle: input.handle ?? null
          })
          .returning();
        await services.accounts.addStationMember(tx, station.id, user.id, "owner");
        await tx.insert(schema.breakRules).values({ stationId: station.id });
        if (held && input.reservationId) {
          // The reservation is the station's first, so the guards let it have the name and the channel.
          await services.waitlist.tieToStation(tx, input.reservationId, station.id);
          await tx.update(S).set({ callSign: held.callSign }).where(eq(S.id, station.id));
          if (held.channel) await tx.insert(C).values({ stationId: station.id, ...held.channel });
        }
        return station.id;
      });
      return service.setup(stationId);
    },

    async setup(stationId) {
      const [found] = await rows([stationId]);
      if (!found) throw notFound("That station");
      const [profile] = await build([found]);
      // A229: the X.1 it shares its call sign with, or the stations sharing its own.
      const family = await service.callSignFamily(stationId);
      return setupView(profile, found.station, {
        head: family && family.head.id !== stationId ? family.head.ident : null,
        members: family && family.head.id === stationId ? family.members.map((m) => m.ident) : []
      });
    },

    async updateSetup(user, stationId, input) {
      if (input.colour && !isValidStationColour(input.colour)) {
        throw badRequest("That colour doesn't hold 4.5:1 against white. Choose a darker one.", { colour: "Needs 4.5:1" });
      }
      const [current] = await db.select().from(S).where(eq(S.id, stationId));
      if (!current) throw notFound("That station");
      if (input.callSign && current.kind === "studio") throw refused("studio", "A studio has a handle, not a call sign.");
      if (input.callSign && current.firstSignedOnAt && input.callSign !== current.callSign) {
        throw refused("fixed_after_sign_on", "The call sign is fixed after first sign-on.");
      }
      // A229: a new call sign on X.1 is its family's too, so it can't change once one of them has signed on.
      const changingSign = !!input.callSign && input.callSign !== current.callSign;
      const signedOnMember = changingSign && !current.sharesCallSignWith
        ? (await db.select({ id: S.id }).from(S).where(and(eq(S.sharesCallSignWith, stationId), isNotNull(S.firstSignedOnAt))))[0]
        : undefined;
      if (signedOnMember) {
        const m = (await service.idents([signedOnMember.id])).get(signedOnMember.id);
        throw refused("fixed_after_sign_on", `${[m?.callSign, m?.channel].filter(Boolean).join(" ")} has signed on with this call sign, so it stays.`);
      }
      await db.transaction(async (tx) => {
        if (input.callSign && input.callSign !== current.callSign) {
          // Names Opencast won't allow (call_signs.refused, added 2026-09-29): 422 call_sign_refused.
          await services.waitlist.requireAllowed(input.callSign);
          // A call sign held on the waitlist goes to the person who reserved it.
          await services.waitlist.claimCallSign(tx, { callSign: input.callSign, stationId, userId: user.id });
        }
        const patch: Partial<typeof S.$inferInsert> = { updatedAt: deps.clock.now() };
        if (input.name !== undefined) patch.name = input.name;
        if (input.description !== undefined) patch.description = input.description;
        if (input.colour !== undefined) patch.colour = input.colour.toUpperCase();
        if (input.callSign !== undefined) patch.callSign = input.callSign;
        // A229: a station sharing X.1's call sign that takes its own stops sharing (before sign-on only).
        if (changingSign && current.sharesCallSignWith) {
          patch.sharesCallSignWith = null;
          // A234: out of the family, owners that differed from X.1's no longer matter.
          patch.ownersSplitAt = null;
        }
        if (input.bug?.mode !== undefined) patch.bugMode = input.bug.mode;
        if (input.bug?.position !== undefined) patch.bugPosition = input.bug.position;
        if (input.bug?.opacity !== undefined) patch.bugOpacity = input.bug.opacity;
        if (input.logoUrl !== undefined) patch.logoUrl = input.logoUrl;
        if (input.category !== undefined) patch.category = input.category;
        if (input.iabCategories !== undefined) patch.iabCategories = input.iabCategories ? [...new Set(input.iabCategories)] : null;
        if (input.homeCity !== undefined) patch.homeCity = input.homeCity;
        if (input.studioLocation !== undefined) {
          patch.studioLatitude = input.studioLocation?.latitude ?? null;
          patch.studioLongitude = input.studioLocation?.longitude ?? null;
        }
        if (input.legalName !== undefined) patch.legalName = input.legalName;
        if (input.legalContact !== undefined) patch.legalContact = input.legalContact;
        if (input.pledgesTaxDeductible !== undefined) patch.pledgesTaxDeductible = input.pledgesTaxDeductible;
        if (input.memberCreditStyle !== undefined) patch.memberCreditStyle = input.memberCreditStyle;
        if (input.orders?.takesOrders !== undefined) patch.takesOrders = input.orders.takesOrders;
        if (input.orders?.turnaround !== undefined) patch.orderTurnaround = input.orders.turnaround;
        if (input.orders?.fromMicros !== undefined) patch.orderFromMicros = input.orders.fromMicros;
        await tx.update(S).set(patch).where(eq(S.id, stationId));
      });
      return service.setup(stationId);
    },

    async availableChannels(marketId, band) {
      const taken = await db
        .select({ tenths: C.tenths })
        .from(C)
        .where(and(eq(C.marketId, marketId), eq(C.band, band), isNull(C.releasedAt)));
      const held = await services.waitlist.heldChannels(marketId, band);
      const takenSet = new Set(taken.map((t) => t.tenths));
      const heldSet = new Set(held.map((h) => h.tenths));
      // The market's numbering ranges (Network desk Settings, Markets; added 2026-09-29). By default
      // the whole band, so nothing changes until a market's own ranges are set.
      const range = await services.settings.numberingFor(marketId);
      const channels: Array<{ channel: string; state: "open" | "taken" | "held" }> = [];
      if (band === "tv") {
        for (let major = range.tv.firstMajor; major <= range.tv.lastMajor; major++) {
          // A major number is taken if anything in it is.
          const majorTaken = [...takenSet].some((t) => Math.floor(t / 10) === major);
          const majorHeld = [...heldSet].some((t) => Math.floor(t / 10) === major);
          channels.push({ channel: `${major}.1`, state: majorTaken ? "taken" : majorHeld ? "held" : "open" });
        }
      } else {
        for (const tenths of radioBandTenths()) {
          if (tenths < range.radio.firstTenths || tenths > range.radio.lastTenths) continue;
          channels.push({ channel: formatChannelNumber({ band, tenths }), state: takenSet.has(tenths) ? "taken" : heldSet.has(tenths) ? "held" : "open" });
        }
      }
      return channels;
    },

    async ownSubchannels(user, marketId, band) {
      if (band !== "tv" || !(await services.settings.valueAt("numbering.own_subchannels")).allowed) return [];
      const owned = await services.accounts.ownedStationIds(user.id);
      if (!owned.length) return [];
      const heads = (await service.profiles(owned)).values();
      const x1 = [...heads].filter((p) => p.kind === "station" && p.status !== "signed_off" && p.marketId === marketId && p.ident.band === "tv" && p.ident.channel?.endsWith(".1") && !p.sharesCallSignWith);
      if (!x1.length) return [];
      const [taken, held] = await Promise.all([
        db.select({ tenths: C.tenths }).from(C).where(and(eq(C.marketId, marketId), eq(C.band, "tv"), isNull(C.releasedAt))),
        services.waitlist.heldChannels(marketId, "tv")
      ]);
      const used = new Set([...taken.map((t) => t.tenths), ...held.map((h) => h.tenths)]);
      return x1.flatMap((p) => {
        const base = Math.round(Number(p.ident.channel) * 10);
        for (let t = base + 1; t < base + 9; t++) if (!used.has(t)) return [{ channel: formatChannelNumber({ band: "tv", tenths: t }), beside: p.ident }];
        return [];
      });
    },

    async chooseChannel(stationId, input, user) {
      const number = parseChannelNumber(input.band, input.channel);
      if (!number) throw badRequest(input.band === "tv" ? "TV channels run from 2.1 to 69.9." : "Radio runs from 88.2 to 107.8, in even tenths.", { channel: "Out of range" });
      // A230 (Open, rule numbering.own_subchannels): an owner's own subchannel beside their X.1.
      let head: StationProfile | null = null;
      if (isSubchannel(number)) {
        const words = "A station gets X.1. Subchannels are for stations you carry around the clock.";
        if (!(await services.settings.valueAt("numbering.own_subchannels")).allowed) throw badRequest(words, { channel: "Use X.1" });
        const major = Math.floor(number.tenths / 10);
        const [x1] = await db
          .select({ id: C.stationId })
          .from(C)
          .where(and(eq(C.marketId, input.marketId), eq(C.band, "tv"), eq(C.tenths, familyHeadTenths(number.tenths)), eq(C.isPrimary, true), isNull(C.releasedAt)));
        head = x1 ? ((await service.profiles([x1.id])).get(x1.id) ?? null) : null;
        if (!head) throw badRequest(`Start at ${major}.1. A subchannel goes beside your own station on its .1.`, { channel: "Use X.1" });
        const mine = !!user && (await services.accounts.stationMemberIds(head.id, ["owner"])).includes(user.id);
        if (head.id === stationId || head.kind !== "station" || !mine) {
          throw conflict("not_your_subchannel", `${[head.ident.channel, head.ident.callSign].filter(Boolean).join(" ")} isn't yours. A subchannel goes beside a station you own.`);
        }
        if (head.status === "signed_off") throw conflict("not_your_subchannel", `${[head.ident.channel, head.ident.callSign].filter(Boolean).join(" ")} has signed off for good.`);
        if (head.sharesCallSignWith) throw badRequest(`Start at ${major}.1.`, { channel: "Use X.1" });
      }
      if (!(await services.network.marketsByIds([input.marketId])).size) throw badRequest("That market doesn't exist.");
      const range = await services.settings.numberingFor(input.marketId);
      const outside =
        input.band === "tv"
          ? Math.floor(number.tenths / 10) < range.tv.firstMajor || Math.floor(number.tenths / 10) > range.tv.lastMajor
          : number.tenths < range.radio.firstTenths || number.tenths > range.radio.lastTenths;
      if (outside) {
        const words = input.band === "tv" ? `TV channels here run from ${range.tv.firstMajor}.1 to ${range.tv.lastMajor}.9.` : `Radio here runs from ${(range.radio.firstTenths / 10).toFixed(1)} to ${(range.radio.lastTenths / 10).toFixed(1)}.`;
        throw refused("outside_numbering", `${words} Choose a number in the market's range.`);
      }
      const [station] = await db.select().from(S).where(eq(S.id, stationId));
      if (!station) throw notFound("That station");
      if (station.firstSignedOnAt) throw refused("fixed_after_sign_on", "The channel is fixed after first sign-on.");
      if (head && station.kind !== "station") throw badRequest("A station gets X.1. Subchannels are for stations you carry around the clock.", { channel: "Use X.1" });
      const [current] = await db.select().from(C).where(and(eq(C.stationId, stationId), eq(C.isPrimary, true), isNull(C.releasedAt)));
      const moving = !current || current.marketId !== input.marketId || current.band !== input.band || current.tenths !== number.tenths;
      // A229: X.1 stays put while stations share its call sign.
      if (moving) {
        const family = await service.callSignFamily(stationId);
        if (family && family.head.id === stationId && family.members.length) {
          const names = family.members.map((m) => [m.ident.channel, m.ident.callSign].filter(Boolean).join(" ")).join(", ");
          throw conflict("family_channel", `${names} ${family.members.length === 1 ? "shares" : "share"} this station's call sign. Move ${family.members.length === 1 ? "it" : "them"} first.`);
        }
        if (head) {
          const [taken] = await db.select({ id: C.id }).from(C).where(and(eq(C.marketId, input.marketId), eq(C.band, "tv"), eq(C.tenths, number.tenths), isNull(C.releasedAt)));
          const held = (await services.waitlist.heldChannels(input.marketId, "tv")).some((h) => h.tenths === number.tenths);
          if (taken || held) throw conflict("channel_taken", `${input.channel} is taken. Pick another.`);
        }
      }
      // Sharing X.1's call sign: asked for, or kept by one already sharing it that moves within the family.
      const share = !!head && (input.shareCallSign ?? station.sharesCallSignWith === head.id);
      if (share && !head!.ident.callSign) throw badRequest(`${head!.ident.channel} needs its call sign first.`, { shareCallSign: "X.1 has no call sign yet" });
      await db.transaction(async (tx) => {
        if (current) {
          await tx.update(C).set({ marketId: input.marketId, band: input.band, tenths: number.tenths }).where(eq(C.id, current.id));
        } else {
          await tx.insert(C).values({ stationId, marketId: input.marketId, band: input.band, tenths: number.tenths });
        }
        if (share) {
          // A234: a new link is made with an owner in common (the database checks it); one moving within its family keeps its mark.
          const relinked = station.sharesCallSignWith !== head!.id;
          await tx.update(S).set({ callSign: head!.ident.callSign, sharesCallSignWith: head!.id, ...(relinked ? { ownersSplitAt: null } : {}), updatedAt: deps.clock.now() }).where(eq(S.id, stationId));
        } else if (station.sharesCallSignWith) {
          // It stops sharing: it chooses its own call sign next.
          await tx.update(S).set({ callSign: null, sharesCallSignWith: null, ownersSplitAt: null, updatedAt: deps.clock.now() }).where(eq(S.id, stationId));
        }
        // Another than the channel held with its waitlist call sign: the held one goes (added 2026-09-29).
        await services.waitlist.releaseOtherChannels(tx, stationId, { marketId: input.marketId, band: input.band, tenths: number.tenths });
      });
      return service.setup(stationId);
    },

    async resolveBreakRule(stationId, rule) {
      const [stored] = await db.select().from(schema.breakRules).where(eq(schema.breakRules.stationId, stationId));
      const { set, categories } = resolveBreakRuleWrite(rule, stored);
      // What `breakRule()` reads after the write: the stored row with what's sent over it.
      const written = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined)) as Partial<BreakRuleRow>;
      return breakRuleView({ ...(stored ?? {}), ...written }, categories);
    },

    async setBreakRule(stationId, rule) {
      const [stored] = await db.select().from(schema.breakRules).where(eq(schema.breakRules.stationId, stationId));
      const { set, categories } = resolveBreakRuleWrite(rule, stored);
      await db.transaction(async (tx) => {
        await tx
          .insert(schema.breakRules)
          .values({
            stationId,
            ...set,
            adsFromPartners: set.adsFromPartners ?? false,
            cadence: set.cadence ?? null,
            stationIdAfterOpener: set.stationIdAfterOpener ?? false,
            dailyOpener: set.dailyOpener ?? false,
            bumperSequences: set.bumperSequences ?? null,
            updatedAt: deps.clock.now()
          })
          .onConflictDoUpdate({
            target: schema.breakRules.stationId,
            // Left out (an app from before), each optional field stays as set.
            set: { ...Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined)), updatedAt: deps.clock.now() }
          });
        await tx.delete(schema.blockedCategories).where(eq(schema.blockedCategories.stationId, stationId));
        if (categories.length) await tx.insert(schema.blockedCategories).values(categories.map((category) => ({ stationId, category })));
      });
      return service.breakRule(stationId);
    },

    async translators(stationId) {
      const [list, status, sealed] = await Promise.all([
        db.select().from(schema.translators).where(eq(schema.translators.stationId, stationId)).orderBy(asc(schema.translators.createdAt)),
        services.playout.statusFor([stationId]),
        sealedIds(stationId)
      ]);
      const onAir = status.get(stationId)?.onAir ?? false;
      return list.map((t) => translatorView(t, onAir, Boolean(t.platformId && sealed.has(t.platformId))));
    },

    // Since 2026-09-30 a translator's key is written only to the platforms module, sealed (a manual
    // connection the translator points at); the translator keeps its name, break setting and switches.
    async addTranslator(stationId, input) {
      const { streamKey, ...rest } = input;
      const [row] = await db.insert(schema.translators).values({ stationId, ...rest, streamKey: null }).returning();
      try {
        const platformId = await sealTranslator(row, streamKey);
        const [linked] = await db.update(schema.translators).set({ platformId }).where(eq(schema.translators.id, row.id)).returning();
        return translatorView(linked, false, true);
      } catch (error) {
        await db.delete(schema.translators).where(eq(schema.translators.id, row.id));
        throw error;
      }
    },

    async updateTranslator(stationId, translatorId, input) {
      const [current] = await db
        .select()
        .from(schema.translators)
        .where(and(eq(schema.translators.id, translatorId), eq(schema.translators.stationId, stationId)));
      if (!current) throw notFound("That relay");
      const { streamKey, ...rest } = input;
      const [row] = Object.keys(rest).length ? await db.update(schema.translators).set(rest).where(eq(schema.translators.id, translatorId)).returning() : [current];
      // A new key or address (or a key still in plain text): sealed into a new connection, the old one removed after.
      const moves = streamKey !== undefined || (rest.rtmpUrl !== undefined && rest.rtmpUrl !== current.rtmpUrl) || (rest.service !== undefined && rest.service !== current.service) || (current.streamKey !== null && !current.platformId);
      if (!moves) return translatorView(row, false, Boolean(row.platformId && (await sealedIds(stationId)).has(row.platformId)));
      const key = streamKey ?? current.streamKey ?? (current.platformId ? await sealedKey(stationId, current.platformId) : null);
      if (!key) return translatorView(row, false, false);
      const platformId = await sealTranslator(row, key);
      const [linked] = await db.update(schema.translators).set({ platformId, streamKey: null }).where(eq(schema.translators.id, translatorId)).returning();
      if (current.platformId && current.platformId !== platformId) await services.platforms.remove(stationId, current.platformId).catch(() => undefined);
      return translatorView(linked, false, true);
    },

    async removeTranslator(stationId, translatorId) {
      const removed = await db
        .delete(schema.translators)
        .where(and(eq(schema.translators.id, translatorId), eq(schema.translators.stationId, stationId)))
        .returning({ id: schema.translators.id, platformId: schema.translators.platformId });
      if (!removed.length) throw notFound("That relay");
      // Its sealed key goes too (erased, in one click).
      if (removed[0].platformId) await services.platforms.remove(stationId, removed[0].platformId).catch(() => undefined);
    },

    async moveTranslatorKeys() {
      const rows = await db.select().from(schema.translators).where(isNotNull(schema.translators.streamKey));
      if (!rows.length) return { moved: 0, waiting: 0, failed: 0 };
      if (!secretsConfigured()) {
        if (!warnedNoSecretsKey) {
          warnedNoSecretsKey = true;
          console.warn(`[stations] ${rows.length} translator ${rows.length === 1 ? "key is" : "keys are"} still in plain text: set PLATFORM_SECRETS_KEY to seal ${rows.length === 1 ? "it" : "them"}.`);
        }
        return { moved: 0, waiting: rows.length, failed: 0 };
      }
      let moved = 0;
      let failed = 0;
      const stations = new Set<string>();
      for (const row of rows) {
        const plain = row.streamKey!;
        try {
          let platformId = row.platformId;
          if (!platformId || (await sealedKey(row.stationId, platformId)) !== plain) {
            platformId = await sealTranslator(row, plain);
            await db.update(schema.translators).set({ platformId }).where(eq(schema.translators.id, row.id));
          }
          // Checked before the plain key goes: the sealed copy opens to the same key.
          if ((await sealedKey(row.stationId, platformId)) !== plain) throw new Error("the sealed copy didn't match");
          await db
            .update(schema.translators)
            .set({ streamKey: null })
            .where(and(eq(schema.translators.id, row.id), eq(schema.translators.streamKey, plain)));
          stations.add(row.stationId);
          moved++;
        } catch (error) {
          failed++;
          // Never the key.
          console.error(`[stations] translator ${row.id}'s key couldn't be moved: ${(error as Error).message}`);
        }
      }
      // The station's one relay setting from its translators: the slate if any showed it (spots never
      // go where the station said not), and "Everything I air", which the worker's translators relayed.
      for (const stationId of stations) {
        const mine = await db.select().from(schema.translators).where(eq(schema.translators.stationId, stationId));
        await services.relays.adoptTranslatorSettings(stationId, {
          breakHandling: mine.some((t) => t.breakHandling === "station_id_slate") ? "station_id_slate" : "air_spots",
          mode: mine.some((t) => t.enabled) ? "everything" : "live_only"
        });
      }
      return { moved, waiting: 0, failed };
    },

    async liveSources(stationId) {
      const list = await db.select().from(schema.liveSources).where(eq(schema.liveSources.stationId, stationId)).orderBy(asc(schema.liveSources.createdAt));
      const band = await bandOfStation(stationId);
      return list.map((row) => liveSourceView(row, band));
    },

    async addLiveSource(stationId, input) {
      const [station] = await db.select({ callSign: S.callSign, name: S.name }).from(S).where(eq(S.id, stationId));
      let streamKey = input.kind === "encoder" ? newKey(`${station?.callSign ?? station?.name ?? "live"}-${input.name}`) : null;
      let livepeer: { streamId: string; playbackId: string } | null = null;
      const band = await bandOfStation(stationId);
      // Radio never goes through Livepeer: the worker takes the sound itself, with Opencast's own key.
      if (hasLivepeerApiKey() && band !== "radio") {
        // Encoders (RTMP) and browsers (WHIP, B3) send to Livepeer; playout reads the source back from Livepeer's playback.
        const stream = await createLivepeerStream(`${station?.callSign ?? station?.name} live: ${input.name}`);
        streamKey = stream.streamKey;
        livepeer = { streamId: stream.streamId, playbackId: stream.playbackId };
      }
      const [row] = await db
        .insert(schema.liveSources)
        .values({ stationId, kind: input.kind, name: input.name, streamKey, livepeerStreamId: livepeer?.streamId ?? null, livepeerPlaybackId: livepeer?.playbackId ?? null })
        .returning();
      return { source: liveSourceView(row, band), streamKey };
    },

    async resetLiveSourceKey(stationId, sourceId) {
      const [current] = await db
        .select()
        .from(schema.liveSources)
        .where(and(eq(schema.liveSources.id, sourceId), eq(schema.liveSources.stationId, stationId)));
      if (!current) throw notFound("That live source");
      if (current.kind !== "encoder") throw refused("not_an_encoder", "Only encoders have a key.");
      const streamKey = newKey(current.name);
      const [row] = await db.update(schema.liveSources).set({ streamKey }).where(eq(schema.liveSources.id, sourceId)).returning();
      return { source: liveSourceView(row, await bandOfStation(stationId)), streamKey };
    },

    async removeLiveSource(stationId, sourceId) {
      const removed = await db
        .delete(schema.liveSources)
        .where(and(eq(schema.liveSources.id, sourceId), eq(schema.liveSources.stationId, stationId)))
        .returning({ id: schema.liveSources.id });
      if (!removed.length) throw notFound("That live source");
    },

    async setHosts(stationId, programId, userIds) {
      const members = new Set(await services.accounts.stationMemberIds(stationId));
      const outsiders = userIds.filter((id) => !members.has(id));
      if (outsiders.length) throw badRequest("Hosts have to be on the station's team first.");
      await db.transaction(async (tx) => {
        await tx.delete(schema.hostAssignments).where(and(eq(schema.hostAssignments.stationId, stationId), eq(schema.hostAssignments.programId, programId)));
        if (userIds.length) await tx.insert(schema.hostAssignments).values(userIds.map((userId) => ({ stationId, programId, userId })));
      });
      return userIds;
    },

    async hostPrograms(stationId) {
      const rows = await db.select().from(schema.hostAssignments).where(eq(schema.hostAssignments.stationId, stationId));
      const by = new Map<string, string[]>();
      for (const r of rows) by.set(r.userId, [...(by.get(r.userId) ?? []), r.programId]);
      return by;
    },

    async addHost(tx, stationId, userId, programIds) {
      if (!programIds.length) return;
      const live = new Set((await services.library.programsForStation(stationId)).filter((p) => p.live).map((p) => p.id));
      const wanted = programIds.filter((id) => live.has(id));
      if (wanted.length) await tx.insert(schema.hostAssignments).values(wanted.map((programId) => ({ stationId, userId, programId }))).onConflictDoNothing();
    },

    async hosts(stationId, onlyFor) {
      const [programs, assignments] = await Promise.all([services.library.programsForStation(stationId), db.select().from(schema.hostAssignments).where(eq(schema.hostAssignments.stationId, stationId))]);
      const names = await services.accounts.displayNames([...new Set(assignments.map((a) => a.userId))]);
      return programs
        .filter((p) => p.live)
        .filter((p) => !onlyFor || assignments.some((a) => a.programId === p.id && a.userId === onlyFor))
        .map((p) => ({
          programId: p.id,
          title: p.title,
          hosts: assignments.filter((a) => a.programId === p.id).map((a) => ({ userId: a.userId, displayName: names.get(a.userId) ?? null }))
        }));
    },

    async lowerThird(stationId, entryId, programId) {
      const [row] = await db.select().from(schema.lowerThirds).where(and(eq(schema.lowerThirds.logEntryId, entryId), eq(schema.lowerThirds.stationId, stationId)));
      if (row) return { entryId, hidden: row.hidden, speakerId: row.speakerId, name: row.name, title: row.title, updatedAt: row.updatedAt.toISOString() };
      const [first] = programId ? await service.speakers(programId) : [];
      return { entryId, hidden: false, speakerId: first?.id ?? null, name: first?.name ?? "", title: first?.title ?? null, updatedAt: null };
    },

    async setLowerThird(stationId, entryId, programId, userId, input) {
      let { name, title } = input;
      if (input.speakerId) {
        // A speaker from the list: their name and title as the list has them.
        const speaker = programId ? (await service.speakers(programId)).find((sp) => sp.id === input.speakerId) : undefined;
        if (!speaker) throw badRequest("That speaker isn't on the program's list.", { speakerId: "Not on the list" });
        name = speaker.name;
        title = speaker.title;
      } else if (!input.hidden && !name.trim()) {
        throw badRequest("Give a name to show.", { name: "Required" });
      }
      const values = { logEntryId: entryId, stationId, hidden: input.hidden, speakerId: input.speakerId, name, title, updatedBy: userId, updatedAt: deps.clock.now() };
      await db.insert(schema.lowerThirds).values(values).onConflictDoUpdate({ target: schema.lowerThirds.logEntryId, set: values });
      return service.lowerThird(stationId, entryId, programId);
    },

    async speakers(programId) {
      const list = await db.select().from(schema.speakers).where(eq(schema.speakers.programId, programId)).orderBy(asc(schema.speakers.position));
      return list.map((s) => ({ id: s.id, name: s.name, title: s.title, position: s.position }));
    },

    async setSpeakers(programId, speakers) {
      await db.transaction(async (tx) => {
        await tx.delete(schema.speakers).where(eq(schema.speakers.programId, programId));
        if (speakers.length) await tx.insert(schema.speakers).values(speakers.map((s, position) => ({ programId, name: s.name, title: s.title, position })));
      });
      return service.speakers(programId);
    }
  };
  return service;
}
