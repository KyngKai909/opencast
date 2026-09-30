import { randomBytes } from "node:crypto";
import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { blockedIabAdProducts, formatChannelNumber, iabContentCategories, isSubchannel, isValidStationColour, parseChannelNumber, radioBandTenths, type Band } from "@opencast/domain";
import type { StationIdent } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import { createLivepeerStream, hasLivepeerApiKey } from "../../../livepeer.js";
import type { CurrentUser } from "../../http.js";
import { badRequest, notFound, refused } from "../../errors.js";
import { createRelayBackgrounds, type RelayBackgroundView } from "./relayBackground.js";
import { cadenceOf, type BreakCadence } from "../playout/engine/cadence.js";

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
  byRef(ref: string): Promise<StationProfile | null>;
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
  } | null>;
  /** Added 2026-09-29: stations that air (a station or a claimable one, setting up or on air, not signed off for good). */
  airingStationIds(): Promise<string[]>;
  /** Stations that take orders, and studios. */
  makers(): Promise<Array<{ profile: StationProfile; turnaround: string | null; fromMicros: number | null }>>;
  /** For playout: every enabled relay, with its key (and a radio station's background, once prepared). */
  relays(stationId: string): Promise<Array<{ id: string; rtmpUrl: string; streamKey: string; breakHandling: "air_spots" | "station_id_slate"; burnCaptions: boolean; background: { loopKey: string; frames: number } | null }>>;
  /** A radio station's relay background (added 2026-09-29). */
  getRelayBackground(stationId: string): Promise<RelayBackgroundView | null>;
  setRelayBackground(stationId: string, file: import("../../http.js").UploadedFile | null): Promise<RelayBackgroundView>;
  removeRelayBackground(stationId: string): Promise<void>;
  /** For playout: the prepared background loop, when ready. */
  relayBackground(stationId: string): Promise<{ loopKey: string; frames: number } | null>;
  settleRelayBackgrounds(): Promise<void>;
  /** Used by Network desk to set up claimable, listed and catalog stations. */
  createManaged(db: Executor, input: { kind: StationKind; name: string; callSign: string; colour?: string; marketId: string; band: Band; tenths: number; description?: string }): Promise<string>;

  create(user: CurrentUser, input: { kind: "station" | "studio"; name: string; description?: string; colour?: string; handle?: string }): Promise<StationSetupView>;
  setup(stationId: string): Promise<StationSetupView>;
  updateSetup(user: CurrentUser, stationId: string, input: SetupPatch): Promise<StationSetupView>;
  availableChannels(marketId: string, band: Band): Promise<Array<{ channel: string; state: "open" | "taken" | "held" }>>;
  chooseChannel(stationId: string, input: { marketId: string; band: Band; channel: string }): Promise<StationSetupView>;
  /** `adsFromPartners` left out keeps the station's current switch (older apps don't send it). */
  setBreakRule(stationId: string, rule: Omit<BreakRuleView, "adsFromPartners" | "cadence"> & { adsFromPartners?: boolean; cadence?: Omit<BreakCadence, "spots"> & { spots?: BreakCadence["spots"] } }): Promise<BreakRuleView>;
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
    return found.map(({ station, channel }) => {
      const ident: StationIdent = {
        id: station.id,
        kind: station.kind,
        callSign: station.callSign,
        handle: station.handle,
        name: station.name,
        colour: station.colour,
        band: channel?.band ?? null,
        channel: channel ? formatChannelNumber({ band: channel.band, tenths: channel.tenths }) : null,
        marketSlug: channel ? (markets.get(channel.marketId)?.slug ?? null) : null,
        homeCity: station.homeCity
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
        escrowId: station.escrowId
      };
    });
  }

  function setupView(profile: StationProfile, station: typeof S.$inferSelect): StationSetupView {
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
      iabCategories: iabContentCategories({ override: station.iabCategories, category: station.category })
    };
  }

  function translatorView(row: typeof schema.translators.$inferSelect, onAir: boolean): TranslatorView {
    return {
      id: row.id,
      service: row.service,
      name: row.name,
      rtmpUrl: row.rtmpUrl,
      hasStreamKey: row.streamKey.length > 0,
      breakHandling: row.breakHandling,
      prerecordedLabel: row.prerecordedLabel,
      enabled: row.enabled,
      status: !row.enabled || !row.streamKey ? "not_connected" : onAir ? "relaying" : "connected",
      burnCaptions: row.burnCaptions
    };
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
      const isId = /^[0-9a-f-]{36}$/i.test(ref);
      const [row] = await db
        .select({ id: S.id })
        .from(S)
        .where(isId ? eq(S.id, ref) : eq(S.callSign, ref.toUpperCase()));
      return row ? ((await service.profiles([row.id])).get(row.id) ?? null) : null;
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
      return {
        mode: rule?.mode ?? "after_every_program",
        everyMinutes: rule?.everyMinutes ?? null,
        lengthMs: rule?.lengthMs ?? 120_000,
        spotMsPerHour: rule?.spotMsPerHour ?? 180_000,
        sameSpotPerHour: rule?.sameSpotPerHour ?? 2,
        fillOrder: (rule?.fillOrder as LogCode[] | undefined) ?? ["SPT", "UND", "BMP", "SID"],
        openTimeTo: rule?.openTimeTo ?? "spot_market",
        blockedCategories: blocked.map((b) => b.category).sort(),
        adsFromPartners: rule?.adsFromPartners ?? false,
        cadence: cadenceOf(rule?.cadence)
      };
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
        band: found.channel?.band ?? "tv"
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

    async relays(stationId) {
      const rows = await db
        .select()
        .from(schema.translators)
        .where(and(eq(schema.translators.stationId, stationId), eq(schema.translators.enabled, true)));
      const background = rows.length && (await bandOfStation(stationId)) === "radio" ? await service.relayBackground(stationId) : null;
      return rows.filter((r) => r.streamKey).map((r) => ({ id: r.id, rtmpUrl: r.rtmpUrl, streamKey: r.streamKey, breakHandling: r.breakHandling, burnCaptions: r.burnCaptions, background }));
    },

    async createManaged(tx, input) {
      if (input.colour && !isValidStationColour(input.colour)) throw badRequest("That colour doesn't hold 4.5:1 against white.");
      const [station] = await tx
        .insert(S)
        .values({ kind: input.kind, name: input.name, callSign: input.callSign, colour: input.colour ?? null, description: input.description ?? null })
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
        return station.id;
      });
      return service.setup(stationId);
    },

    async setup(stationId) {
      const [found] = await rows([stationId]);
      if (!found) throw notFound("That station");
      const [profile] = await build([found]);
      return setupView(profile, found.station);
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
      await db.transaction(async (tx) => {
        if (input.callSign && input.callSign !== current.callSign) {
          // A call sign held on the waitlist goes to the person who reserved it.
          await services.waitlist.claimCallSign(tx, { callSign: input.callSign, stationId, userId: user.id });
        }
        const patch: Partial<typeof S.$inferInsert> = { updatedAt: deps.clock.now() };
        if (input.name !== undefined) patch.name = input.name;
        if (input.description !== undefined) patch.description = input.description;
        if (input.colour !== undefined) patch.colour = input.colour.toUpperCase();
        if (input.callSign !== undefined) patch.callSign = input.callSign;
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
      const channels: Array<{ channel: string; state: "open" | "taken" | "held" }> = [];
      if (band === "tv") {
        for (let major = 2; major <= 69; major++) {
          // A major number is taken if anything in it is.
          const majorTaken = [...takenSet].some((t) => Math.floor(t / 10) === major);
          const majorHeld = [...heldSet].some((t) => Math.floor(t / 10) === major);
          channels.push({ channel: `${major}.1`, state: majorTaken ? "taken" : majorHeld ? "held" : "open" });
        }
      } else {
        for (const tenths of radioBandTenths()) {
          channels.push({ channel: formatChannelNumber({ band, tenths }), state: takenSet.has(tenths) ? "taken" : heldSet.has(tenths) ? "held" : "open" });
        }
      }
      return channels;
    },

    async chooseChannel(stationId, input) {
      const number = parseChannelNumber(input.band, input.channel);
      if (!number) throw badRequest(input.band === "tv" ? "TV channels run from 2.1 to 69.9." : "Radio runs from 88.2 to 107.8, in even tenths.", { channel: "Out of range" });
      if (isSubchannel(number)) throw badRequest("A station gets X.1. Subchannels are for stations you carry around the clock.", { channel: "Use X.1" });
      if (!(await services.network.marketsByIds([input.marketId])).size) throw badRequest("That market doesn't exist.");
      const [station] = await db.select().from(S).where(eq(S.id, stationId));
      if (!station) throw notFound("That station");
      if (station.firstSignedOnAt) throw refused("fixed_after_sign_on", "The channel is fixed after first sign-on.");
      await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(C).where(and(eq(C.stationId, stationId), eq(C.isPrimary, true), isNull(C.releasedAt)));
        if (existing) {
          await tx.update(C).set({ marketId: input.marketId, band: input.band, tenths: number.tenths }).where(eq(C.id, existing.id));
        } else {
          await tx.insert(C).values({ stationId, marketId: input.marketId, band: input.band, tenths: number.tenths });
        }
      });
      return service.setup(stationId);
    },

    async setBreakRule(stationId, rule) {
      if (rule.mode === "every_n_minutes" && !rule.everyMinutes) throw badRequest("Say how often.", { everyMinutes: "Required" });
      const fillOrder = [...rule.fillOrder.filter((c) => c !== "SID"), "SID" as const];
      // How often each part airs (added 2026-09-29): left out, what's set stays; so does how
      // often spots air when only they are left out (an app from before they had a choice).
      let cadence: BreakCadence | undefined;
      if (rule.cadence) {
        if ((rule.cadence.stationId.every as string) === "never") throw badRequest("The station ID can't be turned off. Choose how often it airs.", { "cadence.stationId": "Required" });
        for (const [part, c] of Object.entries(rule.cadence)) {
          if (c && c.every === "n_programs" && !c.n) throw badRequest("Say after how many programs.", { [`cadence.${part}.n`]: "Required" });
        }
        cadence = cadenceOf({ ...rule.cadence, spots: rule.cadence.spots ?? (await service.breakRule(stationId)).cadence.spots });
      }
      await db.transaction(async (tx) => {
        await tx
          .insert(schema.breakRules)
          .values({
            stationId,
            mode: rule.mode,
            everyMinutes: rule.mode === "every_n_minutes" ? rule.everyMinutes : null,
            lengthMs: rule.lengthMs,
            spotMsPerHour: rule.spotMsPerHour,
            sameSpotPerHour: rule.sameSpotPerHour,
            fillOrder,
            openTimeTo: rule.openTimeTo,
            adsFromPartners: rule.adsFromPartners ?? false,
            cadence: cadence ?? null,
            updatedAt: deps.clock.now()
          })
          .onConflictDoUpdate({
            target: schema.breakRules.stationId,
            set: {
              mode: rule.mode,
              everyMinutes: rule.mode === "every_n_minutes" ? rule.everyMinutes : null,
              lengthMs: rule.lengthMs,
              spotMsPerHour: rule.spotMsPerHour,
              sameSpotPerHour: rule.sameSpotPerHour,
              fillOrder,
              openTimeTo: rule.openTimeTo,
              ...(rule.adsFromPartners !== undefined ? { adsFromPartners: rule.adsFromPartners } : {}),
              ...(cadence ? { cadence } : {}),
              updatedAt: deps.clock.now()
            }
          });
        await tx.delete(schema.blockedCategories).where(eq(schema.blockedCategories.stationId, stationId));
        const categories = [...new Set(rule.blockedCategories.map((c) => c.trim()).filter(Boolean))];
        if (categories.length) await tx.insert(schema.blockedCategories).values(categories.map((category) => ({ stationId, category })));
      });
      return service.breakRule(stationId);
    },

    async translators(stationId) {
      const [list, status] = await Promise.all([
        db.select().from(schema.translators).where(eq(schema.translators.stationId, stationId)).orderBy(asc(schema.translators.createdAt)),
        services.playout.statusFor([stationId])
      ]);
      const onAir = status.get(stationId)?.onAir ?? false;
      return list.map((t) => translatorView(t, onAir));
    },

    async addTranslator(stationId, input) {
      const [row] = await db.insert(schema.translators).values({ stationId, ...input }).returning();
      return translatorView(row, false);
    },

    async updateTranslator(stationId, translatorId, input) {
      const [row] = await db
        .update(schema.translators)
        .set(input)
        .where(and(eq(schema.translators.id, translatorId), eq(schema.translators.stationId, stationId)))
        .returning();
      if (!row) throw notFound("That relay");
      return translatorView(row, false);
    },

    async removeTranslator(stationId, translatorId) {
      const removed = await db
        .delete(schema.translators)
        .where(and(eq(schema.translators.id, translatorId), eq(schema.translators.stationId, stationId)))
        .returning({ id: schema.translators.id });
      if (!removed.length) throw notFound("That relay");
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
