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
// - What's on comes from the source's own feed (iCal, RSS, JSON or XMLTV), or guide data checked
//   against its published schedule; with neither, the banner says Live and the source.
// - Each listing's stream (or embed) is checked every minute by the worker, lightly: one small
//   request with a timeout, never a segment. Down 5 minutes, it leaves the dial, the guide and the
//   swipe order until it's back; the Network desk hears both times (`external.station`).
// - IPTV lists are leads: their channels go into the creator pipeline with the stream noted.

import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { isSubchannel, parseChannelNumber, type Band } from "@opencast/domain";
import type { Creator, ExternalInfo, ExternalOutage, IptvChannel, ListedSource, StreamPermission } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import type { CurrentUser } from "../../http.js";
import { badRequest, conflict, HttpError, notFound, refused } from "../../errors.js";
import { isIptvOrgAddress, parseIptvList } from "../../lib/iptv.js";
import { detectScheduleFormat, parseSchedule, type ScheduleFormat } from "../../lib/schedules.js";
import { clockTime } from "../../lib/time.js";
import { publicFetch } from "../../lib/publicFetch.js";

/** A check that hasn't answered by then has failed. */
export const CHECK_TIMEOUT_MS = 5_000;
/** Down this long, a listing leaves the dial. */
export const DOWN_AFTER_MS = 5 * 60_000;
/** A playlist's first bytes are enough to know it's a playlist; nothing more is read. */
const MANIFEST_BYTES = 64 * 1024;
/** Checks at once, so a minute's round stays well inside the minute. */
const CHECKS_AT_ONCE = 8;
/** An IPTV list read by its address: its size and patience. */
const LIST_BYTES = 5_000_000;
const LIST_TIMEOUT_MS = 15_000;

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
  callSign: string;
  name: string;
  description?: string;
  streamUrl: string;
  embedTerms?: "allowed" | "unclear";
  calendarUrl?: string;
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
  info: ExternalInfo;
  playback: { kind: "hls" | "embed"; url: string } | null;
}

export interface ExternalCheckResult {
  checked: number;
  up: number;
  down: number;
  hidden: number;
  back: number;
}

export interface ExternalPart {
  listedSources(marketId?: string): Promise<ListedSource[]>;
  addListedSource(user: CurrentUser | null, input: AddListedInput): Promise<ListedSource>;
  recordListedEvidence(user: CurrentUser | null, sourceId: string, input: EvidenceInput & { embedTerms?: "allowed" | "unclear" }): Promise<ListedSource>;
  syncListedSource(sourceId: string, fetchFn?: Fetch): Promise<ListedSource>;
  externalOutages(sourceId: string): Promise<ExternalOutage[]>;
  /** External stations' place on the dial, by station. */
  externalDial(stationIds: string[]): Promise<Map<string, ExternalDial>>;
  /** The worker's minute: every listing that could be on the dial, checked. */
  checkExternalStations(options?: { fetch?: Fetch }): Promise<ExternalCheckResult>;
  /** Hourly: each listing's feed read again. */
  syncExternalSchedules(options?: { fetch?: Fetch }): Promise<{ synced: number; failed: number }>;
  previewIptvList(input: { m3u?: string; url?: string }, fetchFn?: Fetch): Promise<{ listUrl: string | null; channels: Array<IptvChannel & { already: "lead" | "external" | null }>; skipped: number }>;
  importIptvLeads(input: { marketId: string; listUrl?: string; channels: IptvChannel[] }): Promise<{ imported: Creator[]; skipped: number }>;
}

