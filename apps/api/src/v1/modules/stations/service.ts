import { randomBytes } from "node:crypto";
import { and, asc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { schema } from "@opencast/db";
import { formatChannelNumber, isSubchannel, isValidStationColour, parseChannelNumber, type Band } from "@opencast/domain";
import type { StationIdent } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import type { CurrentUser } from "../../http.js";
import { badRequest, notFound, refused } from "../../errors.js";

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
  liveSourceBelongs(stationId: string, sourceId: string): Promise<boolean>;
  isHost(userId: string, stationId: string, programId: string | null): Promise<boolean>;
  /** For sign-on checks. */
  identityReady(stationId: string): Promise<{ callSign: boolean; channel: boolean }>;
  markSignedOn(db: Executor, stationId: string): Promise<{ first: boolean }>;
  markSignedOff(db: Executor, stationId: string, permanently: boolean): Promise<void>;
  /** Stations that take orders, and studios. */
  makers(): Promise<Array<{ profile: StationProfile; turnaround: string | null; fromMicros: number | null }>>;
  /** For playout: every enabled relay, with its key. */
  relays(stationId: string): Promise<Array<{ id: string; rtmpUrl: string; streamKey: string; breakHandling: "air_spots" | "station_id_slate" }>>;
  /** Used by Network desk to set up claimable, listed and catalog stations. */
  createManaged(db: Executor, input: { kind: StationKind; name: string; callSign: string; colour?: string; marketId: string; band: Band; tenths: number; description?: string }): Promise<string>;

  create(user: CurrentUser, input: { kind: "station" | "studio"; name: string; description?: string; colour?: string; handle?: string }): Promise<StationSetupView>;
  setup(stationId: string): Promise<StationSetupView>;
  updateSetup(user: CurrentUser, stationId: string, input: SetupPatch): Promise<StationSetupView>;
  availableChannels(marketId: string, band: Band): Promise<Array<{ channel: string; state: "open" | "taken" | "held" }>>;
  chooseChannel(stationId: string, input: { marketId: string; band: Band; channel: string }): Promise<StationSetupView>;
  setBreakRule(stationId: string, rule: BreakRuleView): Promise<BreakRuleView>;
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
}>;

export interface TranslatorInput {
  service: "youtube" | "twitch" | "rtmp";
  name: string;
  rtmpUrl: string;
  streamKey: string;
  breakHandling: "air_spots" | "station_id_slate";
  prerecordedLabel: boolean;
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
}

export interface LiveSourceView {
  id: string;
  kind: "encoder" | "browser";
  name: string;
  server: string | null;
  streamKeyPreview: string | null;
  signal: "not_connected" | "receiving";
  createdAt: string;
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
const INGEST_SERVER = process.env.LIVE_INGEST_SERVER ?? "rtmps://ingest.useopencast.org/live";

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
      orders: { takesOrders: station.kind === "studio" || station.takesOrders, turnaround: station.orderTurnaround, fromMicros: station.orderFromMicros }
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
      status: !row.enabled || !row.streamKey ? "not_connected" : onAir ? "relaying" : "connected"
    };
  }

  const preview = (key: string | null) => (key ? `${key.slice(0, 8)}…` : null);
  function liveSourceView(row: typeof schema.liveSources.$inferSelect): LiveSourceView {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      server: row.kind === "encoder" ? INGEST_SERVER : null,
      streamKeyPreview: preview(row.streamKey),
      signal: "not_connected",
      createdAt: row.createdAt.toISOString()
    };
  }

  const newKey = (prefix: string) => `${prefix.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}-${randomBytes(12).toString("hex")}`;

  const service: StationsService = {
    async idents(ids) {
      return new Map((await build(await rows(ids))).map((p) => [p.id, p.ident]));
    },

    async kindOf(stationId) {
      const [row] = await db.select({ kind: S.kind }).from(S).where(eq(S.id, stationId));
      return row?.kind ?? null;
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
      // Numbers tune: "12.1", "12" or "88.3".
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
        blockedCategories: blocked.map((b) => b.category).sort()
      };
    },

    async liveSourceBelongs(stationId, sourceId) {
      const [row] = await db
        .select({ id: schema.liveSources.id })
        .from(schema.liveSources)
        .where(and(eq(schema.liveSources.id, sourceId), eq(schema.liveSources.stationId, stationId)));
      return Boolean(row);
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

    async markSignedOff(tx, stationId, permanently) {
      await tx
        .update(S)
        .set({ status: permanently ? "signed_off" : "off_air", signedOffAt: permanently ? deps.clock.now() : null, updatedAt: deps.clock.now() })
        .where(eq(S.id, stationId));
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
      return rows.filter((r) => r.streamKey).map((r) => ({ id: r.id, rtmpUrl: r.rtmpUrl, streamKey: r.streamKey, breakHandling: r.breakHandling }));
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
        for (let tenths = 881; tenths <= 1079; tenths += 2) {
          channels.push({ channel: formatChannelNumber({ band, tenths }), state: takenSet.has(tenths) ? "taken" : heldSet.has(tenths) ? "held" : "open" });
        }
      }
      return channels;
    },

    async chooseChannel(stationId, input) {
      const number = parseChannelNumber(input.band, input.channel);
      if (!number) throw badRequest(input.band === "tv" ? "TV channels run from 2.1 to 69.9." : "Radio runs from 88.1 to 107.9, in odd tenths.", { channel: "Out of range" });
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
      return list.map(liveSourceView);
    },

    async addLiveSource(stationId, input) {
      const [station] = await db.select({ callSign: S.callSign, name: S.name }).from(S).where(eq(S.id, stationId));
      const streamKey = input.kind === "encoder" ? newKey(`${station?.callSign ?? station?.name ?? "live"}-${input.name}`) : null;
      const [row] = await db.insert(schema.liveSources).values({ stationId, kind: input.kind, name: input.name, streamKey }).returning();
      return { source: liveSourceView(row), streamKey };
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
      return { source: liveSourceView(row), streamKey };
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
