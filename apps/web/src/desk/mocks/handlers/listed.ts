// External stations (follow-up Phase 6; were "listed sources"): the source's official embed or its
// stream link, each with its evidence, on the dial only once the evidence is complete. The rules
// are the API's (apps/api/src/v1/modules/network/external.ts): an embed needs its terms allowing
// embedding, the terms page and the day it was checked; a stream link needs their written
// permission (recorded once, never edited) or a clearly public basis; a DASH-only stream and a
// source outside the market wait unless Settings allows them; a stream down 5 minutes is hidden.
// The same channel and call sign rules as full stations, with subchannels (9.2, 9.3) only beside
// other external stations. The mock "finds" a feed whose address ends in .ics, .rss, .xml or .json.
// A241: a webpage (an address ending .html, or a page under /events or /schedule, or one the desk
// says is a webpage) has event data when its address says "event", and none otherwise
// (`no_event_data`); a schedule entered by hand is checked by the API's rules (the contracts') and
// counted for the next 14 days in the market's time zone.
//
// IPTV lists: a pasted list is read here (../iptv.ts); an iptv-org address answers a canned list,
// never fetched. Channels become pipeline leads with their stream noted, never listings.
//
// A248: spreadsheets (../sheets.ts). A Google Sheet's link, or a .csv, .tsv, .xlsx or .ods link,
// answers a canned week grid (a shared link with "private" in its id isn't public); an uploaded
// file answers a canned weekday sheet. Never fetched, never opened.
//
// A249: an XMLTV guide's address (an .xml.gz file, or i.mjh.nz's) answers a canned read of one
// channel of a 427-channel guide (../guides.ts); without #channel= it has none picked. "Find this
// channel's guide" answers a canned extract of iptv-org's lists.

import { http, type HttpHandler } from "msw";
import {
  callSignRefusal,
  manualScheduleProblems,
  MANUAL_HORIZON_DAYS,
  networkApi,
  SHEET_FILE_MAX_BYTES,
  slotText,
  sortedSlots,
  WEEKDAYS,
  type CallSignRules,
  type ListedChange,
  type ListedScheduleInput,
  type ListedSource,
  type StationIdent
} from "@opencast/contracts";
import { now } from "../../../lib/clock";
import type { DbCreator } from "../fixtures/creators";
import type { DbListed } from "../fixtures/listed";
import { callSignTaken, creatorById, creatorView, getDb, marketById, newId, saveDb, stationById, tenthsOf, withFamilies } from "../db";
import type { DbStation } from "../fixtures/stations";
import { advanceHealth, publishExternalOff } from "../external";
import { isAdminNow } from "../settingsDb";
import { isIptvOrgAddress, parseIptvList, SAMPLE_LIST } from "../iptv";
import { foundGuides, goneFromGuide, guideAirings, guideChannel, guideRead, isGuideAddress, notInGuide, PICK_CHANNEL } from "../guides";
import { atticAirings, atticRead, isSheetLink, kindOfFile, NO_SHOWS, NOT_PUBLIC, notPublicLink, weeklyAirings, weeklyFileRead } from "../sheets";
import { bodyOf, fail, needsAdmin, needsDesk, path, reply } from "../respond";
import { valueAt } from "../settingsDb";
import { channelOnBand } from "./creators";

type Waiting = NonNullable<ListedSource["waiting"]>;

/** The Open rules (A200, A201), as Settings has them now. */
function rules() {
  return { otherMarkets: (valueAt("external.other_markets") as { allowed: boolean }).allowed, dash: (valueAt("external.dash_stream_links") as { played: boolean }).played };
}

