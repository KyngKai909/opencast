// External stations (follow-up Phase 6): a channel number, a call sign, a banner and a place on the
// dial, with the video straight from the source's own stream. No playout, prepared segments, spots,
// sponsor credits, partner ads or earnings, and never carried or offered in the market (the router
// refuses those: externalGuard.ts).
//
// - Two ways to play, each with its evidence: the source's official embed where its terms allow
//   embedding (the terms page and the day it was checked), or its stream link played in Opencast's
//   player (the source's written permission, kept like a claimable station's permission record, or
//   a clearly public source with the basis). Never proxied, cached or re-served: viewers' players
//   fetch from the source. Without the evidence a listing is saved but isn't on the dial.
// - A237 (the user's decision, over the line above for `http://` stream links only): HTTPS apps
//   can't load a plain-http stream, so one is tried over https first (the same host and path), and
//   played from there straight from the source when a real playlist answers; otherwise it's carried
//   through Opencast's HTTPS relay (apps/stream-relay: pass-through, nothing stored), or waits
//   (`needs_https`) when the relay isn't configured. https stream links, embeds and DASH over https
//   are unchanged. Checks still fetch the source directly.
// - What's on comes from the source's own feed (iCal, RSS, JSON or XMLTV), or guide data checked
//   against its published schedule; with neither, the banner says Live and the source.
// - Each listing's stream (or embed) is checked every minute by the worker, lightly: one small
//   request with a timeout, never a segment. Down 5 minutes, it leaves the dial, the guide and the
//   swipe order until it's back; the Network desk hears both times (`external.station`).
// - IPTV lists are leads: their channels go into the creator pipeline with the stream noted.
// - A215: a listing can be changed (never onto the dial without evidence that covers what now
//   plays: a written permission names one exact stream address, embed terms were checked for one
//   player's host, a public basis is about the source) and taken off the dial for good (archived,
//   like a full station that signs off for good), then put back. Every change is kept.
// - A229: one brand's streams share a call sign on one channel's subchannels (15.1 SBCO, 15.2 SBCO,
//   15.3 SBCO): X.n beside an external X.1 in the same market and major. Only the call sign is
//   shared; each stream keeps its own evidence, checks, outages and watch data. A change on X.1 is
//   the family's (the old one held a year for it), X.1 moves only on its own, and taking X.1 off
//   the dial takes its family with it (A231), when the desk says so; "Put back" brings them back.

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { CHANNEL_HOLD_AFTER_SIGN_OFF_MS, familyHeadTenths, formatChannelNumber, isSubchannel, parseChannelNumber, type Band, type ChannelNumber } from "@opencast/domain";
import type { Creator, CreatorStage, ExternalInfo, ExternalOutage, IptvChannel, ListedChange, ListedField, ListedSource, StreamPermission } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import type { StationProfile } from "../stations/service.js";
import type { CurrentUser } from "../../http.js";
import { badRequest, conflict, HttpError, notFound, refused } from "../../errors.js";
import { isIptvOrgAddress, parseIptvList } from "../../lib/iptv.js";
import { detectScheduleFormat, parseSchedule, type ScheduleFormat } from "../../lib/schedules.js";
import { clockTime } from "../../lib/time.js";
import { publicFetch } from "../../lib/publicFetch.js";
import { httpsVariant, isPlainHttp, relayUrl } from "../../lib/streamRelay.js";

/** A check that hasn't answered by then has failed. */
export const CHECK_TIMEOUT_MS = 5_000;
/** Down this long, a listing leaves the dial. */
export const DOWN_AFTER_MS = 5 * 60_000;
/** A playlist's first bytes are enough to know it's a playlist; nothing more is read. */
const MANIFEST_BYTES = 64 * 1024;
/** A237: how often an `http://` stream link that didn't answer over https is tried there again. */
export const HTTPS_RECHECK_MS = 60 * 60_000;
/** Checks at once, so a minute's round stays well inside the minute. */
const CHECKS_AT_ONCE = 8;
/** An IPTV list read by its address: its size and patience. */
const LIST_BYTES = 5_000_000;
const LIST_TIMEOUT_MS = 15_000;
/**
 * A215: taken off the dial for good, a listing's channel stays held for it this long, then it's
 * freed: the rule for a full station that signs off for good (docs/reference/control, station
 * settings). Its call sign stays its own, held a year on the waitlist's side like one's.
 */
export const REMOVED_CHANNEL_HOLD_MS = CHANNEL_HOLD_AFTER_SIGN_OFF_MS;

export type Fetch = typeof fetch;
type Row = typeof LS.$inferSelect;
export type Waiting = NonNullable<ListedSource["waiting"]>;
type EvidenceInput = {
  termsUrl?: string;
  termsCheckedOn?: string;
  publicBasis?: string;
  permission?: { grantedBy: string; grantedOn: string; evidence: string; documentUrl?: string };
  note?: string;
};

export interface AddListedInput {
  marketId: string;
  band: Band;
  channel: string;
  /** Required unless `shareCallSign` (A229), which takes X.1's. */
  callSign?: string;
  name: string;
  description?: string;
  streamUrl: string;
  embedTerms?: "allowed" | "unclear";
  calendarUrl?: string;
  /** A229: "Same brand as 15.1 SBCO": share the call sign of the external station on X.1. */
  shareCallSign?: boolean;
  plays?: "embed" | "stream_link";
  calendarFormat?: ScheduleFormat;
  guideData?: { checkedAgainst: string; checkedOn: string };
  evidence?: EvidenceInput;
  creatorId?: string;
  outsideMarket?: boolean;
}

/** What the dial needs about an external station. */
export interface ExternalDial {
  /** On the dial: evidence in place, in its market, and not hidden for being down. */
  onDial: boolean;
  /** Off the dial because its stream is down (the station page says so). */
  down: boolean;
  /** A215: taken off the dial for good (the station page answers 404, "no longer on the dial"). */
  removed: boolean;
  info: ExternalInfo;
  playback: { kind: "hls" | "embed"; url: string; format?: "dash" } | null;
}

export interface ExternalCheckResult {
  checked: number;
  up: number;
  down: number;
  hidden: number;
  back: number;
}

export interface UpdateListedInput {
  name?: string;
  description?: string | null;
  streamUrl?: string;
  plays?: "embed" | "stream_link";
  embedTerms?: "allowed" | "unclear";
  schedule?:
    | { source: "feed"; calendarUrl: string; calendarFormat?: ScheduleFormat | null }
    | { source: "guide_data"; calendarUrl: string; calendarFormat?: ScheduleFormat | null; guideData: { checkedAgainst: string; checkedOn: string } }
    | { source: "none" };
  channel?: string;
  callSign?: string;
  /** A229: true shares X.1's call sign; false (with `callSign`) stops sharing it. */
  shareCallSign?: boolean;
}

export interface ExternalPart {
  /** `show` (A215): the listed ones (default), or the ones taken off the dial for good. */
  listedSources(marketId?: string, show?: "listed" | "removed"): Promise<ListedSource[]>;
  addListedSource(user: CurrentUser | null, input: AddListedInput): Promise<ListedSource>;
  /** A215: change a listing; never onto the dial without evidence that covers what now plays. */
  updateListedSource(user: CurrentUser | null, sourceId: string, input: UpdateListedInput, fetchFn?: Fetch): Promise<ListedSource>;
  /** A215: take a listing off the dial for good (archived, never deleted). */
  removeListedSource(user: CurrentUser | null, sourceId: string, input?: { withFamily?: boolean }): Promise<ListedSource>;
  /** A215: put a listing taken off the dial back on the list, on its channel (or another). */
  restoreListedSource(user: CurrentUser | null, sourceId: string, input?: { channel?: string }, fetchFn?: Fetch): Promise<ListedSource>;
  /** A215: its change history, newest first; addresses in full for admins. */
  listedChanges(sourceId: string, fullAddresses: boolean): Promise<ListedChange[]>;
  /** The market a listing is (or was, when taken off the dial) in; 404 for no such listing. */
  listedSourceMarket(sourceId: string): Promise<string | null>;
  recordListedEvidence(user: CurrentUser | null, sourceId: string, input: EvidenceInput & { embedTerms?: "allowed" | "unclear" }): Promise<ListedSource>;
  syncListedSource(sourceId: string, fetchFn?: Fetch): Promise<ListedSource>;
  externalOutages(sourceId: string): Promise<ExternalOutage[]>;
  /** External stations' place on the dial, by station. */
  externalDial(stationIds: string[]): Promise<Map<string, ExternalDial>>;
  /** The worker's minute: every listing that could be on the dial, checked. */
  checkExternalStations(options?: { fetch?: Fetch }): Promise<ExternalCheckResult>;
  /**
   * Hourly: each listing's feed read again, and (A215) the channels of listings taken off the dial
   * 90 days ago freed; (A223) full stations' too, 90 days after they signed off for good.
   */
  syncExternalSchedules(options?: { fetch?: Fetch }): Promise<{ synced: number; failed: number; released?: number; releasedStations?: number }>;
  previewIptvList(input: { m3u?: string; url?: string }, fetchFn?: Fetch): Promise<{ listUrl: string | null; channels: Array<IptvChannel & { already: "lead" | "external" | null }>; skipped: number }>;
  importIptvLeads(input: { marketId: string; listUrl?: string; channels: IptvChannel[] }): Promise<{ imported: Creator[]; skipped: number }>;
}

