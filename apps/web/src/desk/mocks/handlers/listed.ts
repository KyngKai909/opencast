// External stations (follow-up Phase 6; were "listed sources"): the source's official embed or its
// stream link, each with its evidence, on the dial only once the evidence is complete. The rules
// are the API's (apps/api/src/v1/modules/network/external.ts): an embed needs its terms allowing
// embedding, the terms page and the day it was checked; a stream link needs their written
// permission (recorded once, never edited) or a clearly public basis; a DASH-only stream and a
// source outside the market wait unless Settings allows them; a stream down 5 minutes is hidden.
// The same channel and call sign rules as full stations, with subchannels (9.2, 9.3) only beside
// other external stations. The mock "finds" a feed whose address ends in .ics, .rss, .xml or .json.
//
// IPTV lists: a pasted list is read here (../iptv.ts); an iptv-org address answers a canned list,
// never fetched. Channels become pipeline leads with their stream noted, never listings.

import { http, type HttpHandler } from "msw";
import { callSignRefusal, networkApi, type CallSignRules, type ListedChange, type ListedSource, type StationIdent } from "@opencast/contracts";
import { now } from "../../../lib/clock";
import type { DbCreator } from "../fixtures/creators";
import type { DbListed } from "../fixtures/listed";
import { callSignTaken, creatorById, creatorView, getDb, marketById, newId, saveDb, stationById, tenthsOf } from "../db";
import { advanceHealth, publishExternalOff } from "../external";
import { isAdminNow } from "../settingsDb";
import { isIptvOrgAddress, parseIptvList, SAMPLE_LIST } from "../iptv";
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
    evidence: { basis: basisOf(l), termsUrl: l.termsUrl, termsCheckedOn: l.termsCheckedOn, publicBasis: l.publicBasis, permission: l.permission, note: l.note },
    schedule: { source: l.schedule.source, format: l.schedule.format, url: l.calendarUrl, checkedAgainst: l.schedule.checkedAgainst, checkedOn: l.schedule.checkedOn },
    onDial: !l.removed && waiting === null,
    waiting,
    health: l.health,
    outages: l.outages.slice(0, 5),
    creatorId: l.creatorId,
    removed: l.removed ? { at: l.removed.at, by: l.removed.by, channel: l.removed.channel, channelHeldUntil: new Date(Date.parse(l.removed.at) + REMOVED_CHANNEL_HOLD_MS).toISOString() } : null,
    earlierPermissions: l.earlierPermissions ?? []
  };
}

/** A feed's format from its address, when the desk didn't say. */
function formatOf(url: string, guide: boolean): DbListed["schedule"]["format"] {
  if (/\.ics($|\?)/i.test(url)) return "ical";
  if (/\.rss($|\?)/i.test(url)) return "rss";
  if (/\.json($|\?)/i.test(url)) return "json";
  if (/\.xml($|\?)/i.test(url)) return guide ? "xmltv" : "rss";
  return null;
}

