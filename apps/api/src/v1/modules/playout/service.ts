import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { asLogCode, type BlockBand } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { CurrentUser } from "../../http.js";
import { forbidden, refused } from "../../errors.js";
import { publicUrl } from "../../lib/url.js";
import type { OffAirSpanView } from "../log/service.js";
import { clockTime } from "../../lib/time.js";
import { isContentId, objectKey } from "../../storage.js";
import { BAND_RENDITIONS, LADDER, REFERENCE, scaledLadder, type Band, type RenditionName } from "./engine/ladder.js";
import { renderMaster, renderMedia, renderSubtitles, SUBTITLES, WINDOW_MS, type ChannelRow } from "./engine/playlist.js";
import { captionSources } from "./engine/captions.js";
import { liveObjectPrefixes } from "./engine/assemble.js";
import { EMPTY_VTT, languageName } from "../../lib/captions.js";
import { logReadiness, readyKeys, summariseReadiness } from "./engine/readiness.js";
import { queuePreparation, refKey, syncPreparedVersions, versionedKey, wantRow } from "./engine/prepare.js";
import { isEveryBreak, partsOf } from "./engine/cadence.js";
import { GENERATED_SID_MS, generatedStationIdKey } from "./engine/stationId.js";
import { STATION_ID_MS } from "./engine/fill.js";

type CheckKey = "log_covers_24h" | "station_id_hourly" | "rights_confirmed" | "listings_complete" | "live_sources_connected" | "channel_chosen" | "call_sign_chosen" | "output" | "off_air_hours" | "items_prepared" | "held_by_opencast";

export interface SignOnCheck {
  key: CheckKey;
  label: string;
  passed: boolean;
  blocking: boolean;
  detail: string | null;
  watchUrl?: string | null;
  /** G14: on `items_prepared` only. */
  preparation?: { items: number; ready: number; failed: number; preparing: number; firstFailed: { itemId: string; title: string; airsAt: string; entryId: string } | null } | null;
}

export interface PlayoutStatusView {
  onAir: boolean;
  now: { title: string; code: "PGM" | "SPT" | "UND" | "BMP" | "SID" | "OPEN"; startedAt: string; itemId: string | null } | null;
  lastError: string | null;
  output: { livepeerEnabled: boolean; playbackUrl: string | null; bitrateKbps?: number | null };
  nextBreakAt: string | null;
  onAirSince?: string | null;
  next?: { title: string; detail: string | null; code: "PGM" | "SPT" | "UND" | "BMP" | "SID" | "OPEN"; startsAt: string; producer: string | null; colour: string | null; pictureUrl: string | null; block?: BlockBand | null } | null;
  /** A244: the programming block on air now. */
  block?: BlockBand | null;
  /** Planned off air time on now, or the next within 24 hours. */
  offAir?: (OffAirSpanView & { now: boolean }) | null;
  /** A242: the opener (`on`) or closer (`off`) is airing now. */
  signing?: "on" | "off" | null;
  /** Added 2026-09-29: whether what's on the log in the next 48 hours is prepared for air. */
  /** G13: counts items, not entries; `firstNotReady.entryId` is its log entry. G14: `failed` and `preparing`. */
  readiness?: {
    items: number;
    ready: number;
    failed?: number;
    preparing?: number;
    firstNotReady: { itemId: string; title: string; airsAt: string; status: "queued" | "preparing" | "failed" | "not_asked"; entryId?: string } | null;
  } | null;
}

export interface GeneratedStationIdView {
  code: "SID";
  durationMs: number;
  sound: "bed" | "silence";
  status: "preparing" | "ready" | "failed";
  look: { callSign: string | null; channel: string | null; name: string; city: string | null; colour: string | null };
  playbackUrl: string | null;
}

export interface AsRunView {
  id: string;
  code: "PGM" | "SPT" | "UND" | "BMP" | "SID" | "OPEN";
  title: string;
  startedAt: string;
  endedAt: string;
  reason: "planned" | "rotation" | "backup_rotation" | "station_id_fill" | "dead_air_fill" | "live" | "slate";
  itemId: string | null;
  airingId: string | null;
  /** A242: an opener or closer (`code` then says SID, for apps built before it). */
  identCode?: "OPN" | "CLS" | null;
  /** A243: a bumper's role as it aired, where it aired, and (up next) what it announced. */
  bumperRole?: "into_break" | "out_of_break" | "up_next" | "any" | null;
  position?: "open" | "close" | "between" | "boundary" | "open_time" | "sign_on" | null;
  announced?: { entryId: string | null; title: string } | null;
  /** A244: the programming block it aired in. */
  block?: { id: string; name: string } | null;
}

/** A program row of the as-run log, for watch data. */
export interface ProgramRow {
  id: string;
  stationId: string;
  startedAt: Date;
  endedAt: Date;
  logEntryId: string | null;
  programId: string | null;
  carried: boolean;
}

