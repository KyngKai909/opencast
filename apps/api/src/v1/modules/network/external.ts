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
// - A238 (the user's decision, extending A237): a stream link browsers can't load because its server
//   sends no CORS header for Opencast's apps (checked at listing, on a change and hourly: its playlist,
//   first variant and first segment) plays through the relay too, with every address relayed (/v2/,
//   "all" mode), or waits (`browsers_blocked`) without the relay; it plays direct again once a check
//   finds CORS allowed. Links that work only with another app's access (lib/platformFeeds.ts) are
//   never relayed: they wait (`platform_feed`) and stay listed.
// - What's on comes from the source's own feed (iCal, RSS, JSON or XMLTV), or guide data checked
//   against its published schedule; with neither, the banner says Live and the source. A241: or a
//   webpage's own event data (schema.org JSON-LD; a page with none is `no_event_data`, not an
//   error), or a weekly schedule entered by hand and checked against the published schedule, made
//   into airings for the next 14 days on every save and hourly. 2026-10-03: what's on now is kept
//   from a feed too (one that lists only what's on now showed nothing), and a feed is read again
//   every 2 minutes, not hourly, while its listing has nothing stored past the next 5 minutes.
//   A read changes airings in place, so viewers' reminders on them stay (or follow the show).
// - A248 (2026-10-06): or a spreadsheet. A link (a Google Sheet, read as its CSV export, or a .csv,
//   .tsv, .xlsx or .ods file) is read like a feed, hourly; a Google Sheet that isn't public says so
//   (`not_public`). An uploaded file (`schedule_source` `file`) is kept as what was read from it, and
//   made into airings at once and hourly, as a schedule entered by hand is (a sheet without dates
//   repeats weekly; one with dates airs on them). Its times are in the listing's own time zone
//   when it has one, else the zone the sheet names, else the market's (lib/sheetSchedule.ts).
// - A249 (2026-10-06): or a large guide. An XMLTV guide is read as it downloads, unzipped when it's
//   gzip (lib/guideStream.ts), for the station's channel only (`#channel=`, else its name exactly;
//   a guide of several channels with neither is `pick_channel`, never mixed), within limits on its
//   size, a channel's airings and time (`too_big`). Its ETag and Last-Modified are kept
//   (`guide_read`) and sent back, so an unchanged guide isn't downloaded again; stations sharing a
//   guide have it read once a pass for all their channels, and a large one running dry is read at
//   most every 30 minutes. "Find this channel's guide" (lib/guideFinder.ts) looks a name up in
//   iptv-org's public lists for the guide files that can be read as they are.
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

import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { schema } from "@opencast/db";
import { CHANNEL_HOLD_AFTER_SIGN_OFF_MS, familyHeadTenths, formatChannelNumber, isSubchannel, parseChannelNumber, type Band, type ChannelNumber } from "@opencast/domain";
import { GUIDE_LIMITS, manualScheduleProblems, SHEET_FILE_MAX_BYTES, slotText, sortedSlots, WEEKDAYS, type Creator, type CreatorStage, type ExternalInfo, type ExternalOutage, type GuideOption, type GuideRead, type IptvChannel, type ListedChange, type ListedField, type ListedScheduleInput, type ListedSource, type SchedulePreview, type StreamPermission } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import type { StationProfile } from "../stations/service.js";
import type { CurrentUser } from "../../http.js";
import { badRequest, conflict, HttpError, notFound, refused } from "../../errors.js";
import { isIptvOrgAddress, parseIptvList } from "../../lib/iptv.js";
import { promises as fs } from "node:fs";
import { detectScheduleFormat, parseSchedule, type ChannelHints, type ScheduleFormat } from "../../lib/schedules.js";
import { GUIDE_CAPS, guideBody, GuideTooBig, LARGE_GUIDE_BYTES, scanGuide, XmltvScanner, type GuideLimit, type GuideWant } from "../../lib/guideStream.js";
import { channelIdOf, findGuides, guideLists, guideUrl, IPTV_ORG_CHANNELS, IPTV_ORG_GUIDES, jsonArrayItems, listChannel, listGuide, type GuideLists, type ListChannel, type ListGuide } from "../../lib/guideFinder.js";
import type { CalendarEvent } from "../../lib/ics.js";
import { manualAirings, manualWindow } from "../../lib/manualSchedule.js";
import { googleSheet, googleSheetCsvUrl, kindFromName, kindFromType, readSheet, SheetError, sheetFragment, type SheetTable } from "../../lib/sheetFiles.js";
import { readSheetSchedule, sheetAirings, type SheetSchedule } from "../../lib/sheetSchedule.js";
import type { UploadedFile } from "../../http.js";
import { clockTime } from "../../lib/time.js";
import { publicFetch } from "../../lib/publicFetch.js";
import { httpsVariant, isPlainHttp, relayUrl } from "../../lib/streamRelay.js";
import { ORIGIN_REFUSED_DETAIL, probeCors, type CorsCheck } from "../../lib/streamCors.js";
import { platformFeedOf } from "../../lib/platformFeeds.js";

/** A check that hasn't answered by then has failed. */
export const CHECK_TIMEOUT_MS = 5_000;
/** Down this long, a listing leaves the dial. */
export const DOWN_AFTER_MS = 5 * 60_000;
/** A playlist's first bytes are enough to know it's a playlist; nothing more is read. */
const MANIFEST_BYTES = 64 * 1024;
/** A237: how often an `http://` stream link that didn't answer over https is tried there again. */
export const HTTPS_RECHECK_MS = 60 * 60_000;
/** A238: how often the address a viewer's player loads straight from the source is checked for CORS. */
export const CORS_RECHECK_MS = 60 * 60_000;
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
/** How often a listing's schedule is read again. */
export const SCHEDULE_REREAD_MS = 60 * 60_000;
/**
 * 2026-10-03: sooner, while what's stored for a feed runs out within RUNNING_DRY_MS (a feed that
 * lists only what's on now goes stale when the show ends): it's read again this often until it
 * lists what's next.
 */
export const RUNNING_DRY_REREAD_MS = 2 * 60_000;
export const RUNNING_DRY_MS = 5 * 60_000;
/** A249: a large guide (gzipped, or over 5 MB as read) running dry is read again at most this often. */
export const LARGE_GUIDE_REREAD_MS = 30 * 60_000;
/** A249: iptv-org's lists ("Find this channel's guide") are read again after this. */
export const GUIDE_LISTS_MS = 24 * 60 * 60_000;

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
  /** A241: what's on in `updateListedSource`'s shape (a feed, guide data, by hand, or none), instead of the three above. */
  schedule?: ListedScheduleInput;
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
  /** A239: `sourceUrl`, a stream link's own address, for the native apps' direct mode. */
  playback: { kind: "hls" | "embed"; url: string; format?: "dash"; sourceUrl?: string } | null;
}