const LS = schema.listedSources;
const LA = schema.listedAirings;
const SP = schema.streamPermissions;
const OU = schema.externalOutages;
const CR = schema.creators;
const LC = schema.listedSourceChanges;

/** An address's host, for a change history read by someone who isn't an admin: "https://colton.example.gov/…". */
export function hostOnly(url: string | null): string | null {
  if (!url) return url;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…`;
  } catch {
    return "…";
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url;
  }
};

/** The fields whose values are addresses (shown in full to admins only). */
const ADDRESS_FIELDS: ReadonlySet<ListedField> = new Set(["streamUrl", "calendarUrl", "guideCheckedAgainst"]);

/** A stream link's format by its address (a DASH manifest is `.mpd`); a check can correct it. */
export function streamFormatOf(url: string): "hls" | "dash" {
  return /\.mpd($|[?#])/i.test(url) ? "dash" : "hls";
}

/** Why a listing may play the way it does, from what's recorded; null until the evidence is complete. */
export function basisFor(row: Pick<Row, "plays" | "embedTerms" | "termsUrl" | "termsCheckedOn" | "streamPermissionId" | "publicBasis">): Row["basis"] {
  if (row.plays === "embed") return row.embedTerms === "allowed" && row.termsUrl && row.termsCheckedOn ? "embed_terms" : null;
  if (row.streamPermissionId) return "written_permission";
  return row.publicBasis ? "public_source" : null;
}

/**
 * Why a listing isn't on the dial, or null when it is. The evidence first, then the Open rules
 * (A200, A201), then its stream.
 */
export function waitingFor(
  row: Pick<Row, "plays" | "embedTerms" | "basis" | "streamFormat" | "outsideMarket" | "health"> & { streamUrl?: string; httpsUrl?: string | null },
  rules: { otherMarkets: boolean; dash: boolean; relay?: boolean }
): Waiting | null {
  if (row.plays === "embed") {
    if (row.embedTerms !== "allowed") return "terms_unclear";
    if (row.basis !== "embed_terms") return "needs_terms";
  } else {
    if (row.basis !== "written_permission" && row.basis !== "public_source") return "needs_permission";
    if (row.streamFormat === "dash" && !rules.dash) return "dash_not_played";
    // A237: plain http plays over https from the source, or through the relay; with neither, it waits.
    if (playsOverFor(row, !!rules.relay) === "needs_https") return "needs_https";
  }
  if (row.outsideMarket && !rules.otherMarkets) return "other_market";
  if (row.health === "hidden") return "down";
  return null;
}

/**
 * A237: how an `http://` stream link reaches HTTPS apps: over https from the source (it answered
 * there), through the relay, or neither (it waits). Null for anything else, which plays as listed.
 */
export function playsOverFor(row: { plays: Row["plays"]; streamUrl?: string; httpsUrl?: string | null }, relay: boolean): ListedSource["playsOver"] {
  if (row.plays !== "stream_link" || !row.streamUrl || !isPlainHttp(row.streamUrl)) return null;
  if (row.httpsUrl) return "https";
  return relay ? "relay" : "needs_https";
}

/** Up to `limit` bytes of an answer's body as text, then the rest is let go unread. */
async function readSome(res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const all = new Uint8Array(Math.min(size, limit));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.min(c.byteLength, all.byteLength - at));
    all.set(part, at);
    at += part.byteLength;
    if (at >= all.byteLength) break;
  }
  return new TextDecoder().decode(all);
}

export interface StreamCheck {
  ok: boolean;
  /** What a failed check saw, in the desk's words. */
  detail: string | null;
  /** A stream link's format, as its playlist says. */
  format?: "hls" | "dash";
  /** Where the answer came from after redirects, when the fetch says (A237: https must stay https). */
  finalUrl?: string;
}

/**
 * One check, as light as it can be: a stream link's playlist (its first 64 KB, with a timeout, and
 * never a segment), or the embed's page (a HEAD, else the start of a GET), which also has to still
 * allow being embedded.
 */
export async function checkStream(input: { plays: "embed" | "stream_link"; streamUrl: string }, fetchFn: Fetch = publicFetch, timeoutMs = CHECK_TIMEOUT_MS): Promise<StreamCheck> {
  const signal = AbortSignal.timeout(timeoutMs);
  const failed = (error: unknown): StreamCheck => ({
    ok: false,
    detail: (error as Error)?.name === "NotPublicError" ? "Not a public address" : (error as Error)?.name === "TimeoutError" || (error as Error)?.name === "AbortError" ? `No answer in ${Math.round(timeoutMs / 1000)} seconds` : "Couldn't connect"
  });
  if (input.plays === "embed") {
    try {
      let res = await fetchFn(input.streamUrl, { method: "HEAD", redirect: "follow", signal });
      if (res.status === 405 || res.status === 501) {
        res = await fetchFn(input.streamUrl, { method: "GET", redirect: "follow", signal, headers: { range: "bytes=0-4095" } });
        await res.body?.cancel().catch(() => undefined);
      }
      if (res.status >= 400) return { ok: false, detail: `HTTP ${res.status}` };
      const frame = (res.headers.get("x-frame-options") ?? "").toLowerCase();
      const ancestors = /frame-ancestors\s+([^;]+)/i.exec(res.headers.get("content-security-policy") ?? "")?.[1]?.trim().toLowerCase();
      if (frame === "deny" || frame === "sameorigin" || ancestors === "'none'" || ancestors === "'self'") return { ok: false, detail: "Their player no longer allows embedding" };
      return { ok: true, detail: null };
    } catch (error) {
      return failed(error);
    }
  }
  try {
    const res = await fetchFn(input.streamUrl, { method: "GET", redirect: "follow", signal, headers: { range: `bytes=0-${MANIFEST_BYTES - 1}` } });
    if (res.status >= 400) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, detail: `HTTP ${res.status}` };
    }
    const finalUrl = res.url ? { finalUrl: res.url } : {};
    const head = (await readSome(res, MANIFEST_BYTES)).trimStart();
    if (head.startsWith("#EXTM3U")) return { ok: true, detail: null, format: "hls", ...finalUrl };
    if (/<MPD[\s>]/.test(head)) return { ok: true, detail: null, format: "dash", ...finalUrl };
    return { ok: false, detail: "Not a stream playlist" };
  } catch (error) {
    return failed(error);
  }
}

/**
 * A237: an `http://` stream link tried over https (the same host and path; 443, or its own port when
 * it names one other than 80), with the minute's light check: a ranged GET of the playlist, a 5 s
 * timeout, the public internet only. The https address when a real HLS or DASH playlist answers
 * there (and a redirect didn't take it back to http), else null.
 */
export async function probeHttps(streamUrl: string, fetchFn: Fetch = publicFetch, timeoutMs = CHECK_TIMEOUT_MS): Promise<string | null> {
  const url = httpsVariant(streamUrl);
  if (!url) return null;
  const check = await checkStream({ plays: "stream_link", streamUrl: url }, fetchFn, timeoutMs);
  if (!check.ok) return null;
  if (check.finalUrl && !/^https:/i.test(check.finalUrl)) return null;
  return url;
}

/** Runs `work` over `items`, `limit` at a time. */
async function inBatches<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    })
  );
}