export interface PlayoutService {
  /** Whether each station is on air, and where to play it. */
  /** `standingBy`: a live block is on the stand-by slate, waiting for its signal (S13). */
  statusFor(stationIds: string[]): Promise<Map<string, { onAir: boolean; playbackUrl: string | null; standingBy: boolean }>>;
  /** A251: minutes of dead-air fill and slate per station in a span (time nobody scheduled, or something not ready). */
  fillMinutes(stationIds: string[], from: Date, to: Date): Promise<Map<string, number>>;
  /** A251: how a station's airtime was filled, minutes from the as-run log: programs, breaks (and what aired between), live, dead air (fill and slate). */
  airtimeMinutes(stationId: string, from: Date, to: Date): Promise<{ programs: number; breaks: number; live: number; deadAir: number }>;
  /** A251: a station's breaks as they aired in a window, touching ones joined. */
  breakSpans(stationId: string, from: Date, to: Date): Promise<Array<{ start: Date; end: Date }>>;
  /**
   * A251 Phase 5: breaks as they aired, ending in a window, every station: when, how long, where they
   * sat (`opening` a program's slot when no program aired just before it, `inside` one when the same
   * log entry's program aired either side, `between` two otherwise), what opened them and how many spots.
   */
  airedBreaks(from: Date, to: Date): Promise<Array<{ breakId: string; stationId: string; start: Date; end: Date; position: "opening" | "inside" | "between"; firstElement: "bumper" | "spot" | "sponsor" | "station_id" | "other"; spots: number }>>;
  /** A251 Phase 7: each station's airtime by kind (programs, breaks, live, planned off air, dead-air fill, slate), minutes from the as-run log. */
  airtimeByStation(stationIds: string[], from: Date, to: Date): Promise<Map<string, { programs: number; breaks: number; live: number; offAir: number; deadAirFill: number; slate: number }>>;
  /** A251 Phase 7: dead-air fills and slates as they ran, back-to-back rows joined. */
  fillRuns(stationIds: string[], from: Date, to: Date): Promise<Array<{ stationId: string; kind: "dead_air_fill" | "slate"; start: Date; end: Date }>>;
  /** A251 Phase 7: relay sessions in a span: stations relaying, hours, sessions that ended with an error (drops). */
  relayHealth(stationIds: string[], from: Date, to: Date): Promise<{ stations: number; hours: number; sessions: number; drops: Array<{ stationId: string; at: Date; error: string | null }> }>;
  /** A251 Phase 6: minutes spent preparing uploads in a span (each item's last preparation). */
  prepareMinutes(from: Date, to: Date): Promise<number>;
  /** A251 Phase 6: the placements (spot airings) that aired on these stations in a span. */
  spotsAired(stationIds: string[], from: Date, to: Date): Promise<string[]>;
  /** A251: why each of these as-run rows aired (planned, live, a fill…). */
  asRunReasons(ids: string[]): Promise<Map<string, string>>;
  checks(stationId: string): Promise<{ ready: boolean; checks: SignOnCheck[] }>;
  signOn(stationId: string): Promise<PlayoutStatusView>;
  signOff(stationId: string, permanently: boolean): Promise<PlayoutStatusView>;
  cueBreak(user: CurrentUser, stationId: string): Promise<void>;
  status(stationId: string): Promise<PlayoutStatusView>;
  asRun(stationId: string, from: Date, to: Date): Promise<AsRunView[]>;
  /** Catalog sponsors (added 2026-09-29): the catalog credits that aired in a window, every station (credits naming a series carry its program). */
  catalogCreditsAired(programIds: string[], from: Date, to: Date): Promise<Array<{ stationId: string; programId: string; startedAt: Date }>>;
  /**
   * Watch data (added 2026-09-29, follow-up Phase 1): the as-run log's program rows (PGM, outside
   * breaks, not slates or station ID fills) that ended in a window, every station, or the stations
   * given. With `logEntryIds`, every program row of those log entries, whenever they aired.
   */
  programRows(input: { endedFrom: Date; endedTo: Date; stationIds?: string[] } | { logEntryIds: string[] }): Promise<ProgramRow[]>;
  /** As-run rows for spot airings, for billing and results. */
  asRunForAirings(airingIds: string[]): Promise<Map<string, typeof schema.asRun.$inferSelect>>;
  /**
   * The channel's playlists (prepare once, then assemble): `master.m3u8` (also `index.m3u8`) and
   * one media playlist per rendition (`v720.m3u8`…), rendered from its assembled timeline. Null
   * when there's no such playlist (or nothing published yet). `maxAge` is the cache time. On the
   * TV band, `subs.m3u8` is the subtitle rendition (X2), and `empty.vtt` its empty segment.
   */
  playlist(stationId: string, file: string): Promise<{ body: string; maxAge: number; contentType?: string } | null>;
  /** Every station on air now, for the dead-air check. */
  onAirStations(): Promise<string[]>;
  /** Stations that aired anything in a window (from the as-run log). */
  stationsThatAired(from: Date, to: Date): Promise<string[]>;
  /** A planned sign-on ("Signs on Monday, 6:00 am"). */
  scheduleSignOn(stationId: string, at: Date): Promise<void>;
  /**
   * A124: signs on stations whose scheduled sign-on is due (a claimable station set up with a
   * sign-on time), through the same checks as signing on by hand. One that isn't ready isn't
   * tried again; the desk sees it still setting up.
   */
  runDueSignOns(): Promise<{ signedOn: number; notReady: number }>;
  nextSignOn(stationIds: string[]): Promise<Map<string, Date>>;
  /** Cancels a station's scheduled sign-ons (a creator stopped it before it signed on). */
  cancelSignOns(stationId: string): Promise<void>;
  /** L5: where an item aired, newest first, from the as-run log (any station). */
  airedItem(itemId: string, limit: number): Promise<Array<{ stationId: string; startedAt: Date; reason: AsRunView["reason"]; carriageAgreementId: string | null }>>;
  /** C5: when each item first aired anywhere, and where. */
  firstAired(itemIds: string[]): Promise<Map<string, { stationId: string; startedAt: Date }>>;
  /** Programming Phase 2: a station's airings of these items, newest first, as item ids (up to `limit`): where each program's walk is. */
  airedHistory(stationId: string, itemIds: string[], limit: number): Promise<string[]>;
  /** Programming Phase 2: when each of these items last aired on a station (left out: never). */
  lastAired(stationId: string, itemIds: string[]): Promise<Map<string, Date>>;
  /** G3: a live block ended early: playout hands back to the log now. */
  endLive(stationId: string, userId: string): Promise<void>;
  /** G2: when each station last signed on (while on air). */
  onAirSince(stationIds: string[]): Promise<Map<string, Date>>;
  /** The log or off air hours changed: playout reads them again now. */
  replan(stationId: string): Promise<void>;
  /** Where an item's preparation for air stands, for a band, and what it did to the picture (the library's item history). */
  preparation(ref: { contentId: string | null; location: string | null }, band: "tv" | "radio"): Promise<{ status: "ready" | "queued" | "preparing" | "failed" | "not_asked"; renditions: string[]; preparedAt: string | null; converted: Array<"from_hdr" | "deinterlaced"> }>;
  /**
   * Added 2026-09-29: the station's generated station ID, for the library: null once a station ID
   * of its own can air (it wins).
   */
  generatedStationId(stationId: string): Promise<GeneratedStationIdView | null>;
  /**
   * What a break keeps for the station ID: five seconds, or ten for a station airing its generated
   * one (it has none of its own, and the generated one is prepared; the slate's five until then).
   */
  stationIdMs(stationId: string): Promise<number>;
  /** How many times a carried program aired on a carrier in a window (carriage limits, statements). */
  carriedAirings(agreementIds: string[], from: Date, to: Date): Promise<Map<string, number>>;
  /**
   * Added 2026-09-29: previews play the prepared segments (the catalog's episodes, spots in review
   * and in the market, order deliveries): a short-cache playlist over one rendition, the lowest TV
   * one (v360), or a64 on the radio band. With `prepare`, a file that isn't prepared (or queued) is
   * queued now, soon after what airs within the hour; its preview is "preparing" until it's ready.
   * Keyed by content ID; files locked by a claim or gone have none.
   */
  previews(refs: PreviewRef[], options?: { prepare?: boolean }): Promise<Map<string, PreviewView>>;
  /** A preview's playlist (`/v1/previews/<content ID>/<rendition>.m3u8`), or null when there's none. */
  previewPlaylist(key: string, rendition: string): Promise<{ body: string; maxAge: number } | null>;
  /**
   * Deletes what was prepared from these content IDs (garbage collection, takedowns): every
   * rendition and caption track under `prepared/<key>/`, their `prepared_items`,
   * `prepared_renditions` and `prepared_captions` rows, and any caption track made from one of
   * them (a WebVTT's content ID) on other items. The as-run log keeps what aired (it never pointed
   * at these rows). Without `evenIfAiring`, a key a channel's playlist pointed at in the last two
   * hours is left for the storage sweep (players may still be fetching its segments).
   */
  dropPrepared(keys: string[], options: { evenIfAiring: boolean }): Promise<{ dropped: string[]; deferred: string[] }>;
  /**
   * Added 2026-09-30: deletes the live segments stored for a live source's blocks (TV ones copied
   * from Livepeer, radio ones packaged by the worker; `prepared/live-<source>-<session>/`), for a
   * takedown of what the source aired. Every session a channel row still points at goes at once,
   * airing or not (the pruning of channel rows after two days deletes them otherwise). Returns the
   * sessions deleted.
   */
  dropLiveCopies(liveSourceId: string): Promise<{ sessions: string[] }>;
  /** The storage sweep: what was prepared from files that are gone, left while it aired (or from before). */
  sweepPrepared(): Promise<{ dropped: number; deferred: number }>;

  // ---- Pay-as-you-go metering (added 2026-09-29, follow-up Phase 2) ----
  /** Translator sessions overlapping [from, to), each clipped to it; a running one counts to its last update. */
  /** `relayMode` (added 2026-09-30): what the session relayed, when it says (the relay service's sessions); null for a worker translator's. */
  relaySessions(from: Date, to: Date): Promise<Array<{ stationId: string; translatorId: string; startedAt: Date; endedAt: Date; relayMode?: "everything" | "live_only" | null }>>;
  /** What aired live (the as-run log's `live` rows) overlapping [from, to), clipped to it. */
  liveAired(from: Date, to: Date): Promise<Array<{ stationId: string; startedAt: Date; endedAt: Date }>>;
  /** The bytes stored for each content ID's prepared segments (every band's renditions, ready or not yet swept). */
  preparedBytes(contentIds: string[]): Promise<Map<string, number>>;
}

export interface PreviewRef {
  contentId: string | null | undefined;
  mediaKind: "video" | "audio";
  /** Radio previews play the 64k sound; TV previews the 360p picture. */
  band: Band;
  durationMs?: number | null;
}

export interface PreviewView {
  status: "ready" | "preparing" | "failed";
  url: string | null;
}

/** The rendition a preview plays: the lowest TV rendition, or the radio band's 64k. */
export const PREVIEW_RENDITION: Record<Band, RenditionName> = { tv: "v360", radio: "a64" };
/** A preview asked for is prepared after what airs within the hour, before the rest. */
const PREVIEW_NEEDED_IN_MS = 3_600_000;
/** How long after a channel last pointed at a prepared item its segments may still be fetched. */
const AIRED_GRACE_MS = 2 * 3_600_000;

const HOUR = 3_600_000;

/** "1 hr 30 min", "2 hr", "45 min". */
export function hoursAndMinutes(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} hr` : "", m || !h ? `${m} min` : ""].filter(Boolean).join(" ");
}

/**
 * The rest of the `items_prepared` detail after "N of M in the next 24 hours" (G14): what failed
 * (the file needs replacing) told apart from what's on its way.
 */
export function preparedTail(failed: number, preparing: number): string {
  const fallback = "anything not ready at air time airs station ID and bumpers";
  if (!failed && !preparing) return "";
  if (!failed) return `. The rest are being prepared; ${fallback}`;
  const broken = `${failed} couldn't be prepared (${failed === 1 ? "its file needs" : "their files need"} replacing)`;
  return preparing ? `. ${broken} and ${preparing} ${preparing === 1 ? "is" : "are"} being prepared; ${fallback}` : `. ${broken}; ${fallback}`;
}