/** A248: what `previewListedSchedule` reads. */
export interface PreviewScheduleInput {
  calendarUrl?: string;
  calendarFormat?: ScheduleFormat;
  timeZone?: string;
  sheet?: string;
  marketId?: string;
  sourceId?: string;
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
  /** A241: or `{ source: "manual", slots, checkedAgainst, checkedOn, skipDates? }`, a schedule entered by hand. */
  schedule?: ListedScheduleInput;
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
   * Each minute (2026-10-03): the listings that are due read again (hourly, or every 2 minutes while
   * a feed's guide is about to run dry), and (A215) the channels of listings taken off the dial
   * 90 days ago freed; (A223) full stations' too, 90 days after they signed off for good.
   */
  syncExternalSchedules(options?: { fetch?: Fetch }): Promise<{ synced: number; failed: number; released?: number; releasedStations?: number }>;
  previewIptvList(input: { m3u?: string; url?: string }, fetchFn?: Fetch): Promise<{ listUrl: string | null; channels: Array<IptvChannel & { already: "lead" | "external" | null }>; skipped: number }>;
  /** A248: read a schedule address (or an uploaded spreadsheet) now, and say what it would give. Nothing is saved. */
  previewListedSchedule(input: PreviewScheduleInput, file: UploadedFile | null, fetchFn?: Fetch): Promise<SchedulePreview>;
  /** A249: "Find this channel's guide": the guide files iptv-org's lists give for a channel's name, each checked for the channel. */
  findListedGuides(input: { name: string; sourceId?: string; creatorId?: string }, fetchFn?: Fetch): Promise<{ channels: Array<{ id: string; name: string }>; guides: GuideOption[]; skipped: number }>;
  /** A248: a listing's schedule from an uploaded spreadsheet, kept as what was read from it. */
  uploadListedSchedule(user: CurrentUser | null, sourceId: string, input: { timeZone?: string; sheet?: string }, file: UploadedFile | null): Promise<ListedSource>;
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

type ManualSchedule = NonNullable<Row["manualSchedule"]>;
type SheetReadRow = NonNullable<Row["sheetRead"]>;
type GuideReadRow = NonNullable<Row["guideRead"]>;
type SheetFileRow = NonNullable<Row["sheetFile"]>;

/**
 * A241: a schedule entered by hand as it's kept: each slot's days once and in week order, the
 * title and description trimmed, the season or null; the skipped dates once, in order.
 */
export function normalManual(input: Extract<ListedScheduleInput, { source: "manual" }>): ManualSchedule {
  return {
    slots: input.slots.map((s) => ({
      days: WEEKDAYS.filter((d) => s.days.includes(d)),
      start: s.start,
      end: s.end,
      title: s.title.trim(),
      description: s.description?.trim() || null,
      from: s.from ?? null,
      until: s.until ?? null
    })),
    skipDates: [...new Set(input.skipDates ?? [])].sort()
  };
}

/** A241: the weekly schedule in the change history's words, descriptions too ("Mon–Fri 6:00–9:00 pm: City Council, “Regular meeting”"). */
export function manualHistoryText(m: ManualSchedule | null): string | null {
  if (!m?.slots.length) return null;
  return sortedSlots(m.slots)
    .map((s) => `${slotText(s)}${s.description ? `, “${s.description}”` : ""}`)
    .join("; ");
}

/** A241: the schedule's skipped dates for the history ("2026-11-26, 2026-12-24"), or null. */
const skipText = (m: ManualSchedule | null) => (m?.skipDates.length ? m.skipDates.join(", ") : null);

/**
 * A241: the columns that hold what's on, for a schedule as `addListedSource` and `updateListedSource`
 * take it. A248: and the listing's own time zone for it; `file` keeps the uploaded spreadsheet as it is.
 */
function scheduleColumns(sc: ListedScheduleInput) {
  const none = { calendarUrl: null, scheduleFormat: null, guideCheckedAgainst: null, guideCheckedOn: null, manualSchedule: null, scheduleTimeZone: null };
  if (sc.source === "none") return { ...none, scheduleSource: "none" as const };
  if (sc.source === "manual") return { ...none, scheduleSource: "manual" as const, guideCheckedAgainst: sc.checkedAgainst, guideCheckedOn: sc.checkedOn, manualSchedule: normalManual(sc) };
  if (sc.source === "file") return { ...none, scheduleSource: "file" as const, scheduleFormat: "sheet" as const, scheduleTimeZone: sc.timeZone ?? null };
  return {
    scheduleSource: sc.source,
    calendarUrl: sc.calendarUrl,
    scheduleFormat: sc.calendarFormat ?? null,
    guideCheckedAgainst: sc.source === "guide_data" ? sc.guideData.checkedAgainst : null,
    guideCheckedOn: sc.source === "guide_data" ? sc.guideData.checkedOn : null,
    manualSchedule: null,
    scheduleTimeZone: sc.timeZone ?? null
  };
}

// ---- A248 (2026-10-06): schedules from spreadsheets ----

/** Why a schedule address (or a spreadsheet) couldn't be read, with the desk's words. */
export class ScheduleReadError extends Error {
  constructor(
    readonly code: "calendar_not_found" | "not_public" | "not_a_spreadsheet" | "old_excel" | "no_tab" | "pick_channel" | "not_in_guide" | "too_big",
    message: string,
    /** A249: what was read of an XMLTV guide before it stopped (its channels, its size, the limit). */
    readonly guide: GuideReadRow | null = null
  ) {
    super(message);
    this.name = "ScheduleReadError";
  }
}

export const NOT_PUBLIC = "This Google Sheet isn't public. Publish it to the web (File, Share, Publish to web), or share it with anyone with the link, then try again.";
const NOT_ANSWERED = "That address didn't answer with a schedule. Check the link and try again.";
export const NO_SHOWS = "No shows with times were found in it. Each needs a title and a time (“Trigun 6:00 AM”) under a row of days, or columns like Date, Start and Title.";
const NOT_A_SHEET = "That isn't a spreadsheet Opencast can read: use .xlsx, .ods, .csv or .tsv.";

/**
 * What a schedule address gave: a feed's events (A249: with what was read of an XMLTV guide), a
 * spreadsheet's schedule, or (A249) "not changed since" the last read, so what's stored stays.
 */
type ScheduleAnswer =
  | { format: Exclude<ScheduleFormat, "sheet">; events: CalendarEvent[]; guide?: GuideReadRow }
  | { format: "sheet"; table: SheetTable; sheet: SheetSchedule; gid: string | null }
  | { format: "unchanged" };

// ---- A249 (2026-10-06): large and compressed XMLTV guides ----

/** A schedule address without its fragment: what's fetched (`#channel=` and `#sheet=` say how to read it). */
export const fetchedAddress = (url: string) => url.split("#")[0]!;

/** The channel an address's fragment names (`#channel=<id>`), or null. */
function channelFragment(url: string): string | null {
  const named = /#channel=([^&]+)/.exec(url)?.[1];
  if (!named) return null;
  try {
    return decodeURIComponent(named);
  } catch {
    return named;
  }
}

/** A guide's `ETag` and `Last-Modified` from its last read that worked, to ask "changed since?". */
export interface GuideValidators {
  etag: string | null;
  lastModified: string | null;
}

/**
 * 2026-10-03: one read per address in a schedule pass. A249: by the address fetched (its fragment
 * left off), for every listing on it: a guide is read once, in one streamed pass that keeps each
 * listing's channel (`wants`), asking "changed since?" only when every one of them last read the
 * same version of it (`validators`).
 */
export interface SharedReads {
  wants: Map<string, GuideWant[]>;
  validators: Map<string, GuideValidators | null>;
  answers: Map<string, Promise<AddressRead>>;
}

/** What one address answered, before each listing reads it its own way. */
type AddressRead =
  | { kind: "unchanged" }
  | { kind: "bytes"; type: string | null; bytes: Uint8Array }
  | { kind: "guide"; wants: GuideWant[]; results: Awaited<ReturnType<typeof scanGuide>>; info: Omit<GuideReadRow, "channel" | "channelName" | "programmes"> };

const wantKey = (w: GuideWant) => JSON.stringify([w.fragment, w.hints.name ?? null, w.hints.streamUrl ?? null]);

/** A guide's limits, in the desk's words (and the API's refusals). */
const MB = (n: number) => `${Math.round(n / 1_000_000)} MB`;
export const GUIDE_LIMIT_WORDS: Record<GuideLimit, string> = {
  compressed: `This guide is over ${MB(GUIDE_LIMITS.compressedBytes)} as it downloads, Opencast's limit, so it wasn't read. What it listed before stays.`,
  bytes: `This guide is over ${MB(GUIDE_LIMITS.bytes)} unzipped, Opencast's limit, so it wasn't read. What it listed before stays.`,
  programmes: `This guide lists over ${GUIDE_LIMITS.programmes.toLocaleString("en-US")} airings to come for the channel, Opencast's limit, so it wasn't read. What it listed before stays.`,
  time: `This guide took over ${GUIDE_LIMITS.seconds} seconds to read, Opencast's limit, so it wasn't read. What it listed before stays.`
};

/** "This guide has 406 channels. Pick one: …" */
export const pickChannelWords = (channels: number) =>
  `This guide has ${channels.toLocaleString("en-US")} channels. Pick one: add #channel= and its id to the address (Find this channel's guide does it), so no other channel's shows are listed.`;

/** "Channel 6793eaa4… isn't in this guide right now." */
export const notInGuideWords = (channel: string, channels: number) =>
  `Channel ${channel} isn't in this guide right now (it lists ${channels.toLocaleString("en-US")} ${channels === 1 ? "channel" : "channels"}). Find this channel's guide again, or check the address.`;

/** Whether a listing may ask its guide "changed since?": its last read worked, of this same address. */
function validatorsOf(row: Pick<Row, "calendarUrl" | "calendarSync" | "guideRead">): GuideValidators | null {
  const g = row.guideRead;
  if (!g || !row.calendarUrl || row.calendarSync !== "synced" || g.limit || g.url !== fetchedAddress(row.calendarUrl) || (!g.etag && !g.lastModified)) return null;
  return { etag: g.etag, lastModified: g.lastModified };
}

/** One address read: "not changed", a guide scanned for every want on it, or (anything else) its first 5 MB. */
async function readAddress(address: string, url: string, declared: ScheduleFormat | null, fetchFn: Fetch, google: boolean, wants: GuideWant[], validators: GuideValidators | null, now: Date): Promise<AddressRead> {
  const control = new AbortController();
  // 15 seconds for a feed, as before; a guide gets its own limit once it's known to be one.
  let timer = setTimeout(() => control.abort(), 15_000);
  try {
    const headers: Record<string, string> = {};
    if (validators?.etag) headers["if-none-match"] = validators.etag;
    if (validators?.lastModified) headers["if-modified-since"] = validators.lastModified;
    let response: Response;
    try {
      response = await fetchFn(address, { signal: control.signal, ...(Object.keys(headers).length ? { headers } : {}) });
    } catch {
      throw new ScheduleReadError("calendar_not_found", NOT_ANSWERED);
    }
    if (response.status === 304 && validators) {
      await response.body?.cancel().catch(() => undefined);
      return { kind: "unchanged" };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (google && [401, 403, 404].includes(response.status)) throw new ScheduleReadError("not_public", NOT_PUBLIC);
      throw new ScheduleReadError("calendar_not_found", NOT_ANSWERED);
    }
    const deadline = Date.now() + GUIDE_CAPS.ms;
    let body: Awaited<ReturnType<typeof guideBody>> | null = null;
    const info = () => ({
      url: address,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      gzip: body?.gzip ?? false,
      compressedBytes: body?.counts.compressed ?? 0,
      bytes: body?.counts.bytes ?? 0,
      large: !!body && (body.gzip || body.counts.bytes > LARGE_GUIDE_BYTES),
      readAt: now.toISOString(),
      unchangedAt: null,
      limit: null
    });
    /** A read past a limit, with what was read of it. */
    const failed = (e: unknown) =>
      e instanceof GuideTooBig
        ? new ScheduleReadError("too_big", GUIDE_LIMIT_WORDS[e.limit], { ...info(), etag: null, lastModified: null, channels: 0, channel: null, channelName: null, programmes: 0, large: true, limit: e.limit })
        : new ScheduleReadError("calendar_not_found", NOT_ANSWERED);
    const head: Uint8Array[] = [];
    let headSize = 0;
    try {
      body = await guideBody(response.body, GUIDE_CAPS, deadline, control.signal);
      // Enough of the start to know what it is (gzipped: unzipped first).
      while (headSize < 8192) {
        const next = await body.chunks.next();
        if (next.done) break;
        head.push(next.value);
        headSize += next.value.byteLength;
      }
    } catch (e) {
      await body?.chunks.return(undefined).catch(() => undefined);
      throw failed(e);
    }
    const first = joinBytes(head, headSize);
    const type = response.headers.get("content-type");
    const format = google ? "sheet" : (declared ?? detectScheduleFormat(url, type, new TextDecoder().decode(first)));
    if (format !== "xmltv") {
      // Anything but a guide: its first 5 MB, as before.
      const bytes = [first];
      let size = first.byteLength;
      const rest = body.chunks;
      try {
        while (size < LIST_BYTES) {
          const next = await rest.next();
          if (next.done) break;
          bytes.push(next.value);
          size += next.value.byteLength;
        }
      } catch (e) {
        if (!(e instanceof GuideTooBig)) throw new ScheduleReadError("calendar_not_found", NOT_ANSWERED);
      } finally {
        await rest.return(undefined).catch(() => undefined);
      }
      return { kind: "bytes", type, bytes: joinBytes(bytes, size).slice(0, LIST_BYTES) };
    }
    clearTimeout(timer);
    timer = setTimeout(() => control.abort(), Math.max(0, deadline - Date.now()));
    const scanner = new XmltvScanner(wants, { since: now });
    try {
      const results = await scanGuide(body, scanner, first);
      return { kind: "guide", wants, results, info: { ...info(), channels: results.channels.length } };
    } catch (e) {
      throw failed(e);
    }
  } finally {
    clearTimeout(timer);
  }
}

function joinBytes(parts: Uint8Array[], size: number): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return all;
}

/** A249: one pass's shared reads, for the listings due in it: by address, each one's want, and validators all of them agree on. */
function sharedReadsFor(rows: Row[]): SharedReads {
  const shared: SharedReads = { wants: new Map(), validators: new Map(), answers: new Map() };
  const byAddress = new Map<string, Row[]>();
  for (const row of rows) {
    if (!row.calendarUrl || ownSchedule(row)) continue;
    const google = row.scheduleFormat === null || row.scheduleFormat === "sheet" ? googleSheet(row.calendarUrl) : null;
    const address = google ? googleSheetCsvUrl(row.calendarUrl)! : fetchedAddress(row.calendarUrl);
    byAddress.set(address, [...(byAddress.get(address) ?? []), row]);
  }
  for (const [address, on] of byAddress) {
    const wants = new Map<string, GuideWant>();
    for (const row of on) {
      const want = { fragment: channelFragment(row.calendarUrl!), hints: { name: row.name, streamUrl: row.streamUrl } };
      wants.set(wantKey(want), want);
    }
    shared.wants.set(address, [...wants.values()]);
    const all = on.map(validatorsOf);
    const same = all.every((v) => v && v.etag === all[0]!.etag && v.lastModified === all[0]!.lastModified);
    shared.validators.set(address, same ? all[0]! : null);
  }
  return shared;
}

/** The zone a sheet's times are read in: the listing's own setting, else the one the sheet names, else the market's. */
export function sheetZone(listing: string | null | undefined, named: string | null | undefined, market: string): { tz: string; from: SheetReadRow["timeZoneFrom"] } {
  if (listing) return { tz: listing, from: "listing" };
  if (named) return { tz: named, from: "sheet" };
  return { tz: market, from: "market" };
}

/** What was read, as it's kept (and shown on the desk). */
function sheetReadRow(table: Pick<SheetTable, "kind" | "tab" | "tabs">, sheet: SheetSchedule, gid: string | null, zone: ReturnType<typeof sheetZone>, now: Date): SheetReadRow {
  return {
    kind: table.kind,
    tab: table.tab,
    gid,
    tabs: table.tabs,
    layout: sheet.layout,
    shows: sheet.entries.length,
    weekly: sheet.weekly,
    firstDay: sheet.firstDay,
    lastDay: sheet.lastDay,
    firstDate: sheet.firstDate,
    lastDate: sheet.lastDate,
    zone: sheet.zone,
    zonesNamed: sheet.zonesNamed.length > 1 ? sheet.zonesNamed : [],
    timeZone: zone.tz,
    timeZoneFrom: zone.from,
    skipped: sheet.skipped,
    skippedCount: sheet.skippedCount,
    readAt: now.toISOString()
  };
}

/** A sheet that couldn't be read, in the desk's words: a Google Sheet answering with a web page isn't public. */
function sheetProblem(e: SheetError, google: boolean): ScheduleReadError {
  if (e.code === "web_page") return google ? new ScheduleReadError("not_public", NOT_PUBLIC) : new ScheduleReadError("not_a_spreadsheet", "That address answered with a web page, not a spreadsheet.");
  return new ScheduleReadError(e.code, e.message);
}

/**
 * A schedule address read now: a feed's events, or (A248) a spreadsheet's schedule. A Google Sheet is
 * fetched as its CSV export (its tab kept); one that answers "not found" or with a sign-in page isn't
 * public. `timeZone`: for a webpage's times without an offset. A249: an XMLTV guide is read as it
 * downloads (gzipped or not) for the listing's channel only; `validators` ask it "changed since?"
 * (an answer of "not changed" is `unchanged`), and `shared` reads an address once for a pass's listings.
 */
export async function readScheduleAt(
  url: string,
  declared: ScheduleFormat | null,
  fetchFn: Fetch,
  hints: ChannelHints,
  timeZone: string,
  now: Date,
  options: { validators?: GuideValidators | null; shared?: SharedReads } = {}
): Promise<ScheduleAnswer> {
  const google = declared === null || declared === "sheet" ? googleSheet(url) : null;
  const address = google ? googleSheetCsvUrl(url)! : fetchedAddress(url);
  const want: GuideWant = { fragment: channelFragment(url), hints };
  const shared = options.shared;
  let pending = shared?.answers.get(address);
  if (!pending) {
    const wants = shared?.wants.get(address) ?? [];
    const all = wants.some((w) => wantKey(w) === wantKey(want)) ? wants : [...wants, want];
    pending = readAddress(address, url, declared, fetchFn, !!google, all, shared ? (shared.validators.get(address) ?? null) : (options.validators ?? null), now);
    shared?.answers.set(address, pending);
  }
  const read = await pending;
  if (read.kind === "unchanged") return { format: "unchanged" };
  if (read.kind === "guide") {
    const i = read.wants.findIndex((w) => wantKey(w) === wantKey(want));
    // A listing the pass didn't expect on this address: read on its own.
    if (i < 0) return readScheduleAt(url, declared, fetchFn, hints, timeZone, now, { validators: null });
    const got = read.results.wants[i]!;
    const channels = read.results.channels.length;
    const guide: GuideReadRow = { ...read.info, channel: got.channel, channelName: got.channelName, programmes: got.events.length };
    if (got.problem === "pick_channel") throw new ScheduleReadError("pick_channel", pickChannelWords(channels), { ...guide, etag: null, lastModified: null });
    if (got.problem === "not_in_guide") throw new ScheduleReadError("not_in_guide", notInGuideWords(want.fragment ?? "", channels), { ...guide, etag: null, lastModified: null });
    return { format: "xmltv", events: got.events, guide };
  }
  const { bytes, type } = read;
  const text = () => new TextDecoder().decode(bytes);
  const format = google ? "sheet" : (declared ?? detectScheduleFormat(url, type, text()));
  if (format !== "sheet") return { format, events: parseSchedule(text(), format, url, timeZone, hints) };
  let table: SheetTable;
  try {
    const path = (() => {
      try {
        return new URL(url).pathname;
      } catch {
        return url;
      }
    })();
    table = readSheet(bytes, { kind: google ? "google_sheet" : (kindFromName(path) ?? kindFromType(type)), tab: sheetFragment(url) });
  } catch (e) {
    if (e instanceof SheetError) throw sheetProblem(e, !!google);
    throw e;
  }
  return { format: "sheet", table, sheet: readSheetSchedule(table.rows, table.continues, now), gid: google?.gid ?? null };
}

/** A249: what was read from a guide, as the desk sees it (the validators and address left out). */
const guideView = (g: GuideReadRow): GuideRead => ({
  channel: g.channel,
  channelName: g.channelName,
  channels: g.channels,
  programmes: g.programmes,
  compressedBytes: g.compressedBytes,
  bytes: g.bytes,
  gzip: g.gzip,
  large: g.large,
  readAt: g.readAt,
  unchangedAt: g.unchangedAt,
  limit: g.limit
});

/** An uploaded spreadsheet's bytes, checked: its size, and a spreadsheet's name or type. */
async function sheetFileBytes(file: UploadedFile): Promise<{ bytes: Uint8Array; kind: ReturnType<typeof kindFromName> }> {
  if (file.size > SHEET_FILE_MAX_BYTES) throw refused("too_big", "Use a file of 2 MB or less.");
  const kind = kindFromName(file.originalName) ?? kindFromType(file.mimeType);
  if (!kind) throw refused("not_a_spreadsheet", NOT_A_SHEET);
  if (kind === "xls") throw refused("old_excel", "Older Excel files (.xls) aren't read. Save it as .xlsx or .csv and upload that.");
  return { bytes: new Uint8Array(await fs.readFile(file.path)), kind };
}

/** A sheet read from a file, or the API's refusal: what it couldn't read, or that it found no shows. */
function readSheetFile(bytes: Uint8Array, kind: ReturnType<typeof kindFromName>, tab: string | null, now: Date): { table: SheetTable; sheet: SheetSchedule } {
  let table: SheetTable;
  try {
    table = readSheet(bytes, { kind, tab });
  } catch (e) {
    if (e instanceof SheetError) {
      const p = sheetProblem(e, false);
      throw refused(p.code, p.message);
    }
    throw e;
  }
  const sheet = readSheetSchedule(table.rows, table.continues, now);
  if (!sheet.entries.length) throw refused("no_event_data", NO_SHOWS);
  return { table, sheet };
}

/** One airing in a preview. */
const previewAiring = (e: CalendarEvent) => ({ title: e.summary, startsAt: e.start.toISOString(), endsAt: e.end?.toISOString() ?? null });

/** An uploaded spreadsheet in the change history's words: "week.xlsx, 152 shows". */
const fileText = (f: SheetFileRow | null | undefined) => (f ? `${f.name}, ${f.entries.length} ${f.entries.length === 1 ? "show" : "shows"}` : null);

/**
 * A241: a schedule entered by hand, checked before it's saved: where it was checked (the published
 * schedule's address and the day, as Phase 6 needs for guide data), then the slots (days, 5-minute
 * times, a title, no two on at once). 400 with the first problem's words, every problem by field.
 */
export function checkManual(sc: ListedScheduleInput | undefined) {
  if (sc?.source !== "manual") return;
  if (!sc.checkedAgainst?.trim()) throw badRequest("Say where you checked it: the address of their published schedule.", { checkedAgainst: "Required" });
  if (!sc.checkedOn?.trim()) throw badRequest("Say when you checked it against their published schedule.", { checkedOn: "Required" });
  const problems = manualScheduleProblems(sc.slots);
  if (problems.length) throw badRequest(problems[0]!.message, Object.fromEntries(problems.map((p) => [p.slot === null ? "slots" : `slots.${p.slot}.${p.field}`, p.message])));
}

/** A241, A248: a schedule kept here (entered by hand, or an uploaded spreadsheet), made into airings without a fetch. */
const ownSchedule = (r: Pick<Row, "scheduleSource">) => r.scheduleSource === "manual" || r.scheduleSource === "file";

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
  row: Pick<Row, "plays" | "embedTerms" | "basis" | "streamFormat" | "outsideMarket" | "health"> & { streamUrl?: string; httpsUrl?: string | null; cors?: Row["cors"]; platformFeed?: string | null },
  rules: { otherMarkets: boolean; dash: boolean; relay?: boolean }
): Waiting | null {
  // A238: another app's access is never played or relayed, whatever its evidence or CORS.
  if (row.platformFeed) return "platform_feed";
  if (row.plays === "embed") {
    if (row.embedTerms !== "allowed") return "terms_unclear";
    if (row.basis !== "embed_terms") return "needs_terms";
  } else {
    if (row.basis !== "written_permission" && row.basis !== "public_source") return "needs_permission";
    if (row.streamFormat === "dash" && !rules.dash) return "dash_not_played";
    // A237: plain http plays over https from the source, or through the relay; with neither, it waits.
    if (playsOverFor(row, !!rules.relay) === "needs_https") return "needs_https";
    // A238: a server browsers can't load from plays through the relay; with none, it waits.
    if (corsBlocked(row) && !rules.relay) return "browsers_blocked";
  }
  if (row.outsideMarket && !rules.otherMarkets) return "other_market";
  if (row.health === "hidden") return "down";
  return null;
}