export function createExternal({ deps, services }: ModuleContext, helpers: { creatorViews(rows: Array<typeof CR.$inferSelect>): Promise<Creator[]> }): ExternalPart {
  const { db } = deps;

  async function rules() {
    const [other, dash] = await Promise.all([services.settings.valueAt("external.other_markets"), services.settings.valueAt("external.dash_stream_links")]);
    // A237: whether Opencast's HTTPS relay is configured here (STREAM_RELAY_BASE and STREAM_RELAY_SECRET).
    return { otherMarkets: other.allowed, dash: dash.played, relay: !!deps.config.streamRelay };
  }

  /** A237: the desk's fetch for an https check (a fake in tests). */
  const externalFetch = (): Fetch => deps.externalFetch ?? publicFetch;

  /** A237: an `http://` stream link tried over https now, and what was found kept. */
  async function recordHttps(sourceId: string, streamUrl: string, fetchFn: Fetch = externalFetch()) {
    const httpsUrl = await probeHttps(streamUrl, fetchFn);
    await db.update(LS).set({ httpsUrl, httpsCheckedAt: deps.clock.now() }).where(eq(LS.id, sourceId));
    return httpsUrl;
  }

  /**
   * What a viewer's player loads for a stream link on the dial: its address as listed, or (A237) for
   * `http://`, the https address that answered, else the relay's address for it.
   */
  function streamAddress(r: Row): string | null {
    if (r.plays !== "stream_link" || !isPlainHttp(r.streamUrl)) return r.streamUrl;
    if (r.httpsUrl) return r.httpsUrl;
    const relay = deps.config.streamRelay;
    return relay ? relayUrl(relay, r.streamUrl, (r.streamFormat ?? streamFormatOf(r.streamUrl)) === "dash" ? "dash" : "hls") : null;
  }

  async function views(rows: Row[]): Promise<ListedSource[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const permissionIds = rows.map((r) => r.streamPermissionId).filter((v): v is string => !!v);
    const [idents, counts, permissions, outages, rule, families] = await Promise.all([
      services.stations.idents(rows.map((r) => r.stationId)),
      db
        .select({ sourceId: LA.listedSourceId, n: sql<number>`count(*)::int` })
        .from(LA)
        .where(and(inArray(LA.listedSourceId, ids), gte(LA.startsAt, deps.clock.now())))
        .groupBy(LA.listedSourceId),
      // Its permission now, and (A215) the ones recorded for it before that no longer cover its address.
      db
        .select()
        .from(SP)
        .where(permissionIds.length ? or(inArray(SP.id, permissionIds), inArray(SP.listedSourceId, ids)) : inArray(SP.listedSourceId, ids))
        .orderBy(desc(SP.recordedAt)),
      db.select().from(OU).where(inArray(OU.listedSourceId, ids)).orderBy(desc(OU.downSince)),
      rules(),
      // A229: the call-sign family each is in, if any.
      Promise.all(rows.map((r) => services.stations.callSignFamily(r.stationId)))
    ]);
    const names = await services.accounts.displayNames([...permissions.map((p) => p.recordedBy), ...rows.map((r) => r.removedBy)].filter((v): v is string => !!v));
    const permissionView = (p: (typeof permissions)[number]): StreamPermission => ({
      id: p.id,
      grantedBy: p.grantedBy,
      grantedOn: p.grantedOn,
      evidence: p.evidence,
      documentUrl: p.documentUrl,
      streamUrl: p.streamUrl,
      recordedAt: p.recordedAt.toISOString(),
      recordedBy: p.recordedBy ? (names.get(p.recordedBy) ?? null) : null,
      creatorId: p.creatorId
    });
    return rows.flatMap((r, i) => {
      const station = idents.get(r.stationId);
      if (!station) return [];
      const family = families[i];
      const removed = !!r.removedAt;
      // Taken off the dial: nothing to wait for but being put back; what its evidence lacks still shows.
      const waiting = waitingFor({ ...r, health: removed ? "unchecked" : r.health }, rule);
      const p = permissions.find((x) => x.id === r.streamPermissionId);
      const permission: StreamPermission | null = p ? permissionView(p) : null;
      const view: ListedSource = {
        id: r.id,
        station,
        name: r.name,
        description: r.description,
        streamUrl: r.streamUrl,
        embedTerms: r.embedTerms,
        calendarUrl: r.calendarUrl,
        calendarSync: r.calendarSync,
        // "listed" while its evidence holds (on the dial, or off it only while it's down); A215:
        // "not_listed" once it's taken off the dial for good.
        listingState: removed ? "not_listed" : waiting === null || waiting === "down" ? "listed" : "checking",
        lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
        upcoming: counts.find((c) => c.sourceId === r.id)?.n ?? 0,
        plays: r.plays,
        streamFormat: r.plays === "stream_link" ? (r.streamFormat ?? streamFormatOf(r.streamUrl)) : null,
        // A237: how an http:// stream link reaches HTTPS apps (null for everything else).
        playsOver: playsOverFor(r, rule.relay),
        relayed: playsOverFor(r, rule.relay) === "relay",
        evidence: { basis: r.basis, termsUrl: r.termsUrl, termsCheckedOn: r.termsCheckedOn, publicBasis: r.publicBasis, permission, note: r.waitingNote },
        schedule: { source: r.scheduleSource, format: r.scheduleFormat, url: r.calendarUrl, checkedAgainst: r.guideCheckedAgainst, checkedOn: r.guideCheckedOn },
        onDial: !removed && waiting === null,
        waiting,
        health: { state: r.health, since: r.healthSince?.toISOString() ?? null, lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null, detail: r.lastCheckDetail },
        outages: outages.filter((o) => o.listedSourceId === r.id).slice(0, 5).map(outageView),
        creatorId: r.creatorId,
        removed: r.removedAt
          ? {
              at: r.removedAt.toISOString(),
              by: r.removedBy ? (names.get(r.removedBy) ?? null) : null,
              channel: r.removedBand && r.removedTenths ? formatChannelNumber({ band: r.removedBand, tenths: r.removedTenths }) : null,
              channelHeldUntil: new Date(r.removedAt.getTime() + REMOVED_CHANNEL_HOLD_MS).toISOString(),
              withListing: r.removedWith
            }
          : null,
        earlierPermissions: permissions.filter((x) => x.listedSourceId === r.id && x.id !== r.streamPermissionId).map(permissionView),
        family: family ? { role: family.head.id === r.stationId ? "head" : "member", head: family.head.ident, members: family.members.map((m) => m.ident) } : null
      };
      return [view];
    });
  }

  const outageView = (o: typeof OU.$inferSelect): ExternalOutage => ({
    id: o.id,
    downSince: o.downSince.toISOString(),
    hiddenAt: o.hiddenAt?.toISOString() ?? null,
    backAt: o.backAt?.toISOString() ?? null,
    detail: o.detail,
    // A215: said only when it didn't end with the stream back.
    ...(o.ended ? { ended: o.ended } : {})
  });

  const one = async (sourceId: string) => (await views(await db.select().from(LS).where(eq(LS.id, sourceId))))[0];

  /** The same channel rules as a full station, with room for more external stations in one major (9.1, 9.2, 9.3). */
  async function checkChannel(marketId: string, band: Band, channel: string, exceptStationId?: string) {
    const number = parseChannelNumber(band, channel);
    if (!number) throw badRequest(band === "tv" ? "TV channels run from 2.1 to 69.9." : "Radio runs from 88.2 to 107.8, in even tenths.", { channel: "Out of range" });
    if (!(await services.network.marketsByIds([marketId])).size) throw notFound("That market");
    const range = await services.settings.numberingFor(marketId);
    const outside =
      band === "tv"
        ? Math.floor(number.tenths / 10) < range.tv.firstMajor || Math.floor(number.tenths / 10) > range.tv.lastMajor
        : number.tenths < range.radio.firstTenths || number.tenths > range.radio.lastTenths;
    if (outside) throw refused("outside_numbering", `${band === "tv" ? `TV channels here run from ${range.tv.firstMajor}.1 to ${range.tv.lastMajor}.9.` : `Radio here runs from ${(range.radio.firstTenths / 10).toFixed(1)} to ${(range.radio.lastTenths / 10).toFixed(1)}.`} Choose a number in the market's range.`);
    const [all, held] = await Promise.all([services.stations.inMarkets([marketId]), services.waitlist.heldChannels(marketId, band)]);
    // A215: a listing changing its own channel (or put back on it) doesn't count against itself.
    const here = all.filter((s) => s.id !== exceptStationId);
    const major = (t: number) => (band === "tv" ? Math.floor(t / 10) : t);
    const sameMajor = here.filter((s) => s.ident.band === band && s.ident.channel && major(Math.round(Number(s.ident.channel) * 10)) === major(number.tenths));
    const taken = sameMajor.some((s) => s.ident.channel === channel || s.kind !== "listed") || held.some((h) => major(h.tenths) === major(number.tenths));
    if (taken) throw conflict("channel_taken", `${channel} is taken. Pick another.`);
    // A station gets X.1; a subchannel only beside other external stations.
    if (isSubchannel(number) && !sameMajor.length) throw badRequest(`Start at ${Math.floor(number.tenths / 10)}.1. Subchannels go beside other external stations.`, { channel: "Use X.1" });
    return number;
  }

  async function checkCallSign(callSign: string, forStationId?: string) {
    // The same rules as a full station's: names Opencast won't allow, then taken or held (A215: one
    // held for this station, its old one, is its own to take back).
    await services.waitlist.requireAllowed(callSign);
    if (!(await services.waitlist.isAvailable(callSign, forStationId))) throw conflict("call_sign_taken", `${callSign} is taken or held. Try another.`);
  }

  const label = (p: Pick<StationProfile, "ident">) => [p.ident.channel, p.ident.callSign].filter(Boolean).join(" ");
  const names = (ps: StationProfile[]) => ps.map(label).join(", ");

  /**
   * A229: the external station on X.1 whose call sign a listing on `number` can share: X.n (n ≥ 2)
   * in the same market and major, beside an external station on X.1 that's on the list. 422
   * `cannot_share` anywhere else.
   */
  async function familyHeadFor(marketId: string, band: Band, number: ChannelNumber): Promise<StationProfile> {
    const major = Math.floor(number.tenths / 10);
    if (band !== "tv" || !isSubchannel(number)) throw refused("cannot_share", `Only a subchannel (${band === "tv" ? `${major}.2` : "X.2"} and up) shares the call sign of the station on its .1.`);
    const x1 = formatChannelNumber({ band, tenths: familyHeadTenths(number.tenths) });
    const head = (await services.stations.inMarkets([marketId])).find((p) => p.ident.band === band && p.ident.channel === x1);
    if (!head) throw refused("cannot_share", `Nothing is on ${x1} to share a call sign with.`);
    if (head.kind !== "listed") throw refused("cannot_share", `${label(head)} is a full station. External stations share only an external station's call sign.`);
    if (head.status === "signed_off") throw refused("cannot_share", `${label(head)} was taken off the dial. Put it back first.`);
    if (!head.ident.callSign) throw refused("cannot_share", `${x1} has no call sign.`);
    return head;
  }

  function checkEvidence(plays: "embed" | "stream_link", input: { embedTerms?: "allowed" | "unclear"; evidence?: EvidenceInput }) {
    if (input.evidence?.permission && plays !== "stream_link") throw badRequest("Written permission is for stream links. An embed needs its terms page.", { permission: "Stream links only" });
    if (input.evidence?.publicBasis && plays !== "stream_link") throw badRequest("A public basis is for stream links. An embed needs its terms page.", { publicBasis: "Stream links only" });
  }

  async function recordPermission(tx: Executor, user: CurrentUser | null, streamUrl: string, creatorId: string | null, p: NonNullable<EvidenceInput["permission"]>, listedSourceId: string | null = null) {
    const [row] = await tx
      .insert(SP)
      .values({ grantedBy: p.grantedBy.trim(), grantedOn: p.grantedOn, evidence: p.evidence.trim(), documentUrl: p.documentUrl ?? null, streamUrl, creatorId, recordedBy: user?.id ?? null, recordedAt: deps.clock.now(), listedSourceId })
      .returning({ id: SP.id });
    return row.id;
  }

  /** A215: one entry in a listing's change history. */
  async function recordChange(tx: Executor, user: CurrentUser | null, sourceId: string, action: ListedChange["action"], fields: ListedChange["fields"], effects: ListedChange["effects"]) {
    await tx.insert(LC).values({ listedSourceId: sourceId, at: deps.clock.now(), by: user?.id ?? null, action, fields, effects });
  }

  /** A215: an open outage ends without the stream being back (the address changed, or it's taken off). */
  async function endOutage(tx: Executor, sourceId: string, ended: "address_changed" | "removed") {
    await tx.update(OU).set({ backAt: deps.clock.now(), ended }).where(and(eq(OU.listedSourceId, sourceId), isNull(OU.backAt)));
  }

  const unchecked = { health: "unchecked" as const, healthSince: null, lastCheckedAt: null, lastCheckDetail: null };

  /** A215: a lead's stage when its listing no longer has it On air: the one it had before, else Found. */
  async function leadBack(tx: Executor, row: Row, nextAction: string | null) {
    if (!row.creatorId) return;
    const [lead] = await tx.select().from(CR).where(eq(CR.id, row.creatorId));
    if (!lead) return;
    const stage: CreatorStage = lead.stage === "on_air" ? (row.leadStageBefore ?? "found") : lead.stage;
    await tx.update(CR).set({ stage, ...(nextAction !== null ? { stationId: null, nextAction, nextActionDue: null } : {}) }).where(eq(CR.id, lead.id));
  }

  async function notifyDesk(row: Row, step: "hidden" | "back", outage: { downSince: Date; hiddenAt: Date | null }) {
    const ident = (await services.stations.idents([row.stationId])).get(row.stationId);
    const tz = await services.stations.timezoneOf(row.stationId);
    const who = [ident?.callSign, ident?.channel].filter(Boolean).join(" ") || row.name;
    const minutes = Math.max(1, Math.round((deps.clock.now().getTime() - outage.downSince.getTime()) / 60_000));
    deps.bus.emit("external.station", {
      stationId: row.stationId,
      sourceId: row.id,
      step,
      title: step === "hidden" ? `${who} is off the dial` : `${who} is back on the dial`,
      body:
        step === "hidden"
          ? `${row.name}'s stream has been down since ${clockTime(outage.downSince, tz)}. It's off the dial, the guide and the swipe order until it's back. Anyone watching sees Stand by.`
          : `${row.name}'s stream is back after ${minutes} minute${minutes === 1 ? "" : "s"} down. It's on the dial again.`,
      dedupeKey: `external:${step}:${row.id}:${outage.downSince.toISOString()}`
    });
  }

  /** A dial row's playback: the source's embed or stream link (A237: an http:// one's https or relay address). */
  function playbackOf(r: Row): ExternalDial["playback"] {
    const url = streamAddress(r);
    if (url === null) return null;
    const dash = r.plays === "stream_link" && (r.streamFormat ?? streamFormatOf(r.streamUrl)) === "dash";
    return { kind: r.plays === "embed" ? "embed" : "hls", url, ...(dash ? { format: "dash" as const } : {}) };
  }

  /**
   * One listing's minute check, fetching the source directly (never through the relay). A237: an
   * http:// link upgraded to https is checked there, and the upgrade is dropped when https stops
   * answering while http still does; one that isn't upgraded is tried over https again hourly.
   */
  async function checkOne(row: Row, fetchFn: Fetch): Promise<StreamCheck> {
    if (row.plays !== "stream_link" || !isPlainHttp(row.streamUrl)) return checkStream({ plays: row.plays, streamUrl: row.streamUrl }, fetchFn);
    if (row.httpsUrl) {
      const check = await checkStream({ plays: row.plays, streamUrl: row.httpsUrl }, fetchFn);
      if (check.ok) return check;
      const plain = await checkStream({ plays: row.plays, streamUrl: row.streamUrl }, fetchFn);
      if (!plain.ok) return check;
      await db.update(LS).set({ httpsUrl: null, httpsCheckedAt: deps.clock.now() }).where(eq(LS.id, row.id));
      return plain;
    }
    const check = await checkStream({ plays: row.plays, streamUrl: row.streamUrl }, fetchFn);
    if (row.httpsCheckedAt && deps.clock.now().getTime() - row.httpsCheckedAt.getTime() < HTTPS_RECHECK_MS) return check;
    const httpsUrl = await recordHttps(row.id, row.streamUrl, fetchFn);
    // It plays over https now, so https answering is what counts.
    return httpsUrl && !check.ok ? { ok: true, detail: null } : check;
  }

  /** One check's result, applied: the outage opened, hidden at 5 minutes, closed when it's back. */
  async function applyCheck(row: Row, check: StreamCheck, result: ExternalCheckResult) {
    const now = deps.clock.now();
    const [open] = await db.select().from(OU).where(and(eq(OU.listedSourceId, row.id), isNull(OU.backAt)));
    const format = check.format && row.plays === "stream_link" && check.format !== row.streamFormat ? { streamFormat: check.format } : {};
    if (check.ok) {
      if (open) {
        await db.update(OU).set({ backAt: now }).where(eq(OU.id, open.id));
        if (open.hiddenAt) {
          result.back++;
          await notifyDesk(row, "back", open);
        }
      }
      await db
        .update(LS)
        .set({ health: "up", healthSince: row.health === "up" && row.healthSince ? row.healthSince : now, lastCheckedAt: now, lastCheckDetail: null, ...format })
        .where(eq(LS.id, row.id));
      result.up++;
      return;
    }
    const downSince = open?.downSince ?? now;
    if (!open) await db.insert(OU).values({ listedSourceId: row.id, downSince: now, detail: check.detail });
    const hideNow = !open?.hiddenAt && now.getTime() - downSince.getTime() >= DOWN_AFTER_MS;
    if (open) await db.update(OU).set({ detail: check.detail, ...(hideNow ? { hiddenAt: now } : {}) }).where(eq(OU.id, open.id));
    const hidden = hideNow || !!open?.hiddenAt;
    await db
      .update(LS)
      .set({ health: hidden ? "hidden" : "down", healthSince: downSince, lastCheckedAt: now, lastCheckDetail: check.detail })
      .where(eq(LS.id, row.id));
    if (hidden) result.hidden++;
    else result.down++;
    if (hideNow) await notifyDesk(row, "hidden", { downSince, hiddenAt: now });
  }

  async function sync(row: Row, fetchFn: Fetch): Promise<boolean> {
    if (!row.calendarUrl) return false;
    let events;
    let format: ScheduleFormat;
    try {
      const response = await fetchFn(row.calendarUrl, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await readSome(response, LIST_BYTES);
      format = row.scheduleFormat ?? detectScheduleFormat(row.calendarUrl, response.headers.get("content-type"), text);
      events = parseSchedule(text, format, row.calendarUrl);
    } catch {
      await db.update(LS).set({ calendarSync: "calendar_not_found" }).where(eq(LS.id, row.id));
      return false;
    }
    const now = deps.clock.now();
    await db.transaction(async (tx) => {
      await tx.delete(LA).where(and(eq(LA.listedSourceId, row.id), gte(LA.startsAt, now)));
      const upcoming = events.filter((e) => e.start >= now);
      if (upcoming.length) await tx.insert(LA).values(upcoming.map((e) => ({ listedSourceId: row.id, title: e.summary, startsAt: e.start, endsAt: e.end, externalId: e.uid })));
      await tx.update(LS).set({ calendarSync: "synced", lastSyncedAt: now, scheduleFormat: format }).where(eq(LS.id, row.id));
    });
    return true;
  }

  /** A215: one listing taken off the dial, back on the list (its channel, or `channel`), waiting for its checks. */
  async function restoreOne(user: CurrentUser | null, row: Row, profile: StationProfile, channel?: string) {
    if (row.creatorId && (await db.select({ id: LS.id }).from(LS).where(and(eq(LS.creatorId, row.creatorId), isNull(LS.removedAt)))).length) {
      throw conflict("already_external", `Its lead is already another external station.`);
    }
    const marketId = profile.marketId ?? row.removedMarketId;
    const band = profile.ident.band ?? row.removedBand;
    if (!marketId || !band) throw conflict("channel_taken", "Its channel isn't known. Choose one.");
    const old = row.removedTenths ? formatChannelNumber({ band, tenths: row.removedTenths }) : null;
    const want = channel ?? profile.ident.channel ?? old;
    if (!want) throw badRequest("Choose a channel.", { channel: "Required" });
    // Still its own (held 90 days) unless another was asked for; after that, it has to be free.
    const keep = !!profile.ident.channel && want === profile.ident.channel;
    const number = keep ? null : await checkChannel(marketId, band, want, row.stationId);
    const callSign = profile.ident.callSign;
    // A229: a family's call sign is held for X.1, and so is its family's to take back.
    if (callSign && !(await services.waitlist.isAvailable(callSign, profile.sharesCallSignWith ?? row.stationId))) throw conflict("call_sign_taken", `${callSign} has gone to someone else.`);
    await db.transaction(async (tx) => {
      if (number) await services.stations.changeManaged(tx, row.stationId, { channel: { marketId, band, tenths: number.tenths } });
      await services.stations.markSignedOn(tx, row.stationId);
      if (callSign && !profile.sharesCallSignWith) await services.waitlist.releaseHeldFor(tx, { callSign, stationId: row.stationId });
      const [lead] = row.creatorId ? await tx.select().from(CR).where(eq(CR.id, row.creatorId)) : [];
      // Back as it was, waiting for its checks.
      await tx
        .update(LS)
        .set({ removedAt: null, removedBy: null, removedMarketId: null, removedBand: null, removedTenths: null, channelReleasedAt: null, removedWith: null, ...unchecked, ...(lead ? { leadStageBefore: lead.stage } : {}) })
        .where(eq(LS.id, row.id));
      if (lead) await tx.update(CR).set({ stationId: row.stationId, nextAction: null, nextActionDue: null, ...(basisFor(row) ? { stage: "on_air" as const } : {}) }).where(eq(CR.id, lead.id));
      await recordChange(tx, user, row.id, "restored", number ? [{ field: "channel", from: old, to: want }] : [], []);
    });
  }

  const part: ExternalPart = {
    async listedSources(marketId, show = "listed") {
      const rows = await db
        .select()
        .from(LS)
        .where(show === "removed" ? isNotNull(LS.removedAt) : isNull(LS.removedAt))
        .orderBy(asc(LS.name));
      if (!marketId) return views(rows);
      // Taken off the dial: the market it was in (its channel may have been freed since).
      if (show === "removed") return views(rows.filter((r) => r.removedMarketId === marketId));
      const inMarket = new Set((await services.stations.inMarkets([marketId])).map((s) => s.id));
      return views(rows.filter((r) => inMarket.has(r.stationId)));
    },

    async addListedSource(user, input) {
      const plays = input.plays ?? "embed";
      if (plays === "embed" && !input.embedTerms) throw badRequest("Say whether their terms allow embedding.", { embedTerms: "Required for an embed" });
      checkEvidence(plays, input);
      if (input.guideData && !input.calendarUrl) throw badRequest("Guide data needs its address as well as the schedule it was checked against.", { calendarUrl: "Required with guide data" });
      const creator = input.creatorId ? (await db.select().from(CR).where(eq(CR.id, input.creatorId)))[0] : null;
      if (input.creatorId && !creator) throw notFound("That lead");
      // One listing on the list per lead (A215: one taken off the dial doesn't count; it stays archived).
      if (creator && (await db.select({ id: LS.id }).from(LS).where(and(eq(LS.creatorId, creator.id), isNull(LS.removedAt)))).length) throw conflict("already_external", `${creator.displayName} is already an external station.`);
      const number = await checkChannel(input.marketId, input.band, input.channel);
      // A229: "Same brand as 15.1 SBCO" takes X.1's call sign; otherwise its own, by the usual rules.
      const head = input.shareCallSign ? await familyHeadFor(input.marketId, input.band, number) : null;
      if (head && input.callSign && input.callSign !== head.ident.callSign) throw badRequest(`It shares ${label(head)}'s call sign.`, { callSign: `Shares ${head.ident.callSign}` });
      if (!head && !input.callSign) throw badRequest("Give it a call sign, or share the call sign of the station on its .1.", { callSign: "Required" });
      const callSign = head ? head.ident.callSign! : input.callSign!;
      if (!head) await checkCallSign(callSign);
      const outsideMarket = input.outsideMarket ?? false;
      const sourceId = await db.transaction(async (tx) => {
        const stationId = await services.stations.createManaged(tx, { kind: "listed", name: input.name, callSign, marketId: input.marketId, band: input.band, tenths: number.tenths, description: input.description, sharesCallSignWith: head?.id ?? null });
        // The station row is public from now; the dial shows it once its evidence holds (waitingFor).
        await services.stations.markSignedOn(tx, stationId);
        const streamPermissionId = plays === "stream_link" && input.evidence?.permission ? await recordPermission(tx, user, input.streamUrl, creator?.id ?? null, input.evidence.permission) : null;
        const evidence = {
          plays,
          embedTerms: plays === "embed" ? input.embedTerms! : ("unclear" as const),
          termsUrl: input.evidence?.termsUrl ?? null,
          termsCheckedOn: input.evidence?.termsCheckedOn ?? null,
          publicBasis: plays === "stream_link" ? (input.evidence?.publicBasis?.trim() ?? null) : null,
          streamPermissionId
        };
        const [row] = await tx
          .insert(LS)
          .values({
            stationId,
            name: input.name,
            description: input.description ?? null,
            streamUrl: input.streamUrl,
            calendarUrl: input.calendarUrl ?? null,
            ...evidence,
            basis: basisFor(evidence),
            streamFormat: plays === "stream_link" ? streamFormatOf(input.streamUrl) : null,
            waitingNote: input.evidence?.note ?? null,
            outsideMarket,
            scheduleSource: input.guideData ? "guide_data" : input.calendarUrl ? "feed" : "none",
            scheduleFormat: input.calendarFormat ?? null,
            guideCheckedAgainst: input.guideData?.checkedAgainst ?? null,
            guideCheckedOn: input.guideData?.checkedOn ?? null,
            creatorId: creator?.id ?? null,
            leadStageBefore: creator?.stage ?? null,
            listingState: "listed"
          })
          .returning();
        if (streamPermissionId) await tx.update(SP).set({ listedSourceId: row.id }).where(eq(SP.id, streamPermissionId));
        // The lead became this external station: On air once its evidence holds (recordListedEvidence
        // moves it then); until then it keeps its stage.
        if (creator) await tx.update(CR).set({ stationId, ...(basisFor(evidence) ? { stage: "on_air" as const } : {}), nextAction: null, nextActionDue: null }).where(eq(CR.id, creator.id));
        return row.id;
      });
      // A237: an http:// stream link is tried over https straight away.
      if (plays === "stream_link" && isPlainHttp(input.streamUrl)) await recordHttps(sourceId, input.streamUrl);
      if (input.calendarUrl) await part.syncListedSource(sourceId);
      return one(sourceId);
    },

    async recordListedEvidence(user, sourceId, input) {
      const [row] = await db.select().from(LS).where(eq(LS.id, sourceId));
      if (!row) throw notFound("That external station");
      checkEvidence(row.plays, { evidence: input });
      if (input.permission && row.streamPermissionId) throw conflict("permission_recorded", "Their written permission is already recorded. It's never edited.");
      await db.transaction(async (tx) => {
        const streamPermissionId = input.permission ? await recordPermission(tx, user, row.streamUrl, row.creatorId, input.permission, row.id) : row.streamPermissionId;
        const next = {
          plays: row.plays,
          embedTerms: row.plays === "embed" ? (input.embedTerms ?? row.embedTerms) : row.embedTerms,
          termsUrl: input.termsUrl ?? row.termsUrl,
          termsCheckedOn: input.termsCheckedOn ?? row.termsCheckedOn,
          publicBasis: input.publicBasis?.trim() ?? row.publicBasis,
          streamPermissionId
        };
        await tx
          .update(LS)
          .set({ ...next, basis: basisFor(next), ...(input.note !== undefined ? { waitingNote: input.note || null } : {}) })
          .where(eq(LS.id, sourceId));
        // Its lead is On air once the evidence holds (not while the listing is taken off the dial).
        if (row.creatorId && basisFor(next) && !row.removedAt) await tx.update(CR).set({ stage: "on_air" }).where(eq(CR.id, row.creatorId));
      });
      return one(sourceId);
    },

    async syncListedSource(sourceId, fetchFn = publicFetch) {
      const [row] = await db.select().from(LS).where(eq(LS.id, sourceId));
      if (!row) throw notFound("That listed source");
      if (row.removedAt) throw conflict("removed", `${row.name} was taken off the dial. Put it back on the list first.`);
      if (!row.calendarUrl) throw refused("no_calendar", "Add the source's agenda calendar first.");
      await sync(row, fetchFn);
      return one(sourceId);
    },

    async updateListedSource(user, sourceId, input, fetchFn = publicFetch) {
      const [row] = await db.select().from(LS).where(eq(LS.id, sourceId));
      if (!row) throw notFound("That external station");
      if (row.removedAt) throw conflict("removed", `${row.name} was taken off the dial. Put it back on the list first.`);
      const profile = (await services.stations.profiles([row.stationId])).get(row.stationId);
      if (!profile) throw notFound("That external station");
      const ident = profile.ident;
      const plays = input.plays ?? row.plays;
      const streamUrl = input.streamUrl ?? row.streamUrl;
      const addressChanged = streamUrl !== row.streamUrl;
      const playsChanged = plays !== row.plays;
      if (plays === "embed" && playsChanged && !input.embedTerms) throw badRequest("Say whether their terms allow embedding.", { embedTerms: "Required for an embed" });

      // The evidence, never stretched to cover what it wasn't recorded for.
      let embedTerms = row.embedTerms;
      let termsCheckedOn = row.termsCheckedOn;
      let publicBasis = row.publicBasis;
      let streamPermissionId = row.streamPermissionId;
      if (playsChanged) {
        // A new way to play needs its own evidence: the old kind's is set aside (and kept in the history).
        termsCheckedOn = null;
        publicBasis = null;
        streamPermissionId = null;
        embedTerms = plays === "embed" ? input.embedTerms! : "unclear";
      } else if (plays === "embed") {
        if (input.embedTerms) embedTerms = input.embedTerms;
        // Their terms were checked for the old player: another host waits for them to be checked again.
        if (addressChanged && hostOf(streamUrl) !== hostOf(row.streamUrl)) termsCheckedOn = null;
      } else if (addressChanged) {
        // A written permission names one exact address; one recorded before for this address covers it again.
        const [covering] = await db
          .select({ id: SP.id })
          .from(SP)
          .where(and(eq(SP.streamUrl, streamUrl), or(eq(SP.listedSourceId, row.id), row.streamPermissionId ? eq(SP.id, row.streamPermissionId) : sql`false`)))
          .orderBy(desc(SP.recordedAt))
          .limit(1);
        streamPermissionId = covering?.id ?? null;
        // A public basis is about the source, so it stays.
      }
      const evidence = { plays, embedTerms, termsUrl: row.termsUrl, termsCheckedOn, publicBasis, streamPermissionId };
      const basis = basisFor(evidence);

      // What's on.
      const sc = input.schedule;
      const format = sc && sc.source !== "none" ? sc.calendarFormat : undefined;
      const schedule = sc
        ? sc.source === "none"
          ? { scheduleSource: "none" as const, calendarUrl: null, scheduleFormat: null, guideCheckedAgainst: null, guideCheckedOn: null }
          : {
              scheduleSource: sc.source,
              calendarUrl: sc.calendarUrl,
              scheduleFormat: sc.calendarFormat ?? null,
              guideCheckedAgainst: sc.source === "guide_data" ? sc.guideData.checkedAgainst : null,
              guideCheckedOn: sc.source === "guide_data" ? sc.guideData.checkedOn : null
            }
        : null;
      const scheduleChanged =
        !!schedule &&
        (schedule.scheduleSource !== row.scheduleSource ||
          schedule.calendarUrl !== row.calendarUrl ||
          (format !== undefined && schedule.scheduleFormat !== row.scheduleFormat) ||
          schedule.guideCheckedAgainst !== row.guideCheckedAgainst ||
          schedule.guideCheckedOn !== row.guideCheckedOn);

      // Channel and call sign: the rules for listing.
      const channel = input.channel && input.channel !== ident.channel ? input.channel : null;
      const band = ident.band ?? "tv";
      // A229: X.1 with a family stays put (its family's channels hang off it).
      const family = await services.stations.callSignFamily(row.stationId);
      const members = family && family.head.id === row.stationId ? family.members : [];
      if (channel && members.length) {
        throw conflict("family_channel", `${names(members)} ${members.length === 1 ? "shares" : "share"} its call sign. Move ${members.length === 1 ? "it" : "them"} first, or give ${members.length === 1 ? "it its own call sign" : "them their own call signs"}.`);
      }
      const number = channel ? await checkChannel(profile.marketId ?? "", band, channel, row.stationId) : null;
      const at = number ?? (ident.channel ? (parseChannelNumber(band, ident.channel) ?? null) : null);
      let callSign = input.callSign && input.callSign !== ident.callSign ? input.callSign : null;
      // A229: joining X.1's family (its call sign), or leaving it (its own call sign, or a move to another major).
      let join: StationProfile | null = null;
      let leave = false;
      if (input.shareCallSign === true && at) {
        const head = await familyHeadFor(profile.marketId ?? "", band, at);
        if (callSign && callSign !== head.ident.callSign) throw badRequest(`It shares ${label(head)}'s call sign.`, { callSign: `Shares ${head.ident.callSign}` });
        if (head.id !== profile.sharesCallSignWith) {
          join = head;
          callSign = head.ident.callSign;
        } else callSign = null;
      } else if (profile.sharesCallSignWith) {
        const was = ident.channel ? parseChannelNumber(band, ident.channel) : undefined;
        const movedOut = !!number && !!was && familyHeadTenths(number.tenths) !== familyHeadTenths(was.tenths);
        if (input.shareCallSign === false || callSign || movedOut) {
          if (!callSign) throw badRequest("Give it its own call sign to stop sharing the call sign of the station on its .1.", { callSign: "Required" });
          leave = true;
        }
      }
      if (callSign && !join) await checkCallSign(callSign, row.stationId);

      const name = input.name !== undefined && input.name.trim() !== row.name ? input.name.trim() : null;
      const description = input.description !== undefined && (input.description?.trim() || null) !== row.description ? input.description?.trim() || null : undefined;

      const fields: ListedChange["fields"] = [];
      const note = (field: ListedField, from: string | null, to: string | null) => {
        if (from !== to) fields.push({ field, from, to });
      };
      if (name) note("name", row.name, name);
      if (description !== undefined) note("description", row.description, description);
      note("plays", row.plays, plays);
      note("streamUrl", row.streamUrl, streamUrl);
      if (plays === "embed") note("embedTerms", row.embedTerms, embedTerms);
      if (schedule && scheduleChanged) {
        note("schedule", row.scheduleSource, schedule.scheduleSource);
        note("calendarUrl", row.calendarUrl, schedule.calendarUrl);
        if (format !== undefined) note("calendarFormat", row.scheduleFormat, schedule.scheduleFormat);
        note("guideCheckedAgainst", row.guideCheckedAgainst, schedule.guideCheckedAgainst);
        note("guideCheckedOn", row.guideCheckedOn, schedule.guideCheckedOn);
      }
      if (channel) note("channel", ident.channel, channel);
      if (callSign) note("callSign", ident.callSign, callSign);
      if (!fields.length) return one(sourceId);

      const restart = addressChanged || playsChanged;
      const effects: ListedChange["effects"] = [];
      if (basisFor(row) && !basis) effects.push("waits_for_evidence");
      if (restart) effects.push("checks_restart");
      if (scheduleChanged && schedule?.calendarUrl) effects.push("schedule_reread");

      await db.transaction(async (tx) => {
        await tx
          .update(LS)
          .set({
            ...(name ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            streamUrl,
            ...evidence,
            basis,
            streamFormat: plays === "stream_link" ? (restart ? streamFormatOf(streamUrl) : (row.streamFormat ?? streamFormatOf(streamUrl))) : null,
            ...(restart ? unchecked : {}),
            // A237: a new address (or way to play) is tried over https afresh, below.
            ...(restart ? { httpsUrl: null, httpsCheckedAt: null } : {}),
            ...(schedule && scheduleChanged ? { ...schedule, calendarSync: "not_set" as const } : {})
          })
          .where(eq(LS.id, sourceId));
        // A new address starts its health afresh: the old one's outage ends (kept in the history).
        if (restart) await endOutage(tx, sourceId, "address_changed");
        // The old feed's airings from now on go; the new feed is read below.
        if (schedule && scheduleChanged) await tx.delete(LA).where(and(eq(LA.listedSourceId, sourceId), gte(LA.startsAt, deps.clock.now())));
        if (name || description !== undefined || callSign || number) {
          await services.stations.changeManaged(tx, row.stationId, {
            ...(name ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(callSign ? { callSign } : {}),
            ...(number && profile.marketId && ident.band ? { channel: { marketId: profile.marketId, band: ident.band, tenths: number.tenths } } : {}),
            ...(join ? { sharesCallSignWith: join.id } : leave ? { sharesCallSignWith: null } : {})
          });
        }
        if (callSign) {
          // The old call sign stays held for it (a year), and a held one it takes back is its own again.
          // A229: on X.1 the new one is its family's too (it follows to them), and the old one is held
          // for X.1, so the family's. A station leaving a family doesn't hold the family's name.
          await services.waitlist.releaseHeldFor(tx, { callSign, stationId: row.stationId });
          if (ident.callSign && !leave) await services.waitlist.holdCallSign(tx, { callSign: ident.callSign, stationId: row.stationId });
          if (members.length) {
            const theirs = await tx.select({ id: LS.id }).from(LS).where(inArray(LS.stationId, members.map((m) => m.id)));
            for (const m of theirs) await recordChange(tx, user, m.id, "changed", [{ field: "callSign", from: ident.callSign, to: callSign }], []);
          }
        }
        // Its lead leaves On air while the listing waits for evidence (recording it puts the lead back).
        if (effects.includes("waits_for_evidence")) await leadBack(tx, row, null);
        await recordChange(tx, user, sourceId, "changed", fields, effects);
      });
      if (restart && plays === "stream_link" && isPlainHttp(streamUrl)) await recordHttps(sourceId, streamUrl);
      const [after] = await db.select().from(LS).where(eq(LS.id, sourceId));
      if (effects.includes("schedule_reread") && after) await sync(after, fetchFn);
      return one(sourceId);
    },

    async removeListedSource(user, sourceId, input = {}) {
      const [row] = await db.select().from(LS).where(eq(LS.id, sourceId));
      if (!row) throw notFound("That external station");
      if (row.removedAt) throw conflict("removed", `${row.name} is already off the dial.`);
      const profile = (await services.stations.profiles([row.stationId])).get(row.stationId);
      // A231: X.1 with a family goes with its family, and only when the desk says so, naming them.
      const family = await services.stations.callSignFamily(row.stationId);
      const members = family && family.head.id === row.stationId ? family.members : [];
      if (members.length && !input.withFamily) {
        throw conflict("family", `${names(members)} ${members.length === 1 ? "shares" : "share"} its call sign and would go with it. Take them off too, or give them their own call signs first.`);
      }
      const theirs = members.length ? await db.select().from(LS).where(and(inArray(LS.stationId, members.map((m) => m.id)), isNull(LS.removedAt))) : [];
      await db.transaction(async (tx) => {
        for (const [r, p, withId] of [[row, profile, null], ...theirs.map((t) => [t, members.find((m) => m.id === t.stationId), row.id] as const)] as const) {
          const tenths = p?.ident.channel && p.ident.band ? parseChannelNumber(p.ident.band, p.ident.channel)?.tenths : null;
          // Archived: its permissions, outages, changes, airings, watch data and lead link all stay.
          await tx
            .update(LS)
            .set({ removedAt: deps.clock.now(), removedBy: user?.id ?? null, removedMarketId: p?.marketId ?? null, removedBand: p?.ident.band ?? null, removedTenths: tenths ?? null, channelReleasedAt: null, removedWith: withId, ...unchecked })
            .where(eq(LS.id, r.id));
          await endOutage(tx, r.id, "removed");
          // Like a full station that signs off for good: not public (off the dial, the guide, search and
          // the swipe order at once; its page is gone), its call sign held a year, its channel 90 days.
          await services.stations.markSignedOff(tx, r.stationId, true);
          // A229: a family's call sign is held for X.1 (and so for its family); a station sharing one
          // taken off alone leaves the name with its family.
          if (p?.ident.callSign && !p.sharesCallSignWith) await services.waitlist.holdCallSign(tx, { callSign: p.ident.callSign, stationId: r.stationId });
          // Its lead is a lead again, at the stage it had before it went on air.
          const was = [p?.ident.channel, p?.ident.callSign].filter(Boolean).join(" ");
          await leadBack(tx, r, `Was external station ${was || r.name}. Taken off the dial`);
          await recordChange(tx, user, r.id, "removed", [], []);
        }
      });
      return one(sourceId);
    },

    async restoreListedSource(user, sourceId, input = {}, fetchFn = publicFetch) {
      const [row] = await db.select().from(LS).where(eq(LS.id, sourceId));
      if (!row) throw notFound("That external station");
      if (!row.removedAt) throw conflict("not_removed", `${row.name} is on the list.`);
      const profile = (await services.stations.profiles([row.stationId])).get(row.stationId);
      if (!profile) throw notFound("That external station");
      // A231: a station sharing X.1's call sign comes back after X.1 (which brings back the ones taken off with it).
      if (profile.sharesCallSignWith) {
        const head = (await services.stations.profiles([profile.sharesCallSignWith])).get(profile.sharesCallSignWith);
        if (head?.status === "signed_off") throw conflict("family_removed", `Put ${label(head)} back first. It shares its call sign, and brings back the streams taken off with it.`);
      }
      await restoreOne(user, row, profile, input.channel);
      // X.1's family, taken off with it: back beside it on their own channels (or the next free ones).
      const family = await db.select().from(LS).where(and(eq(LS.removedWith, row.id), isNotNull(LS.removedAt)));
      if (family.length) {
        const head = (await services.stations.profiles([row.stationId])).get(row.stationId);
        const headMajor = head?.ident.channel ? Math.floor(Math.round(Number(head.ident.channel) * 10) / 10) : null;
        for (const member of family) {
          const p = (await services.stations.profiles([member.stationId])).get(member.stationId);
          if (!p) continue;
          // Its own channel while it's held (90 days); after that the same subchannel beside X.1, if free.
          const minor = member.removedTenths ? member.removedTenths % 10 : null;
          const want = p.ident.channel ?? (headMajor && minor ? `${headMajor}.${minor}` : null);
          try {
            await restoreOne(user, member, p, want ?? undefined);
          } catch (error) {
            // Its channel has gone: it stays off the dial, to be put back on another.
            if (!(error instanceof HttpError)) throw error;
          }
        }
      }
      const [after] = await db.select().from(LS).where(eq(LS.id, sourceId));
      if (after?.calendarUrl) await sync(after, fetchFn);
      for (const member of family) {
        const [m] = await db.select().from(LS).where(eq(LS.id, member.id));
        if (m && !m.removedAt && m.calendarUrl) await sync(m, fetchFn);
      }
      return one(sourceId);
    },

    async listedChanges(sourceId, fullAddresses) {
      const rows = await db.select().from(LC).where(eq(LC.listedSourceId, sourceId)).orderBy(desc(LC.at), desc(LC.seq));
      const names = await services.accounts.displayNames(rows.map((r) => r.by).filter((v): v is string => !!v));
      return rows.map((r) => ({
        id: r.id,
        at: r.at.toISOString(),
        by: r.by ? (names.get(r.by) ?? null) : null,
        action: r.action,
        fields: r.fields.map((f) => {
          const field = f.field as ListedField;
          const shown = (v: string | null) => (fullAddresses || !ADDRESS_FIELDS.has(field) ? v : hostOnly(v));
          return { field, from: shown(f.from), to: shown(f.to) };
        }),
        effects: r.effects as ListedChange["effects"]
      }));
    },

    async listedSourceMarket(sourceId) {
      const [row] = await db.select({ stationId: LS.stationId, removedMarketId: LS.removedMarketId }).from(LS).where(eq(LS.id, sourceId));
      if (!row) throw notFound("That external station");
      return (await services.stations.profiles([row.stationId])).get(row.stationId)?.marketId ?? row.removedMarketId;
    },

    async externalOutages(sourceId) {
      const since = new Date(deps.clock.now().getTime() - 90 * 86_400_000);
      const rows = await db
        .select()
        .from(OU)
        .where(and(eq(OU.listedSourceId, sourceId), or(gte(OU.downSince, since), isNull(OU.backAt))))
        .orderBy(desc(OU.downSince));
      return rows.map(outageView);
    },

    async externalDial(stationIds) {
      if (!stationIds.length) return new Map();
      const [rows, rule] = await Promise.all([db.select().from(LS).where(inArray(LS.stationId, stationIds)), rules()]);
      return new Map(
        rows.map((r) => {
          // A215: taken off the dial for good, it's on none of it (the station page is gone too).
          const waiting = r.removedAt ? "removed" : waitingFor(r, rule);
          const dial: ExternalDial = {
            onDial: waiting === null,
            down: waiting === "down",
            removed: !!r.removedAt,
            info: { source: r.name, plays: r.plays, schedule: r.scheduleSource },
            // Straight from the source: its embed, or its stream link in Opencast's player.
            // A201: a DASH stream link says so (`format: "dash"`); apps before it try it as HLS and stand by.
            // A237: an http:// stream link plays its https address, or the relay's (streamAddress).
            playback: waiting === null ? playbackOf(r) : null
          };
          return [r.stationId, dial] as const;
        })
      );
    },

    async checkExternalStations(options = {}) {
      const result: ExternalCheckResult = { checked: 0, up: 0, down: 0, hidden: 0, back: 0 };
      const [rows, rule] = await Promise.all([db.select().from(LS).where(isNull(LS.removedAt)), rules()]);
      // Only listings that could be on the dial: evidence in place (a hidden one is still checked),
      // and never one taken off the dial (A215). A237: whether the relay is configured doesn't
      // matter here (the worker runs these checks without the relay's variables, which only the API
      // has): every http:// link with its evidence is checked at the source, and tried over https
      // hourly (checkOne), so one waiting for https goes on the dial once it answers there.
      const due = rows.filter((r) => {
        const waiting = waitingFor(r, { ...rule, relay: true });
        return waiting === null || waiting === "down";
      });
      const fetchFn = options.fetch ?? publicFetch;
      await inBatches(due, CHECKS_AT_ONCE, async (row) => {
        const check = await checkOne(row, fetchFn);
        result.checked++;
        await applyCheck(row, check, result);
      });
      return result;
    },

    async syncExternalSchedules(options = {}) {
      // A215: a listing taken off the dial isn't read any more.
      const rows = await db.select().from(LS).where(and(isNotNull(LS.calendarUrl), isNull(LS.removedAt)));
      let synced = 0;
      let failed = 0;
      for (const row of rows) {
        if (await sync(row, options.fetch ?? publicFetch)) synced++;
        else failed++;
      }
      // A215: 90 days after a listing was taken off the dial its channel is freed, as a full station's is.
      const due = await db
        .select()
        .from(LS)
        .where(and(isNotNull(LS.removedAt), isNull(LS.channelReleasedAt), lte(LS.removedAt, new Date(deps.clock.now().getTime() - REMOVED_CHANNEL_HOLD_MS))));
      for (const row of due) {
        await db.transaction(async (tx) => {
          await services.stations.releaseChannel(tx, row.stationId);
          await tx.update(LS).set({ channelReleasedAt: deps.clock.now() }).where(eq(LS.id, row.id));
        });
      }
      // A223: a full station that signed off for good 90 days ago lets its channel go too.
      const releasedStations = await services.stations.releaseSignedOffChannels();
      return { synced, failed, released: due.length, releasedStations };
    },

    async previewIptvList(input, fetchFn = publicFetch) {
      let text = input.m3u ?? "";
      let listUrl: string | null = null;
      if (input.url) {
        if (!isIptvOrgAddress(input.url)) throw badRequest("Use a list from iptv-org (iptv-org.github.io), or paste the list itself.", { url: "iptv-org lists only" });
        listUrl = input.url;
        try {
          const res = await fetchFn(input.url, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
          if (!res.ok) throw new HttpError(502, "list_unavailable", `The list answered HTTP ${res.status}.`);
          text = await readSome(res, LIST_BYTES);
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(502, "list_unavailable", "The list couldn't be read. Try again, or paste it.");
        }
      }
      const { channels, skipped } = parseIptvList(text);
      if (!channels.length) throw refused("no_channels", "No channels with a stream address were found in that list.");
      const urls = channels.map((c) => c.streamUrl);
      const [leads, listed] = await Promise.all([
        db.select({ url: CR.streamUrl }).from(CR).where(inArray(CR.streamUrl, urls)),
        db.select({ url: LS.streamUrl }).from(LS).where(inArray(LS.streamUrl, urls))
      ]);
      const asLead = new Set(leads.map((l) => l.url));
      const asExternal = new Set(listed.map((l) => l.url));
      return {
        listUrl,
        channels: channels.map((c) => ({ ...c, already: asExternal.has(c.streamUrl) ? ("external" as const) : asLead.has(c.streamUrl) ? ("lead" as const) : null })),
        skipped
      };
    },

    async importIptvLeads(input) {
      if (!(await services.network.marketsByIds([input.marketId])).size) throw notFound("That market");
      const urls = input.channels.map((c) => c.streamUrl);
      const [leads, listed] = await Promise.all([
        db.select({ url: CR.streamUrl }).from(CR).where(inArray(CR.streamUrl, urls)),
        db.select({ url: LS.streamUrl }).from(LS).where(inArray(LS.streamUrl, urls))
      ]);
      const known = new Set([...leads, ...listed].map((l) => l.url));
      const fresh = input.channels.filter((c, i) => !known.has(c.streamUrl) && urls.indexOf(c.streamUrl) === i);
      if (!fresh.length) return { imported: [], skipped: input.channels.length };
      const rows = await db
        .insert(CR)
        .values(
          fresh.map((c) => ({
            marketId: input.marketId,
            displayName: c.name,
            // Noted, never played or checked from here: a lead isn't a listing.
            sourcePlatform: "other" as const,
            sourceUrl: c.streamUrl,
            stage: "found" as const,
            nextAction: "Ask for permission, or confirm it's public",
            leadSource: "iptv_list" as const,
            streamUrl: c.streamUrl,
            leadListUrl: input.listUrl ?? null,
            leadDetails: { tvgId: c.tvgId, group: c.group, country: c.country, logoUrl: c.logoUrl }
          }))
        )
        .returning();
      return { imported: await helpers.creatorViews(rows), skipped: input.channels.length - fresh.length };
    }
  };
  return part;
}