const LS = schema.listedSources;
const LA = schema.listedAirings;
const SP = schema.streamPermissions;
const OU = schema.externalOutages;
const CR = schema.creators;

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
export function waitingFor(row: Pick<Row, "plays" | "embedTerms" | "basis" | "streamFormat" | "outsideMarket" | "health">, rules: { otherMarkets: boolean; dash: boolean }): Waiting | null {
  if (row.plays === "embed") {
    if (row.embedTerms !== "allowed") return "terms_unclear";
    if (row.basis !== "embed_terms") return "needs_terms";
  } else {
    if (row.basis !== "written_permission" && row.basis !== "public_source") return "needs_permission";
    if (row.streamFormat === "dash" && !rules.dash) return "dash_not_played";
  }
  if (row.outsideMarket && !rules.otherMarkets) return "other_market";
  if (row.health === "hidden") return "down";
  return null;
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
    const head = (await readSome(res, MANIFEST_BYTES)).trimStart();
    if (head.startsWith("#EXTM3U")) return { ok: true, detail: null, format: "hls" };
    if (/<MPD[\s>]/.test(head)) return { ok: true, detail: null, format: "dash" };
    return { ok: false, detail: "Not a stream playlist" };
  } catch (error) {
    return failed(error);
  }
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
    return { otherMarkets: other.allowed, dash: dash.played };
  }

  async function views(rows: Row[]): Promise<ListedSource[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const permissionIds = rows.map((r) => r.streamPermissionId).filter((v): v is string => !!v);
    const [idents, counts, permissions, outages, rule] = await Promise.all([
      services.stations.idents(rows.map((r) => r.stationId)),
      db
        .select({ sourceId: LA.listedSourceId, n: sql<number>`count(*)::int` })
        .from(LA)
        .where(and(inArray(LA.listedSourceId, ids), gte(LA.startsAt, deps.clock.now())))
        .groupBy(LA.listedSourceId),
      permissionIds.length ? db.select().from(SP).where(inArray(SP.id, permissionIds)) : Promise.resolve([]),
      db.select().from(OU).where(inArray(OU.listedSourceId, ids)).orderBy(desc(OU.downSince)),
      rules()
    ]);
    const recorders = await services.accounts.displayNames(permissions.map((p) => p.recordedBy).filter((v): v is string => !!v));
    return rows.flatMap((r) => {
      const station = idents.get(r.stationId);
      if (!station) return [];
      const waiting = waitingFor(r, rule);
      const p = permissions.find((x) => x.id === r.streamPermissionId);
      const permission: StreamPermission | null = p
        ? {
            id: p.id,
            grantedBy: p.grantedBy,
            grantedOn: p.grantedOn,
            evidence: p.evidence,
            documentUrl: p.documentUrl,
            streamUrl: p.streamUrl,
            recordedAt: p.recordedAt.toISOString(),
            recordedBy: p.recordedBy ? (recorders.get(p.recordedBy) ?? null) : null,
            creatorId: p.creatorId
          }
        : null;
      const view: ListedSource = {
        id: r.id,
        station,
        name: r.name,
        description: r.description,
        streamUrl: r.streamUrl,
        embedTerms: r.embedTerms,
        calendarUrl: r.calendarUrl,
        calendarSync: r.calendarSync,
        // "listed" while its evidence holds (on the dial, or off it only while it's down).
        listingState: waiting === null || waiting === "down" ? "listed" : "checking",
        lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
        upcoming: counts.find((c) => c.sourceId === r.id)?.n ?? 0,
        plays: r.plays,
        streamFormat: r.plays === "stream_link" ? (r.streamFormat ?? streamFormatOf(r.streamUrl)) : null,
        evidence: { basis: r.basis, termsUrl: r.termsUrl, termsCheckedOn: r.termsCheckedOn, publicBasis: r.publicBasis, permission, note: r.waitingNote },
        schedule: { source: r.scheduleSource, format: r.scheduleFormat, url: r.calendarUrl, checkedAgainst: r.guideCheckedAgainst, checkedOn: r.guideCheckedOn },
        onDial: waiting === null,
        waiting,
        health: { state: r.health, since: r.healthSince?.toISOString() ?? null, lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null, detail: r.lastCheckDetail },
        outages: outages.filter((o) => o.listedSourceId === r.id).slice(0, 5).map(outageView),
        creatorId: r.creatorId
      };
      return [view];
    });
  }

  const outageView = (o: typeof OU.$inferSelect): ExternalOutage => ({
    id: o.id,
    downSince: o.downSince.toISOString(),
    hiddenAt: o.hiddenAt?.toISOString() ?? null,
    backAt: o.backAt?.toISOString() ?? null,
    detail: o.detail
  });

  const one = async (sourceId: string) => (await views(await db.select().from(LS).where(eq(LS.id, sourceId))))[0];

  /** The same channel rules as a full station, with room for more external stations in one major (9.1, 9.2, 9.3). */
  async function checkChannel(marketId: string, band: Band, channel: string) {
    const number = parseChannelNumber(band, channel);
    if (!number) throw badRequest(band === "tv" ? "TV channels run from 2.1 to 69.9." : "Radio runs from 88.2 to 107.8, in even tenths.", { channel: "Out of range" });
    if (!(await services.network.marketsByIds([marketId])).size) throw notFound("That market");
    const range = await services.settings.numberingFor(marketId);
    const outside =
      band === "tv"
        ? Math.floor(number.tenths / 10) < range.tv.firstMajor || Math.floor(number.tenths / 10) > range.tv.lastMajor
        : number.tenths < range.radio.firstTenths || number.tenths > range.radio.lastTenths;
    if (outside) throw refused("outside_numbering", `${band === "tv" ? `TV channels here run from ${range.tv.firstMajor}.1 to ${range.tv.lastMajor}.9.` : `Radio here runs from ${(range.radio.firstTenths / 10).toFixed(1)} to ${(range.radio.lastTenths / 10).toFixed(1)}.`} Choose a number in the market's range.`);
    const [here, held] = await Promise.all([services.stations.inMarkets([marketId]), services.waitlist.heldChannels(marketId, band)]);
    const major = (t: number) => (band === "tv" ? Math.floor(t / 10) : t);
    const sameMajor = here.filter((s) => s.ident.band === band && s.ident.channel && major(Math.round(Number(s.ident.channel) * 10)) === major(number.tenths));
    const taken = sameMajor.some((s) => s.ident.channel === channel || s.kind !== "listed") || held.some((h) => major(h.tenths) === major(number.tenths));
    if (taken) throw conflict("channel_taken", `${channel} is taken. Pick another.`);
    // A station gets X.1; a subchannel only beside other external stations.
    if (isSubchannel(number) && !sameMajor.length) throw badRequest(`Start at ${Math.floor(number.tenths / 10)}.1. Subchannels go beside other external stations.`, { channel: "Use X.1" });
    return number;
  }

  async function checkCallSign(callSign: string) {
    // The same rules as a full station's: names Opencast won't allow, then taken or held.
    await services.waitlist.requireAllowed(callSign);
    if (!(await services.waitlist.isAvailable(callSign))) throw conflict("call_sign_taken", `${callSign} is taken or held. Try another.`);
  }

  function checkEvidence(plays: "embed" | "stream_link", input: { embedTerms?: "allowed" | "unclear"; evidence?: EvidenceInput }) {
    if (input.evidence?.permission && plays !== "stream_link") throw badRequest("Written permission is for stream links. An embed needs its terms page.", { permission: "Stream links only" });
    if (input.evidence?.publicBasis && plays !== "stream_link") throw badRequest("A public basis is for stream links. An embed needs its terms page.", { publicBasis: "Stream links only" });
  }

  async function recordPermission(tx: Executor, user: CurrentUser | null, streamUrl: string, creatorId: string | null, p: NonNullable<EvidenceInput["permission"]>) {
    const [row] = await tx
      .insert(SP)
      .values({ grantedBy: p.grantedBy.trim(), grantedOn: p.grantedOn, evidence: p.evidence.trim(), documentUrl: p.documentUrl ?? null, streamUrl, creatorId, recordedBy: user?.id ?? null, recordedAt: deps.clock.now() })
      .returning({ id: SP.id });
    return row.id;
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

  const part: ExternalPart = {
    async listedSources(marketId) {
      const rows = await db.select().from(LS).orderBy(asc(LS.name));
      if (!marketId) return views(rows);
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
      if (creator && (await db.select({ id: LS.id }).from(LS).where(eq(LS.creatorId, creator.id))).length) throw conflict("already_external", `${creator.displayName} is already an external station.`);
      const number = await checkChannel(input.marketId, input.band, input.channel);
      await checkCallSign(input.callSign);
      const outsideMarket = input.outsideMarket ?? false;
      const sourceId = await db.transaction(async (tx) => {
        const stationId = await services.stations.createManaged(tx, { kind: "listed", name: input.name, callSign: input.callSign, marketId: input.marketId, band: input.band, tenths: number.tenths, description: input.description });
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
            listingState: "listed"
          })
          .returning();
        // The lead became this external station: On air once its evidence holds (recordListedEvidence
        // moves it then); until then it keeps its stage.
        if (creator) await tx.update(CR).set({ stationId, ...(basisFor(evidence) ? { stage: "on_air" as const } : {}), nextAction: null, nextActionDue: null }).where(eq(CR.id, creator.id));
        return row.id;
      });
      if (input.calendarUrl) await part.syncListedSource(sourceId);
      return one(sourceId);
    },

    async recordListedEvidence(user, sourceId, input) {
      const [row] = await db.select().from(LS).where(eq(LS.id, sourceId));
      if (!row) throw notFound("That external station");
      checkEvidence(row.plays, { evidence: input });
      if (input.permission && row.streamPermissionId) throw conflict("permission_recorded", "Their written permission is already recorded. It's never edited.");
      await db.transaction(async (tx) => {
        const streamPermissionId = input.permission ? await recordPermission(tx, user, row.streamUrl, row.creatorId, input.permission) : row.streamPermissionId;
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
        // Its lead is On air once the evidence holds.
        if (row.creatorId && basisFor(next)) await tx.update(CR).set({ stage: "on_air" }).where(eq(CR.id, row.creatorId));
      });
      return one(sourceId);
    },

    async syncListedSource(sourceId, fetchFn = publicFetch) {
      const [row] = await db.select().from(LS).where(eq(LS.id, sourceId));
      if (!row) throw notFound("That listed source");
      if (!row.calendarUrl) throw refused("no_calendar", "Add the source's agenda calendar first.");
      await sync(row, fetchFn);
      return one(sourceId);
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
          const waiting = waitingFor(r, rule);
          const dial: ExternalDial = {
            onDial: waiting === null,
            down: waiting === "down",
            info: { source: r.name, plays: r.plays, schedule: r.scheduleSource },
            // Straight from the source: its embed, or its stream link in Opencast's player.
            playback: waiting === null ? { kind: r.plays === "embed" ? "embed" : "hls", url: r.streamUrl } : null
          };
          return [r.stationId, dial] as const;
        })
      );
    },

    async checkExternalStations(options = {}) {
      const result: ExternalCheckResult = { checked: 0, up: 0, down: 0, hidden: 0, back: 0 };
      const [rows, rule] = await Promise.all([db.select().from(LS), rules()]);
      // Only listings that could be on the dial: evidence in place (a hidden one is still checked).
      const due = rows.filter((r) => {
        const waiting = waitingFor(r, rule);
        return waiting === null || waiting === "down";
      });
      await inBatches(due, CHECKS_AT_ONCE, async (row) => {
        const check = await checkStream({ plays: row.plays, streamUrl: row.streamUrl }, options.fetch ?? publicFetch);
        result.checked++;
        await applyCheck(row, check, result);
      });
      return result;
    },

    async syncExternalSchedules(options = {}) {
      const rows = await db.select().from(LS).where(sql`${LS.calendarUrl} is not null`);
      let synced = 0;
      let failed = 0;
      for (const row of rows) {
        if (await sync(row, options.fetch ?? publicFetch)) synced++;
        else failed++;
      }
      return { synced, failed };
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