/**
 * A237: how an `http://` stream link reaches HTTPS apps: over https from the source (it answered
 * there), through the relay, or neither (it waits). Null for anything else, which plays as listed.
 */
export function playsOverFor(row: { plays: Row["plays"]; streamUrl?: string; httpsUrl?: string | null; cors?: Row["cors"]; platformFeed?: string | null }, relay: boolean): ListedSource["playsOver"] {
  if (row.plays !== "stream_link" || !row.streamUrl || row.platformFeed) return null;
  if (isPlainHttp(row.streamUrl) && !row.httpsUrl) return relay ? "relay" : "needs_https";
  // A238: a server browsers can't load from, through the relay (or nothing: it waits, browsers_blocked).
  if (corsBlocked(row)) return relay ? "relay" : null;
  return row.httpsUrl ? "https" : null;
}

/** A238: why it's relayed, while it is: its address is http (A237), or its server blocks browsers (CORS). */
export function relayReasonFor(row: Parameters<typeof playsOverFor>[0], relay: boolean): ListedSource["relayReason"] {
  if (playsOverFor(row, relay) !== "relay") return null;
  return row.streamUrl && isPlainHttp(row.streamUrl) && !row.httpsUrl ? "http" : "cors";
}

/**
 * A238: the address a viewer's player would load straight from the source: an https stream link's
 * own, or an http one's https address. Null for an http link that didn't answer over https (only the
 * relay can carry it), an embed, and anything that isn't http(s).
 */