const streamFormatOf = (url: string): "hls" | "dash" => (/\.mpd($|[?#])/i.test(url) ? "dash" : "hls");

/** Why it may play the way it does, from what's recorded; null until the evidence is complete. */
export function basisOf(l: DbListed): "embed_terms" | "written_permission" | "public_source" | null {
  if (l.plays === "embed") return l.embedTerms === "allowed" && l.termsUrl && l.termsCheckedOn ? "embed_terms" : null;
  if (l.permission) return "written_permission";
  return l.publicBasis ? "public_source" : null;
}

/** Why it isn't on the dial, or null when it is: the evidence, then the Open rules, then its stream. */
/** Its evidence holds: on the dial, or off it only while its stream is down. */
function onByEvidence(l: DbListed): boolean {
  const w = waitingOf(l);
  return w === null || w === "down";
}

/** A215: taken off the dial for good, a listing's channel is held for it this long (the API's REMOVED_CHANNEL_HOLD_MS). */
export const REMOVED_CHANNEL_HOLD_MS = 90 * 86_400_000;

export function waitingOf(l: DbListed, rule = rules()): Waiting | null {
  const basis = basisOf(l);
  if (l.plays === "embed") {
    if (l.embedTerms !== "allowed") return "terms_unclear";
    if (!basis) return "needs_terms";
  } else {
    if (!basis) return "needs_permission";
    if (streamFormatOf(l.streamUrl) === "dash" && !rule.dash) return "dash_not_played";
  }
  if (l.outsideMarket && !rule.otherMarkets) return "other_market";
  if (l.health.state === "hidden" && !l.removed) return "down";
  return null;
}

export function listedView(l: DbListed): ListedSource | null {
  const s = stationById(l.stationId);
  if (!s) return null;
  const waiting = waitingOf(l);
  return {
    id: l.id,
    station: s.ident,
    name: l.name,
    description: l.description,
    streamUrl: l.streamUrl,
    embedTerms: l.embedTerms,
    calendarUrl: l.calendarUrl,
    calendarSync: l.calendarSync,
    // "listed" while its evidence holds (on the dial, or off it only while it's down); A215:
    // "not_listed" once it's taken off the dial for good.
    listingState: l.removed ? "not_listed" : waiting === null || waiting === "down" ? "listed" : "checking",
    lastSyncedAt: l.lastSyncedAt,
    upcoming: l.upcoming,
    plays: l.plays,
    streamFormat: l.plays === "stream_link" ? streamFormatOf(l.streamUrl) : null,
    // A237: the mocks have Opencast's secure relay set up, and no source answers over https.
    playsOver: l.plays === "stream_link" && /^http:\/\//i.test(l.streamUrl) ? "relay" : null,
    relayed: l.plays === "stream_link" && /^http:\/\//i.test(l.streamUrl),
    // A238: and every server lets browsers load it (none is CORS-blocked, none another app's feed).
    relayReason: l.plays === "stream_link" && /^http:\/\//i.test(l.streamUrl) ? "http" : null,
    platformFeed: null,
    evidence: { basis: basisOf(l), termsUrl: l.termsUrl, termsCheckedOn: l.termsCheckedOn, publicBasis: l.publicBasis, permission: l.permission, note: l.note },
    schedule: {
      source: l.schedule.source,
      format: l.schedule.format,
      url: l.calendarUrl,
      checkedAgainst: l.schedule.checkedAgainst,
      checkedOn: l.schedule.checkedOn,
      ...(l.schedule.source === "manual" ? { slots: l.schedule.slots ?? [], skipDates: l.schedule.skipDates ?? [] } : {}),
      // A248: its own time zone, what was read from its spreadsheet, the file uploaded.
      timeZone: l.schedule.timeZone ?? null,
      sheet: l.schedule.format === "sheet" || l.schedule.source === "file" ? (l.schedule.sheet ?? null) : null,
      file: l.schedule.source === "file" ? (l.schedule.file ?? null) : null,
      // A249: what was read from its XMLTV guide.
      guide: l.schedule.format === "xmltv" ? (l.schedule.guide ?? null) : null
    },
    onDial: !l.removed && waiting === null,
    waiting,
    health: l.health,
    outages: l.outages.slice(0, 5),
    creatorId: l.creatorId,
    removed: l.removed ? { at: l.removed.at, by: l.removed.by, channel: l.removed.channel, channelHeldUntil: new Date(Date.parse(l.removed.at) + REMOVED_CHANNEL_HOLD_MS).toISOString(), withListing: l.removedWith ?? null } : null,
    earlierPermissions: l.earlierPermissions ?? [],
    family: familyOf(s)
  };
}

// ---- A229: shared call signs ----

const channelOrder = (s: DbStation) => (s.ident.channel ? tenthsOf(s.ident.channel) : 0);

/** X.1 and the stations sharing its call sign that are on the list, by any of them; null when it shares nothing. */
function familyStations(s: DbStation): { head: DbStation; members: DbStation[] } | null {
  const d = getDb();
  const head = s.sharesCallSignWith ? stationById(s.sharesCallSignWith) : s;
  if (!head) return null;
  const members = d.stations.filter((m) => m.sharesCallSignWith === head.ident.id && m.public).sort((a, b) => channelOrder(a) - channelOrder(b));
  if (!members.length && !s.sharesCallSignWith) return null;
  return { head, members };
}

function familyOf(s: DbStation): ListedSource["family"] {
  const f = familyStations(s);
  return f ? { role: f.head === s ? "head" : "member", head: f.head.ident, members: f.members.map((m) => m.ident) } : null;
}

const labelOf = (s: DbStation) => [s.ident.channel, s.ident.callSign].filter(Boolean).join(" ");

/** The external station on X.1 a listing on `channel` can share a call sign with (the API's familyHeadFor), or why not. */
function familyHead(marketId: string, band: "tv" | "radio", channel: string): DbStation | Response {
  const t = tenthsOf(channel);
  const major = Math.floor(t / 10);
  if (band !== "tv" || t % 10 === 1) return fail(422, "cannot_share", `Only a subchannel (${band === "tv" ? `${major}.2` : "X.2"} and up) shares the call sign of the station on its .1.`);
  const head = getDb().stations.find((s) => s.marketId === marketId && s.ident.band === "tv" && s.ident.channel === `${major}.1`);
  if (!head) return fail(422, "cannot_share", `Nothing is on ${major}.1 to share a call sign with.`);
  if (head.ident.kind !== "listed") return fail(422, "cannot_share", `${labelOf(head)} is a full station. External stations share only an external station's call sign.`);
  if (!head.public) return fail(422, "cannot_share", `${labelOf(head)} was taken off the dial. Put it back first.`);
  return head;
}

/** A feed's format from its address, when the desk didn't say. A241: a page's address is a webpage. */
function formatOf(url: string, guide: boolean): DbListed["schedule"]["format"] {
  if (/\.ics($|\?)/i.test(url)) return "ical";
  if (/\.rss($|\?)/i.test(url)) return "rss";
  if (/\.json($|\?)/i.test(url)) return "json";
  if (/\.xml($|\?)/i.test(url)) return guide ? "xmltv" : "rss";
  if (/\.html?($|\?)|\/(events?|schedule)(\/|$|\?)/i.test(url)) return "webpage";
  // A248: a Google Sheet, or a spreadsheet file.
  if (isSheetLink(url)) return "sheet";
  return null;
}

/** "2026-09-27" in `tz`. */
const dayIn = (at: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
const minutesIn = (at: Date, tz: string) => {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at).split(":").map(Number);
  return h! * 60 + m!;
};

/**
 * A241: how many airings a schedule entered by hand makes in the next 14 days (the API makes them;
 * the mock only counts): each slot on each of its days, in season and not skipped, starting after now.
 */
export function manualUpcoming(l: DbListed, tz: string, at = now()): number {
  const slots = l.schedule.slots ?? [];
  const skip = new Set(l.schedule.skipDates ?? []);
  const today = dayIn(at, tz);
  const nowMinutes = minutesIn(at, tz);
  let n = 0;
  for (let i = 0; i <= MANUAL_HORIZON_DAYS; i++) {
    const day = new Date(Date.parse(`${today}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    const weekday = WEEKDAYS[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7]!;
    if (skip.has(day)) continue;
    for (const s of slots) {
      if (!s.days.includes(weekday) || (s.from && day < s.from) || (s.until && day > s.until)) continue;
      const [h, m] = s.start.split(":").map(Number);
      const start = h! * 60 + m!;
      if ((i === 0 && start <= nowMinutes) || (i === MANUAL_HORIZON_DAYS && start > nowMinutes)) continue;
      n++;
    }
  }
  return n;
}

function sync(l: DbListed) {
  if (l.removed) return;
  const tz = marketById(stationById(l.stationId)?.marketId ?? "")?.timezone || "America/Los_Angeles";
  // A248: an uploaded spreadsheet is made into airings again (weekly: the next 14 days); a sheet's
  // link answers the canned week, or isn't public.
  if (l.schedule.source === "file" && l.schedule.sheet) {
    l.schedule.sheet = { ...l.schedule.sheet, timeZone: l.schedule.timeZone ?? (l.schedule.sheet.timeZoneFrom === "sheet" ? l.schedule.sheet.timeZone : tz), timeZoneFrom: l.schedule.timeZone ? "listing" : l.schedule.sheet.timeZoneFrom === "sheet" ? "sheet" : "market" };
    l.calendarSync = "synced";
    l.lastSyncedAt = now().toISOString();
    l.upcoming = l.schedule.sheet.weekly ? 28 : l.upcoming;
    return;
  }
  if (l.schedule.format === "sheet" && l.calendarUrl) {
    if (notPublicLink(l.calendarUrl)) {
      l.calendarSync = "not_public";
      return;
    }
    l.schedule.sheet = atticRead(l.calendarUrl, l.schedule.timeZone ?? null, now());
    l.calendarSync = "synced";
    l.lastSyncedAt = now().toISOString();
    l.upcoming = 31;
    return;
  }
  if (l.schedule.source === "manual") {
    l.calendarSync = "synced";
    l.lastSyncedAt = now().toISOString();
    l.upcoming = manualUpcoming(l, tz);
    return;
  }
  if (!l.calendarUrl) return;
  // A249: a guide: its channel's canned read, or none picked, or a channel the file no longer has.
  if (isGuideAddress(l.calendarUrl)) {
    l.schedule.format = "xmltv";
    if (!guideChannel(l.calendarUrl)) {
      l.calendarSync = "pick_channel";
      l.schedule.guide = { ...guideRead(l.calendarUrl, now()), programmes: 0 };
      return;
    }
    if (goneFromGuide(l.calendarUrl)) {
      l.calendarSync = "not_in_guide";
      return;
    }
    l.schedule.guide = guideRead(l.calendarUrl, now());
    l.calendarSync = "synced";
    l.lastSyncedAt = now().toISOString();
    l.upcoming = guideAirings(now()).length;
    return;
  }
  if (l.schedule.format === "webpage") {
    // A241: a page whose address says "event" has event data; any other has none (not an error).
    l.lastSyncedAt = now().toISOString();
    if (/event/i.test(l.calendarUrl)) {
      l.calendarSync = "synced";
      l.upcoming = Math.max(l.upcoming, 3);
    } else l.calendarSync = "no_event_data";
    return;
  }
  if (/\.(ics|rss|xml|json)($|\?)/i.test(l.calendarUrl)) {
    l.calendarSync = "synced";
    l.lastSyncedAt = now().toISOString();
    l.upcoming = Math.max(l.upcoming, 3);
  } else l.calendarSync = "calendar_not_found";
}

/** A241: what's on as the desk sends it (`schedule`), as the mock keeps it. A248: `file` keeps the listing's file (`was`). */
function scheduleOf(sc: ListedScheduleInput, was?: DbListed): Pick<DbListed, "calendarUrl" | "schedule"> {
  if (sc.source === "none") return { calendarUrl: null, schedule: { source: "none", format: null, checkedAgainst: null, checkedOn: null } };
  if (sc.source === "file") return { calendarUrl: null, schedule: { ...(was?.schedule ?? { checkedAgainst: null, checkedOn: null }), source: "file", format: "sheet", timeZone: sc.timeZone ?? null } };
  if (sc.source === "manual") {
    return {
      calendarUrl: null,
      schedule: {
        source: "manual",
        format: null,
        checkedAgainst: sc.checkedAgainst,
        checkedOn: sc.checkedOn,
        slots: sc.slots.map((x) => ({ days: WEEKDAYS.filter((d) => x.days.includes(d)), start: x.start, end: x.end, title: x.title.trim(), description: x.description?.trim() || null, from: x.from ?? null, until: x.until ?? null })),
        skipDates: [...new Set(sc.skipDates ?? [])].sort()
      }
    };
  }
  return {
    calendarUrl: sc.calendarUrl,
    schedule: {
      source: sc.source,
      format: sc.calendarFormat ?? formatOf(sc.calendarUrl, sc.source === "guide_data"),
      checkedAgainst: sc.source === "guide_data" ? sc.guideData.checkedAgainst : null,
      checkedOn: sc.source === "guide_data" ? sc.guideData.checkedOn : null,
      timeZone: sc.timeZone ?? null
    }
  };
}

/** A248: an uploaded spreadsheet refused as the API refuses it: its size, its type, one with no times. */
function fileProblem(file: File): Response | null {
  if (file.size > SHEET_FILE_MAX_BYTES) return fail(422, "too_big", "Use a file of 2 MB or less.");
  const kind = kindOfFile(file.name);
  if (!kind) return fail(422, "not_a_spreadsheet", "That isn't a spreadsheet Opencast can read: use .xlsx, .ods, .csv or .tsv.");
  if (kind === "xls") return fail(422, "old_excel", "Older Excel files (.xls) aren't read. Save it as .xlsx or .csv and upload that.");
  if (/empty/i.test(file.name)) return fail(422, "no_event_data", NO_SHOWS);
  return null;
}

/** A241: a schedule entered by hand, refused as the API refuses it (the contracts' rules). */
function manualProblem(sc: ListedScheduleInput | undefined): Response | null {
  if (sc?.source !== "manual") return null;
  const problems = manualScheduleProblems(sc.slots);
  if (!problems.length) return null;
  return fail(400, "bad_request", problems[0]!.message, Object.fromEntries(problems.map((x) => [x.slot === null ? "slots" : `slots.${x.slot}.${x.field}`, x.message])));
}

/** A241: the weekly schedule and its skipped dates in the change history's words (the API's). */
const manualText = (sc: DbListed["schedule"]) =>
  sc.source === "manual" && sc.slots?.length ? sortedSlots(sc.slots).map((x) => `${slotText(x)}${x.description ? `, “${x.description}”` : ""}`).join("; ") : null;
const skipText = (sc: DbListed["schedule"]) => (sc.source === "manual" && sc.skipDates?.length ? sc.skipDates.join(", ") : null);
/** A248: an uploaded spreadsheet in the history's words: "week.xlsx, 14 shows". */
const fileText = (sc: DbListed["schedule"]) => (sc.file ? `${sc.file.name}, ${sc.sheet?.shows ?? 0} ${sc.sheet?.shows === 1 ? "show" : "shows"}` : null);

/** The same channel rules as a full station, with room for more external stations in one major. */
function channelProblem(marketId: string, band: "tv" | "radio", channel: string, exceptStationId?: string): Response | null {
  if (!channelOnBand(band, channel)) return fail(400, "bad_channel", band === "tv" ? "TV channels run from 2.1 to 69.9." : "Radio runs from 88.2 to 107.8, in even tenths.", { channel: "Out of range" });
  const d = getDb();
  const t = tenthsOf(channel);
  const major = (x: number) => (band === "tv" ? Math.floor(x / 10) : x);
  // A215: a listing changing its own channel (or put back on it) doesn't count against itself.
  const sameMajor = d.stations.filter((s) => s.ident.id !== exceptStationId && s.marketId === marketId && s.ident.band === band && s.ident.channel && major(tenthsOf(s.ident.channel)) === major(t));
  const held = d.reservations.some((r) => r.marketId === marketId && r.band === band && r.channel && major(tenthsOf(r.channel)) === major(t));
  if (held || sameMajor.some((s) => s.ident.channel === channel || s.ident.kind !== "listed")) return fail(409, "channel_taken", `${channel} is taken. Pick another.`, { channel: "taken" });
  // A station gets X.1; a subchannel only beside other external stations.
  if (band === "tv" && t % 10 !== 1 && !sameMajor.length) return fail(400, "invalid", `Start at ${major(t)}.1. Subchannels go beside other external stations.`, { channel: "Use X.1" });
  return null;
}

function callSignProblem(callSign: string, forStationId?: string): Response | null {
  const refusal = callSignRefusal(callSign, valueAt("call_signs.refused") as CallSignRules);
  if (refusal) return fail(422, "call_sign_refused", `${callSign} isn't allowed. ${refusal.reason}`, { callSign: "refused" });
  // A215: its old call sign, held for it after a change, is its own to take back.
  const heldForIt = forStationId && getDb().listed.some((l) => l.stationId === forStationId && l.heldCallSigns?.includes(callSign));
  if (callSignTaken(callSign) && !heldForIt) return fail(409, "call_sign_taken", `${callSign} is taken or held. Try another.`, { callSign: "taken" });
  return null;
}

/** Written permission and a public basis are for stream links only. */
function evidenceProblem(plays: DbListed["plays"], e: { permission?: unknown; publicBasis?: string } | undefined): Response | null {
  if (e?.permission && plays !== "stream_link") return fail(400, "invalid", "Written permission is for stream links. An embed needs its terms page.", { permission: "Stream links only" });
  if (e?.publicBasis && plays !== "stream_link") return fail(400, "invalid", "A public basis is for stream links. An embed needs its terms page.", { publicBasis: "Stream links only" });
  return null;
}

function permissionRecord(who: string, streamUrl: string, creatorId: string | null, p: { grantedBy: string; grantedOn: string; evidence: string; documentUrl?: string }) {
  return { id: newId(), grantedBy: p.grantedBy.trim(), grantedOn: p.grantedOn, evidence: p.evidence.trim(), documentUrl: p.documentUrl ?? null, streamUrl, recordedAt: now().toISOString(), recordedBy: who, creatorId };
}

/** Field errors by the field's own name ("termsUrl", not "evidence.termsUrl"), as the form names them. */
const fieldsOf = (issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>) =>
  Object.fromEntries(issues.map((i) => [String([...i.path].reverse().find((k) => typeof k === "string") ?? i.path[0]), i.message]));

/** Only a listing whose evidence holds is checked (never one taken off the dial). */
const checked = (l: DbListed) => {
  const w = waitingOf(l);
  return !l.removed && (w === null || w === "down");
};

/** The desk's own words for who did it. */
const whoOf = (p: { displayName?: string | null; email: string }) => p.displayName ?? p.email;

const hostOf = (url: string) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url;
  }
};

/** An address as its host, for someone on the desk who isn't an admin: "https://colton.example.gov/…". */
function hostOnly(url: string | null): string | null {
  if (!url) return url;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…`;
  } catch {
    return "…";
  }
}
const ADDRESS_FIELDS = new Set(["streamUrl", "calendarUrl", "guideCheckedAgainst"]);

function recordChange(l: DbListed, by: string | null, action: ListedChange["action"], fields: ListedChange["fields"], effects: ListedChange["effects"]) {
  l.changes = [{ id: newId(), at: now().toISOString(), by, action, fields, effects }, ...(l.changes ?? [])];
}

/** An open outage ends without the stream being back (A215): the address changed, or it's taken off. */
function endOutage(l: DbListed, ended: "address_changed" | "removed") {
  const at = now().toISOString();
  for (const o of l.outages) if (!o.backAt) Object.assign(o, { backAt: at, ended });
}

const unchecked = (): DbListed["health"] => ({ state: "unchecked", since: null, lastCheckedAt: null, detail: null });

/** 90 days after a listing was taken off the dial, its channel is freed (as the API's hourly pass does). */
function releaseHeldChannels() {
  let changed = false;
  for (const l of getDb().listed) {
    const st = l.removed ? stationById(l.stationId) : undefined;
    if (l.removed && st?.ident.channel && now().getTime() - Date.parse(l.removed.at) >= REMOVED_CHANNEL_HOLD_MS) {
      st.ident = { ...st.ident, channel: null };
      changed = true;
    }
  }
  if (changed) saveDb();
}

/** Saved, and the viewer's mock told what's off the dial now. */
function saved() {
  withFamilies(getDb().stations);
  saveDb();
  publishExternalOff((l) => waitingOf(l));
}

/** Stream addresses already on the desk: leads' and external stations'. */
function knownStreams() {
  const d = getDb();
  return {
    leads: new Set(d.creators.flatMap((c) => (c.lead ? [c.lead.streamUrl, c.sourceUrl] : [c.sourceUrl]))),
    external: new Set(d.listed.map((l) => l.streamUrl))
  };
}

/** A215: one listing back on the list, on its channel (or `channel`), waiting for its checks; or why not. */
function restoreOne(l: DbListed, station: DbStation, channel: string | undefined, who: string): Response | null {
  const d = getDb();
  if (!l.removed) return null;
  if (l.creatorId && d.listed.some((x) => x !== l && x.creatorId === l.creatorId && !x.removed)) return fail(409, "already_external", "Its lead is already another external station.");
  const want = channel ?? station.ident.channel ?? l.removed.channel;
  if (!want) return fail(400, "invalid", "Choose a channel.", { channel: "Required" });
  const old = l.removed.channel;
  if (want !== station.ident.channel) {
    const bad = channelProblem(l.removed.marketId, l.removed.band ?? "tv", want, station.ident.id);
    if (bad) return bad;
  }
  station.ident = { ...station.ident, channel: want };
  station.public = true;
  l.removed = null;
  l.removedWith = null;
  l.health = unchecked();
  l.addedAt = now().toISOString();
  const lead = l.creatorId ? creatorById(l.creatorId) : undefined;
  if (lead) {
    l.leadStageBefore = lead.stage;
    Object.assign(lead, { stationId: station.ident.id, listedSourceId: l.id, nextAction: null, nextActionDue: null, ...(basisOf(l) ? { stage: "on_air" as const } : {}) } satisfies Partial<DbCreator>);
  }
  sync(l);
  recordChange(l, who, "restored", want !== old ? [{ field: "channel", from: old, to: want }] : [], []);
  return null;
}

export const listedHandlers: HttpHandler[] = [
  http.get(path(networkApi.listListedSources), ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    advanceHealth(now(), checked);
    releaseHeldChannels();
    const q = new URL(request.url).searchParams;
    const marketId = q.get("marketId");
    const removed = q.get("show") === "removed";
    const d = getDb();
    const rows = d.listed
      .filter((l) => !!l.removed === removed && (!marketId || (l.removed ? l.removed.marketId : stationById(l.stationId)?.marketId) === marketId))
      .sort((a, b) => a.name.localeCompare(b.name));
    return reply(networkApi.listListedSources.response, rows.map(listedView).filter((x): x is ListedSource => !!x));
  }),

  http.post(path(networkApi.addListedSource), async ({ request }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const parsed = networkApi.addListedSource.body.safeParse(await bodyOf(request));
    if (!parsed.success) return fail(400, "invalid", "Check the highlighted fields.", fieldsOf(parsed.error.issues));
    const b = parsed.data;
    const plays = b.plays ?? "embed";
    if (plays === "embed" && !b.embedTerms) return fail(400, "invalid", "Say whether their terms allow embedding.", { embedTerms: "Required for an embed" });
    const bad = evidenceProblem(plays, b.evidence);
    if (bad) return bad;
    if (b.guideData && !b.calendarUrl) return fail(400, "invalid", "Guide data needs its address as well as the schedule it was checked against.", { calendarUrl: "Required with guide data" });
    const badSchedule = manualProblem(b.schedule);
    if (badSchedule) return badSchedule;
    // A248: a spreadsheet file is uploaded to a listing once it's listed.
    if (b.schedule?.source === "file") return fail(400, "bad_request", "Upload the spreadsheet once it's listed.", { schedule: "A file is uploaded to a listing" });
    const d = getDb();
    const creator = b.creatorId ? creatorById(b.creatorId) : null;
    if (b.creatorId && !creator) return fail(404, "not_found", "That lead wasn't found.");
    if (creator && d.listed.some((l) => l.creatorId === creator.id && !l.removed)) return fail(409, "already_external", `${creator.displayName} is already an external station.`);
    const market = marketById(b.marketId);
    if (!market) return fail(404, "not_found", "That market wasn't found.");
    const channel = channelProblem(b.marketId, b.band, b.channel);
    if (channel) return channel;
    // A229: "Same brand as 15.1 RIVC" takes X.1's call sign; otherwise its own, by the usual rules.
    const head = b.shareCallSign ? familyHead(b.marketId, b.band, b.channel) : null;
    if (head instanceof Response) return head;
    if (head && b.callSign && b.callSign !== head.ident.callSign) return fail(400, "invalid", `It shares ${labelOf(head)}'s call sign.`, { callSign: `Shares ${head.ident.callSign}` });
    if (!head && !b.callSign) return fail(400, "invalid", "Give it a call sign, or share the call sign of the station on its .1.", { callSign: "Required" });
    const cs = head ? head.ident.callSign! : b.callSign!;
    if (!head) {
      const callSign = callSignProblem(cs);
      if (callSign) return callSign;
    }
    const at = now().toISOString();
    const ident: StationIdent = { id: newId(), kind: "listed", callSign: cs, handle: cs.toLowerCase(), name: b.name, colour: null, band: b.band, channel: b.channel, marketSlug: market.slug, homeCity: null };
    d.stations.push({ ident, marketId: market.id, public: true, firstSignedOnAt: at, escrowId: null, signOnAt: null, sharesCallSignWith: head?.ident.id ?? null });
    const e = b.evidence;
    const l: DbListed = {
      id: newId(),
      stationId: ident.id,
      name: b.name,
      description: b.description ?? null,
      streamUrl: b.streamUrl,
      embedTerms: plays === "embed" ? b.embedTerms! : "unclear",
      calendarSync: "not_set",
      lastSyncedAt: null,
      upcoming: 0,
      plays,
      termsUrl: e?.termsUrl ?? null,
      termsCheckedOn: e?.termsCheckedOn ?? null,
      publicBasis: plays === "stream_link" ? (e?.publicBasis?.trim() ?? null) : null,
      permission: plays === "stream_link" && e?.permission ? permissionRecord(p.displayName ?? p.email, b.streamUrl, creator?.id ?? null, e.permission) : null,
      note: e?.note || null,
      // A241: what's on as `schedule` (a feed, guide data, by hand or none), or the older fields.
      ...(b.schedule
        ? scheduleOf(b.schedule)
        : {
            calendarUrl: b.calendarUrl ?? null,
            schedule: {
              source: b.guideData ? ("guide_data" as const) : b.calendarUrl ? ("feed" as const) : ("none" as const),
              format: b.calendarFormat ?? (b.calendarUrl ? formatOf(b.calendarUrl, !!b.guideData) : null),
              checkedAgainst: b.guideData?.checkedAgainst ?? null,
              checkedOn: b.guideData?.checkedOn ?? null
            }
          }),
      outsideMarket: b.outsideMarket ?? false,
      health: { state: "unchecked", since: null, lastCheckedAt: null, detail: null },
      outages: [],
      creatorId: creator?.id ?? null,
      addedAt: at,
      leadStageBefore: creator?.stage ?? null
    };
    d.listed.push(l);
    sync(l);
    // The lead became this external station: On air once its evidence holds (as the API does).
    if (creator) Object.assign(creator, { stationId: ident.id, ...(onByEvidence(l) ? { stage: "on_air" as const } : {}), nextAction: null, nextActionDue: null, listedSourceId: l.id } satisfies Partial<DbCreator>);
    saved();
    return reply(networkApi.addListedSource.response, listedView(l)!, 201);
  }),

  http.post(path(networkApi.recordListedEvidence), async ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const l = getDb().listed.find((x) => x.id === String(params.sourceId));
    if (!l) return fail(404, "not_found", "That external station wasn't found.");
    const parsed = networkApi.recordListedEvidence.body.safeParse(await bodyOf(request));
    if (!parsed.success) return fail(400, "invalid", "Check the highlighted fields.", fieldsOf(parsed.error.issues));
    const b = parsed.data;
    const bad = evidenceProblem(l.plays, b);
    if (bad) return bad;
    if (b.permission && l.permission) return fail(409, "permission_recorded", "Their written permission is already recorded. It's never edited.");
    if (b.permission) l.permission = permissionRecord(p.displayName ?? p.email, l.streamUrl, l.creatorId, b.permission);
    if (l.plays === "embed" && b.embedTerms) l.embedTerms = b.embedTerms;
    if (b.termsUrl) l.termsUrl = b.termsUrl;
    if (b.termsCheckedOn) l.termsCheckedOn = b.termsCheckedOn;
    if (b.publicBasis) l.publicBasis = b.publicBasis.trim();
    if (b.note !== undefined) l.note = b.note || null;
    // Checked from the next minute, like a new listing.
    if (l.health.state === "unchecked") l.addedAt = now().toISOString();
    // Its lead is On air once the evidence holds (not while the listing is off the dial for good).
    const lead = l.creatorId ? getDb().creators.find((c) => c.id === l.creatorId) : undefined;
    if (lead && onByEvidence(l) && !l.removed) lead.stage = "on_air";
    saved();
    return reply(networkApi.recordListedEvidence.response, listedView(l)!);
  }),

  http.get(path(networkApi.listExternalOutages), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const l = getDb().listed.find((x) => x.id === String(params.sourceId));
    if (!l) return fail(404, "not_found", "That external station wasn't found.");
    const since = now().getTime() - 90 * 86_400_000;
    return reply(networkApi.listExternalOutages.response, l.outages.filter((o) => !o.backAt || Date.parse(o.downSince) >= since));
  }),

  http.post(path(networkApi.syncListedSource), ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const l = getDb().listed.find((x) => x.id === String(params.sourceId));
    if (!l) return fail(404, "not_found", "That listed source wasn't found.");
    if (l.removed) return fail(409, "removed", `${l.name} was taken off the dial. Put it back on the list first.`);
    if (!l.calendarUrl && l.schedule.source !== "manual") return fail(422, "no_calendar", "Add the source's agenda calendar first.");
    sync(l);
    saveDb();
    return reply(networkApi.syncListedSource.response, listedView(l)!);
  }),

  // ---- A215 (2026-09-30): changing a listing, its history, taking it off for good, putting it back ----

  http.patch(path(networkApi.updateListedSource), async ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const l = getDb().listed.find((x) => x.id === String(params.sourceId));
    if (!l) return fail(404, "not_found", "That external station wasn't found.");
    const parsed = networkApi.updateListedSource.body.safeParse(await bodyOf(request));
    if (!parsed.success) return fail(400, "invalid", "Check the highlighted fields.", fieldsOf(parsed.error.issues));
    const b = parsed.data;
    if (l.removed) return fail(409, "removed", `${l.name} was taken off the dial. Put it back on the list first.`);
    const station = stationById(l.stationId);
    if (!station) return fail(404, "not_found", "That external station wasn't found.");
    const plays = b.plays ?? l.plays;
    const streamUrl = b.streamUrl ?? l.streamUrl;
    const addressChanged = streamUrl !== l.streamUrl;
    const playsChanged = plays !== l.plays;
    if (plays === "embed" && playsChanged && !b.embedTerms) return fail(400, "invalid", "Say whether their terms allow embedding.", { embedTerms: "Required for an embed" });
    const badSchedule = manualProblem(b.schedule);
    if (badSchedule) return badSchedule;
    // A248: an uploaded spreadsheet kept as it is needs one uploaded.
    if (b.schedule?.source === "file" && (l.schedule.source !== "file" || !l.schedule.file)) return fail(409, "no_file", "Upload a spreadsheet first.");
    const channel = b.channel && b.channel !== station.ident.channel ? b.channel : null;
    // A229: X.1 with a family stays put; a family's call sign is X.1's to change.
    const family = familyStations(station);
    const members = family && family.head === station ? family.members : [];
    if (channel && members.length) {
      const n = members.length;
      return fail(409, "family_channel", `${members.map(labelOf).join(", ")} ${n === 1 ? "shares" : "share"} its call sign. Move ${n === 1 ? "it" : "them"} first, or give ${n === 1 ? "it its own call sign" : "them their own call signs"}.`);
    }
    if (channel) {
      const bad = channelProblem(station.marketId, station.ident.band ?? "tv", channel, station.ident.id);
      if (bad) return bad;
    }
    let callSign = b.callSign && b.callSign !== station.ident.callSign ? b.callSign : null;
    let join: DbStation | null = null;
    let leave = false;
    const at = channel ?? station.ident.channel;
    if (b.shareCallSign === true && at) {
      const head = familyHead(station.marketId, station.ident.band ?? "tv", at);
      if (head instanceof Response) return head;
      if (callSign && callSign !== head.ident.callSign) return fail(400, "invalid", `It shares ${labelOf(head)}'s call sign.`, { callSign: `Shares ${head.ident.callSign}` });
      if (head.ident.id !== station.sharesCallSignWith) {
        join = head;
        callSign = head.ident.callSign;
      } else callSign = null;
    } else if (station.sharesCallSignWith) {
      const movedOut = !!channel && !!station.ident.channel && Math.floor(tenthsOf(channel) / 10) !== Math.floor(tenthsOf(station.ident.channel) / 10);
      if (b.shareCallSign === false || callSign || movedOut) {
        if (!callSign) return fail(400, "invalid", "Give it its own call sign to stop sharing the call sign of the station on its .1.", { callSign: "Required" });
        leave = true;
      }
    }
    if (callSign && !join) {
      const bad = callSignProblem(callSign, station.ident.id);
      if (bad) return bad;
    }
    const before = basisOf(l);
    const was = { ...l, schedule: { ...l.schedule } };
    // The evidence, never stretched to cover what it wasn't recorded for (as the API does).
    if (playsChanged) {
      l.termsCheckedOn = null;
      l.publicBasis = null;
      if (l.permission) l.earlierPermissions = [l.permission, ...(l.earlierPermissions ?? [])];
      l.permission = null;
      l.embedTerms = plays === "embed" ? b.embedTerms! : "unclear";
    } else if (plays === "embed") {
      if (b.embedTerms) l.embedTerms = b.embedTerms;
      if (addressChanged && hostOf(streamUrl) !== hostOf(l.streamUrl)) l.termsCheckedOn = null;
    } else if (addressChanged && l.permission?.streamUrl !== streamUrl) {
      // A written permission names one exact address; one recorded before for this address covers it again.
      const earlier = l.earlierPermissions ?? [];
      const covering = earlier.find((x) => x.streamUrl === streamUrl) ?? null;
      l.earlierPermissions = [...(l.permission ? [l.permission] : []), ...earlier.filter((x) => x !== covering)];
      l.permission = covering;
    }
    l.plays = plays;
    l.streamUrl = streamUrl;
    const restart = addressChanged || playsChanged;
    if (restart) {
      l.health = unchecked();
      endOutage(l, "address_changed");
      l.addedAt = now().toISOString();
    }
    let scheduleChanged = false;
    const sc = b.schedule;
    if (sc) {
      const next = scheduleOf(sc, l);
      scheduleChanged =
        (next.schedule.timeZone ?? null) !== (l.schedule.timeZone ?? null) ||
        next.calendarUrl !== l.calendarUrl ||
        next.schedule.source !== l.schedule.source ||
        next.schedule.checkedAgainst !== l.schedule.checkedAgainst ||
        next.schedule.checkedOn !== l.schedule.checkedOn ||
        // A241: the format the desk chose, and a schedule entered by hand.
        ((sc.source === "feed" || sc.source === "guide_data") && sc.calendarFormat !== undefined && next.schedule.format !== l.schedule.format) ||
        manualText(next.schedule) !== manualText(l.schedule) ||
        skipText(next.schedule) !== skipText(l.schedule);
      if (scheduleChanged) {
        l.calendarUrl = next.calendarUrl;
        // A248: what was read from a spreadsheet stays only with its file; a link is read afresh.
        l.schedule = next.schedule.source === "file" ? next.schedule : { ...next.schedule, sheet: null, file: null };
        l.calendarSync = "not_set";
        l.upcoming = 0;
        l.lastSyncedAt = null;
        sync(l);
      }
    }
    const name = b.name !== undefined && b.name.trim() !== l.name ? b.name.trim() : null;
    const description = b.description !== undefined && (b.description?.trim() || null) !== l.description ? b.description?.trim() || null : undefined;
    if (name) {
      l.name = name;
      station.ident = { ...station.ident, name };
    }
    if (description !== undefined) l.description = description;
    const oldIdent = station.ident;
    if (channel) station.ident = { ...station.ident, channel };
    if (callSign) {
      station.ident = { ...station.ident, callSign, handle: callSign.toLowerCase() };
      // A229: a station leaving a family leaves the family's name with it; the rest hold their old one (A222).
      l.heldCallSigns = [...(l.heldCallSigns ?? []).filter((c) => c !== callSign), ...(oldIdent.callSign && !leave ? [oldIdent.callSign] : [])];
      if (join) station.sharesCallSignWith = join.ident.id;
      if (leave) station.sharesCallSignWith = null;
      // On X.1: the whole family's call sign changes with it, and each member's history says so.
      for (const m of members) {
        m.ident = { ...m.ident, callSign };
        const ml = getDb().listed.find((x) => x.stationId === m.ident.id);
        if (ml) recordChange(ml, whoOf(p), "changed", [{ field: "callSign", from: oldIdent.callSign, to: callSign }], []);
      }
    }

    const fields: ListedChange["fields"] = [];
    const note = (field: ListedChange["fields"][number]["field"], from: string | null, to: string | null) => {
      if (from !== to) fields.push({ field, from, to });
    };
    if (name) note("name", was.name, name);
    if (description !== undefined) note("description", was.description, description);
    note("plays", was.plays, l.plays);
    note("streamUrl", was.streamUrl, l.streamUrl);
    if (l.plays === "embed") note("embedTerms", was.embedTerms, l.embedTerms);
    if (scheduleChanged) {
      note("schedule", was.schedule.source, l.schedule.source);
      note("calendarUrl", was.calendarUrl, l.calendarUrl);
      if (was.schedule.format !== l.schedule.format && l.schedule.source !== "manual" && l.schedule.source !== "none") note("calendarFormat", was.schedule.format, l.schedule.format);
      note("guideCheckedAgainst", was.schedule.checkedAgainst, l.schedule.checkedAgainst);
      note("guideCheckedOn", was.schedule.checkedOn, l.schedule.checkedOn);
      // A241: the weekly schedule entered by hand, as one line, and the dates it skips.
      note("manualSchedule", manualText(was.schedule), manualText(l.schedule));
      note("skipDates", skipText(was.schedule), skipText(l.schedule));
      // A248: an uploaded spreadsheet given up, and the listing's time zone.
      if (l.schedule.source !== "file") note("scheduleFile", was.schedule.source === "file" ? fileText(was.schedule) : null, null);
      note("scheduleTimeZone", was.schedule.timeZone ?? null, l.schedule.timeZone ?? null);
    }
    if (channel) note("channel", oldIdent.channel, channel);
    if (callSign) note("callSign", oldIdent.callSign, callSign);
    if (fields.length) {
      const effects: ListedChange["effects"] = [];
      if (before && !basisOf(l)) effects.push("waits_for_evidence");
      if (restart) effects.push("checks_restart");
      if (scheduleChanged && (l.calendarUrl || l.schedule.source === "manual" || l.schedule.source === "file")) effects.push("schedule_reread");
      recordChange(l, whoOf(p), "changed", fields, effects);
      // Its lead leaves On air while the listing waits for evidence.
      const lead = l.creatorId ? creatorById(l.creatorId) : undefined;
      if (lead && effects.includes("waits_for_evidence") && lead.stage === "on_air") lead.stage = l.leadStageBefore ?? "found";
    }
    saved();
    return reply(networkApi.updateListedSource.response, listedView(l)!);
  }),

  http.get(path(networkApi.listListedChanges), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const l = getDb().listed.find((x) => x.id === String(params.sourceId));
    if (!l) return fail(404, "not_found", "That external station wasn't found.");
    const full = isAdminNow(p);
    return reply(
      networkApi.listListedChanges.response,
      (l.changes ?? []).map((c) => ({ ...c, fields: c.fields.map((f) => (full || !ADDRESS_FIELDS.has(f.field) ? f : { ...f, from: hostOnly(f.from), to: hostOnly(f.to) })) }))
    );
  }),

  http.post(path(networkApi.removeListedSource), async ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const l = getDb().listed.find((x) => x.id === String(params.sourceId));
    if (!l) return fail(404, "not_found", "That external station wasn't found.");
    if (l.removed) return fail(409, "removed", `${l.name} is already off the dial.`);
    const station = stationById(l.stationId);
    if (!station) return fail(404, "not_found", "That external station wasn't found.");
    const body = ((await bodyOf(request)) ?? {}) as { withFamily?: boolean };
    // A231: X.1 with a family goes with its family, and only when the desk says so, naming them.
    const family = familyStations(station);
    const members = family && family.head === station ? family.members : [];
    if (members.length && !body.withFamily) {
      return fail(409, "family", `${members.map(labelOf).join(", ")} ${members.length === 1 ? "shares" : "share"} its call sign and would go with it. Take them off too, or give them their own call signs first.`);
    }
    const theirs = members.flatMap((m) => getDb().listed.filter((x) => x.stationId === m.ident.id && !x.removed));
    for (const [x, st, withId] of [[l, station, null], ...theirs.map((t) => [t, stationById(t.stationId)!, l.id] as const)] as const) {
      // Archived like a full station that signs off for good: nothing is deleted.
      x.removed = { at: now().toISOString(), by: whoOf(p), channel: st.ident.channel, band: st.ident.band, marketId: st.marketId };
      x.removedWith = withId;
      endOutage(x, "removed");
      x.health = unchecked();
      st.public = false;
      const lead = x.creatorId ? creatorById(x.creatorId) : undefined;
      if (lead) {
        const was = [st.ident.channel, st.ident.callSign].filter(Boolean).join(" ");
        Object.assign(lead, { stage: lead.stage === "on_air" ? (x.leadStageBefore ?? "found") : lead.stage, stationId: null, listedSourceId: null, nextAction: `Was external station ${was || x.name}. Taken off the dial`, nextActionDue: null } satisfies Partial<DbCreator>);
      }
      recordChange(x, whoOf(p), "removed", [], []);
    }
    saved();
    return reply(networkApi.removeListedSource.response, listedView(l)!);
  }),

  http.post(path(networkApi.restoreListedSource), async ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const d = getDb();
    const l = d.listed.find((x) => x.id === String(params.sourceId));
    if (!l) return fail(404, "not_found", "That external station wasn't found.");
    const parsed = networkApi.restoreListedSource.body.safeParse((await bodyOf(request)) ?? {});
    if (!parsed.success) return fail(400, "invalid", "Check the channel.", fieldsOf(parsed.error.issues));
    if (!l.removed) return fail(409, "not_removed", `${l.name} is on the list.`);
    const station = stationById(l.stationId);
    if (!station) return fail(404, "not_found", "That external station wasn't found.");
    // A231: a station sharing X.1's call sign comes back after X.1.
    const head = station.sharesCallSignWith ? stationById(station.sharesCallSignWith) : undefined;
    if (head && !head.public) return fail(409, "family_removed", `Put ${labelOf(head)} back first. It shares its call sign, and brings back the streams taken off with it.`);
    const back = restoreOne(l, station, parsed.data.channel, whoOf(p));
    if (back instanceof Response) return back;
    // X.1's family, taken off with it: back beside it.
    for (const x of d.listed.filter((y) => y.removedWith === l.id && y.removed)) {
      const st = stationById(x.stationId);
      if (st) restoreOne(x, st, undefined, whoOf(p));
    }
    saved();
    return reply(networkApi.restoreListedSource.response, listedView(l)!);
  }),

  // ---- A248 (2026-10-06): schedules from spreadsheets ----

  http.post(path(networkApi.previewListedSchedule), async ({ request }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const form = await request.formData().catch(() => null);
    const field = (k: string) => {
      const v = form?.get(k);
      return typeof v === "string" && v ? v : undefined;
    };
    const file = form?.get("file");
    const url = field("calendarUrl");
    const upload = file && typeof file !== "string" ? file : null;
    if (!!url === !!upload) return fail(400, "bad_request", "Give their schedule's address, or upload a spreadsheet.", { calendarUrl: "An address or a file" });
    const listing = field("sourceId") ? getDb().listed.find((x) => x.id === field("sourceId")) : undefined;
    const marketId = listing ? stationById(listing.stationId)?.marketId : field("marketId");
    const market = marketById(marketId ?? "")?.timezone || "America/Los_Angeles";
    const timeZone = field("timeZone") ?? null;
    if (upload) {
      const bad = fileProblem(upload);
      if (bad) return bad;
      const read = weeklyFileRead(kindOfFile(upload.name) as Exclude<ReturnType<typeof kindOfFile>, "xls" | null>, timeZone, market, now(), field("sheet"));
      const airings = weeklyAirings(now(), read.timeZone);
      return reply(networkApi.previewListedSchedule.response, { format: "sheet", sheet: read, upcoming: 28, airings, timeZone: read.timeZone });
    }
    // A249: a guide: its channel's canned read; none picked, or one the file no longer has, refused.
    if (isGuideAddress(url!)) {
      if (!guideChannel(url!)) return fail(422, "pick_channel", PICK_CHANNEL);
      if (goneFromGuide(url!)) return fail(422, "not_in_guide", notInGuide(guideChannel(url!)!));
      const airings = guideAirings(now());
      return reply(networkApi.previewListedSchedule.response, { format: "xmltv", sheet: null, upcoming: airings.length, airings: airings.slice(0, 8), timeZone: timeZone ?? market, guide: guideRead(url!, now()) });
    }
    if (!isSheetLink(url!)) {
      // Any other address: as a feed is, canned (the mock never fetches).
      return reply(networkApi.previewListedSchedule.response, { format: formatOf(url!, false) ?? "ical", sheet: null, upcoming: 0, airings: [], timeZone: timeZone ?? market });
    }
    if (notPublicLink(url!)) return fail(422, "not_public", NOT_PUBLIC);
    // The canned week's airings, as Eastern times (a zone chosen only changes what's said).
    const read = atticRead(url!, timeZone, now());
    return reply(networkApi.previewListedSchedule.response, { format: "sheet", sheet: read, upcoming: 31, airings: atticAirings(now()), timeZone: read.timeZone });
  }),

  // ---- A249 (2026-10-06): "Find this channel's guide" ----

  http.post(path(networkApi.findListedGuides), async ({ request }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const parsed = networkApi.findListedGuides.body.safeParse(await bodyOf(request));
    if (!parsed.success) return fail(400, "invalid", "Give the channel's name.", { name: "Required" });
    // The mock never fetches: a canned extract of iptv-org's lists, by name.
    return reply(networkApi.findListedGuides.response, foundGuides(parsed.data.name));
  }),

  http.post(path(networkApi.uploadListedSchedule), async ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const l = getDb().listed.find((x) => x.id === String(params.sourceId));
    if (!l) return fail(404, "not_found", "That external station wasn't found.");
    if (l.removed) return fail(409, "removed", `${l.name} was taken off the dial. Put it back on the list first.`);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return fail(400, "bad_request", "Choose a spreadsheet file.", { file: "Required" });
    const bad = fileProblem(file);
    if (bad) return bad;
    const field = (k: string) => {
      const v = form?.get(k);
      return typeof v === "string" && v ? v : null;
    };
    const timeZone = field("timeZone");
    const market = marketById(stationById(l.stationId)?.marketId ?? "")?.timezone || "America/Los_Angeles";
    const was = { ...l.schedule };
    const wasUrl = l.calendarUrl;
    const read = weeklyFileRead(kindOfFile(file.name) as Exclude<ReturnType<typeof kindOfFile>, "xls" | null>, timeZone, market, now(), field("sheet") ?? undefined);
    l.calendarUrl = null;
    l.schedule = {
      source: "file",
      format: "sheet",
      checkedAgainst: null,
      checkedOn: null,
      timeZone,
      sheet: read,
      file: { name: file.name, kind: read.kind, bytes: file.size, uploadedAt: now().toISOString(), uploadedBy: whoOf(p) }
    };
    sync(l);
    const fields: ListedChange["fields"] = [];
    const note = (field: ListedChange["fields"][number]["field"], from: string | null, to: string | null) => {
      if (from !== to) fields.push({ field, from, to });
    };
    note("schedule", was.source, "file");
    note("calendarUrl", wasUrl, null);
    note("manualSchedule", manualText(was), null);
    fields.push({ field: "scheduleFile", from: was.source === "file" ? fileText(was) : null, to: fileText(l.schedule) });
    note("scheduleTimeZone", was.timeZone ?? null, timeZone);
    recordChange(l, whoOf(p), "changed", fields, ["schedule_reread"]);
    saved();
    return reply(networkApi.uploadListedSchedule.response, listedView(l)!);
  }),

  http.post(path(networkApi.previewIptvList), async ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const parsed = networkApi.previewIptvList.body.safeParse(await bodyOf(request));
    if (!parsed.success) return fail(400, "invalid", "Paste a list or give its address.", { m3u: "Paste a list or give its address" });
    const b = parsed.data;
    if (b.url && !isIptvOrgAddress(b.url)) return fail(400, "invalid", "Use a list from iptv-org (iptv-org.github.io), or paste the list itself.", { url: "iptv-org lists only" });
    // The mock never fetches: an iptv-org address answers the canned list.
    const { channels, skipped } = parseIptvList(b.url ? SAMPLE_LIST : (b.m3u ?? ""));
    if (!channels.length) return fail(422, "no_channels", "No channels with a stream address were found in that list.");
    const known = knownStreams();
    return reply(networkApi.previewIptvList.response, {
      listUrl: b.url ?? null,
      channels: channels.map((c) => ({ ...c, already: known.external.has(c.streamUrl) ? ("external" as const) : known.leads.has(c.streamUrl) ? ("lead" as const) : null })),
      skipped
    });
  }),

  http.post(path(networkApi.importIptvLeads), async ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const parsed = networkApi.importIptvLeads.body.safeParse(await bodyOf(request));
    if (!parsed.success) return fail(400, "invalid", "Pick between 1 and 100 channels to import.");
    const b = parsed.data;
    if (!marketById(b.marketId)) return fail(404, "not_found", "That market wasn't found.");
    const known = knownStreams();
    const urls = b.channels.map((c) => c.streamUrl);
    const fresh = b.channels.filter((c, i) => !known.leads.has(c.streamUrl) && !known.external.has(c.streamUrl) && urls.indexOf(c.streamUrl) === i);
    const at = now().toISOString();
    const made: DbCreator[] = fresh.map((c) => ({
      id: newId(),
      marketId: b.marketId,
      displayName: c.name,
      personName: null,
      description: null,
      // Noted, never played or checked from here: a lead isn't a listing.
      sourcePlatform: "other",
      sourceUrl: c.streamUrl,
      contactEmail: null,
      stage: "found",
      proposedOptions: null,
      nextAction: "Ask for permission, or confirm it's public",
      nextActionDue: null,
      doNotAsk: false,
      stationId: null,
      askedAt: null,
      remindedAt: null,
      answeredAt: null,
      claimInviteSentAt: null,
      claimLinkSentAt: null,
      claimedAt: null,
      licenceName: null,
      pronoun: "they",
      createdAt: at,
      setup: null,
      lead: { from: "iptv_list", streamUrl: c.streamUrl, listUrl: b.listUrl ?? null, tvgId: c.tvgId, group: c.group, country: c.country, logoUrl: c.logoUrl },
      listedSourceId: null
    }));
    getDb().creators.push(...made);
    saveDb();
    return reply(networkApi.importIptvLeads.response, { imported: made.map(creatorView), skipped: b.channels.length - fresh.length }, 201);
  })
];