export function createPlayoutService({ deps, services }: ModuleContext): PlayoutService {
  const { db } = deps;
  const P = schema.playoutState;
  const PI = schema.preparedItems;
  const PR = schema.preparedRenditions;
  const PC = schema.preparedCaptions;

  const ladder = Number(process.env.PREPARE_LADDER_SCALE) > 0 ? scaledLadder(Number(process.env.PREPARE_LADDER_SCALE)) : LADDER;
  const channelUrl = (stationId: string) => publicUrl(deps, `/hls/${stationId}/master.m3u8`);
  /** Segment lengths per prepared key and rendition (they never change once prepared). */
  const lengths = new Map<string, number[]>();
  /** Rendered playlists, for a second (a burst of viewers costs one render). */
  const rendered = new Map<string, { at: number; value: { body: string; maxAge: number } | null }>();
  const bandOf = async (stationId: string): Promise<Band> => (await services.stations.idents([stationId])).get(stationId)?.band ?? "tv";

  function segmentUrl(key: string, rendition: string, index: number) {
    const path = `${objectKey.prepared(key, rendition)}/seg_${String(index).padStart(5, "0")}.ts`;
    // The bucket's public domain (R2's custom domain); without one, the API passes them through.
    return deps.storage.objects.publicUrl?.(path) ?? publicUrl(deps, `/hls/${path}`);
  }

  function previewUrlOf(key: string, rendition: string) {
    return publicUrl(deps, `/v1/previews/${key}/${rendition}.m3u8`);
  }

  function captionUrl(key: string, rendition: string, index: number) {
    const path = `${objectKey.prepared(key, rendition)}/seg_${String(index).padStart(5, "0")}.vtt`;
    return deps.storage.objects.publicUrl?.(path) ?? publicUrl(deps, `/hls/${path}`);
  }

  /** The subtitle rendition's language: the one most of the station's programs are captioned in, else English. */
  async function captionLanguage(stationId: string): Promise<string> {
    return (await services.library.stationCaptionLanguage(stationId)) ?? "en";
  }

  async function renderPlaylist(stationId: string, file: string): Promise<{ body: string; maxAge: number; contentType?: string } | null> {
    const band = await bandOf(stationId);
    // The empty caption segment: the same bytes for every station, kept a long time.
    if (file === SUBTITLES.empty) return band === "tv" ? { body: EMPTY_VTT, maxAge: 86_400, contentType: "text/vtt" } : null;
    const now = deps.clock.now();
    const C = schema.channelItems;
    const [latest] = await db
      .select({ run: C.run, kind: C.kind, startsAt: C.startsAt })
      .from(C)
      .where(and(eq(C.stationId, stationId), lte(C.startsAt, now)))
      .orderBy(desc(C.seq), desc(C.startsAt))
      .limit(1);
    if (!latest) return null;
    if (file === "master.m3u8" || file === "index.m3u8") {
      const language = band === "tv" ? await captionLanguage(stationId) : null;
      return { body: renderMaster(band, ladder, language ? { language, name: languageName(language) } : null), maxAge: 30 };
    }
    const rendition = file.replace(/\.m3u8$/, "") as RenditionName;
    const subtitles = file === SUBTITLES.file && band === "tv";
    if (!subtitles && !BAND_RENDITIONS[band].includes(rendition)) return null;
    // After a planned sign-off the ended playlist stays as it was until the next run starts.
    const edge = latest.kind === "end" ? latest.startsAt : now;
    const rows = (await db
      .select()
      .from(C)
      .where(and(eq(C.stationId, stationId), eq(C.run, latest.run), lte(C.startsAt, now), gt(C.endsAt, new Date(edge.getTime() - WINDOW_MS - 60_000))))
      .orderBy(asc(C.seq), asc(C.startsAt))) as ChannelRow[];
    const [end] = latest.kind === "end" ? [] : await db.select().from(C).where(and(eq(C.stationId, stationId), eq(C.run, latest.run), eq(C.kind, "end"), lte(C.startsAt, now))).limit(1);
    if (end) rows.push(end as ChannelRow);
    if (subtitles) {
      const sources = await captionSources(db, (ids) => services.library.captionTrackIds(ids), rows as Array<ChannelRow & { assetId: string | null }>);
      const body = renderSubtitles({
        rows,
        now: now.getTime(),
        empty: SUBTITLES.empty,
        uri: (row, index) => {
          const source = sources.get(row.id);
          return source && index < source.segments ? captionUrl(source.key, source.rendition, index) : null;
        }
      });
      return body ? { body, maxAge: 1 } : null;
    }
    const keys = [...new Set(rows.map((r) => r.preparedKey).filter((k): k is string => Boolean(k) && !lengths.has(`${k}/${rendition}`)))];
    if (keys.length) {
      const found = await db
        .select({ key: schema.preparedRenditions.key, segmentMs: schema.preparedRenditions.segmentMs })
        .from(schema.preparedRenditions)
        .where(and(eq(schema.preparedRenditions.rendition, rendition), inArray(schema.preparedRenditions.key, keys)));
      for (const f of found) lengths.set(`${f.key}/${rendition}`, f.segmentMs);
    }
    const body = renderMedia({ rows, rendition, now: now.getTime(), lengths: (key) => lengths.get(`${key}/${rendition}`) ?? null, uri: (key, index) => segmentUrl(key, rendition, index) });
    return body ? { body, maxAge: 1 } : null;
  }

  const service: PlayoutService = {
    async airtimeMinutes(stationId, from, to) {
      const A = schema.asRun;
      const rows = await db
        .select({ code: A.code, reason: A.reason, breakId: A.breakId, seconds: sql<number>`coalesce(sum(extract(epoch from (${A.endedAt} - ${A.startedAt}))), 0)::float` })
        .from(A)
        .where(and(eq(A.stationId, stationId), gte(A.startedAt, from), lt(A.startedAt, to)))
        .groupBy(A.code, A.reason, A.breakId);
      const out = { programs: 0, breaks: 0, live: 0, deadAir: 0 };
      for (const r of rows) {
        const m = r.seconds / 60;
        if (r.reason === "dead_air_fill" || r.reason === "slate") out.deadAir += m;
        else if (r.reason === "live") out.live += m;
        else if (r.code === "PGM" && !r.breakId) out.programs += m;
        else out.breaks += m;
      }
      return { programs: Math.round(out.programs), breaks: Math.round(out.breaks), live: Math.round(out.live), deadAir: Math.round(out.deadAir) };
    },

    async breakSpans(stationId, from, to) {
      const A = schema.asRun;
      const rows = await db
        .select({ start: A.startedAt, end: A.endedAt })
        .from(A)
        .where(and(eq(A.stationId, stationId), sql`${A.breakId} is not null`, lt(A.startedAt, to), gt(A.endedAt, from)))
        .orderBy(asc(A.startedAt));
      const out: Array<{ start: Date; end: Date }> = [];
      for (const r of rows) {
        const last = out[out.length - 1];
        if (last && r.start.getTime() - last.end.getTime() <= 1000) last.end = new Date(Math.max(last.end.getTime(), r.end.getTime()));
        else out.push({ start: r.start, end: r.end });
      }
      return out;
    },

    async airedBreaks(from, to) {
      const A = schema.asRun;
      // Every row of the breaks that ended in the window (one break may have aired in several rows).
      const rows = await db
        .select({ breakId: A.breakId, stationId: A.stationId, code: A.code, start: A.startedAt, end: A.endedAt })
        .from(A)
        .where(and(sql`${A.breakId} is not null`, gte(A.endedAt, new Date(from.getTime() - 3 * 3_600_000)), lt(A.startedAt, to)))
        .orderBy(asc(A.startedAt));
      type Aired = { breakId: string; stationId: string; start: Date; end: Date; first: string; spots: number };
      const byBreak = new Map<string, Aired>();
      for (const r of rows) {
        // The same break airing again later (a replay) is another airing: keyed by its start too.
        const open = byBreak.get(r.breakId!);
        if (open && r.start.getTime() - open.end.getTime() <= 5_000) {
          open.end = new Date(Math.max(open.end.getTime(), r.end.getTime()));
          if (r.code === "SPT") open.spots++;
          continue;
        }
        if (open) byBreak.set(`${r.breakId}@${open.start.getTime()}`, open);
        byBreak.set(r.breakId!, { breakId: r.breakId!, stationId: r.stationId, start: r.start, end: r.end, first: r.code, spots: r.code === "SPT" ? 1 : 0 });
      }
      const aired = [...byBreak.values()].filter((b) => b.end >= from && b.end < to);
      const out: Awaited<ReturnType<PlayoutService["airedBreaks"]>> = [];
      for (const b of aired) {
        // The programs either side, within a few seconds.
        const [before] = await db
          .select({ entry: A.logEntryId })
          .from(A)
          .where(and(eq(A.stationId, b.stationId), eq(A.code, "PGM"), sql`${A.breakId} is null`, lte(A.endedAt, new Date(b.start.getTime() + 5_000)), gte(A.endedAt, new Date(b.start.getTime() - 60_000))))
          .orderBy(desc(A.endedAt))
          .limit(1);
        const [after] = await db
          .select({ entry: A.logEntryId })
          .from(A)
          .where(and(eq(A.stationId, b.stationId), eq(A.code, "PGM"), sql`${A.breakId} is null`, gte(A.startedAt, new Date(b.end.getTime() - 5_000)), lte(A.startedAt, new Date(b.end.getTime() + 60_000))))
          .orderBy(asc(A.startedAt))
          .limit(1);
        const position = !before ? "opening" : after && before.entry && before.entry === after.entry ? "inside" : "between";
        const firstElement = b.first === "BMP" ? "bumper" : b.first === "SPT" ? "spot" : b.first === "UND" ? "sponsor" : b.first === "SID" ? "station_id" : "other";
        out.push({ breakId: b.breakId, stationId: b.stationId, start: b.start, end: b.end, position, firstElement, spots: b.spots });
      }
      return out;
    },

    async airtimeByStation(stationIds, from, to) {
      const out = new Map<string, { programs: number; breaks: number; live: number; offAir: number; deadAirFill: number; slate: number }>();
      if (!stationIds.length) return out;
      const A = schema.asRun;
      const rows = await db
        .select({ stationId: A.stationId, code: A.code, reason: A.reason, breakId: A.breakId, seconds: sql<number>`coalesce(sum(extract(epoch from (${A.endedAt} - ${A.startedAt}))), 0)::float` })
        .from(A)
        .where(and(inArray(A.stationId, stationIds), gte(A.startedAt, from), lt(A.startedAt, to)))
        .groupBy(A.stationId, A.code, A.reason, A.breakId);
      for (const r of rows) {
        const o = out.get(r.stationId) ?? { programs: 0, breaks: 0, live: 0, offAir: 0, deadAirFill: 0, slate: 0 };
        const m = r.seconds / 60;
        if (r.reason === "dead_air_fill") o.deadAirFill += m;
        else if (r.reason === "slate") o.slate += m;
        else if (r.code === "OFF") o.offAir += m;
        else if (r.reason === "live") o.live += m;
        else if (r.code === "PGM" && !r.breakId) o.programs += m;
        else o.breaks += m;
        out.set(r.stationId, o);
      }
      for (const [k, o] of out) out.set(k, { programs: Math.round(o.programs), breaks: Math.round(o.breaks), live: Math.round(o.live), offAir: Math.round(o.offAir), deadAirFill: Math.round(o.deadAirFill), slate: Math.round(o.slate) });
      return out;
    },

    async fillRuns(stationIds, from, to) {
      if (!stationIds.length) return [];
      const A = schema.asRun;
      const rows = await db
        .select({ stationId: A.stationId, reason: A.reason, start: A.startedAt, end: A.endedAt })
        .from(A)
        .where(and(inArray(A.stationId, stationIds), inArray(A.reason, ["dead_air_fill", "slate"]), gte(A.startedAt, from), lt(A.startedAt, to)))
        .orderBy(asc(A.stationId), asc(A.startedAt));
      const out: Array<{ stationId: string; kind: "dead_air_fill" | "slate"; start: Date; end: Date }> = [];
      for (const r of rows) {
        const last = out[out.length - 1];
        if (last && last.stationId === r.stationId && last.kind === r.reason && r.start.getTime() - last.end.getTime() <= 5_000) last.end = r.end;
        else out.push({ stationId: r.stationId, kind: r.reason as "dead_air_fill" | "slate", start: r.start, end: r.end });
      }
      return out;
    },

    async relayHealth(stationIds, from, to) {
      if (!stationIds.length) return { stations: 0, hours: 0, sessions: 0, drops: [] };
      const T = schema.translatorSessions;
      const rows = await db
        .select({ stationId: T.stationId, start: T.startedAt, end: T.endedAt, error: T.lastError })
        .from(T)
        .where(and(inArray(T.stationId, stationIds), lt(T.startedAt, to), sql`coalesce(${T.endedAt}, now()) > ${from}`));
      const now = deps.clock.now();
      let ms = 0;
      for (const r of rows) ms += Math.max(0, Math.min((r.end ?? now).getTime(), to.getTime()) - Math.max(r.start.getTime(), from.getTime()));
      const drops = rows.filter((r) => r.end && r.error && r.end >= from && r.end < to).map((r) => ({ stationId: r.stationId, at: r.end!, error: r.error }));
      return { stations: new Set(rows.map((r) => r.stationId)).size, hours: Math.round((ms / 3_600_000) * 10) / 10, sessions: rows.length, drops };
    },

    async prepareMinutes(from, to) {
      const [r] = await db
        .select({ ms: sql<number>`coalesce(sum(${schema.preparedItems.prepMs}), 0)::float` })
        .from(schema.preparedItems)
        .where(and(gte(schema.preparedItems.preparedAt, from), lt(schema.preparedItems.preparedAt, to)));
      return Math.round((r?.ms ?? 0) / 60_000);
    },

    async spotsAired(stationIds, from, to) {
      if (!stationIds.length) return [];
      const A = schema.asRun;
      const rows = await db
        .selectDistinct({ airingId: A.airingId })
        .from(A)
        .where(and(inArray(A.stationId, stationIds), sql`${A.airingId} is not null`, gte(A.startedAt, from), lt(A.startedAt, to)));
      return rows.map((r) => r.airingId!);
    },

    async asRunReasons(ids) {
      if (!ids.length) return new Map();
      const rows = await db.select({ id: schema.asRun.id, reason: schema.asRun.reason }).from(schema.asRun).where(inArray(schema.asRun.id, ids));
      return new Map(rows.map((r) => [r.id, r.reason]));
    },

    async fillMinutes(stationIds, from, to) {
      if (!stationIds.length) return new Map();
      const A = schema.asRun;
      const rows = await db
        .select({ stationId: A.stationId, minutes: sql<number>`coalesce(sum(extract(epoch from (${A.endedAt} - ${A.startedAt}))) / 60, 0)::float` })
        .from(A)
        .where(and(inArray(A.stationId, stationIds), inArray(A.reason, ["dead_air_fill", "slate"]), gte(A.startedAt, from), lt(A.startedAt, to)))
        .groupBy(A.stationId);
      return new Map(rows.map((r) => [r.stationId, Math.round(r.minutes)]));
    },

    async statusFor(stationIds) {
      if (!stationIds.length) return new Map();
      const states = await db.select().from(P).where(inArray(P.stationId, stationIds));
      const byId = new Map(states.map((s) => [s.stationId, s]));
      return new Map(
        stationIds.map((id) => {
          const onAir = byId.get(id)?.onAir ?? false;
          const standingBy = onAir && (byId.get(id)?.standingBy ?? false);
          // The channel's own playlists, assembled from prepared segments (and Livepeer's during live blocks).
          return [id, { onAir, playbackUrl: onAir ? channelUrl(id) : null, standingBy }];
        })
      );
    },

    async checks(stationId) {
      const now = deps.clock.now();
      const day = new Date(now.getTime() + 24 * HOUR);
      const [identity, gaps, breaks, readiness, entries, prepared, offAir, tz, [aired]] = await Promise.all([
        services.stations.identityReady(stationId),
        services.log.gaps(stationId, now, day),
        services.log.breaks(stationId, now, day),
        services.library.readiness(stationId),
        services.log.entries(stationId, now, day),
        bandOf(stationId).then((band) => logReadiness({ deps, services }, stationId, band, now, day)),
        services.log.offAirSpans(stationId, now, day),
        services.stations.timezoneOf(stationId),
        db.select({ id: schema.channelItems.id }).from(schema.channelItems).where(eq(schema.channelItems.stationId, stationId)).limit(1)
      ]);
      const rule = await services.stations.breakRule(stationId);

      // A station ID at least once an hour. Breaks must come hourly (blocking, as before), and the
      // break rule's cadence (added 2026-09-29) must air one in them at least hourly: if the breaks
      // come often enough but the cadence leaves more than an hour, it's a warning, not a block.
      // Planned off air time doesn't count against it: the station signs off and back on with its ID.
      const sidEntries = entries.filter((e) => e.code === "SID").map((e) => e.startsAt.getTime());
      // A247, after every N programs: between the others, the time a program leaves of its slot airs
      // as open time, with the station ID (where there's room for it, and no break there).
      if (rule.everyPrograms) {
        const items = await services.library.itemsByIds(entries.filter((e) => e.kind === "program" && e.assetId).map((e) => e.assetId!));
        const breakAt = new Set(breaks.map((b) => Date.parse(b.startsAt)));
        for (const e of entries) {
          const ms = e.kind === "program" && e.assetId ? items.get(e.assetId)?.durationMs : undefined;
          if (!ms) continue;
          const end = e.startsAt.getTime() + ms;
          if (e.endsAt.getTime() - end >= STATION_ID_MS && !breakAt.has(end)) sidEntries.push(end);
        }
      }
      const offAirMarks = offAir.flatMap((o) => [Math.max(now.getTime(), Date.parse(o.startsAt)), Math.min(day.getTime(), Date.parse(o.endsAt))]);
      const inOffAir = (a: number, b: number) => offAir.some((o) => Date.parse(o.startsAt) <= a && Date.parse(o.endsAt) >= b);
      const longestWithout = (breakTimes: number[]) => {
        const marks = [...breakTimes, ...sidEntries, ...offAirMarks].sort((a, b) => a - b);
        let longest = 0;
        let cursor = now.getTime();
        for (const mark of marks) {
          if (!inOffAir(cursor, mark)) longest = Math.max(longest, mark - cursor);
          cursor = mark;
        }
        if (!inOffAir(cursor, day.getTime())) longest = Math.max(longest, day.getTime() - cursor);
        return { longest, marks: marks.length };
      };
      // Whether breaks come hourly is the rule's layout: a break the cadence leaves nothing in isn't on the log.
      const laidOut = isEveryBreak(rule.cadence) ? breaks : await services.log.breaks(stationId, now, day, { everyPart: true });
      const everyBreak = longestWithout(laidOut.map((b) => Date.parse(b.startsAt)));
      const withCadence = longestWithout(breaks.filter((b) => partsOf(b).stationId).map((b) => Date.parse(b.startsAt)));
      const idsPerDay = withCadence.marks;
      const breaksHourly = rule.mode !== "none" || sidEntries.length > 0 ? everyBreak.longest <= HOUR : false;
      const hourly = breaksHourly && withCadence.longest <= HOUR;
      // The breaks would do, but how often the station ID airs in them leaves an hour or more without one.
      const cadenceGap = breaksHourly && !hourly;

      const liveEntries = entries.filter((e) => e.kind === "live");
      // By item, not by entry (G13); failed told apart from on its way (G14).
      const prep = summariseReadiness(prepared);
      const hold = await services.stations.holdOf(stationId);
      const checks: SignOnCheck[] = [
        // Added 2026-10-07: taken off the air from the desk; only Opencast lifts it.
        ...(hold ? [{ key: "held_by_opencast" as const, label: "Opencast took this station off the air", passed: false, blocking: true, detail: hold.reason }] : []),
        { key: "call_sign_chosen", label: "Call sign chosen", passed: identity.callSign, blocking: true, detail: null },
        { key: "channel_chosen", label: "Channel chosen", passed: identity.channel, blocking: true, detail: null },
        {
          key: "log_covers_24h",
          label: "The log covers the next 24 hours",
          passed: gaps.length === 0,
          blocking: true,
          detail: gaps.length ? `${gaps.length} ${gaps.length === 1 ? "gap" : "gaps"}, the first at ${gaps[0].startsAt}` : null
        },
        {
          key: "station_id_hourly",
          label: "A station ID at least once an hour",
          passed: hourly,
          blocking: !cadenceGap,
          detail: cadenceGap ? `Up to ${hoursAndMinutes(withCadence.longest)} without one, from how often it airs in breaks. ${idsPerDay} times a day` : `${idsPerDay} times a day`
        },
        {
          key: "rights_confirmed",
          label: "Rights confirmed",
          passed: readiness.rightsConfirmed === readiness.items,
          blocking: false,
          detail: `${readiness.rightsConfirmed} of ${readiness.items} items`
        },
        {
          key: "listings_complete",
          label: "Listings complete",
          passed: readiness.programsNeedingDescription === 0,
          blocking: false,
          detail: readiness.programsNeedingDescription ? `${readiness.programsNeedingDescription} need a description` : null
        },
        {
          key: "live_sources_connected",
          label: "Live sources connected",
          passed: liveEntries.length === 0,
          blocking: false,
          detail: liveEntries.length ? "A live block with no signal airs a slate" : null
        },
        {
          key: "output",
          label: "Output ready",
          // Prepare once, then assemble: the channel is its own playlists; nothing to set up.
          passed: true,
          blocking: false,
          detail: "Assembled from prepared items",
          // G6: where the channel plays, once it has aired (null before).
          watchUrl: aired ? channelUrl(stationId) : null
        },
        {
          key: "items_prepared",
          label: "Items prepared for air",
          passed: prep.ready === prep.items,
          blocking: false,
          detail: prep.items ? `${prep.ready} of ${prep.items} in the next 24 hours${preparedTail(prep.failed, prep.preparing)}` : null,
          preparation: {
            items: prep.items,
            ready: prep.ready,
            failed: prep.failed,
            preparing: prep.preparing,
            firstFailed: prep.firstFailed ? { itemId: prep.firstFailed.itemId, title: prep.firstFailed.title, airsAt: prep.firstFailed.airsAt.toISOString(), entryId: prep.firstFailed.entryId } : null
          }
        }
      ];
      // Planned off air time isn't a gap; say so, so nobody wonders.
      const stretches = [...new Map(offAir.map((o) => [o.backAt, o])).values()];
      if (stretches.length) {
        const first = offAir.find((o) => o.backAt === stretches[0].backAt)!;
        checks.push({
          key: "off_air_hours",
          label: "Off air hours planned",
          passed: true,
          blocking: false,
          detail: `Off air from ${clockTime(new Date(first.startsAt), tz)}, back at ${clockTime(new Date(first.backAt), tz)}. Not dead air: no warnings, nothing fills it`
        });
      }
      return { ready: checks.every((c) => c.passed || !c.blocking), checks };
    },

    async signOn(stationId) {
      const hold = await services.stations.holdOf(stationId);
      if (hold) throw refused("held_by_opencast", `Opencast took this station off the air: ${hold.reason.replace(/[.!?]?$/, ".")} It can sign on again once Opencast lifts that.`);
      const { ready, checks } = await service.checks(stationId);
      if (!ready) {
        const failing = checks.filter((c) => c.blocking && !c.passed).map((c) => c.label.toLowerCase());
        throw refused("not_ready", `Not ready to sign on: ${failing.join(", ")}.`);
      }
      const { first } = await db.transaction(async (tx) => {
        const result = await services.stations.markSignedOn(tx, stationId);
        await tx
          .insert(P)
          .values({ stationId, onAir: true, updatedAt: deps.clock.now() })
          .onConflictDoUpdate({ target: P.stationId, set: { onAir: true, lastError: null, updatedAt: deps.clock.now() } });
        await tx.insert(schema.commands).values({ stationId, action: "sign_on", createdAt: deps.clock.now() });
        return result;
      });
      deps.bus.emit("station.signed_on", { stationId, first });
      return service.status(stationId);
    },

    async signOff(stationId, permanently) {
      await db.transaction(async (tx) => {
        await services.stations.markSignedOff(tx, stationId, permanently);
        await tx
          .insert(P)
          .values({ stationId, onAir: false, updatedAt: deps.clock.now() })
          .onConflictDoUpdate({ target: P.stationId, set: { onAir: false, updatedAt: deps.clock.now() } });
        await tx.insert(schema.commands).values({ stationId, action: "sign_off" });
      });
      if (permanently) {
        // The call sign stays reserved a year so a returning station can reclaim it; the channel frees after 90 days.
        await services.waitlist.holdAfterSignOff(stationId);
      }
      deps.bus.emit("station.signed_off", { stationId, permanently });
      return service.status(stationId);
    },

    async cueBreak(user, stationId) {
      const role = await services.accounts.requireStation(user, stationId, ["owner", "operator", "host"]);
      const now = deps.clock.now();
      const current = (await services.log.entries(stationId, now, new Date(now.getTime() + 1000))).find((e) => e.startsAt <= now && e.endsAt > now);
      if (!current || current.kind !== "live") throw refused("not_live", "Breaks are cued during live blocks.");
      if (role === "host" && !(await services.stations.isHost(user.id, stationId, current.programId))) {
        throw forbidden("Hosts can cue breaks on their own blocks only.");
      }
      await db.insert(schema.commands).values({ stationId, action: "cue_break", issuedBy: user.id });
    },

    async status(stationId) {
      const [state] = await db.select().from(P).where(eq(P.stationId, stationId));
      const now = deps.clock.now();
      const [current] = (await services.log.entries(stationId, now, new Date(now.getTime() + 1000))).filter((e) => e.startsAt <= now && e.endsAt > now);
      const titles = current ? (await services.log.airingsByIds([current.id])).get(current.id) : undefined;
      const [nextBreak] = (await services.log.breaks(stationId, now, new Date(now.getTime() + 6 * HOUR))).filter((b) => Date.parse(b.startsAt) > now.getTime());
      const onAir = state?.onAir ?? false;
      // G2: since when, and what's next for the preview monitor.
      const C = schema.channelItems;
      const [since, next, offAir, prepared, [airing]] = await Promise.all([
        onAir ? service.onAirSince([stationId]) : Promise.resolve(new Map<string, Date>()),
        services.log.nextEntry(stationId, now),
        services.log.offAirSpans(stationId, now, new Date(now.getTime() + 24 * HOUR)),
        bandOf(stationId).then((band) => logReadiness({ deps, services }, stationId, band, now, new Date(now.getTime() + 48 * HOUR))),
        // A242: the opener or closer on the channel now ("Signing on", "Signing off"). A244: a block's
        // intro or outro (`boundary`) isn't a sign-on or sign-off.
        onAir
          ? db
              .select({ code: C.code })
              .from(C)
              .where(and(eq(C.stationId, stationId), lte(C.startsAt, now), gt(C.endsAt, now), inArray(C.code, ["OPN", "CLS"]), or(isNull(C.position), ne(C.position, "boundary"))))
              .limit(1)
          : Promise.resolve([] as Array<{ code: string }>)
      ]);
      // A244: the programming block on now, and the one the next program enters.
      const blocks = await services.log.blockStatus(stationId, now, next?.entry.id ?? null);
      const summary = summariseReadiness(prepared);
      const notReady = summary.firstNotReady;
      const plannedOff = offAir[0] ? { ...offAir[0], now: Date.parse(offAir[0].startsAt) <= now.getTime() } : null;
      return {
        readiness: {
          items: summary.items,
          ready: summary.ready,
          failed: summary.failed,
          preparing: summary.preparing,
          firstNotReady: notReady
            ? { itemId: notReady.itemId, title: notReady.title, airsAt: notReady.airsAt.toISOString(), status: (notReady.status as "queued" | "preparing" | "failed" | null) ?? "not_asked", entryId: notReady.entryId }
            : null
        },
        offAir: plannedOff,
        signing: airing?.code === "OPN" ? "on" : airing?.code === "CLS" ? "off" : null,
        onAirSince: since.get(stationId)?.toISOString() ?? null,
        next: next
          ? {
              title: next.entry.title,
              detail: next.description,
              code: next.entry.code,
              startsAt: next.entry.startsAt,
              producer: next.producer,
              colour: next.colour,
              pictureUrl: null,
              ...(blocks.next ? { block: blocks.next } : {})
            }
          : null,
        ...(blocks.now ? { block: blocks.now } : {}),
        onAir,
        now:
          state?.onAir && current
            ? { title: titles?.title ?? "On air", code: asLogCode(current.code), startedAt: current.startsAt.toISOString(), itemId: current.assetId }
            : null,
        lastError: state?.lastError ?? null,
        // The channel's playlists are assembled; Livepeer only transcodes live blocks' sources.
        output: { livepeerEnabled: false, playbackUrl: onAir ? channelUrl(stationId) : null, bitrateKbps: null },
        nextBreakAt: nextBreak?.startsAt ?? null
      };
    },

    async asRun(stationId, from, to) {
      const rows = await db
        .select()
        .from(schema.asRun)
        .where(and(eq(schema.asRun.stationId, stationId), gte(schema.asRun.startedAt, from), lt(schema.asRun.startedAt, to)))
        .orderBy(asc(schema.asRun.startedAt));
      const [titles, blocks] = await Promise.all([
        services.library.titles({
          itemIds: rows.map((r) => r.assetId).filter((v): v is string => Boolean(v)),
          programIds: rows.map((r) => r.programId).filter((v): v is string => Boolean(v))
        }),
        services.library.blocks.refs(rows.map((r) => r.programBlockId).filter((v): v is string => Boolean(v)))
      ]);
      return rows.map((r) => {
        // A242: the as-run log records openers and closers as OPN and CLS; `code` says SID for apps built before.
        const ident = r.code === "OPN" || r.code === "CLS" ? r.code : null;
        // A244: a block's intro or outro (between programs) is the block's; its automatic card has no item.
        const block = r.programBlockId ? blocks.get(r.programBlockId) : undefined;
        const blockPart = block && r.position === "boundary" ? (ident === "OPN" ? `${block.name} intro` : `${block.name} outro`) : null;
        const automatic = blockPart ?? (ident === "OPN" ? "Automatic opener" : ident === "CLS" ? "Automatic closer" : null);
        return {
          id: r.id,
          code: ident ? ("SID" as const) : (r.code as Exclude<typeof r.code, "OPN" | "CLS" | "OFF">),
          title: (r.assetId && titles.items.get(r.assetId)) || (r.programId && r.code !== "UND" && titles.programs.get(r.programId)) || automatic || (r.code === "SID" ? "Station ID" : r.reason === "live" ? "Live" : "Slate"),
          startedAt: r.startedAt.toISOString(),
          endedAt: r.endedAt.toISOString(),
          reason: r.reason,
          itemId: r.assetId,
          airingId: r.airingId,
          identCode: ident,
          bumperRole: (r.bumperRole as AsRunView["bumperRole"]) ?? null,
          position: r.position ?? null,
          announced: r.announcedTitle ? { entryId: r.announcedEntryId, title: r.announcedTitle } : null,
          block: block ? { id: block.id, name: block.name } : null
        };
      });
    },

    async catalogCreditsAired(programIds, from, to) {
      if (!programIds.length) return [];
      const A = schema.asRun;
      const rows = await db
        .select({ stationId: A.stationId, programId: A.programId, startedAt: A.startedAt })
        .from(A)
        .where(and(eq(A.code, "UND"), inArray(A.programId, programIds), gte(A.startedAt, from), lt(A.startedAt, to)));
      return rows.flatMap((r) => (r.programId ? [{ stationId: r.stationId, programId: r.programId, startedAt: r.startedAt }] : []));
    },

    async programRows(input) {
      const A = schema.asRun;
      const where =
        "logEntryIds" in input
          ? input.logEntryIds.length
            ? inArray(A.logEntryId, input.logEntryIds)
            : undefined
          : and(gte(A.endedAt, input.endedFrom), lt(A.endedAt, input.endedTo), input.stationIds ? (input.stationIds.length ? inArray(A.stationId, input.stationIds) : sql`false`) : undefined);
      if (!where) return [];
      const rows = await db
        .select({ id: A.id, stationId: A.stationId, startedAt: A.startedAt, endedAt: A.endedAt, logEntryId: A.logEntryId, programId: A.programId, agreementId: A.carriageAgreementId })
        .from(A)
        .where(and(where, eq(A.code, "PGM"), isNull(A.breakId), inArray(A.reason, ["planned", "rotation", "backup_rotation", "dead_air_fill", "live"])))
        .orderBy(asc(A.startedAt));
      return rows.map(({ agreementId, ...r }) => ({ ...r, carried: agreementId !== null }));
    },

    async asRunForAirings(airingIds) {
      if (!airingIds.length) return new Map();
      const rows = await db.select().from(schema.asRun).where(inArray(schema.asRun.airingId, airingIds));
      return new Map(rows.map((r) => [r.airingId!, r]));
    },

    async playlist(stationId, file) {
      const id = `${stationId}/${file}`;
      const hit = rendered.get(id);
      const at = deps.clock.now().getTime();
      if (hit && Math.abs(at - hit.at) < 1_000) return hit.value;
      const value = await renderPlaylist(stationId, file);
      rendered.set(id, { at, value });
      if (rendered.size > 5_000) rendered.clear();
      return value;
    },

    async stationsThatAired(from, to) {
      const rows = await db
        .selectDistinct({ stationId: schema.asRun.stationId })
        .from(schema.asRun)
        .where(and(gte(schema.asRun.startedAt, from), lt(schema.asRun.startedAt, to)));
      return rows.map((r) => r.stationId);
    },

    async onAirStations() {
      const rows = await db.select({ stationId: P.stationId }).from(P).where(eq(P.onAir, true));
      return rows.map((r) => r.stationId);
    },

    async relaySessions(from, to) {
      const TS = schema.translatorSessions;
      const rows = await db
        .select()
        .from(TS)
        .where(and(lt(TS.startedAt, to), sql`coalesce(${TS.endedAt}, ${TS.updatedAt}) > ${from}`));
      return rows.flatMap((r) => {
        const startedAt = new Date(Math.max(r.startedAt.getTime(), from.getTime()));
        const endedAt = new Date(Math.min((r.endedAt ?? r.updatedAt).getTime(), to.getTime()));
        return endedAt > startedAt ? [{ stationId: r.stationId, translatorId: r.translatorId, startedAt, endedAt, relayMode: r.relayMode }] : [];
      });
    },

    async liveAired(from, to) {
      const A = schema.asRun;
      const rows = await db
        .select({ stationId: A.stationId, startedAt: A.startedAt, endedAt: A.endedAt })
        .from(A)
        .where(and(eq(A.reason, "live"), lt(A.startedAt, to), gt(A.endedAt, from)));
      return rows.flatMap((r) => {
        const startedAt = new Date(Math.max(r.startedAt.getTime(), from.getTime()));
        const endedAt = new Date(Math.min(r.endedAt.getTime(), to.getTime()));
        return endedAt > startedAt ? [{ stationId: r.stationId, startedAt, endedAt }] : [];
      });
    },

    async preparedBytes(contentIds) {
      const out = new Map<string, number>();
      if (!contentIds.length) return out;
      const PI = schema.preparedItems;
      const PR = schema.preparedRenditions;
      // Each rendition's bytes (written as it's prepared); the item's own figure when there are none.
      const rows = await db
        .select({ contentId: PI.contentId, item: PI.bytes, renditions: sql<string>`coalesce((select sum(${PR.bytes}) from ${PR} where ${PR.key} = ${PI.key}), 0)` })
        .from(PI)
        .where(inArray(PI.contentId, contentIds));
      for (const r of rows) {
        const bytes = Math.max(Number(r.renditions), r.item ?? 0);
        if (r.contentId && bytes > 0) out.set(r.contentId, (out.get(r.contentId) ?? 0) + bytes);
      }
      return out;
    },

    async scheduleSignOn(stationId, at) {
      await db.insert(schema.schedules).values({ stationId, startAt: at, enabled: true });
    },

    async runDueSignOns() {
      const now = deps.clock.now();
      const due = await db
        .select()
        .from(schema.schedules)
        .where(and(eq(schema.schedules.enabled, true), isNull(schema.schedules.startedAt), lte(schema.schedules.startAt, now), gte(schema.schedules.startAt, new Date(now.getTime() - 7 * 86_400_000))))
        .orderBy(asc(schema.schedules.startAt));
      let signedOn = 0;
      let notReady = 0;
      for (const schedule of due) {
        // Taken first, so two workers never sign the same station on twice.
        const [mine] = await db
          .update(schema.schedules)
          .set({ startedAt: now })
          .where(and(eq(schema.schedules.id, schedule.id), isNull(schema.schedules.startedAt)))
          .returning();
        if (!mine) continue;
        const [state] = await db.select().from(P).where(eq(P.stationId, schedule.stationId));
        if (state?.onAir) continue;
        try {
          await service.signOn(schedule.stationId);
          signedOn++;
        } catch (error) {
          notReady++;
          await db.update(schema.schedules).set({ enabled: false, endedAt: now }).where(eq(schema.schedules.id, schedule.id));
          console.warn(`[playout] scheduled sign-on for ${schedule.stationId} didn't happen: ${(error as Error).message}`);
        }
      }
      return { signedOn, notReady };
    },

    async nextSignOn(stationIds) {
      if (!stationIds.length) return new Map();
      const rows = await db
        .select()
        .from(schema.schedules)
        .where(and(inArray(schema.schedules.stationId, stationIds), eq(schema.schedules.enabled, true), gte(schema.schedules.startAt, deps.clock.now())))
        .orderBy(asc(schema.schedules.startAt));
      const result = new Map<string, Date>();
      for (const r of rows) if (!result.has(r.stationId)) result.set(r.stationId, r.startAt);
      return result;
    },

    async cancelSignOns(stationId) {
      await db
        .update(schema.schedules)
        .set({ enabled: false })
        .where(and(eq(schema.schedules.stationId, stationId), eq(schema.schedules.enabled, true), gte(schema.schedules.startAt, deps.clock.now())));
    },

    async airedItem(itemId, limit) {
      const rows = await db
        .select({ stationId: schema.asRun.stationId, startedAt: schema.asRun.startedAt, reason: schema.asRun.reason, carriageAgreementId: schema.asRun.carriageAgreementId })
        .from(schema.asRun)
        .where(and(eq(schema.asRun.assetId, itemId), eq(schema.asRun.code, "PGM")))
        .orderBy(desc(schema.asRun.startedAt))
        .limit(limit);
      return rows;
    },

    async firstAired(itemIds) {
      if (!itemIds.length) return new Map();
      const rows = await db
        .selectDistinctOn([schema.asRun.assetId], { itemId: schema.asRun.assetId, stationId: schema.asRun.stationId, startedAt: schema.asRun.startedAt })
        .from(schema.asRun)
        .where(inArray(schema.asRun.assetId, itemIds))
        .orderBy(schema.asRun.assetId, asc(schema.asRun.startedAt));
      return new Map(rows.map((r) => [r.itemId!, { stationId: r.stationId, startedAt: r.startedAt }]));
    },

    async airedHistory(stationId, itemIds, limit) {
      if (!itemIds.length) return [];
      const rows = await db
        .select({ assetId: schema.asRun.assetId })
        .from(schema.asRun)
        .where(and(eq(schema.asRun.stationId, stationId), inArray(schema.asRun.assetId, itemIds)))
        .orderBy(desc(schema.asRun.startedAt), desc(schema.asRun.id))
        .limit(limit);
      return rows.map((r) => r.assetId!);
    },

    async lastAired(stationId, itemIds) {
      if (!itemIds.length) return new Map();
      const rows = await db
        .select({ assetId: schema.asRun.assetId, at: sql<Date>`max(${schema.asRun.startedAt})` })
        .from(schema.asRun)
        .where(and(eq(schema.asRun.stationId, stationId), inArray(schema.asRun.assetId, itemIds)))
        .groupBy(schema.asRun.assetId);
      return new Map(rows.map((r) => [r.assetId!, new Date(r.at)]));
    },

    async endLive(stationId, userId) {
      await db.insert(schema.commands).values({ stationId, action: "end_live", issuedBy: userId });
    },

    async replan(stationId) {
      const [state] = await db.select({ onAir: P.onAir }).from(P).where(eq(P.stationId, stationId));
      if (state?.onAir) await db.insert(schema.commands).values({ stationId, action: "replan" });
    },

    async onAirSince(stationIds) {
      if (!stationIds.length) return new Map();
      const rows = await db
        .select({ stationId: schema.commands.stationId, at: sql<Date>`max(${schema.commands.createdAt})` })
        .from(schema.commands)
        .where(and(inArray(schema.commands.stationId, stationIds), eq(schema.commands.action, "sign_on")))
        .groupBy(schema.commands.stationId);
      return new Map(rows.map((r) => [r.stationId, new Date(r.at)]));
    },

    async preparation(ref, band) {
      await syncPreparedVersions(db);
      const key = refKey(ref);
      if (!key) return { status: "not_asked", renditions: [], preparedAt: null, converted: [] };
      const [[item], renditions] = await Promise.all([
        db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, key)),
        db.select({ rendition: schema.preparedRenditions.rendition }).from(schema.preparedRenditions).where(eq(schema.preparedRenditions.key, key))
      ]);
      const done = renditions.map((r) => r.rendition).sort();
      const ready = BAND_RENDITIONS[band].every((r) => done.includes(r));
      // Cleaner pictures (programming Phase 1): what preparing did to the picture, when it was this pipeline's.
      const picture = item && item.pipeline >= 2 ? item.picture : null;
      return {
        status: ready ? "ready" : ((item?.status === "ready" ? "queued" : item?.status) ?? "not_asked"),
        renditions: done,
        preparedAt: item?.preparedAt?.toISOString() ?? null,
        converted: [...(picture?.hdr ? (["from_hdr"] as const) : []), ...(picture?.interlaced ? (["deinterlaced"] as const) : [])]
      };
    },

    async generatedStationId(stationId) {
      // A station ID of its own that can air (prepared, rights confirmed) wins.
      const [{ stationIds }, look] = await Promise.all([services.library.fillers(stationId), services.stations.look(stationId)]);
      if (stationIds.length || !look) return null;
      const key = generatedStationIdKey(look, look.band);
      const { ready, status } = await readyKeys({ deps, services }, [key], look.band);
      const done = ready.has(key);
      // Its own playlist, beside its segments (the API passes them through when storage has no public domain).
      const playlist = `${objectKey.prepared(key, REFERENCE[look.band])}/index.m3u8`;
      return {
        code: "SID",
        durationMs: GENERATED_SID_MS,
        sound: "bed",
        status: done ? "ready" : status.get(key) === "failed" ? "failed" : "preparing",
        look: { callSign: look.callSign, channel: look.channel, name: look.name, city: look.homeCity, colour: look.colour },
        playbackUrl: done ? (deps.storage.objects.publicUrl?.(playlist) ?? publicUrl(deps, `/hls/${playlist}`)) : null
      };
    },

    async stationIdMs(stationId) {
      const generated = await service.generatedStationId(stationId);
      return generated?.status === "ready" ? GENERATED_SID_MS : STATION_ID_MS;
    },

    async carriedAirings(agreementIds, from, to) {
      if (!agreementIds.length) return new Map();
      const rows = await db
        .select({ agreementId: schema.asRun.carriageAgreementId })
        .from(schema.asRun)
        .where(and(inArray(schema.asRun.carriageAgreementId, agreementIds), gte(schema.asRun.startedAt, from), lt(schema.asRun.startedAt, to), eq(schema.asRun.code, "PGM")));
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(r.agreementId!, (counts.get(r.agreementId!) ?? 0) + 1);
      return counts;
    },

    async previews(refs, options = {}) {
      const wanted = refs.filter((r): r is PreviewRef & { contentId: string } => Boolean(r.contentId && isContentId(r.contentId)));
      const out = new Map<string, PreviewView>();
      if (!wanted.length) return out;
      const keys = [...new Set(wanted.map((r) => r.contentId))];
      const [info, renditions, items] = await Promise.all([
        services.library.content.info(keys),
        db.select({ key: PR.key, rendition: PR.rendition }).from(PR).where(inArray(PR.key, keys)),
        db.select({ key: PI.key, status: PI.status, mediaKind: PI.mediaKind }).from(PI).where(inArray(PI.key, keys))
      ]);
      // Sound only, as it was asked for before (an order's delivery, a spot with no picture): the radio band's preview.
      const soundOnly = new Set(items.filter((i) => i.mediaKind === "audio").map((i) => i.key));
      const have = new Map<string, Set<string>>();
      for (const r of renditions) have.set(r.key, (have.get(r.key) ?? new Set()).add(r.rendition));
      const status = new Map(items.map((i) => [i.key, i.status]));
      const queue = new Map<string, typeof PI.$inferInsert>();
      for (const asked of wanted) {
        const key = asked.contentId;
        const ref = soundOnly.has(key) ? { ...asked, mediaKind: "audio" as const, band: "radio" as const } : asked;
        const file = info.get(key);
        // Locked by a claim, or gone: nothing to preview.
        if (!file || file.locked || file.deleted) continue;
        const rendition = PREVIEW_RENDITION[ref.band];
        if (have.get(key)?.has(rendition)) {
          out.set(key, { status: "ready", url: previewUrlOf(key, rendition) });
          continue;
        }
        // Another ref may have found it ready in the other band's rendition already.
        if (out.get(key)?.status === "ready") continue;
        const now = status.get(key);
        if (now === "failed") {
          out.set(key, { status: "failed", url: null });
          continue;
        }
        if (options.prepare || now === "queued" || now === "preparing") out.set(key, { status: "preparing", url: null });
        // Asked for: queued (or this band's renditions added to what's queued), after what airs within the hour.
        if (options.prepare) {
          queue.set(key, wantRow({ contentId: key, mediaKind: ref.mediaKind, band: ref.band, durationMs: ref.durationMs ?? null, neededAt: new Date(deps.clock.now().getTime() + PREVIEW_NEEDED_IN_MS) }, key, queue.get(key)));
        }
      }
      if (queue.size) await queuePreparation(db, [...queue.values()]);
      return out;
    },

    async previewPlaylist(key, rendition) {
      if (!isContentId(key) || !Object.values(PREVIEW_RENDITION).includes(rendition as RenditionName)) return null;
      const file = (await services.library.content.info([key])).get(key);
      if (!file || file.locked || file.deleted) return null;
      // The newer copy, once it's ready (it has every rendition the first one has).
      await syncPreparedVersions(db);
      const prepared = refKey({ contentId: key })!;
      const [row] = await db.select({ segmentMs: PR.segmentMs }).from(PR).where(and(eq(PR.key, prepared), eq(PR.rendition, rendition)));
      if (!row?.segmentMs.length) return null;
      const target = Math.max(1, ...row.segmentMs.map((ms) => Math.ceil(ms / 1000)));
      const body = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        `#EXT-X-TARGETDURATION:${target}`,
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        "#EXT-X-INDEPENDENT-SEGMENTS",
        ...row.segmentMs.flatMap((ms, i) => [`#EXTINF:${(ms / 1000).toFixed(3)},`, segmentUrl(prepared, rendition, i)]),
        "#EXT-X-ENDLIST",
        ""
      ].join("\n");
      // Short: the file can be taken down, and segment URLs may be presigned one day.
      return { body, maxAge: 60 };
    },

    async dropPrepared(keys, { evenIfAiring }) {
      // A file's newer copy (`<key>-p2`, cleaner pictures) goes with it.
      const given = keys.filter(Boolean);
      const newer = given.length ? (await db.select({ key: PI.key }).from(PI).where(inArray(PI.key, given.map(versionedKey)))).map((r) => r.key) : [];
      const unique = [...new Set([...given, ...newer])];
      const dropped: string[] = [];
      const deferred: string[] = [];
      if (!unique.length) return { dropped, deferred };
      const airing = evenIfAiring
        ? new Set<string>()
        : new Set(
            (
              await db
                .selectDistinct({ key: schema.channelItems.preparedKey })
                .from(schema.channelItems)
                .where(and(inArray(schema.channelItems.preparedKey, unique), gt(schema.channelItems.endsAt, new Date(deps.clock.now().getTime() - AIRED_GRACE_MS))))
            ).map((r) => r.key!)
          );
      for (const key of unique) {
        if (airing.has(key)) {
          deferred.push(key);
          continue;
        }
        // Caption tracks made from this file (a WebVTT's content ID), wherever they were cut.
        const cut = await db.select({ key: PC.key, rendition: PC.rendition }).from(PC).where(eq(PC.contentId, key));
        for (const c of cut) await deps.storage.objects.deletePrefix(objectKey.prepared(c.key, c.rendition));
        await deps.storage.objects.deletePrefix(objectKey.preparedItem(key));
        await db.transaction(async (tx) => {
          await tx.delete(PC).where(eq(PC.contentId, key));
          await tx.delete(PC).where(eq(PC.key, key));
          await tx.delete(PR).where(eq(PR.key, key));
          await tx.delete(PI).where(eq(PI.key, key));
        });
        for (const k of [...lengths.keys()]) if (k.startsWith(`${key}/`)) lengths.delete(k);
        dropped.push(key);
      }
      return { dropped, deferred };
    },

    async dropLiveCopies(liveSourceId) {
      const rows = await db
        .select({ liveUris: schema.channelItems.liveUris })
        .from(schema.channelItems)
        .where(and(eq(schema.channelItems.kind, "live"), eq(schema.channelItems.liveSourceId, liveSourceId)));
      const sessions = liveObjectPrefixes(rows.map((r) => r.liveUris));
      for (const prefix of sessions) await deps.storage.objects.deletePrefix(prefix);
      return { sessions };
    },

    async sweepPrepared() {
      // Prepared from a content ID (not slates, not old locations), whose file is gone.
      const [items, captions] = await Promise.all([
        db.selectDistinct({ key: PI.key }).from(PI).where(sql`${PI.contentId} is not null`),
        db.selectDistinct({ key: PC.contentId }).from(PC)
      ]);
      const keys = [...new Set([...items.map((r) => r.key), ...captions.map((r) => r.key)])].filter(isContentId);
      let dropped = 0;
      let deferred = 0;
      for (let i = 0; i < keys.length; i += 500) {
        const gone = await services.library.content.deletedAmong(keys.slice(i, i + 500));
        const result = await service.dropPrepared([...gone], { evenIfAiring: false });
        dropped += result.dropped.length;
        deferred += result.deferred.length;
      }
      return { dropped, deferred };
    }
  };
  return service;
}