function sync(l: DbListed) {
  if (!l.calendarUrl || l.removed) return;
  if (/\.(ics|rss|xml|json)($|\?)/i.test(l.calendarUrl)) {
    l.calendarSync = "synced";
    l.lastSyncedAt = now().toISOString();
    l.upcoming = Math.max(l.upcoming, 3);
  } else l.calendarSync = "calendar_not_found";
}

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
    const d = getDb();
    const creator = b.creatorId ? creatorById(b.creatorId) : null;
    if (b.creatorId && !creator) return fail(404, "not_found", "That lead wasn't found.");
    if (creator && d.listed.some((l) => l.creatorId === creator.id && !l.removed)) return fail(409, "already_external", `${creator.displayName} is already an external station.`);
    const market = marketById(b.marketId);
    if (!market) return fail(404, "not_found", "That market wasn't found.");
    const channel = channelProblem(b.marketId, b.band, b.channel);
    if (channel) return channel;
    const callSign = callSignProblem(b.callSign);
    if (callSign) return callSign;
    const at = now().toISOString();
    const ident: StationIdent = { id: newId(), kind: "listed", callSign: b.callSign, handle: b.callSign.toLowerCase(), name: b.name, colour: null, band: b.band, channel: b.channel, marketSlug: market.slug, homeCity: null };
    d.stations.push({ ident, marketId: market.id, public: true, firstSignedOnAt: at, escrowId: null, signOnAt: null });
    const e = b.evidence;
    const l: DbListed = {
      id: newId(),
      stationId: ident.id,
      name: b.name,
      description: b.description ?? null,
      streamUrl: b.streamUrl,
      embedTerms: plays === "embed" ? b.embedTerms! : "unclear",
      calendarUrl: b.calendarUrl ?? null,
      calendarSync: "not_set",
      lastSyncedAt: null,
      upcoming: 0,
      plays,
      termsUrl: e?.termsUrl ?? null,
      termsCheckedOn: e?.termsCheckedOn ?? null,
      publicBasis: plays === "stream_link" ? (e?.publicBasis?.trim() ?? null) : null,
      permission: plays === "stream_link" && e?.permission ? permissionRecord(p.displayName ?? p.email, b.streamUrl, creator?.id ?? null, e.permission) : null,
      note: e?.note || null,
      schedule: {
        source: b.guideData ? "guide_data" : b.calendarUrl ? "feed" : "none",
        format: b.calendarFormat ?? (b.calendarUrl ? formatOf(b.calendarUrl, !!b.guideData) : null),
        checkedAgainst: b.guideData?.checkedAgainst ?? null,
        checkedOn: b.guideData?.checkedOn ?? null
      },
      outsideMarket: b.outsideMarket ?? false,
      health: { state: "unchecked", since: null, lastCheckedAt: null, detail: null },
      outages: [],
      creatorId: creator?.id ?? null,
      addedAt: at,
      leadStageBefore: creator?.stage ?? null
    };
    sync(l);
    d.listed.push(l);
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
    if (!l.calendarUrl) return fail(422, "no_calendar", "Add the source's agenda calendar first.");
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
    const channel = b.channel && b.channel !== station.ident.channel ? b.channel : null;
    if (channel) {
      const bad = channelProblem(station.marketId, station.ident.band ?? "tv", channel, station.ident.id);
      if (bad) return bad;
    }
    const callSign = b.callSign && b.callSign !== station.ident.callSign ? b.callSign : null;
    if (callSign) {
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
      const next =
        sc.source === "none"
          ? { calendarUrl: null, schedule: { source: "none" as const, format: null, checkedAgainst: null, checkedOn: null } }
          : {
              calendarUrl: sc.calendarUrl,
              schedule: {
                source: sc.source,
                format: sc.calendarFormat ?? formatOf(sc.calendarUrl, sc.source === "guide_data"),
                checkedAgainst: sc.source === "guide_data" ? sc.guideData.checkedAgainst : null,
                checkedOn: sc.source === "guide_data" ? sc.guideData.checkedOn : null
              }
            };
      scheduleChanged =
        next.calendarUrl !== l.calendarUrl || next.schedule.source !== l.schedule.source || next.schedule.checkedAgainst !== l.schedule.checkedAgainst || next.schedule.checkedOn !== l.schedule.checkedOn;
      if (scheduleChanged) {
        l.calendarUrl = next.calendarUrl;
        l.schedule = next.schedule;
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
      l.heldCallSigns = [...(l.heldCallSigns ?? []).filter((c) => c !== callSign), ...(oldIdent.callSign ? [oldIdent.callSign] : [])];
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
      note("guideCheckedAgainst", was.schedule.checkedAgainst, l.schedule.checkedAgainst);
      note("guideCheckedOn", was.schedule.checkedOn, l.schedule.checkedOn);
    }
    if (channel) note("channel", oldIdent.channel, channel);
    if (callSign) note("callSign", oldIdent.callSign, callSign);
    if (fields.length) {
      const effects: ListedChange["effects"] = [];
      if (before && !basisOf(l)) effects.push("waits_for_evidence");
      if (restart) effects.push("checks_restart");
      if (scheduleChanged && l.calendarUrl) effects.push("schedule_reread");
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

  http.post(path(networkApi.removeListedSource), ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const l = getDb().listed.find((x) => x.id === String(params.sourceId));
    if (!l) return fail(404, "not_found", "That external station wasn't found.");
    if (l.removed) return fail(409, "removed", `${l.name} is already off the dial.`);
    const station = stationById(l.stationId);
    if (!station) return fail(404, "not_found", "That external station wasn't found.");
    // Archived like a full station that signs off for good: nothing is deleted.
    l.removed = { at: now().toISOString(), by: whoOf(p), channel: station.ident.channel, band: station.ident.band, marketId: station.marketId };
    endOutage(l, "removed");
    l.health = unchecked();
    station.public = false;
    const lead = l.creatorId ? creatorById(l.creatorId) : undefined;
    if (lead) {
      const was = [station.ident.channel, station.ident.callSign].filter(Boolean).join(" ");
      Object.assign(lead, { stage: lead.stage === "on_air" ? (l.leadStageBefore ?? "found") : lead.stage, stationId: null, listedSourceId: null, nextAction: `Was external station ${was || l.name}. Taken off the dial`, nextActionDue: null } satisfies Partial<DbCreator>);
    }
    recordChange(l, whoOf(p), "removed", [], []);
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
    if (l.creatorId && d.listed.some((x) => x !== l && x.creatorId === l.creatorId && !x.removed)) return fail(409, "already_external", "Its lead is already another external station.");
    const station = stationById(l.stationId);
    if (!station) return fail(404, "not_found", "That external station wasn't found.");
    const want = parsed.data.channel ?? station.ident.channel ?? l.removed.channel;
    if (!want) return fail(400, "invalid", "Choose a channel.", { channel: "Required" });
    const old = l.removed.channel;
    if (want !== station.ident.channel) {
      const bad = channelProblem(l.removed.marketId, l.removed.band ?? "tv", want, station.ident.id);
      if (bad) return bad;
    }
    station.ident = { ...station.ident, channel: want };
    station.public = true;
    l.removed = null;
    l.health = unchecked();
    l.addedAt = now().toISOString();
    const lead = l.creatorId ? creatorById(l.creatorId) : undefined;
    if (lead) {
      l.leadStageBefore = lead.stage;
      Object.assign(lead, { stationId: station.ident.id, listedSourceId: l.id, nextAction: null, nextActionDue: null, ...(basisOf(l) ? { stage: "on_air" as const } : {}) } satisfies Partial<DbCreator>);
    }
    sync(l);
    recordChange(l, whoOf(p), "restored", want !== old ? [{ field: "channel", from: old, to: want }] : [], []);
    saved();
    return reply(networkApi.restoreListedSource.response, listedView(l)!);
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