export function directAddressOf(row: { plays: Row["plays"]; streamUrl?: string; httpsUrl?: string | null }): string | null {
  if (row.plays !== "stream_link" || !row.streamUrl) return null;
  if (isPlainHttp(row.streamUrl)) return row.httpsUrl ?? null;
  return /^https:\/\//i.test(row.streamUrl.trim()) ? row.streamUrl : null;
}

/** A238: its direct address's server sends no CORS header for Opencast's apps (at the last check). */
function corsBlocked(row: { plays: Row["plays"]; streamUrl?: string; httpsUrl?: string | null; cors?: Row["cors"] }): boolean {
  return row.cors === "blocked" && directAddressOf(row) !== null;
}

/** Up to `limit` bytes of an answer's body as text, then the rest is let go unread. */
async function readSome(res: Response, limit: number): Promise<string> {
  return new TextDecoder().decode(await readBytes(res, limit));
}

/** Up to `limit` bytes of an answer's body, then the rest is let go unread. */
async function readBytes(res: Response, limit: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
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
  return all;
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
   * A238: the address a viewer's player loads straight from the source, checked for CORS now (with
   * the web app's origin), and what was found kept. `keepKnown` (the hourly check): a check that
   * couldn't tell (`unknown`) leaves an earlier `ok` or `blocked` as it was, so a slow answer doesn't
   * flip how it plays.
   */
  async function recordCors(row: Pick<Row, "id" | "cors">, address: string, fetchFn: Fetch = externalFetch(), keepKnown = false): Promise<CorsCheck> {
    const found = await probeCors(address, deps.config.appOrigin, fetchFn);
    const keep = keepKnown && found.state === "unknown" && (row.cors === "ok" || row.cors === "blocked");
    await db
      .update(LS)
      .set(keep ? { corsCheckedAt: deps.clock.now() } : { cors: found.state, corsDetail: found.detail, corsCheckedAt: deps.clock.now() })
      .where(eq(LS.id, row.id));
    return found;
  }

  /** A237 and A238 at listing and on a change: https tried for an http link, then CORS where the player would fetch straight from the source. */
  async function probeNew(sourceId: string) {
    const [row] = await db.select().from(LS).where(eq(LS.id, sourceId));
    if (!row || row.plays !== "stream_link" || row.platformFeed) return;
    const httpsUrl = isPlainHttp(row.streamUrl) ? await recordHttps(sourceId, row.streamUrl) : null;
    const direct = directAddressOf({ ...row, httpsUrl });
    if (direct) await recordCors(row, direct);
  }

  /**
   * What a viewer's player loads for a stream link on the dial: its address as listed, or (A237) for
   * `http://`, the https address that answered, else the relay's address for it.
   */
  function streamAddress(r: Row): string | null {
    if (r.plays !== "stream_link") return r.streamUrl;
    // A238: another app's access is never played, let alone relayed.
    if (r.platformFeed) return null;
    const relay = deps.config.streamRelay;
    const format = (r.streamFormat ?? streamFormatOf(r.streamUrl)) === "dash" ? "dash" : "hls";
    if (isPlainHttp(r.streamUrl) && !r.httpsUrl) return relay ? relayUrl(relay, r.streamUrl, format) : null;
    const direct = directAddressOf(r) ?? r.streamUrl;
    // A238: a server browsers can't load from, through the relay with every address relayed (/v2/).
    if (corsBlocked(r)) return relay ? relayUrl(relay, direct, format, "all") : null;
    return direct;
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
    const names = await services.accounts.displayNames([...permissions.map((p) => p.recordedBy), ...rows.map((r) => r.removedBy), ...rows.map((r) => r.sheetFile?.uploadedBy)].filter((v): v is string => !!v));
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
        // A238: why it's relayed; whether browsers can load it straight from the source; another app's access.
        relayReason: relayReasonFor(r, rule.relay),
        cors: r.plays === "stream_link" && r.cors && directAddressOf(r) ? { state: r.cors, detail: r.corsDetail, checkedAt: r.corsCheckedAt?.toISOString() ?? null } : null,
        platformFeed: r.platformFeed,
        // A239: its server refuses web pages but answers the native apps (the CORS check found it).
        nativeOnly: r.plays === "stream_link" && !r.platformFeed && r.cors === "unknown" && r.corsDetail === ORIGIN_REFUSED_DETAIL && directAddressOf(r) !== null,
        evidence: { basis: r.basis, termsUrl: r.termsUrl, termsCheckedOn: r.termsCheckedOn, publicBasis: r.publicBasis, permission, note: r.waitingNote },
        schedule: {
          source: r.scheduleSource,
          format: r.scheduleFormat,
          url: r.calendarUrl,
          checkedAgainst: r.guideCheckedAgainst,
          checkedOn: r.guideCheckedOn,
          // A241: the weekly schedule entered by hand, and the dates it doesn't air.
          ...(r.scheduleSource === "manual" ? { slots: r.manualSchedule?.slots ?? [], skipDates: r.manualSchedule?.skipDates ?? [] } : {}),
          // A248: the listing's own time zone for it, what was read from its spreadsheet, and the file uploaded.
          timeZone: r.scheduleTimeZone,
          sheet: r.sheetRead && (r.scheduleFormat === "sheet" || r.scheduleSource === "file") ? r.sheetRead : null,
          file:
            r.scheduleSource === "file" && r.sheetFile
              ? { name: r.sheetFile.name, kind: r.sheetFile.kind, bytes: r.sheetFile.bytes, uploadedAt: r.sheetFile.uploadedAt, uploadedBy: r.sheetFile.uploadedBy ? (names.get(r.sheetFile.uploadedBy) ?? null) : null }
              : null,
          // A249: what was read from its XMLTV guide.
          guide: r.guideRead && r.scheduleFormat === "xmltv" && r.scheduleSource !== "file" && r.scheduleSource !== "manual" ? guideView(r.guideRead) : null
        },
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

  /**
   * A dial row's playback: the source's embed or stream link (A237: an http:// one's https or relay
   * address). A239: a stream link also carries `sourceUrl`, the source's own address (an http one's
   * https address when it answered there), which the native apps fetch directly before `url`.
   */
  function playbackOf(r: Row): ExternalDial["playback"] {
    const url = streamAddress(r);
    if (url === null) return null;
    if (r.plays !== "stream_link") return { kind: "embed", url };
    const dash = (r.streamFormat ?? streamFormatOf(r.streamUrl)) === "dash";
    return { kind: "hls", url, ...(dash ? { format: "dash" as const } : {}), sourceUrl: directAddressOf(r) ?? r.streamUrl };
  }

  /**
   * One listing's minute check, fetching the source directly (never through the relay). A237: an
   * http:// link upgraded to https is checked there, and the upgrade is dropped when https stops
   * answering while http still does; one that isn't upgraded is tried over https again hourly.
   * Returns the check and the https address it has afterwards.
   */
  async function checkSource(row: Row, fetchFn: Fetch): Promise<{ check: StreamCheck; httpsUrl: string | null }> {
    const httpsUrl = row.httpsUrl;
    if (row.plays !== "stream_link" || !isPlainHttp(row.streamUrl)) return { check: await checkStream({ plays: row.plays, streamUrl: row.streamUrl }, fetchFn), httpsUrl };
    if (row.httpsUrl) {
      const check = await checkStream({ plays: row.plays, streamUrl: row.httpsUrl }, fetchFn);
      if (check.ok) return { check, httpsUrl };
      const plain = await checkStream({ plays: row.plays, streamUrl: row.streamUrl }, fetchFn);
      if (!plain.ok) return { check, httpsUrl };
      await db.update(LS).set({ httpsUrl: null, httpsCheckedAt: deps.clock.now() }).where(eq(LS.id, row.id));
      return { check: plain, httpsUrl: null };
    }
    const check = await checkStream({ plays: row.plays, streamUrl: row.streamUrl }, fetchFn);
    if (row.httpsCheckedAt && deps.clock.now().getTime() - row.httpsCheckedAt.getTime() < HTTPS_RECHECK_MS) return { check, httpsUrl };
    const found = await recordHttps(row.id, row.streamUrl, fetchFn);
    // It plays over https now, so https answering is what counts.
    return { check: found && !check.ok ? { ok: true, detail: null } : check, httpsUrl: found };
  }

  /**
   * The minute's check (checkSource), then A238's CORS check of the address a viewer's player would
   * load straight from the source: hourly, or at once when that address changed (an http link's https
   * upgrade found or dropped), and only while the source answers. With no such address (an http link
   * relayed), nothing is kept.
   */
  async function checkOne(row: Row, fetchFn: Fetch): Promise<StreamCheck> {
    const { check, httpsUrl } = await checkSource(row, fetchFn);
    if (row.plays !== "stream_link") return check;
    const direct = directAddressOf({ ...row, httpsUrl });
    const moved = direct !== directAddressOf(row);
    if (!direct || (moved && !check.ok)) {
      // What was found was about another address: checked afresh once there's one that answers.
      if (row.cors !== null || row.corsCheckedAt !== null) await db.update(LS).set({ cors: null, corsDetail: null, corsCheckedAt: null }).where(eq(LS.id, row.id));
      return check;
    }
    const due = moved || !row.corsCheckedAt || deps.clock.now().getTime() - row.corsCheckedAt.getTime() >= CORS_RECHECK_MS;
    if (due && check.ok) await recordCors(moved ? { ...row, cors: null } : row, direct, fetchFn, !moved);
    return check;
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

  /**
   * 2026-10-03: a listing's airings in `scope` (those not over yet) made into `events`, keeping ids
   * (viewers' reminders point at them): an airing at the same start with the same external id (when
   * both have one), else the same title, is updated in place; new ones are added; the rest go, their
   * reminders moved to the same show read in at another time within a day, else deleted (the show
   * is gone from the source's schedule). Reminders are the only thing that points at an airing.
   */
  async function replaceAirings(tx: Executor, sourceId: string, scope: SQL | undefined, events: CalendarEvent[]) {
    const old = await tx.select().from(LA).where(and(eq(LA.listedSourceId, sourceId), scope));
    const same = (a: { externalId: string | null; title: string }, e: CalendarEvent) => (a.externalId && e.uid ? a.externalId === e.uid : a.title === e.summary);
    const used = new Set<string>();
    const kept: Array<{ id: string; title: string; externalId: string | null; startsAt: Date }> = [];
    const fresh: CalendarEvent[] = [];
    for (const e of events) {
      const match = old.find((a) => !used.has(a.id) && a.startsAt.getTime() === e.start.getTime() && same(a, e));
      if (!match) {
        fresh.push(e);
        continue;
      }
      used.add(match.id);
      kept.push({ id: match.id, title: e.summary, externalId: e.uid, startsAt: e.start });
      if (match.title !== e.summary || match.endsAt?.getTime() !== e.end?.getTime() || match.externalId !== e.uid) {
        await tx.update(LA).set({ title: e.summary, endsAt: e.end, externalId: e.uid }).where(eq(LA.id, match.id));
      }
    }
    const added = fresh.length
      ? await tx
          .insert(LA)
          .values(fresh.map((e) => ({ listedSourceId: sourceId, title: e.summary, startsAt: e.start, endsAt: e.end, externalId: e.uid })))
          .returning({ id: LA.id, title: LA.title, externalId: LA.externalId, startsAt: LA.startsAt })
      : [];
    const gone = old.filter((a) => !used.has(a.id));
    if (!gone.length) return;
    const now = [...kept, ...added];
    const moves = gone.map((a) => {
      const to = now
        .filter((n) => (a.externalId && n.externalId ? a.externalId === n.externalId : a.title === n.title) && Math.abs(n.startsAt.getTime() - a.startsAt.getTime()) <= 86_400_000)
        .sort((x, y) => Math.abs(x.startsAt.getTime() - a.startsAt.getTime()) - Math.abs(y.startsAt.getTime() - a.startsAt.getTime()))[0];
      return { from: a.id, to: to?.id ?? null };
    });
    await services.accounts.moveListedReminders(tx, moves);
    await tx.delete(LA).where(inArray(LA.id, gone.map((a) => a.id)));
  }

  /**
   * A241: a schedule entered by hand, made into airings from now to 14 days ahead (the airings from
   * now on replaced, as a feed's are). The one on air now keeps its title as it was; when nothing
   * is, the slot on now is added, so the banner has it at once.
   */
  async function syncManual(row: Row): Promise<boolean> {
    const tz = await services.stations.timezoneOf(row.stationId);
    const now = deps.clock.now();
    const { from, to } = manualWindow(now);
    const airings = row.manualSchedule ? manualAirings(row.manualSchedule, tz, from, to) : [];
    await db.transaction(async (tx) => {
      const earlier = await tx
        .select({ startsAt: LA.startsAt, endsAt: LA.endsAt })
        .from(LA)
        .where(and(eq(LA.listedSourceId, row.id), lt(LA.startsAt, now), gte(LA.startsAt, new Date(now.getTime() - 86_400_000))));
      const onNow = earlier.some((a) => (a.endsAt ?? new Date(a.startsAt.getTime() + 3_600_000)) > now);
      const rows = airings.filter((a) => a.start >= now || !onNow);
      // 2026-10-03: ids kept, and reminders with them (replaceAirings).
      await replaceAirings(tx, row.id, gte(LA.startsAt, now), rows);
      await tx.update(LS).set({ calendarSync: "synced", lastSyncedAt: now }).where(eq(LS.id, row.id));
    });
    return true;
  }

  /**
   * 2026-10-03: when each listing's schedule was last tried in this process, read or not, so a
   * feed that fails isn't tried every pass (lastSyncedAt is only set by a read that worked).
   */
  const lastTried = new Map<string, number>();

  /** A249: iptv-org's lists, as kept for "Find this channel's guide": read at most once a day. */
  let lists: { at: number; lists: GuideLists } | null = null;
  let listsReading: Promise<GuideLists> | null = null;

  /** One of iptv-org's JSON lists, its items as they download (25 MB for its guides; never one parse). */
  async function* listItems(url: string, fetchFn: Fetch): AsyncGenerator<unknown> {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`HTTP ${res.status}`);
    }
    const body = await guideBody(res.body, { compressedBytes: 80_000_000, bytes: 80_000_000, programmes: 0, ms: 60_000 });
    const decoder = new TextDecoder();
    async function* text() {
      for await (const chunk of body.chunks) yield decoder.decode(chunk, { stream: true });
    }
    yield* jsonArrayItems(text());
  }

  async function guideListsNow(fetchFn: Fetch): Promise<GuideLists> {
    if (lists && deps.clock.now().getTime() - lists.at < GUIDE_LISTS_MS) return lists.lists;
    listsReading ??= (async () => {
      try {
        const channels: ListChannel[] = [];
        for await (const v of listItems(IPTV_ORG_CHANNELS, fetchFn)) {
          const c = listChannel(v);
          if (c) channels.push(c);
        }
        const guides: ListGuide[] = [];
        for await (const v of listItems(IPTV_ORG_GUIDES, fetchFn)) {
          const g = listGuide(v);
          if (g) guides.push(g);
        }
        if (!channels.length || !guides.length) throw new Error("Empty lists");
        const read = guideLists(channels, guides);
        lists = { at: deps.clock.now().getTime(), lists: read };
        return read;
      } finally {
        listsReading = null;
      }
    })();
    try {
      return await listsReading;
    } catch {
      // The day-old lists, when there are some, rather than nothing.
      if (lists) return lists.lists;
      throw new HttpError(502, "lists_unavailable", "iptv-org's lists couldn't be read just now. Try again in a minute.");
    }
  }

  /**
   * A249: which of a guide file's channels are there now: its channel list is read (it comes before
   * the airings) and the rest let go. Null when the file couldn't be read.
   */
  async function guideChannels(file: string, fetchFn: Fetch): Promise<Array<{ id: string; names: string[] }> | null> {
    try {
      const res = await fetchFn(file, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      const body = await guideBody(res.body, { ...GUIDE_CAPS, ms: 20_000 });
      const scan = await scanGuide(body, new XmltvScanner([], { channelsOnly: true }));
      return scan.channels;
    } catch {
      return null;
    }
  }

  async function sync(row: Row, fetchFn: Fetch, shared?: SharedReads): Promise<boolean> {
    lastTried.set(row.id, deps.clock.now().getTime());
    if (row.scheduleSource === "manual") return syncManual(row);
    if (row.scheduleSource === "file") return syncFile(row);
    if (!row.calendarUrl) return false;
    const market = await services.stations.timezoneOf(row.stationId);
    let answer: ScheduleAnswer;
    try {
      // A241: a webpage's event data without an offset is in the market's time zone (A248: or the
      // listing's own). 2026-10-03: a feed keyed by channel is read for this listing's, found by its
      // name or stream. A248: a spreadsheet's rows are read for its schedule. A249: a guide is asked
      // "changed since?" when its last read worked, and read as it downloads.
      answer = await readScheduleAt(row.calendarUrl, row.scheduleFormat, fetchFn, { name: row.name, streamUrl: row.streamUrl }, row.scheduleTimeZone ?? market, deps.clock.now(), {
        validators: validatorsOf(row),
        shared
      });
    } catch (e) {
      // A248: a Google Sheet that isn't public says so; A249: a guide with no channel picked, without
      // the one named, or past a limit, too (with what was read of it); anything else that can't be
      // read isn't found. What was stored stays.
      const code = e instanceof ScheduleReadError && ["not_public", "pick_channel", "not_in_guide", "too_big"].includes(e.code) ? (e.code as "not_public" | "pick_channel" | "not_in_guide" | "too_big") : "calendar_not_found";
      const guide = e instanceof ScheduleReadError && e.guide ? { guideRead: e.guide, scheduleFormat: "xmltv" as const, sheetRead: null } : {};
      await db
        .update(LS)
        .set({ calendarSync: code, ...guide })
        .where(eq(LS.id, row.id));
      return false;
    }
    const now = deps.clock.now();
    // A249: not changed since its last read: what's stored stays, and it counts as read.
    if (answer.format === "unchanged") {
      await db
        .update(LS)
        .set({ calendarSync: "synced", lastSyncedAt: now, guideRead: row.guideRead ? { ...row.guideRead, unchangedAt: now.toISOString() } : null })
        .where(eq(LS.id, row.id));
      return true;
    }
    if (answer.format === "sheet") {
      // A248: the zone its times are in, and what was read, kept for the desk.
      const zone = sheetZone(row.scheduleTimeZone, answer.sheet.zone, market);
      const sheetRead = sheetReadRow(answer.table, answer.sheet, answer.gid, zone, now);
      // A sheet with no shows it can read says so, as a webpage without event data does: what it
      // listed before stays.
      if (!answer.sheet.entries.length) {
        await db.update(LS).set({ calendarSync: "no_event_data", lastSyncedAt: now, scheduleFormat: "sheet", sheetRead, guideRead: null }).where(eq(LS.id, row.id));
        return true;
      }
      const { from, to } = manualWindow(now);
      await storeRead(row, sheetAirings(answer.sheet.entries, zone.tz, from, to), now, { scheduleFormat: "sheet", sheetRead, guideRead: null });
      return true;
    }
    // A241: a page with no event data a computer can read says so, and isn't an error: what it
    // listed before stays (a redesign that drops it for a day doesn't empty the guide).
    if (answer.format === "webpage" && !answer.events.length) {
      await db.update(LS).set({ calendarSync: "no_event_data", lastSyncedAt: now, scheduleFormat: answer.format, sheetRead: null, guideRead: null }).where(eq(LS.id, row.id));
      return true;
    }
    await storeRead(row, answer.events, now, { scheduleFormat: answer.format, sheetRead: null, guideRead: answer.guide ?? null });
    return true;
  }

  /**
   * A read's events stored as the listing's airings. 2026-10-03: what's still on is kept with what's
   * to come (a feed that lists only what's on now had nothing stored). When the read lists what's
   * on now, it replaces what was stored for now, so nothing is doubled; when it doesn't (a feed of
   * what's next only), what's stored for now stays, as before. Ids are kept, and reminders with them
   * (replaceAirings).
   */
  async function storeRead(row: Row, events: CalendarEvent[], now: Date, set: Partial<typeof LS.$inferInsert> = {}) {
    await db.transaction(async (tx) => {
      const still = events.filter((e) => (e.end ? e.end > now : e.start >= now));
      const listsNow = still.some((e) => e.start < now);
      await replaceAirings(tx, row.id, listsNow ? or(gte(LA.startsAt, now), gt(LA.endsAt, now)) : gte(LA.startsAt, now), still);
      await tx.update(LS).set({ calendarSync: "synced", lastSyncedAt: now, ...set }).where(eq(LS.id, row.id));
    });
  }

  /**
   * A248: an uploaded spreadsheet, made into airings as it was read: on its dates, or (a sheet whose
   * days have no dates) every week from now to 14 days ahead, so it rolls forward hourly. Its zone is
   * worked out afresh each time (the listing's own, the sheet's, the market's).
   */
  async function syncFile(row: Row): Promise<boolean> {
    const file = row.sheetFile;
    if (!file) return false;
    const market = await services.stations.timezoneOf(row.stationId);
    const zone = sheetZone(row.scheduleTimeZone, row.sheetRead?.zone, market);
    const now = deps.clock.now();
    const { from, to } = manualWindow(now);
    const sheetRead = row.sheetRead ? { ...row.sheetRead, timeZone: zone.tz, timeZoneFrom: zone.from } : null;
    await storeRead(row, sheetAirings(file.entries, zone.tz, from, to), now, { sheetRead });
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
      // A241: what's on as `schedule` (a feed, guide data, by hand or none), or the older three fields; not both.
      if (input.schedule && (input.calendarUrl !== undefined || input.calendarFormat !== undefined || input.guideData !== undefined)) {
        throw badRequest("Give what's on as its schedule, or as its calendar address and guide data, not both.", { schedule: "Not with calendarUrl or guideData" });
      }
      checkManual(input.schedule);
      // A248: a spreadsheet file is uploaded to the listing once it's listed (uploadListedSchedule).
      if (input.schedule?.source === "file") throw badRequest("Upload the spreadsheet once it's listed.", { schedule: "A file is uploaded to a listing" });
      const what = input.schedule
        ? scheduleColumns(input.schedule)
        : {
            scheduleSource: input.guideData ? ("guide_data" as const) : input.calendarUrl ? ("feed" as const) : ("none" as const),
            calendarUrl: input.calendarUrl ?? null,
            scheduleFormat: input.calendarFormat ?? null,
            guideCheckedAgainst: input.guideData?.checkedAgainst ?? null,
            guideCheckedOn: input.guideData?.checkedOn ?? null,
            manualSchedule: null,
            scheduleTimeZone: null
          };
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
            ...evidence,
            basis: basisFor(evidence),
            streamFormat: plays === "stream_link" ? streamFormatOf(input.streamUrl) : null,
            // A238: another app's access waits, never relayed.
            platformFeed: platformFeedOf(input.streamUrl),
            waitingNote: input.evidence?.note ?? null,
            outsideMarket,
            // What's on (A241: a schedule entered by hand too).
            ...what,
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
      // A237: an http:// stream link is tried over https straight away; A238: then CORS, where the
      // player would fetch straight from the source (never for another app's access).
      await probeNew(sourceId);
      // Its feed read (or, A241, its schedule entered by hand made into airings) at once.
      if (what.calendarUrl || what.scheduleSource === "manual") await part.syncListedSource(sourceId);
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
      if (!row.calendarUrl && !ownSchedule(row)) throw refused("no_calendar", "Add the source's agenda calendar first.");
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

      // What's on (A241: a schedule entered by hand is checked first).
      const sc = input.schedule;
      checkManual(sc);
      // A248: an uploaded spreadsheet kept as it is (its time zone changed) needs one uploaded.
      if (sc?.source === "file" && (row.scheduleSource !== "file" || !row.sheetFile)) throw conflict("no_file", "Upload a spreadsheet first.");
      const format = sc && (sc.source === "feed" || sc.source === "guide_data") ? sc.calendarFormat : undefined;
      const schedule = sc ? scheduleColumns(sc) : null;
      const wasManual = row.scheduleSource === "manual" ? row.manualSchedule : null;
      const manualChanged = !!schedule && (manualHistoryText(schedule.manualSchedule) !== manualHistoryText(wasManual) || skipText(schedule.manualSchedule) !== skipText(wasManual));
      const scheduleChanged =
        !!schedule &&
        (schedule.scheduleSource !== row.scheduleSource ||
          schedule.calendarUrl !== row.calendarUrl ||
          (format !== undefined && schedule.scheduleFormat !== row.scheduleFormat) ||
          schedule.guideCheckedAgainst !== row.guideCheckedAgainst ||
          schedule.guideCheckedOn !== row.guideCheckedOn ||
          schedule.scheduleTimeZone !== row.scheduleTimeZone ||
          manualChanged);

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
        // A241: the weekly schedule entered by hand, as one line, and the dates it skips.
        note("manualSchedule", manualHistoryText(wasManual), manualHistoryText(schedule.manualSchedule));
        note("skipDates", skipText(wasManual), skipText(schedule.manualSchedule));
        // A248: an uploaded spreadsheet given up for another schedule, and the listing's time zone.
        if (schedule.scheduleSource !== "file") note("scheduleFile", row.scheduleSource === "file" ? fileText(row.sheetFile) : null, null);
        note("scheduleTimeZone", row.scheduleTimeZone, schedule.scheduleTimeZone);
      }
      if (channel) note("channel", ident.channel, channel);
      if (callSign) note("callSign", ident.callSign, callSign);
      if (!fields.length) return one(sourceId);

      const restart = addressChanged || playsChanged;
      const effects: ListedChange["effects"] = [];
      if (basisFor(row) && !basis) effects.push("waits_for_evidence");
      if (restart) effects.push("checks_restart");
      if (scheduleChanged && schedule && (schedule.calendarUrl || ownSchedule(schedule))) effects.push("schedule_reread");

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
            // A237: a new address (or way to play) is tried over https afresh, below; A238: and for
            // CORS, and matched against the platform feeds.
            ...(restart ? { httpsUrl: null, httpsCheckedAt: null, cors: null, corsDetail: null, corsCheckedAt: null, platformFeed: platformFeedOf(streamUrl) } : {}),
            // A248: a spreadsheet read afresh (an uploaded one's file kept, for a new time zone).
            // A249: and a guide's (its channel or address may be another), so it's downloaded afresh.
            ...(schedule && scheduleChanged ? { ...schedule, calendarSync: "not_set" as const, guideRead: null, ...(schedule.scheduleSource === "file" ? {} : { sheetFile: null, sheetRead: null }) } : {})
          })
          .where(eq(LS.id, sourceId));
        // A new address starts its health afresh: the old one's outage ends (kept in the history).
        if (restart) await endOutage(tx, sourceId, "address_changed");
        // The old feed's airings from now on go; the new feed is read below.
        // 2026-10-03: their reminders are deleted with them (a reminder never blocks the change).
        if (schedule && scheduleChanged) await replaceAirings(tx, sourceId, gte(LA.startsAt, deps.clock.now()), []);
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
      if (restart) await probeNew(sourceId);
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
      if (after && (after.calendarUrl || ownSchedule(after))) await sync(after, fetchFn);
      for (const member of family) {
        const [m] = await db.select().from(LS).where(eq(LS.id, member.id));
        if (m && !m.removedAt && (m.calendarUrl || ownSchedule(m))) await sync(m, fetchFn);
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
            // A241: a schedule entered by hand is guide data checked against the published schedule,
            // and reads so on the dial (ExternalSchedule keeps its three values for apps built before it).
            // A248: an uploaded spreadsheet is the source's own schedule, as a file: a feed.
            info: { source: r.name, plays: r.plays, schedule: r.scheduleSource === "manual" ? "guide_data" : r.scheduleSource === "file" ? "feed" : r.scheduleSource },
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
      // A238: every listing matched against the platform feeds (one listed before A238 too, or after
      // the patterns change): another app's access leaves the dial (`platform_feed`) and stays listed.
      for (const r of rows) {
        const feed = platformFeedOf(r.streamUrl);
        if (feed === r.platformFeed) continue;
        await db.update(LS).set({ platformFeed: feed }).where(eq(LS.id, r.id));
        r.platformFeed = feed;
      }
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
      // A215: a listing taken off the dial isn't read any more. A241: a schedule entered by hand is
      // made into airings again, so its two weeks roll forward (A248: an uploaded spreadsheet's too).
      const rows = await db
        .select()
        .from(LS)
        .where(and(or(isNotNull(LS.calendarUrl), inArray(LS.scheduleSource, ["manual", "file"])), isNull(LS.removedAt)));
      // 2026-10-03: the worker runs this pass every minute, but only the listings that are due are
      // read: each hourly, and a feed whose last read worked every 2 minutes while nothing stored
      // for it ends more than 5 minutes from now. Cheap: one small query over those few listings,
      // and one read per address a pass (a brand's channels can share one feed).
      const now = deps.clock.now().getTime();
      const since = (row: Row) => now - Math.max(lastTried.get(row.id) ?? 0, row.lastSyncedAt?.getTime() ?? 0);
      const hourly = rows.filter((row) => since(row) >= SCHEDULE_REREAD_MS);
      // A249: a large guide (gzipped, or over 5 MB) at most every 30 minutes: one file can be a whole
      // platform's channels, and it's asked "changed since?" first.
      const sooner = rows.filter((row) => !hourly.includes(row) && !ownSchedule(row) && row.calendarSync === "synced" && since(row) >= (row.guideRead?.large ? LARGE_GUIDE_REREAD_MS : RUNNING_DRY_REREAD_MS));
      const soon = new Date(now + RUNNING_DRY_MS);
      const stocked = new Set(
        sooner.length
          ? (
              await db
                .selectDistinct({ id: LA.listedSourceId })
                .from(LA)
                // An airing without an end is taken as an hour long, as the guide takes it.
                .where(and(inArray(LA.listedSourceId, sooner.map((r) => r.id)), or(gt(LA.endsAt, soon), and(isNull(LA.endsAt), gt(LA.startsAt, new Date(soon.getTime() - 3_600_000))))))
            ).map((r) => r.id)
          : []
      );
      const due = [...hourly, ...sooner.filter((row) => !stocked.has(row.id))];
      const fetchFn = options.fetch ?? publicFetch;
      // A249: one read per address, a guide's channels for every listing on it in one pass.
      const shared = sharedReadsFor(due);
      let synced = 0;
      let failed = 0;
      for (const row of due) {
        // 2026-10-03: one listing that throws (not a feed that can't be read: sync says so) is
        // counted as failed and logged; the others are still read.
        try {
          if (await sync(row, fetchFn, shared)) synced++;
          else failed++;
        } catch (error) {
          failed++;
          console.error(`[external] schedule read for ${row.name} (${row.id}) failed`, error);
        }
      }
      // A215: 90 days after a listing was taken off the dial its channel is freed, as a full station's is.
      const held = await db
        .select()
        .from(LS)
        .where(and(isNotNull(LS.removedAt), isNull(LS.channelReleasedAt), lte(LS.removedAt, new Date(deps.clock.now().getTime() - REMOVED_CHANNEL_HOLD_MS))));
      for (const row of held) {
        await db.transaction(async (tx) => {
          await services.stations.releaseChannel(tx, row.stationId);
          await tx.update(LS).set({ channelReleasedAt: deps.clock.now() }).where(eq(LS.id, row.id));
        });
      }
      // A223: a full station that signed off for good 90 days ago lets its channel go too.
      const releasedStations = await services.stations.releaseSignedOffChannels();
      return { synced, failed, released: held.length, releasedStations };
    },

    async previewListedSchedule(input, file, fetchFn = externalFetch()) {
      if (!!input.calendarUrl === !!file) throw badRequest("Give their schedule's address, or upload a spreadsheet.", { calendarUrl: "An address or a file" });
      const now = deps.clock.now();
      // The market's zone: the listing's, or the one it's being listed in.
      const [row] = input.sourceId ? await db.select().from(LS).where(eq(LS.id, input.sourceId)) : [];
      if (input.sourceId && !row) throw notFound("That external station");
      const market = row
        ? await services.stations.timezoneOf(row.stationId)
        : input.marketId
          ? ((await services.network.marketsByIds([input.marketId])).get(input.marketId)?.timezone ?? "America/Los_Angeles")
          : "America/Los_Angeles";
      let answer: ScheduleAnswer;
      if (file) {
        const { bytes, kind } = await sheetFileBytes(file);
        answer = { format: "sheet", gid: null, ...readSheetFile(bytes, kind, input.sheet ?? null, now) };
      } else {
        try {
          answer = await readScheduleAt(input.calendarUrl!, input.calendarFormat ?? null, fetchFn, { name: row?.name, streamUrl: row?.streamUrl }, input.timeZone ?? market, now);
        } catch (e) {
          if (e instanceof ScheduleReadError) throw refused(e.code, e.message);
          throw refused("calendar_not_found", NOT_ANSWERED);
        }
      }
      const { from, to } = manualWindow(now);
      if (answer.format === "sheet") {
        if (!answer.sheet.entries.length) throw refused("no_event_data", NO_SHOWS);
        const zone = sheetZone(input.timeZone, answer.sheet.zone, market);
        const airings = sheetAirings(answer.sheet.entries, zone.tz, from, to).filter((e) => (e.end ? e.end > now : e.start >= now));
        return { format: "sheet", sheet: sheetReadRow(answer.table, answer.sheet, answer.gid, zone, now), upcoming: airings.length, airings: airings.slice(0, 8).map(previewAiring), timeZone: zone.tz };
      }
      if (answer.format === "unchanged") throw refused("calendar_not_found", NOT_ANSWERED);
      if (answer.format === "webpage" && !answer.events.length) throw refused("no_event_data", "This page has no schedule data a computer can read.");
      const airings = answer.events.filter((e) => (e.end ? e.end > now : e.start >= now)).sort((a, b) => a.start.getTime() - b.start.getTime());
      // A249: a guide says which channel was read, of how many, and its size.
      return { format: answer.format, sheet: null, upcoming: airings.length, airings: airings.slice(0, 8).map(previewAiring), timeZone: input.timeZone ?? market, guide: answer.guide ? guideView(answer.guide) : null };
    },

    async findListedGuides(input, fetchFn = externalFetch()) {
      const [row] = input.sourceId ? await db.select().from(LS).where(eq(LS.id, input.sourceId)) : [];
      if (input.sourceId && !row) throw notFound("That external station");
      // A lead from an IPTV list has iptv-org's id for its channel (its tvg-id).
      const creatorId = input.creatorId ?? row?.creatorId ?? null;
      const [lead] = creatorId ? await db.select({ details: CR.leadDetails }).from(CR).where(eq(CR.id, creatorId)) : [];
      const tvgId = channelIdOf(lead?.details?.tvgId);
      const found = findGuides(await guideListsNow(fetchFn), input.name, tvgId);
      // Each file's channel list read once (the first 12 files): an option the file no longer has isn't offered as one that works.
      const files = [...new Set(found.guides.map((g) => g.file))].slice(0, 12);
      const channelsIn = new Map<string, Awaited<ReturnType<typeof guideChannels>>>();
      await inBatches(files, 4, async (file) => {
        channelsIn.set(file, await guideChannels(file, fetchFn));
      });
      const inGuide = (file: string, channel: string): boolean | null => {
        const channels = channelsIn.get(file);
        if (!channels) return null;
        // By id only (the reader's own rule, without names): the list's id, or one ending in it.
        return channels.some((c) => c.id === channel || c.id.endsWith(`-${channel}`));
      };
      const rank = (v: boolean | null) => (v === true ? 0 : v === null ? 1 : 2);
      const guides: GuideOption[] = found.guides
        .filter((g) => files.includes(g.file))
        .map((g) => ({ label: g.label, via: g.via, url: guideUrl(g), siteName: g.siteName, channelId: g.channelId, inGuide: inGuide(g.file, g.channel) }))
        .sort((a, b) => rank(a.inGuide) - rank(b.inGuide));
      return { channels: found.channels.slice(0, 10).map((c) => ({ id: c.id, name: c.name })), guides, skipped: found.skipped };
    },

    async uploadListedSchedule(user, sourceId, input, file) {
      const [row] = await db.select().from(LS).where(eq(LS.id, sourceId));
      if (!row) throw notFound("That external station");
      if (row.removedAt) throw conflict("removed", `${row.name} was taken off the dial. Put it back on the list first.`);
      if (!file) throw badRequest("Choose a spreadsheet file.", { file: "Required" });
      const now = deps.clock.now();
      const { bytes, kind } = await sheetFileBytes(file);
      const { table, sheet } = readSheetFile(bytes, kind, input.sheet ?? null, now);
      const market = await services.stations.timezoneOf(row.stationId);
      const timeZone = input.timeZone ?? null;
      const sheetFile: SheetFileRow = { name: file.originalName.slice(0, 200), kind: table.kind, bytes: file.size, uploadedAt: now.toISOString(), uploadedBy: user?.id ?? null, entries: sheet.entries };
      const sheetRead = sheetReadRow(table, sheet, null, sheetZone(timeZone, sheet.zone, market), now);
      // The history: what's on before, and the file (always: a new upload is a change, even of the same name).
      const fields: ListedChange["fields"] = [];
      const note = (field: ListedField, from: string | null, to: string | null) => {
        if (from !== to) fields.push({ field, from, to });
      };
      note("schedule", row.scheduleSource, "file");
      note("calendarUrl", row.calendarUrl, null);
      note("guideCheckedAgainst", row.guideCheckedAgainst, null);
      note("guideCheckedOn", row.guideCheckedOn, null);
      note("manualSchedule", row.scheduleSource === "manual" ? manualHistoryText(row.manualSchedule) : null, null);
      note("skipDates", row.scheduleSource === "manual" ? skipText(row.manualSchedule) : null, null);
      fields.push({ field: "scheduleFile", from: row.scheduleSource === "file" ? fileText(row.sheetFile) : null, to: fileText(sheetFile) });
      note("scheduleTimeZone", row.scheduleTimeZone, timeZone);
      await db.transaction(async (tx) => {
        await tx
          .update(LS)
          .set({ scheduleSource: "file", calendarUrl: null, scheduleFormat: "sheet", guideCheckedAgainst: null, guideCheckedOn: null, manualSchedule: null, scheduleTimeZone: timeZone, sheetFile, sheetRead, guideRead: null, calendarSync: "not_set" })
          .where(eq(LS.id, sourceId));
        await recordChange(tx, user, sourceId, "changed", fields, ["schedule_reread"]);
      });
      // Made into airings at once: the airings from now on are the file's (ids kept where the same show stays).
      const [after] = await db.select().from(LS).where(eq(LS.id, sourceId));
      if (after) await sync(after, publicFetch);
      return one(sourceId);
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
